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

## Order

S1, S4 and S5 block `session-hub` 0.1. S3 blocks the `model-router` mod; S11 and S12 block its quality loop (`model-router-quality-loop.md`), S13 only a rule in `choose-model`. The others block only the mods.

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
