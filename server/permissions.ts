import {
  analyzeCommand,
  matchesCommandWords,
  normalizeCommandPrefix,
} from '../shared/command-permissions.js';
import { randomUUID } from 'node:crypto';
import type { CommandPermission, Project, Repository } from '../shared/types.js';
import type { Store } from './store.js';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function commandSignature(tool: string, input: Record<string, unknown>) {
  if (
    !['Bash', 'PowerShell'].includes(tool) ||
    typeof input.command !== 'string' ||
    !input.command.trim()
  )
    return undefined;
  const { description: _description, ...execution } = input;
  return JSON.stringify(canonical({ tool, execution }));
}
export function savedCommands(store: Store, repoId: string) {
  return store
    .all<CommandPermission>('command_permissions')
    .filter((p) => p.repoId === repoId && !p.revokedAt);
}
export function findCommand(
  store: Store,
  project: Pick<Project, 'repoId'> & { id?: string },
  tool: string,
  input: Record<string, unknown>,
) {
  const signature = commandSignature(tool, input);
  if (!signature) return undefined;
  const saved = savedCommands(store, project.repoId).filter((p) => p.tool === tool);
  const exact = saved.find(
    (p) =>
      p.scope !== 'prefix' && executionOptions(p.input, true) === executionOptions(input, true),
  );
  if (exact) return { ...exact, matchedPermissionIds: [exact.id] };
  const analysis = analyzeCommand(String(input.command), tool);
  if (analysis.reason) return undefined;
  const matches = analysis.commands.map((words) =>
    saved.find(
      (p) =>
        p.scope === 'prefix' &&
        matchesCommandWords(words, p.prefix ?? '', tool) &&
        executionOptions(p.input) === executionOptions(input),
    ),
  );
  if (matches.some((p) => !p)) return undefined;
  return matches[0]
    ? { ...matches[0], matchedPermissionIds: [...new Set(matches.map((p) => p!.id))] }
    : undefined;
}
export function rememberCommand(
  store: Store,
  project: Pick<Project, 'repoId'> & { id?: string },
  tool: string,
  input: Record<string, unknown>,
  prefix?: string,
) {
  const signature = commandSignature(tool, input);
  if (!signature) throw new Error('Only shell commands can be remembered');
  const restriction = commandRestriction(tool, input);
  if (restriction) throw new Error(restriction);
  if (!store.get<Repository>('repositories', project.repoId))
    throw new Error('Repository not found');
  const normalized = prefix === undefined ? undefined : normalizeCommandPrefix(prefix, tool);
  if (
    prefix !== undefined &&
    (!normalized ||
      !analyzeCommand(String(input.command), tool).commands.some((words) =>
        matchesCommandWords(words, normalized, tool),
      ))
  )
    throw new Error(
      'The prefix must match one of the recognized commands. Use an exact approval for unsupported shell syntax.',
    );
  const existing = savedCommands(store, project.repoId).find((p) =>
    normalized
      ? p.scope === 'prefix' &&
        p.tool === tool &&
        p.prefix === normalized &&
        executionOptions(p.input) === executionOptions(input)
      : p.scope !== 'prefix' && p.signature === signature,
  );
  if (existing) return existing;
  const permission: CommandPermission = {
    id: randomUUID(),
    repoId: project.repoId,
    tool,
    input,
    signature,
    scope: normalized ? 'prefix' : 'exact',
    prefix: normalized,
    createdAt: new Date().toISOString(),
  };
  store.put('command_permissions', permission);
  store.event('command_permission_saved', permission, project.id);
  return permission;
}

function executionOptions(input: Record<string, unknown>, includeCommand = false) {
  const { command: _command, description: _description, timeout: _timeout, ...options } = input;
  if (options.run_in_background === false) delete options.run_in_background;
  if (options.dangerouslyDisableSandbox === false) delete options.dangerouslyDisableSandbox;
  return JSON.stringify(
    canonical({ ...options, ...(includeCommand ? { command: _command } : {}) }),
  );
}

export function commandRestriction(
  tool: string,
  input: Record<string, unknown>,
): string | undefined {
  if (!['Bash', 'PowerShell'].includes(tool)) return;
  const command = String(input.command ?? '');
  const lifecycle =
    /\b(git\s+(commit|push|checkout|switch|reset|clean|worktree)|gh\s+pr\s+(create|merge))\b/i.test(
      command,
    );
  const parsed = analyzeCommand(command, tool);
  const blocked = parsed.commands.some((words) => {
    const executable = words[0]
      .split(/[\\/]/)
      .at(-1)!
      .toLowerCase()
      .replace(/\.exe$/, '');
    let i = 1;
    const optionsWithValue =
      executable === 'git'
        ? ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']
        : ['-R', '--repo', '--hostname'];
    while (i < words.length && words[i].startsWith('-')) {
      if (optionsWithValue.includes(words[i])) i += 2;
      else i++;
    }
    if (executable === 'git')
      return ['commit', 'push', 'checkout', 'switch', 'reset', 'clean', 'worktree'].includes(
        words[i],
      );
    if (executable === 'gh') return words[i] === 'pr' && ['create', 'merge'].includes(words[i + 1]);
    return false;
  });
  if ((parsed.reason && lifecycle) || blocked)
    return 'Publication and worktree lifecycle belong to the host application';
}
