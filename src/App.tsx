import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Archive,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  CodeXml,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Layers2,
  LayoutDashboard,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import MarkdownBase from 'react-markdown';
import type {
  Choices,
  Project,
  ProjectDetail,
  Question,
  Repository,
  RepoInput,
  Skill,
  Snapshot,
  TerminalRecord,
  WorkflowEvent,
} from '../shared/types';
import { api, bootstrap } from './api';
const LazyTerminalView = lazy(() => import('./TerminalView'));
function Markdown({ children }: { children: string }) {
  return (
    <MarkdownBase
      disallowedElements={['img']}
      components={{ a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
    >
      {children}
    </MarkdownBase>
  );
}
function TerminalView(props: React.ComponentProps<typeof LazyTerminalView>) {
  return (
    <Suspense fallback={<div className="loading">Loading terminal…</div>}>
      <LazyTerminalView {...props} />
    </Suspense>
  );
}

type Page = 'board' | 'repositories' | 'skills' | 'settings';
type Tab = 'Overview' | 'Plan' | 'Conversations' | 'Review' | 'Terminals';
const columns = ['New', 'Planning', 'Implementation', 'Verification', 'Needs input', 'Published'];
const stageNames: Record<string, string> = {
  prepare: 'Prepare workspace',
  plan: 'Plan',
  implementation: 'Implement',
  test: 'Test',
  review: 'Review',
  publish: 'Publish',
};
const emptySnapshot: Snapshot = {
  repositories: [],
  projects: [],
  skills: [],
  concurrency: 2,
  active: 0,
};
function column(p: Project, pending = false) {
  if (pending || ['awaiting_plan', 'awaiting_result', 'blocked', 'interrupted'].includes(p.status))
    return 'Needs input';
  if (p.status === 'published') return 'Published';
  return {
    prepare: 'New',
    plan: 'Planning',
    implementation: 'Implementation',
    test: 'Verification',
    review: 'Verification',
    publish: 'Verification',
  }[p.stage];
}
function age(value: string) {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  return mins < 1
    ? 'Just now'
    : mins < 60
      ? `${mins}m ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button ${primary ? 'primary' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={close}>
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
const defaultChoices = (): Choices => ({
  plan: { skill: '', model: 'default' },
  implementation: { skill: '', model: 'default' },
  review: { skill: '', model: 'default' },
});

function ChoicesFields({
  value,
  change,
  skills,
  models,
}: {
  value: Choices;
  change: (c: Choices) => void;
  skills: Skill[];
  models: { value: string; displayName: string }[];
}) {
  return (
    <div className="stage-choices">
      {(['plan', 'implementation', 'review'] as const).map((stage, index) => (
        <div className="stage-choice" key={stage}>
          <div className="stage-number">{index + 1}</div>
          <strong>{stageNames[stage]}</strong>
          <Field label="Skill">
            <select
              value={value[stage].skill}
              onChange={(e) =>
                change({ ...value, [stage]: { ...value[stage], skill: e.target.value } })
              }
              required
            >
              <option value="">Choose a skill</option>
              {skills
                .filter((s) => s.valid)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Model">
            <input
              list="claude-models"
              value={value[stage].model}
              onChange={(e) =>
                change({ ...value, [stage]: { ...value[stage], model: e.target.value } })
              }
              required
              placeholder="default"
            />
          </Field>
        </div>
      ))}
      <datalist id="claude-models">
        {models.map((m) => (
          <option key={m.value} value={m.value}>
            {m.displayName}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function RepositoryForm({
  initial,
  skills,
  models,
  close,
  save,
}: {
  initial?: Repository;
  skills: Skill[];
  models: { value: string; displayName: string }[];
  close: () => void;
  save: (repo: RepoInput, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<RepoInput>(
    initial ?? {
      name: '',
      path: '',
      baseBranch: '',
      setupCommand: '',
      testCommand: '',
      copyFiles: [],
      terminals: [],
      choices: defaultChoices(),
    },
  );
  const [files, setFiles] = useState(initial?.copyFiles.join('\n') ?? '');
  const [envText, setEnvText] = useState<string[]>(
    initial?.terminals.map((t) =>
      Object.entries(t.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    ) ?? [],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const update = (key: keyof RepoInput, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const terminals = form.terminals.map((t, i) => ({
        ...t,
        env: Object.fromEntries(
          (envText[i] ?? '')
            .split('\n')
            .filter((l) => l.trim())
            .map((line) => {
              const pos = line.indexOf('=');
              if (pos < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, pos)))
                throw new Error('Environment variables must use NAME=value, one per line');
              return [line.slice(0, pos), line.slice(pos + 1)];
            }),
        ),
      }));
      await save(
        {
          ...form,
          terminals,
          copyFiles: files
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean),
        },
        initial?.id,
      );
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? 'Repository settings' : 'Add a repository'}
      subtitle="Configure once. Every new project gets its own copy."
      close={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-grid">
            <Field label="Name">
              <input
                autoFocus
                required
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="My application"
              />
            </Field>
            <Field label="Base branch" hint="Leave empty to detect origin's default branch.">
              <input
                value={form.baseBranch}
                onChange={(e) => update('baseBranch', e.target.value)}
                placeholder="Auto-detect"
              />
            </Field>
          </div>
          <Field label="Local repository path">
            <input
              required
              value={form.path}
              onChange={(e) => update('path', e.target.value)}
              placeholder="C:\Users\you\Repos\my-app"
            />
          </Field>
          <h3 className="section-heading">Workflow defaults</h3>
          <ChoicesFields
            value={form.choices}
            change={(c) => update('choices', c)}
            skills={skills}
            models={models}
          />
          {!skills.some((s) => s.valid) && (
            <div className="notice">
              Add skills to the application's skills folder first. All three stages require a valid
              skill.
            </div>
          )}
          <h3 className="section-heading">Workspace setup</h3>
          <Field
            label="Setup command"
            hint="Runs once in a new worktree, before the named terminals start."
          >
            <textarea
              rows={2}
              value={form.setupCommand}
              onChange={(e) => update('setupCommand', e.target.value)}
              placeholder="npm ci"
            />
          </Field>
          <Field
            label="Test command"
            hint="No command means Not configured, rather than a passed test."
          >
            <input
              value={form.testCommand}
              onChange={(e) => update('testCommand', e.target.value)}
              placeholder="npm test"
            />
          </Field>
          <Field
            label="Local files to copy"
            hint="One relative file path per line. Use this for .env or local Claude/MCP settings. Tracked files cannot be overwritten. Copied files are excluded from publication."
          >
            <textarea
              rows={3}
              value={files}
              onChange={(e) => setFiles(e.target.value)}
              placeholder={'.env\n.claude/settings.local.json'}
            />
          </Field>
          <div className="section-heading row">
            <h3>Named terminals</h3>
            <Button
              disabled={form.terminals.length >= 8}
              onClick={() => {
                update('terminals', [
                  ...form.terminals,
                  { id: crypto.randomUUID(), name: '', command: '', env: {} },
                ]);
                setEnvText([...envText, '']);
              }}
            >
              <Plus size={14} /> Add terminal
            </Button>
          </div>
          <p className="muted small">
            These start after setup. Each terminal gets its own PORT within the project's reserved
            range.
          </p>
          {form.terminals.map((terminal, i) => (
            <div className="terminal-config" key={terminal.id}>
              <div className="row">
                <Field label="Name">
                  <input
                    required
                    value={terminal.name}
                    onChange={(e) =>
                      update(
                        'terminals',
                        form.terminals.map((t, j) =>
                          j === i ? { ...t, name: e.target.value } : t,
                        ),
                      )
                    }
                    placeholder="Frontend"
                  />
                </Field>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove terminal"
                  onClick={() => {
                    update(
                      'terminals',
                      form.terminals.filter((_, j) => i !== j),
                    );
                    setEnvText(envText.filter((_, j) => i !== j));
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <Field label="PowerShell command">
                <input
                  value={terminal.command}
                  onChange={(e) =>
                    update(
                      'terminals',
                      form.terminals.map((t, j) =>
                        j === i ? { ...t, command: e.target.value } : t,
                      ),
                    )
                  }
                  placeholder="npm run dev -- --port $env:PORT"
                />
              </Field>
              <Field label="Environment variables">
                <textarea
                  rows={2}
                  value={envText[i] ?? ''}
                  onChange={(e) =>
                    setEnvText(envText.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  placeholder="NODE_ENV=development"
                />
              </Field>
            </div>
          ))}
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" primary disabled={busy || !skills.some((s) => s.valid)}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
            {initial ? 'Save settings' : 'Add repository'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function NewProject({
  repositories,
  skills,
  models,
  close,
  create,
}: {
  repositories: Repository[];
  skills: Skill[];
  models: { value: string; displayName: string }[];
  close: () => void;
  create: (body: unknown) => Promise<void>;
}) {
  const [repoId, setRepoId] = useState(repositories[0]?.id ?? ''),
    [name, setName] = useState(''),
    [ticketUrl, setTicketUrl] = useState('');
  const [choices, setChoices] = useState(repositories[0]?.choices ?? defaultChoices()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Start a project"
      subtitle="One ticket. One worktree. A clear path to a pull request."
      close={close}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await create({ repoId, name, ticketUrl, choices });
            close();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Repository">
            <select
              required
              value={repoId}
              onChange={(e) => {
                setRepoId(e.target.value);
                setChoices(repositories.find((r) => r.id === e.target.value)!.choices);
              }}
            >
              {repositories.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project name">
            <input
              autoFocus
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Add team invitations"
            />
          </Field>
          <Field
            label="Ticket URL"
            hint="The planning skill retrieves the ticket through your existing MCP or CLI tools."
          >
            <input
              required
              type="url"
              value={ticketUrl}
              onChange={(e) => setTicketUrl(e.target.value)}
              placeholder="https://linear.app/your-team/issue/…"
            />
          </Field>
          <h3 className="section-heading">Skills & models</h3>
          <ChoicesFields value={choices} change={setChoices} skills={skills} models={models} />
          <div className="notice soft">
            <ShieldCheck size={18} />
            <span>
              You'll approve the plan before implementation and the result before publication.
            </span>
          </div>
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" primary disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />} Create &
            start
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function QuestionCard({
  question,
  answer,
}: {
  question: Question;
  answer: (id: string, value: unknown) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const questions = (question.input.questions ?? []) as {
    question: string;
    header?: string;
    options?: { label: string; description?: string }[];
    multiSelect?: boolean;
  }[];
  const submit = async (body: unknown) => {
    setBusy(true);
    try {
      await answer(question.id, body);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="question-card">
      <div className="row">
        <CircleHelp size={18} />
        <strong>
          {question.kind === 'permission' ? 'Claude needs permission' : 'Claude has a question'}
        </strong>
      </div>
      {question.kind === 'permission' ? (
        <>
          <p className="muted">{question.tool}</p>
          <pre>{JSON.stringify(question.input, null, 2)}</pre>
          <div className="row">
            <Button onClick={() => submit({ allow: false })} disabled={busy}>
              Deny
            </Button>
            <Button onClick={() => submit({ allow: true })} disabled={busy} primary>
              Allow once
            </Button>
          </div>
        </>
      ) : (
        <>
          {questions.map((q, i) => (
            <div key={i}>
              <h4>{q.question}</h4>
              <div className="answer-options">
                {q.options?.map((o) => (
                  <button
                    key={o.label}
                    className={`answer-option ${answers[q.question]?.split(', ').includes(o.label) ? 'selected' : ''}`}
                    onClick={() =>
                      setAnswers({
                        ...answers,
                        [q.question]: q.multiSelect
                          ? (answers[q.question]?.split(', ').includes(o.label)
                              ? answers[q.question].split(', ').filter((v) => v !== o.label)
                              : [
                                  ...(answers[q.question] ? answers[q.question].split(', ') : []),
                                  o.label,
                                ]
                            ).join(', ')
                          : o.label,
                      })
                    }
                  >
                    <strong>{o.label}</strong>
                    {o.description && <small>{o.description}</small>}
                  </button>
                ))}
              </div>
              <input
                aria-label={`Answer: ${q.question}`}
                placeholder="Or type your answer…"
                value={answers[q.question] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.question]: e.target.value })}
              />
            </div>
          ))}
          <Button
            primary
            disabled={busy || questions.some((q) => !answers[q.question]?.trim())}
            onClick={() => submit({ answers })}
          >
            Send answers <ArrowRight size={15} />
          </Button>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot),
    [page, setPage] = useState<Page>('board');
  const [detail, setDetail] = useState<ProjectDetail>(),
    [selectedId, setSelectedId] = useState<string>(),
    [tab, setTab] = useState<Tab>('Overview');
  const [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [showArchived, setShowArchived] = useState(false);
  const [repoModal, setRepoModal] = useState<Repository | 'new'>(),
    [projectModal, setProjectModal] = useState(false),
    [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(''),
    [selectedItems, setSelectedItems] = useState<string[]>([]),
    [terminalId, setTerminalId] = useState<string>(),
    [conversationStage, setConversationStage] = useState('all');
  const [models, setModels] = useState<{ value: string; displayName: string }[]>([
    { value: 'default', displayName: 'Claude default' },
  ]);
  const [diagnostics, setDiagnostics] =
      useState<Record<string, { ok: boolean; message: string }>>(),
    [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false),
    [streamText, setStreamText] = useState('');
  const [pendingProjects, setPendingProjects] = useState(new Set<string>());
  const ws = useRef<WebSocket | null>(null),
    live = useRef(new Set<(data: any) => void>()),
    selectedRef = useRef(selectedId),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  selectedRef.current = selectedId;
  const refresh = useCallback(async () => {
    const next = await api<Snapshot>('/snapshot');
    setSnapshot(next);
    setPendingProjects(new Set(next.pendingProjectIds ?? []));
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    const next = await api<ProjectDetail>(`/projects/${id}`);
    if (selectedRef.current !== id) return;
    setDetail(next);
    let batch = next.events;
    while (batch.length === 500) {
      batch = await api<WorkflowEvent[]>(`/projects/${id}/events?after=${batch.at(-1)!.seq}`);
      if (selectedRef.current !== id) return;
      if (batch.length)
        setDetail((old) =>
          old?.project.id === id
            ? {
                ...old,
                events: [
                  ...new Map([...old.events, ...batch].map((e) => [e.seq, e])).values(),
                ].sort((a, b) => a.seq - b.seq),
              }
            : old,
        );
    }
  }, []);
  useEffect(() => {
    let disposed = false,
      reconnect: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        await bootstrap();
        if (disposed) return;
        await refresh();
        const socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
        );
        ws.current = socket;
        socket.onopen = () => {
          setConnected(true);
          if (selectedRef.current) void loadDetail(selectedRef.current);
        };
        socket.onmessage = (message) => {
          const payload = JSON.parse(message.data);
          if (payload.type === 'error') {
            setError(payload.error);
            return;
          }
          if (payload.type === 'live') {
            live.current.forEach((fn) => fn(payload.data));
            if (payload.data.kind === 'delta' && payload.data.projectId === selectedRef.current)
              setStreamText((text) => text + payload.data.text);
            return;
          }
          if (payload.type !== 'event') return;
          const event = payload.event as WorkflowEvent;
          if (event.kind === 'question' && event.projectId)
            setPendingProjects((old) => new Set([...old, event.projectId!]));
          if (
            ['question_answered', 'question_expired', 'agent_result'].includes(event.kind) &&
            event.projectId
          )
            setPendingProjects((old) => {
              const next = new Set(old);
              next.delete(event.projectId!);
              return next;
            });
          if (event.projectId === selectedRef.current) {
            setDetail((old) => (old ? { ...old, events: [...old.events, event] } : old));
            if (event.kind === 'message') setStreamText('');
          }
          if (
            ![
              'message',
              'tool',
              'tool_result',
              'command_output',
              'diagnostic',
              'agent_status',
            ].includes(event.kind)
          ) {
            clearTimeout(refreshTimer.current);
            refreshTimer.current = setTimeout(() => {
              void refresh().catch((e) => setError(errorMessage(e)));
              if (selectedRef.current)
                void loadDetail(selectedRef.current).catch((e) => setError(errorMessage(e)));
            }, 100);
          }
        };
        socket.onclose = () => {
          setConnected(false);
          if (!disposed) reconnect = setTimeout(connect, 2000);
        };
        socket.onerror = () => socket.close();
      } catch (e) {
        setError(errorMessage(e));
        setConnected(false);
        if (!disposed) reconnect = setTimeout(connect, 3000);
      }
    }
    void connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearTimeout(refreshTimer.current);
      ws.current?.close();
    };
  }, [refresh, loadDetail]);
  useEffect(() => {
    if (selectedId) {
      setDetail(undefined);
      setStreamText('');
      setSelectedItems([]);
      setFeedback('');
      setTerminalId(undefined);
      void loadDetail(selectedId).catch((e) => setError(errorMessage(e)));
    }
  }, [selectedId, loadDetail]);
  const send = useCallback((data: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(data));
  }, []);
  const subscribe = useCallback((callback: (data: any) => void) => {
    live.current.add(callback);
    return () => {
      live.current.delete(callback);
    };
  }, []);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      if (selectedRef.current) await loadDetail(selectedRef.current);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const action = (name: string, body: unknown = {}) =>
    perform(async () => {
      await api(`/projects/${selectedId}/actions/${name}`, body);
      if (['correct', 'revise-plan'].includes(name)) {
        setSelectedItems([]);
        setFeedback('');
      }
    });
  function openProject(p: Project) {
    setSelectedId(p.id);
    setTab(
      p.status === 'awaiting_plan'
        ? 'Plan'
        : p.status === 'awaiting_result'
          ? 'Review'
          : 'Overview',
    );
  }
  function navigate(next: Page) {
    setPage(next);
    setSelectedId(undefined);
  }
  async function loadModels() {
    try {
      setModels(await api('/models'));
    } catch {
      /* The model field accepts a manual alias if discovery is unavailable. */
    }
  }
  const p = detail?.project;
  const projects = snapshot.projects.filter(
    (p) =>
      (showArchived ? p.status === 'archived' : p.status !== 'archived') &&
      (filter === 'all' || p.repoId === filter) &&
      `${p.name} ${p.ticketUrl} ${p.config.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const awaiting = snapshot.projects.filter(
    (p) =>
      ['awaiting_plan', 'awaiting_result', 'blocked', 'interrupted'].includes(p.status) ||
      pendingProjects.has(p.id),
  ).length;
  const terminal = detail?.terminals.find((t) => t.id === terminalId) ?? detail?.terminals[0];
  const navItems: [Page, ReactNode, string][] = [
    ['board', <LayoutDashboard size={18} />, 'Projects'],
    ['repositories', <FolderGit2 size={18} />, 'Repositories'],
    ['skills', <Sparkles size={18} />, 'Skills'],
    ['settings', <Settings2 size={18} />, 'Settings'],
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('board');
          }}
        >
          <div className="brand-mark">
            <WorkflowIcon size={23} />
          </div>
          <div>
            AI Native<span>WORKFLOW</span>
          </div>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav>
          {navItems.map(([id, icon, label]) => (
            <button className={page === id ? 'active' : ''} key={id} onClick={() => navigate(id)}>
              {icon}
              <span>{label}</span>
              {id === 'board' && (
                <span className="nav-count">
                  {snapshot.projects.filter((p) => p.status !== 'archived').length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="row">
            <span>REPOSITORIES</span>
            <button
              className="icon-button"
              aria-label="Add repository"
              onClick={() => {
                setRepoModal('new');
                void loadModels();
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {snapshot.repositories.length ? (
            snapshot.repositories.map((r) => (
              <button
                className="repo-shortcut"
                key={r.id}
                onClick={() => {
                  navigate('board');
                  setFilter(r.id);
                }}
              >
                <span className="repo-dot" />
                {r.name}
              </button>
            ))
          ) : (
            <p>
              Your repositories will
              <br />
              appear here.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={17} />
            <div>
              Local by design<span>Local worktrees & history</span>
            </div>
          </div>
          <div className="profile">
            <div className="avatar">M</div>
            <div>
              My workspace<span>Personal workspace</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{navItems.find((n) => n[0] === page)?.[2]}</strong>
            {selectedId && (
              <>
                <span>/</span>
                <strong>{p?.name ?? 'Project'}</strong>
              </>
            )}
          </div>
          <div className={`connection ${connected ? '' : 'offline'}`}>
            <span />
            {connected ? 'Local engine online' : 'Reconnecting…'}
          </div>
        </header>
        {error && (
          <div className="global-error" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        <main>
          {selectedId ? (
            !detail ? (
              <div className="loading">
                <LoaderCircle className="spin" /> Loading project…
              </div>
            ) : (
              <>
                <button className="back-link" onClick={() => setSelectedId(undefined)}>
                  <ArrowLeft size={15} /> All projects
                </button>
                <div className="page-heading project-heading">
                  <div>
                    <div className="eyebrow">
                      {p!.config.name} <span>·</span> {stageNames[p!.stage]}
                    </div>
                    <h1>{p!.name}</h1>
                    <div className="row">
                      <Badge tone={p!.status === 'published' ? 'green' : 'purple'}>
                        {p!.status.replaceAll('_', ' ')}
                      </Badge>
                      <a className="text-link" href={p!.ticketUrl} target="_blank" rel="noreferrer">
                        Open ticket <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                  <div className="row">
                    {['running', 'queued'].includes(p!.status) && (
                      <Button disabled={busy} onClick={() => action('stop')}>
                        <Pause size={15} /> Pause
                      </Button>
                    )}
                    {['interrupted', 'blocked', 'new'].includes(p!.status) && (
                      <Button primary disabled={busy} onClick={() => action('resume')}>
                        <Play size={15} /> Resume
                      </Button>
                    )}
                    {p!.status !== 'archived' && (
                      <Button disabled={busy} onClick={() => action('archive')}>
                        <Archive size={15} /> Archive
                      </Button>
                    )}
                  </div>
                </div>
                {p!.error && (
                  <div className="notice error">
                    <CircleAlert size={17} />
                    <span>{p!.error}</span>
                  </div>
                )}
                <div className="workflow-strip">
                  {(
                    ['prepare', 'plan', 'implementation', 'test', 'review', 'publish'] as const
                  ).map((stage, i) => {
                    const complete = detail.runs.some(
                      (r) => r.stage === stage && r.status === 'complete',
                    );
                    return (
                      <div
                        key={stage}
                        className={`${p!.stage === stage ? 'current' : ''} ${complete ? 'complete' : ''}`}
                      >
                        <span>{complete ? <Check size={13} /> : i + 1}</span>
                        {stageNames[stage]}
                        {i < 5 && <ChevronDown className="step-arrow" size={14} />}
                      </div>
                    );
                  })}
                </div>
                {detail.questions
                  .filter((q) => q.status === 'pending')
                  .map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      answer={async (id, value) => {
                        await api(`/questions/${id}/answer`, value);
                        await loadDetail(selectedId);
                      }}
                    />
                  ))}
                <div className="tabs">
                  {(['Overview', 'Plan', 'Conversations', 'Review', 'Terminals'] as Tab[]).map(
                    (t) => (
                      <button
                        className={tab === t ? 'active' : ''}
                        key={t}
                        onClick={() => setTab(t)}
                      >
                        {t}
                        {t === 'Review' && !!p!.review?.items.length && (
                          <span>{p!.review.items.length}</span>
                        )}
                        {t === 'Terminals' && !!detail.terminals.length && (
                          <span>{detail.terminals.length}</span>
                        )}
                      </button>
                    ),
                  )}
                </div>
                <div className="detail-content">
                  {tab === 'Overview' && (
                    <div className="overview-grid">
                      <div>
                        <section className="panel">
                          <h3>Project summary</h3>
                          {p!.summary ? (
                            <div className="markdown">
                              <Markdown>{p!.summary}</Markdown>
                            </div>
                          ) : (
                            <p className="muted">
                              The implementation summary will appear here as work progresses.
                            </p>
                          )}
                          {p!.prUrl && (
                            <a className="pr-link" href={p!.prUrl} target="_blank" rel="noreferrer">
                              <GitPullRequest size={20} />
                              <div>
                                Draft pull request<span>{p!.prUrl}</span>
                              </div>
                              <ExternalLink size={16} />
                            </a>
                          )}
                        </section>
                        <section className="panel">
                          <h3>Activity</h3>
                          <div className="timeline">
                            {detail.runs.length ? (
                              detail.runs.map((r) => (
                                <div key={r.id}>
                                  <span className={`timeline-dot ${r.status}`}>
                                    {r.status === 'complete' ? (
                                      <Check size={11} />
                                    ) : r.status === 'running' ? (
                                      <LoaderCircle size={11} className="spin" />
                                    ) : (
                                      <Circle size={8} />
                                    )}
                                  </span>
                                  <div>
                                    <strong>{stageNames[r.stage]}</strong>
                                    <small>
                                      {r.status} · {new Date(r.startedAt).toLocaleTimeString()}
                                    </small>
                                    {r.error && <p className="error-text">{r.error}</p>}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="muted">Waiting for a place in the queue.</p>
                            )}
                          </div>
                        </section>
                      </div>
                      <div>
                        <section className="panel metadata">
                          <h3>Workspace</h3>
                          <label>Branch</label>
                          <p>
                            <GitBranch size={14} />
                            {p!.branch}
                          </p>
                          <label>Worktree</label>
                          <p className="path">{p!.worktree}</p>
                          <label>Port range</label>
                          <p>
                            {p!.port}–{p!.port + 9}
                          </p>
                          <label>Correction rounds</label>
                          <p>{p!.round}</p>
                          <label>Created</label>
                          <p>{new Date(p!.createdAt).toLocaleString()}</p>
                        </section>
                        <section className="panel metadata">
                          <h3>Stage configuration</h3>
                          {(['plan', 'implementation', 'review'] as const).map((stage) => (
                            <div key={stage}>
                              <label>{stageNames[stage]}</label>
                              <p>
                                {p!.choices[stage].skill}
                                <Badge>{p!.choices[stage].model}</Badge>
                              </p>
                            </div>
                          ))}
                        </section>
                        {p!.status === 'archived' && (
                          <section className="panel">
                            <h3>Archived project</h3>
                            <p className="muted">History and session records are preserved.</p>
                            <Button
                              disabled={busy || p!.worktreeRemoved}
                              onClick={() => setConfirmDelete(true)}
                            >
                              <Trash2 size={14} />
                              {p!.worktreeRemoved ? 'Worktree removed' : 'Remove worktree'}
                            </Button>
                          </section>
                        )}
                      </div>
                    </div>
                  )}
                  {tab === 'Plan' &&
                    (p!.plan ? (
                      <>
                        <div className="panel markdown">
                          <Markdown>{p!.plan}</Markdown>
                        </div>
                        {p!.status === 'awaiting_plan' && (
                          <div className="decision-panel">
                            <div>
                              <Badge tone="purple">Your decision</Badge>
                              <h3>Ready to implement this plan?</h3>
                              <p>
                                Approve it to start implementation, or send feedback for another
                                pass.
                              </p>
                            </div>
                            <textarea
                              aria-label="Plan feedback"
                              value={feedback}
                              onChange={(e) => setFeedback(e.target.value)}
                              placeholder="What should change in the plan?"
                              rows={3}
                            />
                            <div className="row justify-end">
                              <Button
                                disabled={busy || !feedback.trim()}
                                onClick={() => action('revise-plan', { feedback })}
                              >
                                Request changes
                              </Button>
                              <Button
                                primary
                                disabled={busy}
                                onClick={() => action('approve-plan')}
                              >
                                <Check size={16} /> Approve plan
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <Empty icon={<ClipboardList />} title="The plan is taking shape">
                        Claude will retrieve the ticket, inspect the repository, and bring a plan
                        here for your approval.
                      </Empty>
                    ))}
                  {tab === 'Conversations' && (
                    <>
                      <div className="row conversation-toolbar">
                        <select
                          aria-label="Filter conversations"
                          value={conversationStage}
                          onChange={(e) => setConversationStage(e.target.value)}
                        >
                          <option value="all">All stages</option>
                          {['plan', 'implementation', 'review'].map((s) => (
                            <option value={s} key={s}>
                              {stageNames[s]}
                            </option>
                          ))}
                        </select>
                        <span className="muted small">{detail.sessions.length} saved sessions</span>
                      </div>
                      <div className="conversation">
                        {detail.events
                          .filter(
                            (e) =>
                              [
                                'message',
                                'tool',
                                'tool_result',
                                'command_start',
                                'command_output',
                                'command_end',
                                'diagnostic',
                              ].includes(e.kind) &&
                              (conversationStage === 'all' ||
                                (e.data as any).stage === conversationStage),
                          )
                          .map((e) => {
                            const data = e.data as any;
                            if (e.kind === 'message')
                              return (
                                <div key={e.seq} className={`message ${data.role}`}>
                                  <div className="message-heading">
                                    <span className="message-avatar">
                                      {data.role === 'assistant' ? (
                                        <Sparkles size={14} />
                                      ) : (
                                        <WorkflowIcon size={14} />
                                      )}
                                    </span>
                                    <strong>
                                      {data.role === 'assistant' ? 'Claude' : 'Workflow'}
                                    </strong>
                                    <Badge>{stageNames[data.stage]}</Badge>
                                    <time>{new Date(e.createdAt).toLocaleTimeString()}</time>
                                  </div>
                                  <div className="markdown">
                                    <Markdown>{data.text}</Markdown>
                                  </div>
                                </div>
                              );
                            if (e.kind === 'tool')
                              return (
                                <details className="tool-message" key={e.seq}>
                                  <summary>
                                    <CodeXml size={14} />
                                    {data.name}
                                    <span>Tool call</span>
                                  </summary>
                                  <pre>{JSON.stringify(data.input, null, 2)}</pre>
                                </details>
                              );
                            if (e.kind === 'tool_result')
                              return (
                                <div
                                  className={`tool-status ${data.error ? 'error-text' : ''}`}
                                  key={e.seq}
                                >
                                  {data.error ? <CircleAlert size={12} /> : <Check size={12} />}Tool{' '}
                                  {data.error ? 'reported an error' : 'completed'}
                                </div>
                              );
                            if (e.kind === 'command_output')
                              return (
                                <pre className="command-output" key={e.seq}>
                                  {data.text}
                                </pre>
                              );
                            return (
                              <div className="command-event" key={e.seq}>
                                <TerminalSquare size={13} />
                                {data.label ?? data.stage}:{' '}
                                {data.command ?? data.text ?? `Exit ${data.exitCode}`}
                              </div>
                            );
                          })}
                        {streamText && (
                          <div className="message assistant streaming">
                            <div className="message-heading">
                              <Sparkles size={14} />
                              <strong>Claude</strong>
                              <LoaderCircle size={13} className="spin" />
                            </div>
                            <div className="markdown">
                              <Markdown>{streamText}</Markdown>
                            </div>
                          </div>
                        )}
                        {!detail.events.length && (
                          <Empty icon={<Sparkles />} title="A conversation starts with a ticket">
                            Messages, tool activity, and questions will appear here.
                          </Empty>
                        )}
                      </div>
                    </>
                  )}
                  {tab === 'Review' && (
                    <>
                      <div className="panel">
                        <div className="row">
                          <h3>Test results</h3>
                          <Badge
                            tone={
                              p!.tests?.status === 'passed'
                                ? 'green'
                                : p!.tests?.status === 'failed'
                                  ? 'red'
                                  : ''
                            }
                          >
                            {p!.tests?.status.replaceAll('_', ' ') ?? 'Not run yet'}
                          </Badge>
                        </div>
                        {p!.tests && (
                          <details className="test-output">
                            <summary>View test output</summary>
                            <pre>{p!.tests.output}</pre>
                          </details>
                        )}
                      </div>
                      {p!.review ? (
                        <>
                          <div className="panel">
                            <div className="row">
                              <h3>Independent review</h3>
                              <Badge>{p!.review.items.length} findings</Badge>
                            </div>
                            <div className="markdown">
                              <Markdown>{p!.review.summary}</Markdown>
                            </div>
                          </div>
                          <div className="findings">
                            {p!.review.items.map((item) => (
                              <label
                                className={`finding ${selectedItems.includes(item.id) ? 'selected' : ''}`}
                                key={item.id}
                              >
                                <input
                                  type="checkbox"
                                  disabled={p!.status !== 'awaiting_result'}
                                  checked={selectedItems.includes(item.id)}
                                  onChange={(e) =>
                                    setSelectedItems(
                                      e.target.checked
                                        ? [...selectedItems, item.id]
                                        : selectedItems.filter((id) => id !== item.id),
                                    )
                                  }
                                />
                                <div>
                                  <div className="row">
                                    <Badge
                                      tone={
                                        item.severity === 'high'
                                          ? 'red'
                                          : item.severity === 'medium'
                                            ? 'amber'
                                            : ''
                                      }
                                    >
                                      {item.severity}
                                    </Badge>
                                    <span className="muted small">{item.id}</span>
                                  </div>
                                  <h3>{item.title}</h3>
                                  <div className="markdown">
                                    <Markdown>{item.description}</Markdown>
                                  </div>
                                  {item.file && (
                                    <small className="file-reference">
                                      {item.file}
                                      {item.line ? `:${item.line}` : ''}
                                    </small>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                          {p!.status === 'awaiting_result' && (
                            <div className="decision-panel">
                              <Badge tone="purple">Your decision</Badge>
                              <h3>Choose what happens next.</h3>
                              <p>
                                Select findings for one correction round, add your instructions, or
                                approve this result for publication.
                              </p>
                              <textarea
                                aria-label="Review feedback"
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                rows={3}
                                placeholder="Additional instructions for the next correction round…"
                              />
                              <div className="row justify-end">
                                <Button
                                  disabled={busy || (!selectedItems.length && !feedback.trim())}
                                  onClick={() =>
                                    action('correct', { items: selectedItems, feedback })
                                  }
                                >
                                  <RefreshCw size={15} /> Request corrections
                                  {selectedItems.length ? ` (${selectedItems.length})` : ''}
                                </Button>
                                <Button primary disabled={busy} onClick={() => action('publish')}>
                                  <GitPullRequest size={16} /> Approve & create draft PR
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <Empty icon={<CheckCheck />} title="A second look, before you ship">
                          An independent Claude session will review the implementation and test
                          results.
                        </Empty>
                      )}
                      {p!.status === 'blocked' && p!.stage === 'publish' && (
                        <Button disabled={busy} onClick={() => action('reverify')}>
                          Test & review current changes
                        </Button>
                      )}
                    </>
                  )}
                  {tab === 'Terminals' && (
                    <>
                      <div className="row terminal-toolbar">
                        <div className="terminal-tabs">
                          {detail.terminals.map((t) => (
                            <button
                              className={terminal?.id === t.id ? 'active' : ''}
                              key={t.id}
                              onClick={() => setTerminalId(t.id)}
                            >
                              <TerminalSquare size={14} />
                              {t.name}
                              <span className={`terminal-status ${t.status}`} />
                            </button>
                          ))}
                        </div>
                        <Button
                          disabled={
                            busy ||
                            p!.status === 'archived' ||
                            p!.worktreeRemoved ||
                            p!.stage === 'prepare'
                          }
                          onClick={() =>
                            perform(async () => {
                              const t = await api<TerminalRecord>(
                                `/projects/${selectedId}/terminals`,
                                {},
                              );
                              setTerminalId(t.id);
                            })
                          }
                        >
                          <Plus size={14} /> New shell
                        </Button>
                      </div>
                      {terminal ? (
                        <div className="terminal-container">
                          <div className="terminal-top">
                            <span>
                              {terminal.name} <Badge>{terminal.status}</Badge>
                            </span>
                            <div className="row">
                              {terminal.status === 'running' ? (
                                <button
                                  onClick={() =>
                                    perform(() => api(`/terminals/${terminal.id}/stop`, {}))
                                  }
                                >
                                  <Pause size={13} /> Stop
                                </button>
                              ) : (
                                <button
                                  disabled={p!.status === 'archived' || p!.worktreeRemoved}
                                  onClick={() =>
                                    perform(() => api(`/terminals/${terminal.id}/restart`, {}))
                                  }
                                >
                                  <Play size={13} /> Restart
                                </button>
                              )}
                            </div>
                          </div>
                          <TerminalView
                            key={terminal.id + (connected ? '-online' : '-offline')}
                            record={terminal}
                            send={send}
                            subscribe={subscribe}
                          />
                          <div className="terminal-footer">
                            PowerShell <span>·</span> {p!.worktree}
                          </div>
                        </div>
                      ) : (
                        <Empty icon={<TerminalSquare />} title="Your project's terminals">
                          Configured terminals start after setup. You can also open a PowerShell
                          session here.
                        </Empty>
                      )}
                    </>
                  )}
                </div>
              </>
            )
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR LOCAL WORKSPACE</div>
                  <h1>
                    {page === 'board'
                      ? 'Projects'
                      : page === 'repositories'
                        ? 'Repositories'
                        : page === 'skills'
                          ? 'Skill library'
                          : 'Settings'}
                  </h1>
                  <p>
                    {page === 'board'
                      ? 'From ticket to reviewed pull request.'
                      : page === 'repositories'
                        ? 'A reliable starting point for every worktree.'
                        : page === 'skills'
                          ? 'The instructions behind each stage of your workflow.'
                          : 'Keep your local engine working your way.'}
                  </p>
                </div>
                <div className="row">
                  {page === 'board' && (
                    <Button
                      primary
                      disabled={!connected || !snapshot.repositories.length}
                      onClick={() => {
                        setProjectModal(true);
                        void loadModels();
                      }}
                    >
                      <Plus size={17} /> New project
                    </Button>
                  )}
                  {page === 'repositories' && (
                    <Button
                      primary
                      onClick={() => {
                        setRepoModal('new');
                        void loadModels();
                      }}
                    >
                      <Plus size={17} /> Add repository
                    </Button>
                  )}
                  {page === 'skills' && (
                    <Button onClick={() => perform(refresh)}>
                      <RefreshCw size={15} /> Refresh skills
                    </Button>
                  )}
                </div>
              </div>
              {page === 'board' && (
                <>
                  <div className="stats-row">
                    <div>
                      <span className="stat-icon purple">
                        <Layers2 size={19} />
                      </span>
                      <div>
                        <strong>
                          {snapshot.projects.filter((p) => p.status !== 'archived').length}
                        </strong>
                        <span>Total projects</span>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon blue">
                        <WorkflowIcon size={19} />
                      </span>
                      <div>
                        <strong>
                          {snapshot.active}
                          <small> / {snapshot.concurrency}</small>
                        </strong>
                        <span>Running now</span>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon amber">
                        <CircleHelp size={19} />
                      </span>
                      <div>
                        <strong>{awaiting}</strong>
                        <span>Needs your attention</span>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon green">
                        <GitPullRequest size={19} />
                      </span>
                      <div>
                        <strong>{snapshot.projects.filter((p) => p.prUrl).length}</strong>
                        <span>Pull requests created</span>
                      </div>
                    </div>
                  </div>
                  {!snapshot.repositories.length && (
                    <div className="onboarding">
                      <div className="onboarding-art">
                        <FolderGit2 size={32} />
                        <span>
                          <Sparkles size={15} />
                        </span>
                      </div>
                      <div>
                        <Badge tone="purple">LET'S GET STARTED</Badge>
                        <h2>Give your next idea a workspace.</h2>
                        <p>
                          Add a local repository, choose your skills, and let Claude take the first
                          pass.
                          <br />
                          You stay in control at the decisions that matter.
                        </p>
                      </div>
                      <Button
                        primary
                        onClick={() => {
                          setRepoModal('new');
                          void loadModels();
                        }}
                      >
                        Add your first repository <ArrowRight size={16} />
                      </Button>
                    </div>
                  )}
                  <div className="board-toolbar">
                    <div className="row">
                      <button
                        className={`view-toggle ${!showArchived ? 'active' : ''}`}
                        onClick={() => setShowArchived(false)}
                      >
                        <LayoutDashboard size={15} /> Board
                      </button>
                      <button
                        className={`view-toggle ${showArchived ? 'active' : ''}`}
                        onClick={() => setShowArchived(true)}
                      >
                        <Archive size={15} /> Archive
                      </button>
                    </div>
                    <div className="row">
                      <div className="search-field">
                        <Search size={15} />
                        <input
                          aria-label="Search projects"
                          placeholder="Search projects…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <select
                        aria-label="Filter by repository"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All repositories</option>
                        {snapshot.repositories.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {showArchived ? (
                    <div className="archive-list">
                      {projects.length ? (
                        projects.map((p) => (
                          <button
                            key={p.id}
                            className="archive-item"
                            onClick={() => openProject(p)}
                          >
                            <Archive size={18} />
                            <strong>{p.name}</strong>
                            <span>{p.config.name}</span>
                            <span>
                              {p.worktreeRemoved ? 'Worktree removed' : 'Worktree preserved'}
                            </span>
                            <ArrowRight size={16} />
                          </button>
                        ))
                      ) : (
                        <Empty icon={<Archive />} title="Nothing archived yet">
                          Finished projects stay on your board until you archive them.
                        </Empty>
                      )}
                    </div>
                  ) : (
                    <div className="kanban">
                      {columns.map((name, index) => {
                        const group = projects.filter(
                          (p) => column(p, pendingProjects.has(p.id)) === name,
                        );
                        return (
                          <section className={`kanban-column col-${index}`} key={name}>
                            <header>
                              <div className="row">
                                <span className="column-dot" />
                                <h2>{name}</h2>
                                <span className="column-count">{group.length}</span>
                              </div>
                              {index === 0 && (
                                <button
                                  className="icon-button"
                                  aria-label="New project"
                                  disabled={!snapshot.repositories.length}
                                  onClick={() => {
                                    setProjectModal(true);
                                    void loadModels();
                                  }}
                                >
                                  <Plus size={15} />
                                </button>
                              )}
                            </header>
                            <div className="column-cards">
                              {group.map((p) => (
                                <button
                                  key={p.id}
                                  className="project-card"
                                  onClick={() => openProject(p)}
                                >
                                  <div className="row">
                                    <span className="card-repo">
                                      <span />
                                      {p.config.name}
                                    </span>
                                    <span className="card-id">{p.id.slice(0, 4)}</span>
                                  </div>
                                  <h3>{p.name}</h3>
                                  <div className="card-ticket">
                                    <ExternalLink size={11} />
                                    {new URL(p.ticketUrl).hostname}
                                  </div>
                                  <div className="card-stage">
                                    <Badge
                                      tone={
                                        p.status === 'blocked'
                                          ? 'red'
                                          : p.status.startsWith('awaiting')
                                            ? 'amber'
                                            : p.status === 'published'
                                              ? 'green'
                                              : 'purple'
                                      }
                                    >
                                      {p.status === 'running' ? (
                                        <LoaderCircle size={10} className="spin" />
                                      ) : p.status === 'published' ? (
                                        <Check size={10} />
                                      ) : (
                                        <Circle size={8} />
                                      )}{' '}
                                      {p.status === 'awaiting_plan'
                                        ? 'Approve plan'
                                        : p.status === 'awaiting_result'
                                          ? 'Review result'
                                          : p.status === 'blocked'
                                            ? 'Blocked'
                                            : p.status === 'queued'
                                              ? 'Queued'
                                              : stageNames[p.stage]}
                                    </Badge>
                                  </div>
                                  <footer>
                                    <span>
                                      <GitBranch size={12} />
                                      {p.branch.replace('ai/', '').slice(0, 19)}
                                    </span>
                                    <time>{age(p.updatedAt)}</time>
                                  </footer>
                                </button>
                              ))}
                              {!group.length && (
                                <div className="column-empty">
                                  <span>—</span>
                                  {
                                    [
                                      'Ready for a new idea',
                                      'Plans take shape here',
                                      'Focused work happens here',
                                      'Quality gets a second look',
                                      'Your next decision appears here',
                                      'Good work, ready to share',
                                    ][index]
                                  }
                                </div>
                              )}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                  <div className="board-footer">
                    <span>
                      <ShieldCheck size={13} /> Approval before implementation. Approval before
                      publication.
                    </span>
                    <span>POWERED BY CLAUDE CODE</span>
                  </div>
                </>
              )}
              {page === 'repositories' && (
                <div className="repository-grid">
                  {snapshot.repositories.map((r) => (
                    <section className="panel repository-card" key={r.id}>
                      <div className="row">
                        <div className="repo-logo">
                          <FolderGit2 size={23} />
                        </div>
                        <h3>{r.name}</h3>
                        <button
                          className="icon-button push-right"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => {
                            setRepoModal(r);
                            void loadModels();
                          }}
                        >
                          <Settings2 size={17} />
                        </button>
                      </div>
                      <p className="path">{r.path}</p>
                      <div className="repo-facts">
                        <span>
                          <GitBranch size={14} />
                          {r.baseBranch}
                        </span>
                        <span>
                          <TerminalSquare size={14} />
                          {r.terminals.length} terminals
                        </span>
                      </div>
                      <div className="repository-stages">
                        {(['plan', 'implementation', 'review'] as const).map((s) => (
                          <div key={s}>
                            <span>{stageNames[s]}</span>
                            <strong>{r.choices[s].skill}</strong>
                            <small>{r.choices[s].model}</small>
                          </div>
                        ))}
                      </div>
                      <footer>
                        <span>
                          {
                            snapshot.projects.filter(
                              (p) => p.repoId === r.id && p.status !== 'archived',
                            ).length
                          }{' '}
                          active projects
                        </span>
                        <button
                          className="text-link"
                          onClick={() => {
                            setPage('board');
                            setFilter(r.id);
                          }}
                        >
                          View projects <ArrowRight size={14} />
                        </button>
                      </footer>
                    </section>
                  ))}
                  {!snapshot.repositories.length && (
                    <Empty icon={<FolderGit2 />} title="Start with a repository">
                      Add an existing local Git repository to configure its skills, setup, and
                      terminals.
                    </Empty>
                  )}
                </div>
              )}
              {page === 'skills' && (
                <>
                  <div className="notice soft">
                    <FolderGit2 size={18} />
                    <span>
                      Add skills manually in <code>skills/&lt;skill-id&gt;/SKILL.md</code>, then
                      refresh this list. Each file needs a matching <code>name</code> and a{' '}
                      <code>description</code> in YAML frontmatter. Supporting files stay with the
                      skill.
                    </span>
                  </div>
                  <div className="skill-grid">
                    {snapshot.skills.map((s) => (
                      <section
                        className={`panel skill-card ${s.valid ? '' : 'invalid'}`}
                        key={s.id}
                      >
                        <div className="row">
                          <div className="skill-icon">
                            <Sparkles size={20} />
                          </div>
                          <Badge tone={s.valid ? 'green' : 'red'}>
                            {s.valid ? 'Ready' : 'Invalid'}
                          </Badge>
                        </div>
                        <h3>{s.name}</h3>
                        <p>{s.description || s.error}</p>
                        <footer>
                          <code>skills/{s.id}/</code>
                          {s.valid ? <Check size={15} /> : <CircleAlert size={15} />}
                        </footer>
                        {s.error && s.description && <p className="error-text">{s.error}</p>}
                      </section>
                    ))}
                  </div>
                  {!snapshot.skills.length && (
                    <Empty icon={<Sparkles />} title="Bring your workflow expertise">
                      Add your planning, implementation, and review skills to the skills folder. No
                      in-app editor is required.
                    </Empty>
                  )}
                </>
              )}
              {page === 'settings' && (
                <div className="settings-layout">
                  <section className="panel">
                    <div className="row">
                      <WorkflowIcon size={20} />
                      <h3>Execution</h3>
                    </div>
                    <Field
                      label="Concurrent projects"
                      hint="Projects waiting for plan or result approval release their queue slot."
                    >
                      <input
                        type="number"
                        min={1}
                        max={10}
                        defaultValue={snapshot.concurrency}
                        key={snapshot.concurrency}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (value !== snapshot.concurrency)
                            void perform(() => api('/settings', { concurrency: value }, 'PUT'));
                        }}
                      />
                    </Field>
                    <div className="setting-explanation">
                      <ShieldCheck size={18} />
                      <p>
                        Closing this tab keeps work running. After a server restart, interrupted
                        stages wait for you to resume them.
                      </p>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="row">
                      <h3>Local integrations</h3>
                      <Button
                        disabled={checking}
                        onClick={async () => {
                          setChecking(true);
                          try {
                            setDiagnostics(await api('/diagnostics'));
                          } catch (e) {
                            setError(errorMessage(e));
                          } finally {
                            setChecking(false);
                          }
                        }}
                      >
                        <RefreshCw size={14} className={checking ? 'spin' : ''} /> Check status
                      </Button>
                    </div>
                    <p className="muted">Uses your installed Git, Claude Code, and GitHub CLI.</p>
                    {diagnostics ? (
                      Object.entries(diagnostics).map(([name, result]) => (
                        <div className="diagnostic" key={name}>
                          <div className="row">
                            {result.ok ? (
                              <Check size={16} className="success-text" />
                            ) : (
                              <CircleAlert size={16} className="error-text" />
                            )}
                            <strong>
                              {name === 'claude'
                                ? 'Claude Code'
                                : name === 'github'
                                  ? 'GitHub CLI'
                                  : 'Git'}
                            </strong>
                          </div>
                          <pre>{result.message}</pre>
                        </div>
                      ))
                    ) : (
                      <p className="small muted">
                        Run a check to verify the local tools and login status.
                      </p>
                    )}
                  </section>
                  <section className="panel">
                    <h3>About this workspace</h3>
                    <p className="muted">
                      Single-user, native Windows execution. Projects and history are stored in a
                      local SQLite database. Model authentication is handled by your existing Claude
                      Code installation.
                    </p>
                    <Badge>AI Native Workflow · v0.1.0</Badge>
                  </section>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {repoModal && (
        <RepositoryForm
          initial={repoModal === 'new' ? undefined : repoModal}
          skills={snapshot.skills}
          models={models}
          close={() => setRepoModal(undefined)}
          save={async (repo, id) => {
            await api(id ? `/repositories/${id}` : '/repositories', repo, id ? 'PUT' : 'POST');
            await refresh();
          }}
        />
      )}
      {projectModal && (
        <NewProject
          repositories={snapshot.repositories}
          skills={snapshot.skills}
          models={models}
          close={() => setProjectModal(false)}
          create={async (body) => {
            const p = await api<Project>('/projects', body);
            await refresh();
            openProject(p);
          }}
        />
      )}
      {confirmDelete && p && (
        <Modal title="Remove this worktree?" close={() => setConfirmDelete(false)}>
          <div className="modal-body">
            <p>
              The worktree directory will be removed from disk. Project history and the branch will
              remain.
            </p>
            <p className="path">{p.worktree}</p>
            <p className="muted">
              Uncommitted or untracked files block removal. Ignored files, such as copied .env files
              and installed dependencies, are removed with the worktree.
            </p>
          </div>
          <footer>
            <Button onClick={() => setConfirmDelete(false)}>Keep worktree</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await action('remove-worktree');
                setConfirmDelete(false);
              }}
            >
              <Trash2 size={15} /> Remove worktree
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
