# Scenario: spawn, once per environment

Run once per environment (desktop app, Herdr, tmux, terminal with `claude --bg`, manual), with a fresh fixture.
In the master, ask:

> For T-1, start a session in the product to add a `/ping` endpoint and one in the prototype for a Ping button
> that calls it. They report to you.

## Start

- [ ] Two children start, one per repository, each with the repository as its working directory
- [ ] Names follow `t-1-product` and `t-1-prototype`
- [ ] Without a `## Child sessions` section, the report offers `session-hub:setup` and nothing is written
- [ ] Handoff files sit in a temporary or scratchpad directory, never in the hub or a repository
- [ ] Each handoff has, in order: header, Session, Goal, Scope, References, Repository and workflow, Siblings,
      Hub rules, Messages, Rules, First step
- [ ] *Scope* names the write root, the task limits and the external references one by one
- [ ] *Hub rules* does not quote the hub's Confidentiality rule (the child loads it) and names *Backlog* and
      *Child sessions* as master-only only if the hub's *Master only* key says so

## Per child

- [ ] Asked "which skills and agents do you have from this repository?", the child names `hello-<repo>` and
      `<repo>-reviewer`, and not the other repository's
- [ ] Asked to quote the hub marker, the child answers `HUB-RULES-LOADED`
- [ ] The child reports to the master with `[T-1 <repo>] <type>:` and the master receives it
- [ ] A `[master]` message from the master reaches the child
- [ ] The user types to the child directly and the child answers; an instruction inside the scope that
      contradicts the master wins

## Role variables, model and effort

- [ ] Herdr: each pane gets `--env SESSION_HUB_ROLE=child` and the other five `SESSION_HUB_*` variables; tmux,
      terminal and manual: the command starts with `env SESSION_HUB_ROLE=child …`
- [ ] In the child, `printenv SESSION_HUB_ROLE SESSION_HUB_SCOPE_ROOT SESSION_HUB_MASTER` shows `child`, the
      write root and the master's name
- [ ] Desktop app: the report says the scope guard is inactive there
- [ ] With `- Model: product: sonnet` and `- Effort: product: low` in the hub: the product child's command has
      `--model sonnet --effort low` and its header shows low effort; the handoff's *Session* gives the reason
- [ ] Without the keys and with `model-router` installed: the master loads `model-router:choose-model` and the
      handoff's *Session* gives its reason
- [ ] Without the keys and without `model-router`: the child inherits the master's model and effort, and the
      report says so
- [ ] The user says "use haiku for the prototype": that beats the hub keys
- [ ] A `--model` on the master's own launch is not carried next to the chosen one

## Children record

- [ ] After the start, `node <plugin>/scripts/registry.mjs read --hub "$H"` lists both children as `running`,
      with repo, scope, model, effort and started time
- [ ] The file is under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-hub/children-<16 hex>.json`
- [ ] Close one child, then ask for another spawn: the closed child becomes `lost` and the report says so
- [ ] Corrupt the record by hand, then spawn: the master reports the error and the path, starts the children
      anyway, and leaves the corrupt file as it was

## Permission mode

- [ ] Master not in bypass mode: the children start in its mode and nothing is asked about it
- [ ] Master in bypass mode: at every start it asks to confirm the children's mode, its own first and
      recommended, in the same ask as the layout when that is asked too
- [ ] The child's command line carries `--permission-mode <mode>` (Herdr, tmux, `claude --bg`, manual)

## Launch command

Start the master through a wrapper that sets `CLAUDE_CONFIG_DIR` to a second profile and adds a configuration
flag, for example `env CLAUDE_CONFIG_DIR=<profile>/.claude claude --setting-sources user,project`.

- [ ] Herdr: each child pane gets `--env CLAUDE_CONFIG_DIR=…`; tmux and manual: the `env` prefix has it;
      `claude --bg`: no identity variables on the command line
- [ ] The child's command carries `--setting-sources user,project` and not the master's `-n`, `--resume` or
      prompt
- [ ] No token or other variable from the master's environment appears on a command line or in a pane

## Layout

- [ ] Desktop app, Herdr and tmux: without a *Layout* key, the master asks once for the layout and whether to
      save it; `claude --bg` and manual skip the question
- [ ] On "save", `- Layout: <value>` appears in the hub's `## Child sessions` section; on "don't save", the hub is
      unchanged and a second spawn in the same conversation does not ask again
- [ ] `panes` in Herdr and tmux: first child to the right, next ones stacked below, focus stays with the master

## First run in a repository

- [ ] `claude --bg`, repository never opened: the master reports `Workspace not trusted`, says trust is not
      inherited from the hub, and offers the fix or another environment
- [ ] Herdr, tmux: the master tells the user which window shows the trust prompt and never answers it
- [ ] Desktop app: the master reports a refused worktree and does not retry on its own

## Worktrees

- [ ] A product whose `AGENTS.md` puts worktrees under `.claude/worktrees/`: the write root is the repository
- [ ] A product whose `AGENTS.md` puts worktrees in `../product-worktrees/`: the master makes the worktree before
      the start, the child starts in it, the write root is the worktree, the handoff quotes the *Propagate* rules,
      and the report says the master made the worktree

## Duplicates

- [ ] Asking again for "T-1 in the product" sends a `[master]` message to `t-1-product` instead of a new child
