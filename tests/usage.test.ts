import { testDirectory } from './temp.js';
import { it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
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

it.each(['plan', 'implementation', 'review'] as const)(
  'auto approves tools in every stage while keeping planning questions interactive: %s',
  async (stage) => {
    const store = await fixture();
    try {
      const p = {
        ...project,
        budgetUsd: null,
        config: { autoApprove: true },
        choices: {
          plan: { skill: 'example-plan', model: 'default' },
          implementation: { skill: 'example-implement', model: 'default' },
          review: { skill: 'example-review', model: 'default' },
        },
      } as Project;
      const driver = new ClaudeDriver(store);
      mock.messages = [
        {
          ...result,
          structured_output:
            stage === 'plan'
              ? result.structured_output
              : stage === 'review'
                ? { summary: 'Reviewed', items: [] }
                : { summary: 'Implemented' },
        },
      ];
      await driver.execute({
        project: p,
        stage,
        prompt: 'test',
        signal: new AbortController().signal,
      });
      const options = mock.query.mock.calls.at(-1)![0].options;
      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.allowDangerouslySkipPermissions).toBe(true);
      expect(options.canUseTool).toBeTypeOf('function');
      // Claude settings can require approval even in bypassPermissions mode.
      // Simulate those requests reaching the SDK callback, not the PreToolUse hook.
      const signal = new AbortController().signal;
      for (const command of [
        "gh api graphql -f query='query { viewer { login } }'",
        'gh api repos/owner/repo/pulls/40/comments --paginate 2>&1 | head -300',
      ]) {
        const input = { command };
        expect(await options.canUseTool('Bash', input, { signal })).toEqual({
          behavior: 'allow',
          updatedInput: input,
        });
      }
      expect(await options.canUseTool('Bash', { command: 'git push' }, { signal })).toMatchObject({
        behavior: 'deny',
      });
      expect(store.all('questions')).toHaveLength(0);
      expect(options.disallowedTools.includes('AskUserQuestion')).toBe(stage !== 'plan');
      const hook = options.hooks.PreToolUse[0].hooks[0];
      const check = async (name: string, input: Record<string, unknown> = {}) =>
        (await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }))
          .hookSpecificOutput?.permissionDecision;
      expect(await check('Bash', { command: 'npm test' })).toBe('allow');
      expect(await check('PowerShell', { command: 'Get-ChildItem' })).toBe('allow');
      if (stage === 'plan') {
        const pending = hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'Which behavior?' }] },
        });
        const question = store.all<{ id: string }>('questions').at(-1)!;
        expect(question).toBeDefined();
        driver.answer(question.id, { answers: { 'Which behavior?': 'Keep existing behavior' } });
        const response = await pending;
        expect(response.hookSpecificOutput.permissionDecision).toBe('allow');
        expect(response.hookSpecificOutput.updatedInput.answers).toEqual({
          'Which behavior?': 'Keep existing behavior',
        });
      } else expect(await check('AskUserQuestion', { questions: [] })).toBe('deny');
      expect(options.systemPrompt.append).toContain(
        stage === 'plan' ? 'Use AskUserQuestion' : 'Work autonomously',
      );
      expect(await check('Bash', { command: 'git push' })).toBe('deny');
      if (stage !== 'implementation')
        expect(await check('Write', { file_path: 'a.txt', content: 'test' })).toBe('deny');
      const controller = new AbortController();
      expect(
        (
          await driver.permission(
            p,
            { id: 'session', projectId: p.id, stage, createdAt: '' },
            'Bash',
            { command: 'npm test' },
            controller.signal,
          )
        ).behavior,
      ).toBe('allow');
      expect(store.all('questions')).toHaveLength(stage === 'plan' ? 1 : 0);
      const answer = driver.permission(
        p,
        { id: 'session', projectId: p.id, stage, createdAt: '' },
        'AskUserQuestion',
        { questions: [] },
        controller.signal,
      );
      if (stage === 'plan') {
        expect(store.all('questions')).toHaveLength(2);
        controller.abort();
      } else {
        expect(store.all('questions')).toHaveLength(0);
      }
      expect((await answer).behavior).toBe('deny');
    } finally {
      store.close();
    }
  },
);
async function fixture() {
  const root = await testDirectory();
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

it('preserves a structured result across continuation results and uses the latest cumulative cost', async () => {
  const store = await fixture();
  try {
    const driver = new ClaudeDriver(store);
    store.put('runs', run('continuation'));
    mock.messages = [result, { ...result, structured_output: undefined, total_cost_usd: 2.5 }];
    await expect(
      driver.execute({
        project,
        stage: 'plan',
        prompt: 'test',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(result.structured_output);
    expect(store.get<Run>('runs', 'continuation')?.usage?.costUsd).toBe(2.5);
    expect(remainingBudget(projectRuns(store, project.id), 5)).toBe(2.5);
  } finally {
    store.close();
  }
});

it.each([
  { messages: [{ ...result, structured_output: undefined }], error: 'without a structured result' },
  { messages: [result, { ...result, structured_output: {} }], error: 'invalid structured result' },
  {
    messages: [result, { ...result, subtype: 'error_max_budget_usd', total_cost_usd: 5.2 }],
    error: 'spending limit',
  },
  {
    messages: [result, { ...result, is_error: true, result: 'explicit failure' }],
    error: 'explicit failure',
  },
])('fails clearly without hiding a later error: $error', async ({ messages, error }) => {
  const store = await fixture();
  try {
    store.put('runs', run('failure'));
    mock.messages = messages;
    await expect(
      new ClaudeDriver(store).execute({
        project,
        stage: 'plan',
        prompt: 'test',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(error);
  } finally {
    store.close();
  }
});

it('does not accept a child result or replace the resumable main session with it', async () => {
  const store = await fixture();
  try {
    store.put('runs', run('child'));
    mock.messages = [
      { type: 'system', subtype: 'init', session_id: 'main' },
      { ...result, session_id: 'child' },
      { ...result, session_id: 'main', structured_output: undefined },
    ];
    await expect(
      new ClaudeDriver(store).execute({
        project,
        stage: 'plan',
        prompt: 'test',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('without a structured result');
    expect(store.all<{ claudeId: string }>('sessions')[0].claudeId).toBe('main');
    expect(store.events(project.id).filter((e) => e.kind === 'agent_result')).toHaveLength(1);
  } finally {
    store.close();
  }
});

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

it('recovers a report with a run id and whole-tree tokens even when usageExpected is true', async () => {
  const store = await fixture();
  try {
    store.put('runs', { ...run('recover'), usageExpected: true });
    store.event(
      'agent_result',
      {
        runId: 'recover',
        stage: 'plan',
        estimatedCost: 2,
        usage: result.usage,
        modelUsage: result.modelUsage,
        apiDurationMs: 500,
      },
      project.id,
    );
    expect(projectRuns(store, project.id)[0].usage).toEqual(usage);
  } finally {
    store.close();
  }
});
it('remembers exact commands per repo, supports revocation, and keeps lifecycle guards', async () => {
  const store = await fixture();
  try {
    const { savedCommands, findCommand } = await import('../server/permissions.js');
    const p = { ...project, repoId: 'repo', budgetUsd: null };
    store.put('projects', p);
    store.put('repositories', { id: 'repo' });
    const driver = new ClaudeDriver(store);
    const session = { id: 's', projectId: p.id, stage: 'plan' as const, createdAt: '' };
    const signal = new AbortController().signal;
    const input = { command: 'npm test', description: 'Test' };
    const pending = driver.permission(p, session, 'Bash', input, signal);
    const question = store.all<{ id: string }>('questions').at(-1)!;
    driver.answer(question.id, { allow: true, remember: true });
    expect((await pending).behavior).toBe('allow');
    expect(savedCommands(store, 'repo')).toHaveLength(1);
    expect(
      (await driver.permission(p, session, 'Bash', { ...input, description: 'Again' }, signal))
        .behavior,
    ).toBe('allow');
    expect(findCommand(store, { ...p, repoId: 'other' }, 'Bash', input)).toBeUndefined();
    expect(findCommand(store, p, 'Bash', { command: 'npm test && echo extra' })).toBeUndefined();
    expect(findCommand(store, p, 'Bash', { ...input, run_in_background: true })).toBeUndefined();
    mock.messages = [result];
    await driver.execute({ project: p, stage: 'plan', prompt: 'test', signal });
    const hook = mock.query.mock.calls.at(-1)![0].options.hooks.PreToolUse[0].hooks[0];
    expect(
      (await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: input }))
        .hookSpecificOutput.permissionDecision,
    ).toBe('allow');
    expect(
      (
        await hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git push' },
        })
      ).hookSpecificOutput.permissionDecision,
    ).toBe('deny');
    const permission = savedCommands(store, 'repo')[0];
    store.put('command_permissions', { ...permission, revokedAt: new Date().toISOString() });
    expect(findCommand(store, p, 'Bash', input)).toBeUndefined();
    for (const allow of [false, true]) {
      const next = driver.permission(p, session, 'Bash', input, signal);
      driver.answer(store.all<{ id: string }>('questions').at(-1)!.id, { allow });
      expect((await next).behavior).toBe(allow ? 'allow' : 'deny');
      expect(savedCommands(store, 'repo')).toHaveLength(0);
    }
  } finally {
    store.close();
  }
});

it('saves prefix approvals from questions and applies them across arguments without widening repo or options', async () => {
  const store = await fixture();
  try {
    const { findCommand, savedCommands } = await import('../server/permissions.js');
    const p = { ...project, repoId: 'prefix-repo', budgetUsd: null };
    store.put('projects', p);
    store.put('repositories', { id: p.repoId });
    const driver = new ClaudeDriver(store);
    const session = {
      id: 'prefix-session',
      projectId: p.id,
      stage: 'plan' as const,
      createdAt: '',
    };
    const signal = new AbortController().signal;
    const pending = driver.permission(
      p,
      session,
      'Bash',
      { command: 'grep first README.md' },
      signal,
    );
    const question = store.all<{ id: string }>('questions').at(-1)!;
    expect(() =>
      driver.answer(question.id, { allow: true, remember: true, commandPrefix: 'rm' }),
    ).toThrow('prefix');
    driver.answer(question.id, { allow: true, remember: true, commandPrefix: 'grep' });
    expect((await pending).behavior).toBe('allow');
    expect(savedCommands(store, p.repoId)[0]).toMatchObject({ scope: 'prefix', prefix: 'grep' });
    expect(
      (
        await driver.permission(
          p,
          session,
          'Bash',
          { command: 'grep second file.txt', timeout: 10000 },
          signal,
        )
      ).behavior,
    ).toBe('allow');
    expect(
      findCommand(store, { ...p, repoId: 'different' }, 'Bash', {
        command: 'grep second file.txt',
      }),
    ).toBeUndefined();
    expect(
      findCommand(store, p, 'PowerShell', { command: 'grep second file.txt' }),
    ).toBeUndefined();
    expect(
      findCommand(store, p, 'Bash', { command: 'grep second file.txt', run_in_background: true }),
    ).toBeUndefined();
    expect(
      findCommand(store, p, 'Bash', { command: 'grep second file.txt && whoami' }),
    ).toBeUndefined();
    mock.messages = [result];
    await driver.execute({ project: p, stage: 'plan', prompt: 'test', signal });
    const hook = mock.query.mock.calls.at(-1)![0].options.hooks.PreToolUse[0].hooks[0];
    expect(
      (
        await hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'grep third file' },
        })
      ).hookSpecificOutput.permissionDecision,
    ).toBe('allow');
    expect(
      (
        await hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'grep third file && git push' },
        })
      ).hookSpecificOutput.permissionDecision,
    ).toBe('deny');
    const permission = savedCommands(store, p.repoId)[0];
    store.put('command_permissions', { ...permission, revokedAt: new Date().toISOString() });
    expect(findCommand(store, p, 'Bash', { command: 'grep second file.txt' })).toBeUndefined();
  } finally {
    store.close();
  }
});

it('batch approval unblocks concurrent matching questions, validates all rules before saving and keeps other repos pending', async () => {
  const store = await fixture();
  try {
    const { savedCommands } = await import('../server/permissions.js');
    const p = { ...project, repoId: 'batch' };
    const other = { ...p, id: 'other', repoId: 'other' };
    store.put('repositories', { id: 'batch' });
    store.put('repositories', { id: 'other' });
    store.put('projects', p);
    store.put('projects', other);
    const driver = new ClaudeDriver(store);
    const control = new AbortController();
    const session = { id: 's', projectId: p.id, stage: 'plan' as const, createdAt: '' };
    const one = driver.permission(
      p,
      session,
      'Bash',
      { command: 'grep first file && git status' },
      control.signal,
    );
    const first = store.all<{ id: string }>('questions').at(-1)!.id;
    const two = driver.permission(
      p,
      session,
      'Bash',
      { command: 'grep second file | git status --short' },
      control.signal,
    );
    const third = driver.permission(
      other,
      { ...session, projectId: other.id },
      'Bash',
      { command: 'grep first file' },
      control.signal,
    );
    expect(() =>
      driver.answer(first, { allow: true, remember: true, commandPrefixes: ['grep', 'rm'] }),
    ).toThrow('prefix');
    expect(savedCommands(store, p.repoId)).toHaveLength(0);
    driver.answer(first, { allow: true, remember: true, commandPrefixes: ['grep', 'git status'] });
    expect((await one).behavior).toBe('allow');
    expect((await two).behavior).toBe('allow');
    expect(driver.pending.size).toBe(1);
    expect(store.events(p.id).some((e) => e.kind === 'command_permission_used')).toBe(true);
    control.abort();
    expect((await third).behavior).toBe('deny');
    expect(driver.pending.size).toBe(0);
    expect(
      (
        await driver.permission(
          p,
          session,
          'Bash',
          { command: 'git -C repo push' },
          new AbortController().signal,
        )
      ).behavior,
    ).toBe('deny');
    expect(
      (
        await driver.permission(
          p,
          session,
          'Write',
          { file_path: 'x' },
          new AbortController().signal,
        )
      ).behavior,
    ).toBe('deny');
  } finally {
    store.close();
  }
});

it('retains legacy exact rules and new prefixes after restart, including revocation', async () => {
  const { rememberCommand, findCommand, commandSignature } =
    await import('../server/permissions.js');
  const root = await testDirectory();
  const file = join(root, 'state.sqlite');
  let store = new Store(file);
  const p = { repoId: 'restart' };
  try {
    store.put('repositories', { id: p.repoId });
    const input = { command: 'echo legacy' };
    store.put('command_permissions', {
      id: 'legacy',
      repoId: p.repoId,
      tool: 'Bash',
      input,
      signature: commandSignature('Bash', input),
      createdAt: '',
    });
    const rule = rememberCommand(store, p, 'Bash', { command: 'grep x' }, 'grep');
    store.close();
    store = new Store(file);
    expect(findCommand(store, p, 'Bash', { command: 'echo legacy', timeout: 42 })?.id).toBe(
      'legacy',
    );
    expect(findCommand(store, p, 'Bash', { command: 'grep y' })?.id).toBe(rule.id);
    store.put('command_permissions', { ...rule, revokedAt: new Date().toISOString() });
    store.close();
    store = new Store(file);
    expect(findCommand(store, p, 'Bash', { command: 'grep y' })).toBeUndefined();
  } finally {
    store.close();
  }
});
