import type { Project } from './types.js';

export const taskDescriptionLimit = 20000;
export function taskSourceText(
  project: Pick<Project, 'taskSource' | 'ticketUrl' | 'taskDescription'>,
) {
  return project.taskSource === 'description'
    ? `User-provided task description:\n${project.taskDescription ?? ''}`
    : `Ticket URL: ${project.ticketUrl ?? ''}`;
}
