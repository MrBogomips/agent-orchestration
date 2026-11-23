---
name: choose-model
description: Picks the model and effort level for a subagent, a child session or a workflow of agents. Use whenever you are about to start a subagent, spawn or launch a session, run a workflow, delegate a task, or decide which model or effort a piece of work needs; session-hub:spawn loads it for child sessions.
---

# Choose the model and the effort

Apply this grid every time you start work on another model: a subagent, a child session, or the agents of a
workflow. Decide before the start, pass both values explicitly, and say what you chose.

## Before you start anything

- **Inline or delegate.** If the task is small and the files it needs are already in your context, do it
  yourself. A subagent begins with an empty context and reads everything again; you read your own warm cache at a
  fraction of that price. Delegate when the work is large, parallel, or would flood your context.
- **Continue, do not restart.** A follow-up on the topic of a subagent you already started goes to that subagent
  through the message tool (`SendMessage` with its id or name). Its context is intact; a new start would pay to
  rebuild it.

## Order of precedence

1. **An explicit choice by the user wins over everything**, including this grid and the project's defaults.
2. **The project's defaults.** If the project's instruction file (`AGENTS.md` or `CLAUDE.md`) has a *Model
   routing* section that names this kind of work or this class, use its model and effort.
3. **The grid below.**

**An agent definition that fixes its own model keeps it.** Unless the user names a model for it, whatever the
project's defaults or the grid say, never pass a model to such an agent: pass only the effort they give, and only
if its definition sets none. Whoever wrote the definition chose that model for that agent's work.

## The grid

### Model

Go down the table and stop at the first row that fits.

| Tier | Fits when | Examples |
|---|---|---|
| `haiku` | Simple, repetitive work whose result is easy to check, with no judgment calls. | List or summarize files; run a single command; rename a symbol; apply the same edit in many places |
| `sonnet` | What done looks like fits in one sentence. | A well-specified change across a few files; tests for existing code; a bug whose cause is described |
| `fable` | Large **and** open-ended work where judgment and accuracy really matter. Both must hold. | A complex design; an architecture decision with long-lasting consequences |
| `opus` | Everything else, and any time you hesitate between two tiers. | A review; debugging when the cause is unknown; most coordination work |

The tier names are aliases; which model sits behind each one is configuration, not part of the grid. By price,
cheapest first: `haiku` < `sonnet` < `opus` < `fable`. "One tier up" follows this order.

### Effort

Ask in order and stop at the first yes.

1. Is it a simple task or a quick exchange? → `low`
2. Is it long, hard and critical, **and** does it run unattended? All three. → `xhigh`
3. Would an unnoticed mistake cost money, a client or a wrong decision? → `high`
4. None of the above. → `medium`

Never `max`.

### Task classes

Name the class of every subagent you start. It lets the quality loop measure how well each choice worked.

| Class | Covers |
|---|---|
| `read-search` | find files, symbols or facts |
| `read-analyze` | read and conclude: explain, compare, summarize |
| `edit-mechanical` | repetitive edits that are easy to check |
| `edit-specified` | a change whose done-state fits in one sentence |
| `review-debug` | review, or debugging with an unknown cause |
| `design-open` | open-ended design where judgment matters |

When none fits, pick the closest one; do not invent a class.

## Rules around the grid

- **In doubt, go up.** Work that gets too small a model or too little effort costs more in rework than the
  saving.
- **Risk belongs to the act, not the topic.** Changing production, moving money, or altering data that cannot be
  restored is risky. Writing or testing code that deals with such things is not. A risky start gets at least
  `high` effort and the `!` marker on its tag.
- **Sessions: choose at the start.** Never change the model of a session that is already running.
- **Escalate on failure, one step at a time.** First retry with specific feedback on what was wrong. If it fails
  again, raise the effort one level (`low` → `medium` → `high` → `xhigh`). If it still fails, start a new
  subagent or session one tier up, with a handoff that says what was tried and why it was rejected.
- **A coordinator's own model.** A session that mostly hands work to subagents with fixed models needs judgment,
  not volume: `opus` at `medium`, unless the design work it does itself is hard.

## Quality hints (optional)

If the file `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/model-router/quality/recommendations.json` exists, read the
entry for the task's class under `classes` and treat its `tier` (a row of the model table) and its `effort` as a
hint measured on past work; `source` says whether the entry comes from `data` or repeats the `grid`. It never
overrides the order of precedence above, never lowers the grid's tier or effort for `review-debug` or
`design-open`, never goes below the project's defaults, and does not apply to a risky start. If the file is
missing, unreadable, or has no entry for the class, use the grid alone and do not mention it.

## What to pass and what to say

For each start, write one line before it: 🔀, the model, an effort bar of four cells (`▰` filled, `▱` empty:
`low` one, `medium` two, `high` three, `xhigh` four), the effort, `->` and the reason in under 12 words.

```
🔀 opus ▰▰▰▱ high -> review with unknown cause, going up
🔀 haiku ▰▱▱▱ low -> mechanical rename, easy to check
```

With the model-router mod on, the same line is also drawn under the `Agent` call's row, with the model and effort
the subagent actually got. Where the system prompt has a model-router section saying that the app draws this line,
do not write it before an `Agent` call; still write it before a child session or a workflow.

**Subagents.** Pass `model` and `effort` on the start call itself (the `Agent` tool takes both). Begin the
`description` with the class tag, adding `!` when the start is risky:

```
[mr:read-search] Find callers of parseConfig
[mr:edit-specified!] Rotate the production API key
```

For an agent whose definition fixes the model, omit `model`, keep the tag, and pass `effort`.

**Child sessions.** When `session-hub:spawn` (or another launcher) loads this skill, apply the grid to the
child's handoff and return the model and the effort; the launcher puts them on the launch command
(`--model <tier> --effort <level>`) and states them in the handoff.

**Workflows.** Choose for each agent of the workflow separately, as for a subagent, and write one line per agent.
