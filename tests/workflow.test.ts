import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
import type { Project, Question, Session, TerminalRecord } from '../shared/types.js';

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
      return { summary: 'Added a feature.' };
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
  const testsRoot = resolve('.data/tests');
  await mkdir(testsRoot, { recursive: true });
  const root = await mkdtemp(join(testsRoot, 'workflow-'));
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

describe('Workflow lifecycle with real Git and deterministic Claude', () => {
  it('isolates two projects, snapshots skills, gates implementation, and performs only selected corrections', async () => {
    const { w, agent, repo, skills, store, create, state } = await fixture();
    const first = await create(),
      second = await create();
    await settled(w, first.id, 'awaiting_plan');
    await settled(w, second.id, 'awaiting_plan');
    expect(first.worktree).not.toBe(second.worktree);
    expect(first.branch).not.toBe(second.branch);
    expect(first.port).not.toBe(second.port);
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
