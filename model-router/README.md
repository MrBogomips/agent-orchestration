# model-router

Picks the model and the effort level for subagents, child sessions and workflows with one written grid, routes the
subagent starts that carry no model, and measures on your machine how well each choice worked.

## Why

An agent left to itself starts every subagent on its own model and effort. Simple lookups then run on the most
expensive model, and hard reviews sometimes run on a cheap one and come back for rework. `model-router` gives
the agent one short grid to decide with, makes it pass both values explicitly on every start, lets each project
record where it departs from the grid, and catches the starts that still carry no model. It then measures, for
each kind of task and each model and effort, how often the work was right the first time and what a successful
task cost, so the grid can be checked against real work.

## Components (0.2)

| Name | Kind | What it does |
|---|---|---|
| `model-router:choose-model` | skill | The grid: four model tiers, four effort questions, the rules around them (go up when in doubt, risk is about the act, project defaults, the user wins, choose at start, escalation, a coordinator's own model), plus *inline or delegate* and *continue, do not restart*. For each start it writes one line `model · effort · reason`, passes `model` and `effort` on the start call, and tags the description with the task class (`[mr:<class>]`, `[mr:<class>!]` when risky). Agents with a fixed model keep it. |
| `model-router:setup` | skill | Writes or updates a *Model routing* section in the project's `AGENTS.md` (defaults and exceptions per kind of work or task class), only after the user says yes. |
| `model-router:report` | skill | Runs `scripts/report.mjs`: compacts the quality data, writes a self-contained page and opens it. |
| `model-router` | mod | At a subagent start that carries no model, asks a fast judge model and sets the model and the effort; keeps explicit models, forks, resumes and agents whose definition fixes a model. Records decisions, starts, signals and reports. Fails open. |
| `/model-router` | command | Shows whether routing is on and the latest ten decisions in the log (all sessions); `/model-router off` and `/model-router on` switch routing for the session. |
| `grid.json` | data | The grid in machine-readable form, with each class's usual choice. The judge's prompt is generated from it; `grid.test.mjs` fails when it and the skills drift apart. |
| `scripts/compact.mjs`, `scripts/report.mjs` | scripts | Node, no dependencies. Compaction closes the outcome of each task and keeps aggregates per user and per project; the report renders them. |

### What the router does at a start

| The start | The router |
|---|---|
| carries a model, is a fork or a resume | keeps it |
| names an agent whose definition fixes a model, a plugin's agent, or one whose definition it cannot read | keeps it |
| runs with routing off, or under a session-wide subagent model (`CLAUDE_CODE_SUBAGENT_MODEL`) | keeps it |
| carries no model | asks the judge (one call to the fast tier, 8 s limit), then lowers the model only at confidence ≥ 0.6, raises it at ≥ 0.3, and sends risky work (risk > 0.7, or a `!` tag) to the deep tier with at least high effort |

The effort is set on the start call itself; an effort the call already carries is kept.

### What is measured

Each subagent start is one task. Its outcome is fixed when the rework window (30 minutes after its report, or
the end of the session) closes: `success`, `rework` (the main session or another agent writes one of its files, a
similar start of the same class follows, or one of the next two prompts you type names its files or its task),
`failure` (failed, or stopped by its parent and redone) or `cancelled`. Cancelled tasks, risky tasks, tasks with
no class (no `[mr:<class>]` tag and no judge answer), tasks on a model outside the four families and tasks with no
known effort are recorded but not learned. Cells of class × tier × effort keep first-pass yield, rework rate,
cost per task and cost per successful task, aged with a 30-day half-life, at two levels: you, and each project.
Release 0.2 only measures: the router does not yet choose from this data.

## Usage

- Start subagents as usual: `choose-model` loads when the agent is about to start one and applies the grid; the
  mod covers the starts that still carry no model.
- Ask for *model-router setup* in a project to record its defaults, for example a higher effort for database
  migrations.
- Ask for the *model-router report* to see the measured quality, or type `/model-router` for the latest
  decisions.
- An explicit model or effort you ask for in the conversation always wins.

## Options

Set in `/config` or under `pluginConfigs` in settings.

| Option | Default | Meaning |
|---|---|---|
| `fastModel`, `balancedModel`, `deepModel` | `haiku`, `sonnet`, `opus` | Models behind the judge's fast, balanced and deep tiers; the fast one also runs the judge |
| `minDowngradeConfidence` | 0.6 | Judge confidence needed to lower the model, or to set effort `low` |
| `minUpgradeConfidence` | 0.3 | Judge confidence needed to raise the model, or to set effort `medium`, `high` or `xhigh` (whatever the session's own effort) |
| `riskThreshold` | 0.7 | Risk above which the start gets the deep tier and at least `high` effort |
| `timeoutMs` | 8000 | Judge time limit; past it the start is left unchanged |
| `routeSubagents` | true | Route subagent starts at all |
| `measure` | true | Record the event log and the quality data |
| `adapt` | false | Choose from the quality data; from release 0.3, unused in 0.2 |
| `halfLifeDays` | 30 | Aging of the quality data |
| `projectPriorStrength` | 5 | How many observations the user level counts for in a project's estimate; from release 0.3, unused in 0.2 |
| `exploreCap` | 0.1 | Share of decisions per class that may explore; from release 0.3 |
| `reworkWindowMin` | 30 | Minutes after a report during which a redo counts as rework |
| `similarityThreshold` | 0.5 | Word overlap at which two task descriptions count as the same task |

## Privacy

Nothing leaves the machine. Everything the plugin records stays under the active config folder
(`CLAUDE_CONFIG_DIR`, else `~/.claude`) in `model-router/`: `events.jsonl` (decisions; each subagent start with
its type, name and short description; the paths of files the session and its subagents write; tool names of
failed subagent calls and stop targets; the first 2,000 characters of the prompts you type; reports with tokens
and estimated cost), `options.json` (the options compaction uses), `quality/` (aggregates per user and per
project, with the project's root path) and `report.html`. Nothing is written inside a repository. The judge is one
fast-tier model call per routed start through your session's own client, counted in the session's cost; it
receives the subagent type, its short description and the first 4,000 characters of its task.

## Limits

- The mod needs Claude Code 2.1.329 or later (`engines` in `plugin.json`), tested on 2.1.329. The skills do not
  need the mod.
- Only starts made through the `Agent` tool are routed; a plugin's own `$.agent.spawn` and workflow agents are
  measured, not routed.
- An agent defined by a plugin is never routed: its definition file is not read. Of the built-in types, only
  `general-purpose` and `Explore` are routed (verified to inherit the parent's model).
- The judge's tiers are haiku, sonnet and opus: the router never picks `fable`, and it compares with the
  parent's model, so a subagent of a `fable` session can be lowered. In 0.2 it does not hold `review-debug` and
  `design-open` to the grid's floor.
- Costs are the engine's estimates. Edits made outside the session's own tools are not seen.
- Read-only classes and cells with fewer than five tasks are weak signals; the report flags them.

## Installation

Install the plugin from the `mrbogomips` marketplace:

```
/plugin marketplace add MrBogomips/claude-plugins
/plugin install model-router@mrbogomips
```

It works in any project, with or without `session-hub`; when `session-hub` is installed, `session-hub:spawn`
uses `choose-model` for the model and effort of child sessions. The skills work with mods turned off; the router,
the command and the measurement need the mod.

Design: `docs/design/model-router.md` and `docs/design/model-router-quality-loop.md` in the source repository.
Adaptive selection from the quality data comes in 0.3.
