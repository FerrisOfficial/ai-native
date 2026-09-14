import { testDirectory } from './temp.js';
import { it, expect } from 'vitest';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { detectRepository } from '../server/detect.js';
import { run } from '../server/process.js';

async function fixture(files: Record<string, string>) {
  const root = await testDirectory();
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
  const result = await detectRepository(root, 'linux');
  expect(result.setupCommand).toBe('npm ci');
  expect(result.testCommand).toBe('npm run test -- --run');
  expect(result.terminals[0].command).toBe('npm run dev -- --host 127.0.0.1 --port $env:PORT');
  expect(result.detected).toContain('React');
  await expect(access(join(root, 'SHOULD_NOT_EXIST'))).rejects.toThrow();
});
it.each(['npm', 'pnpm', 'yarn', 'bun'])(
  'uses the Windows launcher for %s in every proposed command',
  async (manager) => {
    const root = await fixture({
      'package.json': JSON.stringify({
        packageManager: `${manager}@1`,
        scripts: { test: 'node test.js', dev: 'node dev.js' },
      }),
    });
    const detected = await detectRepository(root, 'win32');
    const launcher = manager === 'bun' ? 'bun' : `${manager}.cmd`;
    for (const command of [
      detected.setupCommand,
      detected.testCommand,
      detected.terminals[0].command,
    ])
      expect(command.startsWith(launcher + ' ')).toBe(true);
  },
);

it.skipIf(process.platform !== 'win32')(
  'executes detected npm setup/test/dev under Restricted PowerShell',
  async () => {
    const root = await fixture({
      'package.json': JSON.stringify({
        name: 'launcher-fixture',
        version: '1.0.0',
        scripts: { postinstall: 'node setup.cjs', test: 'node test.cjs', dev: 'node dev.cjs' },
      }),
      'package-lock.json': JSON.stringify({
        name: 'launcher-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: 'launcher-fixture', version: '1.0.0' } },
      }),
      'setup.cjs': "require('node:fs').writeFileSync('setup-ok', 'ok')",
      'test.cjs': "require('node:fs').writeFileSync('test-ok', 'ok')",
      'dev.cjs': "require('node:fs').writeFileSync('dev-ok', 'ok')",
    });
    const detected = await detectRepository(root);
    for (const command of [
      detected.setupCommand,
      detected.testCommand,
      detected.terminals[0].command,
    ]) {
      const result = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Restricted',
          '-Command',
          `$ErrorActionPreference = 'Stop'; ${command}; exit $LASTEXITCODE`,
        ],
        root,
        {
          env: {
            npm_config_offline: 'true',
            npm_config_audit: 'false',
            npm_config_fund: 'false',
            npm_config_cache: join(root, 'cache'),
          },
        },
      );
      expect(result.stderr + result.stdout, 'command must succeed').not.toContain(
        'cannot be loaded',
      );
      expect(result.exitCode, result.stderr).toBe(0);
    }
    for (const name of ['setup-ok', 'test-ok', 'dev-ok']) await access(join(root, name));
  },
  30000,
);

it('handles pnpm/Next and conflicting lockfiles conservatively', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({
      packageManager: 'pnpm@10',
      scripts: { dev: 'next dev', test: 'echo "Error: no test specified" && exit 1' },
    }),
    'pnpm-lock.yaml': '',
  });
  const result = await detectRepository(root, 'linux');
  expect(result.setupCommand).toBe('pnpm install --frozen-lockfile');
  expect(result.testCommand).toBe('');
  expect(result.terminals[0].command).toContain(
    'pnpm run dev --hostname 127.0.0.1 --port $env:PORT',
  );
  await writeFile(join(root, 'yarn.lock'), '');
  const ambiguous = await detectRepository(root, 'linux');
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
