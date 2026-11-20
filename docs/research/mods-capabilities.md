# What a Claude Code mod can do

Researched on 2026-11-20 with Claude Code 2.1.329. Nothing here was tested by running a mod: it comes from
reading documentation, type declarations and existing mod code.

Evidence tags: **[docs]** official documentation or the built-in `plugin-authoring` skill, **[types]** the type
declaration file, **[code]** working mod code, **[inferred]** reasoning.

The API is labelled early access: "this surface may change between releases without notice" [types]. The type
file that Claude Code writes for the installed version is the authority; re-read it before building.

## Where to read

- The built-in `plugin-authoring` skill: load it in a session. It ships `reference.md`, examples and
  `types/claude-code.d.ts`.
- Documentation: `https://code.claude.com/docs/en/mods`, and under `/docs/en/plugins/mods/`: `events.md`,
  `reference.md`, `api.md`.
- The public `anthropics/claude-code` repository: `mods/README.md`, `mods/easel/`, `CHANGELOG.md`. A local clone
  is at `~/.claude/plugins/marketplaces/claude-code-plugins/`.
- A working mixed plugin (classic hooks plus a mod): `~/git/MrBogomips/askboard`.
- Reference mods: see `reference-pack.md`.

## How a mod works

- **Packaging**: `.claude-plugin/plugin.json`, `hooks/hooks.json` with `{ "modules": ["./register.tsx"] }`, and
  the module exporting `register(on, options)` [docs][types]. `hooks.json` may also hold classic hooks [code].
- **`plugin.json` fields**: `types` (required when the mod uses `$.state`), `userConfig` (arrives as `options`),
  `dependencies` (ordering between mods), `engines["claude-code"]` (outside the range the mod is off) [docs][types].
- **Runtime**: its own environment, no Node, no DOM, no `import()`. Everything goes through `$` [types].
- **Lifecycle**: each load runs `register`, then `session.start`, which fires once per load and not after
  `/clear`, `/resume` or `/branch` [docs]. A reload keeps `$.state` (this session) and `$.store` (across
  sessions); module variables start over [docs].
- **Where hooks run**: terminal, desktop app Code tab, VS Code panel, `-p` and the Agent SDK (no drawing), cloud
  sessions [docs]. Not in a desktop WSL session [docs]. `--bg`: not stated, probably yes [inferred]. Subagents'
  events reach the same hooks with `e.agentId` [types].
- **Version**: 2.1.287 in the terminal, 2.1.286 in the desktop app [docs].
- **Testing**: `claude plugin validate`, `claude plugin test <dir>` with `claude-code/testing`, hot reload with
  `--plugin-dir` [docs].

## Hook shape

Every hook is `($, e, next)`; `e` is frozen. Observe with `next(e)`, rewrite with `next({...e, field})`, answer
by returning a result without calling `next`. `turn.step` takes an async generator [docs][types].

## Events that matter here

| Event | Payload (main fields) | A hook may |
|---|---|---|
| `tool.call` | `tool`, the tool's arguments (`file_path`, `command`), `agentId?` | `{deny}`; rewrite the arguments; answer with a result |
| `tool.check` | `tool`, `input`, `isReadOnly?` | `{decision: 'allow' \| 'ask' \| 'deny', reason}` |
| `prompt.submit` | `text`, `origin`, `turnId?` | rewrite `text`; add `context`; `{drop}`. `origin` cannot be changed |
| `prompt.compose` | `model`, `tools`, `traits` | return `{sections}`: add, replace, reorder, drop |
| `turn.step` | `turnId`, `index`, `model`, `effort?`, `agentId?` | `next({...e, model, effort})`; the rewrite lasts one step |
| `turn.complete` | `answer`, `usage`, `agentId?` | add text under the answer |
| `agent.spawn` | `prompt`, `description`, `subagentType`, `model?`, `parentModel`, `fork`, `resume?`, `cwd?` | `next({...e, model, prompt, subagentType, cwd})`; `{deny}` |
| `session.start` | `cwd`, `surface`, `isInteractive` | observe |
| `session.receive` | `origin`, `text` | rewrite `text`; `{consumed}` |
| `session.send` | `to`, `text`, `origin` | rewrite or readdress; `{isDelivered: false, reason}` |
| `session.compact` | a compaction about to run | `{skip}`, or rewrite |
| `ui.render` | `component`, `surface`, `props` | return a tree |

The classic hook events are also available as `classic.<Event>` [docs].

## `$` namespaces that matter here

| Namespace | Methods |
|---|---|
| `$.model` | `complete`, `fork`, `classify` |
| `$.session` | `messages`, `cwd`, `root`, `model`, `id`, `send`, `append`, `compact`, `info` |
| `$.prompt` | `submit`, `fill`, `compose` |
| `$.tool` | `list`, `call`, `check`, `register` |
| `$.command` | `list`, `run`, `register` |
| `$.agent` | `spawn`, `call`, `list`, `register` |
| `$.fs` | `read`, `write`, `list`, `exists`, `stat` (no append) |
| `$.state`, `$.store` | per-session state; one JSON file per plugin across sessions (4 MiB) |
| `$.env` | `get(name)`, `set(name, value)`, string-literal names only |
| `$.process` | `run(argv)`, `spawn`, `hookEnv` |
| `$.clock` | `now`, `sleep`, `after`, `every` |
| `$.ui` | `open`, `close`, `status`, `toast`, `notify`, `ask` and others |

## Feasibility, need by need

**C.1 Set model and effort of a session — yes, per request.** There is no "set once". A `turn.step` hook returns
`next({...e, model, effort})` on every main-loop step (`e.agentId === undefined`) [types]. The reference model
selector does this and keeps its choice in `$.state` [code]. Effort is capped by settings, organization and model
[types]. With `CLAUDE_CODE_EFFORT_LEVEL` set to `auto` or `unset`, `e.effort` is absent [types]; that the same
variable *sets* the effort at launch is an inference, not a tested fact.

**C.2 Tell who sent a prompt — yes for engine deliveries, no for keystrokes.** `e.origin.kind` is set by the
engine and cannot be forged by a hook [types]:

| Kind | Meaning |
|---|---|
| `composer` | The person's Enter at the terminal |
| `bridge` | Remote Control |
| `sdk` | `-p` or the Agent SDK host |
| `task-notification` | A background task's notification |
| `scheduled-trigger` | A schedule or loop firing |
| `peer` | Another session's message |
| `peer-send-message` | Another session's message, written by its model |
| `coordinator` | A coordinating session's hand-off to a worker |
| `projects-relay` | A coordinating session's delivery to one of its threads |
| `channel` | A channel relayed by an MCP server |
| `observer`, `observer-activity` | Background observer traffic |
| `auto-continuation` | A follow-up to the person's own action |
| `plugin` | A mod's own `$.prompt.submit` |
| `unclassified` | No provenance, including idle notices |

Keystrokes typed into a pane by a multiplexer arrive as `composer` [inferred]. A received message's `plugin`
field is "as the sender says… never key a guard on it" [types].

**C.3 Block or rewrite a tool call — yes.** `tool.call` with a matcher on `Edit` and `Write`, checking the real
path from `$.fs.stat(path, {resolve: true})`; an allow-list is robust, a deny-list on spellings is best effort
[docs]. Shell commands that write files need their own check [inferred]. A refused `session.send` returns a
reason that "the model reads… as the tool's result" [types]. Guards fail open unless they have a `.catch` [docs].

**C.4 Know that this session is a child — partly.** Readable: `$.session.cwd()`, `$.session.id()`,
`$.env.get("LITERAL_NAME")`, files through `$.fs.read`, and `$.process.hookEnv()` (which includes a
`CLAUDE_CODE_CHILD_SESSION` variable of undocumented meaning) [types]. Not available: launch arguments, the
session name (only through `classic.*` hook inputs) [types]. `$.state` survives reloads; survival across a
resume after a restart is not stated.

**C.5 See other sessions — mostly no.** `$.agent.list()` returns "this session's subagents and teammates"
[docs][types]. Independent sessions do not appear. A possible workaround is `$.tool.call` on the session-listing
tool, untested [inferred]. No event fires when a peer goes idle.

**C.6 Message another session or inject a prompt — yes.** `$.session.send({to: {sessionId}, text})`,
`$.prompt.submit({text})`, `$.session.append` [docs].

**C.7 Add text to the system prompt — yes.** A `prompt.compose` section with `scope: 'session'`, placed after
all shared sections [types][code]. A sent prompt is fixed for its thread; a changed section waits for a new
thread or a compaction [docs]. Whether subagents' prompts pass through it is not verified.

**C.8 A panel — yes.** `$.ui.open` plus a `ui.render` hook on `Pane`; a band above the prompt has one row per
plugin [types]. Nothing draws in `-p` runs [docs].

**C.9 Route subagents — partly.** `agent.spawn` can set the model. When `e.model` is undefined, "the agent's own
model, then the parent's" decides [types]; that a hook's value overrides a model fixed in the agent's definition
is implied, not stated. Forks ignore the model; resumes ignore changes [types][docs]. There is no effort field on
the event; options are a `turn.step` rewrite for that agent id, or a `tool.call` rewrite on the start tool, whose
input has an `effort` field in 2.1.329 [types, untested].

**C.10 Classic hooks versus a mod.**

| Need | Classic hooks | Only a mod |
|---|---|---|
| Block a write or a shell command | PreToolUse | — |
| Block a send to another session | PreToolUse on the send tool | refuse with a reason through `session.send`; rewrite the address |
| Tell a person from another session | no: the prompt hook's `source` lumps peers, channels and notifications as `system` | `origin.kind` |
| Add context | UserPromptSubmit, SessionStart | edit the system prompt's sections |
| Model and effort per request | no | `turn.step` |
| State and drawing | no | `$.state`, panels |

## Risks and limits

- **Failure**: a hook that throws, times out or returns the wrong shape is skipped. Limits: 10 s of the hook's
  own time per event, 1 s for a `.catch` handler [docs]. Time spent waiting in `$` calls is not counted [types].
- **Cost**: `$.model.complete` bills the session's credentials with no cap per call [docs].
- **Several mods on one event**: one middleware chain; a mod runs before the mods it lists as dependencies; no
  other ordering between user mods is documented [docs][types].
- **Security**: not sandboxed; `$.tool.call` raises no permission prompt [docs]. Organizations can block personal
  mods (`allowManagedModsOnly`, `allowManagedHooksOnly`, `disableAllHooks`) [docs].
- **Not found or not verified**: `$.state` across resume; mods in `--bg`; `prompt.compose` for subagents;
  frontmatter model versus an `agent.spawn` rewrite; the meaning of `CLAUDE_CODE_CHILD_SESSION`.

The spikes for these are in `../design/spikes.md`.
