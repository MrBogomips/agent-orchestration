#!/usr/bin/env bash
# The repository's whole automated check, the same locally, in the pre-push hook and in the `validate` workflow:
# structural checks, unit tests, the pull request checks (with a base ref), the documentation site, and for each
# plugin the strict manifest validation and the mod tests. Every step runs even after one fails; the run fails if
# any step failed, and a missing `claude` CLI is a failure, not a skip.
#
# Usage: bash tests/ci.sh [<base ref>]    (e.g. origin/main; PR_TITLE and PR_BODY reach the pull request checks)
# CI_ROOT overrides the repository root (tests only). bash 3.2 compatible.
set -uo pipefail

ROOT="${CI_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BASE="${1:-}"
FAILED=()

# Runs one named step, grouped in the GitHub Actions log, and records it if it fails.
step() {
    local name="$1"; shift
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::group::$name"; else echo "==> $name"; fi
    "$@"
    local code=$?
    [ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::"
    if [ "$code" -ne 0 ]; then
        FAILED+=("$name")
        [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$name failed (exit $code)"
    fi
    return 0
}

unit_tests() {
    local files=()
    while IFS= read -r f; do files+=("$f"); done < <(
        find . -path ./node_modules -prune -o -path ./.claude -prune -o -path ./site/dist -prune \
            -o -name '*.test.mjs' -print | sort
    )
    if [ "${#files[@]}" -eq 0 ]; then echo "no unit tests found"; return 1; fi
    node --test "${files[@]}"
}

claude_cli() {
    command -v claude >/dev/null 2>&1 || { echo "the claude CLI is not on PATH: install it to validate the plugins"; return 1; }
    claude "$@"
}

cd "$ROOT" || { echo "cannot enter $ROOT"; exit 1; }

step "structural checks" bash tests/validate.sh
step "unit tests" unit_tests
[ -n "$BASE" ] && step "version bumps and attribution against $BASE" node tests/pr-checks.mjs "$BASE"
step "documentation site" node site/check.mjs
for manifest in */.claude-plugin/plugin.json; do
    [ -f "$manifest" ] || continue
    plugin="${manifest%%/*}"
    step "$plugin manifest (strict)" claude_cli plugin validate "./$plugin" --strict
    step "$plugin mod tests" claude_cli plugin test "./$plugin"
done

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo
    for name in "${FAILED[@]}"; do echo "FAILED: $name"; done
    exit 1
fi
echo
echo "OK: every check passed"
