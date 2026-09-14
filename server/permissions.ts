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
    ? savedCommands(store, project.repoId).find((p) => p.signature === signature)
    : undefined;
}
export function rememberCommand(
  store: Store,
  project: Project,
  tool: string,
  input: Record<string, unknown>,
) {
  const signature = commandSignature(tool, input);
  if (!signature) throw new Error('Only shell commands can be remembered');
  if (!store.get<Repository>('repositories', project.repoId))
    throw new Error('Repository not found');
  const existing = findCommand(store, project, tool, input);
  if (existing) return existing;
  const permission: CommandPermission = {
    id: randomUUID(),
    repoId: project.repoId,
    tool,
    input,
    signature,
    createdAt: new Date().toISOString(),
  };
  store.put('command_permissions', permission);
  store.event('command_permission_saved', permission, project.id);
  return permission;
}
