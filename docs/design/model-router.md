# Plugin `model-router`

Picks the model and the effort level for sessions and for subagents. Works in any project.

## Components

| Name | Kind | What it does |
|---|---|---|
| `model-router:choose-model` | skill | Holds the grid. The agent uses it whenever it starts a subagent or a session, and passes model and effort explicitly. |
| `model-router:setup` | skill | Writes a *Model routing* section in the project's instruction file with project defaults and exceptions, after the user confirms. |
| `model-router` | mod | At a subagent's start, acts only when no model was given. Logs every decision. |
| `/model-router` | command (mod) | Opens the usage view, a tabbed dialog pane (overview, models, classes, decisions); falls back to text where no pane can be placed. Turns the router on or off for the session. See *Command*. |
| Decision log | file | `decision` records in `~/.claude/model-router/events.jsonl` (under the active config folder); see `model-router-quality-loop.md`. |
| Options | `userConfig` | Tier models, thresholds, judge timeout, on/off switches. |
| `model-router:report` | skill | Compacts the quality data and opens a local report page. See `model-router-quality-loop.md`. |
| Quality data | files | Event log and aggregates per user and per project, under `~/.claude/model-router/`. See `model-router-quality-loop.md`. |

## The grid

One grid for sessions and subagents. Its single machine-readable source is `model-router/grid.json` (tiers,
price order, effort questions, task classes, judge mapping). `choose-model` states it in prose for the agent, and
`setup` lists its values; a test fails when either drifts from `grid.json`. The mod reads tiers and classes from
`grid.json`, and only the models behind the tiers and the numeric thresholds from `userConfig`; its judge prompt
is generated from `grid.json`.

### Model

Check in order and stop at the first that fits.

| Tier | Fits when | Examples |
|---|---|---|
| `haiku` | The task is simple, repetitive and easy to check. No judgment calls. | List or summarize files, run one command, rename a symbol, apply the same edit many times |
| `sonnet` | You can say what done looks like in one sentence. | A well-specified change in a few files, tests for existing code, a clearly described bug |
| `fable` | The job is big and open-ended, **and** judgment and accuracy really matter. Both must hold. | A complex design, an architecture decision with long consequences |
| `opus` | Everything else, and whenever you are unsure between two tiers. | Review, debugging with an unknown cause, most coordination |

Tier names are aliases. The models behind them are options, not constants.

### Effort

Ask in order and stop at the first yes.

1. Is it a simple task or a quick back-and-forth? → `low`
2. Is it long, hard and critical, and handed off to run unattended? All three. → `xhigh`
3. Would a hidden mistake cost money, a client or a wrong decision? → `high`
4. Otherwise → `medium`

Never `max`.

### Rules around the grid

- **When in doubt, go up.** A task that gets too little is worse than one that costs more.
- **Risk is about the act, not the topic.** Changing production, moving money or altering data that cannot be
  restored is risky. Writing or testing code that deals with those things is not.
- **Project defaults win over the grid** when the project's *Model routing* section names the kind of work.
- **An explicit choice by the user wins over everything.**
- **Sessions: choose at start.** Do not change the model of a running session.
- **Escalation on failure.** Retry with specific feedback; then raise the effort one level; then start a new
  session or subagent one tier up, with a handoff that says what was tried and why it was rejected.
- **A coordinator's own model.** A session that mostly delegates to subagents with fixed models needs judgment,
  not volume: `opus` at `medium` unless the design work itself is hard.

The grid is adapted from the reference pack (`research/reference-pack.md`). Its wording there is the author's;
write the skill's text fresh.

## Skill `choose-model`

- Triggers when the agent is about to start a subagent, a child session, or a workflow of agents.
- Output: for each start, one plain-text line `🔀 <model> <bar> <effort> -> <reason in under 12 words>`, for
  example `🔀 opus ▰▰▰▱ high -> review with unknown cause, going up`. The bar has four cells, `▰` filled and `▱`
  empty: `low` one, `medium` two, `high` three, `xhigh` four. No dots, a plain `->`. It works with mods off;
  `lib/route-line.mjs` writes the same line and `grid.test.mjs` checks the skill's examples against it.
- For subagents, the agent passes both values on the start call. The effort parameter exists on the start tool
  in the current release (`research/mods-capabilities.md`, C.9); the reference pack says otherwise and is out of
  date on this point.
- An agent definition that fixes its own model keeps it. The skill does not override project agents: this is an
  exception to the project's defaults and to the grid, not a rule between them, so unless the user names a model
  for it, such an agent gets only an effort, and only when its definition sets none.
- `session-hub:spawn` loads this skill when it is installed (`shared-contract.md`).

## Mod `model-router`

Second release. Read `research/mods-capabilities.md` before designing it.

### Behaviour at a subagent's start

Three hooks share the work. A `tool.call` hook on the `Agent` tool decides the case and asks the judge, and
passes the call on unchanged; the `agent.spawn` hook that follows, joined to it by the start's `tool_use_id` (S3),
sets the model against the parent's model the event carries and logs the decision; a `turn.step` hook sets the
effort on each model request of the started subagent, by its `agentId` (S14). Starts that no `Agent` call makes
(another plugin's `$.agent.spawn`, a workflow's agents) are not routed, only measured.

| Case | Action |
|---|---|
| The call carries a model | Keep it. Log `explicit`. |
| The agent's definition fixes a model | Keep it. The event does not show a fixed model, and a hook's model would override it (S3), so the mod reads the definition: it routes the built-in types verified to inherit (`general-purpose`, `Explore`) and project or user agents (`<cwd>/.claude/agents/<type>.md`, `<config dir>/agents/<type>.md`) whose frontmatter names no model or `inherit`, and whose `name`, when present, is the type: Claude Code names a type after that `name`, not the file (S17), so a file that declares another name is some other agent and the start is kept. Any other type (a plugin's agent, a definition it cannot read) is kept. The decision is logged as `keep`, the spawn record with route `fixed`. |
| A fork or a resume | Keep it. The engine ignores a change anyway. A resume is logged as a `resume` signal of the same task. |
| The router is off, or a session-wide forced subagent model is set (`CLAUDE_CODE_SUBAGENT_MODEL`) | Keep it. Log `keep`. |
| No model given | Ask the judge; apply the thresholds below; log. |

A risky marker in the class tag (`[mr:<class>!]`, written by `choose-model`) counts as a risky judge answer. The tag
is read in any case and with spaces inside (`[MR: edit-specified !]`), and the marker counts even when the class is
not in the grid: a mistyped or invented class reads as no class, never as no risk.

### The judge

A single call to the fast tier, with a time limit (default 8 s). It receives the subagent type, the short
description and the task text, cut at a fixed length. The task is wrapped as data and the judge is told not to
follow instructions inside it; a closing tag inside the text is escaped.

It answers with one JSON object:

```json
{ "tier": "fast | balanced | deep", "confidence": 0.0, "effort": 0, "effort_confidence": 0.0, "risky": 0.0, "class": "<class>" }
```

The prompt is generated from `grid.json` (`lib/judge.mjs`): the tiers behind `fast`, `balanced` and `deep`, the
effort questions numbered 0 to 3, the classes, and the rule that risk is about the act. The task is cut at 4,000
characters and every `</task` inside it is escaped. The judge runs with `effort: low` and a 300-token cap.

Thresholds, all options:

| Rule | Default | Why |
|---|---|---|
| Downgrade needs confidence ≥ | 0.6 | Being wrong means a task gets too little |
| Upgrade needs confidence ≥ | 0.3 | Being wrong only costs money |
| `risky` > | 0.7 forces the deep tier and effort ≥ high | Skips both bars |
| Missing confidence | never changes the model, in either direction | |
| Unknown current model | counts as an upgrade | |

The numbers come from the reference router, whose authors call them untested. The decision log exists to tune
them.

### Effort for subagents

`agent.spawn` has no effort field. Up to 0.3.1 the mod rewrote `effort` on the `Agent` tool call, which works in
default mode (S3). In auto permission mode the engine refuses it (S14): the classifier reviews the call's input
before the `tool.call` hooks run, and a call whose input a hook changed afterwards is not run ("a hook changed this
call's input after auto mode reviewed it"). Every routed start then failed, which a router must never cause.

From 0.3.2 the mod never changes the `Agent` call's input. When `agent.spawn` answers the subagent's `agentId`,
the mod keeps the routed effort for that id, and a `turn.step` hook sets it on every model request of that loop
(a step rewrite lasts one step). The model request is not a tool input, so no permission mode reviews it; the
subagent's first request already carries the level (S14). The `$.agent.list()` row then has no `effort` of its
own, so the report record takes the level from the row's `lastRequest`. The map lives in the module: after a
reload, a subagent started earlier runs at its inherited effort, which fails open. An effort the call already
carries is kept. Otherwise the judge's level is set when its `effort_confidence` passes the bar (`low` needs the
downgrade bar, higher levels the upgrade bar); risky work gets at least `high`. `max` is never set.

### The choose-model line under an Agent row

The skill's line says what the agent meant to start; the mod draws, under each `Agent` call's row, what the
subagent actually got after routing. A `ui.render` hook on `{ component: 'ToolUse', props: { tool: 'Agent' } }`
keeps the engine's row (`await next(e)` in its tree) and adds one line:

```
  ⎿  🔀 haiku  ▰▱▱▱ low    -> judge: read-search; lowered from sonnet
```

- **What it shows.** The model the subagent started on (`agent.spawn`'s answer, shown by tier name), its effort
  and the reason. The effort is the routed one or the call's; when neither is set, the line says `default` (four
  empty cells, the word dim) until the subagent's first `turn.step`, and keeps it when that step carries no level. The reason names the case: `explicit`,
  `fixed`, `judge: <class>; lowered from <tier>` / `raised from` / `kept <tier>` (`, effort set` when only the
  effort changed), `judge: risky work; raised from <tier>`, or `keep: <why>` (router off, a fork, a session-wide
  model, a judge error). `lib/route-line.mjs` builds the text and the colours.
- **Where it lives.** One `$.state` family member per call, keyed by `tool_use_id` (`route` in the contract),
  written at `agent.spawn` and again at the subagent's first step when the effort was unknown. The row's
  `requestId` is the same id, so the render hook reads its member and redraws when it is written; the value
  survives a reload of the mod.
- **Colours.** Model in bold: haiku `#ececec`, sonnet `#7dd3fc`, opus `#3b82f6`, fable `#fb923c`. Effort bar and
  word: low `#22c55e`, medium `#eab308`, high `#f97316`, xhigh `#ef4444`; empty cells `#3a3f47`; the reason dim.
  The model and effort columns are padded so the lines of several calls align.
- **Never breaks the row.** With no member yet (before the start, after a refused start, a call the router never
  saw) the hook answers the row alone, and its `.catch` does the same on any error.
- **Limit.** Several `Agent` calls in one message are drawn by Claude Code as one "N background agents launched"
  row, not as `ToolUse` rows: their lines show in the ctrl+o transcript only.

### Failure

Fail open: a judge error, a timeout or an unreadable answer leaves the request unchanged. This is the opposite
of the guards in `session-hub`, on purpose: a router that fails must never stop work.

The routing and recording hooks each have a `.catch` that writes one debug line, `[model-router] <hook>: <error>`,
and hands the event on unchanged; `session.start` catches its own work, and `/model-router` answers a fixed line
when the log cannot be read, so a hook that throws or times out is fail-open too, and leaves a trace. At
`agent.spawn`, what runs after the agent has started is caught on its own: an unreadable grid or project is logged,
and the spawn record is still appended without the class or the project, so the task still gets an outcome. A judge that answers with an error is logged as `error` (a `!` tag still forces the deep
tier); a judge call that throws leaves no decision record, and the spawn record shows route `unseen`.

The router's judge tiers stop at the deep tier (`opus`) and the comparison is with the parent's model, so a
subagent of a `fable` session can be lowered; up to 0.3 it does not hold `review-debug` and `design-open` to the grid's
floor (the floor applies to exploration and recommendations from 0.4).

Log one line when the mod is ready, one at the first firing of each hook and one for each failure. Without them, a
router that never loaded, or fails on every call, looks the same as one with nothing to do. All go to the debug log
(`claude --debug`), not the transcript.

### Decision log

One JSON line per decision, as a `type: "decision"` record of the quality loop's `events.jsonl`. Append through a shell `cat >>` call, because the mod's file API has no append and a
read-then-write can drop another writer's line.

```json
{
  "ts": "2026-11-20T10:00:00Z", "session": "…", "agentId": "…", "subagentType": "general-purpose",
  "action": "downgrade | upgrade | keep | explicit | forced-risk | error",
  "before": "opus", "after": "haiku", "effort": "low",
  "judge": { "tier": "fast", "confidence": 0.86, "effort": 0, "effortConfidence": 0.9, "risky": 0.02, "class": "read-search", "ms": 1240 },
  "reason": "…"
}
```

Each record also carries `v: 1`, `toolUseId` and `class`. `before` is the model the call carried, else the parent's model (what the subagent
would have run on), `after` the model the engine started it on.

No cost figures in the decision record. An honest saving needs the model the subagent would really have run on,
which the reference router gets wrong for agents with a fixed model.

### Options

| Option | Default |
|---|---|
| `fastModel`, `balancedModel`, `deepModel` | the current haiku, sonnet and opus aliases |
| `minDowngradeConfidence` | 0.6 |
| `minUpgradeConfidence` | 0.3 |
| `riskThreshold` | 0.7 |
| `timeoutMs` | 8000 |
| `routeSubagents` | true |
| `measure` (replaces `logDecisions`) | true |

`measure` switches every record of the event log, decisions included (`model-router-quality-loop.md`). The
command `/model-router on|off` turns routing on or off for the session (kept in `$.state`); see *Command*.

### Command

`/model-router [tab] [window] [level] | on | off | report | log | help`, modelled on the built-in `/usage` dialog: one
view of every number the mod and the quality loop hold, in compact blocks with aligned labels, `k`/`M` token
counts, `$` costs and text bars sized to the room.

**The usage view** is a dialog pane: `$.ui.open({ id: 'model-router-usage', focus: true, closeOnEscape: true,
rows: 24 })`, drawn by a `ui.render` hook on its `Pane`. Its layout follows Claude Code's Settings dialog (`/usage`,
`/stats`): a header row with the title and the tabs, a second row of sub-tabs, the content, and a footer of key
hints in italics. The identity is 🔀 and a teal accent (`#14b8a6`), used only for the title, the active
tab and window (drawn as an inverse block, as Claude Code draws its active tab) and the tile borders; status
colours are the theme's success, warning and error, and everything else keeps the theme's colours.

```
🔀 model-router [Overview]  Models   Classes   Decisions
d:  24h  w: [7d] m:  30d  a:  all                p: user · project
...
Tab/⇧Tab tab · ↑/↓ period · p level · o: report · r: refresh · l: log · Esc
```

The second row is the window, on every tab, with the level (user or project) at its right end; the level is not a
row of its own because only Classes and the tiles depend on it. The view has four tabs:

| Tab | Shows |
|---|---|
| Overview | A status line (routing on or off for the session, measuring, adapt). The **KPI tiles** of the window at the level: first-pass yield, cost per successful task, rework rate and routed starts (by downgrade ↓, upgrade ↑, keep =). Each tile carries the change against the window of the same length before it (▲/▼, in points for the rates and in percent for the cost; green when better, red when worse, whatever the direction) and a status dot: FPY 🟢 from 85%, 🟡 from 70%, 🔴 below; rework 🟢 up to 10%, 🟡 up to 25%, 🔴 above; cost 🟢 cheaper or 🔴 dearer than before, ⚪ no prior with no earlier window (always for `all`); ⚪ under five scored tasks. Four tiles stand on one row from 70 columns, two by two below. Two **sparklines**, first-pass yield and cost per success, in equal buckets across the window (24h: 3 hours, 7d: a day, 30d: 3 days, all: the last 12 weeks by week). The **tier·effort bars** of the window, coloured by the FPY thresholds (dim under five tasks). **Session**: this session's subagents by model, with input, output, cache-read and cache-write tokens and cost, and the total. **Routing**: this session's decisions counted by action (downgrade, upgrade, keep, explicit, forced-risk, error). |
| Models | The tiles when they fit on one row; then per tier and effort, over the window: closed tasks, tokens, cost, first-pass yield with a bar coloured as above, cost per successful task; the model ids seen in the window, on one line. It counts the same closed tasks as the tiles: a task closed `cancelled` counts in none of its figures. |
| Classes | The tiles when they fit on one row; then per class, over the window and at the level: n, first-pass yield with a bar, rework rate, cost per successful task, the best measured cell next to the grid's choice, weak-signal flags; under each class its cells. Then up to three recommendation rows that differ from the grid, each led by the recommended cell's first-pass yield. |
| Decisions | The latest routing decisions, all sessions, newest last: time, action, model before and after, effort, subagent type, reason. |

The headline numbers (`headline` of each window in `lib/usage-data.mjs`) count the scored tasks (success, rework,
failure) of the window; at the project level they count the project's tasks and the decisions of its spawns.

**Keys** while the pane holds the keyboard, from the moment it opens (no click):

| Key | Does |
|---|---|
| Tab, Shift+Tab | Next or previous tab, wrapping at both ends |
| ↓, ↑ | Next or previous window (24h, 7d, 30d, all), cycling |
| `d` `w` `m` `a` | Window: last 24 hours, 7 days, 30 days, all |
| `p` | Level: the user's data or this project's |
| `o` | Write and open the HTML report (`scripts/report.mjs`); its path is written as a line in the session |
| `r` | Refresh: run compaction and read again |
| `l` | Open the event log in the system's default app; its path is written as a line in the session (*Opening the log*) |
| Page Up, Page Down, wheel | Scroll the content |
| Esc | Close |

Left and Right do not switch tabs, unlike Claude Code's own dialog: the engine does not route them to a plugin
pane (spike S15 in `spikes.md`). How the other keys are wired, in `lib/usage-nav.mjs`:

- **Tab** walks the engine's focus ring over the pane's Buttons. The tabs are Buttons, the active one drawn with
  `autoFocus`, so the ring sits on the active tab from the open; a `ui.focus` hook switches the tab as the ring
  lands on one. A step off either end of the tab row is rewritten to the other end (`next({ ...e, element })`).
  The title is a Button before the tabs so that Shift+Tab off the first tab meets an element of the plugin: a
  move onto one of the engine's own stops (the close mark) cannot be rewritten.
- **↓ and ↑** reach a pane as a one-row `ui.scroll` while its body has rows to scroll, and walk the ring
  otherwise. The hook pads the body with blank rows to one row more than the window (`e.props.scroll.bodyRows`),
  so the arrows always arrive as a scroll; a `ui.scroll` hook answers a one-row scroll from the person with no
  pointer by stepping the window and leaves the body where it is. Page keys, Home, End and the wheel scroll.
- A click moves the ring before it presses. A press on anything but a tab moves the ring back to the active tab;
  a press within 500 ms of a wrap undoes the wrap, which a click off the row from an end tab would cause.

**Arguments.** `/model-router models 30d` opens on that tab and window; tab, window (`24h`, `7d`, `30d`, `all`)
and level (`user`, `project`) may come in any order. `on` and `off` turn routing on or off for the session. `report` writes and opens the report page and answers with its path. `help`, and any argument the
command does not know, print the list of arguments and keys.

**Text fallback.** Where no pane can be placed (headless or `claude -p`, a terminal narrower than 60 columns, or
an open that answers `isPlaced: false`, which is then closed so it does not appear later), the command answers
the same rows as aligned text: the requested tab, or all four stacked when no tab was named. Every text answer
of the command carries `isTextDisplayOnly: true`: it is for the person, and the model does not read it.

**Window and level.** The default window is 7 days, the default level the user. A window counts the closed
tasks (`outcome` records) whose report, or for a task with no report its outcome, falls inside it. Models counts every closed task, learned or not; Classes
counts learned tasks only, as the aggregates do. Under the `all` window, Classes reads the aged aggregates
(`quality/user.json`, `quality/projects/<id>.json`), so it shows the very numbers of the report page; under a
shorter window it folds the window's outcomes without aging. The project level is the session's project (the
same id the spawn records carry).

**One source of numbers.** The aggregation is plain code shared with the report page: `lib/usage-data.mjs`
builds the view's data from the records and the aggregates (it also holds what the page needs: classes with their cells and recommendation, decisions by action, the
weekly trend), on
top of `metrics` and `recommend` in `lib/aggregate.mjs`; the scripts read the files. `lib/usage-view.mjs` is pure: from that data, a tab, a
window, a level and a width it returns the rows to draw; the pane and the text fallback both draw those rows.

**Reading.** The mod runs `node scripts/usage.mjs`, which runs compaction in a child process with a 3-second
budget, then reads `events.jsonl` and the aggregates once and prints the data for every window and both levels as
JSON, so changing window or level redraws without running anything. If compaction is still running at the end of
its budget, or another run holds the lock, the data is as of the last compaction and the view says so. The
session's subagents come live from `$.agent.list()`, passed to the script on stdin; agents the engine has already
dropped come from this session's `report` records, with total tokens only. The whole read has a 15-second limit.

**Width.** Rows fit the room they are drawn in: the pane's `bodyColumns`, or `presentation.columns` for text,
with a minimum layout at 60 columns and 80 headless. Bars take what is left after the fixed columns, between 6
and 20 cells. Lines that cannot fit are cut with `…`.

**Graphical surfaces.** The rows above are text art for a monospace terminal: box characters, block sparklines
and columns padded with spaces. Claude Desktop, the editor and the phones draw proportional type, where none of
that lines up, so on any surface but `terminal` whose element table has `Svg` the same hook draws a native layout
from the same data. The terminal's rendering is unchanged.

- **Split.** `lib/usage-cards.mjs` builds the view model of a tab from the data (`cardsView`): pills, subtitle,
  banner, KPI cards, table rows, chips, empty states. It takes every format and every status from
  `lib/usage-view.mjs` and `lib/usage-tiles.mjs`, so a figure reads the same in both renderings.
  `lib/usage-svg.mjs` draws the charts as SVG strings. The hooks module keeps the state and the actions;
  `hooks/usage-pane.tsx` picks the rendering, `hooks/usage-desktop.tsx` lays the model out and
  `hooks/usage-terminal.tsx` draws the rows.
- **Keys.** The terminal's key handling (the ring that follows the tabs and wraps, the press that moves the ring
  back, the arrows that step the window) is off while the pane is drawn graphically: the `ui.focus`, `ui.press`
  and `ui.scroll` hooks hand the event on unchanged, so Tab reaches every control, a click presses what was
  clicked and the body scrolls. These events do not name a surface, so the hooks go by the last drawing.
- **Header.** The title in the accent at heading size, and the status as three pills (a dot in the accent when
  on, muted when off). Under it the tabs, the windows and the level as native Buttons, the active one of each
  group `variant: "primary"`; the level is two Buttons, `level-user` and `level-project`. The other Buttons keep
  the terminal's element keys (`tab-…`, `window-…`, `report`, `refresh`, `log`) and hotkeys; `p` is on the level that is
  not shown.
- **Sample size.** Under five scored tasks one banner says so (`2 tasks scored — figures are indicative under
  5`), and no card carries a `weak` mark. With five or more there is no banner. At the project level of a session
  with no project id the banner says that instead, and there are no cards and no classes.
- **KPI cards.** Four cards in a row from 70 body columns, two by two below: a caption label, the figure at
  title size with tabular digits, a status chip (a coloured dot and the word; muted for a neutral status such as
  the cost's `no prior`), the change against the window
  before (`▼ 25 pts`, `▲ 12%`) and a sparkline. The routed card shows the count and `3 down · 0 up · 1 kept`.
- **Sparklines.** One per rate and cost, over the window's buckets: a 2 px line on a soft area, the last point
  dotted, a faint baseline. A bucket with no closed task breaks the line; a point with no neighbour is a dot.
  A series of up to three values is drawn as one bar per value instead, since so few points make no line.
  FPY and rework are drawn on a fixed 0 to 100% scale, the cost from zero to its highest bucket. Each bucket has
  a `<title>` tooltip (`11-20: 50% · 2 tasks`), shown where the surface draws the SVG as interactive (the
  desktop app). For this the series of `lib/usage-data.mjs` also carries each bucket's rework rate.
- **Tables.** Models, classes, session and routing are rows of fixed-share columns with tabular digits, the
  FPY as an SVG bar coloured by the same thresholds (grey under five tasks; a share above zero is at least one
  pixel wide). Classes are one card per class with
  its cells under it, the recommended cell starred, and the recommendations in a callout bordered in the accent.
  Decisions are a compact table with one chip per action: downgrade green, upgrade in the accent, forced-risk
  amber, error red, keep and explicit muted.
- **Empty states.** A section with nothing to show says what will appear there and when, in one line.
- **Footer.** The freshness note, and Report, Refresh and Log as native Buttons. No key hints.
- **Colours.** Text, chips and borders name the theme's own colours (`success`, `warning`, `error`,
  `inactive`), so they follow light and dark. An SVG is drawn as an image and cannot read the app's colours, and
  the API does not say which mode is on: the charts use fixed mid-tones that read on both grounds (line
  `#0d9488`, good `#16a34a`, fair `#d97706`, bad `#dc2626`, grey `#8b8b8b`, tracks at 25% opacity).
- **Minimized.** In the desktop app's `widget` seat the pane draws the title, the FPY figure and its sparkline,
  with no controls.
- **Limits.** An SVG source is capped at 131,072 characters: over it a sparkline drops its tooltips, then its
  marks. If the view model cannot be built the hook logs why and draws the terminal's rows; if those cannot be
  built either it draws one line (`Could not draw the usage view: …`). The pane is never left empty.

**Failure.** The command fails open like the rest of the mod: a hook error, a script that fails or times out,
or unreadable output answers one short line (`Could not read the usage data: …`; the engine shows it under the
plugin's name) and never throws to the engine. `report` that fails or takes more than 60 seconds answers
`Could not write the report: …`. The pane draws a note in place of the rows when it has no data; after a failed
refresh the earlier rows stay, with a warning under them. A second `r` while a read runs is ignored.

**Opening the log.** Every pane offers its plugin's own log (`ui-design.md`); model-router's is the event log,
`<config dir>/model-router/events.jsonl`. The `l` key, the Log button and `/model-router log` do the same thing,
decided in `lib/open-log.mjs`:

- The API has no call that opens a file, and a `Link` opens what the surface chooses (on a remote surface only
  `https:`), so the mod runs the system's opener with `$.process.run`, the path as one argument and no shell:
  `open -t <log>` on macOS, `xdg-open <log>` on Linux, by `$.session.info().platform`. `-t` is the default text
  editor: `.jsonl` often has no app of its own, and a plain `open` then fails.
- One action, not two. The line written in the session names the log and, when `archive/` exists, that folder too
  (`Event log opened: … · rotated logs: …`). A reveal in the file manager would show both, but only macOS has one
  (`open -R`), and it would not open the log.
- When compaction has just rotated the log away and no new record has been written, the archive folder is opened
  instead. With neither, nothing runs and the line says that no log has been written yet.
- Nothing runs either on a hosted session (the machine is not the person's), on a platform with no known opener
  (Windows, WSL) or for a config folder that is not an absolute path: the line gives the path and the reason.
- A command that exits non-zero, cannot start or runs over 10 seconds gives `Could not open <path>: <first line of
  the reason>`. The action never throws and never changes the pane.

Only these two paths are ever passed to an opener. `/model-router log` used to be an alias of
`/model-router decisions`; from 0.3.13 it opens the log.

**With mods off** there is no command; the `model-router:report` skill builds the same page from the same code.

Routing the main session's effort per prompt is out of scope: a change mid-chat can discard the prompt cache.

## Releases

| Release | Content |
|---|---|
| 0.1 | `choose-model`, `setup`. |
| 0.2 | The mod, the decision log, the command, the options; the quality loop measuring only, and `report`. |
| 0.3 | The usage view: `/model-router` as a tabbed dialog with a text fallback, numbers shared with the report page. From 0.3.4, the 🔀 identity and the coloured choose-model line under `Agent` rows. |
| 0.3.13 | The usage view opens the event log: the `l` key, the Log button, `/model-router log`. |
| 0.4 | Adaptive selection from the quality data (`model-router-quality-loop.md`). |

## Open points

- Whether to try the existing MIT-licensed router unchanged for a week before writing a new one, to collect a
  first decision log. It would say how often an agent starts a subagent without a model once `choose-model` is in
  use, which is the only case the mod serves.
- Licence: the reference router is MIT (author named in its `LICENSE`). Code taken from it keeps the notice. The
  rest of the reference pack has no clear licence: do not copy from it.
