# The router mod and the quality loop

## 1. A start without a model is routed

- [ ] In a session on `sonnet`, ask for a read-only search through a `general-purpose` subagent with a description
      tagged `[mr:read-search]` and no model.
- [ ] `events.jsonl` gains a `decision` record (`action` `downgrade`, `after` the fast tier, `effort` `low`) and a
      `spawn` record with the same `agentId`.
- [ ] When the subagent ends, a `report` record follows with its status, tokens and cost.

## 2. Explicit and fixed models are left alone

- [ ] A start with `model: "opus"` keeps it; the decision says `explicit`.
- [ ] A project agent whose definition names a model keeps it; `Plan` and plugin agents are not routed.

## 3. Compaction and the report

- [ ] After the session ends (or the rework window closes), `node <plugin>/scripts/report.mjs --no-open` writes an
      `outcome` record per closed task and updates `quality/user.json` and `quality/projects/<id>.json`.
- [ ] A second run does not count a task twice.
- [ ] The report page opens, shows the cell with n, FPY and cost per successful task, and flags it as weak.
- [ ] `model-router:report` runs the script and answers with the page's path.

## 4. Command and switches

- [ ] `/model-router` opens the usage view as a dialog: 🧭 and the tabs on the first row, the active tab a teal
      block; the windows and `user · project` on the second, the active window a teal block; the KPI tiles,
      sparklines and tier·effort bars, then this session's subagents by model and its routing decisions by action;
      the footer `Tab/⇧Tab tab · ↑/↓ period · p level · o: report · r: refresh · Esc`.
- [ ] Without a click: Tab and Shift+Tab switch tabs and wrap at both ends; Down and Up step the window
      (7d, 30d, all, 24h) and the body does not scroll; `d`, `w`, `m`, `a` change the window; `p` switches to the
      project level; `r` refreshes; `o` opens the report page; Page Down scrolls a long tab; Esc closes the view.
- [ ] Left and Right do not switch tabs (the engine does not pass them to a plugin pane; Left at the prompt opens
      the agents view).
- [ ] The Classes tab under `a` shows the same FPY and cost per success as the report page.
- [ ] In a terminal under 60 columns, and with `claude -p "/model-router models"`, the command prints the rows as
      text instead; `/model-router weekly` prints the help.
- [ ] `/model-router off` stops routing for the session.
- [ ] With `measure` off, no line is written and routing still works.

## 5. Failing open

- [ ] With the judge's model set to an id that does not exist, a start without a model goes ahead unchanged and the
      log says `error`.

## Runs

| Date | Claude Code | Steps | Result |
|---|---|---|---|
| 2026-11-20 | 2.1.329 | 1, 3 (`claude -p`, twice) | Pass: `sonnet` lowered to `haiku` at `low`; decision, spawn, report, outcome and aggregate records written. Steps 2, 4 and 5 are covered by `claude plugin test` and the unit tests, not yet by hand. |
| 2026-11-20 | 2.1.329 | usage view (tmux, 160 columns) | Pass: `/model-router` opens the pane with four tabs; `3`, `a` and Tab switch tab and window. Left/Right went to the prompt, not the pane: the arrows are not documented as keys. |
| 2026-11-21 | 2.1.330 | 2 (tmux, `--plugin-dir`, the user-scope copy turned off with `enabledPlugins`; `haiku` session at low effort, auto mode) | Pass: `general-purpose` with `model: "sonnet"` gave `action` `explicit`, `reason` "the call carries a model", `after` `claude-sonnet-5-5`; the project agent `fixed-sonnet` (`model: sonnet`) gave `action` `keep`, `reason` "the definition fixes a model", `route` `fixed`, and ran on `claude-sonnet-5-5`. `Plan` and plugin agents not tried. |
| 2026-11-21 | 2.1.330 | 4, `/model-router off` (same session) | Pass: "Routing turned off for this session."; the next start without a model gave `action` `keep`, `reason` "router off", `route` `off`, `judge` null. |
| 2026-11-21 | 2.1.330 | 4, `measure` off (`--settings` with `pluginConfigs["model-router@inline"].options.measure` false; `sonnet` session at low effort) | Pass in default permission mode: the debug log says `[model-router] ready: routing on, measuring off`; `events.jsonl` kept its line count; the `[mr:read-search]` subagent ran on `claude-haiku-5-5` at `low` (its transcript). **Fail in auto mode**: the same start never ran. Tool result: `The server-side auto mode classifier gave no verdict for Agent: a hook changed this call's input after auto mode reviewed it, so the review does not cover what would run. … The hook produced this input: {… "subagent_type":"general-purpose","effort":"low"}`. The `effort` rewrite at `tool.call` on `Agent` blocks every routed start whose effort changes in auto mode, with `measure` on or off. |
| 2026-11-21 | 2.1.330 | 5 (`fastModel` `claude-nonexistent-0`; `sonnet` session, auto mode) | Pass: `decision` with `action` `error`, `reason` "judge: api-error", `before` and `after` `claude-sonnet-5-5`; the subagent ran unchanged and reported `completed`. |
| 2026-11-21 | 2.1.330 | 4, usage view keys and layout (tmux 150 by 45, `--plugin-dir`, `haiku` at low effort; docked in the fullscreen layout, and inline with `CLAUDE_CODE_NO_FLICKER=0`) | Pass: right after `/model-router 30d`, no click, `tmux capture-pane -e` shows `🧭 model-router` and `Overview` as `ESC[1;7m ESC[38;5;43m` (a teal block) and `30d` the same. Down: 30d → all → 24h; Up: back to all; the content header followed and the body stayed put. Tab: Models, Classes, Decisions, then Overview; Shift+Tab from Overview: Decisions, then Classes. `p` switched Classes to `project <repo>`. In a 20-row terminal Down still stepped the window and Page Down scrolled the Decisions list; Tab brought the tab row back into view. Inline, Down stepped the window too. Right did nothing; Left left the pane for the agents view (engine behaviour, spike S15). `claude -p "/model-router overview"` printed the tiles with ⚪ dots and the sparklines as text. |
