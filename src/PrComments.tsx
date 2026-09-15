import { useEffect, useState } from 'react';
import { GitPullRequest, LoaderCircle } from 'lucide-react';
import type { Project, PullRequestSnapshot, ReplyDraft } from '../shared/types';
import { api } from './api';

export type PrPreview = {
  pullRequest: PullRequestSnapshot;
  fingerprint: string;
  key: string;
  selected: string[];
};
const displayComment = (body: string) => body.replace(/<!-- ai-native:[^\r\n]*? -->/g, '').trim();
export function PrPicker({
  repoId,
  url,
  preview,
  onChange,
}: {
  repoId: string;
  url: string;
  preview?: PrPreview;
  onChange: (value: PrPreview) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="pr-comments-panel">
      <p>
        Load inline review threads and PR conversation comments using your GitHub CLI login. Choose
        which comments this project should address.
      </p>
      <button
        type="button"
        disabled={busy || !url.trim()}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const result = await api<{ pullRequest: PullRequestSnapshot; fingerprint: string }>(
              '/pull-requests/preview',
              { repoId, url },
            );
            onChange({
              ...result,
              key: `${repoId}\0${url}`,
              selected: result.pullRequest.threads
                .filter((t) => t.kind === 'review' && !t.isResolved)
                .map((t) => t.id),
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <LoaderCircle size={14} className="spin" /> : <GitPullRequest size={14} />}{' '}
        {busy ? 'Loading comments…' : 'Load PR comments'}
      </button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {preview && (
        <>
          <h3>
            #{preview.pullRequest.number} · {preview.pullRequest.title}
          </h3>
          <p>
            {preview.pullRequest.headBranch} · {preview.selected.length} selected
          </p>
          <div className="pr-thread-list">
            {preview.pullRequest.threads.map((thread) => (
              <label className="pr-thread-option" key={thread.id}>
                <input
                  type="checkbox"
                  checked={preview.selected.includes(thread.id)}
                  onChange={(e) =>
                    onChange({
                      ...preview,
                      selected: e.target.checked
                        ? [...preview.selected, thread.id]
                        : preview.selected.filter((id) => id !== thread.id),
                    })
                  }
                />
                <div>
                  <strong>
                    {thread.kind === 'review'
                      ? `${thread.path}${thread.line ? ':' + thread.line : ''}`
                      : 'PR conversation'}
                    {thread.isResolved ? ' · Resolved' : ''}
                  </strong>
                  {thread.comments.map((comment) => (
                    <div key={comment.id}>
                      <a href={comment.url} target="_blank" rel="noreferrer">
                        {comment.author}
                      </a>
                      <pre>{displayComment(comment.body)}</pre>
                    </div>
                  ))}
                </div>
              </label>
            ))}
            {!preview.pullRequest.threads.length && (
              <p>No review threads or conversation comments found.</p>
            )}
          </div>
          <p>
            A separate worktree starts at this PR’s current commit. Publication updates the existing
            PR. Fork PRs are not supported yet.
          </p>
        </>
      )}
    </section>
  );
}

export function PrReplies({
  project,
  busy,
  save,
  onDirtyChange,
}: {
  project: Project;
  busy: boolean;
  save: (replies: ReplyDraft[]) => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState(project.replies ?? []);
  const editable = project.status === 'awaiting_result';
  const dirty = JSON.stringify(drafts) !== JSON.stringify(project.replies ?? []);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const update = (index: number, change: Partial<ReplyDraft>) =>
    setDrafts((current) => current.map((r, i) => (i === index ? { ...r, ...change } : r)));
  return (
    <section className="panel pr-comments-panel">
      <h3>
        <GitPullRequest size={18} /> GitHub replies
      </h3>
      <p>
        Review the replies below. Publication sends these after pushing the approved code and adds
        the commit SHA. Editing a reply sends it through review again.
      </p>
      {drafts.map((reply, index) => {
        const thread = project.pullRequest!.threads.find((t) => t.id === reply.threadId)!;
        return (
          <div className="pr-reply" key={reply.threadId}>
            <a href={thread.comments[0]?.url} target="_blank" rel="noreferrer">
              {thread.path ?? 'PR conversation'}
              {thread.line ? ':' + thread.line : ''}
            </a>
            <details>
              <summary>Original discussion ({thread.comments.length})</summary>
              {thread.comments.map((c) => (
                <div key={c.id}>
                  <strong>{c.author}</strong>
                  <pre>{displayComment(c.body)}</pre>
                </div>
              ))}
            </details>
            <label>
              Decision
              <select
                disabled={!editable || busy}
                value={reply.decision}
                onChange={(e) =>
                  update(index, { decision: e.target.value as ReplyDraft['decision'] })
                }
              >
                <option value="fix">Code fix</option>
                <option value="explain">Explain without changing code</option>
                <option value="clarify">Request clarification</option>
              </select>
            </label>
            <label>
              GitHub action
              <select
                disabled={!editable || busy}
                value={reply.updateCommentId ?? ''}
                onChange={(e) => update(index, { updateCommentId: e.target.value || undefined })}
              >
                <option value="">Post a new reply</option>
                {thread.comments
                  .filter((c) => c.viewerCanUpdate)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      Edit comment by {c.author}: {c.body.slice(0, 70)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Reply
              <textarea
                aria-label={`Reply ${index + 1}`}
                rows={5}
                maxLength={50000}
                disabled={!editable || busy}
                value={reply.body}
                onChange={(e) => update(index, { body: e.target.value })}
              />
            </label>
            {thread.kind === 'review' && (
              <label className="row">
                <input
                  type="checkbox"
                  disabled={!editable || busy}
                  checked={reply.resolve}
                  onChange={(e) => update(index, { resolve: e.target.checked })}
                />
                Mark thread as resolved after publishing
              </label>
            )}
            {reply.commentId && <p>Reply published{reply.resolved ? ' · Thread resolved' : ''}</p>}
          </div>
        );
      })}
      {editable && (
        <button
          type="button"
          disabled={busy || !dirty || drafts.some((r) => !r.body.trim())}
          onClick={() => void save(drafts)}
        >
          Save replies & run review
        </button>
      )}
      {dirty && (
        <p role="status">
          Unsaved reply edits. Save and review them before approving publication; only saved replies
          will be published.
        </p>
      )}
    </section>
  );
}
