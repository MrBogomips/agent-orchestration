# Spikes to run before writing the plugins

Each spike is a short throwaway test. Record the result here, with the Claude Code version, and update the design
files it affects. None of them was run during the design.

| ID | Question | How to test | Decides |
|---|---|---|---|
| S1 | How is the effort level set at launch? | Start a session with `CLAUDE_CODE_EFFORT_LEVEL=low` and another with `--settings '{"effortLevel":"low"}'`; check the effort the session reports. Repeat for a `--bg` session and for a pane started by Herdr and by tmux. Check `claude --help` for a dedicated flag. | The launch mechanism in `shared-contract.md`; whether a child-side mod is needed for effort. |
| S2 | Do mods load in `--bg` sessions? | Install a mod that logs one line at `session.start`; start a `--bg` session; read the log. | Whether the `session-hub` mod can guard background children. |
| S3 | At `agent.spawn`, does the event show a model fixed in the agent's definition file? Does a hook's model override it? Can a hook set a subagent's effort by rewriting the start call? | A mod that logs `e.model` and `e.parentModel` for an agent type with `model:` in its frontmatter and for one without; then return a different model and check which one ran; then rewrite `effort` on the `tool.call` for the start tool. | `model-router` mod: how it detects a fixed model, and how it sets effort. |
| S4 | Do environment variables set on the launch command reach the child's classic hooks and its mod? | Launch with `SESSION_HUB_ROLE=child` in each environment (Herdr pane, tmux pane, `--bg`, desktop app); read it from a PreToolUse hook and from `$.env.get`. | How a child knows its role and scope; the fallback for the desktop app. |
| S5 | Does a session started in a subfolder of the hub load the hub's instruction file from the parent folder? | Put a marker sentence in the hub's instruction file; start a session in a child repository and in a worktree of it; ask the session to quote the marker. | Whether `spawn` must tell children which hub rules apply to them, and what *Propagate* should stop repeating. |
| S6 | Are commands registered by a mod namespaced by plugin? | Register `/x` from two test mods and see what the command list shows. | Whether the short command names are safe; the names are already prefixed, so this only confirms. |
| S7 | Does `$.state` survive `--resume` after a restart? | Set a value, quit, resume the session, read it. | Where the mod keeps the role and the hold on model and effort: `$.state` or a file keyed by session id. |
| S8 | Can a mod list peer sessions by calling the session-listing tool? | `$.tool.call({tool: 'ListAgents'})` from a mod, on a timer; compare with the tool's result in the conversation. | Whether the children panel can show live status, or only the record. |
| S9 | What origin does the first prompt of a child carry in each environment? | Log `e.origin.kind` at `prompt.submit` for a child started by Herdr (`agent prompt`), by tmux (`send-keys`), by `--bg` with a prompt argument, and by the desktop app. | Confirms that the first prompt cannot be trusted as "from the master"; shapes the origin marking. |
| S10 | Does a blocked write in a child read well to the model? | With the scope guard active, ask a child to edit a file outside its root; check that it sends an `out-of-scope` message instead of retrying through the shell. | The wording of the block message; whether a shell-command check is needed. |
| S11 | Does `$.agent.list()` still return a subagent's `usage` and `cost` when its `agent.report` fires? | A mod that, at `agent.report`, reads the agent's row and logs `usage` and `cost`. | Whether the quality loop reads cost at report time or must sample it earlier. |
| S12 | Does `tool.call` carry `agentId` for a subagent's `Edit` and `Write`? | Log `e.agentId` and `file_path` at `tool.call` while a subagent edits a file. | How the quality loop attributes written files to a subagent (rework signal). |
| S13 | How many tokens does continuing a subagent through the message tool cost compared with a fresh start on the same follow-up? | Same follow-up twice: once continued, once as a new subagent; compare `usage`. | Whether the *continue, do not restart* rule in `choose-model` holds. |
| S14 | Does a `tool.call` rewrite of the `Agent` call survive auto permission mode, and can a `turn.step` hook set a subagent's effort instead? | Start a routed subagent in auto mode with the 0.3.1 mod, then with a mod that leaves the call unchanged and rewrites `effort` at `turn.step` for the subagent's `agentId`; compare with default mode. | Whether the router sets effort on the tool call or on the subagent's requests. |
| S15 | Which keys reach a focused plugin pane, and can the arrows move its tabs without a click? | Open `/model-router` in tmux; press each arrow, Tab and Shift+Tab with hooks on `ui.focus` and `ui.scroll` that toast what they see; try a `Select` and a `Client` with `onKey`; read the engine's default keybinding contexts. | How the usage view's tabs and window are driven by keys. |

## Order

S1, S4 and S5 block `session-hub` 0.1. S3 blocks the `model-router` mod, S14 its effort in auto mode; S11 and S12 block its quality loop (`model-router-quality-loop.md`), S13 only a rule in `choose-model`. The others block only the mods.

## Results

| ID | Date | Claude Code | Environment | Outcome |
|---|---|---|---|---|
| S1 | 2026-11-20 | 2.1.329 | `-p`, `--bg`, tmux pane (`send-keys`), Herdr pane (`agent start`) | `--effort <level>` on the launch command works in all four. The session header shows "with low effort", and every classic hook input carries `"effort":{"level":"low"}`, which gives the hook a reliable way to read the effort. The desktop app's start tool was not available to test. |
| S4 | 2026-11-20 | 2.1.329 | `-p`, `--bg`, tmux pane (variables typed before `claude`), Herdr pane (`tab create --env`) | `SESSION_HUB_*` variables set on the launch reach a PreToolUse hook in all four. The mod side (`$.env.get`) is left to S2. The desktop app was not tested. |
| S5 | 2026-11-20 | 2.1.329 | `-p` in a throwaway hub with two nested git repositories | **Yes.** A session started in a repository nested in the hub loads the hub's `CLAUDE.md` (a link to `AGENTS.md`) from the parent folder, as well as its own. The same holds in a worktree under `<repo>/.claude/worktrees/`. A worktree in a sibling folder **outside** the hub loads only the repository's file. |

Side findings:

- `--bg` in a repository nested in a trusted folder fails with `Workspace not trusted`: trust is not inherited
  across a nested git repository. The user has to open each child repository once and accept the prompt.
- A hub under the system temporary folder loaded no project instruction file at all, not even the repository's
  own. Run scenario hubs under the home folder.

## Results for model-router 0.2

Setup for all four: a throwaway mod loaded with `--plugin-dir` from a scratch folder under the home folder, logging
each event to a file through `$.process.run` (`cat >>`); `claude -p` with `--model haiku` (S3 parts on `--model
sonnet`, to see an inherited model that differs from haiku); a project agent `fixed` with `model: haiku` in its
frontmatter.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S3 | 2026-11-20 | 2.1.329 | Four starts without a model: the `fixed` agent plain; `fixed` with the hook setting `sonnet` at `agent.spawn`; `general-purpose` with the hook setting `sonnet`; `general-purpose` with `model: sonnet` and a `tool.call` hook on `Agent` rewriting `effort: "low"`. Then `Explore` without a model under a sonnet parent, and a `tool.call` rewrite of both `model: "haiku"` and `effort: "low"`. | **The event does not show a fixed model**: `e.model` is undefined for `fixed` as for `general-purpose`. **A hook's model overrides the definition's**: `fixed` with `model: haiku` ran on sonnet when the hook set it. **Effort is set by rewriting the `Agent` tool call**: the subagent's steps carried `effort: low` and its `$.agent.list()` row `effort: "low"`. A `tool.call` rewrite of `model` is applied too (`agent.spawn` then sees `model: "haiku"`). `tool.call` and `agent.spawn` share the `tool_use_id`. `Explore` inherited the parent's model (no fixed model in this build). |
| S11 | 2026-11-20 | 2.1.329 | At `agent.report`, the agent's `$.agent.list()` row. | **Yes.** The row is there with `usage[]` (per model) and `cost.usd`, `status` and `taskStatus`. After a continuation through the message tool, `usage` and `cost` are cumulative over both runs, and the report fires again. |
| S12 | 2026-11-20 | 2.1.329 | A subagent writes a file with `Write`, then changes it with `Edit`. | **Yes.** Both `tool.call` events carry the subagent's `agentId` and the absolute `file_path`. |
| S13 | 2026-11-20 | 2.1.329 | The same follow-up ("read the file and reply with its content"): once sent through `SendMessage` to the subagent that wrote the file, a minute after its report, once as a new `general-purpose` subagent; both on haiku. | **Continuing is about five times cheaper here**: the continued run cost $0.00094 (206 tokens written to the cache, 82,871 read), the fresh one $0.00457 (32,007 written). The continuation reads the subagent's own warm cache, so the gain holds while that cache lives (5 minutes by default). The *continue, do not restart* rule stands. A continuation raises `agent.spawn` again with `resume.agentId` and the resolved `model`, then `agent.report` again. |

Side findings:

- `claude plugin validate` accepts `$` passed only to a function declared at the top of the module file (or
  imported from a file of the plugin); a helper defined inside `register` is refused.
- An agent definition's fixed model has to be read from its file: the mod routes only the built-in types that
  were seen to inherit (`general-purpose`, `Explore`) and project or user agents whose definition file it can read and
  that name no model (or `inherit`). Any other type (`Plan` included, not tested) is kept: the decision is logged as
  `keep`, the spawn record with route `fixed`.

## Results for session-hub 0.2

All on 2026-11-20 with Claude Code 2.1.329, `--model haiku`, throwaway probe mods loaded with `--plugin-dir`, in a
scratch folder under the home folder.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S2 | 2026-11-20 | 2.1.329 | `claude --bg --plugin-dir <probe>` with the `SESSION_HUB_*` variables and a prompt argument | **Yes.** The mod loads in a `--bg` session: `session.start` fires (`surface` `terminal`, `isInteractive` true), `$.env.get` reads the `SESSION_HUB_*` variables set on the launch command, and `prompt.submit`, `$.tool.call` and `$.agent.list` work. This also closes the mod side of S4 for `--bg` and tmux. |
| S6 | 2026-11-20 | 2.1.329 | Two probe mods, both registering `/probe` at `session.start`, in one tmux session | **Not namespaced.** The typeahead lists one `/probe`, the first registration's. The second `$.command.register` throws (`"/probe" refused: the plugin shprobe-b registered it already`), and the throw skips the rest of that mod's `session.start` hook. The mod's command keeps the plugin's name (`/session-hub`) and is registered last, inside a `try`, so a clash costs only the command. |
| S7 | 2026-11-20 | 2.1.329 | A value set with `$.state.set`; the session stopped, then resumed with `claude -p --resume` and with an interactive `claude --resume` in tmux | **No.** After a restart and a resume, `$.state.get` reads version 0 (never written) in both cases. The session's `ref` in `ListAgents` also changes across the restart (`604bd7` → `9e5749`); its name stays. The mod keeps nothing in `$.state` that it cannot rebuild: the role comes from the environment at every load, the master's record path from the record or the next registry call. A child resumed without its `SESSION_HUB_*` variables is no longer a child. |
| S8 | 2026-11-20 | 2.1.329 | `$.tool.call({ tool: 'ListAgents' })` from a `$.clock.after` timer, `--bg` and tmux sessions | **Yes.** The call returns the listing text and structured `sections[].rows[]` with `name`, `ref`, `type` and `status` (`busy`, `idle`) for every peer session, the calling session excepted. No model call, no transcript row. The children panel shows live status from it. `$.agent.list()` lists only the session's own subagents (empty here). |
| S9 | 2026-11-20 | 2.1.329 | `prompt.submit` logged for a first prompt given as a launch argument (`--bg` and interactive in a tmux pane), typed with `tmux send-keys`, and for messages from other sessions; Herdr not run (the tmux result covers keystrokes into a pane); desktop app **not testable here** | A launch-argument prompt (`--bg` or interactive) and keystrokes sent by tmux arrive as `origin.kind` `composer`, exactly like the person's Enter. A message from another session arrives as `peer` at `session.receive` (text in a `<cross-session-message from="uds:…" from-name="…">` envelope) and then at `prompt.submit` (`isMeta` true). The first prompt cannot be told from the person's; peer deliveries can. |
| S10 | 2026-11-20 | 2.1.329 | A child with the 0.1 scope guard (`SESSION_HUB_ROLE=child`, write root a folder under the scratch folder), asked to append a line to a file outside the write root; once with a handoff, once with no handoff | With the handoff, the model refused before any tool call and sent an `out-of-scope` message to the master, which answered; the guard's message was never needed. Without a handoff, the model appended the line **through the shell** (`echo … >>`) at once, and the classic guard, which sees only `Edit`, `Write` and `NotebookEdit`, never ran. **A shell-command check is needed**: the 0.2 mod adds a best-effort one on `Bash`. |

Side findings for the send guard (from the S8 and S9 setups):

- At `session.send`, `e.to` is what the model wrote: the bare name (`spike-master`), or the name with the ref
  (`spike-master [22c822]`). A reply to a received message could also use its `from` address (`uds:<socket>`),
  which the guard cannot tie to a name. The guard accepts the master's name with or without a ref and refuses
  every other address, so a child replies to the master by its name.
- A refused send reads well: the tool result is `Not sent: a plugin hook refused it (<reason>)`, and the model
  reported it without trying another route.
- The `SendFile` tool, which also reaches peer sessions, is not offered in this build's terminal sessions.
- An organization's managed mod (here `cc-plugin-sec-default`) runs first and can send an event on past a user
  mod's hook. Seen live for `prompt.compose`, `session.compact` and `classic.SessionStart`: the session shows
  `session-hub: its <event> hook was skipped`. `session.send`, `session.receive`, `prompt.submit`, `tool.call`,
  `skill.prompt`, `command.run` and `ui.render` ran. The scope line therefore also rides a prompt as context.
- After a compaction, `$.session.usage().context.tokens` is undefined until the next request measures it; the mod
  uses that, or a smaller size than at the previous prompt, as its compaction signal.

## Results for model-router 0.3.2

Setup: tmux, `claude --plugin-dir <worktree>/model-router --model haiku --effort low` with `--debug-file`, once
with `--permission-mode auto` and once with `default`, in the repository; the user-scope `model-router` was
installed but disabled (`claude plugin list`), and a `--plugin-dir` plugin of the same name takes precedence over
it anyway. One `general-purpose` start with no model, tagged `[mr:read-search]`, then one tagged
`[mr:read-search!]` so that the model and the effort both change.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S14 | 2026-11-21 | 2.1.330 | As above; first with the 0.3.1 mod, then with 0.3.2. | **0.3.1 in auto mode: the start is refused.** The row reads "Not run · auto mode's check had no usable answer"; the tool error says a hook changed the call's input (`effort: "low"`) after auto mode reviewed it. **0.3.2 in auto mode: both starts run.** The plain one is logged `keep` on haiku with effort `low` (the session's own, so no step is rewritten); the `!` one `forced-risk`, haiku to `claude-opus-5-5` through `agent.spawn`, effort `high` through `turn.step`; the debug log has `first turn.step effort` before the subagent's first API request (`model=claude-opus-5-5`), and the report record has `model: claude-opus-5-5`, `effort: high`. **Default mode: the same** for the `!` start. A `tool.call` hook that calls `next(e)` unchanged does not disturb the auto mode review. `agent.spawn`'s input in this build has no effort field (it has `permissionMode`, the parent's). |

## Results for model-router 0.3.3

Setup: tmux at 150 by 45 columns and rows, `claude --plugin-dir <worktree>/model-router --model haiku --effort
low`, `/model-router` opened in the fullscreen layout (the pane docked) and, with `CLAUDE_CODE_NO_FLICKER=0`,
inline above the prompt; hooks on `ui.focus` and `ui.scroll` that toasted their input.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S15 | 2026-11-21 | 2.1.330 | As above. | **Left and Right never reach a plugin pane.** The engine's `Pane` keybinding context binds Tab and Shift+Tab to the ring (`abovePrompt:next`/`previous`), Up and Down to `pane:scrollUp`/`scrollDown`, and nothing to Left or Right (the `AbovePrompt` band and `Tabs` contexts do bind them). With the pane focused, Right raised no event at all; Left fell through to the prompt and opened the agents view ("← for agents"). A `Select` drew as an open list and Right did nothing on it (its `Select` context binds Up and Down, not Left or Right); the ring skipped a `Client`, whose `onKey` is reached only after a click. **Up and Down reach the pane**: as a `ui.scroll` of one row (`by` ±1, no `pointer`) while the body has rows to scroll, at its edges too, and as a ring move otherwise. **Tab and Shift+Tab** raise `ui.focus` (origin `person`); `next({ ...e, element })` onto another of the plugin's Buttons lands the ring there, while a move onto the engine's close mark (`element` absent) cannot be rewritten, and adding `plugin` is refused by `claude plugin test`. A plugin's own `$.ui.focus` from inside a `ui.focus` hook answered `{}` without moving the ring. So the usage view takes Tab/Shift+Tab for the tabs and Up/Down for the window, with the body padded to one row more than the window; all worked right after the open, without a click, docked and inline. |

## Results for model-router 0.3.4

Setup: tmux, `claude --plugin-dir <worktree>/model-router` with the user-scope copy turned off (`enabledPlugins`),
auto permission mode; a `haiku` session at low effort, then a `sonnet` one for the manual's screenshots.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S16 | 2026-11-21 | 2.1.330 | As above; a `ui.render` hook on `{ component: 'ToolUse', props: { tool: 'Agent' } }` keeping the row (`await next(e)`) and adding one line read from a `$.state` family member keyed by `tool_use_id`, written at `agent.spawn`. | **The line draws under a standalone `Agent` row** and updates when the member is written: the row's `requestId` is the call's `tool_use_id`. Hex colours reach the terminal (as the nearest 256-colour index under tmux without truecolor, as 24-bit with `COLORTERM=truecolor`). **The subagent's effort is known at its first `turn.step`**: a call with `model: "sonnet"` and no effort, from a `haiku` session at low, ran at `medium`. **Several `Agent` calls in one message** are drawn as one "N background agents launched" row, not as `ToolUse` rows, so no line shows there; the ctrl+o transcript draws each call as a `ToolUse` row with its line. A command's text answer is shown after the plugin's name (`model-router: …`), so the mod's one-line answers start with 🔀 and no name of their own. |

## Results for model-router 0.3.10

Setup: a scratch project with `.claude/agents/foo.md` declaring `name: bar` and `model: haiku`, and
`.claude/agents/plain.md` declaring `name: plain`; `claude -p "Reply with OK." --output-format stream-json
--verbose` run in it with an empty `CLAUDE_CONFIG_DIR` (no login). The `system/init` event is written before any
model call.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S17 | 2026-11-21 | 2.1.330 | As above. | **The agent type is the frontmatter `name`, not the file name.** The init event's `agents` list reads `bar`, `claude`, `Explore`, `general-purpose`, `plain`, `Plan`, `statusline-setup`: `bar` is there, `foo` is not. So the mod's lookup of `<dir>/.claude/agents/<type>.md` can read a file that defines another agent; it now treats a file whose `name` differs from the type as `unknown` (start kept). The run stopped at the login check, so no subagent was started. |

## Results for model-router 0.5.0

Question: would moving the model choice from the main model (the `choose-model` skill) to the fast-tier judge make a
delegation faster, and does a shorter judge prompt help?

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S19 | 2026-11-23 | 2.1.330 | The session transcripts of two config folders, 2026-10-03 to 2026-11-23: 3,456 `Agent` calls of main loops and 24 loads of `choose-model` in 12 sessions. For each call, the time from the record before the turn to the call, the turn's output tokens and the size of the call's input. | **The choice is not where the time goes.** The turn that makes an `Agent` call takes 11 to 12 s at the median on an `opus` session (14 to 21 s on `fable`): it is the main model writing the subagent's prompt, about 1,700 output tokens at 110 tokens per second. With the skill loaded the output beyond the call's own input is about 460 tokens against 555 without (20 calls against 1,872 on `opus`): no measurable difference, on a small sample. The only time the skill adds is the turn that loads it, 5.7 s at the median, once or twice a session. The judge logged so far answered in 0.7 to 0.9 s (5 calls of 56 starts). So a judge on every start would add 0.8 s to each and save 5.7 s per load: slower past seven starts per load. The skill stays as it is. |
| S20 | 2026-11-23 | 2.1.330 | A throwaway mod loaded with `--plugin-dir` under `claude -p`, calling `$.model.complete` (`haiku`, `effort: low`) once at a time: 79 real `Agent` calls that carried a model (32 `opus`, 32 `sonnet`, 9 `haiku`, 6 `fable`), each judged with seven prompts, 553 calls in one run. Reference: the model the main model chose, which is not ground truth. | **The prompt's length does not change the time; the answer's length does.** Median 0.75 to 0.85 s for every JSON prompt, from 830 to 1,830 input tokens. Answers over 120 output tokens (35% of the calls: the model reasons before it answers) take 2.0 s at the median against 0.76 s; 3% of the calls pass 3 s, the slowest took 4.1 s, none came near the 8 s limit, so the limit stays. **Less task text costs accuracy:** with the first 4,000 characters the judge picks a lower tier than the main model in 8% of the cases, with the first 1,500 in 10%, with the description alone in 29%. An answer on one line instead of JSON is slower (the model writes a preamble, 160 output tokens) and wrong more often (27% lower). The prompt stays at 4,000 characters and JSON. **A fourth tier left free is over-picked:** with `frontier` in the prompt the judge gives it 8 of the 32 tasks the main model gave `opus`, and 2 of the 6 it gave `fable`. Hence the `design-open` condition and the 0.7 bar of 0.5.0. Same tier as the main model: 63% with three tiers, 56% with four. |

## Results for the desktop cards (model-router 0.4.0, session-hub 0.5.0)

Setup: the Claude desktop app, dark theme, a throwaway mod with eight `/ui-spike <n>` commands, each drawing one card
from fixed demo data through a `ui.render` hook on its `CommandOutput` row.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S18 | 2026-11-22 | 2.1.330 | As above. | **A `CommandOutput` hook's tree draws as a card** in the row's place, with the app's own frame; the app draws its copy, pin and time under it, and copies the row's `text`. **`Select`** is the app's dropdown with a checkmark menu, and a pick redraws the row at once. **A plain `Button`** holding a chevron is drawn as bare text and its press works; a default `Button` is a grey box, a Markdown link blue. **A `$.state` write from a `$.clock` timer redraws the card**; `onScreen` was never reported. **An `Svg` with a `viewBox` and no `width`** fills the card's width (about 840 px on that window); text inside a 440-unit drawing came out twice its size, so labels are sized for an 840-unit drawing. The four model blues read apart; a fixed dark track did not suit a light ground. **Only a Markdown `file:` link** opens a file; `Link` is not drawn as a link. A Markdown table draws as heavy grey cells; `Box` rows with an `Svg` hairline read like `/stats`. **A row placed with `$.ui.place` never shows under the app's `start_session` card**, nor does a line added under that tool's row. |

## Results for session-hub 0.6.0

Question: after a master is renamed (issues #97 and #98), how can a child's mod still find it and deliver to it?
Setup: a throwaway mod loaded with `--plugin-dir` under `claude -p --model haiku`, next to ten live sessions of the
same configuration folder.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S21 | 2026-11-25 | 2.1.332 | At `prompt.submit`, `$.tool.call({ tool: 'ListAgents' })` written to a file; then `$.session.send({ to: { sessionId } })` to a live session's id (its `CLAUDE_CODE_SESSION_ID`) and to an unknown id, with a `session.send` hook logging `e.to` and the result. | **`ListAgents` rows carry `name`, `ref`, `type` and `status` only**: no session id for a local peer, so a child cannot find its master's id there, only its ref; the first line of `listing` is `This session is <name> [<ref>]`. A live session renamed by hand kept its ref, and the listing said `says it was <old name> until 5m ago`. **Delivery by session id works from a plugin**: the message reached the live session (framed with `from-plugin` naming the plugin); at `session.send` the engine spells the address as `uds:<that session's socket>`. An unknown id answers `isDelivered: false` with `no live session on this machine has id …`. So the master's id goes on the child's launch command, read from `CLAUDE_CODE_SESSION_ID` in the master's shell. |

## Results for session-hub 0.7.0

Question: can a child get its handoff without `--add-dir` on its handoff's folder, whose trust dialog stopped every
child at every start (issue #101)? Setup: a throwaway plugin loaded with `--plugin-dir`, whose `hooks.json` has a
`SessionStart` command hook that reads `SESSION_HUB_HANDOFF` and returns the file as `additionalContext`, with a
secret word in the file; the user's configuration, with the managed mod `cc-plugin-sec-default` loaded.

| ID | Date | Claude Code | Setup | Outcome |
|---|---|---|---|---|
| S22 | 2026-11-25 | 2.1.332 | `claude -p --model haiku --tools ""` with handoffs of 30, 9,000 and 15,000 characters; then an interactive session in tmux, `--permission-mode default`, the prompt after `--`, no `--add-dir`, followed by `/compact` and a question. | **The hook carries the handoff.** Under `-p` the model quoted the secret word of the 30 and 9,000-character files. **A longer output is cut by Claude Code**: for 15,000 characters the model saw a preview of about 2 KB and the note that the rest was saved to a file, so the hook keeps its output under 10,000 characters. **Interactive, next to `sec-default`:** the session showed `session-hub: its classic.SessionStart hook was skipped` for the mod's own handler, yet the plugin's `hooks.json` hook ran (`source=startup`) and the model answered with the secret word; no dialog was shown. **After `/compact`** the hook ran again (`source=compact`) and the model quoted the handoff word for word from the new context. **At the cap:** the real hook on a 9,348-character handoff of 857 short lines full of quotes returned 9,486 characters of context (13,707 bytes of JSON on stdout), cut at a line by the hook; it arrived whole, with no preview note, so the limit counts the context's characters, not the escaped output. |
