# session-hub scenarios

Manual checklists for the `session-hub` plugin. Each run needs a live master session with the plugin enabled
(`claude --plugin-dir <checkout>/session-hub`, or installed from the marketplace). Note the Claude Code version
and the environment in the pull request that ran them.

| File | What it covers |
|---|---|
| [scenario-pilot.md](scenario-pilot.md) | `spawn` in each environment: start, launch command, role variables, model and effort, layout, first run, duplicates, record. Ported from `spawn-session`. |
| [scenario-scope-guard.md](scenario-scope-guard.md) | The scope guard in a live child: a blocked write, the message to the master, no retry through the shell. |
| [scenario-example-hub.md](scenario-example-hub.md) | The six scenarios of `docs/research/example-hub.md`: `dispatch`, routing, status after compaction, replacing a child. |
| [scenario-setup.md](scenario-setup.md) | `setup` on a new hub and on a hub configured for `spawn-session`. |

## Fixture

Build the hub **under the home folder**: a hub under the system temporary folder loaded no project instruction
file in the spikes (`docs/design/spikes.md`, S5).

```bash
H="$HOME/tmp-session-hub-fixture/hub"
rm -rf "$H" && mkdir -p "$H"
git -C "$H" init -q -b main
for r in design product prototype; do
  mkdir -p "$H/$r/.claude/skills/hello-$r" "$H/$r/.claude/agents" "$H/$r/docs"
  git -C "$H/$r" init -q -b main
  printf '# %s\n\nWork on feature branches. Agents never merge.\n' "$r" > "$H/$r/AGENTS.md"
  ln -s AGENTS.md "$H/$r/CLAUDE.md"
  printf -- '---\nname: hello-%s\ndescription: Says hello from %s. Use when asked to say hello.\n---\n\nReply "hello from %s".\n' \
    "$r" "$r" "$r" > "$H/$r/.claude/skills/hello-$r/SKILL.md"
  printf -- '---\nname: %s-reviewer\ndescription: Reviews %s changes.\n---\n\nReview the diff.\n' \
    "$r" "$r" > "$H/$r/.claude/agents/$r-reviewer.md"
  printf '# %s notes\n\nA typo: teh.\n' "$r" > "$H/$r/docs/notes.md"
  git -C "$H/$r" add -A && git -C "$H/$r" commit -qm init
done
printf 'design/\nproduct/\nprototype/\n' > "$H/.gitignore"
mkdir -p "$H/backlog"
printf '# Tasks\n\n- T-1: ping endpoint and button\n' > "$H/backlog/tasks.md"
cat > "$H/AGENTS.md" <<'EOF'
# Hub

Marker: HUB-RULES-LOADED.

## Confidentiality

Never name the client in commits.

## Backlog

Only the master writes `backlog/`. Note every pull request on its task.
EOF
ln -s AGENTS.md "$H/CLAUDE.md"
echo "$H"
```

The repositories are new to Claude Code: the first run in each also covers *First run in a repository*. For the
other checks, open each repository once yourself (`claude` there, accept the trust prompt). Trust is not
inherited from the hub.

After each run, check that nothing was written inside the hub apart from what the children and the user's
explicit yes produced (`git -C "$H" status`, and `git status` in each repository), and that the children record
sits under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-hub/`.
