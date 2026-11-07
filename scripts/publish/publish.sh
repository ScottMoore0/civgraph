#!/usr/bin/env bash
# The publish after the records cutover (data design phase 2, stage G.4).
#
# RUN ONLY WITH THE OWNER'S APPROVAL, through the wrapper the owner's allow rule names:
#   bash .claude/publish/publish.sh          (that file becomes: exec bash scripts/publish/publish.sh "$@")
#
# What changed from the old publish: no record files are staged or uploaded to R2 (the old
# objects stay where they are for the 90-day dual run; deleting them is a separate, approved
# step), and the three D1 loads (deploy:browse-indexes, deploy:elections-d1 and the full 342 MB
# elections reload) are replaced by one delta load of the records database with a bounded
# verify (scripts/records/verify-load.mjs: only the rows the delta wrote, by primary key, one
# statement per wrangler call; it never scans a table of the live database). Since data design
# phase 3 the map catalogue (maps.json), the layer metadata (maps-test.json), the catalogue pane's
# documents and the Browse map files are tables of the same load (scripts/records/ingest-maps.mjs),
# so there is no separate catalogue load and no R2 sync: nothing is uploaded to R2 at all.
#
#   --dry-run    build, then say what would be loaded and pushed; push, load and upload nothing
#   --downloads  also write the bulk downloads (tmp/records/downloads/); uploading them is the
#                S3 path with --i-have-reviewed-this-publication, a step of its own
#
# Order: refuse uncommitted changes; build the records database for HEAD (skipped when the
# inputs are unchanged); load the delta into D1 and verify it; push, so the Pages build that
# switches the Functions finds its tables already loaded.
#
# Each stage is a move of scripts/publish/publish-run.mjs (start, built, loaded or would-load,
# downloads, pushed, logged; refused and the three aborts), which refuses a move out of order
# and records the run in $WORK/publish-run.json, so a run after an abort says what the last one
# left (state-machine catalogue PL-01). Aborted runs are logged in publish.log too.
set -uo pipefail
cd "$(dirname "$0")/../.."
WORK=.claude/publish/work
mkdir -p "$WORK"
DRY= DOWNLOADS=
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --downloads) DOWNLOADS=1 ;;
    *) echo "unknown option: $a (use --dry-run, --downloads)"; exit 2 ;;
  esac
done
started=$(date +%s)
stamp() { echo "[$(( $(date +%s) - started ))s] $*"; }
stage() { node scripts/publish/publish-run.mjs "$WORK" "$@" || { echo "ABORT: the publish stage record refused: $*"; exit 1; }; }
# An abort: record the final stage and log the run (the abort itself is the caller's exit).
aborted() {
  node scripts/publish/publish-run.mjs "$WORK" to "$1" || true
  echo "$(date -u +%FT%TZ) $(git rev-parse --short HEAD) $(( $(date +%s) - started ))s${DRY:+ dry-run} aborted:$1" >> "$WORK/publish.log"
}
stage start ${DRY:+--dry}

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  if [ -n "$DRY" ]; then echo "(dry run) WARNING: uncommitted changes to tracked files; a real publish would abort"
  else echo "ABORT: uncommitted changes to tracked files; commit first"; aborted refused; exit 1; fi
fi

stamp "== records:build"
npm run -s records:build > "$WORK/records-build.log" 2>&1 || { echo "ABORT: records:build failed:"; tail -15 "$WORK/records-build.log"; aborted aborted-before-load; exit 1; }
stage to built
# Case-insensitive: the votes notice ("WARNING: CIVGRAPH_VOTES_DIR is unset ...") is upper case.
grep -iE '^records:build|warning' "$WORK/records-build.log" | head -8

stamp "== D1 (records, maps and catalogue included)"
if [ -n "$DRY" ]; then
  # Each dry run's output goes to a log. Its summary lines are shown, and when the DRY RUN line is
  # missing the log's tail is shown instead of nothing (a bare grep hid every failure).
  npm run -s records:deploy -- --remote --dry-run > "$WORK/records-deploy-dry.log" 2>&1
  grep -E '^DRY RUN|WARNING|migrations a real run|no migrations to apply|bounded statement' "$WORK/records-deploy-dry.log"
  grep -q '^DRY RUN' "$WORK/records-deploy-dry.log" || { echo "(dry run) records:deploy reported no delta:"; tail -12 "$WORK/records-deploy-dry.log"; }
  stage to would-load
else
  # The delta is idempotent and records:deploy retries each part; verify decides.
  npm run -s records:deploy -- --remote > "$WORK/records-deploy.log" 2>&1 || { echo "ABORT: records:deploy failed:"; tail -12 "$WORK/records-deploy.log"; aborted load-failed; exit 1; }
  tail -1 "$WORK/records-deploy.log"
  stage to loaded
fi

if [ -n "$DOWNLOADS" ]; then
  stamp "== downloads"
  npm run -s records:downloads 2>&1 | tail -1
  stage to downloads
fi

stamp "== push"
git log --oneline origin/main..HEAD
if [ -n "$DRY" ]; then
  echo "(dry run) nothing pushed, uploaded or loaded"
else
  git push -q origin HEAD:main || { echo "ABORT: push failed (D1 already holds this build; rerun after fixing)"; aborted aborted-after-load; exit 1; }
  git log --oneline -1 origin/main
  stage to pushed
fi
stamp "== done: nothing uploaded to R2"
echo "$(date -u +%FT%TZ) $(git rev-parse --short HEAD) $(( $(date +%s) - started ))s${DRY:+ dry-run}" >> "$WORK/publish.log"
stage to logged
