# `model-router` quality loop

Status: agreed with the user, 2026-11-20. Extends `model-router.md`. The spikes it depended on (S11–S13) were run
for release 0.2 and hold (`spikes.md`); "As built in 0.2" and "As built in 0.3" at the end record the builder's choices.

## Why

Bad routing shows up today as rework and as a token count that explodes. The router chooses a model and an effort
level (Plan), the subagent works (Do), but nothing measures how well that choice worked (Check) or feeds the
result back into the next choice (Act). The quality loop closes this Plan-Do-Check-Act cycle: it measures, cheaply,
how well the work went for each choice of model and effort, keeps that memory per user and per project with
aging, and adapts the router.

## Goals

1. Measure without extra model calls: only events and figures the engine already records.
2. Keep memory at two levels, user and project, and let the project level diverge from the user level as its own
   data grows.
3. Adapt: explore alternatives close to the grid's choice, keep what works, forget slowly what is old.
4. Show the user what was measured and what was changed, in a report they can read.

## Non-goals

- Typed companion agents (reader, editor, researcher). Excluded by the user: an agent with a fixed model is
  exactly what the router leaves alone, so the two would cancel each other.
- Adapting the model of child sessions. Later, from the `session-hub` children record.
- OpenTelemetry export. It needs a collector and does not attribute usage to a single subagent.
- Per-prompt effort in the main session (prompt cache, see `model-router.md`).
- Billing accuracy. Costs are the engine's estimates.

## Anti-goals

- Exploration that causes the rework it is meant to remove.
- Learning that lowers the model or effort on risky work.
- State inside a hub or a repository.
- Concurrent sessions losing each other's updates.

## Approaches considered

| Approach | Outcome |
|---|---|
| Manual tuning of the thresholds from the log | Rejected: slow, no memory per project, depends on the user reading logs. |
| ε-greedy exploration near the thresholds | Rejected: explores at a fixed rate whether or not the answer is already known. |
| **Thompson sampling over Beta posteriors, the grid as prior** | **Chosen.** Exploration concentrates where the data is uncertain, the grid's choice wins until data says otherwise, and aging is a discount on counts. |

## Signals

All come from mod events and `$` calls; none calls a model.

| Signal | Source | Strength |
|---|---|---|
| Tokens and estimated cost of a subagent, per model | `$.agent.list()` rows: `usage[]`, `cost` (verified at report time, S11; cumulative over continuations) | strong |
| How the run ended | `agent.report`: `status` = `completed` / `failed` / `stopped` | strong |
| Tool error rate | tool results with `isError`, keyed by `agentId` | medium |
| Files the subagent wrote | `tool.call` on `Edit`, `Write`, `NotebookEdit` with `agentId` and `file_path` (verified, S12) | needed for rework |
| Rework | inside the rework window after the report: the main session or any other agent (siblings included) writes one of the same files; a spawn of the same class whose description is similar (redo or escalation); a prompt typed by the person (`prompt.submit`, origin) that follows the report | strong for writers |
| Re-search | inside the window, for a read-only subagent: the parent starts another read-only subagent of the same class on a similar description, or reads the files the subagent named | weak; shown as such in the report |

*Similar description*: same class and a token-set overlap (Jaccard) of at least 0.5 on the lowercased words of
the description, stop words removed. Builder may tune; the threshold is an option.

## Outcome of one task

A task is one subagent start. Its outcome is fixed when the rework window closes (default 30 minutes after the
report, or the end of the session if sooner):

- `success`: `completed` and no rework signal.
- `rework`: `completed` and at least one rework signal.
- `failure`: `failed`, or stopped by the parent's own stop call and followed by a rework signal ("Builder
  questions settled", item 5).
- `cancelled`, not learned: any other stop, or no report at all (closed at the end of the session or after
  24 hours).

## Metrics

| Metric | Definition |
|---|---|
| Cost per task | mean estimated cost (and tokens) of tasks in the cell |
| Rework rate | `rework` / (`success` + `rework` + `failure`) |
| First-pass yield (FPY) | `success` / (`success` + `rework` + `failure`) |
| **Cost per successful task** | cost per task / FPY. The number the loop minimizes. |

## Task classes

A fixed list, so that cells fill up:

| Class | Covers |
|---|---|
| `read-search` | find files, symbols, facts |
| `read-analyze` | read and conclude: explain, compare, summarize |
| `edit-mechanical` | repetitive, easy-to-check edits |
| `edit-specified` | a change whose done-state fits in one sentence |
| `review-debug` | review, debugging with an unknown cause |
| `design-open` | open-ended design where judgment matters |

The class comes from, in order: a tag `[mr:<class>]` at the start of the start call's description (any case, spaces
allowed inside; a class not in the grid reads as none), which `choose-model` tells the agent to add; the judge's answer, when the judge runs (the judge prompt gains a `class`
field); otherwise `unknown`, which is logged and never learned.

## Memory

Everything lives under `<config dir>/model-router/` (`CLAUDE_CONFIG_DIR`, else `~/.claude`). Nothing is written
inside a hub or a repository.

| Path | Content | Writer |
|---|---|---|
| `events.jsonl` | one line per spawn, per signal and per closed outcome | every session, append only (`cat >>` through `$.process.run`, since `$.fs` has no append) |
| `quality/user.json` | aggregates for the user | compaction |
| `quality/projects/<project id>.json` | aggregates for one project | compaction |
| `quality/.lock` | compaction lock (pid, time) | compaction |

*Project id*: the first 16 hex characters of the SHA-256 of the normalized git remote URL of the session's
repository, else of its root path. The file also stores the readable root path for the report.

**Aggregate cell**, keyed by class × tier × effort:

```json
{ "alpha": 3.2, "beta": 1.1, "n": 5, "costMean": 0.041, "tokensMean": 18200, "updated": "2026-11-20T10:00:00Z" }
```

**Compaction** runs at `session.start` and from `model-router:report`. It takes the lock (stale after 2 minutes),
reads closed outcomes after the last compacted offset, updates both levels, writes each file whole (write to a
temporary name, then rename), and records the new offset. If it fails, the event log is untouched and the next run
retries. Events older than 90 days and already compacted may be pruned.

**Aging**: before each update and at read time, `alpha`, `beta` and `n` are multiplied by
`0.5 ^ (days since updated / halfLifeDays)`, default half-life 30 days.

**Two levels**: the project posterior is the project's own counts plus the user's posterior scaled to
`projectPriorStrength` pseudo-observations (default 5). With little project data the user level decides; with
more, the project's own record does.

**Grid prior**: a cell with no data starts at `alpha = 2, beta = 1` for the grid's choice and `alpha = 1, beta = 1`
for its neighbours, so the grid wins until data disagrees.

## Selection (release 0.4)

For a subagent start that carries no model, after the judge (`model-router.md`):

1. If the judge's `risky` is above `riskThreshold`, apply the fixed top tier and effort ≥ high. Not learned, never
   explored.
2. Candidates: the grid's (tier, effort) and its neighbours one step away in tier or in effort.
3. For each candidate, sample p from its two-level Beta posterior; estimate cost from `costMean` (the grid's
   relative price order when there is no data).
4. Pick the lowest cost / p. If the pick is not the grid's choice and exploration in this class already reached
   `exploreCap` of the last 50 decisions, keep the grid's choice.
5. Log the decision with `explore: true|false`.

Starts with an explicit model, agents with a fixed model and forks are never changed, but they are measured, so
their outcomes feed the cells.

`choose-model` also reads a short per-class recommendation (`quality/recommendations.json`, written by compaction
from release 0.4, so absent before it) so that explicit choices benefit from the data. The skill must work when
the file is missing. Its shape is fixed in 0.4; the 0.1 skill only reads the entry for the task's class as a hint.

Everything here fails open: an error leaves the start unchanged and logs `error`.

## New rules in `choose-model`

- **Inline or delegate.** A small task whose files are already in context is done inline. A subagent starts with
  an empty context and reads everything again, while the parent reads its warm cache at a fraction of the price.
- **Continue, do not restart.** A follow-up on the same topic continues the existing subagent through the message
  tool instead of starting a new one.

Neither rule is enforced by the mod up to 0.4; both are measured indirectly (re-search, cost).

## Report: `model-router:report`

A new skill. It runs compaction, then writes `<config dir>/model-router/report.html`, a self-contained page, and
opens it. Nothing leaves the machine; publishing it elsewhere happens only when the user asks.

Content:

- per level (user, each project) and per class: a table of cells with n, FPY, rework rate, cost per task, cost per
  successful task, the share of explored decisions, and the current recommendation;
- trend of FPY and cost per successful task per week;
- corrections applied by the router (from 0.4) and recommendations that differ from the grid;
- weak-signal cells (read-only classes, n below 5) flagged.

The page is generated by a script in the plugin (`node`, no dependencies) from the aggregates; the skill does not
compute numbers itself. `/model-router` shows the same numbers in the terminal, from the same code (`model-router.md`, *Command*).

## Options

Added to the `userConfig` of `model-router.md`:

| Option | Default |
|---|---|
| `measure` | true |
| `adapt` | false until 0.4, true from 0.4 |
| `halfLifeDays` | 30 |
| `projectPriorStrength` | 5 |
| `exploreCap` | 0.1 |
| `reworkWindowMin` | 30 |
| `similarityThreshold` | 0.5 |

## Releases

| Release | Content |
|---|---|
| 0.2 | Router mod, signals, event log, compaction, report skill. `adapt` off: the loop only measures. |
| 0.3 | The usage view in the terminal (`/model-router`), on the report's aggregation. Still measuring only. |
| 0.4 | Selection by Thompson sampling, recommendations read by `choose-model`. |

Measuring first lets the user check that the signals are sane before they drive choices.

## Left to the builder

- Stop-word list, exact window bookkeeping, file layout inside the mod.
- Report styling and charts, within a self-contained page.
- How the cost order of tiers is encoded when there is no data.

## Builder questions settled

A builder check of this document raised the questions below. Each answer is the designer's call, made while the
user was away; the user may change any of them.

1. **A typed prompt counts as rework only when it is about the task.** It must be one of the next two prompts the
   person types after the report, and either name a file the subagent wrote or reach `similarityThreshold`
   against the subagent's description. Any other prompt is not a signal.
2. **Tiers are the four model families, ordered by price: `haiku` < `sonnet` < `opus` < `fable`.** "One step away"
   follows this order. The judge's three tiers map to `fast` = `haiku`, `balanced` = `sonnet`, `deep` = `opus`;
   `fable` is reached only by the grid or an explicit choice. A full model id maps to its family; an id outside
   the four families is logged as `other` and not learned. A cell also stores the model id it was measured on:
   when the model behind an alias changes, a new cell starts with the old cell's counts halved as its prior.
   A start without an effort is learned under the session's effective effort when the mod can read it, and is
   not learned otherwise; a numeric effort is mapped to the nearest named level.
3. **Only writes made through the session's own tools count.** Edits in an outside editor are not seen up to 0.4.
4. **Limits on moving down.**
   - `choose-model` adds `!` to the tag of a risky start (`[mr:edit-specified!]`); such starts are measured but
     not learned, like the judge's risky starts.
   - Exploration and recommendations never go below the grid's tier or effort for `review-debug` and
     `design-open`, and never below the project's *Model routing* defaults for any class.
5. **A stop that cannot be attributed is `cancelled`**, not learned. Only a stop by the parent's own stop call
   followed by a rework signal counts as `failure`.
6. **One log.** `events.jsonl` replaces `decisions.jsonl` from `model-router.md`: a routing decision is one record
   type in it (`type: "decision"`), next to `spawn`, `signal` and `outcome`. `/model-router` reads the decision
   records.

## As built in 0.2

Choices left to the builder, and where the build departs from the text above.

- **Who writes what.** The mod appends `decision`, `spawn`, `signal` (`write`, `tool-error`, `prompt`, `stop`,
  `resume`), `report` and `session-end` records. **Outcomes are fixed by compaction**, not by the mod: compaction
  reads the raw records, decides each task whose window closed, appends its `outcome` record to `events.jsonl`
  and folds it into the aggregates. The mod stays thin, and the outcome logic is plain code under test
  (`lib/outcome.mjs`). A resumed session keeps its id and ends more than once: a task closes at the first end
  after its own start.
- **Window bookkeeping.** `quality/state.json` holds the byte offset of the first record of any task still open
  (a subagent's report can reach the log before its spawn record) and the keys of tasks closed after it. A task
  with no report closes as `cancelled` when its session ends or after 24 hours. A continued subagent
  (`SendMessage`) stays one task: its latest report gives the cost and starts the window.
- **Compaction** is `scripts/compact.mjs` (Node, no dependencies), started by the mod at `session.start` through
  `$.process.run` without waiting, and by `model-router:report`. It writes the aggregates and `state.json` whole
  (temporary name, then rename) under `quality/.lock`. A stale lock is moved aside by a rename, which only one run
  wins, and a run removes only its own lock.
- **A run that dies is safe to repeat.** A task that already has an `outcome` record in the log is not decided
  again, and each aggregate file keeps the keys of the tasks it folded (for 90 days), so a repeated fold counts
  nothing twice. The event log itself is only appended to.
- **A torn last line.** A line with no newline yet is not read; it waits for the next run. Compaction never
  appends after it: while the line changed in the last two minutes, another session may still be finishing it,
  and the run closes nothing (its tasks stay behind the offset and are closed, folded and appended by a later
  run). A torn line older than that has no writer left: the run ends it with a newline, so it stays one skipped
  line, and appends its outcomes after it.
- **Options.** The mod saves the options compaction needs in `<config dir>/model-router/options.json` at each
  session start; compaction and the report read it when no `--options` is given.
- **Cells** store aged evidence counts (`n`, `success`, `rework`, `failure`) and the means; `alpha` and `beta` are
  the grid prior plus those counts, so aging never wears the prior away. When the model behind an alias changes,
  the same cell keeps its key, halves its counts and records the new model (instead of a new cell).
- **Grid choice per class.** Each class in `grid.json` names its `default` (tier, effort): the prior's favoured
  cell, the floor of the protected classes, and the report's fallback recommendation.
- **The report** (`scripts/report.mjs`, page rendered by `lib/report-html.mjs`) shows a recommendation per class
  in 0.2 too: the cell with the lowest cost per successful task among cells with at least 3 tasks, never below
  the grid for protected classes; the router does not use it until 0.4.
- **Project id** comes from the engine's `$.session.repo()` (`origin` URL and root), else the session root.
- **Privacy.** The prompt signal keeps the first 2,000 characters of a typed prompt, so that compaction can tell
  whether it is about the task. All of it stays under the config folder.

Not built in 0.2 (nor in 0.3):

- *Re-search* by reading the files a read-only subagent named: only the similar-start signal is measured.
- Pruning of compacted events older than 90 days: rewriting the log could drop a line another session appends.
- The two-level combination (`projectPriorStrength`): the report shows each project's own cells. It is used by
  selection from 0.4.
- The tool error rate: `tool-error` signals are recorded but play no part in outcomes or the report yet.

The effort a task is learned under is the subagent's own (its `$.agent.list()` row at report time), else the
effort of its last request, which is the session's effective level, else the effort the router set at the start;
a task with none is not learned.

## As built in 0.3

- **Shared aggregation.** `lib/usage-data.mjs` holds what the report page and the terminal both compute: the
  classes of a level with their cells, recommendation and weak-signal flags; decisions by action; the weekly
  trend; the latest outcome of each task; windows over outcomes. `scripts/report.mjs` builds the page from it,
  `scripts/usage.mjs` the terminal's data.
- **Windows.** The page shows the aged aggregates only. The terminal adds windows of 24 hours, 7 and 30 days over
  the closed outcomes (by report time, or by outcome time for a task with no report), folded without aging. Under
  its `all` window, Classes shows the page's numbers; Models adds up outcomes without aging in every window.
