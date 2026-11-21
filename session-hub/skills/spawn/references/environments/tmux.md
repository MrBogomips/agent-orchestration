# tmux

Requires `TMUX` to be set (the master runs inside tmux). Read the pane ID from the output; never derive it.

Make the child's pane with the layout from [hub-config.md](../hub-config.md) and start the child in it in the same
command. tmux runs the command after `--` as it is, with no shell in between, so the carried flags reach the child
exactly as written in this one Bash call. Each form prints the pane ID, such as `%12`:

```bash
# tabs: a window per child
tmux new-window -d -c <dir> -n <name> -P -F '#{pane_id}' <variables> -- claude <carried flags> <child flags> -- 'Read and follow <file>'
# panes: the first child to the right of the master's pane
tmux split-window -h -d -t "$TMUX_PANE" -c <dir> -P -F '#{pane_id}' <variables> -- claude <carried flags> <child flags> -- 'Read and follow <file>'
# panes: child k of n (k >= 2) below the last child's pane, sized so the stack has equal heights
tmux split-window -v -d -t <last-child-pane-id> -l "$(( 100 * (n - k + 1) / (n - k + 2) ))%" -c <dir> -P -F '#{pane_id}' <variables> -- claude <carried flags> <child flags> -- 'Read and follow <file>'
```

`<variables>` is one `-e KEY=VALUE` per variable: `-e SESSION_HUB_ROLE=child -e SESSION_HUB_MASTER=<master>
-e SESSION_HUB_SCOPE_ROOT=<root> -e SESSION_HUB_HANDOFF=<file> -e SESSION_HUB_REGISTRY=<record>
-e SESSION_HUB_GUARDS=<on|off>`, and first one `-e KEY=VALUE` for every identity variable that *Launch command* in
[environments.md](../environments.md) found (`HOME`, `CLAUDE_CONFIG_DIR`, a wrapper's profile). Write no brackets.
After the start, `ListAgents` must list the child (*Launch command*, step 6).

Then tag the pane with the child's name and keep it open when the child exits:

```bash
tmux set -p -t <pane-id> @session_hub_child <name>
tmux set -p -t <pane-id> remain-on-exit on
```

- The variables go in `-e`, so they reach the child and not a shell of the pane.
- `<carried flags>` and `<child flags>` are steps 2 and 4 of *Launch command*. **Never paste a carried value inside
  a double-quoted string**, as in a `send-keys -l "…"` of the whole command: a value with a double quote (a JSON
  `--settings`), a `$` or a backtick would be cut or expanded on the way. Quote each value once, in this Bash
  call, as you would on a plain command line (`--settings '{"crossSessionInbound":"accept"}'`).
- `-d` keeps the user's focus where it is. `remain-on-exit` keeps the pane, and the child's last screen, after the
  child exits; the user closes it with `prefix` then `x`.
- The pane option `@session_hub_child` names the child for the duplicates check and the live names of a
  reconcile: `tmux list-panes -a -F '#{pane_dead} #{@session_hub_child}'` lists the live children as the lines that
  start with `0` and have a name (a pane kept by `remain-on-exit` after its child ended starts with `1`). Never use the pane title (`select-pane -T`,
  `#{pane_title}`): Claude Code sets the terminal title once it has drawn its interface, and the label is lost.
- **Worktree:** see *Worktrees* in [hub-config.md](../hub-config.md); for a sibling worktree, `<dir>` is that
  worktree.
- With `tabs`, when the user wants to watch a child: `tmux select-window -t <pane-id>`.
- Never kill windows or panes you did not create, and kill yours only when the user asks.

**Channel.** `SendMessage` in both directions: child to the master's name, master to `<name>`. To hear when a
child finishes its turn, the master sends `SendMessage` with `notify_when_idle: true`. It sends one notice, then
ends: subscribe again after each notice while the child is still `running`. Never poll. The user types
in the child's pane, or switches to its window (`prefix` then `w` lists them).
