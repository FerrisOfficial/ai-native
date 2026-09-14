import { expect, it } from 'vitest';
import { needsInput } from '../src/project-attention';
import type { Project } from '../shared/types';

it('counts waiting, blocked, interrupted and permission-pending projects', () => {
  for (const status of ['awaiting_plan', 'awaiting_result', 'blocked', 'interrupted'] as const) {
    expect(needsInput({ status })).toBe(true);
  }
  expect(needsInput({ status: 'running' }, true)).toBe(true);
  expect(needsInput({ status: 'running' })).toBe(false);
});

it('excludes finished projects even if a stale pending question is present', () => {
  for (const status of ['archived', 'published'] as const) {
    expect(needsInput({ status }, true)).toBe(false);
  }
  const projects = [
    { status: 'awaiting_plan' },
    { status: 'running' },
    { status: 'archived' },
  ] as Project[];
  expect(projects.filter((p) => needsInput(p, true))).toHaveLength(2);
});
