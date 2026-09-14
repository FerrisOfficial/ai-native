import { testDirectory } from './temp.js';
import { it, expect } from 'vitest';
import { mkdir, readFile, writeFile, access, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { availableSkills, bundledSkillName, scanSkills, snapshotSkills } from '../server/skills.js';
import type { Choices } from '../shared/types.js';

it('discovers repository skills separately and snapshots their instructions and support files', async () => {
  const root = await testDirectory();
  const app = join(root, 'application');
  const repo = join(root, 'repo');
  const other = join(root, 'other');
  await mkdir(other);
  for (const [folder, text] of [
    [join(app, 'planner'), 'Application instructions'],
    [join(repo, '.claude/skills/planner'), 'Repository instructions'],
  ]) {
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'SKILL.md'),
      `---\nname: planner\ndescription: Plan work.\n---\n${text}\n`,
    );
  }
  await writeFile(join(repo, '.claude/skills/planner/reference.txt'), 'Original reference');
  const list = await availableSkills(app, repo);
  expect(list.map((s) => [s.id, s.source, s.valid])).toEqual([
    ['planner', 'application', true],
    ['repo:planner', 'repository', true],
  ]);
  expect((await availableSkills(app, other)).map((s) => s.id)).toEqual(['planner']);
  await expect(access(join(other, '.claude'))).rejects.toThrow();
  const choices: Choices = {
    plan: { skill: 'repo:planner', model: 'default' },
    implementation: { skill: 'planner', model: 'default' },
    review: { skill: 'repo:planner', model: 'default' },
  };
  const dest = join(root, 'snapshot');
  await snapshotSkills(app, dest, choices, repo);
  const repoBundle = join(dest, 'skills', bundledSkillName('repo:planner'));
  expect((await scanSkills(join(dest, 'skills'))).every((s) => s.valid)).toBe(true);
  expect(await readFile(join(repoBundle, 'SKILL.md'), 'utf8')).toContain('Repository instructions');
  expect(await readFile(join(dest, 'skills/planner/SKILL.md'), 'utf8')).toContain(
    'Application instructions',
  );
  await writeFile(join(repo, '.claude/skills/planner/reference.txt'), 'Changed reference');
  expect(await readFile(join(repoBundle, 'reference.txt'), 'utf8')).toBe('Original reference');
  await expect(snapshotSkills(app, join(root, 'bad-snapshot'), choices, other)).rejects.toThrow(
    'Invalid skill',
  );
  await writeFile(join(repo, '.claude/skills/planner/SKILL.md'), 'Invalid skill');
  expect((await availableSkills(app, repo)).find((s) => s.id === 'repo:planner')?.valid).toBe(
    false,
  );
});

it('rejects linked repository skill roots', async () => {
  const root = await testDirectory();
  const repo = join(root, 'repo');
  const external = join(root, 'external');
  await mkdir(repo);
  await mkdir(external);
  await symlink(external, join(repo, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(availableSkills(join(root, 'app'), repo)).rejects.toThrow('symlinks or junctions');
});
