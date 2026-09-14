import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  realpath,
  readFile,
  readlink,
  writeFile,
  lstat,
  copyFile,
} from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import type { Project, RepoInput } from '../shared/types.js';
import { checked, run, type CommandRunner } from './process.js';
import { inside } from './skills.js';

export class GitService {
  constructor(
    public root: string,
    public runner: CommandRunner = run,
  ) {}
  git(args: string[], cwd: string) {
    return checked(this.runner, 'git', args, cwd);
  }
  async inspect(input: RepoInput): Promise<{ path: string; baseBranch: string; remote: string }> {
    const path = await realpath(input.path);
    const top = await realpath(await this.git(['rev-parse', '--show-toplevel'], path));
    if (top.toLowerCase() !== path.toLowerCase())
      throw new Error('Choose the repository root, not a subdirectory');
    const remote = await this.git(['remote', 'get-url', 'origin'], path);
    let baseBranch = input.baseBranch.trim();
    if (!baseBranch) {
      const head = await this.git(['ls-remote', '--symref', 'origin', 'HEAD'], path);
      baseBranch = head.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? '';
      if (!baseBranch)
        throw new Error('Cannot detect default branch; specify it in repository settings');
    }
    await this.git(['check-ref-format', '--branch', baseBranch], path);
    if (baseBranch.startsWith('-') || baseBranch.includes('@{'))
      throw new Error('Invalid base branch');
    for (const file of input.copyFiles) this.localPath(path, file);
    if (new Set(input.terminals.map((t) => t.id)).size !== input.terminals.length)
      throw new Error('Terminal IDs must be unique');
    if (new Set(input.terminals.map((t) => t.name)).size !== input.terminals.length)
      throw new Error('Terminal names must be unique');
    return { path, baseBranch, remote };
  }
  localPath(root: string, file: string) {
    const target = resolve(root, file);
    if (
      !inside(root, target) ||
      isAbsolute(file) ||
      file.split(/[\\/]/).some((p) => p.toLowerCase() === '.git' || p === '..') ||
      file.includes(':')
    )
      throw new Error(`Unsafe local file path: ${file}`);
    return target;
  }
  async assertWorktree(p: Project) {
    if (!inside(this.root, p.worktree))
      throw new Error('Worktree is outside the managed directory');
    const actual = await realpath(p.worktree);
    const root = await realpath(this.root);
    if (!inside(root, actual)) throw new Error('Worktree resolves outside the managed directory');
    const branch = await this.git(['branch', '--show-current'], p.worktree);
    if (branch !== p.branch)
      throw new Error(`Worktree branch changed: expected ${p.branch}, got ${branch}`);
    const top = await realpath(await this.git(['rev-parse', '--show-toplevel'], p.worktree));
    if (top.toLowerCase() !== actual.toLowerCase()) throw new Error('Worktree root changed');
  }
  async prepare(p: Project): Promise<string> {
    await mkdir(this.root, { recursive: true });
    if (!inside(this.root, p.worktree)) throw new Error('Invalid worktree destination');
    let exists = true;
    try {
      await access(p.worktree);
    } catch {
      exists = false;
    }
    if (!exists) {
      await this.git(['fetch', 'origin'], p.config.path);
      const base = await this.git(
        ['rev-parse', '--verify', `refs/remotes/origin/${p.config.baseBranch}^{commit}`],
        p.config.path,
      );
      await this.git(['worktree', 'add', '-b', p.branch, p.worktree, base], p.config.path);
    }
    await this.assertWorktree(p);
    for (const file of p.config.copyFiles) {
      const from = this.localPath(p.config.path, file),
        to = this.localPath(p.worktree, file);
      const sourceReal = await realpath(from);
      if (!inside(await realpath(p.config.path), sourceReal) || !(await lstat(from)).isFile())
        throw new Error(`Copy source must be a regular file inside the repository: ${file}`);
      const tracked = await this.git(['ls-files', '--', file], p.worktree);
      if (tracked) throw new Error(`Cannot overwrite tracked file: ${file}`);
      try {
        await access(to);
        continue;
      } catch {
        /* copy only once */
      }
      await mkdir(dirname(to), { recursive: true });
      if (
        !inside(await realpath(p.worktree), await realpath(dirname(to))) &&
        (await realpath(dirname(to))) !== (await realpath(p.worktree))
      )
        throw new Error('Copy destination traverses a symlink');
      await copyFile(from, to);
    }
    return await this.git(['rev-parse', 'HEAD'], p.worktree);
  }
  pathspec(p: Project) {
    return ['.', ...p.config.copyFiles.map((f) => `:(exclude,literal)${f.replaceAll('\\', '/')}`)];
  }
  async fingerprint(p: Project) {
    await this.assertWorktree(p);
    const hash = createHash('sha256');
    hash.update(await this.git(['rev-parse', 'HEAD'], p.worktree));
    // Hash final filesystem contents, independent of the index. Staging must not
    // invalidate a user's approval when publication is retried after a crash.
    const baseline = (
      await this.git(['ls-tree', '-r', '--name-only', '-z', 'HEAD'], p.worktree)
    ).split('\0');
    const current = (
      await this.git(
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...this.pathspec(p)],
        p.worktree,
      )
    ).split('\0');
    const excluded = new Set(
      p.config.copyFiles.map((file) => file.replaceAll('\\', '/').toLowerCase()),
    );
    const files = [...new Set([...baseline, ...current])]
      .filter((file) => file && !excluded.has(file.toLowerCase()))
      .sort();
    for (const file of files) {
      hash.update(file + '\0');
      const path = join(p.worktree, file);
      try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) hash.update('link:' + (await readlink(path)));
        else if (stat.isFile()) {
          hash.update(String(stat.mode & 0o111));
          hash.update(await readFile(path));
        } else if (stat.isDirectory()) {
          hash.update(await this.git(['rev-parse', 'HEAD'], path));
          hash.update(await this.git(['status', '--porcelain'], path));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') hash.update('<deleted>');
        else throw error;
      }
      hash.update('\0');
    }
    return hash.digest('hex');
  }
  async commit(p: Project): Promise<string> {
    await this.assertWorktree(p);
    const lastMessage = await this.git(['log', '-1', '--format=%B'], p.worktree);
    if (lastMessage.includes(`AI-Native-Approval: ${p.acceptedFingerprint}`)) {
      const dirty = await this.git(
        ['status', '--porcelain', '--untracked-files=all', '--', ...this.pathspec(p)],
        p.worktree,
      );
      if (dirty)
        throw new Error(
          'Files changed after the publication commit; review and approve the new state',
        );
      return this.git(['rev-parse', 'HEAD'], p.worktree);
    }
    if ((await this.fingerprint(p)) !== p.acceptedFingerprint)
      throw new Error('Files changed since approval. Review and approve the current state again.');
    const files = (
      await this.git(
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...this.pathspec(p)],
        p.worktree,
      )
    )
      .split('\0')
      .filter(Boolean);
    const stageFile = join(dirname(p.skillRoot), 'stage-paths');
    if (files.length) {
      await writeFile(stageFile, [...new Set(files)].join('\0') + '\0');
      await this.git(
        [
          '--literal-pathspecs',
          'add',
          '--all',
          `--pathspec-from-file=${stageFile}`,
          '--pathspec-file-nul',
        ],
        p.worktree,
      );
    }
    const changes = await this.git(['diff', '--cached', '--name-only'], p.worktree);
    if (!changes) throw new Error('No changes to commit');
    const staged = (await this.git(['diff', '--cached', '--name-only', '-z'], p.worktree)).split(
      '\0',
    );
    if (
      p.config.copyFiles.some((file) =>
        staged.some((path) => path.toLowerCase() === file.replaceAll('\\', '/').toLowerCase()),
      )
    )
      throw new Error(
        'A copied local file is staged. Unstage it before publication; copied configuration files must stay local.',
      );
    await this.git(
      [
        'commit',
        '-m',
        `${p.name}\n\nTicket: ${p.ticketUrl}\n\nAI-Native-Project: ${p.id}\nAI-Native-Approval: ${p.acceptedFingerprint}`,
      ],
      p.worktree,
    );
    return this.git(['rev-parse', 'HEAD'], p.worktree);
  }
  githubRepo(remote: string) {
    const match = remote.match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
    );
    if (!match) throw new Error('Draft PR publication requires an origin on github.com');
    return match[1];
  }
  async publish(p: Project): Promise<string> {
    await this.assertWorktree(p);
    if ((await this.git(['rev-parse', 'HEAD'], p.worktree)) !== p.commitSha)
      throw new Error('HEAD changed after the approved commit');
    const dirty = await this.git(
      ['status', '--porcelain', '--untracked-files=all', '--', ...this.pathspec(p)],
      p.worktree,
    );
    if (dirty) throw new Error('Worktree changed after the approved commit');
    const repo = this.githubRepo(p.config.remote);
    await this.git(['push', '--set-upstream', 'origin', p.branch], p.worktree);
    const args = [
      'pr',
      'list',
      '--repo',
      repo,
      '--head',
      p.branch,
      '--state',
      'all',
      '--json',
      'url',
    ];
    const existing = JSON.parse(await checked(this.runner, 'gh', args, p.worktree));
    if (existing[0]?.url) return existing[0].url;
    const body = `## Task\n${p.ticketUrl}\n\n## Summary\n${p.summary ?? p.review?.summary ?? p.name}\n\n## Validation\nTests: ${p.tests?.status ?? 'not_configured'}\n\n${p.review?.summary ?? ''}\n\nCreated by AI Native Workflow. Project: ${p.id}`;
    const bodyFile = join(dirname(p.skillRoot), 'pull-request.md');
    await writeFile(bodyFile, body, 'utf8');
    return checked(
      this.runner,
      'gh',
      [
        'pr',
        'create',
        '--repo',
        repo,
        '--draft',
        '--base',
        p.config.baseBranch,
        '--head',
        p.branch,
        '--title',
        p.name,
        '--body-file',
        bodyFile,
      ],
      p.worktree,
    );
  }
  async remove(p: Project) {
    await this.assertWorktree(p);
    const dirty = await this.git(['status', '--porcelain', '--untracked-files=all'], p.worktree);
    if (dirty)
      throw new Error(
        'Worktree contains uncommitted or untracked files. Save them before removing it.',
      );
    await this.git(['worktree', 'remove', p.worktree], p.config.path);
  }
}
