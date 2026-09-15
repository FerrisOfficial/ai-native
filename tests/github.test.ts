import { it, expect } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import {
  GithubService,
  parsePullRequestUrl,
  validateReplies,
  repliesDigest,
} from '../server/github';
import type { CommandRunner } from '../server/process';
import type { PullRequestSnapshot, ReplyDraft } from '../shared/types';

const pr: PullRequestSnapshot = {
  id: 'PR_1',
  number: 40,
  url: 'https://github.com/example/repo/pull/40',
  repo: 'example/repo',
  title: 'Feedback',
  body: 'Context',
  headOid: 'abc',
  headBranch: 'feature',
  threads: [
    {
      id: 'T1',
      kind: 'review',
      path: 'a.ts',
      isResolved: false,
      comments: [
        {
          id: 'C1',
          body: 'Please fix this',
          author: 'reviewer',
          url: 'https://github.com/example/repo/pull/40#discussion_r1',
          viewerCanUpdate: false,
        },
        {
          id: 'C2',
          body: 'My previous reply',
          author: 'me',
          url: 'https://github.com/example/repo/pull/40#discussion_r2',
          viewerCanUpdate: true,
        },
      ],
    },
  ],
};
const reply: ReplyDraft = {
  threadId: 'T1',
  decision: 'fix',
  body: 'Fixed.\n\nLiteral `code` and $text.',
  resolve: true,
};
it('validates targets and rejects missing, duplicate, foreign and uneditable reply actions', () => {
  expect(parsePullRequestUrl(pr.url)).toEqual({ repo: 'example/repo', number: 40 });
  expect(() => parsePullRequestUrl('https://github.com.evil.test/example/repo/pull/40')).toThrow();
  expect(() => validateReplies(pr, [])).toThrow('every selected');
  expect(() => validateReplies(pr, [reply, reply])).toThrow();
  expect(() => validateReplies(pr, [{ ...reply, threadId: 'other' }])).toThrow('unselected');
  expect(() => validateReplies(pr, [{ ...reply, updateCommentId: 'C1' }])).toThrow('editable');
  expect(validateReplies(pr, [{ ...reply, updateCommentId: 'C2' }])).toHaveLength(1);
  expect(repliesDigest([reply])).toBe(
    repliesDigest([{ ...reply, commentId: 'sent', resolved: true }]),
  );
  expect(repliesDigest([reply])).not.toBe(repliesDigest([{ ...reply, body: 'Changed' }]));
});
it('detects stale PR state while allowing only the exact approved publication on retry', () => {
  const gh = new GithubService();
  const live = structuredClone(pr);
  gh.assertFresh(pr, live, [reply], 'project');
  live.headOid = 'other';
  expect(() => gh.assertFresh(pr, live, [reply], 'project')).toThrow('branch changed');
  live.headOid = 'approved';
  live.threads[0].comments.push({
    id: 'C3',
    body: gh.body(pr, reply, 'approved', 'project'),
    url: '',
    author: 'me',
    viewerCanUpdate: true,
  });
  live.threads[0].isResolved = true;
  gh.assertFresh(pr, live, [reply], 'project', 'approved');
  live.threads[0].comments[2].body = 'An unexpected new reply';
  expect(() => gh.assertFresh(pr, live, [reply], 'project', 'approved')).toThrow('new replies');
  live.threads[0].comments = structuredClone(pr.threads[0].comments);
  live.threads[0].comments[0].body = 'New requirements';
  expect(() => gh.assertFresh(pr, live, [reply], 'project', 'approved')).toThrow('edited');
});
it('uses gh CLI JSON payloads, preserves multiline text, edits own comments, and deduplicates lost responses', async () => {
  const requests: { query: string; variables: any }[] = [];
  const paths: string[] = [];
  const runner: CommandRunner = async (exe, args) => {
    expect(exe).toBe('gh');
    expect(args.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'github.com']);
    paths.push(args.at(-1)!);
    const payload = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
    requests.push(payload);
    const data = payload.query.includes('updatePullRequestReviewComment')
      ? { updatePullRequestReviewComment: { pullRequestReviewComment: { id: 'C2' } } }
      : { addPullRequestReviewThreadReply: { comment: { id: 'new' } } };
    return { stdout: JSON.stringify({ data }), stderr: '', exitCode: 0 };
  };
  const gh = new GithubService(runner);
  const sent = await gh.publishReply(pr, pr, reply, '.', 'project', 'sha');
  expect(requests[0].variables.input.body).toBe(gh.body(pr, reply, 'sha', 'project'));
  expect(sent.commentId).toBe('new');
  const live = structuredClone(pr);
  live.threads[0].comments.push({
    id: 'new',
    body: sent.publishedBody!,
    author: 'me',
    url: '',
    viewerCanUpdate: true,
  });
  expect((await gh.publishReply(pr, live, reply, '.', 'project', 'sha')).commentId).toBe('new');
  expect(requests).toHaveLength(1);
  await gh.publishReply(pr, pr, { ...reply, updateCommentId: 'C2' }, '.', 'project', 'sha');
  expect(requests[1].variables.input.pullRequestReviewCommentId).toBe('C2');
  for (const path of paths) await expect(access(path)).rejects.toThrow();
});
it('paginates threads and nested comments and reports GraphQL errors', async () => {
  const calls: any[] = [];
  const page = (nodes: unknown[], next: string | null = null) => ({
    nodes,
    pageInfo: { hasNextPage: !!next, endCursor: next },
  });
  const runner: CommandRunner = async (_exe, args) => {
    const { query, variables } = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
    calls.push({ query, variables });
    let data;
    if (query.includes('headRepository'))
      data = {
        repository: {
          pullRequest: {
            id: pr.id,
            title: pr.title,
            body: '',
            url: pr.url,
            state: 'OPEN',
            headRefOid: 'abc',
            headRefName: 'feature',
            headRepository: { nameWithOwner: pr.repo },
          },
        },
      };
    else if (query.includes('reviewThreads'))
      data = {
        node: {
          reviewThreads: variables.cursor
            ? page([])
            : page([{ id: 'T1', path: 'a.ts', line: 1, isResolved: false }], 'thread-next'),
        },
      };
    else if (query.includes('PullRequestReviewThread'))
      data = {
        node: {
          comments: variables.cursor
            ? page([{ ...pr.threads[0].comments[1], author: { login: 'me' } }])
            : page(
                [{ ...pr.threads[0].comments[0], author: { login: 'reviewer' } }],
                'comment-next',
              ),
        },
      };
    else data = { node: { comments: page([]) } };
    return { stdout: JSON.stringify({ data }), stderr: '', exitCode: 0 };
  };
  const loaded = await new GithubService(runner).load(pr.url, '.', pr.repo);
  expect(loaded.threads[0].comments).toHaveLength(2);
  expect(calls.some((c) => c.variables.cursor === 'thread-next')).toBe(true);
  expect(calls.some((c) => c.variables.cursor === 'comment-next')).toBe(true);
  const bad = new GithubService(async () => ({
    stdout: '{"data":{},"errors":[{"message":"Forbidden"}]}',
    stderr: '',
    exitCode: 0,
  }));
  await expect(bad.graphql('.', 'query { viewer { login } }')).rejects.toThrow('Forbidden');
});

it('posts replies to PR conversation comments and edits an existing editable conversation comment', async () => {
  const conversation = structuredClone(pr);
  conversation.threads = [
    {
      id: 'I1',
      kind: 'conversation',
      isResolved: false,
      comments: [
        {
          id: 'I1',
          body: 'Previous message',
          author: 'me',
          url: pr.url + '#issuecomment-1',
          viewerCanUpdate: true,
        },
      ],
    },
  ];
  const requests: any[] = [];
  const gh = new GithubService(async (_exe, args) => {
    const payload = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
    requests.push(payload);
    return {
      stdout: JSON.stringify({
        data: payload.query.includes('updateIssueComment')
          ? { updateIssueComment: { issueComment: { id: 'I1' } } }
          : { addComment: { commentEdge: { node: { id: 'I2' } } } },
      }),
      stderr: '',
      exitCode: 0,
    };
  });
  const draft: ReplyDraft = { ...reply, threadId: 'I1', resolve: false };
  await gh.publishReply(conversation, conversation, draft, '.', 'project', 'sha');
  expect(requests[0].variables.input.subjectId).toBe(pr.id);
  expect(requests[0].variables.input.body).toContain(pr.url + '#issuecomment-1');
  await gh.publishReply(
    conversation,
    conversation,
    { ...draft, updateCommentId: 'I1' },
    '.',
    'project',
    'sha',
  );
  expect(requests[1].variables.input.id).toBe('I1');
  expect(() => validateReplies(conversation, [{ ...draft, resolve: true }])).toThrow(
    'Only review threads',
  );
});
