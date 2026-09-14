import { it, expect } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Store } from '../server/store.js';
import { Terminals } from '../server/terminals.js';
import type { Project, TerminalRecord } from '../shared/types.js';

it('runs an actual interactive shell, preserves output and waits for termination', async () => {
  const parent = resolve('.data/tests');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'terminal-'));
  const store = new Store(join(dir, 'terminal.sqlite'));
  const terminals = new Terminals(store);
  const p = { id: 'pty-test', worktree: dir, port: 5790 } as Project;
  try {
    const t = terminals.start(p, {
      name: 'Test shell',
      command: process.platform === 'win32' ? "Write-Output 'PTY_READY'" : "printf 'PTY_READY\\n'",
      env: {},
    });
    const waitOutput = async (text: string) => {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (store.get<TerminalRecord>('terminals', t.id)?.output.includes(text)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(
        `Missing ${text}; actual output: ${store.get<TerminalRecord>('terminals', t.id)?.output}`,
      );
    };
    await waitOutput('PTY_READY');
    terminals.input(
      t.id,
      process.platform === 'win32'
        ? "Write-Output ('INTERACTIVE_' + 'OK')\r"
        : "printf 'INTERACTIVE_%s\\n' OK\r",
    );
    await waitOutput('INTERACTIVE_OK');
    terminals.resize(t.id, 90, 25);
    await terminals.stop(t.id);
    expect(terminals.active.has(t.id)).toBe(false);
    expect(store.get<TerminalRecord>('terminals', t.id)?.status).toBe('exited');
    expect(store.get<TerminalRecord>('terminals', t.id)?.output).toContain('INTERACTIVE_OK');
  } finally {
    await terminals.close();
    store.close();
  }
}, 30000);
