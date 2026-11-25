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
| Effort | `--effort <level>` on the launch command | verified in `-p`, `--bg`, tmux and Herdr panes (S1); desktop app **unverified** |

The handoff's *Session* part also states the model and the effort with the reason. That line is information for
the user and for the child; nothing parses it in release 0.1.

`--effort` works (S1), so no child-side mod is needed for effort. A classic hook can read the effective effort from
its input (`effort.level`).

## A shared look

The two mods draw a model and an effort the same way, so a person reads them at a glance in either plugin. **The
look below is the terminal's.** On the desktop app and the other graphical surfaces neither plugin uses it: no
tier or effort colours, no effort bar, no `🔀` and no teal accent; a model and an effort are words (`Opus · high`)
and the card follows the app's own colours (*A shared card* below, and `ui-design.md`, *Graphical surfaces: the
card*). The values are `model-router`'s (`lib/route-line.mjs`). A plugin uses nothing outside its folder, so `session-hub`
holds its own copy; `tests/validate.sh` fails when the two copies differ from each other.

| Element | Value |
|---|---|
| Model name, bold, by tier | `haiku` `#ececec`, `sonnet` `#7dd3fc`, `opus` `#3b82f6`, `fable` `#fb923c`; an id of no known tier in the theme's own colour |
| Effort bar and effort word, by level | `low` `#22c55e`, `medium` `#eab308`, `high` `#f97316`, `xhigh` `#ef4444` |
| Effort bar | four cells, `▰` filled and `▱` empty (`#3a3f47`): `low` one, `medium` two, `high` three, `xhigh` four; an unknown effort has four empty cells and a dim word |
| The line that states a model and an effort | `🔀 <model> <bar> <effort> -> <reason>`, the arrow and the reason dim |
| Good, fair and bad states | the theme's `success`, `warning` and `error` |
| Secondary text | the theme's dim colour |

`🔀` and the teal accent (`#14b8a6`) are the identity of `model-router`'s own view in the terminal. `session-hub` uses `🔀` only
on a line that states a child's model and effort, and never the accent.

## A shared card

On the desktop app both plugins draw their command's answer as a card in the transcript, in the same grammar
(`ui-design.md`). The layout and the drawings are one pair of files that each plugin keeps a copy of:
`hooks/card-kit.tsx` (the card laid out from a plain value) and the drawings with the card's text
(`model-router/lib/card-parts.mjs`, `session-hub/hooks/mod/card-parts.mjs`). The copies are the same text, checked
by `tests/shared-copies.mjs`; a change to one is made to both in the same pull request. The card's model shades
(`SHADES`: Opus darkest, then Sonnet, Fable, Haiku lightest) and status dots are defined there, once.

## Environment variables for a child

Set by `session-hub:spawn` on the launch command. A mod can read an environment variable only by a literal name,
so these names are fixed.

| Variable | Value |
|---|---|
| `SESSION_HUB_ROLE` | `child` |
| `SESSION_HUB_MASTER` | the master's session name when the child started |
| `SESSION_HUB_MASTER_REF` | the master's ref in `ListAgents` when the child started; optional |
| `SESSION_HUB_MASTER_SESSION_ID` | the master's session id (`CLAUDE_CODE_SESSION_ID` in its shell); optional |
| `SESSION_HUB_SCOPE_ROOT` | absolute path of the write root |
| `SESSION_HUB_HANDOFF` | absolute path of the handoff file |
| `SESSION_HUB_REGISTRY` | absolute path of the children record (read-only for a child; its outbox is next to it) |
| `SESSION_HUB_GUARDS` | `on` or `off`, from the hub's `Guards` key; absent means `on` |

They reach the child's classic hooks in `--bg`, tmux and Herdr panes (S4; in Herdr through `tab create` / `pane split
--env`). The desktop app starts sessions through a tool that takes no environment and was not tested: there the
role has to come from the handoff file, and the scope guard is inactive, which `spawn` must say in its report.

A session's name can change while it runs (`/rename`, a title hook, Remote Control), and its ref changes when it
restarts; its session id changes with neither. A child's send guard therefore takes the master as the session
with that id when `SESSION_HUB_MASTER_SESSION_ID` is set, and the two other values tell which recipient the model
meant by the master. A child started without the id is tied to the master's name, as before.

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
| `<children record without .json>.outbox/` | `session-hub` (a child's mod writes, the master reads and removes) | one file per message a child could not deliver to its master |
| `<config dir>/model-router/events.jsonl`, `quality/` | `model-router` | the event log (routing decisions included) and the quality aggregates (`model-router-quality-loop.md`) |

`<config dir>` is the active Claude Code config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`). Never write state
inside a hub or a repository.

## Versions

- Each plugin folder has its own `plugin.json` and its own version.
- Minimum Claude Code version for the mods: declare it in `engines["claude-code"]`. Mods exist from 2.1.287; the
  research was done on 2.1.329.
- The skills and the classic hook must work with the mods off.
