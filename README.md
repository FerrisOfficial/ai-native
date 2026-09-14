# AI Native Workflow

A local Kanban for Claude Code. Each project owns a Git worktree, a fixed workflow, saved Claude sessions, and interactive terminals. The UI is in English and deliberately does not include a code editor or diff browser.

## Run on Windows

Requirements: Node.js 24 or newer, Git for Windows (including Git Bash for Claude), Claude Code, GitHub CLI, and Windows PowerShell. Claude and GitHub use your existing local authentication.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:4317**. Keep the server running when closing the browser. The server is bound to loopback only.

If npm asks for approval of native installation scripts, approve the two dependencies used by this app:

```powershell
npm.cmd approve-scripts node-pty esbuild
npm.cmd rebuild node-pty esbuild
```

For development, run `npm.cmd run dev` and `npm.cmd run dev:ui` in separate terminals, then open http://127.0.0.1:5173. Backend changes require a restart; Vite reloads the frontend.

Windows command detection uses `npm.cmd`, `pnpm.cmd`, and `yarn.cmd` so PowerShell
does not choose a blocked `.ps1` shim. Bun uses its native executable. Existing
saved repository/project commands are not silently rewritten.

Only one engine may use an `AI_NATIVE_DATA` directory. A separate SQLite lock is
held until shutdown and released by the operating system after a crash. Do not
delete `engine-lock.sqlite` while an engine is running. Stop older application
versions before upgrading: they do not participate in this lock. Recovery occurs
only after the server successfully binds its port.

For dogfooding, give every preview a separate `AI_NATIVE_DATA` outside the source
tree. On Windows, `AI_NATIVE_WORKTREES` can point to a shorter, dedicated directory
for new worktrees. Existing projects under the default data/worktrees directory
remain supported. Keep a custom root stable while it contains managed projects;
changing it does not relocate existing worktrees. No global Git or PowerShell
security setting is changed.

Tests use short system temporary directories and clean up their fixtures.
`AI_NATIVE_TEST_TEMP` optionally overrides that parent directory. Vitest only
discovers `tests/**/*.test.ts`, excluding cloned worktrees and application data.

## First project

1. Open **Skills → Refresh skills**. For a first trial, use the included `example-plan`, `example-implement`, and `example-review` skills for their respective stages. You can also add your own skills to `skills/<skill-id>/SKILL.md`. See [the skill format and trial instructions](skills/README.md). No example skill is silently selected for real work.
2. In **Repositories**, add an existing local repository root. Set a base branch or leave it empty to detect the default from `origin`.
3. Choose a skill and model for **Plan**, **Implement**, and **Review**. Model discovery is best effort; you can type any alias or full model ID supported by your Claude installation. `default` inherits your Claude model.
4. Set optional PowerShell setup and test commands, local files to copy, and named terminals.
5. Create a project with a name and choose its task source: an HTTP(S) ticket URL or your own task description. For a URL, the planning skill retrieves the ticket using your configured MCP or CLI tools. For your own task, describe the change, relevant context, and acceptance criteria; no ticket URL is needed. The original description stays available in the project overview and follows the task through planning, implementation, review, and the pull request.
6. Optionally set **Working branch** for this project, for example `feature/team-invitations`. Leave it empty to generate a unique name from the repository's configured base branch. If the branch already exists, explicitly confirm continuing its history: a local branch is reused as-is, or a local branch is created from `origin` when only the remote branch exists. Branches checked out in another worktree or reserved by another project cannot be reused until released. Archive the previous project and remove its worktree to reuse its branch.
7. Approve or revise the plan. After implementation, inspect tests and review. Select findings and add instructions for one correction round, or approve publication as a draft PR.

The source repository needs an `origin` remote and an initial commit. New branches start from the configured remote branch after a successful fetch. Uncommitted source-checkout changes are not carried into the new worktree. Existing project settings are snapshots; editing a repository changes defaults for future projects only.

## Workflow and permissions

In repository settings, **Claude permissions → Auto approve tools in all stages** enables Claude's `bypassPermissions` mode for tool operations, including planning commands. Planning questions explicitly route to the user, and the completed plan still requires manual approval. Implementation, review, and correction rounds run without tool permission prompts or questions; unresolved issues are reported in the result. The application still waits for the user's review and explicit publication approval. Planning and review retain their read-only instructions and edit-tool restrictions; lifecycle commands remain controlled by the host. This setting is off by default and is copied into each new project's configuration. Projects already created with auto approve enabled also use automatic planning commands on their next Claude invocation.

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

Project pages and tabs have bookmarkable hash URLs. Reload and browser Back/Forward
preserve the current view. Invalid links return to the board with an explanation.

- Named terminals start after setup and run in the project's worktree. Stop/restart them from **Terminals**, or add an interactive shell.
- **Remove** stops a terminal and removes it from the list, including after a page reload or server restart. Its saved history remains in the local database; repository files are unaffected.
- Each project reserves a ten-port block. Configured terminals receive consecutive `PORT` values in configuration order. Configure commands to read `$env:PORT`; assigning a port does not rewrite your dev server configuration. The range is checked at creation, but another process can still occupy a port later.
- Commands also receive `AI_NATIVE_PROJECT_ID` and `AI_NATIVE_WORKTREE`. Setup and tests use the first port in the block.
- Local copy paths must be regular files inside the source repository, for example `.env`, `.claude/settings.local.json`, or `.mcp.json`. Tracked files cannot be overwritten. Files are copied only if missing, and copied paths are excluded from publication. If you stage a copied file manually, publication stops instead of committing it.
- Environment overrides belong to individual named terminals. `PSModulePath` is initialized by PowerShell rather than inherited from the host IDE, unless explicitly supplied in that terminal's configuration.
- Terminal output retains the most recent two million characters per terminal; xterm also provides scrollback. Setup/test command events and Claude conversation history are persisted separately in SQLite.

## Persistence and publication

### Application updates

Start the application with `npm.cmd start` to enable **Settings → Application updates → Update
from GitHub**. The launcher checks the default branch of `FerrisOfficial/ai-native`, fetches its
latest commit, applies a fast-forward update, runs `npm ci` and `npm run build`, then restarts the
server. A progress page remains available during installation and returns to Settings on success.
The first installation of this feature requires restarting with `npm.cmd start`; directly running
`tsx server/index.ts` (including `npm run dev`) does not enable the updater.

Pause running/queued projects and stop project terminals before updating. The application
checkout must be on the GitHub default branch with no local modifications, untracked files or
unpublished commits. The updater reports these conditions instead of discarding work. Project
history and worktrees stay in their existing data directory. Updates use the existing Git
authentication; the app does not change GitHub credentials or publish local changes.

If dependency installation, build or restart fails, the progress page shows the error and the
application directory. Details are retained in `application-update.log` there. Stop the launcher,
resolve the reported issue, then run `npm.cmd ci`, `npm.cmd run build` and `npm.cmd start` in that
directory. The updater does not automatically roll back source or database changes.

In **Overview → Workspace**, click the worktree path or its copy icon to copy the full path to
the clipboard. A confirmation appears after the copy succeeds.

In **Repositories**, use the trash button to remove a repository from the application and the new-project selector. Confirm the repository name/path in the dialog. Local files, worktrees and existing projects are retained; running projects continue with their saved configuration. Removed repositories with historical projects remain available in the board filter. You can add the same local repository again later. Pause/archive projects separately when you want to stop their processes.

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

### Saved command permissions

Shell permission prompts offer **Deny**, **Allow once**, and **Allow for this repository**. The app suggests command prefixes, preferring subcommands such as `git status`, `npm test`, or `gh issue view`. Edit the suggested list (one prefix per line) before saving; removed lines are allowed only for the current invocation. Existing exact approvals remain supported.

The shell lexer recognizes quoted literals, Windows paths, regex arguments, Bash escapes, comments, pipelines, command chains and Bash descriptor duplication such as `2>&1`. Every command in a pipeline or chain needs a matching saved rule. Shell substitutions, variables, script blocks, file redirections and unsupported syntax show a specific reason and retain **Allow once** and exact-invocation approval. This is a conservative matcher, not a shell interpreter or sandbox. A prefix approves all arguments, including a program's own execution flags: choose a narrow subcommand when possible.

Permissions are isolated by repository and shell tool. Description, timeout and explicit false default flags do not trigger new prompts. Background execution, disabling the sandbox and other execution options remain separate. Saving a matching rule also resolves pending permission questions in that repository. Workflow publication and worktree restrictions still apply.

Use **Repositories → repository settings → Saved command permissions** to manually add prefixes, search, refresh or revoke rules. Revocation affects future calls. Automatically approved commands are recorded in **Conversations**.

Claude costs and tokens appear in **Overview → Cost & time** after each SDK call finishes, including reported error results. While waiting for the first report, unavailable totals show a dash rather than zero. Interrupted calls without a report remain unavailable; totals may be incomplete. These are SDK estimates, not subscription billing charges.
