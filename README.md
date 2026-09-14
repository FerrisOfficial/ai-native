# AI Native Workflow

A local Kanban for Claude Code. Each project owns a Git worktree, a fixed workflow, saved Claude sessions, and interactive terminals. The UI is in English and deliberately does not include a code editor or diff browser.

## Run on Windows

Requirements: Node.js 24 or newer, Git for Windows (including Git Bash for Claude), Claude Code, GitHub CLI, and Windows PowerShell. Claude and GitHub use your existing local authentication.

```powershell
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. Keep the server running when closing the browser. The server is bound to loopback only.

If npm asks for approval of native installation scripts, approve the two dependencies used by this app:

```powershell
npm approve-scripts node-pty esbuild
npm rebuild node-pty esbuild
```

For development, run `npm run dev` and `npm run dev:ui` in separate terminals, then open http://127.0.0.1:5173. Backend changes require a restart; Vite reloads the frontend.

## First project

1. Open **Skills → Refresh skills**. For a first trial, use the included `example-plan`, `example-implement`, and `example-review` skills for their respective stages. You can also add your own skills to `skills/<skill-id>/SKILL.md`. See [the skill format and trial instructions](skills/README.md). No example skill is silently selected for real work.
2. In **Repositories**, add an existing local repository root. Set a base branch or leave it empty to detect the default from `origin`.
3. Choose a skill and model for **Plan**, **Implement**, and **Review**. Model discovery is best effort; you can type any alias or full model ID supported by your Claude installation. `default` inherits your Claude model.
4. Set optional PowerShell setup and test commands, local files to copy, and named terminals.
5. Create a project with a name and an HTTP(S) ticket URL. The planning skill retrieves the ticket using your configured MCP or CLI tools. The application does not need a connector for each ticket provider.
6. Approve or revise the plan. After implementation, inspect tests and review. Select findings and add instructions for one correction round, or approve publication as a draft PR.

The source repository needs an `origin` remote and an initial commit. New branches start from the configured remote branch after a successful fetch. Uncommitted source-checkout changes are not carried into the new worktree. Existing project settings are snapshots; editing a repository changes defaults for future projects only.

## Workflow and permissions

### Suggested repository configuration

In **Repositories → Add repository / Edit**, enter the local path and click **Detect configuration**. The app reads root manifests and lockfiles and proposes setup, tests and named terminals for Node.js (npm, pnpm, Yarn, Bun), Rust, Go, Python and static websites. Known Vite and Next.js development commands use the assigned `PORT`. No command runs during discovery. Review the evidence and warnings, click **Apply suggestions to form**, adjust the fields, then save. Applying replaces those three fields in the form; it does not alter existing projects. Unsupported or ambiguous projects need manual configuration. A JavaScript syntax check is not a functional test.

### Project cost, time and budget

Set an optional **Project spending limit (USD)** when creating a project, or edit it in **Overview → Cost & time** while the project is idle. Empty means unlimited; zero prevents new Claude calls. Saving a budget never resumes work automatically. After increasing a reached limit, use **Resume**.

The panel shows each stage attempt's elapsed time, input/output tokens, cache read/write tokens, and SDK-estimated cost, plus project totals. Stage time includes tool permission waits but excludes time waiting between stages for plan/result approval. Costs and tokens update when a Claude query finishes, including error results. Whole-tree model usage is used when available, and resumed calls and correction rounds add to the project total. Older successful calls are recovered from saved event history where possible. Missing or interrupted usage is shown as unavailable, never as a free call.

Before each query, the application subtracts reported costs from the project budget and passes the remainder as the SDK's `maxBudgetUsd`. The SDK stops when its estimated budget is exceeded; the final request can overshoot. These figures are approximate usage estimates, not invoices or additional charges for a Claude subscription. If an earlier call has unknown cost, a limited project cannot start another query; clearing the budget explicitly allows continuation without a reliable spending limit. Setup/test commands, MCP services and external tools may have costs outside this estimate.

The server drives the state machine; model messages cannot advance an approval gate. It runs preparation → planning → plan approval → implementation → tests → independent review → result approval → commit/push/draft PR. There is no automatic correction loop. Tests that fail still reach review; missing tests are reported as **Not configured**.

Planning and review use Claude's plan permissions, deny direct file-edit tools, request approval for CLI commands, and check for repository changes before accepting their result. Implementation uses `acceptEdits`; other permission requests appear in the GUI. These are application and Claude permission controls, **not an operating-system sandbox**. Existing user/repository hooks and MCP servers retain their normal capabilities. Only approve shell/MCP actions whose behavior you trust.

The application uses the installed Claude executable and `user`, `project`, and `local` setting sources. It adds immutable, namespaced copies of the selected skills as a per-project plugin without modifying the target repository. Planning and implementation use separate sessions; implementation corrections resume their session. Each review round gets an independent review session, which can itself be resumed after interruption.

Claude login checks cannot prove an OAuth refresh will succeed. If a stage reports expired authentication, run `claude auth login` in a normal terminal and resume the interrupted/blocked project.

## Terminals and local files

- Named terminals start after setup and run in the project's worktree. Stop/restart them from **Terminals**, or add an interactive shell.
- **Remove** stops a terminal and removes it from the list, including after a page reload or server restart. Its saved history remains in the local database; repository files are unaffected.
- Each project reserves a ten-port block. Configured terminals receive consecutive `PORT` values in configuration order. Configure commands to read `$env:PORT`; assigning a port does not rewrite your dev server configuration. The range is checked at creation, but another process can still occupy a port later.
- Commands also receive `AI_NATIVE_PROJECT_ID` and `AI_NATIVE_WORKTREE`. Setup and tests use the first port in the block.
- Local copy paths must be regular files inside the source repository, for example `.env`, `.claude/settings.local.json`, or `.mcp.json`. Tracked files cannot be overwritten. Files are copied only if missing, and copied paths are excluded from publication. If you stage a copied file manually, publication stops instead of committing it.
- Environment overrides belong to individual named terminals. `PSModulePath` is initialized by PowerShell rather than inherited from the host IDE, unless explicitly supplied in that terminal's configuration.
- Terminal output retains the most recent two million characters per terminal; xterm also provides scrollback. Setup/test command events and Claude conversation history are persisted separately in SQLite.

## Persistence and publication

The default data directory is `%LOCALAPPDATA%\ai-native-workflow`. It contains SQLite, project skill snapshots, and managed worktrees. `AI_NATIVE_DATA` overrides this directory; `CLAUDE_EXECUTABLE` overrides the Claude binary path; `PORT` overrides the web server port. The Claude executable defaults to `%USERPROFILE%\.local\bin\claude.exe`.

Closing a tab does not stop the engine. A normal shutdown stops agents and terminal processes. After restarting, queued/running stages and terminals are marked interrupted. Use **Resume** for the workflow and **Restart** for a terminal. Historical records remain available; an interrupted terminal becomes a new process, not a resurrected shell.

Publication is an explicit user action. The application fingerprints the reviewed filesystem and checks it again at approval and commit. Staging does not invalidate that fingerprint. If files changed since review, run verification again. Terminals are stopped before publication. Commits include a project and approval marker so a retry after a crash can recognize its own commit. The GitHub CLI checks for an existing PR before creating one, including after a lost create response. Only `github.com` origins are supported in v1. The ticket itself may come from any provider. No merge is performed.

Archive stops processes while preserving the worktree and history. Removing a worktree is a separate confirmed action. Uncommitted/untracked files block removal. Git-ignored files such as copied `.env` files and dependencies are removed along with an otherwise clean worktree; the confirmation explains this. Branches are retained.

## Validation

```powershell
npm run check
npm test
npm run build
npm run format:check
```

The automated suite uses real temporary Git repositories, a local bare remote, a deterministic Claude driver, and a fake GitHub CLI response. It covers worktree isolation, snapshots, approval gates, selected corrections, publication retries, stale approvals, errors, queue limits, restart state, API origin/token checks, and permission/question callbacks. A separate test starts an actual interactive PowerShell PTY and verifies input, output and termination. Test data stays under `.data/tests`.

Two optional integration checks are also included:

- `npm run probe:claude` makes a small number of **real Claude calls** using the existing login. It checks skill loading, a fixture MCP tool, permission and question callbacks, interrupt, and resume. Results are written to `.probe/result.json`. It does not publish anything.
- `npm run test:ui-fixture` starts an isolated GUI at **http://127.0.0.1:4320**, with real worktrees and PowerShell terminals plus deterministic agent results. It exercises the real question/permission UI without invoking Claude or external ticket tools. It has its own data under `.data/ui-verification` and does not publish remotely. Stop it with Ctrl+C.

The initial Claude probe encountered expired OAuth; a later real-repository run successfully authenticated and exercised the workflow. See [validation notes](VALIDATION.md) for the exact coverage and remaining integration checks. Automated success does not mean an external PR was published.

## Layout

- `server/`: local API, persistence, Git, Claude, terminals and workflow orchestration.
- `shared/`: schemas and shared domain types.
- `src/`: React Kanban, project views and configuration forms.
- `skills/`: manually maintained skill library.
- `tests/` and `scripts/`: deterministic tests and explicit integration probes.

V1 does not clone repositories, edit workflow graphs or skills, merge PRs, integrate CI, support WSL, or register itself as a Windows startup service.
