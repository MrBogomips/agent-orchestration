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

## Components (0.3)

| Name | Kind | What it does |
|---|---|---|
| `model-router:choose-model` | skill | The grid: four model tiers, four effort questions, the rules around them (go up when in doubt, risk is about the act, project defaults, the user wins, choose at start, escalation, a coordinator's own model), plus *inline or delegate* and *continue, do not restart*. For each start it writes one line `model · effort · reason`, passes `model` and `effort` on the start call, and tags the description with the task class (`[mr:<class>]`, `[mr:<class>!]` when risky). Agents with a fixed model keep it. |
| `model-router:setup` | skill | Writes or updates a *Model routing* section in the project's instruction file, `AGENTS.md` or else `CLAUDE.md`, with defaults and exceptions per kind of work or task class, only after the user says yes. |
| `model-router:report` | skill | Runs `scripts/report.mjs`: compacts the quality data, writes a self-contained page and opens it. |
| `model-router` | mod | At a subagent start that carries no model, asks a fast judge model and sets the model and the effort; keeps explicit models, forks, resumes and agents whose definition fixes a model. Records decisions, starts, signals and reports. Fails open. |
| `/model-router` | command | The usage view: a dialog with four tabs (Overview, Models, Classes, Decisions), or the same rows as text where no pane fits; `on` and `off` switch routing for the session. See [Commands](#commands). |
| `grid.json` | data | The grid in machine-readable form, with each class's usual choice. The judge's prompt is generated from it; `grid.test.mjs` fails when it and the skills drift apart. |
| `scripts/compact.mjs`, `scripts/report.mjs`, `scripts/usage.mjs` | scripts | Node, no dependencies. Compaction closes the outcome of each task and keeps aggregates per user and per project; the report renders them; `usage.mjs` gives `/model-router` its data. The page and the command share one aggregation (`lib/usage-data.mjs`), so their numbers agree. |

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
Up to release 0.3 the router only measures: it does not yet choose from this data.

## Usage

- Start subagents as usual: `choose-model` loads when the agent is about to start one and applies the grid; the
  mod covers the starts that still carry no model.
- Ask for *model-router setup* in a project to record its defaults, for example a higher effort for database
  migrations.
- Type `/model-router` to see this session's subagents, the models in use and the measured quality in the
  terminal, or ask for the *model-router report* for the same numbers on a page.
- An explicit model or effort you ask for in the conversation always wins.

## Commands

`/model-router` is registered by the mod. With mods off there is no command: ask for the *model-router report*
instead, which builds the page from the same numbers. Every answer of the command is for you only: the model
does not read it.

| Command | Does |
|---|---|
| `/model-router` | Opens the usage view on Overview, last 7 days, user level |
| `/model-router [overview\|models\|classes\|decisions] [24h\|7d\|30d\|all] [user\|project]` | Opens it on that tab, window and level, in any order (`stats` and `log` work as `classes` and `decisions`) |
| `/model-router on`, `/model-router off` | Turns routing on or off for this session |
| `/model-router report` | Writes and opens the report page, and prints its path |
| `/model-router help` | Lists the arguments and the keys; any unknown argument does the same |

### The usage view

A dialog pane in the style of `/usage`, with four tabs:

| Tab | Shows |
|---|---|
| Overview | Routing on or off, measuring, adapt; this session's subagents by model with input, output, cache-read and cache-write tokens and cost; this session's routing decisions by action, with bars |
| Models | Per tier and effort, over the window: closed tasks, tokens, cost, first-pass yield (FPY) with a bar, cost per successful task, and the model ids seen in the window. A cancelled task counts in the tasks, not in FPY |
| Classes | Per task class, over the window and at the level: n, FPY with a bar, rework rate, cost per successful task, the grid's choice next to the best measured cell, weak-signal flags, and each cell under its class (`*` marks the recommended one); then up to three recommendations that differ from the grid, each led by its FPY |
| Decisions | The latest twelve routing decisions of every session (UTC), `•` marking this session's |

| Key | Does |
|---|---|
| `1`–`4`, or Left/Right/Tab onto a tab | Switches tab |
| `d`, `w`, `m`, `a` | Window: last 24 hours, 7 days, 30 days, or all time |
| `p` | Switches between your data across projects (user) and this project's |
| `o` | Writes and opens the report page; a toast gives its path |
| `r` | Refreshes: runs compaction and reads again |
| Esc | Closes the view |

The `all` window of Classes shows the aged aggregates, the very numbers of the report page; shorter windows count
the tasks whose report fell inside them. Opening the view runs compaction for at most 3 seconds; if it takes
longer, the view shows the numbers as of the last compaction and says so.

Where no pane can be placed (`claude -p`, a headless run, a terminal under 60 columns), the command prints the same
rows as text: the tab you named, or all four. A real run of `claude -p "/model-router"` on a machine with two
measured subagents:

```text
model-router: Usage · last 7 days · user level

── Overview ────────────────────────────────────────────────────────────────────
Status:               routing on · measuring on · adapt off

Session
No subagent has run in this session yet.

Routing · 0 decisions this session
No routing decision in this session yet.

── Models ──────────────────────────────────────────────────────────────────────
Models · last 7 days · 2 closed tasks · 166.3k tokens · $0.0097
                tasks  tokens    cost  FPY                       $/success
haiku·low           2  166.3k $0.0097  ████████████████████ 100%   $0.0049
Model ids: claude-haiku-5-5

── Classes ─────────────────────────────────────────────────────────────────────
Classes · user level · last 7 days
                       n  FPY                        rework $/success
read-search            2  ████████████████████ 100%      0%   $0.0049
  grid haiku·low · best: not enough data · read-only: weak signal, n < 5
    haiku·low          2  ████████████████████ 100%      0%   $0.0049

Recommendations
  None differs from the grid.

── Decisions ───────────────────────────────────────────────────────────────────
Decisions · latest 2 of 2 · all sessions · UTC
11-20 21:37  downgrade   sonnet → haiku·low    general-purpose: judge: fast at …
11-20 21:48  downgrade   sonnet → haiku·low    Explore: judge: fast at 0.95

Data read 2026-11-20 22:38 UTC.
/model-router help: tabs, windows, levels and keys.
```

In a session with subagents, Overview reads like this (from the test data set):

```text
Session
Subagents:            3 · $0.034
Usage by model:
   claude-sonnet-5-5: 1 × 52.0k tokens ($0.021)
   claude-haiku-5-5:  2 × 2.0k input, 6.0k output, 950.0k cache read,
                      50.0k cache write ($0.013)
Dropped agents show total tokens only (from the log).

Routing · 4 decisions this session
  downgrade           ██████████░░░░░░░░░░ 2
  keep                █████░░░░░░░░░░░░░░░ 1
  explicit            █████░░░░░░░░░░░░░░░ 1
```

The pane draws the same rows under a row of tab buttons, with the window, level, report and refresh keys at the
bottom.

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
| `adapt` | false | Choose from the quality data; from release 0.4, unused before |
| `halfLifeDays` | 30 | Aging of the quality data |
| `projectPriorStrength` | 5 | How many observations the user level counts for in a project's estimate; from release 0.4, unused before |
| `exploreCap` | 0.1 | Share of decisions per class that may explore; from release 0.4 |
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
  parent's model, so a subagent of a `fable` session can be lowered. Up to 0.3 it does not hold `review-debug` and
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
Adaptive selection from the quality data comes in 0.4.
