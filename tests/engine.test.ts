import { it, expect } from 'vitest';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { testDirectory } from './temp.js';
import { Store } from '../server/store.js';
import { startEngine } from '../server/engine.js';
import { acquireEngineLock } from '../server/engine-lock.js';
import type { Project, Run, Question, TerminalRecord } from '../shared/types.js';

function seed(root: string) {
  const store = new Store(join(root, 'workflow.sqlite'));
  store.put('projects', { id: 'p', status: 'running' });
  store.put('runs', { id: 'r', status: 'running' });
  store.put('questions', { id: 'q', status: 'pending' });
  store.put('terminals', { id: 't', status: 'running' });
  store.close();
}
function states(root: string) {
  const store = new Store(join(root, 'workflow.sqlite'));
  try {
    return [
      store.get<Project>('projects', 'p')?.status,
      store.get<Run>('runs', 'r')?.status,
      store.get<Question>('questions', 'q')?.status,
      store.get<TerminalRecord>('terminals', 't')?.status,
    ];
  } finally {
    store.close();
  }
}

it('does not recover records when its port is occupied; releases its lock for retry', async () => {
  const root = await testDirectory();
  seed(root);
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const port = (occupied.address() as { port: number }).port;
  try {
    await expect(startEngine({ dataRoot: root, port })).rejects.toThrow('EADDRINUSE');
    expect(states(root)).toEqual(['running', 'running', 'pending', 'running']);
    const release = acquireEngineLock(root);
    release();
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
  const engine = await startEngine({ dataRoot: root, port });
  try {
    expect(states(root)).toEqual(['interrupted', 'interrupted', 'expired', 'interrupted']);
  } finally {
    await engine.close();
  }
});

it('rejects a second engine before recovery and permits separate data directories', async () => {
  const root = await testDirectory();
  const other = await testDirectory();
  const first = await startEngine({ dataRoot: root, port: 0 });
  try {
    first.workflow.store.put('projects', { id: 'p', status: 'running' });
    await expect(startEngine({ dataRoot: root, port: 0 })).rejects.toThrow('engine lock');
    expect(first.workflow.store.get<Project>('projects', 'p')?.status).toBe('running');
    const independent = await startEngine({ dataRoot: other, port: 0 });
    await independent.close();
  } finally {
    await first.close();
  }
});

it('releases the OS lock after a child process dies without cleanup', async () => {
  const root = await testDirectory();
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN EXCLUSIVE'); console.log('locked'); setInterval(() => {}, 1000);`,
      join(root, 'engine-lock.sqlite'),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  try {
    await once(child.stdout!, 'data');
    expect(() => acquireEngineLock(root)).toThrow('engine lock');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  const release = acquireEngineLock(root);
  release();
  release();
}, 15000);
