import { useEffect, useState } from 'react';
import type { ProjectDetail } from '../shared/types';

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const dollars = (n: number) => `$${n.toFixed(4)}`;
export function UsagePanel({
  detail,
  saveBudget,
  busy,
}: {
  detail: ProjectDetail;
  saveBudget: (budget: number | null) => Promise<unknown>;
  busy: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [budget, setBudget] = useState(detail.project.budgetUsd?.toString() ?? '');
  useEffect(
    () => setBudget(detail.project.budgetUsd?.toString() ?? ''),
    [detail.project.id, detail.project.budgetUsd],
  );
  useEffect(() => {
    if (!detail.runs.some((r) => r.status === 'running')) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [detail.runs]);
  const cost = detail.runs.reduce((sum, r) => sum + (r.usage?.costUsd ?? 0), 0);
  const tokens = detail.runs.reduce(
    (sum, r) =>
      sum +
      (r.usage
        ? r.usage.inputTokens +
          r.usage.outputTokens +
          r.usage.cacheReadTokens +
          r.usage.cacheWriteTokens
        : 0),
    0,
  );
  const elapsed = (r: ProjectDetail['runs'][number]) =>
    r.finishedAt
      ? Date.parse(r.finishedAt) - Date.parse(r.startedAt)
      : r.status === 'running'
        ? now - Date.parse(r.startedAt)
        : null;
  const unknown = detail.runs.some(
    (r) =>
      ['plan', 'implementation', 'review'].includes(r.stage) &&
      !r.usage &&
      r.usageExpected !== false,
  );
  const running = ['running', 'queued'].includes(detail.project.status);
  return (
    <section className="panel usage-panel">
      <h3>Cost & time</h3>
      <div className="usage-totals">
        <div>
          <strong>{dollars(cost)}</strong>
          <small>Reported estimated cost{unknown ? ' · incomplete' : ''}</small>
        </div>
        <div>
          <strong>{tokens.toLocaleString()}</strong>
          <small>Reported tokens, including cache</small>
        </div>
        <div>
          <strong>{duration(detail.runs.reduce((s, r) => s + (elapsed(r) ?? 0), 0))}</strong>
          <small>Stage time, including tool waits</small>
        </div>
      </div>
      <div className="usage-table-scroll">
        <table className="usage-table">
          <thead>
            <tr>
              <th>Stage / attempt</th>
              <th>Time</th>
              <th>Input / output</th>
              <th>Cache read / write</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {detail.runs.map((r, i) => (
              <tr key={r.id}>
                <td>
                  {r.stage} #{i + 1}
                  <small>{r.status}</small>
                </td>
                <td>{elapsed(r) == null ? 'Unavailable' : duration(elapsed(r)!)}</td>
                <td>
                  {r.usage
                    ? `${r.usage.inputTokens.toLocaleString()} / ${r.usage.outputTokens.toLocaleString()}`
                    : '—'}
                </td>
                <td>
                  {r.usage
                    ? `${r.usage.cacheReadTokens.toLocaleString()} / ${r.usage.cacheWriteTokens.toLocaleString()}`
                    : '—'}
                </td>
                <td>
                  {r.usage
                    ? dollars(r.usage.costUsd)
                    : r.usageExpected === false
                      ? 'No Claude call'
                      : ['prepare', 'test', 'publish'].includes(r.stage)
                        ? 'N/A'
                        : r.status === 'running'
                          ? 'Pending'
                          : 'Unavailable'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Usage arrives when each Claude call ends, including error results. SDK estimates are not
        billing totals or additional subscription charges. The final request may exceed the limit.
      </p>
      {unknown && (
        <p className="notice">
          Some usage is pending or unavailable. Missing costs are not counted as zero; a limited
          project stops before another call if an earlier cost remains unknown.
        </p>
      )}
      <form
        className="budget-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveBudget(budget.trim() ? Number(budget) : null);
        }}
      >
        <label className="field">
          <span>Project spending limit (USD)</span>
          <input
            aria-label="Project spending limit (USD)"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            placeholder="No limit"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={busy || running}
          />
        </label>
        <button className="button" type="submit" disabled={busy || running}>
          Save budget
        </button>
      </form>
      <p className="muted">
        {detail.project.budgetUsd == null
          ? 'No spending limit.'
          : `Limit: ${dollars(detail.project.budgetUsd)} · Remaining from reported costs: ${dollars(Math.max(0, detail.project.budgetUsd - cost))}.`}{' '}
        Pause a running stage before editing. Clear the field to remove the limit. Saving does not
        resume work automatically.
      </p>
    </section>
  );
}
