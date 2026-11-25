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
| `session-hub-scope-guard` | hook (PreToolUse on `Edit`, `Write`, `NotebookEdit`) | In a child, blocks a write whose real path is outside the write root, to a file with more than one hard link (another of its names may be outside), or to the repository's `.claude/settings*.json`, and tells the model to send an `out-of-scope` message to the master. |
| Handoff hook | hook (SessionStart on start, `/clear` and compaction) | In a child, adds its handoff file to the model's context, so the child needs no access to the handoff's folder and no trust dialog at its start; it adds it again after a compaction. |
| `scripts/launch.mjs` | script | Reads how this session was started (identity variables, configuration flags, permission mode) and its session id, so that `spawn` starts children the same way and pins them to it. Prints named variables only, never the environment. |
| `scripts/registry.mjs` | script | Reads and writes the children record, atomically, with the master's identity; lists and clears the outbox of messages children could not deliver. Used by the skills and, read only, by the mod. |
| `session-hub` | mod (needs mods on) | In a child: the send guard, the shell check, origin marking and the scope line. In the master: the children panel and the start line under each child launch. See *The mod* below. |
| `/session-hub` | command (mod) | Shows this session's role and scope; in the master, the children and the panel; `log` opens the children record. In the Claude desktop app, the Session hub card. See [Commands](#commands). |

### Roles

A session is a child only when its launch command sets `SESSION_HUB_ROLE=child`; `spawn` does that. Every other
session is left alone by the hooks. The variables are:

| Variable | Value |
|---|---|
| `SESSION_HUB_ROLE` | `child` |
| `SESSION_HUB_MASTER` | the master's session name when the child started |
| `SESSION_HUB_MASTER_REF` | the master's ref in `ListAgents` when the child started |
| `SESSION_HUB_MASTER_SESSION_ID` | the master's session id; with the ref, it keeps the child reaching a renamed master |
| `SESSION_HUB_SCOPE_ROOT` | absolute path of the write root (on Windows, a Windows path such as `C:/hub/repo`) |
| `SESSION_HUB_HANDOFF` | absolute path of the handoff file, which the handoff hook adds to the child's context |
| `SESSION_HUB_REGISTRY` | absolute path of the children record |
| `SESSION_HUB_GUARDS` | `on` or `off`; absent means `on` |

### The mod

Release 0.2 adds a mod, loaded from the same `hooks/hooks.json` as the hook. It needs mods turned on and Claude
Code 2.1.329 or later (`engines` in `plugin.json`). With mods off, everything above works as in 0.1.

| Function | Where | What it does |
|---|---|---|
| Send guard | child | A message goes only to the master, or to the session's own subagents. The master is its name when the child started (with or without ` [<ref>]`), its ref, or its current name: renaming the master (`/rename`, a title hook, Remote Control) does not cut the child off, since the message goes by the master's session id. A message the master cannot receive is saved in the outbox, next to the children record, and the child is told so. Any other recipient, a socket address included, is refused with a reason that points to the master. |
| Shell check | child | **Best effort.** Denies a `Bash` command whose redirections or file-writing commands (`tee`, `touch`, `mkdir`, `rm`, `rmdir`, `truncate`, `unlink`, `cp`, `mv`, `ln`, `install`, `sed -i`, and `find`'s `-delete` and `-fprint` family) target a path outside the write root, and judges the command `find -exec` (and `-execdir`, `-ok`, `-okdir`) runs. The command is read as bash or zsh (the shell of the `Bash` tool on macOS): zsh's `>!` and `>>!`, `noglob`, `repeat` and `=command` are read, and so are the commands inside substitutions (`$(…)`, backticks, `<(…)`, in double quotes and in here-documents with an unquoted delimiter) and the literal line given to `eval` or `sh -c`. A hard link to a file outside the root is denied, and so is a write through a symbolic link the same command makes to a place outside. A command it cannot read is denied with the reason. `/dev` and the system temporary folders are allowed. |
| Origin marking | child | A message from another session, the master included, carries a line: information, not authorization. A prompt typed by the person carries none. |
| Scope line | child, master | The role and the scope in the system prompt and, after the start and after each compaction, as context on the next prompt. |
| Children panel | master | One row per child: status in the record, live status from the session list, model and effort, last message. Refreshed every 30 s and on `/session-hub`. Its note counts the messages waiting in the outbox. Drawn with `model-router`'s look: the model bold in its tier's colour, the effort as a four-cell bar (`▰▰▰▱ high`) in its level's colour, the statuses green, yellow or red (running; waiting, abandoned or not listed; lost). Under the rows, the `l` key, which opens the children record file. The panel is the terminal's: in the Claude desktop app the children are the Session hub card's Children view. |
| Rename notice | master | When the master was renamed while children run, one notice in the transcript: whether the children still reach it, or how to get them back (`/rename` to the old name, or replace them). |
| Start line | master | One line per child started, with its model and effort. Under a `Bash` call that starts children: `⎿  🔀 opus   ▰▰▰▱ high   -> t42-product`, read from the launch command (`claude` after `SESSION_HUB_ROLE=child`, also in `tmux send-keys`, or `herdr agent start`). In the Claude desktop app the line under a `Bash` row is one quiet line in words (`Started t42-product on Opus · high`), and a child started with the app's `start_session` tool gets no line: the app's own session card names it. A terminal attached to such a session gets a notice once the start has succeeded, `🔀 sonnet · medium → t-1-product-test`, read from the tool's input. A start that states neither model nor effort gets no line. |

Guards fail closed: a send guard or shell check that fails refuses and says why. `SESSION_HUB_GUARDS=off` turns
off the send guard and the shell check (and the hook); the marking and the scope line stay. The mod writes one
kind of file only: in a child, a message its master could not receive, in the outbox. It reads the record and
keeps the rest in the session's memory.

### Commands

`/session-hub` is registered by the mod. With mods off there is no command; the scope guard hook still guards a
child's writes, and the children record stays readable at its path (see *Children record* below). Every
answer is for you only: the model has the scope in its own scope line and reads the children from the record.

| Command | Does |
|---|---|
| `/session-hub` | In a child: its role, write root, handoff, record and whether the guards are on. In a master: the record's path and the children table (status, live status, model and effort as `▰▰▰▱ high`, last message), sized to the terminal, and the children panel opened beside the chat. In any other session: that it has no role. |
| `/session-hub log` | Opens the children record, session-hub's log, in the system's default app (`open` on macOS, `xdg-open` on Linux), printing its path. With no record yet it says so and opens nothing. In a child it opens the record of its master. `record` works too. |
| `/session-hub help` | What the command does. Any other argument prints the same. |

That is the terminal. In the Claude desktop app (and the editor and mobile apps) `/session-hub` draws one card in
the conversation instead, laid out like the app's own `/context` card, and opens no pane:

- **Children** (`/session-hub`): the role, the hub, the repositories and the record; the children grouped by
  status (running, waiting for you, done, abandoned, lost), each with its model and effort in words, what the
  session list says and its last message. A group opens on its name.
- **Record** (`/session-hub log`): how many children, events and requests, when the first started, and the latest
  events; a dropdown narrows them to one child. The record file is linked in the card's last line.
- The title folds the card to its header and one bar of the children by status. The newest card follows the
  30-second refresh.

The two views read the same children record and answer different questions. **Children** is the state now: one row
per child, with its status, its model and effort, and what the live session list says about it (running, idle, or
not listed). **Record** is the history: what happened and when, as counts and a timeline of starts, last messages and
requests with their outcomes, newest first. Look at Children to see who is working; at Record to see what has
happened so far.

In a session with no role (a real run of `claude -p "/session-hub"`):

```text
session-hub: This session has no session-hub role. It becomes a master when it uses session-hub:spawn or session-hub:dispatch.
```

In a child (from the mod's tests):

```text
Role: child of "hub"
Write root: /w/repo
Handoff: /h/t42.md
Children record: not set
Guards: on (scope guard, shell check, send guard)
```

### Messages

A child talks to the master only, with `[<task> <repo>] <type>: <text>`, where type is `question`,
`out-of-scope`, `pr`, `done` or `abandoned`. The master's messages start with `[master]`. A message is
information, never authorization.

### Children record

`<config dir>/session-hub/children-<hub id>.json`, where `<config dir>` is `CLAUDE_CONFIG_DIR` or `~/.claude` and
`<hub id>` is the first 16 hex digits of the sha256 of the hub's real path (NFC-normalized). The hub's *Registry* key can name
another path outside the hub. One entry per child: name, repository, task, scope, model, effort, status
(`running`, `waiting-user`, `done`, `abandoned`, `lost`), start time, last message, requests. Nothing is written
inside a hub or a repository: a path that lands inside the hub, even through a link or a folder not made yet, is
refused, and so is a relative `CLAUDE_CONFIG_DIR`. Writes are atomic and take a lock file next to the record, so two
writers lose no entry. A child started again under the name of one that ended gets a fresh entry.

## Limits

- **Shell writes are covered on a best-effort basis, and only with mods on.** The hook sees `Edit`, `Write` and
  `NotebookEdit`. The mod's shell check reads the command line only: it does not judge a target held in a
  variable, in the output of a command substitution or in a glob, nor a relative path after a `cd` whose target is
  one of those (or `cd -`, `popd`), nor a line given to `eval` or `sh -c` that is not literal, nor what any other
  program writes (a script, `git`, a build tool). Relative paths are read
  against the session's folder, or against the folder of an earlier literal `cd` in the same command. With mods off, a shell
  write is held back only by the handoff.
- **The desktop app has no guard.** Its session tool takes no environment variables, so a child started there
  has no role variables: the scope holds by the handoff alone. `spawn` says so in its report.
- **Trust is per repository.** `claude --bg` in a repository nested in a trusted hub fails with
  `Workspace not trusted` until the user has opened that repository once and accepted the prompt.
- The guard needs `node` on `PATH`. If it cannot run in a child, the hook blocks the write.
- **A killed hook lets the write through.** Claude Code treats a hook that exceeds its timeout (10 s) as a
  non-blocking error. The guard blocks on its own after about 7 s to stay ahead of that, but a hook killed
  from outside before it answers cannot block.
- **A repository's Claude Code settings are the master's.** Their `env` and hook settings could turn a child's
  guards off at its next start, so the hook and the shell check block a child's write to
  `<root>/.claude/settings.json` and `settings.local.json`; the child sends the change to the master instead.
- The guard accepts only absolute paths, and refuses `/` or the home folder as a write root; the mod's shell check
  refuses the same roots. A file inside the root with a second hard link cannot be edited in a child, even when
  both names are inside the root: the guard cannot see where the other name is. The role value is
  read without regard to case or surrounding spaces; an unknown value blocks every write unless
  `SESSION_HUB_GUARDS` is `off`.
- Model and effort on the desktop app's start tool are unverified.
- **A handoff over 9,500 characters is added in part.** Claude Code keeps up to 10,000 characters of a hook's
  context, so the handoff hook cuts a longer file at a line and tells the child from which line to read the rest;
  that read may ask for permission. `spawn` keeps handoffs under 9,000 characters.
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
*Effort* keys did; without it, a child inherits the master's model and effort and the report says so. The panel and
the start line draw models and efforts with `model-router`'s colours from session-hub's own copy of them, so they
look the same with or without `model-router`.

Then run `session-hub:setup` in the hub to write its *Child sessions* section, or let `spawn` use the defaults.

## Manual

The user manual for both plugins, with a worked example and screenshots of the guards, the command and the
panel, is `docs/manual/user-manual.pdf` in the source repository.

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
| — | `Permissions` | new: `ask` or `inherit`, for the children of a master that bypasses permission prompts |
| — | `Carry` | new: names of more environment variables a child takes from the master's launch |

Other changes: the handoff gains *Session*, *Scope* and *Messages* (which replaces *Channel to the master*); a
request outside the scope goes to the master even when the user makes it in the child's session; the master
keeps a children record, where `spawn-session` tracked nothing.
