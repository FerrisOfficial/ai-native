// Local UI fixture. All GitHub and Git operations are simulated; no credentials are used.
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { Workflow } from '../server/workflow.js';
import { GitService } from '../server/git.js';
import { GithubService } from '../server/github.js';
import { Terminals } from '../server/terminals.js';
import { createApp } from '../server/app.js';
import type { AgentRequest } from '../server/claude.js';
import type { PullRequestSnapshot, Project, Repository } from '../shared/types.js';

const root = await mkdtemp(join(tmpdir(), 'anw-pr-ui-'));
const repo = join(root, 'repo');
await mkdir(repo);
const store = new Store(join(root, 'workflow.sqlite'));
const live: PullRequestSnapshot = {
  id: 'PR_fixture',
  repo: 'example/repo',
  number: 40,
  url: 'https://github.com/example/repo/pull/40',
  title: 'Preserve stable bank identifiers',
  body: 'Review feedback fixture',
  headOid: 'abc123',
  headBranch: 'feature/stable-identifiers',
  threads: [
    {
      id: 'thread-1',
      kind: 'review',
      path: 'BankCompatibilityService.cs',
      line: 24,
      isResolved: false,
      comments: [
        {
          id: 'comment-1',
          author: 'reviewer',
          body: 'Please explain why the identifier remains stable when the display name changes.',
          url: 'https://github.com/example/repo/pull/40#discussion_r1',
          viewerCanUpdate: false,
        },
        {
          id: 'comment-2',
          author: 'you',
          body: 'I will add an example to the documentation.',
          url: 'https://github.com/example/repo/pull/40#discussion_r2',
          viewerCanUpdate: true,
        },
      ],
    },
    {
      id: 'general-1',
      kind: 'conversation',
      isResolved: false,
      comments: [
        {
          id: 'general-1',
          author: 'reviewer',
          body: 'Could you also include a regression test?',
          url: 'https://github.com/example/repo/pull/40#issuecomment-1',
          viewerCanUpdate: false,
        },
      ],
    },
  ],
};
class FixtureGit extends GitService {
  async prepare(p: Project) {
    await mkdir(p.worktree, { recursive: true });
    return 'abc123';
  }
  async fingerprint() {
    return 'fixture-fingerprint';
  }
  async git() {
    return '1 file changed';
  }
  async commit() {
    return 'def456';
  }
  async publish(p: Project) {
    live.headOid = p.commitSha!;
    return live.url;
  }
}
const agent = {
  async execute({ project, stage }: AgentRequest) {
    if (stage === 'plan')
      return {
        ticketAccessible: true,
        ticket: 'Address the selected PR feedback.',
        plan: '1. Verify stable identifiers.\n2. Add documentation and a regression test.\n3. Prepare a reply for every selected thread.',
      };
    if (stage === 'implementation')
      return {
        summary: 'Documented identifier stability and added a regression test.',
        replies: project.pullRequest?.threads.map((t) => ({
          threadId: t.id,
          decision: 'fix',
          body: 'Added documentation and a regression test. The identifier is derived from the stable bank ID, so renaming the display label does not change it.',
          resolve: false,
        })),
      };
    return {
      summary:
        'The changes and proposed replies address the selected comments. Ready for publication.',
      items: [],
    };
  },
  async interrupt() {},
  answer() {},
};
const workflow = new Workflow(
  store,
  new FixtureGit(join(root, 'worktrees')),
  agent,
  new Terminals(store),
  root,
  resolve('skills'),
);
const repository: Repository = {
  id: 'fixture-repo',
  name: 'Bank converter · fixture',
  path: repo,
  remote: 'https://github.com/example/repo.git',
  baseBranch: 'main',
  setupCommand: '',
  testCommand: '',
  copyFiles: [],
  terminals: [],
  autoApprove: true,
  createdAt: new Date().toISOString(),
  choices: {
    plan: { skill: 'example-plan', model: 'default' },
    implementation: { skill: 'example-implement', model: 'default' },
    review: { skill: 'example-review', model: 'default' },
  },
};
store.put('repositories', repository);
workflow.github = new GithubService();
workflow.github.load = async () => structuredClone(live);
workflow.github.publishReply = async (pr, _live, draft, _cwd, projectId, sha) => {
  const body = workflow.github.body(pr, draft, sha, projectId);
  const thread = live.threads.find((t) => t.id === draft.threadId)!;
  const existing = thread.comments.find((c) => c.id === draft.updateCommentId);
  if (existing) existing.body = body;
  else
    thread.comments.push({
      id: 'reply-' + draft.threadId,
      body,
      author: 'you',
      viewerCanUpdate: true,
      url: live.url,
    });
  return { ...draft, commentId: existing?.id ?? 'reply-' + draft.threadId, publishedBody: body };
};
workflow.github.resolve = async (_cwd, id) => {
  live.threads.find((t) => t.id === id)!.isResolved = true;
};
const normal = await workflow.create({
  name: 'Improve import validation',
  repoId: repository.id,
  taskSource: 'description',
  taskDescription: 'Explain invalid bank files',
});
const preview = await workflow.previewPr(repository.id, live.url);
const project = await workflow.create({
  name: 'Address bank identifier review',
  repoId: repository.id,
  taskSource: 'pr_comments',
  ticketUrl: live.url,
  selectedThreadIds: ['thread-1'],
  prSnapshotHash: preview.fingerprint,
});
while (workflow.active.size || workflow.get(project.id).status === 'queued')
  await new Promise((r) => setTimeout(r, 30));
workflow.approvePlan(project.id);
while (workflow.active.size) await new Promise((r) => setTimeout(r, 30));
const port = Number(process.env.UI_PR_PORT ?? 4398);
const app = await createApp(workflow, { port });
await app.listen({ host: '127.0.0.1', port });
console.log(
  `PR comments UI fixture: http://127.0.0.1:${port}\nProjects: ${normal.id}, ${project.id}\nData: ${root}`,
);
process.on('SIGINT', async () => {
  await workflow.close();
  await app.close();
  store.close();
  process.exit();
});
