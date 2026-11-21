#!/usr/bin/env bash
# Structural checks that `claude plugin validate --strict` does not make: every top-level folder with a
# .claude-plugin/plugin.json is a plugin named after its folder, with a semver version, no `skills` field and no
# marketplace.json, whose version is the newest "## <plugin> X.Y.Z" heading of CHANGELOG.md; every
# skills/<name>/SKILL.md has a closed frontmatter with a `name` equal to its directory and a description; and
# session-hub's copy of the shared look holds model-router's values (tests/shared-look.mjs).
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

# The value of a top-level frontmatter key. A block scalar (`>`, `|`, `>-`, `|-`, `>+`, `|+`) is read from the
# indented lines that follow it, joined with spaces, so an empty block reads as an empty value.
frontmatter_value() {
    awk -v key="$1" '
        NR == 1 { if ($0 != "---") exit; next }
        /^---[ \t]*$/ { exit }
        block {
            if ($0 ~ /^[ \t]+[^ \t]/) { line = $0; sub(/^[ \t]+/, "", line); v = v (v == "" ? "" : " ") line; next }
            if ($0 ~ /^[ \t]*$/) next
            exit
        }
        index($0, key ":") == 1 {
            v = substr($0, length(key) + 2); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
            if (v ~ /^[>|][-+]?$/) { v = ""; block = 1; next }
            gsub(/^["\x27]|["\x27]$/, "", v); print v; exit
        }
        END { if (block) print v }
    ' "$2"
}

# Whether the file opens a frontmatter with `---` and closes it with a later `---` line.
frontmatter_closed() {
    awk 'NR == 1 { if ($0 != "---") exit 1; next } /^---[ \t]*$/ { found = 1; exit } END { exit !found }' "$1"
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
    if [ -f "$ROOT/CHANGELOG.md" ]; then
        # The newest release of a plugin is its first "## <plugin> X.Y.Z" heading: it must be the manifest's version.
        logged="$(awk -v p="$name" '$1 == "##" && $2 == p { print $3; exit }' "$ROOT/CHANGELOG.md")"
        if [ -z "$logged" ]; then
            error "$folder: no \"## $name X.Y.Z\" heading in CHANGELOG.md"
        elif [ "$logged" != "$version" ]; then
            error "$folder: version $version differs from the newest CHANGELOG.md heading ($name $logged)"
        fi
    fi
    if [ -d "$dir/skills" ]; then
        for sdir in "$dir"/skills/*/; do
            [ -d "$sdir" ] || continue
            skill="$(basename "$sdir")"
            file="$sdir/SKILL.md"
            [ -f "$file" ] || { error "$folder/skills/$skill: SKILL.md is missing"; continue; }
            frontmatter_closed "$file" || { error "$folder/skills/$skill: the frontmatter has no closing ---"; continue; }
            sname="$(frontmatter_value name "$file")"
            [ "$sname" = "$skill" ] || error "$folder/skills/$skill: frontmatter name '$sname' differs from its directory"
            [ -n "$(frontmatter_value description "$file")" ] || error "$folder/skills/$skill: description is missing"
        done
    fi
done

[ "$PLUGINS" -gt 0 ] || error "no plugin folder found under $ROOT"
# session-hub draws a model and an effort with model-router's look from a copy of its values
# (docs/design/shared-contract.md, "A shared look"): the two copies must not differ.
if [ -f "$ROOT/session-hub/hooks/mod/look.mjs" ] && [ -f "$ROOT/model-router/lib/route-line.mjs" ]; then
    look="$(node "$ROOT/tests/shared-look.mjs" "$ROOT" 2>&1)" || error "the shared look differs between the plugins: $look"
fi
[ -f "$ROOT/CHANGELOG.md" ] || error "CHANGELOG.md is missing"
if [ "$ERRORS" -gt 0 ]; then echo "$ERRORS error(s)"; exit 1; fi
echo "OK: $PLUGINS plugin(s) checked"
