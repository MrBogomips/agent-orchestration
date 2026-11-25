# Manual

When no environment can start a child, or a start failed. Write the handoff files, record each child with
status `running`, then give the user, per child, one block to run in a new terminal:

```bash
cd <dir>
P=$(cat <<'EOF'
<the first prompt>
EOF
)
env <identity variables> SESSION_HUB_ROLE=child SESSION_HUB_MASTER=<master> SESSION_HUB_MASTER_REF=<ref> SESSION_HUB_MASTER_SESSION_ID=<id> SESSION_HUB_SCOPE_ROOT=<root> SESSION_HUB_HANDOFF=<file> SESSION_HUB_REGISTRY=<record> SESSION_HUB_GUARDS=<on|off> claude <carried flags> <child flags> -- "$P"
```

- `<the first prompt>` is the text of *First prompt* in [environments.md](../environments.md), written out.
- `<identity variables>` are every `KEY=VALUE` that *Launch command* in [environments.md](../environments.md)
  found (`HOME`, `CLAUDE_CONFIG_DIR`, a wrapper's profile); they keep the account and the messaging channel to the
  master.
- Say that the scope guard is active only if the command is run as given, with the `SESSION_HUB_*` variables.
- The children record says `running` for a child the user may never start; the next reconcile marks it `lost`.
