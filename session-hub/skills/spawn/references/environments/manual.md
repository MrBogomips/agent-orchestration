# Manual

When no environment can start a child, or a start failed. Write the handoff files, record each child with
status `running`, then give the user, per child, one block to run in a new terminal:

```bash
cd <dir>
env <identity variables> SESSION_HUB_ROLE=child SESSION_HUB_MASTER=<master> SESSION_HUB_SCOPE_ROOT=<root> SESSION_HUB_HANDOFF=<file> SESSION_HUB_REGISTRY=<record> SESSION_HUB_GUARDS=<on|off> claude <carried flags> <child flags> "Read and follow <file>"
```

- `<identity variables>` are `HOME=…` and `CLAUDE_CONFIG_DIR=…` when *Launch command* in
  [environments.md](../environments.md) found them; they keep the messaging channel to the master.
- Say that the scope guard is active only if the command is run as given, with the `SESSION_HUB_*` variables.
- The children record says `running` for a child the user may never start; the next reconcile marks it `lost`.
