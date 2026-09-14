import { it, expect, vi, beforeEach } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Project, Run } from '../shared/types.js';
const mock = vi.hoisted(() => ({ messages: [] as unknown[], query: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mock.query }));
import { ClaudeDriver } from '../server/claude.js';
import { Store } from '../server/store.js';
import { projectRuns, remainingBudget } from '../server/usage.js';

beforeEach(() => {
  mock.query.mockReset();
  mock.query.mockImplementation(() =>
    Object.assign(
      (async function* () {
        for (const message of mock.messages) yield message;
      })(),
      { close() {} },
    ),
  );
});
async function fixture() {
  await mkdir(resolve('.data/tests'), { recursive: true });
  const root = await mkdtemp(resolve('.data/tests/usage-'));
  return new Store(join(root, 'usage.sqlite'));
}
const run = (id: string): Run => ({
  id,
  projectId: 'project',
  stage: 'plan',
  startedAt: new Date().toISOString(),
  status: 'running',
  usageExpected: false,
});
const usage = {
  costUsd: 2,
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 40,
  apiDurationMs: 500,
};
const project = {
  id: 'project',
  worktree: '.',
  skillRoot: '.',
  budgetUsd: 5,
  choices: { plan: { skill: 'example-plan', model: 'default' } },
} as Project;
const result = {
  type: 'result',
  subtype: 'success',
  session_id: 'session',
  is_error: false,
  total_cost_usd: 2,
  duration_api_ms: 500,
  usage: {
    input_tokens: 1,
    output_tokens: 2,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 4,
  },
  modelUsage: {
    main: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 40,
    },
  },
  structured_output: { ticketAccessible: true, ticket: 'Ticket', plan: 'Plan' },
};

it('records whole-tree tokens once per result and passes remaining budget on resume', async () => {
  const store = await fixture();
  try {
    const driver = new ClaudeDriver(store);
    store.put('runs', run('one'));
    mock.messages = [result];
    await driver.execute({
      project,
      stage: 'plan',
      prompt: 'test',
      signal: new AbortController().signal,
    });
    expect(mock.query.mock.calls[0][0].options.maxBudgetUsd).toBe(5);
    expect(store.get<Run>('runs', 'one')?.usage).toEqual(usage);
    store.put('runs', {
      ...store.get<Run>('runs', 'one')!,
      status: 'complete',
      finishedAt: new Date().toISOString(),
    });
    store.put('runs', run('two'));
    mock.messages = [
      { ...result, subtype: 'error_max_budget_usd', total_cost_usd: 3.1, errors: [] },
    ];
    await expect(
      driver.execute({
        project,
        stage: 'plan',
        prompt: 'test',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('spending limit');
    expect(mock.query.mock.calls[1][0].options.maxBudgetUsd).toBe(3);
    expect(mock.query.mock.calls[1][0].options.resume).toBe('session');
    expect(store.get<Run>('runs', 'two')?.usage?.costUsd).toBe(3.1);
    expect(() => remainingBudget(projectRuns(store, project.id), 5)).toThrow('spending limit');
  } finally {
    store.close();
  }
});
it('blocks zero budgets and unknown costs, and counts error results and legacy history', async () => {
  expect(() => remainingBudget([], 0)).toThrow('spending limit');
  expect(remainingBudget([], null)).toBeUndefined();
  expect(() =>
    remainingBudget([{ ...run('unknown'), usageExpected: true, status: 'interrupted' }], 5),
  ).toThrow('unavailable');
  const store = await fixture();
  try {
    store.put('runs', {
      ...run('old'),
      usageExpected: undefined,
      startedAt: '2020-01-01T00:00:00.000Z',
      status: 'complete',
      finishedAt: '2099-01-01T00:00:00.000Z',
    });
    store.event(
      'agent_result',
      { stage: 'plan', estimatedCost: 1, usage: { input_tokens: 100 } },
      project.id,
    );
    expect(remainingBudget(projectRuns(store, project.id), 5)).toBe(4);
    const driver = new ClaudeDriver(store);
    store.put('runs', { ...run('new'), stage: 'review' });
    driver.record(
      {
        ...result,
        subtype: 'error_during_execution',
        total_cost_usd: 0,
        errors: [],
      } as unknown as SDKMessage,
      project.id,
      { id: 's', projectId: project.id, stage: 'review', createdAt: '' },
    );
    expect(store.get<Run>('runs', 'new')?.usage).toBeUndefined();
  } finally {
    store.close();
  }
});
