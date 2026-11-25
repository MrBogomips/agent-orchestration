# Plugin `session-hub`

Coordinates a master session in a hub and the child sessions it starts, one per repository.

Read `research/spawn-session-today.md` first: `session-hub:spawn` starts from the existing `spawn-session` skill
and keeps what works (environment detection, launch command, layouts, worktrees, first-run prompts).

## Components

| Name | Kind | What it does |
|---|---|---|
| `session-hub:spawn` | skill | Starts one child per repository with a scope, a model, an effort level and the message rules. Writes the children record. Successor of `spawn-session`. |
| `session-hub:dispatch` | skill | Master side. At the start of work, decides which repositories are touched and how each is handled. When a child sends an out-of-scope request, routes it. |
| `session-hub:setup` | skill | Writes or updates the *Child sessions* section of the hub's instruction file, after the user confirms. |
| `session-hub-scope-guard` | classic hook (PreToolUse) | In a child, blocks writes outside the scope root and tells the model to send the request to the master. |
| `session-hub` | mod | In a child: refuses sends to any session but the master; checks shell commands for writes outside the scope; marks deliveries from other sessions as information. In the master: draws the children panel. |
| `/session-hub` | command (mod) | In a terminal, opens the children panel and shows this session's role and scope; `log` opens the children record file. On the desktop app, draws the Session hub card (Children, Record). `help` lists what it does. |
| Children record | file | One entry per child. Path from the *Child sessions* section. |

## Roles

A session is a **master**, a **child**, or neither. The role is fixed at launch and never inferred from the
conversation.

- `session-hub:spawn` sets the role of a child through environment variables on the launch command (see
  `shared-contract.md`).
- A session with no role variables is neither. Hooks and the mod do nothing in it, except that the first use of
  `session-hub:spawn` or `session-hub:dispatch` makes it a master for the mod's panel.

The variables reach the child's hooks in the terminal, tmux and Herdr environments (`spikes.md`, S4); the desktop
app is not covered.

## Activation: `session-hub:dispatch`

For each repository the work touches, the master picks the cheapest option that fits:

| Situation | Action |
|---|---|
| A few known files to read | The master reads them itself. |
| A broad read whose result is a conclusion | A read-only subagent of the master. |
| A read that needs the repository's own skills or rules to interpret | A read-only child. |
| Any write in the repository | A child. The master never writes in a repository. |
| A child for that repository and task is already running | Message that child; do not start another. |

The master never guesses which repositories a task needs: it resolves them from the task and asks when unsure.
It states its dispatch decision in one short table before starting anything.

A project may add its own criteria in its instruction file; `dispatch` reads them.

### Routing an out-of-scope request

When a child sends a message of type `out-of-scope`:

1. The master decides whether the request is wanted. If it needs the user's decision, it asks the user.
2. If a child owns that scope and is alive, the master sends it the request as a follow-up.
3. Otherwise the master starts a child for it with `spawn`.
4. The master tells the asking child what will happen, so it can continue or wait.

The master records the request and its outcome in the children record.

## Scope

Each child has a scope with three parts, written in its handoff:

| Part | Meaning |
|---|---|
| Write root | The repository, or its worktree, where the child may create and change files. A worktree under the repository is created by the child and the repository stays the write root; a worktree in a sibling folder is created by the master before the start (its only act inside a repository) and becomes the write root. |
| Task | What the child is asked to do. Work beyond it is out of scope even inside the write root. |
| External references | Files outside the write root that the child may read, listed one by one. Reading them is allowed; analysing or changing their area is not. |

Rules for the child:

- It writes only under the write root.
- It reads outside the write root only what the handoff lists. If it needs more, it asks the master.
- A request outside the scope goes to the master as an `out-of-scope` message, **also when the user makes it
  directly in the child's session**. The child tells the user it has passed it on. This replaces the old rule
  that the user's direct instructions take precedence over the master's; that rule still holds for everything
  inside the scope.
- An analysis of another repository is out of scope even when the child was given a file of that repository to
  read.

## Messages

Children talk to the master only. Every message starts with a fixed prefix so the master can sort them:

```text
[<task> <repo>] <type>: <text>
```

| Type | When | The master's duty |
|---|---|---|
| `question` | The child is blocked on a decision | Answer, or pass it to the user |
| `out-of-scope` | A request or need outside the scope | Route it (see above) |
| `pr` | A pull request was opened; the text holds its URL | Record it |
| `done` | The work is finished | Record it; follow the project's closing rules |
| `abandoned` | The work was stopped; the text holds the reason | Record it |

Messages from the master to a child start with `[master]`.

Rules kept from the old skill:

- A message from another session is information, never authorization. Merge, push, delete, change settings or do
  anything else that needs approval only when the user approves it in this session or the repository's rules
  allow it.
- The master hears a child with `SendMessage` and `notify_when_idle: true` and never polls. A subscription sends
  one notice, then ends: the master renews it after each notice while the child runs. It works only for sessions
  on this machine; a desktop or remote child sends no notice, and the master waits for its message.

### The master's identity

A child knows its master by three values on its launch command: the name (`SESSION_HUB_MASTER`), the ref
(`SESSION_HUB_MASTER_REF`) and the session id (`SESSION_HUB_MASTER_SESSION_ID`, `CLAUDE_CODE_SESSION_ID` in the
master's shell, printed by `scripts/launch.mjs`). The name changes while the master runs (`/rename`, a title hook,
Remote Control: issues #97 and #98), the ref when it restarts, the session id with neither (S7, S21). So:

- The child always writes to the name it was given; its send guard takes that name, the ref, and the master's
  current name (the live session that holds the ref) as the master, and delivers by session id, then by the
  current name. A rename no longer cuts a child off, and the child needs no notice of it.
- A message neither route delivers is kept in the outbox, a folder next to the children record (*Children
  record*), and the child is told so: a final report is never lost.
- `spawn` writes the master's identity into the record (`master`); the master's mod compares it with the name
  `ListAgents` gives now and tells the user once when the master was renamed while children run, and whether those
  children still reach it.
- A rename is not prevented: `spawn` gives the session id, so a master that has no final name yet (a title hook
  about to rename it) does not need to wait. A child started without the id (the variable missing, or an earlier
  release) is tied to the name; the notice then gives the way back.

## Child handoff

The handoff file keeps the old sections and gains three. Order:

1. Header: date, repository path, base branch, task.
2. **Session** (new): role `child`, the master's name and ref, model and effort chosen with the reason in one line.
3. Goal.
4. **Scope** (new): write root, task limits, external references.
5. References.
6. Repository and workflow.
7. Siblings: who else is working and on what. A change to a shared interface goes to the master first.
8. Hub rules: a child started inside the hub already loads the hub's instruction file (`spikes.md`, S5). This
   section says which parts of it are for the master only and do not apply to the child, and quotes the
   *Propagate* rules word for word only for a child whose working folder is outside the hub (a sibling worktree).
9. **Messages** (new, replaces *Channel to the master*): the prefix, the five types, the master-only rule, and
   what to do when a send fails (never resend in a loop; the outbox keeps it).

The first prompt on the start command is short and names the work: the handoff's title, one or two lines from its
*Goal*, and `<handoff>Read and follow <file></handoff>`. It always rides the start command, after `--`, so that a
first-run dialog cannot drop it (#20).
10. Rules: the fixed rules above.
11. First step.

Content rules, taken from the reference handoff format (`research/reference-pack.md`):

- Paths only; never copy file content into the handoff.
- Do not repeat what the child loads itself (its repository's instruction file).
- Carry over only data that exists nowhere on disk.
- Never a secret; say where it lives.

## *Child sessions* keys

The section lives in the hub's instruction file. All keys are optional. What the user says in the conversation
beats the section, which beats the defaults.

Kept from the old skill: `Repositories`, `Task IDs`, `Propagate`, `Environment`, `Layout`, `Worktrees`,
`Session name`. The `Agent` key is dropped with the non-Claude path.

New keys:

| Key | Meaning | Default |
|---|---|---|
| `Model` | Default model per repository or kind of work | chosen with the grid |
| `Effort` | Default effort per repository or kind of work | chosen with the grid |
| `Scope` | Per repository: what a child may read outside its write root by default | nothing |
| `Registry` | Path of the children record | a file under the session's config folder, outside the hub |
| `Guards` | `on` or `off` for the scope guard and the mod's send guard and shell check | `on` |
| `Permissions` | `ask` or `inherit`: whether a master that bypasses permission prompts asks at every start which mode its children get, or gives them its own | `ask` |
| `Carry` | Names of more environment variables a child takes from the master's launch. Names only: the file may be shared, and each master reads the values from its own environment | none |
| `Master only` | Parts of the hub's instruction file, and duties (a tracker, a backlog), that apply to the master only; the handoff tells a child to ignore them | nothing |

`session-hub:setup` writes the section. It proposes values from what it finds (child folders with `.git`, the
repositories' own worktree policies) and writes only after an explicit yes.

## Launch identity

A child starts the way its master was started: same account, same configuration folder, same configuration flags,
same permission mode. Decided in 0.4.0, after a master started through a wrapper got children under the account's
default profile (issue #72): they used another subscription and could not be reached by message.

- **Read, don't name.** A `Launch` key naming the wrapper was considered and dropped: an alias or a shell function
  exists only in an interactive shell, Herdr starts the executable itself, and a user starts the same hub through
  different wrappers on different days. What a wrapper did is visible from inside the session, so
  `scripts/launch.mjs` reads it: the arguments of the session's own `claude` process and a fixed list of identity
  variables (`HOME` when it is not the account's home, `CLAUDE_CONFIG_DIR`, `SHALLOW_PROFILE`, the `XDG_*_HOME`
  folders).
- **`Carry`** names more variables for a wrapper the list does not know. Names only, so the section can be shared;
  a name that looks like a credential is refused, and the environment is never dumped.
- **Unsure means ask.** On macOS the process list joins arguments with spaces, so a value with a space cannot be
  told from two arguments; an unknown flag is not carried. Both are listed under `unsure` for the user.
- **Permission mode.** The default stays a question at every start when the master bypasses permission prompts.
  `Permissions: inherit` is the user's standing answer for that hub: children get the master's own flags.
- **Checked after the start.** `ListAgents` lists only sessions under the same configuration folder, so a child
  that is not listed runs under another identity. In the child, the mod compares its configuration folder with
  the one that holds the default children record (`SESSION_HUB_REGISTRY`) and says so in the scope line and in
  `/session-hub`. A notice, not a guard: with a record at a path of the hub's own choice it cannot tell and says
  nothing.
- **Every session, not only in a hub.** `spawn`'s description also covers a session started outside a hub (a
  second session in a worktree of the same repository): the launch rules apply there too.

## Children record

One JSON file, written whole by the master on every change. Proposal for an entry:

```json
{
  "name": "t42-product",
  "repo": "/abs/path/product",
  "task": "T-42",
  "scope": { "writeRoot": "/abs/path/product", "external": ["/abs/path/design/docs/x.md"] },
  "model": "sonnet",
  "effort": "medium",
  "status": "running",
  "started": "2026-11-20T10:00:00Z",
  "lastMessage": { "type": "pr", "at": "2026-11-20T11:30:00Z", "text": "https://…" },
  "requests": []
}
```

- `status` is one of `running`, `waiting-user`, `done`, `abandoned`, `lost`.
- The master reconciles the record with the live session list at the start of `spawn` and `dispatch`: a child in
  the record that no longer exists becomes `lost`.
- The record replaces the old rule "Nothing is tracked". It holds no project content beyond names and URLs, so
  that it can sit outside the hub.
- A project may also want notes in its own tracker or backlog; that stays a project rule, outside the plugin.
- `scripts/registry.mjs` is the only writer. Each command takes only its own options: an unknown or repeated option,
  or `--live` with `--live-none`, exits 1 and writes nothing. `status` takes `--reason` (why a child was abandoned),
  kept on the entry until the next status.
- The record never lands inside the hub: every path is judged where it really lands (the deepest existing part
  resolved, the rest as written) before a folder is made, the default path included; a write with `--file` needs
  `--hub`; a relative `CLAUDE_CONFIG_DIR` is refused and a leading `~` expanded.
- An `upsert` that starts a child again under the name of one that ended (`done`, `abandoned`, `lost`) makes a fresh
  entry; `spawn` does not reuse a name the record holds anyway.
- Writes take a lock next to the file. A lock older than 30 s, or whose writer has ended, is taken over by moving it
  aside atomically and removing it only if it is the lock examined, so two writers cannot remove each other's lock.
- In tmux, a child's pane is tagged with the pane option `@session_hub_child`, which Claude Code cannot overwrite as
  it does the pane title; the live names come from `list-panes -F '#{pane_dead} #{@session_hub_child}'`.
- `master` holds the master's identity as given to the children (`name`, `ref`, `sessionId`, `updatedAt`), written
  by `registry.mjs master` at every start of children.
- The outbox, `<record without .json>.outbox/`, holds one JSON file per message a child could not deliver (`at`,
  `from.sessionId`, `to`, `reason`, `text`, cut at 64 KiB). It is the one place a child writes, through its mod
  (`$.fs.write`), never by a tool call. `registry.mjs outbox` lists the messages and removes, by file name, those the
  master has handled. Unlike the record, it holds what the children wrote, so the master removes each message once
  handled.

## Hook `session-hub-scope-guard`

A PreToolUse hook on the file-writing tools (`Edit`, `Write`, `NotebookEdit`).

- Active only when the role variable says `child`.
- Resolves the target path and blocks it when it is not under the write root. Compare real paths, so that a
  symbolic link cannot step outside.
- Blocks a write to an existing file with more than one hard link. A hard link has no real path that leads
  elsewhere, so the guard cannot tell whether another name of the file is outside the write root, and a write
  changes the file under every name.
- Blocks a write to the repository's Claude Code settings, `<root>/.claude/settings*.json` (case ignored), as written
  or where it lands. Their `env` and hook settings override the launch environment at the child's next start:
  `"env": { "SESSION_HUB_GUARDS": "off" }` or `"disableAllHooks": true` there turns the guards off (verified live,
  issue #56). The settings of a repository are the master's: the block message sends the change to the master as an
  `out-of-scope` request. The shell check blocks the same files (`isRootSettings` in `write-root.mjs`).
- The write root must be absolute, an existing folder, and neither `/` nor the home folder. The rules live in
  `hooks/mod/write-root.mjs`, shared with the mod's shell check so that the two accept the same roots.
- The block message tells the model what to do: send an `out-of-scope` message to the master and tell the user.
- Shell commands that write files are **not** covered by the hook. From 0.2 the mod adds a best-effort shell
  check (S10 showed it is needed); the README labels it as best effort.
- On any internal error the hook blocks and says why. A guard that cannot evaluate must not let the call pass.

The hook is a plugin hook: it loads in every session where the plugin is enabled and relies on the role variable
to stay inactive elsewhere. The variables reach it in the terminal, tmux and Herdr environments (`spikes.md`, S4).

## Mod `session-hub`

Second release. Read `research/mods-capabilities.md` before designing it. Built and checked against the spike
results for 0.2 (`spikes.md`); the pure logic lives in `hooks/mod/*.mjs`, the engine glue in
`hooks/session-hub-mod.tsx`, in the same `hooks.json` as the classic hook.

| Function | Event | Behaviour |
|---|---|---|
| Send guard | `session.send` | In a child, a send is delivered only to the master and to the session's own subagents and teammates (and a subagent's `main`). The master is the recipient written as its name when the child started (with or without ` [<ref>]`), as its ref alone or after any name, or as its current name: the live session in `ListAgents` that holds its ref. A message for the master goes by its session id (`$.session.send({ to: { sessionId } })`, S21), then to its current name, else to its first name; a ref alone never picks the session, since it may be stale or another session's. A message neither route delivers is saved in the outbox and the answer says where (*The master's identity*). Any other recipient, a socket or bridge address included, is not delivered; the reason names the master (with its current name after a rename) and the `out-of-scope` route. |
| Shell check | `tool.call` on `Bash` and `Monitor` | Added after S10. In a child, a best-effort check of every command run in the session's shell (the `command` of `Bash` and of `Monitor`; a `Monitor` socket has none). The command is read as bash or zsh would read it: the `Bash` tool runs zsh on macOS. It reads redirections (`<>` and zsh's `>!`, `>>!`, `>>\|`, `&>!` and `&>>!` included) and the targets of common file-writing commands (`tee`, `touch`, `mkdir`, `rm`, `rmdir`, `truncate`, `unlink`, `cp`, `mv`, `ln`, `install`, `sed -i`, `find`), found behind assignments, wrappers (`sudo`, `env`, `nice`, `timeout`, `xargs`, `command`, `nohup`, `time`, `builtin`, `exec`, `coproc`, and zsh's `noglob`, `nocorrect`, `-`, `repeat N` and `=command`) and reserved words (`if`, `then`, `elif`, `else`, `while`, `until`, `do`, `!`, `{`, function bodies). Options are read as the commands read them: bundled short options (`cp -rt DIR`), `--target-directory DIR` with or without `=`, and every form of a `sed` script (`-e`, `-f`, `--expression`, `--file`), so the files of `sed -i` are judged. `find` is read like a wrapper and a writer: the command between `-exec`, `-execdir`, `-ok` or `-okdir` and its `;` (or `{} +`) is judged as a command, with `{}` standing for the starting points, since every file `find` hands it is under one of them; with `-execdir` it runs in each file's folder, which is not known, so only its absolute targets and its `{}` are judged. The file of `-fprint`, `-fprint0`, `-fprintf` and `-fls` is a write target, and with `-delete` the starting points (`.` when none is given) are targets, as for `rm`. The commands inside substitutions are judged, each as a subshell: `$(…)`, backticks, `<(…)` and `>(…)`, also inside double quotes, `${…}` and arithmetic, and in the body of a here-document whose delimiter is not quoted (with `<<'EOF'`, `<<"EOF"` or `<<\EOF` the body is data). The literal line given to `eval` is judged as part of the command, the one given to `sh`, `bash`, `zsh`, `dash` or `ksh -c` as a new shell, and the string of `env -S` as words of the command. `$'…'` is read with its escapes; `<<` inside arithmetic (`$((…))`, `((…))` wherever a command may start, `$[…]`) and in an array subscript (`a[1<<2]=3`) is a shift. zsh's `>&|`, `>&!`, `>>&|` and `>>&!` are redirections; `chdir` is a change of folder; a `}` ends a command (`{ … } always { … }`). A target with braces is judged in every word its brace expansion gives (at most 256), and zsh's `=name` as a target is refused, since it names a command's file. A change of folder in the last part of a pipeline may hold after it, since zsh runs that part in the shell. Options that take a value with GNU but not on macOS (`cp -S`, `sed -l`) are read as taking none, so no word is hidden. A command that would cost too much to follow (more than 64 possible folders) is denied. A command the lexer cannot read as the shell would (an unbalanced quote, `$(`, `${` or backtick, a here-document whose delimiter never comes, an arithmetic expansion without its `))`) is denied with the reason. A target outside the write root is denied, and so is a write to the repository's settings, `<root>/.claude/settings*.json`, as for the hook. `/dev` and the system temporary folders are allowed. `ln` and `cp -l` are also judged on their source: a hard link to a file outside the write root is denied, since nothing can tell later that the link leads out. A symbolic link made by `ln -s` or `cp -s` is not judged on where it points, but a write in the same command that goes through it is judged where the link points (from the link's folder, or the working folder with `ln -r`); a write through such a link whose target cannot be known is denied. The write root follows the scope guard's rules (`write-root.mjs`): absolute, an existing folder, neither `/` nor the home folder. `..` is resolved as the kernel does, from where the part before it really lands (links followed), so `link/../x` is judged where it lands and `../sibling` inside the root still works. A target it cannot resolve (`~` with no `HOME`, `~user`) is denied. The working folder is followed through `cd` and `pushd` when the target is a literal folder (absolute, `~` or `~/…` with `HOME` known, or relative to a known folder; `..` removed logically unless `-P`): the new folder holds for the rest of the list, but not outside a subshell `( … )`, a pipeline or a background job, and a `cd` that may fail (any but `cd X && …`) leaves both folders possible from the next `;`, `||` or newline, so later relative targets are judged against each. This catches `cd <root> && echo x >> link/f` where `link` leads out of the root. A denial says `writes <path> (resolves to <real path>), outside the write root <root>`, the second part only when a link moves the path. Targets it cannot know without the shell (variables, the output of substitutions, globs, relative paths after a `cd` to such a target, `cd -`, `popd`, or after a wrapper's change of folder such as `env -C`, a line given to `eval` or `sh -c` that is not literal) are not judged; nor is `CDPATH`. Other tools with a `command` input are not judged: nothing says that their command is shell code. |
| Origin marking | `session.receive`, `prompt.submit` | In a child, a delivery from another session gets a line in front of its text: information, not authorization. A prompt whose origin is not the person's or the session's own gets the same line as context, once. Every kind but `composer`, `bridge`, `sdk`, `auto-continuation`, `plugin`, `task-notification` and `scheduled-trigger` counts as another session, unknown kinds included. A `coordinator` delivery at `session.receive` without a `teammate` is the child's own main conversation writing to one of its agents, and is not marked; with a `teammate` (an agent team's lead), and at `prompt.submit` (another session's hand-off), it is. The first prompt is not special: it arrives as `composer` (S9). |
| Scope line | `prompt.compose`, `prompt.submit` | A session-scoped section with the role and the scope (child), or the role and the record (master). Because an organization's managed mod can skip a user mod's `prompt.compose`, `session.compact` and `classic.SessionStart` hooks (seen live), the same text also rides the first prompt after the start and after a compaction as context. A compaction is seen through those events where they run, and otherwise as a context size that is unknown or smaller than at the previous prompt. |
| Rename notice | `$.clock.every`, `command.run` | In the master, at each refresh of the panel: when the name in the `ListAgents` header is not the record's `master` name while children are `running` or `waiting-user`, one transcript notice per new name, saying whether the children still reach it (the record's session id is this session's) or giving the way back (`/rename <old name>`, or replacing the children). |
| Children panel | `ui.render` (`Pane`) | In the master: one row per child from the record (status, live status, model and effort, last message), refreshed on `/session-hub` and every 30 s. Its note says how many messages wait in the outbox. Live status comes from the `ListAgents` tool called by the mod (S8). The record is read through `scripts/registry.mjs read`; the mod never writes it. Drawn with the look shared with `model-router` (*A shared look* in `shared-contract.md`): the model name bold in its tier's colour; the effort as the four-cell bar and the word in its level's colour (an unknown effort: four empty cells, the word dim); the record status and the live status in the theme's `success` (`running`, `working`), `warning` (`waiting-user`, `abandoned`, `not listed`) or `error` (`lost`), others plain and `?` dim; the header and the notes dim. `hooks/mod/panel.mjs` gives each row as coloured segments; the column widths and the cut to the pane width are the same for the text and the drawing. Under the rows, the action that opens the children record, session-hub's log: a key hint in the terminal (`l`), which opens the file (`hooks/children-pane.tsx`). The panel is a terminal's: on the desktop app `/session-hub` opens no pane and the children are the card's Children view (*The card on the desktop app*), which follows the same 30-second refresh. |
| Start line | `tool.call` and `ui.render` (`ToolUse`) on `Bash`; `tool.call` on the desktop app's session tool | In a session that is not a child: under the row of a `Bash` call that starts children, one line per child, `⎿  🔀 opus   ▰▰▰▱ high   -> <child name>`, drawn like `model-router`'s line (`hooks/mod/start-line.mjs`). On the desktop app (and any graphical surface) the line under a `Bash` row is one quiet footnote in words, `Started <child> on Opus · high`, without the shared look. For the desktop app's session-starting tool (`mcp__<server>__start_session`, today `mcp__ccd_session__start_session`) nothing is written while the app shows the session: the app draws that call as a session card of its own, and neither a line under it nor a placed row shows there (spike S18 in `spikes.md`). A terminal attached to such a session gets a notice in the transcript instead, `$.ui.log('🔀 sonnet · medium → <child name>')`, one per child, written after `next(e)` when the call was neither denied nor answered as an error: the app draws that call as a session card of its own, not as a tool row, so a line under the row was never shown (seen on the app; 0.4.1 drew it there). The row of that tool is not decorated any more, so a host that does draw it shows the line once. A notice is dim and unstyled (`$.ui.log` takes text and a sink, `transcript` or `debug`, nothing else) and is drawn in the app's proportional font, so it is words only, with no bar of characters; an effort not stated reads `default effort`. A child start is a `claude` command after `SESSION_HUB_ROLE=child` (plain, after `env`, or quoted in `tmux send-keys … -l "…"`), or `herdr agent start <name> … -- <flags>`; the model and the effort come from `--model` and `--effort`, the name from `-n` or `--name` (else Herdr's agent name, else `child`). For the desktop app's tool, the model and the effort come from its input's `model` and `effort`, the name from `name`, else `title`. A command or a call that states neither model nor effort gets no line. The line of a `Bash` call is kept by the call's `tool_use_id` at `tool.call`, after the call has run; the row is always drawn (`await next(e)`), alone when there is no line or on any error. |
| Command | `$.command.register` | `/session-hub [log \| help]`: the session's role and scope; in a master, the children table (sized to `presentation.columns`, at least 60; the panel's columns, the effort as the bar and the word, `▰▰▰▱ high`, with no colour since the answer is text) and the panel. `log` (or `record`) opens the children record as the file. On the desktop app the command answers the Session hub card instead (*The card on the desktop app*): `log` opens it on Record. `help`, and any other argument, print what the command does. Every answer carries `isTextDisplayOnly`: the model does not need it, since it has the scope in its scope line and reads the children from the record, and a copy in the transcript would go stale in later requests. A failing hook answers one line. From 0.2.1. A tabbed dialog like `/model-router`'s was considered and left out: the children panel is a side pane that stays open beside the chat and refreshes itself, not a dialog the person reads and closes. Registered last at `session.start`, inside a `try`: a name clash with another mod throws (S6) and costs only the command. |

Opening the children record (`hooks/mod/open-record.mjs`): what the panel's key and `/session-hub log` do in a
terminal and in a headless run. The record
is the one the session reads: a child's `SESSION_HUB_REGISTRY`, a master's own `--file`, else the default path of
the hub, asked of `scripts/registry.mjs path`. The API has no call that opens a file, so the mod runs the system's
opener with `$.process.run`, the path as one argument and no shell: `open <record>` on macOS, `xdg-open <record>` on
Linux, by `$.session.info().platform`. The line the person reads is written in the
session (`[session-hub] Children record opened: <path>`), or is the command's answer. With no record yet the line
says so and nothing runs; on a hosted session, a platform with no known opener or a path that is not absolute it
gives the path and the reason; a failed or slow opener (10 seconds) gives `Could not open <path>: <reason>`. The
action never throws, never writes the record and never changes the panel.

**The card on the desktop app.** On the desktop app, and on any surface but the terminal, `/session-hub` is one
card in the transcript, "Session hub", in the grammar of `ui-design.md` (*Graphical surfaces: the card*); no pane is
opened and no file. `command.run` answers the card as Markdown, its last line the stamp `Read <time> UTC · card
<n>.`; a `ui.render` hook on the command's `CommandOutput` row draws the card (`hooks/hub-card.tsx`, from
`hubCardOf` of `hooks/mod/hub-card.mjs`, laid out by `hooks/card-kit.tsx`, a copy shared with `model-router`).

- **Header.** The hub icon, "Session hub" (the press that collapses the card), the role and the counts at the right
  (`master · 3 children, 2 live`, `child of hub`, `no role`). Collapsed: the header and one bar of the children by
  status.
- **Children** (`/session-hub`): a grid of the role, the hub, the repositories and the record by base name (in a
  child: the master, the write root and the handoff by base name, the guards); a group per status (Running, Waiting
  for you, Done, Abandoned, Lost), the first open, the others opening on their name, one at a time. A child is a row:
  a status dot, its name, its model and effort in words (`Sonnet · medium`), and a muted line with what the live
  session list says and its last message, or the reason of its status. At most 12 in a group, then `n more in the
  record`. Then when the live status was read, and the record linked in the last line.
- **Record** (`/session-hub log`): a grid of children, events, first start and requests; the timeline, the latest 7
  (when, child, kind, text; an outcome after a colon, no arrows); a child dropdown at the right that narrows the
  timeline to one child; the record linked in the last line.
- **Live.** The newest card follows its data: the 30-second refresh reads the record again (and the panel's live
  status in a master), and the write redraws it. The five cards before it keep their header and bar, drawn static;
  older ones are their text.
- **Reads.** The record is read through `scripts/registry.mjs read --file <path>`, the path found as for opening the
  file, and kept in `$.state` (`log`); the mod never writes it. A record that cannot be read is one line on the card.
- **Bounds.** A card draws one view and its rows are capped, so a record of any size stays small; it still goes
  through `firstThatFits` of `hooks/mod/tree-bounds.mjs`, and past it the row keeps its text.

Which host it is comes from `hostKind` (`hooks/mod/host.mjs`, the rule of `model-router`'s `lib/open-report.mjs`,
copied because a plugin uses nothing outside its folder): a terminal when one is attached, a graphical host when
only graphical surfaces are, or when none is yet and `CLAUDE_CODE_ENTRYPOINT` names an app (`claude-desktop`;
anything but unset, `cli` and `sdk…`).

How the mod knows the master: a session with no role becomes a master when it runs `session-hub:spawn` or
`session-hub:dispatch` (`skill.prompt`), when it runs the registry script (the `--file` or `--hub` of that call
gives the record), or, at start and on `/session-hub`, when the record for its folder already lists children.
`$.state` does not survive a restart (S7), so this is recomputed after a resume.

Constraints:

- Every guard fails closed: a send guard or shell check that throws refuses with a reason (`.catch` on both
  hooks). An unknown `SESSION_HUB_ROLE` blocks sends to anyone and shell writes with a target; a child with no
  `SESSION_HUB_MASTER` cannot send to any session.
- The shell check fails closed on any file-system error but a missing path: a `stat` that fails for another reason,
  or a folder that cannot be listed, denies the call.
- A session whose role cannot be read (the environment lookup itself fails) is refused by the send guard and the
  shell check even when it is not a child: an unreadable environment cannot be told apart from a child's, so the
  guards fail closed. A session with no `SESSION_HUB_*` variables, read without error, is never blocked.
- `SESSION_HUB_GUARDS=off` turns off the send guard and the shell check; the marking and the scope line stay,
  since they only inform.
- The marking, the scope line and the panel never block anything. A failed marking leaves the delivery unmarked;
  the handoff rule still holds.
- The origin of the *first* prompt of a child is not trustworthy when the launcher typed it into a pane; the
  guards do not depend on it.
- The mod does not replace the classic hook. The hook covers file writes and works where mods are off; with mods
  off, release 0.1 behaviour is unchanged.
- A child resumed without its `SESSION_HUB_*` variables is no longer a child, for the hook and the mod alike.

## Releases

| Release | Content |
|---|---|
| 0.1 | `spawn`, `dispatch`, `setup`, the scope guard hook, the children record. Scope and the master-only rule are enforced by the hook and by prose. |
| 0.2 | The mod: send guard, shell check, origin marking, scope line, panel, command. |
| 0.2.1 | `/session-hub help`; command answers for the person only; the children table sized to the terminal. |
| 0.2.3 | The shell check follows `cd` and `pushd` to a literal folder; a denial names where a linked path lands. |
| 0.2.5 | The shell check reads zsh forms, substitutions in every quoting, `eval` and `sh -c`, arithmetic and `$'…'`; it judges hard-link sources and links made in the same command, and refuses the roots the scope guard refuses. The scope guard blocks a write to a hard-linked file. |
| 0.3.0 | The look shared with `model-router`: the children panel in colour, the bar in the `/session-hub` table, the start line under a child launch. Its colours are a copy in `hooks/mod/look.mjs`, checked against `model-router`'s by `tests/validate.sh`. |
| 0.3.1 | The shell check reads `find`: the command of `-exec`, `-execdir`, `-ok` and `-okdir`, the file of `-fprint` and the like, and the starting points of `-delete`. |
| 0.3.2 | A child may not write the repository's `.claude/settings*.json`. The children record never lands inside the hub, the registry script refuses options a command does not take and takes a stale lock over atomically, and a finished child's name gets a fresh entry. tmux children get their command as arguments and are named by the pane option `@session_hub_child`. |
| 0.4.2 | The children panel and `/session-hub log` open the children record in the system's default app. |
| 0.4.3 | On graphical surfaces the children record opens as the log pane, a dashboard of the children and a timeline of their requests. |
| 0.4.4 | The log pane and the children panel measure their trees against the engine's bounds and draw a large record in brief. The start line of a desktop session start is a transcript notice. |
| 0.5.0 | On the desktop app `/session-hub` is one card in the transcript, with the views Children and Record; the log pane is gone. No start line or notice for the app's session tool while the app shows the session. |
| 0.6.0 | The master's identity: a child is pinned to its master's session id and ref, so a rename does not cut it off; a message the master cannot receive goes to the outbox; the master is told when it was renamed while children run. The first prompt names the work and rides the start command in every environment, Herdr included (#20). |
| 0.4.0 | Launch identity: `scripts/launch.mjs` reads how the master was started, the keys `Permissions` and `Carry`, the identity check after a start and the child's own notice. |

## Open points

- The manual environment (print the commands, start nothing) is kept in 0.1.
