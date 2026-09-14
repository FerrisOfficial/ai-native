import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { inside } from './skills.js';
import type { RepoSuggestion } from '../shared/types.js';

// Discovery only reads manifests. Commands are proposals, never executed here.
export async function detectRepository(path: string): Promise<RepoSuggestion> {
  const root = await realpath(path);
  const files = new Set(await readdir(root));
  const result: RepoSuggestion = {
    detected: [],
    evidence: [],
    warnings: [],
    setupCommand: '',
    testCommand: '',
    terminals: [],
  };
  const read = async (name: string) => {
    const file = await realpath(join(root, name));
    if (!inside(root, file)) throw new Error(`Manifest points outside the repository: ${name}`);
    if ((await stat(file)).size > 1_048_576) throw new Error(`Manifest is too large: ${name}`);
    result.evidence.push(name);
    return readFile(file, 'utf8');
  };
  if (files.has('package.json')) {
    const pkg = JSON.parse(await read('package.json'));
    result.detected.push('Node.js');
    const locks = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lock', 'bun'],
      ['bun.lockb', 'bun'],
      ['package-lock.json', 'npm'],
      ['npm-shrinkwrap.json', 'npm'],
    ].filter(([file]) => files.has(file));
    result.evidence.push(...locks.map(([file]) => file));
    const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
    const managers = new Set(locks.map(([, manager]) => manager));
    const manager = ['npm', 'pnpm', 'yarn', 'bun'].includes(declared)
      ? declared
      : managers.size === 1
        ? [...managers][0]
        : 'npm';
    const ambiguous =
      managers.size > 1 || (declared && managers.size > 0 && !managers.has(declared));
    if (ambiguous)
      result.warnings.push(
        'Conflicting package-manager metadata. Choose the correct setup command before saving.',
      );
    else
      result.setupCommand =
        manager === 'npm'
          ? managers.has('npm')
            ? 'npm ci'
            : 'npm install'
          : manager === 'pnpm'
            ? `pnpm install${managers.has('pnpm') ? ' --frozen-lockfile' : ''}`
            : manager === 'bun'
              ? `bun install${managers.has('bun') ? ' --frozen-lockfile' : ''}`
              : 'yarn install';
    if (manager !== 'npm') result.warnings.push(`Setup requires ${manager} to be installed.`);
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (pkg.workspaces)
      result.warnings.push('Package workspaces detected. Review the scope of root scripts.');
    if (typeof scripts.test === 'string' && !/no test specified/i.test(scripts.test)) {
      const separator = manager === 'npm' ? ' --' : '';
      result.testCommand = `${manager} run test`;
      if (/\bvitest\b/.test(scripts.test) && !/\b(run|watch)\b/.test(scripts.test))
        result.testCommand += `${separator} --run`;
      if (/react-scripts\s+test/.test(scripts.test))
        result.testCommand += `${separator} --watchAll=false`;
      if (/--watch\b|\bvitest\s+watch\b/.test(scripts.test))
        result.warnings.push(
          'The test script appears to watch files. Change it to a command that exits after one run.',
        );
    } else result.warnings.push('No usable test script found; tests will remain Not configured.');
    const script =
      typeof scripts.dev === 'string'
        ? 'dev'
        : typeof scripts.start === 'string'
          ? 'start'
          : undefined;
    if (script) {
      let command = `${manager} run ${script}`;
      const separator = manager === 'npm' ? ' --' : '';
      if (/\bvite\b/.test(scripts[script])) {
        result.detected.push('Vite');
        command += `${separator} --host 127.0.0.1 --port $env:PORT`;
      } else if (/\bnext\s+(dev|start)\b/.test(scripts[script])) {
        result.detected.push('Next.js');
        command += `${separator} --hostname 127.0.0.1 --port $env:PORT`;
      } else
        result.warnings.push('Check that the development server reads PORT and binds to loopback.');
      result.terminals.push({ id: 'detected-dev', name: 'Dev server', command, env: {} });
    }
    if (deps.react) result.detected.push('React');
    result.warnings.push(
      'Package installation and scripts execute repository code. Review the proposed commands before saving.',
    );
  } else if (files.has('Cargo.toml')) {
    await read('Cargo.toml');
    result.detected.push('Rust');
    result.setupCommand = 'cargo fetch';
    result.testCommand = 'cargo test';
  } else if (files.has('go.mod')) {
    await read('go.mod');
    result.detected.push('Go');
    result.setupCommand = 'go mod download';
    result.testCommand = 'go test ./...';
  } else if (files.has('pyproject.toml') || files.has('requirements.txt')) {
    result.detected.push('Python');
    const pyproject = files.has('pyproject.toml') ? await read('pyproject.toml') : '';
    const requirements = files.has('requirements.txt') ? await read('requirements.txt') : '';
    if (files.has('uv.lock')) {
      result.evidence.push('uv.lock');
      result.setupCommand = 'uv sync --frozen';
      if (/pytest/.test(pyproject)) result.testCommand = 'uv run pytest';
      result.warnings.push('These commands require uv to be installed.');
    } else if (files.has('requirements.txt')) {
      result.setupCommand =
        'python -m venv .venv; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; .\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt';
      if (/pytest/.test(requirements))
        result.testCommand = '.\\.venv\\Scripts\\python.exe -m pytest';
    } else
      result.warnings.push(
        'Python packaging detected. Configure the environment command for the tool used by this repository.',
      );
    if (!result.testCommand) result.warnings.push('No configured test runner detected.');
  } else if (files.has('index.html')) {
    await read('index.html');
    result.detected.push('Static website');
    if (files.has('script.js')) result.testCommand = 'node --check script.js';
    result.terminals.push({
      id: 'detected-preview',
      name: 'Static preview',
      command: 'python -m http.server $env:PORT --bind 127.0.0.1',
      env: {},
    });
    result.warnings.push(
      'The optional preview requires Python. The syntax check, when proposed, is not a browser or functional test.',
    );
  } else
    result.warnings.push(
      'No supported root manifest found. Enter setup, tests and terminals manually.',
    );
  if (files.has('pnpm-workspace.yaml') || files.has('lerna.json'))
    result.warnings.push(
      'Workspace detected. Check whether commands should target a specific package.',
    );
  return result;
}
