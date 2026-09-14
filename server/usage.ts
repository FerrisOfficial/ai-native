import type { Run } from '../shared/types.js';
import type { Store } from './store.js';

export function projectRuns(store: Store, projectId: string): Run[] {
  const runs = store.all<Run>('runs').filter((r) => r.projectId === projectId);
  // Older versions stored successful SDK results only in the event history.
  const events = store.db
    .prepare(
      "SELECT data, createdAt FROM events WHERE projectId=? AND kind='agent_result' ORDER BY seq",
    )
    .all(projectId);
  return runs.map((run) => {
    if (run.usage || run.usageExpected === false) return run;
    const event = events.find((e) => {
      const data = JSON.parse(e.data as string);
      return (
        (data.runId ? data.runId === run.id : data.stage === run.stage) &&
        (e.createdAt as string) >= run.startedAt &&
        (e.createdAt as string) <= (run.finishedAt ?? '9999') &&
        typeof data.estimatedCost === 'number'
      );
    });
    if (!event) return run;
    const data = JSON.parse(event.data as string);
    const models = Object.values(data.modelUsage ?? {}) as Record<string, number>[];
    const tokens = (modelKey: string, legacyKey: string) =>
      models.length
        ? models.reduce((sum, model) => sum + (model[modelKey] ?? 0), 0)
        : (data.usage?.[legacyKey] ?? 0);
    return {
      ...run,
      usage: {
        costUsd: data.estimatedCost,
        inputTokens: tokens('inputTokens', 'input_tokens'),
        outputTokens: tokens('outputTokens', 'output_tokens'),
        cacheReadTokens: tokens('cacheReadInputTokens', 'cache_read_input_tokens'),
        cacheWriteTokens: tokens('cacheCreationInputTokens', 'cache_creation_input_tokens'),
        apiDurationMs: data.apiDurationMs ?? 0,
      },
    };
  });
}
export function remainingBudget(runs: Run[], limit?: number | null): number | undefined {
  if (limit == null) return undefined;
  if (
    runs.some(
      (r) =>
        ['plan', 'implementation', 'review'].includes(r.stage) &&
        r.usageExpected !== false &&
        !r.usage,
    )
  )
    throw new Error(
      'Cost is unavailable for a previous Claude attempt. Clear the project budget to explicitly continue without a reliable spending limit.',
    );
  const remaining = limit - runs.reduce((sum, r) => sum + (r.usage?.costUsd ?? 0), 0);
  if (remaining <= 0)
    throw new Error(
      'Project spending limit reached. Increase or clear the budget in Overview, then Resume.',
    );
  return remaining;
}
