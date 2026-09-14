import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import type { WorkflowEvent } from '../shared/types.js';

const tables = [
  'repositories',
  'projects',
  'runs',
  'sessions',
  'terminals',
  'questions',
  'approvals',
] as const;
type Table = (typeof tables)[number];
export class Store {
  db: DatabaseSync;
  bus = new EventEmitter();
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    for (const table of tables)
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, projectId TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_project ON events(projectId, seq); CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL); PRAGMA user_version=1;',
    );
  }
  all<T>(table: Table): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  get<T>(table: Table, id: string): T | undefined {
    const r = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return r ? JSON.parse(r.data as string) : undefined;
  }
  put<T extends { id: string }>(table: Table, value: T): T {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  setting<T>(id: string, fallback: T): T {
    const r = this.db.prepare('SELECT data FROM settings WHERE id=?').get(id);
    return r ? JSON.parse(r.data as string) : fallback;
  }
  setSetting(id: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(id, JSON.stringify(value));
  }
  event(kind: string, data: unknown, projectId?: string): WorkflowEvent {
    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare('INSERT INTO events(projectId,kind,data,createdAt) VALUES (?,?,?,?)')
      .run(projectId ?? null, kind, JSON.stringify(data), createdAt);
    const event = { seq: Number(result.lastInsertRowid), projectId, kind, data, createdAt };
    this.bus.emit('event', event);
    return event;
  }
  events(projectId?: string, after = 0, limit = 500): WorkflowEvent[] {
    const rows = projectId
      ? this.db
          .prepare('SELECT * FROM events WHERE projectId=? AND seq>? ORDER BY seq LIMIT ?')
          .all(projectId, after, limit)
      : this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after, limit);
    return rows.map((r) => ({
      seq: Number(r.seq),
      projectId: r.projectId as string | undefined,
      kind: r.kind as string,
      data: JSON.parse(r.data as string),
      createdAt: r.createdAt as string,
    }));
  }
  close() {
    this.db.close();
  }
}
