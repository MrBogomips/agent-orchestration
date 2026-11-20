# Terminal

```bash
cd <dir> && env SESSION_HUB_ROLE=child SESSION_HUB_MASTER=<master> SESSION_HUB_SCOPE_ROOT=<root> SESSION_HUB_HANDOFF=<file> SESSION_HUB_REGISTRY=<record> SESSION_HUB_GUARDS=<on|off> claude --bg <carried flags> <child flags> -- "Read and follow <file>"
```

- The command prints the child's id. The user opens the child with `claude attach <name or id>` and lists
  background sessions with `claude agents`.
- The identity variables need nothing: the child inherits them from your shell. The role variables go in the
  `env` prefix, so they reach this child only.
- `<carried flags>` and `<child flags>` are steps 2 and 4 of *Launch command* in
  [environments.md](../environments.md).
- **Trust:** `--bg` in a repository nested in the hub fails with `Workspace not trusted` until the user has
  opened that repository once and accepted the prompt, even when the hub is trusted. See *First run in a
  repository*.
- **Worktree:** a background session moves into a worktree under `<repo>/.claude/worktrees/` before its first
  edit, unless the repository sets `worktree.bgIsolation` to `"none"`. That worktree is under the repository, so
  the repository is the write root. For a child that must work in the checkout, add
  `--settings '{"worktree":{"bgIsolation":"none"}}'`. For a sibling worktree, see *Worktrees* in
  [hub-config.md](../hub-config.md).

**Channel.** `SendMessage` in both directions: child to the master's name, master to `<name>`. To hear when a
child finishes its turn, the master sends `SendMessage` with `notify_when_idle: true`. It sends one notice, then
ends: subscribe again after each notice while the child is still `running`. Never poll.
