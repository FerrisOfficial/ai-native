import type { Project } from '../shared/types';

export function needsInput(project: Pick<Project, 'status'>, pending = false) {
  return (
    project.status !== 'archived' &&
    project.status !== 'published' &&
    (pending ||
      ['awaiting_plan', 'awaiting_result', 'blocked', 'interrupted'].includes(project.status))
  );
}
