import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { api } from './api';
import type { UpdateState } from '../shared/types';

export function UpdatePanel() {
  const [state, setState] = useState<UpdateState & { available: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    api<UpdateState & { available: boolean }>('/app-update').then(
      (value) => current && setState(value),
      (error) => current && setError(error.message),
    );
    return () => {
      current = false;
    };
  }, []);
  const updating = state && ['checking', 'installing', 'restarting'].includes(state.status);
  return (
    <section className="panel application-updates">
      <div className="row update-heading">
        <Download size={20} />
        <h3>Application updates</h3>
      </div>
      <p className="muted">
        Get the latest version from FerrisOfficial/ai-native on GitHub. The application will install
        the update and restart automatically.
      </p>
      <p className="muted small">
        Pause active projects and stop their terminals first. Commit or move local application
        changes before updating.
      </p>
      {state && <p role="status">{state.message}</p>}
      {state?.revision && (
        <p className="muted small">
          Installed revision: <code>{state.revision.slice(0, 8)}</code>
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {updating && state.id ? (
        <a className="button primary" href={`/update-status?key=${state.id}`}>
          View update progress
        </a>
      ) : (
        <button
          className="button primary"
          disabled={busy || !state?.available}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const result = await api<{ url: string }>('/app-update', {});
              window.location.assign(result.url);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
          {busy ? 'Starting update…' : 'Update from GitHub'}
        </button>
      )}
    </section>
  );
}
