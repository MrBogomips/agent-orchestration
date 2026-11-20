# Reference pack: third-party mods for model selection and handoff

A collection the user saved as reference material on 2026-11-20:

a local folder of the maintainer (`$REFERENCE_PACK_DIR`; not distributed)

| File | Content |
|---|---|
| `benai-mods.zip` | 9 mods: brain-dump, helper-desk, cache-clock, handoff, reflect, chat-inventory, screen-share, replay-theater, mods |
| `claude-model-selector-mac.zip` | 4 mods: model-selector, model-router, handoff, cache-clock |
| `claude-model-selector-windows.zip` | the same, plus Windows code |
| two `.mhtml` files | the saved web pages that describe the packs |

Read entries without extracting: `unzip -l <zip>`, `unzip -p <zip> <entry>`.

**Licence.** Only two mods carry a licence: `model-router` (MIT, a copy of a public router; author in its
`LICENSE`) and `replay-theater` (Apache-2.0, a published sample). Treat everything else as "all rights reserved":
read it for ideas, do not copy it. This file summarizes in its own words.

**Scope.** The pack is about one session and its subagents. Nothing in it coordinates several sessions across
repositories. Its figures (prices, thresholds, token limits) are dated or untested by its own account.

## Model selector (main session)

`claude-model-selector/plugins/model-selector/hooks/register.tsx`

- Before each prompt typed by a person, a mid-tier model classifies it as task, follow-up or failure and picks a
  model and an effort.
- It changes the model only on the first three prompts of a chat and only the effort afterwards, because a model
  change later discards the prompt cache.
- A manual pick by the user always wins.
- The grid: smallest model for simple, repetitive, easily checked work; mid tier when "done" fits in one
  sentence; top tier only when the job is big, open-ended and accuracy matters; the tier below the top for
  everything else and whenever unsure. Effort: low for back-and-forth or simple tasks; high when a hidden mistake
  would be costly; extra high only for long, hard, critical work run unattended; medium otherwise; never the
  maximum.
- On repeated failure it climbs a ladder: resend with specific feedback; raise the effort; raise it again; hand
  off to a new chat one model up at a lower effort.
- The handoff it writes starts with one line naming the model and effort for the new chat. In the new chat the
  same mod reads that line on the first prompt and holds those values on every step.
- It routes only prompts a person typed. Notes from other sessions, tasks and schedules keep the model.

Ideas taken into the design: the grid, the choose-at-start rule, the escalation ladder.

## Subagent router

`claude-model-selector/plugins/model-router/hooks/{model-router.ts,policy.ts}` (MIT)

- At `agent.spawn`, a judge on the smallest model returns a tier (fast, balanced, deep), a confidence, an effort
  and a risk score.
- Asymmetric bars: a downgrade needs confidence 0.6, an upgrade 0.3. A missing confidence never lowers the model.
- Risk above 0.7 forces the deep tier. Risk is defined on the act (changing production, moving money, altering
  unrecoverable data), not on the topic; the code comments say an earlier wording scored a harmless coding task
  as highly risky.
- Forks and resumes are never re-routed.
- The task text is wrapped as data, with an instruction not to follow anything inside it.
- Fail open: an error, a timeout (8 s) or an unreadable answer leaves the request unchanged.
- It logs a "ready" line at load and the first firing of each hook, so a router that never loaded can be told
  from one with nothing to do.
- It keeps a ledger of estimated savings.

Known weaknesses, some stated by its authors:

- It does not see a model fixed in an agent's definition, so its "would have run on" value, and its savings, can
  be wrong.
- "Haiku's confidence is its own estimate. It is not calibrated."
- It states that the tool that starts subagents takes no effort; in Claude Code 2.1.329 it does.

Ideas taken into the design: act only where the agent made no choice, the asymmetric bars, the risk rule, fail
open, the ready line, a decision log (without savings).

## Handoff

`benai-mods/plugins/handoff/hooks/register.tsx`

- Gathers the files used (reads, writes and paths in shell commands, weighted), the skills and connectors used,
  links, and the last user prompts; saves a fallback draft first; has the model write the handoff; removes
  secrets by pattern; saves the file; reads it back to check the write.
- Sections of the prompt it asks for: what the user asked for (each marked done, in progress or not started),
  where things stand, rules the user set, files to open first, skills and tools to use, errors already solved,
  carried-over data, next steps.
- Content rules worth keeping: paths only, never file content; do not repeat what the new session loads by
  itself; carry over only data that exists nowhere on disk, verbatim; never a secret, say where it lives; a word
  limit.

Ideas taken into the design: the content rules for the child handoff.

## Conventions between mods

The mods talk through files in the config folder, not by calling each other: a shared switches file re-read on a
timer, empty marker files that ask a session to act, a plan file where the newest writer wins. One note is
relevant to the decision log: the mod file API has no append, and read-then-write "can drop another mod's line",
so they append through a shell `cat >>`.

## Other notes

- `helper-desk` tracks subagents through `agent.spawn` and a polled `$.agent.list()`, and shows one card each.
  It is the closest thing to a children panel, but it lists subagents, not peer sessions.
- `cache-clock` lists the prompt origins it treats as background traffic; the full list is in
  `mods-capabilities.md`.
- The new-chat link the handoff mod uses cuts the prompt at about 14,000 characters and is undocumented.
