# model-router

Picks the model and the effort level for subagents, child sessions and workflows with one written grid.

## Why

An agent left to itself starts every subagent on its own model and effort. Simple lookups then run on the most
expensive model, and hard reviews sometimes run on a cheap one and come back for rework. `model-router` gives
the agent one short grid to decide with, makes it pass both values explicitly on every start, and lets each
project record where it departs from the grid.

## Components (0.1)

| Name | Kind | What it does |
|---|---|---|
| `model-router:choose-model` | skill | The grid: four model tiers, four effort questions, the rules around them (go up when in doubt, risk is about the act, project defaults, the user wins, choose at start, escalation, a coordinator's own model), plus *inline or delegate* and *continue, do not restart*. For each start it writes one line `model · effort · reason`, passes `model` and `effort` on the start call, and tags the description with the task class (`[mr:<class>]`, `[mr:<class>!]` when risky). Agents with a fixed model keep it. |
| `model-router:setup` | skill | Writes or updates a *Model routing* section in the project's `AGENTS.md` (defaults and exceptions per kind of work or task class), only after the user says yes. |
| `grid.json` | data | The same grid in machine-readable form, for the router that comes in 0.2. `grid.test.mjs` fails when it and the skills drift apart. |

`choose-model` reads `<config dir>/model-router/quality/recommendations.json` (`CLAUDE_CONFIG_DIR`, else
`~/.claude`) as a hint when the file exists. Release 0.1 does not write it and works without it.

## Usage

- Start subagents as usual: `choose-model` loads when the agent is about to start one and applies the grid.
- Ask for *model-router setup* in a project to record its defaults, for example a higher effort for database
  migrations.
- An explicit model or effort you ask for in the conversation always wins.

## Installation

Install the plugin from the `mrbogomips` marketplace:

```
/plugin marketplace add MrBogomips/claude-plugins
/plugin install model-router@mrbogomips
```

It works in any project, with or without `session-hub`;
when `session-hub` is installed, `session-hub:spawn` uses `choose-model` for the model and effort of child
sessions.

Release 0.1 contains only the two skills. The router mod, the decision log and the `/model-router` command come
in 0.2; the quality report in 0.2 and adaptive selection in 0.3. Design: `docs/design/model-router.md` and
`docs/design/model-router-quality-loop.md` in the source repository.
