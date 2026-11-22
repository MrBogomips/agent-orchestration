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
| `model-router:choose-model` | skill | The grid: four model tiers, four effort questions, the rules around them (go up when in doubt, risk is about the act, project defaults, the user wins, choose at start, escalation, a coordinator's own model), plus *inline or delegate* and *continue, do not restart*. For each start it writes one line `🔀 opus ▰▰▰▱ high -> reason` (an effort bar of four cells, `low` one to `xhigh` four), passes `model` and `effort` on the start call, and tags the description with the task class (`[mr:<class>]`, `[mr:<class>!]` when risky). Agents with a fixed model keep it. |
| `model-router:setup` | skill | Writes or updates a *Model routing* section in the project's instruction file, `AGENTS.md` or else `CLAUDE.md`, with defaults and exceptions per kind of work or task class, only after the user says yes. |
| `model-router:report` | skill | Runs `scripts/report.mjs`: compacts the quality data, writes a self-contained page and opens it. |
| `model-router` | mod | At a subagent start that carries no model, asks a fast judge model and sets the model and the effort; keeps explicit models, forks, resumes and agents whose definition fixes a model. Draws under each `Agent` call the model and effort the subagent actually got, in colour (see [The choose-model line](#the-choose-model-line)). Records decisions, starts, signals and reports. Fails open. |
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

The model is set when the subagent starts, the effort on each of the subagent's model requests; the start call
itself is never changed, so the routing works in every permission mode, auto mode included. An effort the call
already carries is kept.

### The choose-model line

Before each start, `choose-model` makes the agent write one plain-text line, which works with mods off:

```text
🔀 opus ▰▰▰▱ high -> review with unknown cause, going up
🔀 haiku ▰▱▱▱ low -> mechanical rename, easy to check
```

🔀, the model, an effort bar of four cells (`▰` filled, `▱` empty: `low` one, `medium` two, `high` three, `xhigh`
four), the effort, `->` and the reason in under 12 words.

With the mod on, the same line is drawn in colour under each `Agent` call's row, with the model and effort the
subagent **actually got** after routing, and the reason: `explicit` (the call named the model), `fixed` (the
agent's definition fixes it), `judge: <class>; lowered from opus` (or `raised from`, `kept`, with `, effort set` when only the effort was set),
`judge: risky work; raised from <tier>`, or `keep: <why>`.

```text
⏺ Agent([mr:read-search] Find the CSV writer)
  ⎿  🔀 haiku  ▰▱▱▱ low    -> judge: read-search; lowered from sonnet
```

The model is bold, coloured by tier (haiku white, sonnet light blue, opus blue, fable orange); the bar and the
effort by level (low green, medium yellow, high orange, xhigh red), empty cells dark grey; the reason dim. An effort
nobody set shows four empty cells and a dim `default` until the subagent's first request; if that request carries
no effort level either, the line keeps `default`. On any error only the row is drawn. Several `Agent` calls made in
one message are drawn by Claude Code as one "background agents launched" row; their lines then show in the ctrl+o
transcript.

### What is measured

Each subagent start is one task. Its outcome is fixed when the rework window (30 minutes after its report, or
the end of the session) closes: `success`, `rework` (the main session or another agent writes one of its files, a
similar start of the same class follows on the same files, the same subagent is sent a correction after its report,
or one of the next two prompts you type names its files or its task),
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

A dialog pane laid out like Claude Code's own Settings dialog (`/usage`, `/stats`): a header row with 🔀 and the
four tabs, a second row with the window (24h, 7d, 30d, all) and the level (user or project), the content, and a
footer of key hints. The active tab and window are drawn as a teal block; the KPI tile borders share the teal.

```text
🔀 model-router [Overview]  Models   Classes   Decisions
d:  24h  w: [7d] m:  30d  a:  all                p: user · project
```

| Tab | Shows |
|---|---|
| Overview | Routing on or off, measuring, adapt; the **KPI tiles** of the window: first-pass yield (FPY), cost per successful task, rework rate and routed starts (↓ downgrade, ↑ upgrade, = keep), each with its change against the window of the same length before it (green when better, red when worse) and a status dot (FPY 🟢 from 85%, 🟡 from 70%, 🔴 below; rework 🟢 up to 10%, 🟡 up to 25%, 🔴 above; cost 🟢 cheaper or 🔴 dearer, ⚪ no prior with no earlier window (always for `all`); ⚪ under five tasks); sparklines of FPY and cost per success across the window; FPY bars per tier and effort, coloured the same way; this session's subagents by model with input, output, cache-read and cache-write tokens and cost; this session's routing decisions by action |
| Models | The tiles, when the four fit on one row (70 columns); per tier and effort, over the window: closed tasks, tokens, cost, FPY with a bar, cost per successful task, and the model ids seen in the window. Closed tasks only, as in the tiles: a cancelled task counts in none of them |
| Classes | The tiles, when they fit; per task class, over the window and at the level: n, FPY with a bar, rework rate, cost per successful task, the grid's choice next to the best measured cell, weak-signal flags, and each cell under its class (`*` marks the recommended one); then up to three recommendations that differ from the grid, each led by its FPY |
| Decisions | The latest twelve routing decisions of every session (UTC), `•` marking this session's |

The keys work as soon as the view opens, with no click:

| Key | Does |
|---|---|
| Tab, Shift+Tab | Next or previous tab |
| ↓, ↑ | Next or previous window: last 24 hours, 7 days, 30 days, all time |
| `d`, `w`, `m`, `a` | That window directly |
| `p` | Switches between your data across projects (user) and this project's |
| `o` | Writes and opens the report page; its path is written as a line in the session |
| `r` | Refreshes: runs compaction and reads again |
| Page Up, Page Down | Scroll a long tab |
| Esc | Closes the view |

Left and Right do not switch tabs as they do in Claude Code's own dialog: Claude Code does not pass them to a
plugin's pane, and Left at the prompt opens the agents view.

The `all` window of Classes shows the aged aggregates, the very numbers of the report page; shorter windows count
the tasks whose report fell inside them. Opening the view runs compaction for at most 3 seconds; if it takes
longer, the view shows the numbers as of the last compaction and says so.

Where no pane can be placed (`claude -p`, a headless run, a terminal under 60 columns), the command prints the same
rows as text, without colours and with the status dots: the tab you named, or all four. A real run of
`claude -p "/model-router overview"` on a machine with three measured subagents:

```text
model-router: 🔀 Usage · last 7 days · user level

── Overview ────────────────────────────────────────────────────────────────────
Status:               routing on · measuring on · adapt off

Last 7 days · user level · 3 tasks scored · vs the one before
╭─ FPY ───────╮ ╭─ $/success ─╮ ╭─ Rework ────╮ ╭─ Routed ────╮
│    100%     │ │   $0.043    │ │     0%      │ │  7 starts   │
│   ⚪ weak   │ │   ⚪ weak   │ │   ⚪ weak   │ │  ↓2 ↑0 =3   │
╰─────────────╯ ╰─────────────╯ ╰─────────────╯ ╰─────────────╯

FPY by day                  ▄  100%
$/success by day            ▄  $0.043

haiku·low      ████████████████████ 100%   $0.0049    2 tasks
sonnet·medium  ████████████████████ 100%    $0.118     1 task

Session
No subagent has run in this session yet.

Routing · 0 decisions this session
No routing decision in this session yet.

Data read 2026-11-21 00:51 UTC.
/model-router help: tabs, windows, levels and keys.
```

With more data, over the last 30 days (from the test data set, 62 columns, so the tiles stand two by two):

```text
Last 30 days · user level · 8 tasks scored · vs the one before
╭─ FPY ───────╮ ╭─ $/success ─╮
│   75% ▼25   │ │ $0.097 ▲93% │
│   🟡 fair   │ │  🔴 dearer  │
╰─────────────╯ ╰─────────────╯
╭─ Rework ────╮ ╭─ Routed ────╮
│   13% ▲13   │ │  5 starts   │
│   🟡 some   │ │  ↓3 ↑0 =1   │
╰─────────────╯ ╰─────────────╯

FPY by 3 days            ▁   ██▆  67%
$/success by 3 days          ▂▁█  $0.205
```

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

The plugin sends what it records nowhere: it all stays under the active config folder
(`CLAUDE_CONFIG_DIR`, else `~/.claude`) in `model-router/`: `events.jsonl` (decisions; each subagent start with
its type, name and short description; the paths of files the session and its subagents write; tool names of
failed subagent calls and stop targets; the first 2,000 characters of the two prompts you type next after a
subagent reports, inside the rework window, and of no other prompt; reports with tokens and estimated cost),
`archive/` (the event log rotated from 32 MB, kept with its outcomes, decisions and starts only; after 90 days with
its outcomes only), `options.json` (the options compaction uses), `quality/` (aggregates per user and per
project, with the project's root path) and `report.html`. Nothing is written inside a repository. The judge is one
fast-tier model call per routed start through your session's own client, counted in the session's cost; it
receives the subagent type, its short description and the first 4,000 characters of its task.

## Limits

- The mod needs Claude Code 2.1.329 or later (`engines` in `plugin.json`), tested on 2.1.329 and 2.1.330. The skills do not
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
- Several `Agent` calls made in one message are drawn by Claude Code as one "background agents launched" row:
  the 🔀 lines then show only in the ctrl+o transcript, under each call.

## Installation

Install the plugin from the `mrbogomips` marketplace:

```
/plugin marketplace add MrBogomips/claude-plugins
/plugin install model-router@mrbogomips
```

It works in any project, with or without `session-hub`; when `session-hub` is installed, `session-hub:spawn`
uses `choose-model` for the model and effort of child sessions. The skills work with mods turned off; the router,
the command and the measurement need the mod.

The user manual for both plugins, with screenshots of every tab of the usage view and of the report page, is
`docs/manual/user-manual.pdf` in the source repository.

Design: `docs/design/model-router.md` and `docs/design/model-router-quality-loop.md` in the source repository.
Adaptive selection from the quality data comes in 0.4.
