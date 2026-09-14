# Workflow skills

Add skills manually as `skills/<skill-id>/SKILL.md`, then choose **Refresh skills** in the app. No starter skills are enabled automatically.

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
