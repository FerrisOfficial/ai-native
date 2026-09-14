import { it, expect } from 'vitest';
import { projectInput } from '../server/workflow.js';
import { taskSourceText, taskDescriptionLimit } from '../shared/task-source.js';

const base = { name: 'Example', repoId: 'repo' };
it('accepts an optional note alongside a ticket and keeps the URL required', () => {
  const input = projectInput.parse({
    ...base,
    ticketUrl: 'https://example.test/task',
    taskNote: '  Keep **existing filters**.  ',
  });
  expect(input.taskNote).toBe('Keep **existing filters**.');
  expect(taskSourceText(input)).toContain('Ticket URL: https://example.test/task');
  expect(taskSourceText(input)).toContain(input.taskNote);
  expect(projectInput.safeParse({ ...base, taskNote: 'Note without URL' }).success).toBe(false);
  expect(
    projectInput.safeParse({ ...input, taskNote: 'x'.repeat(taskDescriptionLimit + 1) }).success,
  ).toBe(false);
  expect(taskSourceText({ ...input, taskNote: '' })).toBe('Ticket URL: https://example.test/task');
});
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
