export type Page = 'board' | 'repositories' | 'skills' | 'settings';
export type Tab = 'Overview' | 'Plan' | 'Conversations' | 'Review' | 'Terminals';

export const repositoryTabs = [
  'General',
  'Workflow',
  'Workspace',
  'Terminals',
  'Permissions',
] as const;
export type RepositoryTab = (typeof repositoryTabs)[number];
export type Route =
  | { page: Page }
  | { page: 'project'; id: string; tab: Tab }
  | { page: 'repository'; id: string; tab: RepositoryTab };

const TABS: Tab[] = ['Overview', 'Plan', 'Conversations', 'Review', 'Terminals'];

function isTab(value: string): value is Tab {
  return (TABS as string[]).includes(value);
}

function segments(hash: string): string[] {
  let s = hash;
  if (s.startsWith('#')) s = s.slice(1);
  if (s.startsWith('/')) s = s.slice(1);
  if (!s) return [];
  const parts = s.split('/');
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function parseHash(hash: string): { route: Route; malformed: boolean } {
  const parts = segments(hash);
  if (parts.length === 0) return { route: { page: 'board' }, malformed: false };
  const [head, ...rest] = parts;
  if (head === 'repository') {
    if (!rest[0] || rest.length > 2) return { route: { page: 'board' }, malformed: true };
    try {
      const tab = repositoryTabs.find((tab) => tab === rest[1]) ?? 'General';
      return {
        route: { page: 'repository', id: decodeURIComponent(rest[0]), tab },
        malformed: false,
      };
    } catch {
      return { route: { page: 'board' }, malformed: true };
    }
  }
  if (head === 'repositories' || head === 'skills' || head === 'settings') {
    if (rest.length > 0) return { route: { page: 'board' }, malformed: true };
    return { route: { page: head }, malformed: false };
  }
  if (head === 'project') {
    const rawId = rest[0];
    if (!rawId || rest.length > 2) return { route: { page: 'board' }, malformed: true };
    let id: string;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      return { route: { page: 'board' }, malformed: true };
    }
    const tabSlug = rest[1];
    const tab = tabSlug && isTab(tabSlug) ? tabSlug : 'Overview';
    return { route: { page: 'project', id, tab }, malformed: false };
  }
  return { route: { page: 'board' }, malformed: true };
}

export function buildHash(route: Route): string {
  if (route.page === 'repository')
    return `#/repository/${encodeURIComponent(route.id)}/${route.tab}`;
  if (route.page === 'project') return `#/project/${encodeURIComponent(route.id)}/${route.tab}`;
  switch (route.page) {
    case 'board':
      return '#/';
    case 'repositories':
      return '#/repositories';
    case 'skills':
      return '#/skills';
    case 'settings':
      return '#/settings';
  }
}
