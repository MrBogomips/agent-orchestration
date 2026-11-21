# Hub configuration

The hub keeps its rules for child sessions in a `## Child sessions` section of its instruction file: `AGENTS.md`
at the hub root, or `CLAUDE.md` when there is no `AGENTS.md`. The keys are Markdown bullets; read them leniently
(case, wording and order may vary). Every key is optional. `session-hub:setup` writes and updates the section.

The invocation, not this section, says which repositories a piece of work touches. What the user says in the
conversation beats these keys, and these keys beat the defaults.

## Keys

| Key | Content | Default when missing |
|---|---|---|
| Repositories | known repositories: relative path, a one-line role, optionally the base branch | the hub's child folders holding `.git`, plus the paths in `.gitmodules` |
| Task IDs | the form of a task ID and where tasks live | the task ID the user gives; otherwise a short slug |
| Propagate | hub rules to quote into the handoff of a child that works **outside** the hub | none |
| Master only | sections or rules of the hub's instruction file that apply to the master and not to children; also duties only the master performs | none |
| Environment | `auto`, `desktop`, `herdr`, `tmux`, `cli` or `manual` | `auto` |
| Layout | `tabs`, `panes` or `ask` | `ask` |
| Worktrees | `repo`, `always` or `never`, for children that edit files | `repo` |
| Session name | a pattern for children's names, such as `<task>-<repo>` | `<task>-<repo>`, or `<slug>-<repo>` |
| Model | default model per repository or kind of work, such as `design: opus; read-only: haiku` | none: step 9 of the skill decides |
| Effort | default effort per repository or kind of work (`low`, `medium`, `high`, `xhigh`, `max`) | none: step 9 of the skill decides |
| Scope | per repository, what a child may read outside its write root by default, as absolute or hub-relative paths | nothing |
| Registry | path of the children record, outside the hub | `<config dir>/session-hub/children-<hub id>.json` |
| Guards | `on` or `off` for all three guards: the scope guard, and the mod's send guard and shell check | `on` |

The `Agent` key of the old `spawn-session` skill is gone: children are Claude Code sessions. If a hub still has
it, ignore it and mention it once in the report.

## Hub rules and *Propagate*

A child started in a folder **inside** the hub (the repository, or a worktree under it) already loads the hub's
instruction file from the parent folder, as well as its repository's own. So:

- **Child inside the hub:** do not quote hub rules. The handoff's *Hub rules* part says only which parts of the
  hub's file are for the master and do not apply to the child: the *Master only* key, plus the *Child sessions*
  section itself.
- **Child outside the hub** (a sibling worktree such as `product-worktrees/<name>`): it loads only the
  repository's file. Quote the rules that *Propagate* lists word for word, with their file and section, and still
  name the master-only parts so the child does not look for them.
- Without *Propagate*, a child outside the hub carries no hub rules; say so in the report and offer to carry them.

Hub files and other material the work needs (specs, designs, a task's text) are not rules: the handoff lists
them as external references by absolute path.

## Model and effort keys

Values per repository (the folder name) or per kind of work (`read-only`, `editing`, or a word the hub uses,
such as `coordination`). A repository match beats a kind match. Read the keys leniently, for example:

```markdown
- Model: design: opus; product: sonnet; prototype: haiku; read-only: haiku
- Effort: product: medium; read-only: low
```

No match for a child means the key says nothing for it: go on to the next step of the choice order.

## Scope key

Per repository, the files or folders a child of that repository may read outside its write root, for example:

```markdown
- Scope:
  - product: `design/docs/api/` (published interfaces only)
  - design: `product/src/public-api/`
```

Expand each entry to an absolute path and list it under the handoff's external references, next to the files the
task itself needs. A folder grants reading what is in it, not analysing that repository.

## Permission mode

Children inherit the master's permission mode, never saved in the configuration.

- **Master's mode:** as the harness reports it in your context; the user can change it during the session
  (Shift+Tab), so take the latest.
- **Inherit without asking** when the master does not bypass permission prompts.
- **Ask at every start** when the master bypasses them (`bypassPermissions`, `--dangerously-skip-permissions`):
  the master's mode first and marked as recommended, then `default`, `acceptEdits`, `auto`, `plan`. If the user
  picks a mode that doesn't bypass prompts, say in the report that messages will wait for approval.
- **Unknown mode:** ask, without a recommended option.
- **Apply** it as `--permission-mode <mode>` on the child's command line.

## Layout

| Environment | `tabs` | `panes` |
|---|---|---|
| Desktop app | the children stay in the sidebar | each child also opened in split view beside the master |
| Herdr | one tab per child | the first child in a pane to the right of the master, the next ones stacked below it |
| tmux | one window per child | as in Herdr, in the master's window |

`claude --bg` and the manual case have no layout: skip the question there.

**Asking.** With `ask`, or no *Layout* key, and no layout in the user's request, ask before starting the
children, in one ask with two questions (and the permission mode when that is asked too): the layout, and
whether to save it as this hub's default. On "save", set `- Layout: <tabs or panes>` in the hub's
`## Child sessions` section (replace an existing line, or add it after the last key). That answer is the explicit
yes. Don't commit the change. Without "save", use the layout for this conversation only, and don't ask it again in
it. **When the section is missing, don't offer "save"**: ask the layout alone, use it for this conversation, and
offer `session-hub:setup` in the report, which creates the section with the user's yes (spawn writes nothing to a
hub without the section).

**Many children.** With more than four children in a stack of panes, open the rest as tabs and say so.

## Names

Build each child's name from the *Session name* pattern, then normalize it: lowercase, characters outside
`a-z0-9_-` replaced by `-`, starting with a letter, at most 24 characters. Add `-2`, `-3`… if a live session or any entry
of the children record, whatever its status, already has the name: a finished child's name is not reused.

## Worktrees and the write root

A child that only reads works in the repository's checkout; its write root is the repository, and its handoff
says it does not write. A child that edits:

- `repo`: follows the worktree policy in the repository's own instructions. If they say nothing readable on
  worktrees, it works in a worktree.
- `always`: always in a worktree.
- `never`: in the repository's checkout, on a topic branch.

The write root (`SESSION_HUB_SCOPE_ROOT`) must contain every file the child writes, and must exist at the start:

| Where the worktree lives | Who makes it | Working directory | Write root |
|---|---|---|---|
| No worktree | — | the repository | the repository |
| Under the repository (`<repo>/.claude/worktrees/…`, or any folder inside it) | the child, as its repository's policy says | the repository | the repository |
| In a sibling folder (`<repo>-worktrees/<name>`, outside the repository) | the master, before the start: `git -C <repo> worktree add <path> -b <branch> <base>` | the worktree | the worktree |

Making a sibling worktree is the only thing the master does in a repository: it creates a checkout, and writes
no file of the work. Tell the user in the report, and leave its removal to the repository's own rules.
