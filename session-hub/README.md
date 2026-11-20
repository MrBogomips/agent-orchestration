# session-hub

Coordinates a master session opened in a hub of repositories and the child sessions it starts, one per
repository: each child gets a written scope, talks only to the master, sends requests outside its scope to the
master, and is recorded in a children record kept outside the hub.

Status: under construction (0.0.1). See `docs/design/session-hub.md` for the specification.

## Installation

Plugin only: the scope guard is a hook, and the skills share files through the plugin folder.
Works without `model-router`; with it installed, `session-hub:spawn` chooses each child's model and effort with
its grid.
