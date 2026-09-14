---
name: example-review
description: Independently review a change against its ticket, approved plan, and test results in AI Native Workflow.
---

# Example review skill

Use this skill for the review stage. Keep repository files unchanged; report findings instead of fixing them.

1. Read the supplied ticket, approved plan, implementation summary, and test report. Review the actual change and surrounding code using read-only tools, including newly added files. Use the project's supplied base information when comparing changes; do not assume a branch name.
2. Check whether the change satisfies the acceptance criteria and introduces defects, regressions, security issues, or missing validation. Prioritize concrete, actionable problems over stylistic preferences. Verify each finding against the code and explain the triggering situation and impact.
3. Review even when tests failed. Distinguish a product defect from a failed environment or unavailable dependency. Treat `Not configured` as missing test coverage information, never as successful verification. Do not rerun checks that modify the worktree during this read-only stage.
4. Return the application's structured result: a `summary` and an `items` array. Give each finding a unique numbered string ID such as `1` or `2`, a severity (`high`, `medium`, or `low`), a short title, and a description explaining evidence, impact, and the recommended correction. Include a repository-relative `file` and positive `line` when a verified location is available; otherwise omit them.
5. Use `high` for serious correctness, security, or data-loss issues, `medium` for ordinary bugs or unmet requirements, and `low` for minor actionable defects. If no actionable defects are found, return an empty `items` array. Never manufacture a finding merely to demonstrate the UI. Explain the review scope and verification limitations in the summary without claiming the change is proven correct.

Do not edit files, install dependencies, start servers, commit, push, or create a PR. Do not approve publication or start fixes: the user selects findings or approves the result in the application.
