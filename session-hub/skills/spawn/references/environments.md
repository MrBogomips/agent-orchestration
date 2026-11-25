# Environments

How to start a child, give it its role and scope, and talk to it in each environment. `<repo>` is the
repository's absolute path, `<dir>` the child's working directory (the repository, or a worktree the master made
for it), `<name>` the child's name, `<file>` its handoff file.

Read this file, then only the file of the environment chosen in step 5:

| Environment | File |
|---|---|
| Claude desktop app | [environments/desktop-app.md](environments/desktop-app.md) |
| Herdr | [environments/herdr.md](environments/herdr.md) |
| tmux | [environments/tmux.md](environments/tmux.md) |
| Terminal | [environments/terminal.md](environments/terminal.md) |
| Manual | [environments/manual.md](environments/manual.md) |

**Handoff files.** Herdr, tmux, the terminal and the manual case pass the handoff as a file, because a long
prompt on a command line breaks quoting and, on macOS, the terminal's line limit. Write it in the harness's
scratchpad directory if it has one, otherwise in a new `mktemp -d` directory, as `<name>-handoff.md`. Never
inside the hub or a repository. The child's `SESSION_HUB_HANDOFF` names it, and session-hub's `SessionStart`
hook adds its text to the child's context at the start and again after `/clear` or a compaction. So the child
needs no access to the file's folder: never give it `--add-dir <handoff-dir>`, whose trust dialog would stop every
child at every start. Keep the handoff under 9,000 characters (`wc -c`): past that the hook adds the first
part and tells the child from which line to read the rest.

**First prompt.** The prompt on the start command tells the person watching the child's window what it is doing,
and points to the handoff. One line, in the conversation's language, with the title and the *Goal* of the handoff:

```
<title of the handoff>. <one sentence on what the child is doing> <handoff>Follow your handoff, which session-hub adds to your context; if it is not there, read and follow <file></handoff>
```

One line, because Herdr refuses a prompt with line breaks. The
`<handoff>` tag keeps the instruction recognisable; the path in it is free of spaces, and it is there for a child
whose hook did not run. Build the prompt in the same Bash call as the start, in a quoted heredoc, so that the
shell reads no character of the title, and pass it as one argument, `"$P"`:

```bash
P=$(cat <<'EOF'
T-42: CSV export endpoint (product). Add GET /export with its tests, and open a PR on develop. <handoff>Follow your handoff, which session-hub adds to your context; if it is not there, read and follow /tmp/scratch/t42-product-handoff.md</handoff>
EOF
)
```

The prompt always goes on the start command, after `--`, never in a second step: Claude Code runs it once the
first-run prompts (folder trust, the bypass warning) are answered, so a child is never left idle with no task.

## Launch command

A child starts as the master was started, so it gets the same account, the same configuration directory
(without which the two sessions can't message each other), the same settings and the same permission mode. Users
often start Claude through an alias or a wrapper that picks a profile or adds flags; its effect is visible from
inside the session, and that is what the child replicates. A pane or a window of a multiplexer is a new shell: it
has nothing of the master's environment unless the command puts it there.

This holds for **every session a master starts**, also outside a hub (a second session in a worktree of the same
repository): never start one with a bare `claude` or a bare `herdr agent start`.

1. **Read the launch**, in your own shell, before each batch of starts:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs"                       # add --carry <NAME,NAME> for the *Carry* key
   ```

   It walks up to this session's `claude` process and prints JSON: `env`, `flags`, `model`, `effort`,
   `permission` (`bypass`, `flags`), `master` (`sessionId`, for the role variables) and `unsure`. Each line of `unsure` is something it could not read for certain
   (a value with spaces, a flag it does not know, no `claude` process found): ask the user about it before
   starting anything. If the script fails, ask the user for the command that started this session; never guess.
2. **Flags to carry** are `flags`, as they are: those that configure the session (`--settings`, `--mcp-config`,
   `--strict-mcp-config`, `--plugin-dir`, `--setting-sources`, `--agent`, `--append-system-prompt`). The script
   already leaves out the ones that belong to the master's own session (`-n`/`--name`, `-r`/`--resume`,
   `-c`/`--continue`, `--session-id`, `--fork-session`, `-p`/`--print`, `--bg`, `-w`/`--worktree`, `--add-dir`, a
   prompt). `model` and `effort` are for step 9 of the skill and are not carried: the child gets its own.
   `permission` is for *Permission mode* in [hub-config.md](hub-config.md). Inline JSON in `--settings` or
   `--mcp-config` is not carried, because it may hold credentials, and words after a prompt are not read as
   flags: both come back under `unsure`.
3. **Identity variables** are `env`, all of them: `CLAUDE_CONFIG_DIR`, a wrapper's profile (`SHALLOW_PROFILE`),
   the `XDG_*_HOME` folders, and `HOME` when it is not the account's own home. The hub's *Carry* key names more
   variables; the script refuses a name that looks like a credential. Never dump or copy the environment: it
   holds tokens, which would end up on command lines and in pane scrollback.
4. **Child flags**, after the carried ones: `-n <name>`, `--model <model>` and `--effort <level>` when step 9
   chose them (`low`, `medium`, `high`, `xhigh`, `max`), the permission flags from *Permission mode* in
   [hub-config.md](hub-config.md). No `--add-dir` (*Handoff files* above). Leave out `--model` or `--effort`
   only when the child inherits and the master set none. The first prompt goes after `--`, so that no flag takes
   it as a value: `… --permission-mode <mode> -- "$P"`. Nothing on the command may need an answer from the user
   at the start: the only dialogs a child may show are its repository's first-run ones (*First run in a
   repository* below). A flag that opens a dialog of its own is a mistake in the command.
5. **Role variables** (`SESSION_HUB_*`, below). Each environment's file says where they go, with the identity
   variables.
6. **Check the identity** after the start, where `SendMessage` is the channel (Herdr, tmux, terminal):
   `ListAgents` lists a child by its name only when it runs under the master's configuration folder. A child that
   started and is not listed runs under another identity: don't send it work, tell the user, and record it as
   `abandoned` with that reason. With mods on, such a child says so itself, in its first lines and in
   `/session-hub`.

## Role variables

| Variable | Value |
|---|---|
| `SESSION_HUB_ROLE` | `child` |
| `SESSION_HUB_MASTER` | the master's session name: `<name>` in `This session is <name> [<ref>]` from `ListAgents` |
| `SESSION_HUB_MASTER_REF` | the master's ref: `<ref>` in the same line |
| `SESSION_HUB_MASTER_SESSION_ID` | `master.sessionId` as `scripts/launch.mjs` prints it; left out when it is `null` |
| `SESSION_HUB_SCOPE_ROOT` | the write root, absolute; it must exist when the child starts |
| `SESSION_HUB_HANDOFF` | the handoff file, absolute; the `SessionStart` hook adds its text to the child's context |
| `SESSION_HUB_REGISTRY` | the children record, absolute (the child only reads it) |
| `SESSION_HUB_GUARDS` | `on`, or `off` when the hub's *Guards* key says so |

The master's name can change while its children run: `/rename`, a title hook that renames the session after a
reply, Remote Control. With mods on, the child's send guard finds the master by its session id and its ref, so the
child keeps reaching it under the name it was given, and the master's own mod notices the rename. Without the
session id (`null`, or a child started before session-hub 0.6), a rename cuts the child off until the master
takes its old name back: say so in the report.

The names are fixed by the plugins' shared contract. The values must be free of spaces and quotes: names,
paths and the handoff file are chosen so. If the hub path itself has a space, quote each value as the shell
needs (`'SESSION_HUB_SCOPE_ROOT=/a b/repo'`) and check the command once before starting.

On Windows, give the paths as Windows paths with forward slashes (`C:/hub/repo`). Git Bash rewrites a value that
looks like a POSIX path (`/hub/repo`) before the child sees it, and a backslash needs quoting.

With these variables, the `session-hub-scope-guard` hook blocks the child's `Edit`, `Write` and `NotebookEdit`
calls outside the write root. It does not see writes made through the shell. Without them (the desktop app),
the scope holds only by the handoff's prose.

## First run in a repository

A repository where the user has never opened Claude Code may stop the child at a first-run prompt: folder trust,
or the warning shown the first time a session starts in bypass mode. Those prompts are the user's: never answer
them, by keys or otherwise.

- **Trust is not inherited by a nested repository.** A hub the user trusts does not make its child repositories
  trusted: each one needs the prompt accepted once.
- **Desktop app:** the session tool can refuse to set up a worktree in a repository the app has never had a
  session in. Tell the user to open a session in that folder once from the app, and don't retry until they say
  they did. Meanwhile offer another environment if one is available.
- **`claude --bg`:** it refuses with `Workspace not trusted`. The user runs `claude` once in the repository and
  accepts the trust prompt, then you retry; or start the child in Herdr or tmux, where the prompt shows in the
  child's own window.
- **Herdr, tmux, manual:** the trust prompt shows in the child's window. Tell the user which window to answer it
  in. The first prompt is already in the start command and runs after the user's answer. In Herdr, `agent start`
  returns `agent_not_ready` while the dialog is open: that is expected, not a failure. Record the child as
  `waiting-user` with the reason `trust`, and set it back to `running` when `herdr agent get <name>` shows it
  working or its first message arrives.

## Messaging caveats

Say the ones that apply in the report. Change no setting yourself: the choice is the user's.

- Cross-session messaging needs Claude Code 2.1.224 or later on macOS and Linux, 2.1.234 or later on Windows.
- A message is plain text. It cannot approve a permission prompt, change configuration or run a command.
- When the sender and the receiver differ on bypassing permission prompts, the receiver holds a message for the
  user's approval and may let it expire (five minutes by default): the reason children start in the master's
  mode. The `crossSessionInbound` setting (`accept`, `hold`, `refuse`) overrides this; for one background child
  the user can choose `--settings '{"crossSessionInbound":"accept"}'`.
- A send to a desktop app session reports nothing back when the message is held: silence is not an answer.

## Report caveats

- When the `session-hub` mod is loaded (mods on), say in one line that it also guards each child's messages
  (master only) and shell writes, marks messages from other sessions and keeps the scope in the child's context,
  and that `/session-hub` shows the children panel here; with mods off, only the hook guards writes.
