#!/bin/bash
# Kept only so the Pages build command set in the Cloudflare dashboard,
#   npm install --ignore-scripts && npm run build && bash scripts/build/clean-for-pages.sh
# keeps working after data phase 4. The output is now dist/ (wrangler.toml
# pages_build_output_dir), built from an explicit allow-list by scripts/build/site.mjs;
# nothing is deleted from the repository root any more. Once the dashboard command is
#   npm install --ignore-scripts && npm run build:site
# this file can be deleted.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/build/site.mjs
