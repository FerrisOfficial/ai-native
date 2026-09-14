import { readdir, readFile, lstat, mkdir, cp, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
export async function scanSkills(root: string, create = true): Promise<Skill[]> {
  if (create) await mkdir(root, { recursive: true });
  else {
    try {
      await lstat(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
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
async function repositorySkillRoot(repository: string) {
  const base = await realpath(repository);
  const root = join(base, '.claude', 'skills');
  for (const path of [join(base, '.claude'), root]) {
    try {
      if ((await lstat(path)).isSymbolicLink() || !inside(base, await realpath(path)))
        throw new Error('Repository skill directories cannot be symlinks or junctions');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return root;
}
export async function availableSkills(root: string, repository?: string): Promise<Skill[]> {
  const application = (await scanSkills(root)).map((s) => ({
    ...s,
    source: 'application' as const,
  }));
  if (!repository) return application;
  const local = await scanSkills(await repositorySkillRoot(repository), false);
  return [
    ...application,
    ...local.map((s) => ({ ...s, id: `repo:${s.id}`, source: 'repository' as const })),
  ];
}
export function bundledSkillName(id: string) {
  return id.startsWith('repo:')
    ? `repository-${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
    : id;
}
export async function snapshotSkills(
  root: string,
  destination: string,
  choices: Choices,
  repository?: string,
) {
  const skills = await availableSkills(root, repository);
  const selected = [...new Set(Object.values(choices).map((c) => c.skill))];
  if (new Set(selected.map(bundledSkillName)).size !== selected.length)
    throw new Error('Selected skill bundle names conflict; rename the application skill');
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
  for (const id of selected) {
    const local = id.startsWith('repo:');
    const sourceRoot = local ? await repositorySkillRoot(repository!) : root;
    const name = bundledSkillName(id);
    const target = join(destination, 'skills', name);
    await cp(join(sourceRoot, local ? id.slice(5) : id), target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if (local) {
      const file = join(target, 'SKILL.md');
      const content = await readFile(file, 'utf8');
      await writeFile(
        file,
        content.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start, yaml, end) => {
          const meta = parse(yaml);
          meta.name = name;
          return `${start}${JSON.stringify(meta)}${end}`;
        }),
      );
    }
  }
}
