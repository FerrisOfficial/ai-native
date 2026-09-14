import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import type { Project, TerminalRecord } from '../shared/types.js';
import { Store } from './store.js';

export class Terminals {
  active = new Map<string, pty.IPty>();
  stopping = new Map<string, Promise<void>>();
  removing = new Set<string>();
  constructor(public store: Store) {}
  start(
    project: Project,
    spec: { name: string; command: string; env: Record<string, string> },
    existingId?: string,
  ) {
    if (project.worktreeRemoved) throw new Error('Worktree has been removed');
    if (
      existingId &&
      (this.removing.has(existingId) ||
        this.stopping.has(existingId) ||
        this.store.get<TerminalRecord>('terminals', existingId)?.removedAt)
    )
      throw new Error('Terminal is stopping or has been removed');
    const record: TerminalRecord = {
      id: existingId ?? randomUUID(),
      projectId: project.id,
      name: spec.name,
      command: spec.command,
      env: spec.env,
      status: 'running',
      output: existingId
        ? (this.store.get<TerminalRecord>('terminals', existingId)?.output ?? '') +
          '\r\n--- restarted ---\r\n'
        : '',
      createdAt: new Date().toISOString(),
    };
    if (this.active.has(record.id)) throw new Error('Terminal is already running');
    // Let PowerShell initialize its own module paths instead of inheriting the
    // host IDE's bundled modules. A repository may still explicitly override it.
    const inherited = { ...process.env };
    for (const key of Object.keys(inherited))
      if (key.toUpperCase() === 'PSMODULEPATH') delete inherited[key];
    const env = Object.fromEntries(
      Object.entries({
        ...inherited,
        PORT: String(project.port),
        ...spec.env,
        AI_NATIVE_PROJECT_ID: project.id,
        AI_NATIVE_WORKTREE: project.worktree,
      }).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
    );
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args =
      process.platform === 'win32'
        ? [
            '-NoLogo',
            '-NoProfile',
            '-NoExit',
            ...(spec.command.trim() ? ['-Command', spec.command] : []),
          ]
        : [];
    const terminal = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd: project.worktree,
      env,
      cols: 110,
      rows: 28,
      useConptyDll: process.platform === 'win32',
    });
    this.active.set(record.id, terminal);
    this.store.put('terminals', record);
    this.store.event('terminal_changed', { id: record.id }, project.id);
    terminal.onData((data) => {
      const current = this.store.get<TerminalRecord>('terminals', record.id)!;
      current.output = (current.output + data).slice(-2_000_000);
      this.store.put('terminals', current);
      this.store.bus.emit('live', {
        kind: 'terminal_data',
        projectId: project.id,
        terminalId: record.id,
        text: data,
      });
    });
    terminal.onExit(({ exitCode }) => {
      this.active.delete(record.id);
      const current = this.store.get<TerminalRecord>('terminals', record.id)!;
      this.store.put('terminals', { ...current, status: 'exited', exitCode });
      this.store.event('terminal_changed', { id: record.id }, project.id);
    });
    if (process.platform !== 'win32' && spec.command) terminal.write(`${spec.command}\r`);
    return record;
  }
  input(id: string, text: string) {
    const t = this.active.get(id);
    if (!t) throw new Error('Terminal is not running');
    t.write(text);
  }
  resize(id: string, cols: number, rows: number) {
    this.active
      .get(id)
      ?.resize(Math.max(20, Math.min(500, cols)), Math.max(5, Math.min(200, rows)));
  }
  stop(id: string): Promise<void> {
    const pending = this.stopping.get(id);
    if (pending) return pending;
    const terminal = this.active.get(id);
    if (!terminal) return Promise.resolve();
    const stopped = new Promise<void>((resolve, reject) => {
      const listener = terminal.onExit(() => {
        clearTimeout(timer);
        listener.dispose();
        resolve();
      });
      const timer = setTimeout(() => {
        listener.dispose();
        reject(new Error('Terminal did not stop within five seconds'));
      }, 5000);
      try {
        terminal.kill();
      } catch (error) {
        clearTimeout(timer);
        listener.dispose();
        reject(error);
      }
    }).finally(() => {
      this.stopping.delete(id);
    });
    this.stopping.set(id, stopped);
    return stopped;
  }
  async stopProject(id: string) {
    await Promise.all(
      this.store
        .all<TerminalRecord>('terminals')
        .filter((t) => t.projectId === id)
        .map((t) => this.stop(t.id)),
    );
  }
  async remove(id: string) {
    const record = this.store.get<TerminalRecord>('terminals', id);
    if (!record) throw new Error('Terminal not found');
    if (record.removedAt) return;
    if (this.removing.has(id)) throw new Error('Terminal removal is in progress');
    this.removing.add(id);
    try {
      await this.stop(id);
      const current = this.store.get<TerminalRecord>('terminals', id)!;
      this.store.put('terminals', { ...current, removedAt: new Date().toISOString() });
      this.store.event('terminal_removed', { id }, record.projectId);
    } finally {
      this.removing.delete(id);
    }
  }
  async close() {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
  }
}
