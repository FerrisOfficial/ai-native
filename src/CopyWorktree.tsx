import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyWorktree({ path }: { path: string }) {
  const [status, setStatus] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <div className="worktree-copy">
      <button
        className="worktree-copy-button"
        title="Copy worktree path"
        aria-label={`Copy worktree path: ${path}`}
        disabled={copying}
        onClick={async () => {
          setCopying(true);
          try {
            await navigator.clipboard.writeText(path);
            setStatus('Path copied');
          } catch {
            setStatus('Could not copy. Select the path and copy it manually.');
          } finally {
            setCopying(false);
          }
        }}
      >
        <span className="path">{path}</span>
        {status === 'Path copied' ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <small role="status" aria-live="polite">
        {status || 'Click to copy path'}
      </small>
    </div>
  );
}
