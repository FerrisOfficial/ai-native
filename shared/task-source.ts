import type { Project } from './types.js';

export const taskDescriptionLimit = 20000;
export function taskSourceText(
  project: Pick<Project, 'taskSource' | 'ticketUrl' | 'taskDescription' | 'taskNote'>,
) {
  return project.taskSource === 'description'
    ? `User-provided task description:\n${project.taskDescription ?? ''}`
    : `Ticket URL: ${project.ticketUrl ?? ''}${project.taskNote ? `\n\nAdditional user note (context supplementing the ticket):\n${project.taskNote}` : ''}`;
}
