import { it, expect } from 'vitest';
import { projectInput } from '../server/workflow.js';
import { taskSourceText, taskDescriptionLimit } from '../shared/task-source.js';

const base = { name: 'Example', repoId: 'repo' };
it('keeps legacy URL requests and accepts a description without a URL', () => {
  expect(projectInput.parse({ ...base, ticketUrl: 'https://example.test/task' }).taskSource).toBe(
    'url',
  );
  const input = projectInput.parse({
    ...base,
    taskSource: 'description',
    taskDescription: '  Add **search**.\nPreserve filtering.  ',
  });
  expect(input.taskDescription).toBe('Add **search**.\nPreserve filtering.');
  expect(input.ticketUrl).toBeUndefined();
  expect(taskSourceText(input)).toContain(input.taskDescription);
  expect(taskSourceText({ ticketUrl: 'https://example.test/task' })).toBe(
    'Ticket URL: https://example.test/task',
  );
});
it.each([
  {},
  { ticketUrl: '' },
  { ticketUrl: 'file:///private' },
  { taskSource: 'description' },
  { taskSource: 'description', taskDescription: ' \n ' },
  { taskSource: 'description', taskDescription: 'x'.repeat(taskDescriptionLimit + 1) },
  { taskSource: 'url', taskDescription: 'This must not bypass URL validation' },
])('rejects an invalid or empty selected task source: %j', (input) => {
  expect(projectInput.safeParse({ ...base, ...input }).success).toBe(false);
});
