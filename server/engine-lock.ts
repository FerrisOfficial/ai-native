import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// OS-backed lock: crashes release it, with no PID reuse or stale-file deletion
// race. This separate database must never be deleted while an engine is running.
export function acquireEngineLock(dataRoot: string): () => void {
  const lock = new DatabaseSync(join(dataRoot, 'engine-lock.sqlite'));
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
  } catch (error) {
    lock.close();
    throw new Error(
      `Cannot acquire engine lock for ${dataRoot}. Another engine may already be using this data directory.`,
      { cause: error },
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.close();
  };
}
