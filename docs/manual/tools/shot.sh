#!/bin/sh
# Renders a terminal capture to PNG: ansi2html.mjs, then headless Chrome at the size the page needs.
# Usage: sh shot.sh <capture> <out.png> [ansi2html options]
# CHROME may name the browser; the default is Google Chrome on macOS.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
capture=$1
out=$2
shift 2
html="${out%.png}.capture.html"
size=$(node "$here/ansi2html.mjs" "$capture" "$html" "$@")
"$chrome" --headless --hide-scrollbars --force-device-scale-factor=2 --window-size="$size" \
  --screenshot="$out" "file://$html" >/dev/null 2>&1
rm -f "$html"
echo "$out ($size)"
