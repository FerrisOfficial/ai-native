import { randomUUID, createHash } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrComment, PrThread, PullRequestSnapshot, ReplyDraft } from '../shared/types.js';
import { replyDraftSchema } from '../shared/types.js';
import { checked, run, type CommandRunner } from './process.js';

export function parsePullRequestUrl(value: string) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:[/?#].*)?$/.exec(
    value,
  );
  if (!match)
    throw new Error('Use a GitHub pull request URL: https://github.com/owner/repo/pull/123');
  return { repo: match[1], number: Number(match[2]) };
}
const commentFields = 'id body url author { login } viewerCanUpdate';
type CommentNode = Omit<PrComment, 'author'> & { author: { login: string } | null };
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
const comment = (c: CommentNode): PrComment => ({
  ...c,
  author: c.author?.login ?? 'deleted user',
});
export function prSnapshotHash(pr: PullRequestSnapshot) {
  return createHash('sha256').update(JSON.stringify(pr)).digest('hex');
}
export function repliesDigest(replies: ReplyDraft[]) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        replies.map(({ threadId, decision, body, updateCommentId, resolve }) => ({
          threadId,
          decision,
          body,
          updateCommentId,
          resolve,
        })),
      ),
    )
    .digest('hex');
}
export function validateReplies(pr: PullRequestSnapshot, raw: unknown): ReplyDraft[] {
  const replies = replyDraftSchema.array().parse(raw);
  if (
    replies.length !== pr.threads.length ||
    new Set(replies.map((r) => r.threadId)).size !== replies.length
  )
    throw new Error('Provide exactly one reply decision for every selected thread.');
  for (const reply of replies) {
    const thread = pr.threads.find((t) => t.id === reply.threadId);
    if (!thread) throw new Error('Reply references an unselected thread');
    if (reply.resolve && thread.kind !== 'review')
      throw new Error('Only review threads can be resolved');
    if (
      reply.updateCommentId &&
      !thread.comments.some((c) => c.id === reply.updateCommentId && c.viewerCanUpdate)
    )
      throw new Error('Only an editable comment in the selected thread can be updated');
  }
  return replies;
}

export class GithubService {
  constructor(public runner: CommandRunner = run) {}
  async graphql<T>(
    cwd: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    // Pass exact JSON through a file: no shell interpolation, argument limits or newline loss.
    const file = join(tmpdir(), `ai-native-gh-${randomUUID()}.json`);
    try {
      await writeFile(file, JSON.stringify({ query, variables }), { mode: 0o600 });
      const result = JSON.parse(
        await checked(
          this.runner,
          'gh',
          ['api', 'graphql', '--hostname', 'github.com', '--input', file],
          cwd,
        ),
      );
      if (result.errors?.length || !result.data)
        throw new Error(`GitHub GraphQL: ${JSON.stringify(result.errors ?? 'No data returned')}`);
      return result.data as T;
    } finally {
      await unlink(file).catch(() => {});
    }
  }
  async pages<T>(fetch: (cursor: string | null) => Promise<Connection<T>>) {
    const nodes: T[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await fetch(cursor);
      if (!page || !Array.isArray(page.nodes))
        throw new Error('GitHub returned an incomplete comment list');
      nodes.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) return nodes;
      cursor = page.pageInfo.endCursor;
      if (!cursor || seen.has(cursor))
        throw new Error('GitHub returned an invalid pagination cursor');
      seen.add(cursor);
    } while (true);
  }
  async load(url: string, cwd: string, expectedRepo: string): Promise<PullRequestSnapshot> {
    const { repo, number } = parsePullRequestUrl(url);
    if (repo.toLowerCase() !== expectedRepo.toLowerCase())
      throw new Error('The PR must belong to the selected repository');
    const [owner, name] = repo.split('/');
    const data = await this.graphql<{
      repository: {
        pullRequest: {
          id: string;
          url: string;
          title: string;
          body: string;
          state: string;
          headRefOid: string;
          headRefName: string;
          headRepository: { nameWithOwner: string } | null;
        } | null;
      };
    }>(
      cwd,
      `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id url title body state headRefOid headRefName headRepository{nameWithOwner}}}}`,
      { owner, name, number },
    );
    const pr = data.repository?.pullRequest;
    if (!pr || pr.state !== 'OPEN') throw new Error('Select an open pull request');
    if (pr.headRepository?.nameWithOwner.toLowerCase() !== repo.toLowerCase())
      throw new Error(
        'Fork pull requests are not supported yet. Select a PR whose branch is in this repository.',
      );
    type ThreadNode = { id: string; path: string; line: number | null; isResolved: boolean };
    const threads = await this.pages<ThreadNode>(async (cursor) => {
      const d = await this.graphql<{ node: { reviewThreads: Connection<ThreadNode> } }>(
        cwd,
        'query($id:ID!,$cursor:String){node(id:$id){... on PullRequest{reviewThreads(first:50,after:$cursor){nodes{id path line isResolved} pageInfo{hasNextPage endCursor}}}}}',
        { id: pr.id, cursor },
      );
      return d.node.reviewThreads;
    });
    const result: PrThread[] = [];
    for (const t of threads) {
      const comments = await this.threadComments(cwd, t.id);
      result.push({ ...t, kind: 'review', line: t.line ?? undefined, comments });
    }
    const general = await this.pages<CommentNode>(async (cursor) => {
      const d = await this.graphql<{ node: { comments: Connection<CommentNode> } }>(
        cwd,
        `query($id:ID!,$cursor:String){node(id:$id){... on PullRequest{comments(first:50,after:$cursor){nodes{${commentFields}} pageInfo{hasNextPage endCursor}}}}}`,
        { id: pr.id, cursor },
      );
      return d.node.comments;
    });
    for (const c of general)
      result.push({ id: c.id, kind: 'conversation', isResolved: false, comments: [comment(c)] });
    return {
      id: pr.id,
      number,
      repo,
      url: pr.url,
      title: pr.title,
      body: pr.body,
      headOid: pr.headRefOid,
      headBranch: pr.headRefName,
      threads: result,
    };
  }
  async threadComments(cwd: string, id: string) {
    return (
      await this.pages<CommentNode>(async (cursor) => {
        const d = await this.graphql<{ node: { comments: Connection<CommentNode> } }>(
          cwd,
          `query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:50,after:$cursor){nodes{${commentFields}} pageInfo{hasNextPage endCursor}}}}}`,
          { id, cursor },
        );
        return d.node.comments;
      })
    ).map(comment);
  }
  marker(projectId: string, threadId: string) {
    return `<!-- ai-native:${projectId}:${threadId} -->`;
  }
  body(pr: PullRequestSnapshot, draft: ReplyDraft, sha: string, projectId: string) {
    const thread = pr.threads.find((t) => t.id === draft.threadId)!;
    const context =
      thread.kind === 'conversation' && !draft.updateCommentId
        ? `In response to ${thread.comments[0].url}\n\n`
        : '';
    return `${context}${draft.body}\n\nReviewed commit: ${sha}\n\n${this.marker(projectId, draft.threadId)}`;
  }
  assertFresh(
    original: PullRequestSnapshot,
    live: PullRequestSnapshot,
    replies: ReplyDraft[],
    projectId: string,
    commitSha?: string,
  ) {
    if (
      live.id !== original.id ||
      live.body !== original.body ||
      live.headBranch !== original.headBranch ||
      ![original.headOid, commitSha].includes(live.headOid)
    )
      throw new Error(
        'The PR branch changed. Start a new PR comments project from its current state.',
      );
    for (const thread of original.threads) {
      const now = live.threads.find((t) => t.id === thread.id);
      const draft = replies.find((r) => r.threadId === thread.id);
      if (!now) throw new Error('A selected comment was deleted. Refresh the PR in a new project.');
      const publishedBody =
        draft && commitSha ? this.body(original, draft, commitSha, projectId) : undefined;
      for (const old of thread.comments) {
        const current = now.comments.find((c) => c.id === old.id);
        if (
          !current ||
          (current.body !== old.body &&
            !(draft?.updateCommentId === old.id && current.body === publishedBody))
        )
          throw new Error(
            'A selected comment was edited. Review the latest PR comments in a new project.',
          );
      }
      const added = now.comments.filter((c) => !thread.comments.some((old) => old.id === c.id));
      if (added.some((c) => !publishedBody || c.body !== publishedBody || !c.viewerCanUpdate))
        throw new Error(
          'A selected thread has new replies. Review the latest discussion in a new project.',
        );
      if (
        now.isResolved !== thread.isResolved &&
        !(draft?.resolve && now.isResolved && now.comments.some((c) => c.body === publishedBody))
      )
        throw new Error('A selected thread changed resolution state. Refresh the PR.');
    }
  }
  async publishReply(
    pr: PullRequestSnapshot,
    live: PullRequestSnapshot,
    draft: ReplyDraft,
    cwd: string,
    projectId: string,
    sha: string,
  ) {
    const thread = pr.threads.find((t) => t.id === draft.threadId)!;
    const body = this.body(pr, draft, sha, projectId);
    const comments =
      thread.kind === 'review'
        ? live.threads.find((t) => t.id === thread.id)!.comments
        : live.threads.filter((t) => t.kind === 'conversation').flatMap((t) => t.comments);
    const existing = comments.find(
      (c) =>
        c.viewerCanUpdate &&
        c.body === body &&
        (!draft.updateCommentId || c.id === draft.updateCommentId),
    );
    if (existing) return { ...draft, commentId: existing.id, publishedBody: body };
    if (draft.commentId)
      throw new Error(
        'A published reply was changed or deleted. Inspect it on GitHub before continuing.',
      );
    let commentId: string;
    if (draft.updateCommentId) {
      const target = comments.find((c) => c.id === draft.updateCommentId);
      if (!target?.viewerCanUpdate) throw new Error('GitHub does not allow editing this comment');
      const review = thread.kind === 'review';
      const mutation = review ? 'updatePullRequestReviewComment' : 'updateIssueComment';
      const inputType = review ? 'UpdatePullRequestReviewCommentInput' : 'UpdateIssueCommentInput';
      const idKey = review ? 'pullRequestReviewCommentId' : 'id';
      const resultKey = review ? 'pullRequestReviewComment' : 'issueComment';
      const data = await this.graphql<Record<string, Record<string, { id: string }>>>(
        cwd,
        `mutation($input:${inputType}!){${mutation}(input:$input){${resultKey}{id}}}`,
        { input: { [idKey]: target.id, body } },
      );
      commentId = data[mutation][resultKey].id;
    } else if (thread.kind === 'review') {
      const data = await this.graphql<{
        addPullRequestReviewThreadReply: { comment: { id: string } };
      }>(
        cwd,
        'mutation($input:AddPullRequestReviewThreadReplyInput!){addPullRequestReviewThreadReply(input:$input){comment{id}}}',
        { input: { pullRequestReviewThreadId: thread.id, body } },
      );
      commentId = data.addPullRequestReviewThreadReply.comment.id;
    } else {
      const data = await this.graphql<{ addComment: { commentEdge: { node: { id: string } } } }>(
        cwd,
        'mutation($input:AddCommentInput!){addComment(input:$input){commentEdge{node{id}}}}',
        { input: { subjectId: pr.id, body } },
      );
      commentId = data.addComment.commentEdge.node.id;
    }
    return { ...draft, commentId, publishedBody: body };
  }
  async resolve(cwd: string, id: string) {
    await this.graphql(
      cwd,
      'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}',
      { id },
    );
  }
}
