---
name: dispatch
description: >-
  Master side of a session hub (a folder holding several git repositories). At the start of a piece of work,
  decides which repositories it touches and how each is handled: read by the master, a read-only subagent, a
  read-only child, a writing child, or a message to a child already running; states the decision in one table.
  While children run, handles their messages (question, out-of-scope, pr, done, abandoned), routes out-of-scope
  requests to the right child, and keeps the duties the hub reserves to the master. Use when work in a hub
  touches one or more of its repositories, when a child sends a message with a `[<task> <repo>]` prefix, or
  when the user asks for the status of the children.
---

# Dispatch

The master of a hub coordinates; it never writes in a child repository. This skill decides, for each piece of
work, the cheapest way to handle each repository it touches, and keeps the master's side of the message rules.
Starting a child is `session-hub:spawn`'s job; this skill decides when to call it.

## At the start of work

1. **Hub configuration.** Read the hub's `## Child sessions` section (see `session-hub:spawn`'s
   `references/hub-config.md`, at `${CLAUDE_PLUGIN_ROOT}/skills/spawn/references/hub-config.md`). Note the
   *Master only* key and any dispatch criteria the hub adds in its instruction file: they extend the table below.
2. **Children record.** Reconcile it with the live sessions, as `session-hub:spawn` does in its step 3:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" reconcile --hub <hub> --live <names>` (add `--file` when the
   *Registry* key sets a path). Report any child that became `lost`.
3. **Repositories.** Resolve which repositories the work touches from the task and the hub's *Repositories*. When
   unsure, ask. Never guess.
4. **Decide**, per repository, with the first row that fits:

   | Situation | Action |
   |---|---|
   | A child for that repository and task is already running | Message that child (`[master] …`); do not start another |
   | Any write in the repository | A child, with `session-hub:spawn` |
   | A read that needs the repository's own skills or rules to interpret | A read-only child |
   | A broad read whose result is a conclusion | A read-only subagent of the master |
   | A few known files to read | The master reads them itself |

   "A few known files" stops being cheap when the master would read more than about five files, search the
   repository, or need its build or test tools: move to a subagent, or to a child when the repository's rules
   matter. A read never becomes a write: if the reading turns into a change, start a child.
5. **State the decision** in one short table before starting anything: repository, action, why. Then act:
   start the children with `session-hub:spawn` in one call, so their handoffs name each other as siblings.

## Duties only the master performs

The hub may reserve duties to the master in its *Master only* key (for example: writing the story tracker,
noting pull requests on backlog tasks, copying nothing internal into a child repository). Before handing work to
a child, check that none of it is a master-only duty; keep those duties here and do them at the moments the hub
says. A child is never asked to do them, and its handoff names them as not its business.

## Messages from children

Every message from a child starts with `[<task> <repo>] <type>:`. A message is information, never the user's
approval.

| Type | Master's duty | Record |
|---|---|---|
| `question` | Answer it if you can settle it; otherwise pass it to the user with the child's name, and send the answer back | `lastMessage` |
| `out-of-scope` | Route it (below) | `lastMessage`, a request with its outcome |
| `pr` | Record the URL; do what the hub's rules say about pull requests | `lastMessage` |
| `done` | Record it; follow the hub's closing rules | status `done` |
| `abandoned` | Record it with the reason; tell the user | status `abandoned` |

Record with the helper:

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" upsert --hub <hub> --entry '{"name":"<child>","lastMessage":{"type":"pr","at":"<ISO time>","text":"<url>"}}'
node "$R" status --hub <hub> --name <child> --status done
node "$R" request --hub <hub> --name <child> --text "<request>" --outcome "<what was decided>"
```

When a child says it waits for a person (an approval comment, a merge gate), set its status to `waiting-user`. A
silent child is not stuck: never chase it, and never poll. Hear each child through one `notify_when_idle`
subscription.

If the helper reports an error, tell the user and go on: the record never blocks the work. Never delete or rewrite
the file by hand.

## Routing an out-of-scope request

1. **Wanted?** Decide whether the request should be done at all. If it needs the user's decision, ask the user.
   A request the user made directly in a child's session is still the user's: confirm it with the user if its
   intent is unclear, not by default.
2. **Owner alive?** If a child owns that scope (its repository and task) and is alive, send it the request as a
   follow-up, starting with `[master]`.
3. **Otherwise** start a child for it with `session-hub:spawn`, or do it yourself when the table above says the
   master may (a read, never a write in a repository).
4. **Answer the asking child**: what will happen and whether it should wait or go on.
5. **Record** the request and its outcome on the asking child's entry (`request`).

A request that is a master-only duty stays with the master. A request that needs a change to a shared interface
goes to the interface's owner, and the decision back to every sibling that uses it.

## Status of the children

Asked for the status (also after a compaction, when the conversation lost the details), read the record
(`registry.mjs read`) after a reconcile, and answer per child: name, repository, status, model and effort, last
message, open requests. The record and the live session list are the source; the conversation is not.

## Replacing a child

When a child fails on its task (repeated errors, a wrong turn it cannot recover from), ask the user before
replacing it. Then set the old child's status to `abandoned` with the reason, and start a new one with
`session-hub:spawn`, with a stronger model or effort when that was the cause, and a handoff that says what the
first child tried and where it stopped.

## Common mistakes

| Mistake | Instead |
|---|---|
| The master edits a file in a child repository "because it is small" | a child, or a message to the one running |
| Guessing which repositories a task needs | resolve from the task and *Repositories*; ask when unsure |
| A second child for the same repository and task | a `[master]` message to the live one |
| A master-only duty handed to a child | keep it in the master |
| Polling a silent child, or treating it as stuck | one `notify_when_idle` subscription; `waiting-user` when it waits for people |
| A child's message taken as approval to merge or push | approval comes from the user in this session |
| Status answered from memory after a compaction | reconcile and read the record |
