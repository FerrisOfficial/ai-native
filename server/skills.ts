import { readdir, readFile, lstat, mkdir, cp, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { parse } from 'yaml';
import type { Choices, Skill } from '../shared/types.js';

export function inside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(rel)
  );
}
async function noLinks(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error('Symlinks and junctions are not supported in skill bundles');
    if (stat.isDirectory()) await noLinks(path);
  }
}
export async function scanSkills(root: string): Promise<Skill[]> {
  await mkdir(root, { recursive: true });
  const result: Skill[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skill: Skill = { id: entry.name, name: entry.name, description: '', valid: false };
    try {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name))
        throw new Error('Folder name must use lowercase letters, digits and hyphens');
      if (entry.isSymbolicLink()) throw new Error('Skill folders cannot be symlinks');
      await noLinks(join(root, entry.name));
      const content = await readFile(join(root, entry.name, 'SKILL.md'), 'utf8');
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw new Error('SKILL.md needs YAML frontmatter');
      const meta = parse(match[1]);
      if (
        meta?.name !== entry.name ||
        typeof meta?.description !== 'string' ||
        !meta.description.trim()
      )
        throw new Error('Frontmatter needs name matching the folder and a nonempty description');
      if (!content.slice(match[0].length).trim()) throw new Error('Skill instructions are empty');
      Object.assign(skill, { name: meta.name, description: meta.description, valid: true });
    } catch (e) {
      skill.error = (e as Error).message;
    }
    result.push(skill);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
export async function snapshotSkills(root: string, destination: string, choices: Choices) {
  const skills = await scanSkills(root);
  for (const id of new Set(Object.values(choices).map((c) => c.skill))) {
    const skill = skills.find((s) => s.id === id);
    if (!skill?.valid) throw new Error(`Invalid skill ${id}: ${skill?.error ?? 'not found'}`);
  }
  await mkdir(join(destination, '.claude-plugin'), { recursive: true });
  await writeFile(
    join(destination, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'ai-native',
      version: '1.0.0',
      description: 'Immutable project workflow skills',
    }),
  );
  for (const id of new Set(Object.values(choices).map((c) => c.skill)))
    await cp(join(root, id), join(destination, 'skills', id), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
}
