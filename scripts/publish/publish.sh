#!/usr/bin/env bash
# The publish after the records cutover (data design phase 2, stage G.4).
#
# RUN ONLY WITH THE OWNER'S APPROVAL, through the wrapper the owner's allow rule names:
#   bash .claude/publish/publish.sh          (that file becomes: exec bash scripts/publish/publish.sh "$@")
#
# What changed from the old publish: no Browse or graph files are staged or uploaded to R2
# (the old objects stay where they are for the 90-day dual run; deleting them is a separate,
# approved step), and the three D1 loads (deploy:browse-indexes, deploy:elections-d1 and the
# full 342 MB elections reload) are replaced by one delta load of the records database with a
# checksum verify. The catalogue keeps its own load until phase 3.
#
#   --dry-run    build, then say what would be loaded and pushed; push, load and upload nothing
#   --downloads  also write the bulk downloads (tmp/records/downloads/); uploading them is the
#                S3 path with --i-have-reviewed-this-publication, a step of its own
#
# Order: refuse uncommitted changes; build the records database for HEAD (skipped when the
# inputs are unchanged); load the delta into D1 and verify it; load the catalogue; push, so the
# Pages build that switches the Functions finds its tables already loaded.
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

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  if [ -n "$DRY" ]; then echo "(dry run) WARNING: uncommitted changes to tracked files; a real publish would abort"
  else echo "ABORT: uncommitted changes to tracked files; commit first"; exit 1; fi
fi

stamp "== records:build"
npm run -s records:build > "$WORK/records-build.log" 2>&1 || { echo "ABORT: records:build failed:"; tail -15 "$WORK/records-build.log"; exit 1; }
# Case-insensitive: the votes notice ("WARNING: CIVGRAPH_VOTES_DIR is unset ...") is upper case.
grep -iE '^records:build|warning' "$WORK/records-build.log" | head -8

stamp "== D1 (records, catalogue)"
if [ -n "$DRY" ]; then
  npm run -s records:deploy -- --remote --dry-run 2>&1 | grep '^DRY RUN'
  npm run -s deploy:catalogue -- --dry-run 2>&1 | grep '^DRY RUN'
else
  # The delta is idempotent and records:deploy retries each part; verify decides.
  npm run -s records:deploy -- --remote > "$WORK/records-deploy.log" 2>&1 || { echo "ABORT: records:deploy failed:"; tail -12 "$WORK/records-deploy.log"; exit 1; }
  tail -1 "$WORK/records-deploy.log"
  ok=
  for attempt in 1 2 3 4; do
    if out=$(npm run -s deploy:catalogue 2>&1); then ok=1; break; fi
    echo "deploy:catalogue attempt $attempt failed; waiting 90s"; sleep 90
  done
  [ -n "$ok" ] || { echo "deploy:catalogue FAILED 4 times:"; echo "$out" | tail -5; exit 1; }
  echo "$out" | grep -viE 'deprecation|trace-warnings|^$' | tail -1
fi

if [ -n "$DOWNLOADS" ]; then
  stamp "== downloads"
  npm run -s records:downloads 2>&1 | tail -1
fi

stamp "== push"
git log --oneline origin/main..HEAD
if [ -n "$DRY" ]; then
  echo "(dry run) nothing pushed, uploaded or loaded"
else
  git push -q origin HEAD:main || { echo "ABORT: push failed (D1 already holds this build; rerun after fixing)"; exit 1; }
  git log --oneline -1 origin/main
fi
stamp "== done: 0 record files uploaded to R2"
echo "$(date -u +%FT%TZ) $(git rev-parse --short HEAD) $(( $(date +%s) - started ))s${DRY:+ dry-run}" >> "$WORK/publish.log"
