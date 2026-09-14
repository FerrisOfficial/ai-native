import { expect, it } from 'vitest';
import {
  analyzeCommand,
  matchesCommandPrefix,
  normalizeCommandPrefix,
  suggestedCommandPrefixes,
} from '../shared/command-permissions.js';
import { findCommand, rememberCommand, savedCommands } from '../server/permissions.js';
import { Store } from '../server/store.js';
it.each([
  'grep foo README.md',
  'grep "two words" README.md',
  "grep 'two words' README.md",
  'grep "foo"bar file',
  'grep -E "(foo|bar){2}" file',
  "grep '\\bfoo\\b' file",
  'grep --include=*.ts foo .',
  'grep "C:\\Users\\Maciej\\file.txt" README.md',
  "grep '$(literal)' file",
  "grep '`literal`' file",
  'grep foo,bar file',
  'grep foo\\ bar file',
  'grep foo 2>&1',
  'grep foo # comment',
  'grep foo\\\nbar file',
])('matches literal Bash arguments: %s', (command) =>
  expect(matchesCommandPrefix(command, 'grep')).toBe(true),
);
it.each([
  'grep-other foo',
  'grep foo; whoami',
  'grep foo && whoami',
  'grep foo | whoami',
  'grep foo > result',
  'grep $(whoami)',
  'grep `whoami`',
  'grep foo\nwhoami',
  'grep foo & whoami',
  'grep foo <(whoami)',
  'grep "unterminated',
  'grep $args',
  'grep "$(whoami)"',
  'X=1 grep foo',
  'if true; then grep x; fi',
])('does not treat complex or different invocations as one prefix: %s', (command) =>
  expect(matchesCommandPrefix(command, 'grep')).toBe(false),
);
it.each([
  'Select-String -Path C:\\src\\file.ts -Pattern "foo|bar"',
  "Select-String -Pattern '$(literal)' -Path file",
  "Select-String -Pattern 'it''s fine' -Path file",
  'select-string -Pattern foo -Path file',
])('supports literal PowerShell arguments: %s', (command) =>
  expect(matchesCommandPrefix(command, 'Select-String', 'PowerShell')).toBe(true),
);
it.each([
  'Get-Content $path',
  'Get-Content @(whoami)',
  'Get-Content x, (whoami)',
  'Get-Content x > out',
  '& whoami',
  'Get-Content "$(whoami)"',
])('keeps PowerShell expressions pending: %s', (command) =>
  expect(analyzeCommand(command, 'PowerShell').reason).toBeTruthy(),
);
it('suggests narrow prefixes, parses pipelines, quoted paths and literal punctuation', () => {
  expect(
    suggestedCommandPrefixes(
      'gh issue view 42 --json title,body && git status --short | grep "a;b"',
    ),
  ).toEqual(['gh issue view', 'git status', 'grep']);
  expect(analyzeCommand('node --check script.js && echo "OK"; git status 2>&1').commands).toEqual([
    ['node', '--check', 'script.js'],
    ['echo', 'OK'],
    ['git', 'status'],
  ]);
  expect(matchesCommandPrefix('npm testing', 'npm test')).toBe(false);
  expect(normalizeCommandPrefix(' npm   test ')).toBe('npm test');
  expect(normalizeCommandPrefix('grep; whoami')).toBeUndefined();
  expect(
    matchesCommandPrefix('"C:/Program Files/tool.exe" --version', "'C:/Program Files/tool.exe'"),
  ).toBe(true);
});
it('requires coverage of every pipeline/chain component, normalizes benign options and keeps scopes isolated', () => {
  const store = new Store(':memory:');
  try {
    store.put('repositories', { id: 'repo' });
    const project = { repoId: 'repo' };
    const grep = rememberCommand(
      store,
      project,
      'Bash',
      { command: 'grep first file', timeout: 100 },
      'grep',
    );
    expect(
      findCommand(store, project, 'Bash', {
        command: 'grep next file',
        run_in_background: false,
        timeout: 200,
      }),
    ).toBeTruthy();
    expect(
      findCommand(store, project, 'Bash', {
        command: 'grep next file',
        dangerouslyDisableSandbox: true,
      }),
    ).toBeUndefined();
    expect(
      findCommand(store, project, 'Bash', { command: 'grep next file', run_in_background: true }),
    ).toBeUndefined();
    expect(
      findCommand(store, project, 'PowerShell', { command: 'grep next file' }),
    ).toBeUndefined();
    expect(
      findCommand(store, { repoId: 'other' }, 'Bash', { command: 'grep next file' }),
    ).toBeUndefined();
    expect(
      findCommand(store, project, 'Bash', { command: 'git status | grep first' }),
    ).toBeUndefined();
    const git = rememberCommand(store, project, 'Bash', { command: 'git status' }, 'git status');
    expect(
      findCommand(store, project, 'Bash', { command: 'git status --short | grep next' })
        ?.matchedPermissionIds,
    ).toEqual([git.id, grep.id]);
    expect(
      findCommand(store, project, 'Bash', { command: 'git status && grep next; whoami' }),
    ).toBeUndefined();
    expect(findCommand(store, project, 'Bash', { command: 'grep $(whoami)' })).toBeUndefined();
    store.put('command_permissions', { ...git, revokedAt: new Date().toISOString() });
    expect(
      findCommand(store, project, 'Bash', { command: 'git status | grep next' }),
    ).toBeUndefined();
    rememberCommand(store, project, 'Bash', { command: 'grep first file' }, 'grep');
    expect(savedCommands(store, 'repo')).toHaveLength(1);
    rememberCommand(store, project, 'Bash', {
      command: 'echo $HOME',
      description: 'test',
      timeout: 100,
    });
    expect(
      findCommand(store, project, 'Bash', { command: 'echo $HOME', timeout: 200 }),
    ).toBeTruthy();
  } finally {
    store.close();
  }
});

it('PowerShell command names are case insensitive but external argument prefixes stay exact', () => {
  expect(matchesCommandPrefix('GIT status', 'git status', 'PowerShell')).toBe(true);
  expect(matchesCommandPrefix('git branch foo', 'git branch Foo', 'PowerShell')).toBe(false);
});

it('lifecycle guards inspect actual commands, including global options, rather than quoted search text', async () => {
  const { commandRestriction } = await import('../server/permissions.js');
  for (const command of [
    'git -C repo push',
    'git --no-pager -c color.ui=false commit',
    '"git" push',
    'gh --repo org/repo pr create',
    'git.exe worktree remove x',
  ])
    expect(commandRestriction('Bash', { command })).toBeTruthy();
  for (const command of ["grep 'git push' file", 'git log --grep push', 'echo "git push"'])
    expect(commandRestriction('Bash', { command })).toBeUndefined();
});
