#!/usr/bin/env bash
# Deploy the committed HEAD to the private preview project, so a change can be checked on a
# phone before it is approved and published.
#
# Why not a preview branch: this repository is public, so pushing a branch to GitHub to get
# a Pages preview would publish its contents before anyone approved them, and Pages preview
# URLs on the production project are reachable by anyone who has the link. This uploads
# straight from this machine to a SEPARATE Pages project, civgraph-preview, which should sit
# behind Cloudflare Access (see "One-time setup").
#
#   bash scripts/publish/deploy-preview.sh          prints the preview URL when done
#
# What the preview is:
#   - the committed tree (git archive HEAD), built into dist/ exactly as the Pages build
#     builds it (scripts/build/site.mjs; app/build/ is not in the archive, so the map app
#     needs `npm run build` in the stage first if the change touches it);
#   - static only. wrangler.toml and functions/ are left out, so the preview project can
#     never be handed production's D1, KV or R2 bindings. /_api therefore answers 404, and
#     the app falls back to the static data in the commit -- which is what the change will
#     look like once its databases are deployed.
#
# One-time setup (needs the owner, not run by this script):
#   npx wrangler pages project create civgraph-preview --production-branch main
#   then, in the Cloudflare dashboard: Zero Trust > Access > Applications, protect
#   civgraph-preview.pages.dev (and *.civgraph-preview.pages.dev) to the owner's login.
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=tmp/preview-stage
rm -rf "$STAGE"
mkdir -p "$STAGE"
git archive HEAD | tar -x -C "$STAGE"
rm -f "$STAGE/wrangler.toml"
rm -rf "$STAGE/functions"
(cd "$STAGE" && git init -q && git add -A && node scripts/build/site.mjs > /dev/null)

env -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY -u R2_S3_ENDPOINT \
  npx wrangler pages deploy "$STAGE/dist" --project-name civgraph-preview --branch main --commit-hash "$(git rev-parse HEAD)" --commit-dirty=true \
  2>&1 | grep -E "https://|Success|error|Error" | tail -5
