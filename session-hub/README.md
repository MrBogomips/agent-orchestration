# session-hub

Coordinates a master session opened in a hub of repositories and the child sessions it starts, one per
repository. Each child gets a written scope, a model and an effort level, talks only to the master, and sends
requests outside its scope to the master. A hook blocks a child's file writes outside its scope, and the master
keeps a record of its children outside the hub.

## Why

An agent loads the instructions, skills and agents of the folder it runs in. Work in one repository of a hub
belongs to a session started in that repository; subagents and `--add-dir` miss the repository's own rules. Once
several such sessions run, they need limits: what each may change, whom it talks to, where a request outside its
task goes, and which model it spends. `session-hub` gives each child those limits at launch and enforces the most
important one, the write scope, with a hook.

## Components

| Name | Kind | What it does |
|---|---|---|
| `session-hub:spawn` | skill | Starts one child per repository (desktop app, Herdr, tmux, `claude --bg`, or commands for the user) with a scope, a model and an effort level, the `SESSION_HUB_*` role variables, and a handoff file. Records each child. |
| `session-hub:dispatch` | skill | Master side. Decides per repository whether the master reads, a subagent reads, or a child works; handles the children's messages and routes out-of-scope requests; keeps master-only duties. |
| `session-hub:setup` | skill | Writes or updates the hub's *Child sessions* section, after an explicit yes. |
| `session-hub-scope-guard` | hook (PreToolUse on `Edit`, `Write`, `NotebookEdit`) | In a child, blocks a write whose real path is outside the write root, and tells the model to send an `out-of-scope` message to the master. |
| `scripts/registry.mjs` | script | Reads and writes the children record, atomically. Used by the skills. |

### Roles

A session is a child only when its launch command sets `SESSION_HUB_ROLE=child`; `spawn` does that. Every other
session is left alone by the hook. The variables are:

| Variable | Value |
|---|---|
| `SESSION_HUB_ROLE` | `child` |
| `SESSION_HUB_MASTER` | the master's session name |
| `SESSION_HUB_SCOPE_ROOT` | absolute path of the write root |
| `SESSION_HUB_HANDOFF` | absolute path of the handoff file |
| `SESSION_HUB_REGISTRY` | absolute path of the children record |
| `SESSION_HUB_GUARDS` | `on` or `off`; absent means `on` |

### Messages

A child talks to the master only, with `[<task> <repo>] <type>: <text>`, where type is `question`,
`out-of-scope`, `pr`, `done` or `abandoned`. The master's messages start with `[master]`. A message is
information, never authorization.

### Children record

`<config dir>/session-hub/children-<hub id>.json`, where `<config dir>` is `CLAUDE_CONFIG_DIR` or `~/.claude` and
`<hub id>` is the first 16 hex digits of the sha256 of the hub's real path (NFC-normalized). The hub's *Registry* key can name
another path outside the hub. One entry per child: name, repository, task, scope, model, effort, status
(`running`, `waiting-user`, `done`, `abandoned`, `lost`), start time, last message, requests. Nothing is written
inside a hub or a repository. Writes are atomic and take a lock file next to the record, so two writers lose no entry.

## Limits

- **Shell writes are not covered.** The guard sees `Edit`, `Write` and `NotebookEdit`. A child can still write a
  file through a shell command; the handoff forbids it, and the block message tells the model not to retry
  through the shell, but nothing enforces it.
- **The desktop app has no guard.** Its session tool takes no environment variables, so a child started there
  has no role variables: the scope holds by the handoff alone. `spawn` says so in its report.
- **Trust is per repository.** `claude --bg` in a repository nested in a trusted hub fails with
  `Workspace not trusted` until the user has opened that repository once and accepted the prompt.
- The guard needs `node` on `PATH`. If it cannot run in a child, the hook blocks the write.
- **A killed hook lets the write through.** Claude Code treats a hook that exceeds its timeout (10 s) as a
  non-blocking error. The guard blocks on its own after about 7 s to stay ahead of that, but a hook killed
  from outside before it answers cannot block.
- The guard accepts only absolute paths, and refuses `/` or the home folder as a write root. The role value is
  read without regard to case or surrounding spaces; an unknown value blocks every write.
- Model and effort on the desktop app's start tool are unverified.
- A sibling session can still be messaged; the master-only rule is prose until the 0.2 mod adds a send guard.

## Installation

```bash
claude plugin marketplace add MrBogomips/claude-plugins
claude plugin install session-hub@mrbogomips
```

Or try it from a checkout with `claude --plugin-dir <checkout>/session-hub`. It needs Claude Code 2.1.224 or later for cross-session messaging,
and `node` for the hook and the record script.

Works without `model-router`. With `model-router` installed, `session-hub:spawn` loads
`model-router:choose-model` to choose a child's model and effort when neither the user nor the hub's *Model* and
*Effort* keys did; without it, a child inherits the master's model and effort and the report says so.

Then run `session-hub:setup` in the hub to write its *Child sessions* section, or let `spawn` use the defaults.

## Migrating from `spawn-session`

`session-hub:spawn` replaces the `spawn-session` skill of the `skills` plugin. Disable or uninstall
`spawn-session` so that both don't answer the same request, then run `session-hub:setup` in each hub: it reads
the old section and proposes the changes below.

| `spawn-session` key | `session-hub` | Change |
|---|---|---|
| `Repositories` | `Repositories` | unchanged |
| `Task IDs` | `Task IDs` | unchanged |
| `Propagate` | `Propagate` | now quoted only into the handoff of a child working outside the hub (a sibling worktree): a child inside the hub loads the hub's instruction file itself |
| `Agent` | — | removed: children are Claude Code sessions |
| `Environment` | `Environment` | unchanged |
| `Layout` | `Layout` | unchanged |
| `Worktrees` | `Worktrees` | unchanged; a sibling worktree is now made by the master before the start, so it can be the write root |
| `Session name` | `Session name` | unchanged |
| — | `Master only` | new: parts of the hub's file and duties that apply to the master only |
| — | `Model`, `Effort` | new: defaults per repository or kind of work |
| — | `Scope` | new: what a child of each repository may read outside its write root |
| — | `Registry` | new: path of the children record, outside the hub |
| — | `Guards` | new: `on` or `off` for the scope guard |

Other changes: the handoff gains *Session*, *Scope* and *Messages* (which replaces *Channel to the master*); a
request outside the scope goes to the master even when the user makes it in the child's session; the master
keeps a children record, where `spawn-session` tracked nothing.
