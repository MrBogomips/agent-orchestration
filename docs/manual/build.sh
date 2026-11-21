#!/bin/sh
# Renders docs/manual/manual.html to docs/manual/user-manual.pdf with headless Chrome.
# CHROME may name the browser; the default is Google Chrome on macOS.
# The screenshots in images/ are made separately: tools/screenshots.sh retakes every model-router one (with
# demo-events.mjs, bounds.mjs, ansi2html.mjs and shot.sh); the session-hub ones were taken by hand with shot.sh.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
if [ ! -x "$chrome" ]; then
  echo "build.sh: Chrome not found at $chrome; set CHROME to its path" >&2
  exit 1
fi
"$chrome" --headless --no-pdf-header-footer --force-color-profile=srgb \
  --print-to-pdf="$here/user-manual.pdf" "file://$here/manual.html" 2>/dev/null
echo "$here/user-manual.pdf"
