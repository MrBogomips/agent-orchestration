---
name: setup
description: Writes or updates the Model routing section of a project's instruction file (AGENTS.md), with the project's default model and effort and its exceptions per kind of work, after the user confirms. Use when the user asks to set up model-router or model routing for a project, to set project defaults for models or effort, or to add an exception such as "always use opus for migrations".
---

# Set up model routing for a project

The *Model routing* section tells `model-router:choose-model` where this project departs from the grid. It holds
defaults and exceptions only; the grid itself stays in `choose-model`. Nothing is written until the user says
yes to the exact text.

## 1. Find the instruction file

Work from the root of the current repository (`git rev-parse --show-toplevel`, else the current folder).

| What is there | Write to |
|---|---|
| `AGENTS.md`, with or without a `CLAUDE.md` that links to it | `AGENTS.md` |
| A `CLAUDE.md` that is a symbolic link to another file | the link's target, never the link itself |
| Only a regular `CLAUDE.md` | `CLAUDE.md`, and say that an `AGENTS.md` with `CLAUDE.md` linked to it would serve every agent |
| Neither | ask whether to create `AGENTS.md`; stop if the answer is no |

Check a `CLAUDE.md` with `test -L CLAUDE.md` before choosing. Never replace the link with a file.

## 2. Read what exists

If the file already has a `## Model routing` section, read it: this run updates it in place and keeps the
entries the user does not change.

## 3. Gather the project's needs

Ask the user, and look at the repository to make concrete suggestions:

- **Default.** Whether the grid alone decides (the usual answer), or the project wants a different default
  model or effort.
- **Exceptions.** Kinds of work that need more, or can take less, than the grid gives. Look for what makes a
  mistake expensive here: database migrations, infrastructure and deployment files, billing or payment code,
  generated code, large mechanical refactors. Map each to a task class when one fits.
- **The coordinator.** Whether a session that mostly delegates should run on something other than `opus` at
  `medium`.

Keep every value inside the grid:

- models: `haiku`, `sonnet`, `fable`, `opus`;
- effort: `low`, `medium`, `high`, `xhigh` (never `max`);
- classes: `read-search`, `read-analyze`, `edit-mechanical`, `edit-specified`, `review-debug`, `design-open`.

A value the user names outside these lists is shown back to them with the nearest valid one.

## 4. Propose the section

Show the full section exactly as it will be written:

```markdown
## Model routing

Defaults for `model-router:choose-model`. An explicit choice in the conversation still wins; anything not
listed here follows the grid.

- Default: the grid
- Coordinator: `opus` · `medium`

| Kind of work | Class | Model | Effort | Why |
|---|---|---|---|---|
| Database migrations | `edit-specified` | `opus` | `high` | data cannot be restored |
| Bulk renames across the codebase | `edit-mechanical` | `haiku` | `low` | checked by the compiler |
```

Use "the grid" for any value the project does not fix, and leave the table out when there are no exceptions.
A row may name a class, a kind of work, or both; the class column is `—` when none fits.

## 5. Ask for an explicit yes

Ask whether to write this section to the chosen file. Write only after a clear yes. Any other answer means
revise and show the section again, or stop.

## 6. Write

- Replace the existing `## Model routing` section (up to the next `## ` heading) when there is one; otherwise
  append the section at the end of the file.
- Change nothing else in the file.
- Do not commit. Say which file changed and suggest committing it with the project's own conventions.

## 7. Report

One short paragraph: the file written, the default, and the exceptions added, changed or removed.
