# `model-router` quality loop

Status: agreed with the user, 2026-11-20. Extends `model-router.md`. The spikes it depended on (S11–S13) were run
for release 0.2 and hold (`spikes.md`); "As built in 0.2", "As built in 0.3" and "As built in 0.6" at the end record the
builder's choices.

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
| Rework | inside the rework window after the report: the main session or any other agent (siblings included) writes one of the same files; a spawn of the same class whose description is similar (redo or escalation), unless it is the next item of a batch on other files; the parent sends the same subagent more work (`resume`, a correction); a prompt typed by the person (`prompt.submit`, origin) that follows the report | strong for writers |
| Re-search | inside the window, for a read-only subagent: the parent starts another read-only subagent of the same class on a similar description, or reads the files the subagent named | weak; shown as such in the report |

*Similar description*: same class and a token-set overlap (Jaccard) of at least 0.5 on the lowercased words of
the description, stop words removed. Builder may tune; the threshold is an option. A similar start is not a redo when it
is the next item of a batch: both descriptions name files (words with a `.` or `/` inside), they share no base
name, and the later start names no file the task wrote. So "rename foo in a.ts", then "in b.ts", then "in c.ts" is
three tasks, while a retry that names no file, or the same file in another form (`src/csv.ts` and
`/repo/src/csv.ts`), is still a redo.

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
repository (`host/owner/repo`: no scheme, user, port or `.git`, lower case), else of its root path. The file also stores the readable root path for the report.

**Aggregate cell**, keyed by class × tier × effort:

```json
{ "alpha": 3.2, "beta": 1.1, "n": 5, "costMean": 0.041, "costN": 4, "tokensMean": 18200, "tokensN": 4, "updated": "2026-11-20T10:00:00Z" }
```

`costN` and `tokensN` count only the outcomes that carried a cost or a token count, and weigh each mean, so a task
with no cost does not pull the mean down. They age with `n`. A cell written before they existed weighs its means
by `n`.

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
the file is missing. Its shape is fixed now, so the skill and the writer agree (`recommendationsFile()` in
`lib/aggregate.mjs`; `grid.test.mjs` checks that the skill names the same fields):

```json
{ "version": 1, "generatedAt": "2026-11-21T00:00:00.000Z",
  "classes": { "edit-specified": { "tier": "sonnet", "effort": "low", "source": "data", "n": 12 } } }
```

`tier` is a row of the grid's model table (not a model id), `source` is `data` (the cheapest cell per successful
task with enough tasks) or `grid` (the class's default, repeated), and `n` the tasks behind a `data` entry. The
skill reads the entry for the task's class as a hint.

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

Content, top to bottom. It is one view model, `reportView` of `lib/report-cards.mjs`, with two renderings: the page
(`lib/report-html.mjs`, styled by `lib/report-style.mjs`) and the native pane of a graphical surface
(`hooks/report-desktop.tsx`). The model holds every text and figure already formatted; the rules are
*Graphical surfaces: HTML pages* in `ui-design.md`:

- **Header.** The title and when the page was generated, as a readable UTC time, with the closed tasks of all time.
- **Headline.** The last 30 days at the user level, from the usage view's own model (`cardsView` of
  `lib/usage-cards.mjs` on the data of `buildUsageData`): its subtitle, its sample-size notice when fewer than five
  tasks are scored, the four KPI cards (FPY, $/success, rework, routed) with their chips, changes and sparklines,
  and the models of the window with their FPY bars. The pane shows the same figures on `30d`.
- **Trend by week.** FPY and cost per successful task per week (Monday, UTC), each a chart from
  `lib/usage-svg.mjs` (a line; one bar per week up to three weeks) with the first and last week named under it in
  HTML, then the weeks as a table.
- **Routing decisions.** All decisions logged, as one chip per action; from 0.4, the corrections the router applied.
- **Classes, all projects.** One card per class at the user level: the grid's cell, the recommendation and whether
  it is measured, a chip when it differs from the grid, and a row per cell with tasks, FPY (bar and figure),
  rework, cost per task, cost per successful task and the share explored.
- **Projects.** The same cards per project, folded under the project's path. A single project whose figures are
  the user level's is one line instead.
- **Footnote.** What the measures mean, how the counts are weighted, where the data was read from, and that
  nothing left the machine.

Counts and weak signals. A cell of an aggregate ages, so its `n` is fractional (2.9). The page shows the whole
number of learned tasks behind the cell (`tasks`, counted from the outcome records by `classesOf`; the aged count
rounded up when the records do not list any) and, on the page, puts the aged count in the cell's tooltip (the pane shows the whole count only); the footnote says so
once. A row with fewer than five tasks is drawn muted with a `○` mark, explained in the footnote, instead of an
`n < 5` flag on every row; a read-only class says `read-only: weak signal` once, under its name.

The page is generated by a script in the plugin (`node`, no dependencies) from the aggregates; the skill does not
compute numbers itself. `/model-router` shows the same numbers in the terminal, from the same code (`model-router.md`, *Command*).
The script opens the page in the system's default browser (`--no-open` writes it only; `--json` writes no page and
prints the report's data). On a graphical surface the mod draws that data as a native pane instead
(`model-router.md`, *Opening the report*).

## Savings: what routing gained (release 0.7)

The measures above say how well each choice worked. Savings answers another question: is the plugin worth its
cost? It compares what the subagents cost with what the same tasks would have cost on the model they would have
inherited. Agreed with the user on 2026-11-23, on two mockups (the page and the desktop card).

**The baseline.** Without the plugin a subagent runs on the model of the session or agent that started it
(`parentModel` on the outcome record, from 0.6). The baseline cost of a task is its cost on that model:

- a task that ran on its parent's tier: its own cost;
- any other task: its tokens, kind by kind, at the *prices* of the parent's tier.

A total token count is not enough: most of a subagent's tokens are cache reads, which cost a small and different
fraction of the input price on each tier, so a cost per token says more about the mix of a task than about the
model (measured on the real logs: `sonnet` came out dearer per token than `opus`). From 0.7 the report record and
the outcome record carry `usage`, the tokens by kind summed over the subagent's requests: `input`, `output`,
`cacheRead`, `cacheWrite`.

The plugin holds no price list: a cost is the engine's estimate, at list price or the managed rates. The prices of
a tier are read back from those estimates: the four rates, one per kind, that best explain `costUsd` from `usage`
over the outcomes of that tier of the last 90 days, all projects (least squares; a kind whose rate comes out
negative is fitted as zero and the others again). A tier has prices only with at least 8 such outcomes and a fit
whose median error is within 10% of the cost; otherwise its tasks have no baseline. So the baseline is in the same
money as the costs shown everywhere else, and follows a price change by itself.

**Tasks compared.** The closed outcomes of the window and the level, except `cancelled`, that carry a cost, a token
count by kind (`usage`) and a `parentModel` whose tier is known and has prices. The others are left out and counted once, in the
footnote. A task is *moved to a cheaper model*, *kept* or *moved to a stronger model* by the place of its tier
against its parent's in the price order.

**Measures.**

| Measure | Definition |
|---|---|
| Per success | cost of the tasks compared / their successes |
| Per success on the session's model | baseline cost / (tasks compared × FPY of the kept tasks; the FPY of all the tasks compared when fewer than five are kept or none of the kept succeeded) |
| Saved, as a share | 1 − per success / per success on the session's model. The headline. |
| Saved | (per success on the session's model − per success) × successes |
| Spent, and on the session's model | the two sums of cost |
| Where tasks ran | for moved cheaper, kept and moved stronger: tasks, share, FPY, rework rate, baseline cost − cost |
| Saved by move | the same per pair of tiers (`opus` to `haiku`), with a total |
| Spend per week | cost and baseline cost per week (Monday, UTC) |
| Judge | judge answers of the window: how many, their total and median time (`judge.ms` of the decision records) |

**Quality** *holds* when the FPY of the tasks moved cheaper is at most 5 points under the FPY of the kept tasks,
otherwise it *drops*; with fewer than five tasks on either side it is not judged.

**Verdict**, one of three:

- `pays off`: at least 100 tasks compared, saved share of 5% or more, and quality does not drop;
- `costs more`: at least 100 tasks compared and a saved share of −5% or less;
- `not proven`: anything else. The line says why: too few tasks, a difference within 5%, or quality drops.

The three thresholds are constants of the module, not options.

**Known limits**, said in the footnote of the page:

- The tasks moved cheaper are easier on average than the kept ones, so comparing their FPY favours the plugin. A
  comparison per class would be fairer; too many starts carry no class today.
- The baseline changes the model only. What a lower effort saves is not counted.
- The judge's own cost is not in the log (the engine does not report it for a `$.model.complete` call) and is not
  subtracted; its time is shown. The time the `choose-model` skill adds to a session is not in the log either.

**Where it shows.** One module, `lib/savings.mjs`, computes the model from outcome and decision records; each
surface renders it and works nothing out again (`ui-design.md`):

- **The page.** A section *Savings*, first, above the Headline: last 30 days, user level. The verdict line, four
  cards (per success with the baseline and the saved share; saved with spent of baseline; moved cheaper with a
  three-part bar; quality), spend per week as paired bars, the judge's figures, and the table of moves.
- **The terminal.** A view *Savings* of `/model-router`, in the window and level the view is on: the verdict, then
  one line per measure, with the effort-bar cells for the share moved cheaper.
- **The card.** A view *Savings* in the card's dropdown, following its scope and window: the verdict as a dot and
  a sentence, a key-value grid, the three share rows, spend per week as stacked bars (spent, and what the session's
  model would have added), the table of moves with a total, and the closing line. In the card's words: "Per
  success", "Right first time", "Redone", "Moved to a cheaper model", "Moved to a stronger model". The card's header
  summary stays as it is.
- With no task to compare, every surface says in one line that savings are measured for tasks started from release
  0.7.0 on.

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
   follows this order. The judge's four tiers map to `fast` = `haiku`, `balanced` = `sonnet`, `frontier` = `fable`, `deep` = `opus`;
   the judge reaches `fable` only for `design-open` work, at its own confidence bar (`model-router.md`). A full model id maps to its family; an id outside
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
  (`SendMessage`) stays one task: its latest report gives the cost and starts the window. A continuation inside the
  rework window of an earlier report is a rework signal (`continued after its report`): it is the correction that
  `choose-model` asks for instead of a new start, which the similar-start signal would have caught.
- **Compaction** is `scripts/compact.mjs` (Node, no dependencies), started by the mod at `session.start` through
  `$.process.run` without waiting, and by `model-router:report`. It writes the aggregates and `state.json` whole
  (temporary name, then rename) under `quality/.lock`. A stale lock is moved aside by a rename, which only one run
  wins, and a run removes only its own lock.
- **A run that dies is safe to repeat.** A task that already has an `outcome` record in the log is not decided
  again, and each aggregate file keeps the keys of the tasks it folded (for 90 days), so a repeated fold counts
  nothing twice. The live event log itself is only appended to (and renamed by a rotation).
- **A torn last line.** A line with no newline yet is not read; it waits for the next run. Compaction never
  appends after it: while the line changed in the last two minutes, another session may still be finishing it,
  and the run closes nothing (its tasks stay behind the offset and are closed, folded and appended by a later
  run). A torn line older than that has no writer left: the run ends it with a newline, so it stays one skipped
  line, and appends its outcomes after it.
- **Reading a long log.** Nothing reads `events.jsonl` whole. Compaction reads from its stored offset, one chunk at
  a time. The report and the usage view read the log in chunks too and keep only the records they show: outcomes and
  decisions, plus, for the view, this session's reports and the spawns of this session's project. Memory follows
  what is kept, not the size of the log.
- **Rotation** (from 0.3.11, `scripts/rotate.mjs`). The live log is never rewritten. When a run ends with
  `events.jsonl` at 32 MB or more (`rotateBytes`), it saves its state with the rotation pending, then renames the
  log to `archive/raw-<ms>.jsonl`; the next writer creates a new `events.jsonl`. A session that opened the log just
  before the rename still appends to the renamed file, so the rotation is finished by a later run, once the renamed
  file has not changed for two minutes (until then a run closes nothing): the records after the saved offset that
  compaction still needs (everything but decisions, outcomes and the records of tasks already closed) are carried
  into `events.jsonl`, and the renamed log is rewritten as `archive/events-<ms>.jsonl` with only what the readers
  keep (outcomes, decisions, spawns; prompts and other signals are dropped). A slimmed log rotated more than 90 days
  ago (`keepDays`) gives its outcomes to `archive/outcomes.jsonl` and is removed. The report and the usage view read
  `archive/outcomes.jsonl`, the rotated logs oldest first, then `events.jsonl`: every outcome is kept, so the
  all-time window and the trend stay whole; decisions count for the last `keepDays` of rotated logs plus the live
  log. A run that dies before the rename leaves the log in place (no rotated file: the saved offset is restored);
  one that dies after carrying records but before saving may carry them twice, which the outcome logic tolerates
  (one task per spawn, the latest report wins).
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
  whether it is about the task, and only for the prompts the outcome logic reads: the next two after a subagent of
  the session reports, inside the rework window. A prompt typed before any report, past the window or after those
  two is not stored. The count lives in the mod and starts over when the mod reloads. All of it stays under the
  config folder.

Not built in 0.2 (nor in 0.3):

- *Re-search* by reading the files a read-only subagent named: only the similar-start signal is measured.
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

## As built in 0.6

- **The starting session's model.** The spawn record and the outcome record carry `parentModel`, the model of the
  session or agent that started the subagent (`null` in records written before 0.6). A decision's `before` is the
  call's own model when the call names one, so without this field a start with an explicit model did not say
  whether it ran below, at or above the model it would have inherited. With it, the share of starts moved to a
  cheaper tier and their rework rate can be read from the outcome records alone.

## As built in 0.7

What *Savings* left open, and how the build settles it.

- **Modules.** `lib/savings.mjs` computes the model (numbers only), at the prices `lib/prices.mjs` fits; `lib/savings-text.mjs` holds the words and
  sentences the three surfaces share; `lib/card-savings.mjs` and `lib/report-savings.mjs` are the card's view and the
  page's section; the terminal's rows are in `lib/usage-view.mjs`. The windows and weeks moved from
  `lib/usage-data.mjs` to `lib/windows.mjs`, and the formatters from `lib/usage-view.mjs` to `lib/format.mjs`, so that
  the new modules import them without a cycle; both old modules still export them. `buildUsageData` adds
  `savings: { user, project }` to every window, so the terminal, the card and the page read the same model.
- **Tokens by kind.** The report record sums `input_tokens`, `output_tokens`, `cache_read_input_tokens` and
  `cache_creation_input_tokens` over the agent's requests into `usage` (`null` when the engine no longer lists the
  agent); the outcome keeps it only when all four counts are numbers of zero or more (`checkedUsage`), else `null`.
  Compaction, the slimmed logs and `archive/outcomes.jsonl` keep outcome records whole, so the field needs nothing
  more; the Log view does not show it.
- **The fit.** Least squares of the cost on the four counts, per million and each column scaled to unit size, solved
  by the normal equations with Gaussian elimination and partial pivoting. When rates come out negative, the most
  negative kind is set to 0 and the rest fitted again, one kind at a time. Two kinds the outcomes cannot tell apart
  (a pivot under 10⁻¹⁰ of the largest) give the tier no prices rather than a guess. The model's `rates` field keeps
  its name and holds the prices per tier, in dollars per million tokens of each kind.
- **Tasks compared** must also have a tier of their own among the four families. A kept task needs its parent's
  prices too, although its baseline is its own cost, so that every task compared went through the same rule.
- **Left out** counts the closed tasks of the window (not the cancelled ones) that cannot be compared.
- **Two more reasons for `not proven`**: at least 100 tasks compared and none right first time (`no-success`), and
  successes on tasks that carry no cost at all, so there is no baseline per success (`no-cost`).
- **A share or an amount below zero** is said in words, through the same phrases on every surface: `14% more` per
  success, `cost $0.160 more`. A week that cost more than its baseline is drawn as such: on the card its baseline in
  the spent colour with the excess above it in the context card's orange, named by a legend under the chart only
  then (the legend's bar shows the chart's colours in the proportion drawn, its rows carry no figures); on the page
  the two bars stand side by side, unclamped, and the tooltip says the week's saving; in the terminal each week's line
  ends with it.
- **The fixture** of the views' tests prices its costs at fixed list prices per tier with a mix of kinds that differs
  per task, and adds eight cancelled tasks 50 days old to the event log, so that opus and sonnet each have the eight
  recent outcomes a fit needs while no other figure changes.
- **The judge** counts the decisions of the window whose `judge` carries a time. A judge call that failed logs no
  answer, so its time is not in the log and not counted. At the project level, as for the headline, the decisions are
  those of the project's spawns.
- **Moves** are the pairs of different tiers, moves to a cheaper model first, each from the dearest parent; the kept
  tasks are a row of their own on the page and are not a move. The total of the moves is the baseline spent less the
  spent (kept tasks add nothing). The terminal and the card list at most 8 moves and the last 8 weeks.
- **The card's verdict** is a one-row table, the dot beside the verdict's word and the saved share at the right,
  followed by the sentence: the shared card kit has no dotted line, and adding one would change both plugins' copies.
- **Amounts** go through `fmtUsd`, as every other figure: three decimals (`$20.500`), not the mockups' two.
- **The tab and the view.** The terminal's tab is the last of the row; the card's view stands after Decisions.
