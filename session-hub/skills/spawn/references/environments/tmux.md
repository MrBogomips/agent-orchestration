# tmux

Requires `TMUX` to be set (the master runs inside tmux). Read the pane ID from the output; never derive it.

Make the child's pane with the layout from [hub-config.md](../hub-config.md); each command prints the pane ID,
such as `%12`:

```bash
# tabs: a window per child
tmux new-window -d -c <dir> -n <name> -P -F '#{pane_id}'
# panes: the first child to the right of the master's pane
tmux split-window -h -d -t "$TMUX_PANE" -c <dir> -P -F '#{pane_id}'
# panes: child k of n (k >= 2) below the last child's pane, sized so the stack has equal heights
tmux split-window -v -d -t <last-child-pane-id> -l "$(( 100 * (n - k + 1) / (n - k + 2) ))%" -c <dir> -P -F '#{pane_id}'
```

Then label the pane and type the start command into it:

```bash
tmux select-pane -t <pane-id> -T <name>
tmux send-keys -t <pane-id> -l "env <identity variables> SESSION_HUB_ROLE=child SESSION_HUB_MASTER=<master> SESSION_HUB_SCOPE_ROOT=<root> SESSION_HUB_HANDOFF=<file> SESSION_HUB_REGISTRY=<record> SESSION_HUB_GUARDS=<on|off> claude <carried flags> <child flags> -- 'Read and follow <file>'"
tmux send-keys -t <pane-id> Enter
```

- The variables go in an `env` prefix, so they reach the child and not the pane's shell. `<identity variables>`
  are `HOME=…` and `CLAUDE_CONFIG_DIR=…` when *Launch command* in [environments.md](../environments.md) found
  them; write no brackets.
- `<carried flags>` and `<child flags>` are steps 2 and 4 of *Launch command*.
- `-d` keeps the user's focus where it is. The pane starts with a shell, so it stays open when the child exits.
- The pane title (`select-pane -T`) names the child in `tmux list-panes -a -F '#{pane_title}'`, for the
  duplicates check.
- **Worktree:** see *Worktrees* in [hub-config.md](../hub-config.md); for a sibling worktree, `<dir>` is that
  worktree.
- With `tabs`, when the user wants to watch a child: `tmux select-window -t <pane-id>`.
- Never kill windows or panes you did not create, and kill yours only when the user asks.

**Channel.** `SendMessage` in both directions: child to the master's name, master to `<name>`. To hear when a
child finishes its turn, the master sends `SendMessage` with `notify_when_idle` once. Never poll. The user types
in the child's pane, or switches to its window (`prefix` then `w` lists them).
