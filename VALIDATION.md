# Validation record

## Verified locally

- TypeScript checking, production Vite build, and Prettier formatting check.
- All 16 automated tests passed on Windows (15 workflow/API tests and one real PowerShell PTY test).
- Real Git worktree creation with independent branches and copied local configuration, exercised with a deterministic Claude driver.
- Plan and result approval gates, selected corrections, test failures, missing tests, inaccessible tickets, setup errors, rate-limit errors, queue control, interruption and persisted restart state.
- Publication retries against a local bare Git remote and fake GitHub responses, including a lost PR-creation response.
- Local API Host/origin checks and session-token requirements.
- Real interactive PowerShell startup, input/output and termination using node-pty. The bundled ConPTY implementation avoids the Windows console-list helper shutdown race.
- Browser verification against the separate UI fixture: Kanban, repository and project forms, worktree creation from the GUI, plan approval through to review, review selection and one correction round, tool approval, follow-up question, and live terminal input/output (`BROWSER_PTY_OK`).
- GitHub CLI authentication is valid; checked with `gh auth status` without publishing changes.

## External integration limits

The installed Claude Code executable starts through the Agent SDK and discovers the fixture plugin/skill and local configuration. The real model call reported:

> Failed to authenticate: OAuth session expired and could not be refreshed

Therefore **real model-side MCP execution, questions, permissions, interrupt and resume have not been confirmed**. Their host callbacks and GUI are verified using deterministic fixtures. After `claude auth login`, rerun `npm run probe:claude` to verify those external interactions.

No real GitHub PR was created during implementation. GitHub publication is tested using controlled CLI responses and an actual local Git push. A real repository-specific test should be performed only with an explicitly approved change.
