#!/bin/sh
# Retakes every model-router screenshot of the manual in one run, with the demo data of demo-events.mjs.
#
# It moves the real <config dir>/model-router/ aside (CLAUDE_CONFIG_DIR, else ~/.claude), writes the demo log in its
# place, drives a live Claude Code session in tmux in a demo clone, renders each capture with shot.sh into
# ../images/, and puts the real folder back, checked byte for byte against checksums taken before the move. Lines
# that other live sessions append to the log while the demo is in place are kept in the work folder and counted at
# the end: they are not written to the real log.
#
# Usage: sh screenshots.sh
# Needs: tmux, git, node, a logged-in claude, Google Chrome (CHROME may name it).
# Costs a few model calls, one of them an opus subagent at high effort.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
manual=$(dirname "$here")
repo=$(cd "$manual/../.." && pwd)
plugin=$repo/model-router
images=$manual/images
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
real=$cfg/model-router
work=$(mktemp -d "${TMPDIR:-/tmp}/mr-shots.XXXXXX")
work=$(cd "$work" && pwd -P)
saved=$work/real-model-router
# The demo clone sits at a short path, so the view shows it whole (its titles are cut to the pane) and the
# captures can name it /work/hub/product. MR_SHOTS_HUB moves it; it must not exist yet.
hub=${MR_SHOTS_HUB:-/tmp/hub}
clone=$hub/product
if [ -e "$hub" ]; then echo "screenshots.sh: $hub exists; remove it or set MR_SHOTS_HUB" >&2; exit 1; fi
tmux_session=mr-shots-$$
cols=200
rows=62

checksums() { (cd "$1" && find . -type f | LC_ALL=C sort | while read -r f; do shasum -a 256 "$f"; done); }

restore() {
  status=$?
  # The session writes its session-end record as it exits: let it, before the real folder comes back.
  if tmux has-session -t "$tmux_session" 2>/dev/null; then
    tmux send-keys -t "$tmux_session" C-c 2>/dev/null || true
    sleep 1
    tmux send-keys -t "$tmux_session" C-c 2>/dev/null || true
    n=0
    while tmux has-session -t "$tmux_session" 2>/dev/null && [ "$n" -lt 15 ]; do sleep 1; n=$((n + 1)); done
    tmux kill-session -t "$tmux_session" 2>/dev/null || true
    sleep 3
  fi
  if [ -d "$saved" ]; then
    if [ -f "$real/events.jsonl" ] && [ -n "${demo_lines:-}" ]; then
      tail -n +"$((demo_lines + 1))" "$real/events.jsonl" > "$work/appended.jsonl" || true
    fi
    rm -rf "$work/demo-model-router"
    [ -d "$real" ] && mv "$real" "$work/demo-model-router"
    mv "$saved" "$real"
    checksums "$real" > "$work/after.sha"
    if cmp -s "$work/before.sha" "$work/after.sha"; then
      echo "restored $real: checksums match ($(wc -l < "$work/after.sha" | tr -d ' ') files, $(shasum -a 256 "$work/after.sha" | cut -c1-16))"
    else
      echo "RESTORE MISMATCH: compare $work/before.sha and $work/after.sha" >&2
      status=1
    fi
    if [ -s "$work/appended.jsonl" ]; then
      echo "$(wc -l < "$work/appended.jsonl" | tr -d ' ') lines were appended to the demo log meanwhile (this run's session and any other live session): $work/appended.jsonl"
    fi
  fi
  [ -n "${hub_real:-}" ] && rm -rf "$hub_real"
  echo "work folder: $work"
  exit "$status"
}
trap restore EXIT
trap 'exit 130' INT TERM

capture() { tmux capture-pane -t "$tmux_session" -p -e > "$1"; }
screen() { tmux capture-pane -t "$tmux_session" -p; }
keys() { tmux send-keys -t "$tmux_session" "$@"; }

# Waits until the screen shows the pattern (grep -E), for at most $2 seconds.
wait_for() {
  n=0
  until screen | grep -Eq "$1"; do
    n=$((n + 1))
    [ "$n" -le "$2" ] || { echo "screenshots.sh: timed out waiting for: $1" >&2; screen | tail -20 >&2; return 1; }
    sleep 1
  done
}

# Waits until at least $2 lines of the screen match the pattern, for at most $3 seconds.
wait_count() {
  n=0
  until [ "$(screen | grep -Ec "$1")" -ge "$2" ]; do
    n=$((n + 1))
    [ "$n" -le "$3" ] || { echo "screenshots.sh: timed out waiting for $2 lines of: $1" >&2; return 1; }
    sleep 1
  done
}

# Types a line at the prompt and submits it.
type_line() {
  keys -l "$1"
  sleep 1
  keys Enter
}

# Renders a capture with the part bounds.mjs finds, the demo clone's path shown as the manual's demo hub.
render() {
  name=$1
  shift
  # shellcheck disable=SC2046
  sh "$here/shot.sh" "$work/$name.ansi" "$images/$name.png" $(node "$here/bounds.mjs" "$work/$name.ansi" "$@") \
    --replace "$hub_real=>/work/hub" --replace "$hub=>/work/hub" --replace "$HOME=>~"
}

# 1. The real data aside, the demo data in its place.
if [ -d "$real" ]; then
  checksums "$real" > "$work/before.sha"
  mv "$real" "$saved"
fi
node "$here/demo-events.mjs" "$cfg"
demo_lines=$(wc -l < "$real/events.jsonl" | tr -d ' ')

# 2. A demo clone whose remote gives it the demo product's project id.
mkdir -p "$clone/src" "$clone/test"
hub_real=$(cd "$hub" && pwd -P)
printf 'export function exportCsv(rows) {\n  return rows.map((r) => r.join(",")).join("\\n");\n}\n' > "$clone/src/export.js"
printf 'import { exportCsv } from "../src/export.js";\n' > "$clone/test/export.test.js"
printf '# product\n\nThe demo product repository.\n' > "$clone/README.md"
git -C "$clone" init -q
git -C "$clone" remote add origin https://example.com/demo/product.git
git -C "$clone" add -A
git -C "$clone" -c user.name=demo -c user.email=demo@example.com commit -q -m "chore: demo"

# 3. A live session on the plugin folder, the installed copy turned off, in the fullscreen layout so the view docks.
tmux new-session -d -s "$tmux_session" -x "$cols" -y "$rows" -c "$clone" \
  -e COLORTERM=truecolor -e CLAUDE_CODE_NO_FLICKER=1 \
  "claude --plugin-dir '$plugin' --settings '{\"enabledPlugins\":{\"model-router@mrbogomips\":false}}' --model sonnet --effort low --permission-mode auto"
sleep 6
if screen | grep -q "trust this folder"; then keys Down; sleep 1; keys Enter; sleep 6; fi
wait_for '^❯' 60

# 4. The choose-model line under Agent calls: a start with no model (judged), one with an explicit model and effort,
#    and one the judge keeps; one call per message, so that each is its own row.
type_line "Make these three Agent calls one after another, one call per message, then stop. Load no skill and pass only what is listed. 1) general-purpose, description \"[mr:read-search] Find the CSV writer\", prompt \"Which file defines exportCsv? Answer with the path.\" 2) general-purpose, description \"[mr:review-debug] Review the export code\", model opus, effort high, prompt \"Review src/export.js in three bullets.\" 3) general-purpose, description \"[mr:edit-specified] Add a test for exportCsv\", prompt \"Describe in one sentence a test for exportCsv; change no file.\""
wait_for 'Add a test for exportCsv\)' 180
wait_count '🔀' 3 60
sleep 5
capture "$work/mr-agent-lines.ansi"
render mr-agent-lines lines '^⏺ (Agent|Explore)\(\[mr:read-search\]' '🔀' 1

# 5. The usage view, docked: each tab over the last 7 days, then Classes over 30 days and at the project level.
type_line "/model-router"
wait_for '│🔀 model-router' 30
wait_for 'Data read' 30
sleep 2
capture "$work/mr-overview.ansi"
render mr-overview dock
for tab in models classes decisions; do
  keys Tab
  sleep 2
  capture "$work/mr-$tab.ansi"
  render "mr-$tab" dock
done
keys BTab
sleep 2
keys m
sleep 2
capture "$work/mr-classes-30d.ansi"
render mr-classes-30d dock
keys p
sleep 2
capture "$work/mr-classes-project.ansi"
render mr-classes-project dock
keys Escape
sleep 2

# 6. The help, printed in the transcript.
type_line "/model-router help"
wait_for 'Where no pane fits' 30
sleep 1
capture "$work/mr-help.ansi"
render mr-help lines '^❯ /model-router help' 'Where no pane fits'

# 7. The report page, from a copy of the demo data under a demo home, its path shown as ~/.claude.
mkdir -p "$work/home/.claude"
cp -R "$real" "$work/home/.claude/model-router"
node "$plugin/scripts/report.mjs" --config-dir "$work/home/.claude" --no-open > /dev/null
WORK_HOME="$work/home" perl -pi -e 's{\Q$ENV{WORK_HOME}\E}{~}g' "$work/home/.claude/model-router/report.html"
# preferredColorScheme=1 is the light theme (0, with --force-dark-mode, the dark one).
"$chrome" --headless --hide-scrollbars --force-device-scale-factor=2 \
  --blink-settings=preferredColorScheme=1 --window-size=750,1000 \
  --screenshot="$images/mr-report.png" "file://$work/home/.claude/model-router/report.html" > /dev/null 2>&1
echo "$images/mr-report.png"
