import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  command,
  prepareUpdate,
  applyUpdate,
  type UpdateCommand,
} from '../scripts/update-runtime.mjs';
import { AppUpdater } from '../server/updater.js';
import { startEngine } from '../server/engine.js';
import type { Project } from '../shared/types.js';
import { testDirectory } from './temp.js';

async function fixture(initialize?: (source: string) => Promise<void>) {
  const root = await testDirectory();
  const source = join(root, 'source');
  const app = join(root, 'app');
  const remote = join(root, 'remote.git');
  await mkdir(source);
  const git = (cwd: string, ...args: string[]) => command('git', args, cwd);
  await git(source, 'init', '--initial-branch=main');
  await git(source, 'config', 'user.name', 'Updater Test');
  await git(source, 'config', 'user.email', 'updater@example.test');
  await git(source, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(source, 'version.txt'), 'old');
  await initialize?.(source);
  await git(source, 'add', '.');
  await git(source, 'commit', '-m', 'Initial');
  await git(root, 'clone', '--bare', source, remote);
  await git(root, 'clone', remote, app);
  await git(source, 'remote', 'add', 'origin', remote);
  const before = await git(app, 'rev-parse', 'HEAD');
  await writeFile(join(source, 'version.txt'), 'new');
  await git(source, 'add', '.');
  await git(source, 'commit', '-m', 'Update');
  await git(source, 'push', 'origin', 'main');
  const target = await git(source, 'rev-parse', 'HEAD');
  // Only replace the remote identity check; fetch/merge/history use real local Git.
  const run: UpdateCommand = (exe, args, cwd) =>
    args.join(' ') === 'remote get-url origin'
      ? Promise.resolve('https://github.com/FerrisOfficial/ai-native.git')
      : command(exe, args, cwd);
  return { root, source, app, remote, before, target, git, run };
}

describe('application update Git safety', () => {
  it('fetches the default branch, fast-forwards to the pinned commit, then detects up-to-date', async () => {
    const f = await fixture();
    const plan = await prepareUpdate(f.app, f.run);
    expect(plan).toEqual({ before: f.before, target: f.target, branch: 'main' });
    expect(await readFile(join(f.app, 'version.txt'), 'utf8')).toBe('old');
    await applyUpdate(f.app, plan, f.run);
    expect(await readFile(join(f.app, 'version.txt'), 'utf8')).toBe('new');
    const current = await prepareUpdate(f.app, f.run);
    expect(current.before).toBe(current.target);
  }, 20000);

  it('rejects foreign origins, local edits, untracked files and feature branches', async () => {
    const f = await fixture();
    await expect(prepareUpdate(f.app)).rejects.toThrow('origin must point');
    await writeFile(join(f.app, 'version.txt'), 'my work');
    await expect(prepareUpdate(f.app, f.run)).rejects.toThrow('local changes');
    expect(await readFile(join(f.app, 'version.txt'), 'utf8')).toBe('my work');
    await writeFile(join(f.app, 'version.txt'), 'old');
    await writeFile(join(f.app, 'untracked.txt'), 'valuable');
    await expect(prepareUpdate(f.app, f.run)).rejects.toThrow('local changes');
    await f.git(f.app, 'add', 'untracked.txt');
    await f.git(
      f.app,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Local work',
    );
    await expect(prepareUpdate(f.app, f.run)).rejects.toThrow('local commits or diverged');
    await f.git(f.app, 'switch', '-c', 'feature');
    await expect(prepareUpdate(f.app, f.run)).rejects.toThrow(
      'Switch the application checkout to main',
    );
  }, 20000);

  it('rechecks local changes and branch before touching the checkout', async () => {
    const f = await fixture();
    const plan = await prepareUpdate(f.app, f.run);
    await writeFile(join(f.app, 'version.txt'), 'work created during fetch');
    await expect(applyUpdate(f.app, plan, f.run)).rejects.toThrow('checkout changed');
    expect(await f.git(f.app, 'rev-parse', 'HEAD')).toBe(f.before);
    await writeFile(join(f.app, 'version.txt'), 'old');
    await f.git(f.app, 'switch', '-c', 'other');
    await expect(applyUpdate(f.app, plan, f.run)).rejects.toThrow('checkout changed');
  }, 20000);
});

it.each(['success', 'ci', 'build', 'restart'])(
  'runs the launcher update lifecycle and exposes the %s result',
  async (failure) => {
    const f = await fixture(async (source) => {
      await mkdir(join(source, 'scripts'));
      await mkdir(join(source, 'server'));
      for (const name of ['start.mjs', 'update-runtime.mjs'])
        await copyFile(resolve('scripts', name), join(source, 'scripts', name));
      await writeFile(join(source, '.gitignore'), 'node_modules/\n*.log\n');
      await writeFile(join(source, 'package.json'), '{"type":"module"}');
      await writeFile(
        join(source, 'server/index.ts'),
        `
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const result=process.env.AI_NATIVE_UPDATE_RESULT ? JSON.parse(process.env.AI_NATIVE_UPDATE_RESULT) : null;
if(result && process.env.FIXTURE_FAIL === 'restart') process.exit(1);
const server=createServer((req,res)=>{
  if(req.url === '/trigger'){
    process.send({type:'update',id:'test-update',plan:JSON.parse(process.env.FIXTURE_PLAN)});
    res.end('started');
  } else {
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(result || {status:'ready',version:readFileSync('version.txt','utf8')}));
  }
});
server.listen(Number(process.env.PORT),'127.0.0.1',()=>process.send({type:'ready'}));
const close=()=>server.close(()=>process.exit(0));
process.on('message',msg=>{if(msg.type==='shutdown')close();});
process.on('disconnect',close);
`,
      );
      await writeFile(
        join(source, 'fake-npm.mjs'),
        `
import { appendFileSync } from 'node:fs';
const phase=process.argv[2]==='ci'?'ci':'build';
appendFileSync('npm-events.log',phase+'\\n');
console.log('fixture npm '+phase);
await new Promise(resolve=>setTimeout(resolve,300));
if(process.env.FIXTURE_FAIL===phase){console.error('fixture '+phase+' failed');process.exit(1);}
`,
      );
    });
    // The fixture server is plain JS in a .ts file; native Node runs it without a real SDK.
    await mkdir(join(f.app, 'node_modules/tsx'), { recursive: true });
    await writeFile(
      join(f.app, 'node_modules/tsx/package.json'),
      '{"type":"module","exports":"./index.mjs"}',
    );
    await writeFile(join(f.app, 'node_modules/tsx/index.mjs'), 'export {};');
    await prepareUpdate(f.app, f.run);
    const reserved = createServer();
    reserved.listen(0, '127.0.0.1');
    await once(reserved, 'listening');
    const port = (reserved.address() as { port: number }).port;
    await new Promise<void>((resolve) => reserved.close(() => resolve()));
    const launcher = spawn(process.execPath, [join(f.app, 'scripts/start.mjs')], {
      cwd: f.app,
      windowsHide: true,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'),
        ),
        PORT: String(port),
        npm_execpath: join(f.app, 'fake-npm.mjs'),
        FIXTURE_FAIL: failure,
        FIXTURE_PLAN: JSON.stringify({ before: f.before, target: f.target, branch: 'main' }),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    launcher.stdout!.on('data', (data) => {
      output += data;
    });
    launcher.stderr!.on('data', (data) => {
      output += data;
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      await vi.waitFor(
        async () => {
          expect((await (await fetch(base)).json()).status).toBe('ready');
        },
        { timeout: 10000 },
      );
      await fetch(base + '/trigger');
      let result: { status: string; message?: string; offline?: boolean; revision?: string };
      await vi.waitFor(
        async () => {
          const response = await fetch(base + '/update-status?key=test-update&json=1');
          result = await response.json();
          expect(result.status, output).toBe(failure === 'success' ? 'updated' : 'error');
        },
        { timeout: 20000 },
      );
      expect(await f.git(f.app, 'rev-parse', 'HEAD')).toBe(f.target);
      const events = await readFile(join(f.app, 'npm-events.log'), 'utf8');
      expect(events).toBe(failure === 'ci' ? 'ci\n' : 'ci\nbuild\n');
      if (failure === 'success') expect(result!.revision).toBe(f.target);
      else {
        expect(result!.offline).toBe(true);
        expect(result!.message).toContain('Update failed');
        const wrongKey = await fetch(base + '/update-status?key=wrong&json=1');
        expect(wrongKey.status).toBe(503);
      }
    } finally {
      if (launcher.exitCode === null && launcher.pid) {
        const exited = once(launcher, 'exit');
        launcher.send({ type: 'shutdown' });
        await exited;
      }
    }
  },
  40000,
);

it('does not restart an up-to-date installation and reports fetch errors', async () => {
  const launch = vi.fn();
  const updater = new AppUpdater(launch, async () => ({
    before: 'a',
    target: 'a',
    branch: 'main',
  }));
  updater.start();
  await vi.waitFor(() => expect(updater.state.status).toBe('current'));
  expect(launch).not.toHaveBeenCalled();
  const failed = new AppUpdater(launch, async () => {
    throw new Error('GitHub unavailable');
  });
  failed.start();
  await vi.waitFor(() => expect(failed.state.message).toBe('GitHub unavailable'));
  expect(failed.busy).toBe(false);
  expect(launch).not.toHaveBeenCalled();
});

it('authenticates update requests, protects active work and locks mutations during updates', async () => {
  let finish!: (plan: { before: string; target: string; branch: string }) => void;
  const launch = vi.fn();
  const updater = new AppUpdater(
    launch,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const engine = await startEngine({ dataRoot: await testDirectory(), port: 0, updater });
  const headers = { host: '127.0.0.1:0', origin: 'http://127.0.0.1:0' };
  const app = engine.app;
  try {
    expect(
      (await app.inject({ method: 'POST', url: '/api/app-update', headers, payload: {} }))
        .statusCode,
    ).toBe(401);
    const { token } = (await app.inject({ url: '/api/bootstrap', headers })).json();
    const auth = { ...headers, 'x-session-token': token };
    engine.workflow.store.put('projects', { id: 'active', status: 'running' });
    expect(
      (
        await app.inject({ method: 'POST', url: '/api/app-update', headers: auth, payload: {} })
      ).json().error,
    ).toContain('Pause');
    engine.workflow.store.put('projects', { id: 'active', status: 'queued' });
    expect(
      (await app.inject({ method: 'POST', url: '/api/app-update', headers: auth, payload: {} }))
        .statusCode,
    ).toBe(409);
    engine.workflow.store.put('projects', { id: 'active', status: 'awaiting_plan' } as Project);
    engine.workflow.terminals.active.set('test', {} as never);
    expect(
      (
        await app.inject({ method: 'POST', url: '/api/app-update', headers: auth, payload: {} })
      ).json().error,
    ).toContain('terminals');
    engine.workflow.terminals.active.clear();
    const response = await app.inject({
      method: 'POST',
      url: '/api/app-update',
      headers: auth,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/app-update', headers: auth, payload: {} }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/settings',
          headers: auth,
          payload: { concurrency: 3 },
        })
      ).statusCode,
    ).toBe(409);
    expect((await app.inject({ url: '/api/app-update', headers: auth })).json().status).toBe(
      'checking',
    );
    expect((await app.inject({ url: '/update-status?key=wrong', headers })).statusCode).toBe(404);
    expect((await app.inject({ url: response.json().url, headers })).body).toContain(
      'Updating AI Native',
    );
    finish({ before: 'old', target: 'new', branch: 'main' });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  } finally {
    engine.workflow.terminals.active.clear();
    await engine.close();
  }
});
