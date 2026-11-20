#!/usr/bin/env bash
# Structural checks that `claude plugin validate --strict` does not make: every top-level folder with a
# .claude-plugin/plugin.json is a plugin named after its folder, with a semver version, no `skills` field and no
# marketplace.json; every skills/<name>/SKILL.md has a frontmatter `name` equal to its directory and a description.
#
# Usage: bash tests/validate.sh [repo-root]    (requires jq; bash 3.2 compatible)
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
NAME_RE='^[a-z0-9]+(-[a-z0-9]+)*$'
SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
RESERVED_RE='^(claude|anthropic)-'
ERRORS=0
PLUGINS=0

error() { echo "ERROR: $*"; ERRORS=$((ERRORS + 1)); }

frontmatter_value() {
    awk -v key="$1" '
        NR == 1 { if ($0 != "---") exit; next }
        /^---[ \t]*$/ { exit }
        index($0, key ":") == 1 { v = substr($0, length(key) + 2); sub(/^[ \t]+/, "", v); gsub(/^["\x27]|["\x27]$/, "", v); print v; exit }
    ' "$2"
}

for manifest in "$ROOT"/*/.claude-plugin/plugin.json; do
    [ -f "$manifest" ] || continue
    PLUGINS=$((PLUGINS + 1))
    dir="$(cd "$(dirname "$manifest")/.." && pwd)"
    folder="$(basename "$dir")"
    jq empty "$manifest" 2>/dev/null || { error "$manifest is not valid JSON"; continue; }
    name="$(jq -r '.name // ""' "$manifest")"
    version="$(jq -r '.version // ""' "$manifest")"
    [ "$name" = "$folder" ] || error "$folder: plugin name '$name' differs from its folder"
    [[ "$name" =~ $NAME_RE ]] || error "$folder: plugin name '$name' is not kebab-case"
    [[ "$name" =~ $RESERVED_RE ]] && error "$folder: plugin name '$name' uses a reserved prefix"
    [[ "$version" =~ $SEMVER_RE ]] || error "$folder: version '$version' is not semver"
    [ "$(jq 'has("skills")' "$manifest")" = "false" ] || error "$folder: plugin.json must not have a skills field"
    [ -e "$dir/.claude-plugin/marketplace.json" ] && error "$folder: stray marketplace.json"
    [ -f "$dir/README.md" ] || error "$folder: README.md is missing"
    if [ -d "$dir/skills" ]; then
        for sdir in "$dir"/skills/*/; do
            [ -d "$sdir" ] || continue
            skill="$(basename "$sdir")"
            file="$sdir/SKILL.md"
            [ -f "$file" ] || { error "$folder/skills/$skill: SKILL.md is missing"; continue; }
            sname="$(frontmatter_value name "$file")"
            [ "$sname" = "$skill" ] || error "$folder/skills/$skill: frontmatter name '$sname' differs from its directory"
            [ -n "$(frontmatter_value description "$file")" ] || error "$folder/skills/$skill: description is missing"
        done
    fi
done

[ "$PLUGINS" -gt 0 ] || error "no plugin folder found under $ROOT"
if [ "$ERRORS" -gt 0 ]; then echo "$ERRORS error(s)"; exit 1; fi
echo "OK: $PLUGINS plugin(s) checked"
