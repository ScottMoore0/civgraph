#!/bin/bash
set -euo pipefail

# Trim the Cloudflare Pages asset output. This script is run in the
# temporary Pages build directory after the static bundles are generated.
MAX_PAGES_FILES="${MAX_PAGES_FILES:-20000}"

remove_path() {
  local path="$1"
  if [ -e "$path" ]; then
    rm -rf "$path"
    echo "Removed $path from Pages asset output"
  fi
}

# /test vector tile payloads are served from R2/CDN as PMTiles in production.
# Directory-MVT pyramids are local build/fallback artifacts and exceed the
# Pages 20,000-file deployment cap.
remove_path "test/tiles/generated"
remove_path "test/tiles/civil-parishes-v3"
remove_path "test/pmtiles/generated"

# Dependencies are needed for the build command, not as static site assets.
# Remove them in Pages/CI builds so a root-output deployment cannot count them.
if [ "${CF_PAGES:-}" = "1" ] || [ "${CI:-}" = "true" ]; then
  remove_path "node_modules"
fi

# Remove files exceeding Cloudflare Pages' 25 MB per-file limit.
find . -not -path './.git/*' -size +25M -delete

file_count=$(find . -type f -not -path './.git/*' | wc -l | tr -d ' ')
echo "Pages asset output files: ${file_count}/${MAX_PAGES_FILES}"
if [ "$file_count" -gt "$MAX_PAGES_FILES" ]; then
  echo "ERROR: Pages asset output still exceeds Cloudflare's ${MAX_PAGES_FILES}-file limit." >&2
  exit 1
fi

echo "Cleaned Pages asset output"
