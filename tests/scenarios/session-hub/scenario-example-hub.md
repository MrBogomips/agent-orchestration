# Scenarios from the example hub

The six scenarios of `docs/research/example-hub.md`. Fixture from [README.md](README.md), with this section
added to the hub's `AGENTS.md` (or written by `session-hub:setup`):

```markdown
## Child sessions

- Repositories:
  - `design/`: specification; agents propose, people decide
  - `product/`: code monorepo
  - `prototype/`: throwaway prototype with private data
- Task IDs: `T-1`, listed in `backlog/tasks.md`
- Master only: the *Backlog* section of this file; writing `backlog/`; noting pull requests on tasks
- Model: design: opus; product: sonnet; prototype: haiku; read-only: haiku
- Effort: product: medium; read-only: low
- Scope:
  - product: `design/docs/`
```

## 1. Design and product, one shared interface

Ask: "For T-1, the design must specify a `/ping` response format and the product must implement it."

- [ ] `dispatch` states a table before starting: design → child, product → child, with the reason
- [ ] Both children start in one `spawn`; each handoff names the other as sibling and one owner for the format
- [ ] The product child's external references list `design/docs/` from the *Scope* key
- [ ] Models and efforts follow the keys: design `opus`, product `sonnet` with `medium`
- [ ] When the design child settles the format, the master relays the decision to the product child with
      `[master]`; the children never message each other
- [ ] Neither handoff asks a child to write `backlog/`; a `pr` message is noted on the task by the master

## 2. The user asks a product child to fix a typo in a design file

In the product child's pane: "Fix the typo in `design/docs/notes.md`."

- [ ] The child does not edit it (the guard blocks it, or the child declines first)
- [ ] The child sends `out-of-scope` to the master and tells the user
- [ ] The master decides whether it is wanted (asks the user if unsure), sends it to the live design child, or
      starts one; then tells the product child what will happen
- [ ] The record holds the request and its outcome on the product child's entry

## 3. A product child needs a design decision that does not exist yet

Tell the product child that the error format for `/ping` is undecided and it must not invent it.

- [ ] The child sends `question` (or `out-of-scope`) to the master and waits or goes on as the master says
- [ ] The master passes the decision to the user or to the design child, never decides a design matter itself
      unless the user says so
- [ ] The answer goes back to the product child with `[master]`

## 4. The master compacts while two children run

Start two children, run `/compact` in the master, then ask "what is the status of the children?"

- [ ] The master reconciles and reads the children record instead of answering from memory
- [ ] The answer lists, per child, status, model and effort, last message and open requests
- [ ] A child waiting for a person shows `waiting-user`, and the master does not chase it

## 5. A child fails twice on a small model

Start a prototype child with `haiku` on a task beyond it; let it fail twice.

- [ ] The master asks the user before replacing it
- [ ] The old entry becomes `abandoned` with the reason; a new child starts with a stronger model or effort
- [ ] The new handoff says what the first child tried and where it stopped, by path, without copying content

## 6. A read-only check across a repository: subagent or child?

Ask: (a) "Does the product have a `/health` endpoint?" (b) "Is the product's error handling consistent with its
own rules?"

- [ ] (a) The master reads a few files itself, or uses a read-only subagent, and states why
- [ ] (b) The master starts a read-only child (the repository's rules are needed), with `haiku` and `low` from
      the keys for read-only work, and its handoff says it does not write files
- [ ] No child is started when the master's own read is enough
