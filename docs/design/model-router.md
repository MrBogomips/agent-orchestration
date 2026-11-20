# Plugin `model-router`

Picks the model and the effort level for sessions and for subagents. Works in any project.

## Components

| Name | Kind | What it does |
|---|---|---|
| `model-router:choose-model` | skill | Holds the grid. The agent uses it whenever it starts a subagent or a session, and passes model and effort explicitly. |
| `model-router:setup` | skill | Writes a *Model routing* section in the project's instruction file with project defaults and exceptions, after the user confirms. |
| `model-router` | mod | At a subagent's start, acts only when no model was given. Logs every decision. |
| `/model-router` | command (mod) | Shows the latest decisions; turns the router on or off for the session. |
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
2. Would a hidden mistake cost money, a client or a wrong decision? → `high`
3. Is it long, hard and critical, and handed off to run unattended? All three. → `xhigh`
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
- Output: for each start, one line `model · effort · reason in under 12 words`.
- For subagents, the agent passes both values on the start call. The effort parameter exists on the start tool
  in the current release (`research/mods-capabilities.md`, C.9); the reference pack says otherwise and is out of
  date on this point.
- An agent definition that fixes its own model keeps it. The skill does not override project agents.
- `session-hub:spawn` loads this skill when it is installed (`shared-contract.md`).

## Mod `model-router`

Second release. Read `research/mods-capabilities.md` before designing it.

### Behaviour at a subagent's start

Two hooks share the work, joined by the start's `tool_use_id` (S3): a `tool.call` hook on the `Agent` tool
decides the case, asks the judge and sets the effort on the call; the `agent.spawn` hook that follows sets the
model, against the parent's model the event carries, and logs the decision. Starts that no `Agent` call makes
(another plugin's `$.agent.spawn`, a workflow's agents) are not routed, only measured.

| Case | Action |
|---|---|
| The call carries a model | Keep it. Log `explicit`. |
| The agent's definition fixes a model | Keep it. The event does not show a fixed model, and a hook's model would override it (S3), so the mod reads the definition: it routes the built-in types verified to inherit (`general-purpose`, `Explore`) and project or user agents (`<cwd>/.claude/agents/<type>.md`, `<config dir>/agents/<type>.md`) whose frontmatter names no model or `inherit`. Any other type (a plugin's agent, a definition it cannot read) is kept. The decision is logged as `keep`, the spawn record with route `fixed`. |
| A fork or a resume | Keep it. The engine ignores a change anyway. A resume is logged as a `resume` signal of the same task. |
| The router is off, or a session-wide forced subagent model is set (`CLAUDE_CODE_SUBAGENT_MODEL`) | Keep it. Log `keep`. |
| No model given | Ask the judge; apply the thresholds below; log. |

A risky marker in the class tag (`[mr:<class>!]`, written by `choose-model`) counts as a risky judge answer.

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

`agent.spawn` has no effort field. The mod rewrites `effort` on the `Agent` tool call itself, which works in
2.1.329 (S3): the subagent's steps and its `$.agent.list()` row carry the new level. An effort the call already
carries is kept. Otherwise the judge's level is set when its `effort_confidence` passes the bar (`low` needs the
downgrade bar, higher levels the upgrade bar); risky work gets at least `high`. `max` is never set.

### Failure

Fail open: a judge error, a timeout or an unreadable answer leaves the request unchanged. This is the opposite
of the guards in `session-hub`, on purpose: a router that fails must never stop work.

The routing and recording hooks each have a `.catch` that hands the event on unchanged, `session.start` catches
its own work, and `/model-router` answers a fixed line when the log cannot be read, so a hook that throws or times
out is fail-open too. A judge that answers with an error is logged as `error` (a `!` tag still forces the deep
tier); a judge call that throws leaves no decision record, and the spawn record shows route `unseen`.

The router's judge tiers stop at the deep tier (`opus`) and the comparison is with the parent's model, so a
subagent of a `fable` session can be lowered; 0.2 does not hold `review-debug` and `design-open` to the grid's
floor (the floor applies to exploration and recommendations from 0.3).

Log one line when the mod is ready and one at the first firing of each hook. Without them, a router that never
loaded looks the same as one with nothing to do. Both go to the debug log (`claude --debug`), not the transcript.

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
command `/model-router on|off` turns routing on or off for the session (kept in `$.state`); with no argument it
shows the state and the latest ten decisions.

Routing the main session's effort per prompt is out of scope: a change mid-chat can discard the prompt cache.

## Releases

| Release | Content |
|---|---|
| 0.1 | `choose-model`, `setup`. |
| 0.2 | The mod, the decision log, the command, the options; the quality loop measuring only, and `report`. |
| 0.3 | Adaptive selection from the quality data (`model-router-quality-loop.md`). |

## Open points

- Whether to try the existing MIT-licensed router unchanged for a week before writing a new one, to collect a
  first decision log. It would say how often an agent starts a subagent without a model once `choose-model` is in
  use, which is the only case the mod serves.
- Licence: the reference router is MIT (author named in its `LICENSE`). Code taken from it keeps the notice. The
  rest of the reference pack has no clear licence: do not copy from it.
