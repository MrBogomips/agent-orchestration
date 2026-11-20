---
name: report
description: Builds and opens the local model-router quality report, a page showing for each task class and each model and effort how often subagent work was right the first time, how often it was redone, and what it cost per successful task. Use when the user asks for the model-router report, routing or quality statistics, how well model or effort choices worked, rework rates, or the cost of subagents per model.
---

# Show the model-router quality report

The report reads the quality data that the `model-router` mod records under the active config folder. A script
computes every number; do not compute or estimate figures yourself.

## 1. Run the script

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs"
```

It compacts the event log first (closes the tasks whose rework window ended), writes
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/model-router/report.html`, opens it with `open` on macOS or `xdg-open` on
Linux, and prints the page's path. Add `--no-open` when the user only wants the file, or when no browser can be
opened (a remote or headless session).

If `CLAUDE_PLUGIN_ROOT` is not set, the script is in the installed plugin's folder: find it with
`claude plugin list` or under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/`.

## 2. Answer

Give the user the absolute path of the page and, in two or three lines, what it covers. If the script printed an
error, show it and say that no data was changed: the event log is never rewritten.

When the page has no data yet, say why it may be empty:

- the mod records only when its `measure` option is on (the default) and the Claude Code version runs mods
  (2.1.329 or later);
- a task counts only once its rework window (`reworkWindowMin`, 30 minutes by default) has closed or its session
  has ended;
- tasks without a class (`[mr:<class>]` tag or the judge's answer), risky tasks and tasks on unknown models are
  measured but not learned.

## Limits

- Release 0.2 measures only. The page shows a recommendation per class, but the router does not act on it.
- Read-only classes and cells with fewer than five tasks are weak signals; the page flags them.
- Nothing leaves the machine. Share the page only when the user asks.
