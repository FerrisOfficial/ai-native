import { mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { acquireEngineLock } from './engine-lock.js';
import { Store } from './store.js';
import { GitService } from './git.js';
import { ClaudeDriver } from './claude.js';
import { Terminals } from './terminals.js';
import { Workflow } from './workflow.js';
import { createApp } from './app.js';

export async function startEngine(options: {
  dataRoot: string;
  port: number;
  worktreesRoot?: string;
  skillsRoot?: string;
  uiDir?: string;
}) {
  await mkdir(options.dataRoot, { recursive: true });
  // Preserve configured paths in existing project snapshots, while locking the
  // canonical directory so aliases cannot create independent engine locks.
  const dataRoot = resolve(options.dataRoot);
  const release = acquireEngineLock(await realpath(dataRoot));
  let store: Store | undefined;
  let workflow: Workflow | undefined;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        await workflow?.close();
      } finally {
        try {
          await app?.close();
        } finally {
          try {
            store?.close();
          } finally {
            release();
          }
        }
      }
    })());
  try {
    store = new Store(join(dataRoot, 'workflow.sqlite'));
    const defaultRoot = join(dataRoot, 'worktrees');
    const git = new GitService(
      options.worktreesRoot ? resolve(options.worktreesRoot) : defaultRoot,
      undefined,
      [defaultRoot],
    );
    workflow = new Workflow(
      store,
      git,
      new ClaudeDriver(store),
      new Terminals(store),
      dataRoot,
      options.skillsRoot ?? resolve('skills'),
      undefined,
      { deferRecovery: true },
    );
    app = await createApp(workflow, { port: options.port, uiDir: options.uiDir });
    let ready = false;
    app.addHook('onRequest', async (_request, reply) => {
      if (!ready) return reply.code(503).send({ error: 'The local engine is starting.' });
    });
    // Only recover after binding: EADDRINUSE must not interrupt stored records.
    await app.listen({ host: '127.0.0.1', port: options.port });
    workflow.recover();
    ready = true;
    return { app, workflow, dataRoot, close };
  } catch (error) {
    await close();
    throw error;
  }
}
