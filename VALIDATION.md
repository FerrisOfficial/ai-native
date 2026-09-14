# Validation record

## Verified locally

- TypeScript checking, production Vite build, and Prettier formatting check.
- All 23 automated tests passed on Windows, including workflow/API, real PowerShell PTY, repository skills, configuration detection and usage/budget tests.
- Configuration detection reads manifests without running scripts; checked npm/Vite, pnpm/Next, conflicting lockfiles, static sites, Rust, Go and Python. GUI verification covered previewing and applying the static-site proposal without saving over the user's settings.
- Cost tracking tests use a controlled SDK stream to verify result accounting, whole-tree tokens, error costs, resumed-call budgets and unknown-cost handling. A workflow/API test verifies that a zero budget blocks implementation and clearing it permits manual resume. No paid model request was made to test the budget ceiling.
- GUI verification covered historical per-stage cost/time/token display, saving a project limit, checking persistence after reload and restoring the prior limit. SDK limits are approximate and can overshoot by the final request; they are not a billing guarantee.
- Real Git worktree creation with independent branches and copied local configuration, exercised with a deterministic Claude driver.
- Plan and result approval gates, selected corrections, test failures, missing tests, inaccessible tickets, setup errors, rate-limit errors, queue control, interruption and persisted restart state.
- Publication retries against a local bare Git remote and fake GitHub responses, including a lost PR-creation response.
- Local API Host/origin checks and session-token requirements.
- Real interactive PowerShell startup, input/output and termination using node-pty. The bundled ConPTY implementation avoids the Windows console-list helper shutdown race.
- Browser verification against the separate UI fixture: Kanban, repository and project forms, worktree creation from the GUI, plan approval through to review, review selection and one correction round, tool approval, follow-up question, and live terminal input/output (`BROWSER_PTY_OK`).
- GitHub CLI authentication is valid; checked with `gh auth status` without publishing changes.

## External integration limits

The initial integration probe discovered the fixture plugin/skill and local configuration, but its model call reported:

> Failed to authenticate: OAuth session expired and could not be refreshed

A subsequent real-repository test on 2026-09-14 successfully authenticated and exercised real planning and implementation sessions with the included example skills, a local HTTP ticket, tool permission approval and denial, GUI plan approval, and the configured JavaScript syntax check. It also verified worktree preparation, a dedicated port, terminal input through the GUI, terminal restart with retained history, and project recovery after restarting the server. The source checkout stayed clean; the requested README was created only in the managed worktree.

The independent real review session completed with no findings. The project reached `awaiting_result`, with the syntax check recorded as passed (exit code 0). Publication was deliberately not approved. This validates the basic real workflow through the final approval gate, not GitHub publication or the behavior of the website in a browser.

This run exposed a CLI compatibility error: Zod's default Draft 2020-12 schema was rejected by the installed Claude validator. The driver now explicitly generates Draft 7 output schemas. Real model calls proceeded after that fix. TypeScript checking, the production build, and all 16 automated tests passed again.

Real model-side MCP execution, clarification questions, and interruption/resumption of an active model session still require the dedicated `npm run probe:claude` check. Permission callbacks have now been exercised with real model requests; the remaining interactions are covered by deterministic fixtures only.

No real GitHub PR was created during implementation. GitHub publication is tested using controlled CLI responses and an actual local Git push. A real repository-specific test should be performed only with an explicitly approved change.
