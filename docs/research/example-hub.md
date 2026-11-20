# An example hub

A generic picture of the kind of hub the plugins must serve. It is modelled on a real one, with every
project-specific detail removed. Use it to write scenarios and to check that the design fits.

## Layout

```text
workspace/                 the hub: its own git repository, team-internal
├── AGENTS.md              hub rules, including the Child sessions section
├── repos.txt              the child repositories
├── backlog/, meetings/    internal material; never copied into a child repository
├── design/                child repository: specification, spec-driven framework
├── product/               child repository: the code monorepo
└── prototype/             child repository: a throwaway UI prototype with private data
```

The child repositories are clones inside the hub, ignored by the hub's git. Each has its own instruction file,
skills and branch rules. Worktrees of a child repository live either under its own `.claude/worktrees/` or in a
sibling folder such as `product-worktrees/`.

## What each repository expects

| Repository | Character | Relevant rules |
|---|---|---|
| design | Authoritative on what is built. Agents propose, people decide. | Pull requests only; agents never merge. |
| product | Authoritative on how it is built. Its main session is itself a coordinator: it delegates to developer and reviewer subagents whose models are fixed in their definitions. | A human approval comment is required before any code is written. A merge guard decides whether an agent may merge. Hooks try to recognize prompts not typed by the person, heuristically. |
| prototype | Low ceremony. Uses real private data. | Nothing passes from it to the product repository. |

## What the hub expects

- The master coordinates and never writes in a child repository.
- A tracker of stories is written **only by the master**, at fixed moments. A child never reads or writes it; the
  master hands it the story's key and the design references.
- Internal hub material is never copied into a child repository; only a task identifier passes.
- The master records pull requests and closed work against its backlog tasks.
- The product repository will be published; nothing confidential may flow into it from the design.

## Requirements this puts on the plugins

1. **Three levels exist.** Master, child, and the child's own subagents. `session-hub` stops at the child. The
   master never talks to a child's subagents.
2. **A child waits for people.** The approval comment and the merge are gates the master cannot pass. The record
   needs a `waiting-user` status, and the master must not treat a silent child as stuck.
3. **A master message must never look like the user.** Where a repository's hooks decide on "the person asked
   for a merge in this turn", a message from the master must not qualify. Origin marking by the mod is the
   technical answer; until then it is prose.
4. **Scope differs by repository.** A product child may read listed design files and nothing else there. A
   design child may read the product's public interfaces. The `Scope` key must express this per repository.
5. **The master also reads child repositories directly** for cheap checks. `dispatch` must allow this and say
   when it stops being cheap.
6. **Hub rules reach children twice.** Through the parent-folder instruction file (if that loading is confirmed)
   and through `Propagate`. The hub's file needs a way to say "this part is for the master" and "this part is
   for a child".
7. **Model defaults by repository and kind of work.** For example: a design session on a hard problem at the top
   tier; a product child that mostly coordinates at the tier below with medium effort; a procedural prototype
   edit at a small tier; a read-only check at a small tier with low effort.
8. **Projects keep their own notes.** The plugin's children record does not replace a project rule that says
   "note the pull request on the backlog task".
9. **A tracker is not a child's business.** `dispatch` must be able to state, per hub, things that only the
   master does.

## Scenarios worth writing as tests

- A task that touches design and product: two children, one shared interface, the master relays a decision.
- The user asks a product child, in its pane, to fix a typo in a design file.
- A product child needs a design decision that does not exist yet.
- The master compacts while two children run, then is asked for their status.
- A child fails twice on a small model; the master replaces it.
- A read-only check across a repository: subagent or child?
