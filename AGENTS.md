# AGENTS.md

Rules for every coding agent working in this repository.

- Session context: MRB-AGENTORCH

## What this repository is

Two Claude Code plugins, one top-level folder each: `session-hub` (a master session and the child sessions it
starts in a hub of repositories) and `model-router` (model and effort for sessions and subagents, with a quality
loop). Audience: a team on Claude Code; other agents are out of scope. Both are listed in the `mrbogomips`
marketplace (`~/git/MrBogomips/claude-plugins`).

## Layout

- `<plugin>/.claude-plugin/plugin.json`: `name` equals the folder, semver `version`, **no `skills` field**, no
  `marketplace.json`. Claude Code checks out only the plugin folder, so a plugin uses nothing outside it.
- `<plugin>/skills/<name>/SKILL.md`: frontmatter `name` equals the directory.
- `<plugin>/hooks/`: classic hooks and, from 0.2, the mod module in the same `hooks.json`.
- `<plugin>/README.md`: what it does and why; an **Installation** section saying whether it works without the
  other plugin.
- `tests/ci.sh`: the whole automated check, run by the `validate` workflow and the pre-push hook
  (`.githooks/pre-push`); `tests/validate.sh`: structural checks; `tests/pr-checks.mjs`: version bumps and
  attribution against the base branch; `*.test.mjs` next to the code they test (`node --test`);
  `tests/scenarios/<skill>/`: manual scenario checklists.
- `docs/design/` (authoritative), `docs/research/` (reference), `docs/manual/` (user manual), `drafts/` (working
  material, committed).
- `site/`: the documentation site (GitHub Pages, English and Italian), built by `site/build.mjs`; see
  `site/README.md`.

## Working documents

| Location | Role | Git |
|---|---|---|
| `docs/design/` | Authoritative design and spike results. Change the design here first, then the code. `docs/design/ui-design.md` holds the rules for every interface the plugins draw. | committed |
| `docs/research/` | Research behind the design; reference only. | committed |
| `docs/architecture.md` | Product architecture, written from the released code. | committed |
| `docs/manual/` | User manual: `manual.html` (source), `images/`, `user-manual.pdf` (built by `build.sh`), `tools/` (screenshot helpers). Update it with the code it describes. | committed |
| `site/` | Documentation site: pages, diagrams, screenshots, illustrations and its build. Update it with the code and the manual it describes. `site/dist/` is the build output. | committed (`site/dist/` ignored) |
| `drafts/` | Drafts and working documents that later sessions need. | committed |
| `.handoff/` | The original handoff zip. | ignored |

`docs/design/shared-contract.md` is what the two plugins may assume about each other: change it, in its own pull
request, before either plugin builds on the change.

## Rules that are not negotiable

- **No attribution** to any AI tool or vendor anywhere: commits, pull requests, comments, documents. No session
  or AI-service links, no co-author trailers.
- Guards in `session-hub` **fail closed**: a hook that cannot evaluate blocks and says why. The router in
  `model-router` **fails open**: an error leaves the request unchanged.
- **No state files inside a hub or a repository.** State lives under the active config folder
  (`CLAUDE_CONFIG_DIR`, else `~/.claude`), in `session-hub/` or `model-router/`.
- The skills and the classic hooks must work with mods turned off.
- Everything visible outside a plugin carries its name: `session-hub-scope-guard`, `[session-hub] …`,
  `SESSION_HUB_*`, `/model-router`. Skills hand off to each other as `<plugin>:<skill>` and detect at run time
  whether the other plugin is installed.
- Never copy code from the reference pack, except the MIT-licensed router, with its notice.
- Hooks and scripts: Node `.mjs`, no dependencies, macOS and Linux.
- Every interface a plugin draws follows `docs/design/ui-design.md`. On the Claude desktop app, VS Code and the mobile
  apps it follows the desktop app's design system, with native elements and theme colours, never the terminal's
  text art. Each pane offers its plugin's own log.
- Repository documents are in English.

## Git / PR Working Policy

- Worktree usage: enabled
- Worktree location: integrated (`.claude/worktrees/<name>/`, branch `worktree-<name>`; name as `feature-<slug>`)
- Base branch: main
- Recorded on: 2026-11-20

Conventional commits. Every change reaches `main` through a pull request with the `validate` check green.

## Versions

Each plugin has its own `version`, bumped once per pull request that changes it: patch for a fix, minor for a
compatible extension, major for a rename, removal or incompatible change. Mods declare the minimum Claude Code
version in `engines["claude-code"]` (mods exist from 2.1.287).

## Verification

```bash
bash tests/ci.sh origin/main
```

One script runs every automated check, in order: `tests/validate.sh` (structure; each plugin's version is its
newest `CHANGELOG.md` heading), the `*.test.mjs` unit tests, `tests/pr-checks.mjs` against the base ref given
(version bumps; no attribution in commits or pull request text), `site/check.mjs` (build, links, images,
translations), then `claude plugin validate --strict` and `claude plugin test` for each plugin. It runs every step,
lists the failed ones and exits 1 if any failed; a missing `claude` CLI is a failure.

The `validate` workflow runs the same script on every pull request and push to `main`, with the Claude Code CLI
pinned in `.github/workflows/validate.yml` (no login needed). `main` requires the `validate` check through a
repository ruleset: change the workflow's job name and the ruleset together. To run the check before each push:
`git config core.hooksPath .githooks` once per clone (skip one push with `git push --no-verify`).

## Done

The definition of done is `DoD.md`. Before saying that any development work is finished, go through it item by item
and state in the pull request what was checked and what is still open. A new or changed feature is never done
without its documentation: the plugin's README, the design in `docs/design/`, the user manual (`docs/manual/`) and
the documentation site (`site/`, Italian and English) are updated in the same pull request.
