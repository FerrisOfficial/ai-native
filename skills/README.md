# Workflow skills

Add skills manually as `skills/<skill-id>/SKILL.md`, then choose **Refresh skills** in the app. No starter skills are enabled automatically.

## Included examples

The stage selectors also discover skills in the selected repository's `.claude/skills/<skill-id>/SKILL.md`. Enter the repository path in its settings or select a repository in **New project**; discovery runs automatically. Use **Refresh repository skills** to rescan after editing files. Options show **Application** or **Repository**, so identical names stay distinct. Invalid skills cannot be selected.

Repository skills use the same validation rules as the application library. Their instructions and supporting files are copied from the local source checkout when a project is created, even when they are uncommitted or ignored by Git. Later edits do not change existing project snapshots. Repository skill directories must not use symlinks or junctions. The application assigns repository copies unique internal names when loading its session plugin; original files stay unchanged. The **Skills** library page lists application skills; repository skills appear in the repository and project selectors.

Choose **Skills → Refresh skills**, then set these selections in **Repositories**:

| Stage     | Skill               |
| --------- | ------------------- |
| Plan      | `example-plan`      |
| Implement | `example-implement` |
| Review    | `example-review`    |

All three can use model `default`. These are general-purpose starting points; customize copies for your repository's conventions and ticket tools.

For a first trial, use a small GitHub issue in a repository you control, for example a request to add a troubleshooting paragraph to its README with clear acceptance criteria. Configure that repository in the app, create a project with the issue URL, and run **Prepare workspace**. The planner can retrieve GitHub issues through your existing `gh` login; other ticket providers need an available MCP or fetch tool. Inaccessible tickets stop planning with an error. These skills use real Claude sessions and require a working Claude login.

Approve the plan, inspect the implementation and review, then choose whether to publish. A correct small change may produce no review findings. These examples do not force questions, findings, or failures; use `npm run test:ui-fixture` for a deterministic GUI demonstration. Existing projects retain their skill snapshots; select these examples in a new project to try them.

Each directory must have a lowercase, hyphenated name matching the YAML `name`:

```markdown
---
name: my-planner
description: Retrieve a ticket and prepare a concrete implementation plan.
---

Your instructions go here.
```

Supporting files, scripts and references belong inside the same directory. Symlinks and junctions are rejected. Projects receive immutable copies outside the target repository. Every project selects one skill for planning, one for implementation, and one for review; a skill may be reused for multiple stages.

The planning skill should retrieve the supplied ticket URL using the existing Claude MCP/CLI configuration. It must report an inaccessible ticket instead of inventing its contents. Planning and review return their work to the application instead of writing plan or review files into the repository. The application adds the stage's structured output contract; skills should focus on the actual workflow instructions.
