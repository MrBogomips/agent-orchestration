# session-hub

Coordinates a master session opened in a hub of repositories and the child sessions it starts, one per
repository. Each child gets a written scope, a model and an effort level, talks only to the master, and sends
requests outside its scope to the master. A hook blocks a child's file writes outside its scope, and the master
keeps a record of its children outside the hub. With mods on, a mod also keeps a child's messages to the master,
checks its shell commands, marks messages from other sessions, keeps the scope in its context and shows the master
a panel of its children.

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
| `scripts/registry.mjs` | script | Reads and writes the children record, atomically. Used by the skills and, read only, by the mod. |
| `session-hub` | mod (needs mods on) | In a child: the send guard, the shell check, origin marking and the scope line. In the master: the children panel. See *The mod* below. |
| `/session-hub` | command (mod) | Shows this session's role and scope; in the master, the children and the panel. |

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

### The mod

Release 0.2 adds a mod, loaded from the same `hooks/hooks.json` as the hook. It needs mods turned on and Claude
Code 2.1.329 or later (`engines` in `plugin.json`). With mods off, everything above works as in 0.1.

| Function | Where | What it does |
|---|---|---|
| Send guard | child | A message goes only to the master, by its name (with or without ` [<ref>]`; it is delivered to the bare name), or to the session's own subagents. Any other recipient, a socket address included, is refused with a reason that points to the master. |
| Shell check | child | **Best effort.** Denies a `Bash` command whose redirections or file-writing commands (`tee`, `touch`, `mkdir`, `rm`, `rmdir`, `truncate`, `unlink`, `cp`, `mv`, `ln`, `install`, `sed -i`) target a path outside the write root. `/dev` and the system temporary folders are allowed. |
| Origin marking | child | A message from another session, the master included, carries a line: information, not authorization. A prompt typed by the person carries none. |
| Scope line | child, master | The role and the scope in the system prompt and, after the start and after each compaction, as context on the next prompt. |
| Children panel | master | One row per child: status in the record, live status from the session list, model and effort, last message. Refreshed every 30 s and on `/session-hub`. |

Guards fail closed: a send guard or shell check that fails refuses and says why. `SESSION_HUB_GUARDS=off` turns
off the send guard and the shell check (and the hook); the marking and the scope line stay. The mod keeps no
files: it reads the record and keeps the rest in the session's memory.

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

- **Shell writes are covered on a best-effort basis, and only with mods on.** The hook sees `Edit`, `Write` and
  `NotebookEdit`. The mod's shell check reads the command line only: it does not judge a target held in a
  variable, a command substitution, a glob or a relative path after a `cd`, nor what any other program writes
  (a script, `git`, a build tool). Relative paths are read against the session's folder. With mods off, a shell
  write is held back only by the handoff.
- **The desktop app has no guard.** Its session tool takes no environment variables, so a child started there
  has no role variables: the scope holds by the handoff alone. `spawn` says so in its report.
- **Trust is per repository.** `claude --bg` in a repository nested in a trusted hub fails with
  `Workspace not trusted` until the user has opened that repository once and accepted the prompt.
- The guard needs `node` on `PATH`. If it cannot run in a child, the hook blocks the write.
- **A killed hook lets the write through.** Claude Code treats a hook that exceeds its timeout (10 s) as a
  non-blocking error. The guard blocks on its own after about 7 s to stay ahead of that, but a hook killed
  from outside before it answers cannot block.
- The guard accepts only absolute paths, and refuses `/` or the home folder as a write root. The role value is
  read without regard to case or surrounding spaces; an unknown value blocks every write unless
  `SESSION_HUB_GUARDS` is `off`.
- Model and effort on the desktop app's start tool are unverified.
- **The send guard needs mods on.** With mods off, a sibling can still be messaged; the master-only rule is
  then prose. A child replies to the master by its name: a reply to the `from` address of a message is refused.
- **A child resumed without its variables is no longer a child.** The role comes from the launch environment;
  `claude --resume` typed without the `SESSION_HUB_*` variables leaves the hook and the mod inactive.
- **An organization's managed mod can skip parts of the mod.** Seen with a security mod that runs first: it
  passed `prompt.compose` and the compaction events on without the session-hub hooks. The scope line then rides
  prompts as context, and a compaction is told from the context's size.
- The children panel's live status comes from the session list; a child the list does not show reads
  `not listed`.

## Installation

```bash
claude plugin marketplace add MrBogomips/claude-plugins
claude plugin install session-hub@mrbogomips
```

Or try it from a checkout with `claude --plugin-dir <checkout>/session-hub`. It needs Claude Code 2.1.224 or later for cross-session messaging,
and `node` for the hook and the record script. The mod needs mods turned on and Claude Code 2.1.329 or later;
without them the skills, the hook and the record work as in 0.1.

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
| — | `Guards` | new: `on` or `off` for the scope guard and the mod's send guard and shell check |

Other changes: the handoff gains *Session*, *Scope* and *Messages* (which replaces *Channel to the master*); a
request outside the scope goes to the master even when the user makes it in the child's session; the master
keeps a children record, where `spawn-session` tracked nothing.
