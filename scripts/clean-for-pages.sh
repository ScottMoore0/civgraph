#!/bin/bash
set -euo pipefail

# Trim the Cloudflare Pages asset output. This script is run in the
# temporary Pages build directory after the static bundles are generated.
#
# Keep this below Cloudflare's hard 20,000-file limit so drift fails locally
# with headroom instead of failing only after upload.
MAX_PAGES_FILES="${MAX_PAGES_FILES:-18500}"

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

# Build/source/reference material below is useful in the repository but is not
# fetched by the static runtime. Keeping it in a root-output Pages deployment
# pushes the asset count over Cloudflare's 20,000-file limit.
remove_path ".github"
remove_path "archive"
remove_path "boundary-gazette"
remove_path "docs"
remove_path "electionsni-reference"
remove_path "ocr_output"
remove_path "scripts"
remove_path "tasks"
remove_path "tests"

# Census CSV/reference dumps are local/source material and should not deploy as
# individual Pages assets. The one exception is data/census/explorer-bundle.json,
# which the Census Explorer frontend (pages/census-explorer.html) fetches at
# runtime — keep that single file and drop the rest of the tree.
if [ -f "data/census/explorer-bundle.json" ]; then
  # Move the one kept file aside, drop the whole tree, then restore it. Avoids a
  # find|xargs race where xargs rm -rf removes a directory while find is still
  # descending into it (which makes find exit non-zero and fail the build).
  mv "data/census/explorer-bundle.json" "data/.census-explorer-bundle.json.tmp"
  rm -rf "data/census"
  mkdir -p "data/census"
  mv "data/.census-explorer-bundle.json.tmp" "data/census/explorer-bundle.json"
  echo "Trimmed data/census (kept explorer-bundle.json) from Pages asset output"
elif [ -d "data/census" ]; then
  remove_path "data/census"
fi

# Provider mirror audits are local review/source-intake records. They are useful
# in Git when curated, but not part of the static runtime.
remove_path "data/provider-mirror-audit"

# Legacy/source election JSON is transformed into /test/metadata/elections-test2
# bundles during the build. The browser no longer fetches these raw source
# records directly, and deploying them costs several thousand Pages files.
remove_path "election-viewer-package/data/elections"

# Approved publication source input is build-time source material. Browse
# consumes the compact /data/browse/sources.json index plus sharded source
# details generated from it.
remove_path "data/database/approved-publication-sources.json"

# Full territorial transition sidecars are source-analysis assets. Runtime uses the
# deployable red/purple overlays in data/timeline-transition-overlays/ instead.
remove_path "data/timeline-transitions"
# Remove files exceeding Cloudflare Pages' 25 MB per-file limit.
find . -not -path './.git/*' -size +25M -delete

file_count=$(find . -type f -not -path './.git/*' | wc -l | tr -d ' ')
echo "Pages asset output files: ${file_count}/${MAX_PAGES_FILES}"
if [ "$file_count" -gt "$MAX_PAGES_FILES" ]; then
  echo "ERROR: Pages asset output still exceeds Cloudflare's ${MAX_PAGES_FILES}-file limit." >&2
  exit 1
fi

echo "Cleaned Pages asset output"
