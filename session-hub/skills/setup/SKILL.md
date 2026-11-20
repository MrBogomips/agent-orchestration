---
name: setup
description: >-
  Writes or updates the `## Child sessions` section of a hub's instruction file (AGENTS.md or CLAUDE.md), which
  configures session-hub: repositories, task IDs, master-only parts, model and effort defaults, read scope per
  repository, children record path, guards, environment, layout, worktrees, session names. Proposes values from
  what it finds in the hub and writes only after the user's explicit yes. Use when the user asks to set up,
  configure, initialize or update session-hub or the Child sessions section of a hub, or migrates a hub from
  spawn-session.
---

# Setup

The hub's `## Child sessions` section tells `session-hub:spawn` and `session-hub:dispatch` how this hub works.
Every key is optional; this skill proposes a section from what the hub shows, and writes it only on an explicit
yes. The key reference is `session-hub:spawn`'s `references/hub-config.md`
(`${CLAUDE_PLUGIN_ROOT}/skills/spawn/references/hub-config.md`): read it first.

## Steps

1. **Instruction file.** `AGENTS.md` at the hub root, else `CLAUDE.md`. If `CLAUDE.md` is a link to
   `AGENTS.md`, edit `AGENTS.md`, never through the link. If there is neither, ask whether to create `AGENTS.md`.
2. **Existing section.** Read the `## Child sessions` section if there is one. Keep every value the user set;
   propose only additions and the changes below. A section written for `spawn-session` is migrated:
   - drop `Agent` (children are Claude Code sessions) and say so;
   - review `Propagate`: a child inside the hub already loads the hub's file, so *Propagate* now serves only
     children outside the hub (sibling worktrees). Propose to keep it only if such worktrees are used.
   - the line "Settings for the spawn-session skill" becomes "Settings for the session-hub plugin".
3. **Find values.**
   - *Repositories*: child folders holding `.git` (a directory or a file), and `.gitmodules` paths, each with its
     base branch (`git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD`) and a one-line role from its
     README or instruction file when it has one.
   - *Worktrees*: what each repository's instruction file says about worktrees; `repo` when they say something.
   - *Task IDs*: a backlog or task file in the hub, if one is obvious.
   - *Master only*: sections of the hub's instruction file that describe internal material, trackers, backlogs or
     meetings; propose them, never decide them.
   - *Model*, *Effort*: leave them out unless the user gives defaults. If `model-router:choose-model` is
     available, say that it will choose per child when these keys are absent.
   - *Scope*, *Registry*, *Guards*: leave out (defaults: nothing, the config folder, `on`) unless the user asks.
     A *Registry* path inside the hub is refused: state must live outside it.
4. **Show** the proposed section, and for an update the lines that change, then ask for an explicit yes
   (AskUserQuestion: write it, change something, or don't write). Only "write it" writes.
5. **Write** the section: replace the existing one, or append it at the end of the file. Keep the rest of the
   file byte for byte. Don't commit: say that the file changed, and that committing follows the hub's own rules.

## Template

```markdown
## Child sessions

Settings for the session-hub plugin. The invocation says which repositories a piece of work touches.

- Repositories:
  - `design/`: specification, base branch `main`
  - `product/`: code monorepo, base branch `develop`
  - `prototype/`: throwaway UI prototype, base branch `main`
- Task IDs: `T-123`, listed in `backlog/tasks.md`
- Master only: the sections *Backlog*, *Meetings* and *Tracker* of this file; writing the story tracker; noting
  pull requests on backlog tasks; nothing from `backlog/` or `meetings/` is copied into a child repository
- Propagate: none
- Model: design: opus; product: sonnet; prototype: haiku; read-only: haiku
- Effort: product: medium; read-only: low
- Scope:
  - product: `design/docs/api/`
  - design: `product/src/public-api/`
- Registry: default
- Guards: on
- Environment: auto
- Layout: ask
- Worktrees: repo
- Session name: `<task>-<repo>`
```

Fill it with what step 3 found and leave out every key that would only restate its default, except
*Repositories*.

## Rules

- No write without the explicit yes of step 4, also for a one-line change.
- Never write state into the hub: the children record lives under the config folder unless *Registry* names
  another path outside the hub.
- Don't touch the repositories' own instruction files.
