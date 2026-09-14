import { expect, it } from 'vitest';
import { matchesCommandPrefix, normalizeCommandPrefix } from '../shared/command-permissions.js';
it.each([
  'grep foo README.md',
  'grep "two words" README.md',
  "grep 'two words' README.md",
  '  grep -n foo .  ',
])('matches simple arguments: %s', (command) => {
  expect(matchesCommandPrefix(command, 'grep')).toBe(true);
});
it.each([
  'grep-other foo',
  'grep foo; whoami',
  'grep foo && whoami',
  'grep foo | whoami',
  'grep foo > result',
  'grep $(whoami)',
  'grep ' + String.fromCharCode(96) + 'whoami' + String.fromCharCode(96),
  'grep foo\nwhoami',
  'grep foo\rwhoami',
  'grep foo & whoami',
  'grep foo <(whoami)',
  'grep "unterminated',
  'grep "foo"bar',
  'grep @args',
  'grep $args',
  'grep foo\\\nwhoami',
])('keeps unsafe or different commands pending: %s', (command) => {
  expect(matchesCommandPrefix(command, 'grep')).toBe(false);
});
it('matches complete subcommand tokens and rejects invalid prefixes', () => {
  expect(matchesCommandPrefix('npm test -- --run', 'npm test')).toBe(true);
  expect(matchesCommandPrefix('npm testing', 'npm test')).toBe(false);
  expect(matchesCommandPrefix('npm install', 'npm test')).toBe(false);
  expect(normalizeCommandPrefix(' npm   test ')).toBe('npm test');
  expect(normalizeCommandPrefix('grep;')).toBeUndefined();
  expect(normalizeCommandPrefix('')).toBeUndefined();
});
