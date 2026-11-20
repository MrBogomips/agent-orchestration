# Shared contract between `session-hub` and `model-router`

The two plugins are built in parallel. This file is what each side may assume about the other. Change it first,
then the plugins.

## Independence

- Each plugin works without the other.
- `session-hub` never requires `model-router`. `model-router` knows nothing about hubs.
- Skills hand off to each other by full name, `<plugin>:<skill>`, and detect at run time whether the other plugin
  is installed.

## The grid has one home

The model and effort grid lives in `model-router:choose-model`.

`session-hub:spawn` chooses a child's model and effort like this:

1. What the user said in the conversation.
2. The `Model` and `Effort` keys of the hub's *Child sessions* section.
3. If `model-router` is installed: load `model-router:choose-model` and apply the grid to the child's handoff.
4. Otherwise: inherit the master's model and effort, and say so in the start report.

`session-hub` holds no copy of the grid. Step 4 is deliberately plain.

## Launching a child with a model and an effort

| Value | Mechanism | Status |
|---|---|---|
| Model | `--model <alias>` on the launch command, replacing the value carried over from the master's own launch | works in pane and background environments; desktop app **unverified** |
| Effort | `--effort <level>` on the launch command (listed by `claude --help` on 2.1.329); else `CLAUDE_CODE_EFFORT_LEVEL` or `--settings '{"effortLevel":"<level>"}'` | flag exists; behaviour per environment **unverified** (`spikes.md`, S1) |

The handoff's *Session* part also states the model and the effort with the reason. That line is information for
the user and for the child; nothing parses it in release 0.1.

If neither effort mechanism works, the fallback is a mod in the child that reapplies the effort on each step.
That would move a piece of `model-router` 0.2 forward; decide after S1.

## Environment variables for a child

Set by `session-hub:spawn` on the launch command. A mod can read an environment variable only by a literal name,
so these names are fixed.

| Variable | Value |
|---|---|
| `SESSION_HUB_ROLE` | `child` |
| `SESSION_HUB_MASTER` | the master's session name |
| `SESSION_HUB_SCOPE_ROOT` | absolute path of the write root |
| `SESSION_HUB_HANDOFF` | absolute path of the handoff file |
| `SESSION_HUB_REGISTRY` | absolute path of the children record (read-only for a child) |

Whether these reach the child in each environment is **unverified** (S4). The desktop app starts sessions
through a tool that takes no environment; there the role may have to come from the handoff file.

## Naming

- One mod per plugin, named like the plugin.
- Commands: `/session-hub`, `/model-router`.
- Hooks, log lines, block messages, state files and environment variables start with the plugin's name:
  `session-hub-scope-guard`, `[session-hub] …`, `SESSION_HUB_*`, `~/.claude/model-router/`.
- Plugin names do not start with `claude-` or `anthropic-` (marketplace rule).

## State on disk

| Path | Owner | Content |
|---|---|---|
| `<config dir>/session-hub/children-<hub id>.json` | `session-hub` (master writes) | the children record, unless the `Registry` key says otherwise |
| `<config dir>/model-router/decisions.jsonl` | `model-router` | the decision log |
| `<config dir>/model-router/events.jsonl`, `quality/` | `model-router` | the quality loop's event log and aggregates (`model-router-quality-loop.md`) |

`<config dir>` is the active Claude Code config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`). Never write state
inside a hub or a repository.

## Versions

- Each plugin folder has its own `plugin.json` and its own version.
- Minimum Claude Code version for the mods: declare it in `engines["claude-code"]`. Mods exist from 2.1.287; the
  research was done on 2.1.329.
- The skills and the classic hook must work with the mods off.
