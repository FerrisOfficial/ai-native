import { testDirectory } from './temp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRequest, AgentDriver } from '../server/claude.js';
import { ClaudeDriver } from '../server/claude.js';
import { Store } from '../server/store.js';
import { GitService } from '../server/git.js';
import { Terminals } from '../server/terminals.js';
import { Workflow } from '../server/workflow.js';
import { run, checked, type CommandRunner } from '../server/process.js';
import { scanSkills, snapshotSkills } from '../server/skills.js';
import { createApp } from '../server/app.js';
import type {
  Project,
  Question,
  Session,
  TerminalRecord,
  PullRequestSnapshot,
} from '../shared/types.js';
import { GithubService } from '../server/github.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const choices = {
  plan: { skill: 'planner', model: 'default' },
  implementation: { skill: 'builder', model: 'default' },
  review: { skill: 'reviewer', model: 'default' },
};
class FakeTerminals extends Terminals {
  override start(
    project: Project,
    spec: { name: string; command: string; env: Record<string, string> },
    existingId?: string,
  ) {
    return this.store.put<TerminalRecord>('terminals', {
      ...spec,
      id: existingId ?? randomUUID(),
      projectId: project.id,
      status: 'running',
      output: '',
      createdAt: new Date().toISOString(),
    });
  }
  override async stopProject(id: string) {
    for (const t of this.store.all<TerminalRecord>('terminals').filter((t) => t.projectId === id))
      this.store.put('terminals', { ...t, status: 'exited' });
  }
  override async close() {}
}
class FakeAgent implements AgentDriver {
  calls: AgentRequest[] = [];
  fail?: string;
  ticketAccessible = true;
  mutateReview = false;
  hold = false;
  async execute(request: AgentRequest): Promise<unknown> {
    this.calls.push(request);
    if (this.hold)
      await new Promise<void>((resolve, reject) => {
        if (request.signal.aborted) reject(new Error('aborted'));
        else
          request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
      });
    if (this.fail) throw new Error(this.fail);
    if (request.stage === 'plan')
      return {
        ticketAccessible: this.ticketAccessible,
        ticket: 'Add a feature with tests',
        plan: 'Implement feature.txt and validate it.',
        error: 'Ticket access denied',
      };
    if (request.stage === 'implementation') {
      await writeFile(
        join(request.project.worktree, 'feature.txt'),
        `Round ${request.project.round}\n`,
      );
      return {
        summary: 'Added a feature.',
        ...(request.project.pullRequest
          ? {
              replies: request.project.pullRequest.threads.map((t) => ({
                threadId: t.id,
                decision: 'fix',
                body: 'Fixed and checked.',
                resolve: false,
              })),
            }
          : {}),
      };
    }
    if (this.mutateReview)
      await writeFile(join(request.project.worktree, 'unexpected.txt'), 'not allowed');
    return {
      summary: 'Implementation reviewed.',
      items: [
        {
          id: 'finding',
          severity: 'medium',
          title: 'Clarify the feature',
          description: 'Add an example.',
          file: 'feature.txt',
          line: 1,
        },
      ],
    };
  }
  async interrupt() {}
  answer() {}
}
async function settled(w: Workflow, id: string, status: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const p = w.get(id);
    if (p.status === status && !w.active.has(id)) return p;
    if (p.status === 'blocked' && status !== 'blocked') throw new Error(p.error);
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out: expected ${status}, got ${w.get(id).status}: ${w.get(id).error}`);
}
async function fixture() {
  const root = await testDirectory();
  const repo = join(root, 'repo'),
    remote = join(root, 'remote.git'),
    skills = join(root, 'skills');
  await mkdir(repo);
  await mkdir(skills);
  await checked(run, 'git', ['init', '--initial-branch=main'], repo);
  await checked(run, 'git', ['config', 'user.name', 'Workflow Test'], repo);
  await checked(run, 'git', ['config', 'user.email', 'workflow@example.test'], repo);
  await checked(run, 'git', ['config', 'commit.gpgsign', 'false'], repo);
  await writeFile(join(repo, 'README.md'), 'Fixture repository\n');
  await writeFile(join(repo, '.gitignore'), '.env\nnode_modules/\n');
  await checked(run, 'git', ['add', '.'], repo);
  await checked(run, 'git', ['commit', '-m', 'Initial'], repo);
  await checked(run, 'git', ['init', '--bare', '--initial-branch=main', remote], root);
  await checked(run, 'git', ['remote', 'add', 'origin', remote], repo);
  await checked(run, 'git', ['push', '-u', 'origin', 'main'], repo);
  for (const id of ['planner', 'builder', 'reviewer']) {
    await mkdir(join(skills, id));
    await writeFile(
      join(skills, id, 'SKILL.md'),
      `---\nname: ${id}\ndescription: ${id} test skill\n---\nTest instructions for ${id}.\n`,
    );
  }
  await writeFile(join(repo, '.env'), 'TEST_SECRET=keep-local');
  const state = {
    ghCreates: 0,
    failPublish: false,
    failAfterCreate: false,
    prCreated: false,
    commands: [] as string[],
    testFails: false,
    setupFails: false,
  };
  const runner: CommandRunner = async (exe, args, cwd, options) => {
    if (exe === 'gh') {
      if (args[1] === 'list')
        return {
          stdout: state.prCreated ? '[{"url":"https://github.com/example/repo/pull/1"}]' : '[]',
          stderr: '',
          exitCode: 0,
        };
      if (args[1] === 'create') {
        state.ghCreates++;
        if (state.failPublish)
          return { stdout: '', stderr: 'GitHub temporarily unavailable', exitCode: 1 };
        state.prCreated = true;
        return state.failAfterCreate
          ? { stdout: '', stderr: 'Lost connection after publication', exitCode: 1 }
          : { stdout: 'https://github.com/example/repo/pull/1', stderr: '', exitCode: 0 };
      }
    }
    if (exe === 'powershell.exe' || exe === '/bin/sh') {
      const command = args.at(-1)!;
      state.commands.push(command);
      options?.output?.('Fixture command output\n');
      return {
        stdout: 'Fixture command output\n',
        stderr: '',
        exitCode:
          (command.includes('test-command') && state.testFails) ||
          (command.includes('setup-command') && state.setupFails)
            ? 1
            : 0,
      };
    }
    return run(exe, args, cwd, options);
  };
  const store = new Store(join(root, 'state.sqlite')),
    git = new GitService(join(root, 'worktrees'), runner),
    agent = new FakeAgent();
  const w = new Workflow(store, git, agent, new FakeTerminals(store), root, skills, runner);
  cleanups.push(async () => {
    await w.close();
    store.close();
  });
  const repository = await w.repository({
    name: 'Fixture',
    path: repo,
    choices,
    copyFiles: ['.env'],
    setupCommand: 'setup-command',
    testCommand: 'test-command',
    terminals: [
      { id: 'frontend', name: 'Frontend', command: 'dev', env: {} },
      { id: 'backend', name: 'Backend', command: 'serve', env: {} },
    ],
  });
  repository.remote = 'https://github.com/example/repo.git';
  store.put('repositories', repository);
  const create = () =>
    w.create({
      name: 'Test feature',
      ticketUrl: 'https://tickets.example.test/42',
      repoId: repository.id,
    });
  const review = async () => {
    const p = await create();
    await settled(w, p.id, 'awaiting_plan');
    w.approvePlan(p.id);
    return settled(w, p.id, 'awaiting_result');
  };
  return { root, repo, skills, store, git, agent, w, state, repository, create, review };
}

describe('PR comment workflow with real Git', () => {
  it.each([false, true])(
    'plans, reviews, edits replies and resumes publication without duplicates (no code: %s)',
    async (noCode) => {
      const f = await fixture();
      await f.git.git(['push', 'origin', 'HEAD:refs/heads/pr-feedback'], f.repo);
      const originalRunner = f.git.runner;
      f.git.runner = async (exe, args, cwd, options) =>
        exe === 'git' && args.join(' ') === 'remote get-url origin'
          ? { stdout: 'https://github.com/example/repo.git', stderr: '', exitCode: 0 }
          : originalRunner(exe, args, cwd, options);
      const initialSha = await f.git.git(['rev-parse', 'HEAD'], f.repo);
      const live: PullRequestSnapshot = {
        id: 'PR_fixture',
        number: 40,
        repo: 'example/repo',
        url: 'https://github.com/example/repo/pull/40',
        title: 'Existing PR',
        body: 'Fix feedback',
        headOid: initialSha,
        headBranch: 'pr-feedback',
        threads: [
          {
            id: 'T1',
            kind: 'review',
            path: 'feature.txt',
            isResolved: false,
            comments: [
              {
                id: 'C1',
                body: 'Please add an example',
                author: 'reviewer',
                url: 'https://github.com/example/repo/pull/40#discussion_r1',
                viewerCanUpdate: false,
              },
            ],
          },
        ],
      };
      let writes = 0;
      let failAfterReply = true;
      const ghRunner: CommandRunner = async (_exe, args) => {
        const payload = JSON.parse(await readFile(args.at(-1)!, 'utf8'));
        if (payload.query.includes('resolveReviewThread')) {
          live.threads[0].isResolved = true;
          return {
            stdout: JSON.stringify({ data: { resolveReviewThread: { thread: { id: 'T1' } } } }),
            stderr: '',
            exitCode: 0,
          };
        }
        expect(payload.query).toContain('addPullRequestReviewThreadReply');
        writes++;
        live.threads[0].comments.push({
          id: 'reply',
          body: payload.variables.input.body,
          url: '',
          author: 'me',
          viewerCanUpdate: true,
        });
        if (failAfterReply) {
          failAfterReply = false;
          throw new Error('Lost reply response');
        }
        return {
          stdout: JSON.stringify({
            data: { addPullRequestReviewThreadReply: { comment: { id: 'reply' } } },
          }),
          stderr: '',
          exitCode: 0,
        };
      };
      f.w.github = new GithubService(ghRunner);
      f.w.github.load = async () => {
        live.headOid = (
          await f.git.git(['ls-remote', 'origin', 'refs/heads/pr-feedback'], f.repo)
        ).split(/\s/)[0];
        return structuredClone(live);
      };
      if (noCode) {
        const execute = f.agent.execute.bind(f.agent);
        f.agent.execute = async (request) =>
          request.stage === 'implementation'
            ? {
                summary: 'Explain the existing behavior',
                replies: [
                  {
                    threadId: 'T1',
                    decision: 'explain',
                    body: 'Existing behavior is correct.',
                    resolve: false,
                  },
                ],
              }
            : execute(request);
      }
      const preview = await f.w.previewPr(f.repository.id, live.url);
      const p = await f.w.create({
        name: 'Address PR feedback',
        taskSource: 'pr_comments',
        ticketUrl: live.url,
        repoId: f.repository.id,
        selectedThreadIds: ['T1'],
        prSnapshotHash: preview.fingerprint,
      });
      await settled(f.w, p.id, 'awaiting_plan');
      expect(f.w.get(p.id).baseCommit).toBe(initialSha);
      expect(p.branch).not.toBe('pr-feedback');
      f.w.approvePlan(p.id);
      const reviewed = await settled(f.w, p.id, 'awaiting_result');
      expect(reviewed.replies).toHaveLength(1);
      expect(writes).toBe(0);
      expect(f.agent.calls.find((c) => c.stage === 'review')!.prompt).toContain(
        'NOT review defects',
      );
      f.w.saveReplies(
        p.id,
        reviewed.replies!.map((r) => ({
          ...r,
          body: 'Approved reply with an example.',
          resolve: true,
        })),
      );
      await settled(f.w, p.id, 'awaiting_result');
      await f.w.approvePublication(p.id);
      const blocked = await settled(f.w, p.id, 'blocked');
      expect(blocked.error).toContain('Lost reply response');
      expect(blocked.commitSha).toBeTruthy();
      expect(live.headOid).toBe(blocked.commitSha);
      expect(blocked.commitSha === initialSha).toBe(noCode);
      f.w.enqueue(p.id);
      const published = await settled(f.w, p.id, 'published');
      expect(writes).toBe(1);
      expect(published.prUrl).toBe(live.url);
      expect(published.replies![0]).toMatchObject({ commentId: 'reply', resolved: true });
      expect(f.state.ghCreates).toBe(0);
      expect(live.threads[0].comments[1].body).toContain('Approved reply with an example.');
    },
    60000,
  );
});

describe('Workflow lifecycle with real Git and deterministic Claude', () => {
  it('preserves a ticket note through planning, implementation and review', async () => {
    const f = await fixture();
    const note = 'Keep the existing filters.\n\n**Acceptance:** preserve Polish search.';
    const p = await f.w.create({
      name: 'Ticket with context',
      repoId: f.repository.id,
      ticketUrl: 'https://example.test/task',
      taskNote: note,
    });
    await settled(f.w, p.id, 'awaiting_plan');
    expect(f.w.get(p.id).taskNote).toBe(note);
    f.w.revisePlan(p.id, 'Include regression checks');
    await settled(f.w, p.id, 'awaiting_plan');
    f.w.approvePlan(p.id);
    await settled(f.w, p.id, 'awaiting_result');
    for (const call of f.agent.calls) {
      expect(call.prompt).toContain(note);
      expect(call.prompt).toContain('https://example.test/task');
    }
    expect(f.agent.calls[0].prompt).toContain('Retrieve the actual ticket');
    expect(f.w.get(p.id).taskNote).toBe(note);
  }, 60000);
  it.each(['local', 'remote'] as const)(
    'continues an existing %s branch only after confirmation and preserves its history',
    async (source) => {
      const f = await fixture();
      const branch = 'feature/previous-work';
      await f.git.git(['checkout', '-b', branch], f.repo);
      await writeFile(join(f.repo, 'previous.txt'), 'Previous task\n');
      await f.git.git(['add', 'previous.txt'], f.repo);
      await f.git.git(['commit', '-m', 'Previous task'], f.repo);
      const tip = await f.git.git(['rev-parse', 'HEAD'], f.repo);
      await f.git.git(['push', 'origin', branch], f.repo);
      await f.git.git(['checkout', 'main'], f.repo);
      if (source === 'remote') await f.git.git(['branch', '-D', branch], f.repo);
      const input = {
        name: 'Continue task',
        repoId: f.repository.id,
        ticketUrl: 'https://example.test/task',
        branch,
      };
      await expect(f.w.create(input)).rejects.toMatchObject({
        code: 'BRANCH_CONFIRMATION_REQUIRED',
      });
      expect(f.store.all('projects')).toHaveLength(0);
      const p = await f.w.create({ ...input, reuseExistingBranch: true });
      await settled(f.w, p.id, 'awaiting_plan');
      expect(f.w.get(p.id).reuseBranch).toBe(source);
      expect(f.w.get(p.id).baseCommit).toBe(tip);
      expect(
        (await readFile(join(p.worktree, 'previous.txt'), 'utf8')).replaceAll('\r\n', '\n'),
      ).toBe('Previous task\n');
      await expect(f.w.create({ ...input, reuseExistingBranch: true })).rejects.toThrow(
        'another worktree',
      );
      await f.w.archive(p.id);
      await f.w.removeWorktree(p.id);
      const next = await f.w.create({ ...input, reuseExistingBranch: true });
      await settled(f.w, next.id, 'awaiting_plan');
      expect(f.w.get(next.id).baseCommit).toBe(tip);
    },
    60000,
  );
  it('validates project branch names and reserves names before queued work starts', async () => {
    const f = await fixture();
    f.store.setSetting('concurrency', 0);
    const input = {
      name: 'Custom branch',
      repoId: f.repository.id,
      ticketUrl: 'https://example.test/42',
    };
    for (const branch of ['bad name', '-option', 'feature/../escape', '@{-1}', 'HEAD', 'main']) {
      await expect(f.w.create({ ...input, branch })).rejects.toThrow(/branch/i);
    }
    expect(f.store.all('projects')).toHaveLength(0);
    const first = await f.w.create({ ...input, branch: '  feature/custom-task  ' });
    expect(first.branch).toBe('feature/custom-task');
    await expect(f.w.create({ ...input, branch: first.branch })).rejects.toThrow('reserved');
    const second = await f.w.create({ ...input, branch: 'feature/another-task' });
    expect(second.branch).toBe('feature/another-task');
    expect(f.store.get('repositories', f.repository.id)).toEqual(f.repository);
    const automatic = await f.w.create({ ...input, branch: ' ' });
    expect(automatic.branch).toMatch(/^ai\/custom-branch-/);
  }, 60000);
  it('carries a user-written task through planning, corrections and publication without a URL', async () => {
    const f = await fixture();
    f.repository.autoApprove = true;
    f.store.put('repositories', f.repository);
    const description = 'Add Polish search.\n\nAcceptance: preserve existing filters.';
    const p = await f.w.create({
      name: 'Own task',
      branch: 'feature/own-task',
      repoId: f.repository.id,
      taskSource: 'description',
      taskDescription: description,
      ticketUrl: 'https://ignored.example.test',
    });
    await settled(f.w, p.id, 'awaiting_plan');
    expect(f.w.get(p.id).config.autoApprove).toBe(true);
    expect(f.agent.calls.every((call) => call.stage === 'plan')).toBe(true);
    f.store.put('repositories', { ...f.repository, autoApprove: false });
    expect(f.w.get(p.id).config.autoApprove).toBe(true);
    expect(await f.git.git(['branch', '--show-current'], p.worktree)).toBe('feature/own-task');
    expect(await f.git.git(['rev-parse', 'HEAD'], p.worktree)).toBe(
      await f.git.git(['rev-parse', 'refs/remotes/origin/main'], f.repo),
    );
    expect(f.w.get(p.id).taskDescription).toBe(description);
    expect(f.w.get(p.id).ticketUrl).toBeUndefined();
    expect(f.agent.calls[0].prompt).toContain('do not fetch or request one');
    f.w.revisePlan(p.id, 'Include a regression check for filtering');
    await settled(f.w, p.id, 'awaiting_plan');
    expect(f.agent.calls.at(-1)!.prompt).toContain(description);
    expect(f.agent.calls.at(-1)!.prompt).toContain('Include a regression check for filtering');
    f.w.approvePlan(p.id);
    await settled(f.w, p.id, 'awaiting_result');
    for (const call of f.agent.calls) {
      expect(call.prompt).toContain(description);
      expect(call.prompt).not.toContain('ignored.example.test');
    }
    const review = f.w.get(p.id).review!;
    f.w.correct(p.id, [review.items[0].id], 'Keep the source task intact');
    await settled(f.w, p.id, 'awaiting_result');
    expect(f.w.get(p.id).taskDescription).toBe(description);
    await f.w.approvePublication(p.id);
    const published = await settled(f.w, p.id, 'published');
    const message = await f.git.git(['log', '-1', '--format=%B'], published.worktree);
    expect(message).toContain('Task source: user-provided description');
    expect(message).not.toContain('undefined');
    const body = await readFile(join(p.skillRoot, '..', 'pull-request.md'), 'utf8');
    expect(body).toContain(description);
    expect(body).not.toContain('undefined');
    expect(f.state.ghCreates).toBe(1);
  }, 60000);
  it('isolates two projects, snapshots skills, gates implementation, and performs only selected corrections', async () => {
    const { w, agent, repo, skills, store, create, state, root, git } = await fixture();
    const first = await create(),
      second = await create();
    await settled(w, first.id, 'awaiting_plan');
    await settled(w, second.id, 'awaiting_plan');
    expect(first.worktree).not.toBe(second.worktree);
    expect(first.branch).not.toBe(second.branch);
    expect(first.port).not.toBe(second.port);
    const relocated = new GitService(join(root, 'short-worktrees'), git.runner, [git.root]);
    await expect(relocated.assertWorktree(first)).resolves.toBeUndefined();
    await expect(relocated.assertWorktree({ ...first, worktree: repo })).rejects.toThrow('outside');
    expect(agent.calls.every((c) => c.stage === 'plan')).toBe(true);
    expect(w.active.size).toBe(0);
    const original = await readFile(join(first.skillRoot, 'skills/planner/SKILL.md'), 'utf8');
    await writeFile(join(skills, 'planner/SKILL.md'), 'changed');
    expect(await readFile(join(first.skillRoot, 'skills/planner/SKILL.md'), 'utf8')).toBe(original);
    expect(await readFile(join(first.worktree, '.env'), 'utf8')).toContain('keep-local');
    const terminals = store
      .all<TerminalRecord>('terminals')
      .filter((t) => t.projectId === first.id);
    expect(terminals.map((t) => t.env.PORT)).toEqual([String(first.port), String(first.port + 1)]);
    w.approvePlan(first.id);
    const result = await settled(w, first.id, 'awaiting_result');
    expect(result.tests?.status).toBe('passed');
    expect(w.get(second.id).status).toBe('awaiting_plan');
    expect(await run('git', ['status', '--porcelain'], repo)).toMatchObject({ stdout: '' });
    w.correct(first.id, [result.review!.items[0].id], 'Use a short example.');
    const corrected = await settled(w, first.id, 'awaiting_result');
    expect(corrected.round).toBe(1);
    const impl = agent.calls.filter((c) => c.stage === 'implementation');
    expect(impl).toHaveLength(2);
    expect(impl[1].prompt).toContain('Use a short example.');
    expect(state.ghCreates).toBe(0);
    expect(state.commands.filter((c) => c.includes('setup-command'))).toHaveLength(2);
  }, 60000);
  it('publishes idempotently after failure between commit and PR creation, then safely archives', async () => {
    const { w, git, state, review } = await fixture();
    const p = await review();
    state.failPublish = true;
    await w.approvePublication(p.id);
    const failed = await settled(w, p.id, 'blocked');
    expect(failed.commitSha).toBeTruthy();
    const count = await git.git(['rev-list', '--count', 'HEAD'], p.worktree);
    state.failPublish = false;
    w.enqueue(p.id);
    const published = await settled(w, p.id, 'published');
    expect(published.prUrl).toContain('/pull/1');
    expect(await git.git(['rev-list', '--count', 'HEAD'], p.worktree)).toBe(count);
    expect(await git.git(['ls-files', '.env'], p.worktree)).toBe('');
    await w.archive(p.id);
    await writeFile(join(p.worktree, 'unsaved.txt'), 'keep me');
    await expect(w.removeWorktree(p.id)).rejects.toThrow('uncommitted or untracked');
    expect(await readFile(join(p.worktree, 'unsaved.txt'), 'utf8')).toBe('keep me');
  }, 60000);
  it('finds an existing PR when the create response was lost', async () => {
    const { w, state, review } = await fixture();
    const p = await review();
    state.failAfterCreate = true;
    await w.approvePublication(p.id);
    await settled(w, p.id, 'blocked');
    w.enqueue(p.id);
    await settled(w, p.id, 'published');
    expect(state.ghCreates).toBe(1);
  }, 60000);
  it('invalidates approval when files change after review', async () => {
    const { w, review, state } = await fixture();
    const p = await review();
    await writeFile(join(p.worktree, 'feature.txt'), 'external edit');
    await expect(w.approvePublication(p.id)).rejects.toThrow('Files changed');
    expect(w.get(p.id).stage).toBe('test');
    expect(state.ghCreates).toBe(0);
  }, 60000);

  it('keeps the approval fingerprint stable across staging additions and deletions', async () => {
    const { git, review } = await fixture();
    const p = await review();
    await unlink(join(p.worktree, 'README.md'));
    const before = await git.fingerprint(p);
    await git.git(['add', '--all'], p.worktree);
    expect(await git.fingerprint(p)).toBe(before);
  }, 60000);

  it('refuses to commit a manually staged copied secret', async () => {
    const { w, git, review, state } = await fixture();
    const p = await review();
    await git.git(['add', '--force', '.env'], p.worktree);
    await w.approvePublication(p.id);
    expect((await settled(w, p.id, 'blocked')).error).toContain('copied local file is staged');
    expect(state.ghCreates).toBe(0);
    expect(await git.git(['rev-list', '--count', 'HEAD'], p.worktree)).toBe('1');
  }, 60000);

  it('removes only the managed clean worktree and preserves project history', async () => {
    const { w, git, review, repo } = await fixture();
    const p = await review();
    await w.approvePublication(p.id);
    await settled(w, p.id, 'published');
    await w.archive(p.id);
    await expect(git.remove({ ...p, worktree: repo })).rejects.toThrow('outside');
    await w.removeWorktree(p.id);
    expect(w.get(p.id).worktreeRemoved).toBe(true);
    expect(w.detail(p.id).events.length).toBeGreaterThan(0);
    await expect(access(p.worktree)).rejects.toThrow();
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toContain('Fixture repository');
  }, 60000);
  it('continues to review failed tests, and reports unconfigured tests honestly', async () => {
    const f = await fixture();
    f.state.testFails = true;
    const p = await f.review();
    expect(p.tests?.status).toBe('failed');
    expect(p.review).toBeTruthy();
    f.repository.testCommand = '';
    f.store.put('repositories', f.repository);
    const second = await f.review();
    expect(second.tests?.status).toBe('not_configured');
  }, 60000);
  it('blocks inaccessible tickets, setup failures, and Claude limits without advancing', async () => {
    const f = await fixture();
    f.agent.ticketAccessible = false;
    const p = await f.create();
    const failed = await settled(f.w, p.id, 'blocked');
    expect(failed.error).toContain('Ticket access denied');
    expect(failed.stage).toBe('plan');
    f.agent.ticketAccessible = true;
    f.agent.fail = 'Rate limit reached';
    f.w.enqueue(p.id);
    expect((await settled(f.w, p.id, 'blocked')).error).toContain('Rate limit');
    f.agent.fail = undefined;
    f.state.setupFails = true;
    const second = await f.create();
    expect((await settled(f.w, second.id, 'blocked')).stage).toBe('prepare');
  }, 60000);
  it('honors the queue limit and interrupts a running agent', async () => {
    const f = await fixture();
    f.store.setSetting('concurrency', 1);
    f.agent.hold = true;
    const first = await f.create(),
      second = await f.create();
    expect(f.w.active.size).toBe(1);
    expect(f.w.get(second.id).status).toBe('queued');
    await f.w.stop(second.id);
    expect(f.w.get(second.id).status).toBe('interrupted');
    await f.w.stop(first.id);
    expect(f.w.get(first.id).status).toBe('interrupted');
    f.agent.hold = false;
    f.w.enqueue(first.id);
    await settled(f.w, first.id, 'awaiting_plan');
  }, 60000);
  it('detects unexpected changes during read-only review', async () => {
    const f = await fixture();
    f.agent.mutateReview = true;
    const p = await f.create();
    await settled(f.w, p.id, 'awaiting_plan');
    f.w.approvePlan(p.id);
    expect((await settled(f.w, p.id, 'blocked')).error).toContain('read-only stage');
  }, 60000);
  it('recovers persistent state without restarting work automatically', async () => {
    const f = await fixture();
    const p = await f.create();
    await settled(f.w, p.id, 'awaiting_plan');
    f.w.save({ ...f.w.get(p.id), status: 'running', stage: 'implementation' });
    f.store.put('questions', {
      id: 'old-question',
      projectId: p.id,
      sessionId: 'old-session',
      kind: 'permission',
      tool: 'Bash',
      input: {},
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const recovered = new Workflow(
      f.store,
      f.git,
      f.agent,
      new FakeTerminals(f.store),
      f.root,
      f.skills,
      f.w.runner,
    );
    expect(recovered.get(p.id).status).toBe('interrupted');
    expect(recovered.active.size).toBe(0);
    expect(f.store.get<Question>('questions', 'old-question')?.status).toBe('expired');
    expect(recovered.detail(p.id).events.length).toBeGreaterThan(0);
    expect(f.store.all<TerminalRecord>('terminals').every((t) => t.status === 'interrupted')).toBe(
      true,
    );
  }, 60000);
});

describe('Local API and user input', () => {
  it('removes a repository without deleting files or breaking its existing projects', async () => {
    const f = await fixture();
    const p = await f.create();
    await settled(f.w, p.id, 'awaiting_plan');
    const app = await createApp(f.w);
    cleanups.push(async () => {
      await app.close();
    });
    const headers = { host: '127.0.0.1:4317' };
    const { token } = (await app.inject({ url: '/api/bootstrap', headers })).json();
    const url = `/api/repositories/${f.repository.id}`;
    expect((await app.inject({ url, method: 'DELETE', headers })).statusCode).toBe(401);
    const auth = { ...headers, 'x-session-token': token };
    expect((await app.inject({ url, method: 'DELETE', headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ url, method: 'DELETE', headers: auth })).statusCode).toBe(200);
    expect((await f.w.snapshot()).repositories).toHaveLength(0);
    expect(
      f.store.get<{ removedAt: string }>('repositories', f.repository.id)?.removedAt,
    ).toBeTruthy();
    await expect(f.create()).rejects.toThrow('Repository not found');
    await expect(f.w.repository(f.repository, f.repository.id)).rejects.toThrow(
      'Repository not found',
    );
    expect(await readFile(join(f.repo, 'README.md'), 'utf8')).toBe('Fixture repository\n');
    expect(f.w.detail(p.id).sessions).toBeDefined();
    await access(join(p.worktree, 'README.md'));
    f.w.approvePlan(p.id);
    await settled(f.w, p.id, 'awaiting_result');
    const readded = await f.w.repository(f.repository);
    expect(readded.id).not.toBe(f.repository.id);
    expect((await f.w.snapshot()).repositories).toHaveLength(1);
    expect(f.w.detail(p.id).project.repoId).toBe(f.repository.id);
  }, 60000);
  it('requires a session token and rejects foreign origins and Host headers', async () => {
    const f = await fixture();
    const app = await createApp(f.w);
    cleanups.push(async () => {
      await app.close();
    });
    const headers = { host: '127.0.0.1:4317' };
    expect((await app.inject({ url: '/api/snapshot', headers })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/bootstrap',
          headers: { ...headers, origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/bootstrap', headers: { host: 'evil.example' } })).statusCode,
    ).toBe(403);
    const response = await app.inject({ url: '/api/bootstrap', headers });
    const { token } = response.json();
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    const auth = { ...headers, 'x-session-token': token };
    expect((await app.inject({ url: '/api/snapshot', headers: auth })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/settings',
          method: 'PUT',
          headers: auth,
          payload: { concurrency: 0 },
        })
      ).statusCode,
    ).toBe(400);
    const p = await f.create();
    await settled(f.w, p.id, 'awaiting_plan');
    const detail = (await app.inject({ url: `/api/projects/${p.id}`, headers: auth })).json();
    expect(detail.project.plan).toContain('feature.txt');
    const detection = await app.inject({
      url: '/api/repositories/detect',
      method: 'POST',
      headers: auth,
      payload: { path: p.config.path },
    });
    expect(detection.statusCode).toBe(200);
    expect(f.w.get(p.id).config.setupCommand).toBe('setup-command');
    expect(
      (
        await app.inject({
          url: `/api/projects/${p.id}/budget`,
          method: 'PUT',
          headers: auth,
          payload: { budgetUsd: -1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/api/projects/${p.id}/budget`,
          method: 'PUT',
          headers: auth,
          payload: { budgetUsd: 0 },
        })
      ).statusCode,
    ).toBe(200);
    const approve = await app.inject({
      url: `/api/projects/${p.id}/actions/approve-plan`,
      method: 'POST',
      headers: auth,
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect((await settled(f.w, p.id, 'blocked')).error).toContain('spending limit');
    expect(f.agent.calls.filter((c) => c.stage === 'implementation')).toHaveLength(0);
    await app.inject({
      url: `/api/projects/${p.id}/budget`,
      method: 'PUT',
      headers: auth,
      payload: { budgetUsd: null },
    });
    f.w.enqueue(p.id);
    await settled(f.w, p.id, 'awaiting_result');
  }, 60000);
  it('round-trips permissions, answers and interruption through the driver without a model call', async () => {
    const f = await fixture();
    const project = await f.create();
    await settled(f.w, project.id, 'awaiting_plan');
    const driver = new ClaudeDriver(f.store);
    const controller = new AbortController();
    const session: Session = {
      id: randomUUID(),
      projectId: project.id,
      stage: 'plan',
      createdAt: new Date().toISOString(),
    };
    const denied = driver.permission(
      project,
      session,
      'Bash',
      { command: 'gh issue view 42' },
      controller.signal,
    );
    const q = f.store.all<Question>('questions').at(-1)!;
    driver.answer(q.id, { allow: false });
    expect((await denied).behavior).toBe('deny');
    const asked = driver.permission(
      project,
      session,
      'AskUserQuestion',
      { questions: [{ question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }] }] },
      controller.signal,
    );
    const question = f.store.all<Question>('questions').at(-1)!;
    expect(() => driver.answer(question.id, { answers: {} })).toThrow('Answer every question');
    driver.answer(question.id, { answers: { 'Which option?': 'A' } });
    expect(await asked).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Which option?': 'A' } },
    });
    const aborted = driver.permission(
      project,
      session,
      'Bash',
      { command: 'test' },
      controller.signal,
    );
    controller.abort();
    expect((await aborted).behavior).toBe('deny');
  }, 60000);
  it('rejects invalid skills and unsafe copy paths before a workspace is created', async () => {
    const f = await fixture();
    await writeFile(join(f.skills, 'planner', 'SKILL.md'), 'Missing frontmatter');
    expect((await scanSkills(f.skills)).find((s) => s.id === 'planner')?.valid).toBe(false);
    await expect(f.create()).rejects.toThrow('Invalid skill');
    expect(() => f.git.localPath(f.repo, '../secret')).toThrow('Unsafe');
    expect(() => f.git.localPath(f.repo, '.git/config')).toThrow('Unsafe');
    expect(() => f.git.localPath(f.repo, 'C:\outside.txt')).toThrow('Unsafe');
  }, 60000);
});

it('adds, lists and revokes repository prefixes through authenticated API', async () => {
  const f = await fixture();
  const app = await createApp(f.w);
  cleanups.push(async () => {
    await app.close();
  });
  const headers = { host: '127.0.0.1:4317' };
  const { token } = (await app.inject({ url: '/api/bootstrap', headers })).json();
  const auth = { ...headers, 'x-session-token': token };
  const url = '/api/repositories/' + f.repository.id + '/permissions';
  expect(
    (await app.inject({ url, method: 'POST', headers, payload: { tool: 'Bash', prefix: 'grep' } }))
      .statusCode,
  ).toBe(401);
  const added = await app.inject({
    url,
    method: 'POST',
    headers: auth,
    payload: { tool: 'Bash', prefix: 'grep' },
  });
  expect(added.statusCode).toBe(200);
  const permission = added.json();
  expect(permission).toMatchObject({ scope: 'prefix', prefix: 'grep' });
  expect(
    (
      await app.inject({
        url,
        method: 'POST',
        headers: auth,
        payload: { tool: 'Bash', prefix: 'grep' },
      })
    ).json().id,
  ).toBe(permission.id);
  expect((await app.inject({ url, headers: auth })).json()).toHaveLength(1);
  expect(
    (
      await app.inject({
        url,
        method: 'POST',
        headers: auth,
        payload: { tool: 'Bash', prefix: 'grep; whoami' },
      })
    ).statusCode,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (
      await app.inject({
        url,
        method: 'POST',
        headers: auth,
        payload: { tool: 'Bash', prefix: 'git push' },
      })
    ).statusCode,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (
      await app.inject({
        url: '/api/repositories/wrong/permissions/' + permission.id,
        method: 'DELETE',
        headers: auth,
      })
    ).statusCode,
  ).toBeGreaterThanOrEqual(400);
  expect(
    (await app.inject({ url: url + '/' + permission.id, method: 'DELETE', headers: auth }))
      .statusCode,
  ).toBe(200);
  expect((await app.inject({ url, headers: auth })).json()).toEqual([]);
}, 60000);
