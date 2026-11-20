# Repository, marketplace and the retirement of `spawn-session`

## New repository

`MrBogomips/agent-orchestration`, cloned at `~/git/MrBogomips/agent-orchestration`.

Proposed layout, after the conventions of the `skills` repository (`~/git/MrBogomips/skills/AGENTS.md`):

```text
agent-orchestration/
├── AGENTS.md                 project instructions; CLAUDE.md is a symbolic link to it
├── DoD.md                    definition of done, adapted from the skills repository
├── README.md
├── LICENSE
├── docs/design/              the design files from this handoff, once approved
├── session-hub/
│   ├── .claude-plugin/plugin.json
│   ├── README.md
│   ├── skills/{spawn,dispatch,setup}/SKILL.md
│   ├── hooks/hooks.json      classic hook now; "modules" added with the mod
│   └── hooks/…
├── model-router/
│   ├── .claude-plugin/plugin.json
│   ├── README.md
│   ├── skills/{choose-model,setup}/SKILL.md
│   └── hooks/…               added with the mod
└── tests/
```

Conventions to carry over from the `skills` repository:

- Version in each plugin's `plugin.json`, bumped once per pull request: patch for a fix, minor for a compatible
  extension, major for a rename, removal or incompatible change.
- Conventional commits; base branch `main`; changes through pull requests.
- `claude plugin validate . --strict` in the checks; `claude plugin test <dir>` for the mods.
- Manual scenarios under `tests/scenarios/<skill>/` for skills that cannot be tested automatically. The existing
  scenarios for `spawn-session` are the starting point.
- Each plugin README says whether its skills work without the other plugin.

## Marketplace

The marketplace is `~/git/MrBogomips/claude-plugins` (`.claude-plugin/marketplace.json`). It holds no
plugin code. Its rules (`CLAUDE.md` there): no `version` in an entry; plugin names must not start with `claude-`
or `anthropic-`.

Two entries to add when the plugins are ready, in the style of the existing subfolder plugins:

```json
{ "name": "session-hub",  "source": { "source": "git-subdir", "url": "https://github.com/MrBogomips/agent-orchestration.git", "path": "session-hub" } },
{ "name": "model-router", "source": { "source": "git-subdir", "url": "https://github.com/MrBogomips/agent-orchestration.git", "path": "model-router" } }
```

Check the exact shape against the existing `kaizen` and `personal-voice` entries before writing.

## Retiring `spawn-session`

Settled: the old skill is retired from the `skills` plugin at the same time the new plugins enter the
marketplace.

Steps, in the `skills` repository:

1. Remove `skills/spawn-session/` and `tests/scenarios/spawn-session/` (moved to the new repository).
2. Update `README.md` and `AGENTS.md` where they list the skill.
3. Update the skills that mention it, if any (`handoff`, `done`, `pause` mention handoffs, not `spawn-session`;
   check with a search).
4. Bump the `skills` plugin's major version: a removal is an incompatible change.

## What changes for a hub that uses the old skill

A hub may get `spawn-session` in two ways:

- **Through the `skills` plugin.** After the retirement the skill disappears on update. The hub installs
  `session-hub` and, if wanted, `model-router`. A project can declare the marketplace and the enabled plugins in
  its shared settings so that team members are prompted to install them.
- **Through a lock file** (`skills-lock.json` with the `npx skills` installer, pinned to a commit of the `skills`
  repository). The pin keeps working until someone updates it. The hub removes the entry when it moves to
  `session-hub`. Agents other than Claude Code lose the skill; this is accepted (audience decision).

In the hub's instruction file:

- the *Child sessions* section stays where it is; `session-hub:setup` adds the new keys;
- references to `spawn-session` become `session-hub:spawn`;
- a rule that tells the master to keep notes on children no longer contradicts the skill.

A migration note belongs in the `session-hub` README, with the key-by-key mapping.
