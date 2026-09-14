---
name: example-implement
description: Implement the approved ticket plan or one explicitly requested correction round in AI Native Workflow.
---

# Example implementation skill

Use this skill for the implementation stage in the provided project worktree.

1. Read the ticket, approved plan, repository instructions, and any correction instructions supplied by the application. Follow the repository's existing patterns and toolchain.
2. Implement the smallest complete change that meets the approved requirements. Preserve unrelated work and avoid opportunistic refactoring, dependency upgrades, and formatting changes.
3. During a correction round, address only the selected review findings and the user's additional instructions. Do not start another correction round yourself.
4. Use `AskUserQuestion` if implementation exposes a consequential ambiguity or requires a scope change. Request tool permissions through the normal Claude mechanism; explain a denied action or blocker instead of bypassing it.
5. Add or adjust meaningful tests where appropriate. You may run bounded, relevant checks, but leave the configured workflow test stage to the application. Do not claim a command passed unless you observed its successful result. Do not install a different toolchain merely because a check is unavailable.
6. Return a concise `summary` using the application's structured output contract. Explain what changed, which requirements or selected findings were addressed, checks actually run and their results, and unresolved limitations. Explicitly identify any work that could not be completed.

Do not commit, push, create or merge a PR, switch branches, manipulate worktrees, or launch persistent servers. Those actions belong to the application. Do not read or include secret values in the report. Stop after this implementation round so the application can run tests and an independent review.
