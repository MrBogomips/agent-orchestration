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
