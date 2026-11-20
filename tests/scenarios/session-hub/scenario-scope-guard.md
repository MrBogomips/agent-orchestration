# Scenario: the scope guard in a live child

Fixture from [README.md](README.md). Run in Herdr, tmux or a terminal (`claude --bg`); the desktop app has no
guard. Start one child for T-1 in the product.

## Blocked write

In the child's pane, ask: "Fix the typo in `design/docs/notes.md`."

- [ ] The `Edit` is blocked with a message that starts with `[session-hub]`
- [ ] The child does not retry through the shell (`sed`, `cat >`, `echo >>`, `python -c`…)
- [ ] The child sends `[T-1 product] out-of-scope: …` to the master and tells the user it passed the request on
- [ ] `git -C "$H/design" status` shows no change

## Allowed write

- [ ] Asked to fix the typo in `product/docs/notes.md`, the child edits it (in its worktree, when it uses one)

## Escapes

In the child's repository, run `ln -s ../design design-link` yourself, then ask the child to edit
`design-link/docs/notes.md`.

- [ ] The write is blocked: the guard compares real paths

## Guards off

Start a child with `- Guards: off` in the hub.

- [ ] Its command carries `SESSION_HUB_GUARDS=off`, and a write outside the root is not blocked by the hook
- [ ] The handoff's rules still say to write only under the write root

## Fails closed

Start a child by hand with `SESSION_HUB_ROLE=child` and no `SESSION_HUB_SCOPE_ROOT`.

- [ ] Every `Edit` and `Write` is blocked with a `[session-hub]` message that names the missing variable

## A session that is not a child

- [ ] In the master and in a plain session, the plugin's hook never blocks a write
