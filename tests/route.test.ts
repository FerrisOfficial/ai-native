import { it, expect } from 'vitest';
import { parseHash, buildHash, type Route } from '../src/route.js';

const routes: Route[] = [
  { page: 'board' },
  { page: 'repositories' },
  { page: 'skills' },
  { page: 'settings' },
  { page: 'project', id: 'abc123', tab: 'Overview' },
  { page: 'project', id: 'abc123', tab: 'Plan' },
  { page: 'project', id: 'abc123', tab: 'Conversations' },
  { page: 'project', id: 'abc123', tab: 'Review' },
  { page: 'project', id: 'abc123', tab: 'Terminals' },
];

it('round-trips every route through buildHash and parseHash', () => {
  for (const route of routes) {
    const hash = buildHash(route);
    expect(parseHash(hash)).toEqual({ route, malformed: false });
  }
});

it('treats empty, #, and #/ as the board with no error', () => {
  for (const hash of ['', '#', '#/']) {
    expect(parseHash(hash)).toEqual({ route: { page: 'board' }, malformed: false });
  }
});

it('defaults a project route with a missing or unrecognized tab slug to Overview', () => {
  expect(parseHash('#/project/abc123')).toEqual({
    route: { page: 'project', id: 'abc123', tab: 'Overview' },
    malformed: false,
  });
  expect(parseHash('#/project/abc123/nonsense')).toEqual({
    route: { page: 'project', id: 'abc123', tab: 'Overview' },
    malformed: false,
  });
});

it('encodes and decodes project ids that need escaping', () => {
  const route: Route = { page: 'project', id: 'weird id/with?chars', tab: 'Review' };
  const hash = buildHash(route);
  expect(hash).not.toContain('weird id/with?chars');
  expect(parseHash(hash)).toEqual({ route, malformed: false });
});

it('flags unknown top-level segments as malformed and falls back to the board', () => {
  for (const hash of [
    '#/nonsense',
    '#/../../etc',
    '#/repositories/extra',
    '#/project/abc123/Plan/unexpected',
    '#/project/abc123//unexpected',
  ]) {
    const result = parseHash(hash);
    expect(result.malformed).toBe(true);
    expect(result.route).toEqual({ page: 'board' });
  }
});

it('flags a project route with no id as malformed', () => {
  for (const hash of ['#/project', '#/project/']) {
    const result = parseHash(hash);
    expect(result.malformed).toBe(true);
    expect(result.route).toEqual({ page: 'board' });
  }
});

it('never throws on garbage or malformed percent-encoding', () => {
  for (const hash of ['#/project/%', '#/%zz', '#///']) {
    expect(() => parseHash(hash)).not.toThrow();
  }
});
