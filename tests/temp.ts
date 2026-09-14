import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll } from 'vitest';

const roots: string[] = [];
// Never nest Git fixtures in a managed worktree: Git's temporary object paths
// can exceed MAX_PATH on Windows even when the repository itself fits.
export async function testDirectory() {
  const parent = process.env.AI_NATIVE_TEST_TEMP
    ? resolve(process.env.AI_NATIVE_TEST_TEMP)
    : tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'anw-'));
  roots.push(root);
  return root;
}
afterAll(async () => {
  for (const root of roots)
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
