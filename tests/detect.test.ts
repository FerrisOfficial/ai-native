import { it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { detectRepository } from '../server/detect.js';

async function fixture(files: Record<string, string>) {
  await mkdir(resolve('.data/tests'), { recursive: true });
  const root = await mkdtemp(resolve('.data/tests/detect-'));
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return root;
}
it('proposes npm/Vite commands without executing package scripts', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({
      scripts: { dev: 'vite', test: 'vitest', postinstall: 'touch SHOULD_NOT_EXIST' },
      dependencies: { react: '*' },
    }),
    'package-lock.json': '{}',
  });
  const result = await detectRepository(root);
  expect(result.setupCommand).toBe('npm ci');
  expect(result.testCommand).toBe('npm run test -- --run');
  expect(result.terminals[0].command).toBe('npm run dev -- --host 127.0.0.1 --port $env:PORT');
  expect(result.detected).toContain('React');
  await expect(access(join(root, 'SHOULD_NOT_EXIST'))).rejects.toThrow();
});
it('handles pnpm/Next and conflicting lockfiles conservatively', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({
      packageManager: 'pnpm@10',
      scripts: { dev: 'next dev', test: 'echo "Error: no test specified" && exit 1' },
    }),
    'pnpm-lock.yaml': '',
  });
  const result = await detectRepository(root);
  expect(result.setupCommand).toBe('pnpm install --frozen-lockfile');
  expect(result.testCommand).toBe('');
  expect(result.terminals[0].command).toContain(
    'pnpm run dev --hostname 127.0.0.1 --port $env:PORT',
  );
  await writeFile(join(root, 'yarn.lock'), '');
  const ambiguous = await detectRepository(root);
  expect(ambiguous.setupCommand).toBe('');
  expect(ambiguous.warnings.join(' ')).toContain('Conflicting');
});
it('recognizes static sites and supported non-Node manifests; preserves unknowns', async () => {
  const site = await detectRepository(
    await fixture({ 'index.html': '<html></html>', 'script.js': '' }),
  );
  expect(site.setupCommand).toBe('');
  expect(site.testCommand).toBe('node --check script.js');
  expect(site.terminals[0].command).toContain('$env:PORT');
  expect((await detectRepository(await fixture({ 'Cargo.toml': '' }))).testCommand).toBe(
    'cargo test',
  );
  expect((await detectRepository(await fixture({ 'go.mod': '' }))).testCommand).toBe(
    'go test ./...',
  );
  expect(
    (
      await detectRepository(
        await fixture({ 'pyproject.toml': '[dependency-groups]\ndev=["pytest"]', 'uv.lock': '' }),
      )
    ).testCommand,
  ).toBe('uv run pytest');
  expect((await detectRepository(await fixture({}))).testCommand).toBe('');
  await expect(detectRepository(await fixture({ 'package.json': '{broken' }))).rejects.toThrow();
});
