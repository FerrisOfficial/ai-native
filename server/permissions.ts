import { matchesCommandPrefix, normalizeCommandPrefix } from '../shared/command-permissions.js';
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
  project: Project,
  tool: string,
  input: Record<string, unknown>,
) {
  const signature = commandSignature(tool, input);
  return signature
    ? savedCommands(store, project.repoId).find((p) =>
        p.scope === 'prefix'
          ? p.tool === tool &&
            typeof input.command === 'string' &&
            matchesCommandPrefix(input.command, p.prefix ?? '') &&
            executionOptions(p.input) === executionOptions(input)
          : p.signature === signature,
      )
    : undefined;
}
export function rememberCommand(
  store: Store,
  project: Project,
  tool: string,
  input: Record<string, unknown>,
  prefix?: string,
) {
  const signature = commandSignature(tool, input);
  if (!signature) throw new Error('Only shell commands can be remembered');
  if (!store.get<Repository>('repositories', project.repoId))
    throw new Error('Repository not found');
  const normalized = prefix === undefined ? undefined : normalizeCommandPrefix(prefix);
  if (
    prefix !== undefined &&
    (!normalized || !matchesCommandPrefix(String(input.command), normalized))
  )
    throw new Error(
      'The prefix must match this simple command. Compound shell commands require an exact approval.',
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

function executionOptions(input: Record<string, unknown>) {
  const { command: _command, description: _description, timeout: _timeout, ...options } = input;
  return JSON.stringify(canonical(options));
}
