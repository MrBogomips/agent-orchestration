# Changelog

What changed in each release of `session-hub` and `model-router`. Each plugin has its own version; releases are
listed newest first. The format follows Keep a Changelog, and both plugins use semantic versioning.

## session-hub 0.4.1

2026-11-22 · pull request #77

### Fixed

- The start line now shows in the Claude desktop app too. There, `session-hub:spawn` starts a child with the app's
  `start_session` tool instead of a launch command, so no line was drawn: the line is now read from that call's
  input (its `name` and `model`; the tool takes no effort, so the line says `default`) and drawn under its row.

## model-router 0.3.11

2026-11-21 · pull request #76

### Fixed

- The event log no longer only grows (#50). Compaction rotates `events.jsonl` into `<config dir>/model-router/archive/`
  once it reaches 32 MB, without rewriting a log another session may be appending to: the log is renamed, and the
  rotation is finished two minutes later, when the records of tasks still open are carried into the new log and the
  rotated one is slimmed to outcomes, decisions and starts (the stored prompt text is dropped). After 90 days a
  rotated log keeps its outcomes only. The report and `/model-router` read the archive too: every outcome stays in
  the all-time window and the weekly trend.

## session-hub 0.4.0

2026-11-21 · pull request #74

### Added

- `scripts/launch.mjs` reads how the session was started: the identity variables its launcher set (`HOME`,
  `CLAUDE_CONFIG_DIR`, `SHALLOW_PROFILE`, the `XDG_*_HOME` folders), the configuration flags of its `claude` process
  and whether it bypasses permission prompts. It prints named variables only and lists what it is unsure of.
- *Child sessions* keys: `Permissions` (`ask` or `inherit`) and `Carry` (names of more variables to take from the
  master's launch). `setup` proposes them.
- A child that runs under another configuration folder than its master says so in its scope line and in
  `/session-hub`.

### Fixed

- A master started through an alias or a wrapper started children under the account's default profile: another
  subscription, other settings, no messages between the sessions. `spawn` now builds every start from
  `launch.mjs`, carries a wrapper's profile variable too, checks after the start that the child is listed, and its
  description covers sessions started outside a hub (#72).
- With `Permissions: inherit`, children of a master that bypasses permission prompts start in the same mode without
  a question at every start (#72).

## session-hub 0.3.2

2026-11-21 · pull request #71

### Fixed

- A child may not write the repository's Claude Code settings, `<root>/.claude/settings*.json`: their `env` and hook
  settings turned the guards off at the child's next start. The scope guard and the shell check block it and send
  the change to the master (#56).
- The children record can no longer land inside the hub: every path is judged where it really lands, the default
  path included; a write with `--file` needs `--hub`; a relative `CLAUDE_CONFIG_DIR` is refused (#28).
- The registry script refuses an option a command does not take, a repeated option, and `--live` with
  `--live-none`; `status` takes `--reason` (#27).
- A child started under the name of a finished one gets a fresh entry, and spawn no longer reuses such a name (#29).
- A stale lock is taken over atomically, and a lock whose writer has ended is cleared at once (#33).
- tmux: the child's command is given to tmux as arguments, so a JSON `--settings`, a `$` or a backtick in a carried
  flag reaches the child as written (#30); the child is named by the pane option `@session_hub_child`, since Claude
  Code overwrites the pane title (#31).
- spawn no longer writes a hub's `## Child sessions` section when it is missing, and `Guards` is described as turning
  off all three guards (#32).

## session-hub 0.3.1

2026-11-21 · pull request #70

### Fixed

- The shell check reads `find`. The command of `-exec`, `-execdir`, `-ok` and `-okdir` is judged like a wrapped
  command, with `{}` standing for the starting points; with `-execdir` only its absolute targets and its `{}` are
  judged, since it runs in each file's folder. The file of `-fprint`, `-fprint0`, `-fprintf` and `-fls` is a write
  target, and with `-delete` the starting points are, as for `rm`.

## model-router 0.3.10

2026-11-21 · pull request #69

### Fixed

- The effort question for `xhigh` (long, hard, critical and unattended) is asked before the one for `high`. A
  critical task almost always also answers yes to the `high` question, so `xhigh` was practically unreachable.
- An agent definition is no longer read from a file that declares another agent's `name`. Claude Code names an
  agent type after its frontmatter `name`, not its file, so such a file could make an agent with a fixed model
  look routable; the start is now kept.

## session-hub 0.3.0

2026-11-21 · pull request #68

### Added

- The children panel is drawn with `model-router`'s look: the model bold in its tier's colour, the effort as a
  four-cell bar and a word in its level's colour, the record and live statuses in the theme's success, warning or
  error colour, the header and the notes dim.
- A start line under each `Bash` call that starts children in a master: `⎿  🔀 opus   ▰▰▰▱ high   -> <child>`, one per
  child, read from the launch command of `spawn` (plain, `tmux send-keys` or `herdr agent start`).
- `tests/validate.sh` fails when session-hub's copy of the shared colours differs from `model-router`'s.

### Changed

- The `/session-hub` table shows the effort as the bar and the word (`sonnet ▰▰▱▱ medium`) instead of
  `sonnet/medium`.
- Manual and site screenshots of the panel and the table retaken.

## model-router 0.3.9

2026-11-21 · pull request #67

### Fixed

- A batch of similar starts on different files (rename in `a.ts`, then `b.ts`, then `c.ts`) is no longer scored as
  rework: a similar start is a redo only when it names a file the task wrote or the same files. A correction sent
  to the same subagent inside the rework window of its report is now a rework signal.
- The usage view measures text in terminal columns: wide characters and emoji in a project root or a model id no
  longer push rows past the pane, and a cut never splits a character.
- The event log is never read whole: compaction reads from its offset in chunks, and the report and the usage view
  keep only the records they show. A log past 2 GB no longer breaks them. Old events are still not rotated.
- Only the prompts the outcome logic reads are stored: the next two after a subagent's report, inside the rework
  window. Before, every typed prompt was kept, also in sessions without subagents.
- `choose-model`: the shape of `quality/recommendations.json` is fixed (`classes.<class>` with `tier`, `effort`,
  `source`, `n`) and the skill names those fields. An agent definition that fixes its own model is an exception to
  the project's defaults and the grid, no longer a rule between them that contradicted the first.

## session-hub 0.2.5

2026-11-21 · pull request #61

### Fixed

- The shell check reads a command as bash and zsh do where it used to let a write outside the write root through:
  `<>`; `<<` inside arithmetic, which hid the rest of the command as a here-document; `$'…'` quoting; zsh's `>!`,
  `>>!`, `&>!` and `&>>!`, `noglob`, `nocorrect`, `-`, `repeat N` and `=command`; `coproc`. Also, found in review:
  `<<` in `((…))` after a reserved word, in `$[…]` and in an array subscript; zsh's `>&|` and `>&!`; brace
  expansion; a `cd` at the end of a zsh pipeline; `chdir`; zsh's `always`; `env -S` and `env -P`; `sed -l`, `cp -S`
  and `install -S`, which take no value on macOS.
- Inputs built to make the check run for seconds or out of memory (nested failed arithmetic, links that share a
  name, a long run of relative `cd`s) end quickly; past a bound the command is denied.
- The commands inside backticks, inside `$(…)` in double quotes, `${…}` and arithmetic, inside `<(…)` and `>(…)`,
  and in the body of a here-document whose delimiter is not quoted are judged. So is the literal line given to
  `eval` or to `sh`, `bash`, `zsh`, `dash` or `ksh -c`.
- A here-document whose delimiter never comes, and any command the check cannot read, is denied with the reason.
- A target whose name starts with `&` is judged; only descriptor words such as the `&2` of `>&2` are dropped.
- The shell check refuses the write roots the scope guard refuses: `/`, the home folder, and a root that is not an
  existing folder. Both use the same rules.
- A hard link (`ln`, `cp -l`) to a file outside the write root is denied, and a write through a symbolic link made
  in the same command is judged where the link points.
- The scope guard blocks a write to a file with more than one hard link, since another name of the file may be
  outside the write root. A file inside the root with a second hard link can no longer be edited in a child.

## model-router 0.3.8

2026-11-21 · pull request #59

### Fixed

- A risky `!` tag counts whatever its class, case or spacing: `[mr:migration!]` (a class not in the grid),
  `[MR:edit-specified!]` and `[mr: read-search !]` now send the start to the deep tier with at least `high` effort.
  Before, such a start could go to the fast tier.
- Compaction no longer appends outcomes after a torn last line of `events.jsonl`, which lost them and later closed
  the torn task as `cancelled`. While the torn line is recent the run closes nothing and the next run does it; a
  torn line older than two minutes is ended with a newline first.
- Each hook that fails writes one debug line, `[model-router] <hook>: <error>`, before going on unchanged. At
  `agent.spawn`, an unreadable grid or project no longer loses the spawn record: it is written without them.
- The cost and token means of a quality cell count only the outcomes that carried a cost or a token count (new
  `costN` and `tokensN` weights, aged with the cell), and a class summary weighs each cell's means the same way.
  Before, tasks with no cost pulled the means down.
- One outcome with an unreadable time no longer makes the report fail with `Invalid time value`: it is skipped.
- The Models tab counts the closed tasks the KPI tiles count; cancelled tasks are left out of its counts, tokens and
  cost.
- A remote URL that names a port (`ssh://git@github.com:22/o/r`, `https://github.com:443/o/r`) gives the same
  project id as the other spellings; in the scp form (`git@github.com:1234/r`) a numeric owner is kept. A project
  whose remote named a port gets a new id once, and starts its project level afresh.

## model-router 0.3.7

2026-11-21 · pull request #18

### Changed

- README: the privacy line no longer says that nothing leaves the machine; the judge's one call goes through the
  session's own client. The repository home page now leads with what each plugin does.

## model-router 0.3.6

2026-11-21 · pull request #17

### Fixed

- `report.mjs`, `usage.mjs` and `compact.mjs` run when the plugin path passes through a symbolic link. Before,
  they exited with no output and the report key logged an empty path; an empty path from `report.mjs` now counts
  as a failure.

## model-router 0.3.5

2026-11-21 · pull request #16

### Changed

- The report path is written as a line in the session instead of a toast.

## model-router 0.3.4

2026-11-21 · pull request #15

### Added

- The choose-model line `🔀 opus ▰▰▰▱ high -> reason`, with a four-cell effort bar.
- With the mod on, the same line drawn in colour under each `Agent` call's row, with the model and effort the
  subagent actually got and the routing reason; the row is drawn alone on any error.

### Changed

- 🔀 becomes the plugin's mark in the usage view, its answers, the help and the report page title.
- Manual screenshots retaken with demonstration data.

## model-router 0.3.3

2026-11-21 · pull request #14

### Added

- KPI tiles in Overview (first-pass yield, cost per success, rework, routed starts) with changes against the
  previous window and status dots; sparklines and FPY bars coloured by threshold.

### Changed

- The usage view follows Claude Code's Settings dialog: a tab row, a window and level row, a footer of key hints.
  Tab and Shift+Tab switch tabs, Down and Up step the window, with no click needed.

## session-hub 0.2.4

2026-11-21 · pull request #13

### Added

- A user manual for both plugins, as a PDF built from `docs/manual/manual.html`, with screenshots.

### Fixed

- `/session-hub` names the hub and the record path separately.

## model-router 0.3.2

2026-11-21 · pull request #12

### Fixed

- Routing works in auto permission mode. The subagent's effort is set on each of its model requests, never on the
  `Agent` call, which the engine refused to run after a hook changed it.

## session-hub 0.2.3

2026-11-21 · pull request #11

### Fixed

- The shell check follows `cd` and `pushd` to a literal folder, so `cd <root> && echo x >> link/f` is judged
  where the link lands.
- A denial names where a linked path resolves.

## session-hub 0.2.2 and model-router 0.3.1

2026-11-21 · pull request #9

### Changed

- session-hub: skill review of `dispatch` and `spawn`; the children record commands and rules move to a reference
  both skills read; the idle notice is renewed after each notice.
- model-router: the report skill suggests `/model-router report`, says a rerun is safe and lists cancelled tasks as
  not learned.

## session-hub 0.2.1 and model-router 0.3.0

2026-11-20 · pull request #8

### Added

- model-router: `/model-router` opens a tabbed usage view (Overview, Models, Classes, Decisions) on the same
  aggregation as the report page, with a text fallback where no pane fits.
- session-hub: `/session-hub help`; the command's answers are for the person only.

### Fixed

- model-router: argument lookup, a distinct report error, one refresh at a time.

## session-hub 0.2.0

2026-11-20 · pull request #7

### Added

- The `session-hub` mod: the send guard, a best-effort shell check on `Bash`, origin marking of messages from
  other sessions, the scope line, the children panel and the `/session-hub` command.

### Fixed

- Gaps found in review of the mod guards: here-documents, line continuations, `Monitor` commands, links and `..`
  in the shell check; delivery of `name [ref]` to the bare name in the send guard.

## model-router 0.2.0

2026-11-20 · pull request #6

### Added

- The router mod: a judge for subagent starts that carry no model, the event log and `/model-router`.
- Compaction of the quality loop and the local report page; the `model-router:report` skill.

### Fixed

- Compaction reruns are safe, a stale lock is taken over, the options are saved for compaction, and resumed
  sessions close their tasks at the next end.

## session-hub 0.1.0

2026-11-20 · pull request #4

### Added

- The `spawn`, `dispatch` and `setup` skills.
- The scope guard hook for child sessions.
- The children record helper, with a lock and atomic writes.

### Fixed

- The scope guard is hardened against relative paths, roots that are too wide, role spelling and timeouts.

## model-router 0.1.0

2026-11-20 · pull request #3

### Added

- The grid, with `grid.json` as its single source, and the `choose-model` skill.
- The `setup` skill for a project's `## Model routing` section.
