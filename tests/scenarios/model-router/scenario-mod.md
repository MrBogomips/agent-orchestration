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

- [ ] `/model-router` shows the latest decisions; `/model-router off` stops routing for the session.
- [ ] With `measure` off, no line is written and routing still works.

## 5. Failing open

- [ ] With the judge's model set to an id that does not exist, a start without a model goes ahead unchanged and the
      log says `error`.

## Runs

| Date | Claude Code | Steps | Result |
|---|---|---|---|
| 2026-11-20 | 2.1.329 | 1, 3 (`claude -p`, twice) | Pass: `sonnet` lowered to `haiku` at `low`; decision, spawn, report, outcome and aggregate records written. Steps 2, 4 and 5 are covered by `claude plugin test` and the unit tests, not yet by hand. |
