import { spawn } from 'node:child_process';

export type CommandResult = { stdout: string; stderr: string; exitCode: number };
export type CommandRunner = (
  exe: string,
  args: string[],
  cwd: string,
  options?: { signal?: AbortSignal; env?: Record<string, string>; output?: (text: string) => void },
) => Promise<CommandResult>;
export const run: CommandRunner = (exe, args, cwd, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      settled = false;
    const stop = () => {
      if (child.pid && process.platform === 'win32')
        spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).on('error', () => child.kill());
      else child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
    child.stdout.on('data', (b) => {
      const t = b.toString();
      stdout = (stdout + t).slice(-2_000_000);
      options.output?.(t);
    });
    child.stderr.on('data', (b) => {
      const t = b.toString();
      stderr = (stderr + t).slice(-2_000_000);
      options.output?.(t);
    });
    child.on('error', (e) => {
      settled = true;
      options.signal?.removeEventListener('abort', stop);
      reject(e);
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', stop);
      if (!settled) resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
export async function checked(
  runner: CommandRunner,
  exe: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const result = await runner(exe, args, cwd);
  if (result.exitCode !== 0)
    throw new Error(
      `${exe} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    );
  return result.stdout.trim();
}
export function shellCommand(command: string): { exe: string; args: string[] } {
  return process.platform === 'win32'
    ? {
        exe: 'powershell.exe',
        args: [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference = 'Stop'; ${command}; if ($LASTEXITCODE) { exit $LASTEXITCODE }`,
        ],
      }
    : { exe: '/bin/sh', args: ['-c', command] };
}
