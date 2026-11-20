# Herdr

Requires `HERDR_ENV=1`. Read IDs from the JSON that each command returns; never derive them.

`<env>` below is one `--env KEY=VALUE` per variable: the identity variables from *Launch command* in
[environments.md](../environments.md), then every role variable (`SESSION_HUB_ROLE`, `SESSION_HUB_MASTER`,
`SESSION_HUB_SCOPE_ROOT`, `SESSION_HUB_HANDOFF`, `SESSION_HUB_REGISTRY`, `SESSION_HUB_GUARDS`). They go on the
pane, because `agent start` runs Claude Code's own executable in it.

Make the child's pane with the layout from [hub-config.md](../hub-config.md):

```bash
# tabs: a tab per child; read the pane ID from .result.root_pane
herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <dir> --label <name> --no-focus <env>
# panes: the first child to the right of the master (--current is the calling pane); read .result.pane
herdr pane split --current --direction right --cwd <dir> --no-focus <env>
# panes: each next child below the last child's pane
herdr pane split <last-child-pane-id> --direction down --cwd <dir> --no-focus <env>
```

Then, in that pane:

```bash
herdr agent start <name> --kind claude --pane <pane-id> -- <carried flags> <child flags>
herdr agent prompt <name> "Read and follow <file>"
```

- `<carried flags>` and `<child flags>` are steps 2 and 4 of *Launch command*: `-n <name>` gives the child the
  same name in `ListAgents`, then `--model`, `--effort`, `--permission-mode`, `--add-dir`.
- `agent start` returns once the agent is ready. If it returns `agent_not_ready`, read the pane with
  `herdr agent read <name>` and ask the user before answering any dialog there.
- Herdr agent names match `[a-z][a-z0-9_-]{0,31}`; the names from [hub-config.md](../hub-config.md) already do.
- **Worktree:** see *Worktrees* in [hub-config.md](../hub-config.md). A worktree under the repository is made by
  the child, as its repository's policy says; a worktree in a sibling folder is made by the master before the
  start, and `<dir>` is that worktree.
- With `panes`, label the pane: `herdr pane rename <pane-id> <name>`.
- With `tabs`, when the user wants to watch a child, bring its tab forward after the prompt:
  `herdr agent focus <name>`.
- Never close tabs or panes you did not create, and close yours only when the user asks.

**Check.** After the start, `herdr agent get <name>` shows the agent; the role variables are not visible from
outside. If the user asks to verify the guard, the child can run `printenv SESSION_HUB_ROLE`.

**Channel.** `SendMessage` in both directions: child to the master's name, master to `<name>`. To hear when a
child finishes its turn, the master sends `SendMessage` with `notify_when_idle: true`. It sends one notice, then
ends: subscribe again after each notice while the child is still `running`. Never poll. The user types
in the child's pane, switches to its tab, or asks the master to bring it forward.
