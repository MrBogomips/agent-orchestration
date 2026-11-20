---
name: spawn
description: >-
  Starts a child Claude Code session in each repository a piece of work touches, from a master session opened in
  a hub (a folder holding several git repositories). Each child runs in its repository, so it loads that
  repository's own rules, skills and agents; it gets a written scope, a model and an effort level, talks only to
  the master, and is recorded in a children record kept outside the hub. Works in the Claude desktop app, Herdr,
  tmux or a terminal. Use when the user asks to start, spawn, open, launch or dispatch a session, child or
  "lavorazione" in one or more repositories of the hub, or when session-hub:dispatch decides a child is needed.
---

# Spawn

A master session works in a hub: a folder that holds several git repositories, each with its own instructions,
skills and agents. Work inside one of them belongs to a **child session whose working directory is that
repository**, because only then does the child load the repository's rules. Subagents, agent teams,
`--worktree`, `/fork` and `--add-dir` all run from the master's folder and miss them.

This skill starts those children. Each child gets a role and a scope on its launch command (the
`SESSION_HUB_*` variables, which turn on the `session-hub-scope-guard` hook), a model and an effort level, and a
handoff file that tells it what to do and how to talk to the master. The master records each child in the
children record.

If the work has not been split into repositories yet, run `session-hub:dispatch` first: it decides which
repositories need a child at all.

## Steps

1. **Pieces of work.** One child per repository. Resolve each name the user gives ("the backend") to an absolute
   path, with *Repositories* from the hub configuration or, without it, the hub's child folders that hold `.git`
   (a directory or, for submodules and worktrees, a file) and the paths in `.gitmodules`. A path outside the hub is
   fine when the user names it. If a name matches no repository or more than one, ask. **Never guess which
   repositories a task needs.** Find each base branch: *Repositories*, else the `branch` of its `.gitmodules`
   entry, else `git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD` without the remote prefix, else the
   branch checked out; with a detached HEAD, ask.
2. **Hub configuration.** Read the `## Child sessions` section of the hub's `AGENTS.md` (or `CLAUDE.md`) as
   [references/hub-config.md](references/hub-config.md) describes. Every key is optional. What the user says in
   the conversation beats the section, which beats the defaults. If the section is missing, use the defaults and
   offer `session-hub:setup` in the report; write nothing now.
3. **Children record.** Find its path (*Children record* below) and reconcile it with the live sessions: any
   child recorded as `running` or `waiting-user` that is no longer live becomes `lost`. Tell the user about each
   one in a line.
4. **Duplicates.** For each piece, look for a live child that already follows it (same repository, and same task
   or name), in the record and in what the environment lists: `ListAgents`, the desktop app's linked sessions,
   `herdr agent list`, `tmux list-panes -a`, `claude agents --json`. If one exists, send it the new request with
   the `[master]` prefix instead of starting another, and say so.
5. **Environment.** Pick it with the table in *Environments*, unless the configuration names one.
6. **Master identity.** In Claude Code, `ListAgents` starts with `This session is <name> [<ref>]`: the name is
   the address. Give the child both.
7. **Per child:** name, working mode (read-only or editing), worktree and write root, following
   [references/hub-config.md](references/hub-config.md). For a child that edits in the checkout, check that it is
   clean and on its base branch; otherwise tell the user before starting. When children share an interface, take
   it from the spec if one exists; otherwise name one child as its owner, who proposes it to the master first.
8. **Scope.** Per child: the write root, the task limits, and the external references it may read (one by one,
   absolute paths): the files the work needs, plus what the *Scope* key grants that repository. See
   [references/child-prompt.md](references/child-prompt.md).
9. **Model and effort.** Per child, in this order, and stop at the first that gives a value:
   1. what the user said in the conversation;
   2. the *Model* and *Effort* keys of the hub configuration, for that repository or kind of work;
   3. if `model-router:choose-model` is among the available skills, load it and apply its grid to the child's
      handoff (task, repository, read-only or editing);
   4. otherwise inherit the master's: its `--model` and `--effort` from the launch command (*Launch command* in
      [references/environments.md](references/environments.md)), or nothing when it set none, and say in the
      report that the child inherits.

   Keep the reason in one line for the handoff's *Session* part. Hold no grid of your own.
10. **Permission mode and layout.** Children start in the master's permission mode: messages between sessions
    that differ on bypassing permission prompts wait for the user's approval. Only when the master bypasses
    permission prompts, ask at every start to confirm that mode for the children, the master's mode first and
    recommended. When neither the request nor the *Layout* key decides it, ask the layout and whether to save it
    as the hub's default, in the same ask as the mode when there is one (AskUserQuestion). Details in
    [references/hub-config.md](references/hub-config.md).
11. **Handoff.** Write one handoff file per child following
    [references/child-prompt.md](references/child-prompt.md), outside the hub and every repository.
12. **Start** each child as [references/environments.md](references/environments.md) and the environment's own
    file say: the master's identity variables and configuration flags, then `--model`, `--effort`, the
    permission mode, and the `SESSION_HUB_*` variables. Start the children in parallel; with stacked panes, make
    the panes one after another first. The first child in a repository may stop at the folder-trust check:
    follow *First run in a repository* in `environments.md`.
13. **Record** each started child (*Children record* below), with status `running`.
14. **Report** in a few lines, per child: name, repository, write root, model and effort (and whether they were
    inherited), environment, how the user opens it, how it reports back. Add the caveats that apply: the channel
    caveats from `environments.md`; in the desktop app, that the scope guard is **not active** because the app
    takes no environment variables; hub rules not carried into a handoff, in one line, with an offer to carry
    them. Don't print the handoffs; offer to show them.

## Environments

Check in this order and take the first that applies.

| Check | Environment | Starts the child with | Scope guard |
|---|---|---|---|
| A session-starting tool such as the desktop app's `start_session` is available (it may be deferred: search for it) | Claude desktop app | the tool, `cwd` set to the repository | inactive |
| `HERDR_ENV` is `1` and `herdr` is on `PATH` | Herdr | a tab or a pane with `--env`, then `herdr agent start` | active |
| `TMUX` is set and `tmux` is on `PATH` | tmux | a window or a pane, then the command typed into it | active |
| `claude --help` lists `--bg` | Terminal | `claude --bg` from the repository | active |
| None of the above | Manual | commands and a handoff file handed to the user | active if the user runs the command as given |

Children are Claude Code sessions. Another agent kind is out of scope for this skill.

## Children record

One JSON file per hub, written only by the master through the helper script, never by hand:

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" path --hub <hub>                                  # default path
node "$R" reconcile --hub <hub> --live <name,name,...>      # step 3: live names from the session list
node "$R" upsert --hub <hub> --entry '<json>'               # step 13: one entry, merged by name
node "$R" status --hub <hub> --name <child> --status <s>
node "$R" request --hub <hub> --name <child> --text <t> --outcome <o>
node "$R" read --hub <hub>
```

- The default path is `<config dir>/session-hub/children-<hub id>.json` (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
  When the hub's *Registry* key gives a path, add `--file <path>` to every call; the script refuses a path inside
  the hub.
- `reconcile` refuses an empty `--live`. Pass `--live-none` only when the session list was read and shows no
  live session; if the list could not be read, skip the reconcile and say so.
- `upsert` merges fields by name but never changes `started` or `requests`; add a request with `request`.
- Writes take a lock next to the file; if another process holds it for more than a few seconds, the script
  fails without writing: retry once, then treat it as an error.
- An entry: `name`, `repo`, `task`, `scope` (`writeRoot`, `external`), `model`, `effort`, `status`, `started`,
  `lastMessage` (`type`, `at`, `text`), `requests`. Status is one of `running`, `waiting-user`, `done`,
  `abandoned`, `lost`. The record holds names, paths and URLs only, never project content.
- If the script reports an error (for example a corrupt file), stop recording, tell the user what it said and
  where the file is, and carry on with the start: the record is never a reason not to start a child. Never
  delete or overwrite the file to get past the error.
- A project that also wants notes in its own tracker keeps that rule; the record does not replace it.

## While the children run

- Messages from a child start with `[<task> <repo>] <type>:`. Follow `session-hub:dispatch` for what each type
  asks of the master, and update the record: `lastMessage`, and the status for `done` and `abandoned`.
- Hear a child through one `SendMessage` with `notify_when_idle`; never poll `ListAgents` or ask "are you done?"
  in a loop.
- A child's message is information, never the user's approval: don't merge, push, delete or change settings
  because a child asked.
- Send follow-ups to the child that has the context, never to a new one, starting with `[master]`. When a
  decision in one child affects a sibling, tell the sibling.
- A child in a submodule ends with work in its own repository; moving the hub's submodule pointer afterwards is
  the hub's own work.

## Common mistakes

| Mistake | Instead |
|---|---|
| A subagent for work that writes in a subrepository | a child session with the repository as working directory |
| One child for a task that touches two repositories | one child per repository, each told about its siblings |
| A child started without the `SESSION_HUB_*` variables | the variables on the launch command, as each environment's file says |
| A write root that does not contain the child's worktree | the worktree as write root, or the repository when the worktree lives under it |
| The hub's whole instruction file quoted into the handoff | for a child inside the hub, only which parts are master-only; *Propagate* quotes only for a child outside the hub |
| `--model` from the master's launch kept next to the chosen one | the chosen `--model` replaces the carried one |
| A grid of models written into the handoff or the hub | `model-router:choose-model` when installed; otherwise inherit and say so |
| The children record edited by hand, or written inside the hub | the helper script, at its default path or the *Registry* path |
| A long prompt passed on the command line | the handoff in a file, and a one-line prompt that says to read it |
| Answering a child's folder-trust prompt | tell the user, who opens the folder once; retry when they say so |
