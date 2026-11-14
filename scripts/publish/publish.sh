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
# verify (packages/loader/src/verify-load.mjs: only the rows the delta wrote, by primary key, a few
# bounded statements per wrangler call; it never scans a table of the live database). Since data design
# phase 3 the map catalogue (maps.json), the layer metadata (maps-test.json), the catalogue pane's
# documents and the Browse map files are tables of the same load (packages/loader/src/ingest-maps.mjs),
# so there is no separate catalogue load and no R2 sync of records. The one R2 upload is the
# Elections app's extracts, and only when they changed (scripts/publish/elections-app-refresh.mjs).
#
#   --dry-run    decide, build (or reuse), then say what would be loaded and pushed; push, load,
#                upload, verify and deploy nothing
#   --downloads  also write the bulk downloads (tmp/records/downloads/); uploading them is
#                scripts/publish/r2-upload-downloads.mjs, a step of its own
#   --rebuild    build the records even when the build in place is of exactly these inputs (and so
#                take the full path)
#
# Order: refuse uncommitted changes; decide the path (scripts/publish/publish-path.mjs).
#   full: build the records database for HEAD, or reuse the build in place when its inputs manifest
#         equals the inputs now (scripts/publish/records-freshness.mjs); load the delta into D1; start
#         the safe verify of the live database in the background; rebuild and check the Elections
#         app's extracts and upload them to R2 if their manifest changed; push, so the Pages build
#         that switches the Functions finds its tables already loaded; record the pushed commit as
#         the base of the next decision.
#   code-only: nothing that feeds the records, D1 or R2 changed since the last load, so only push.
# Then, when CIVGRAPH_DIRECT_DEPLOY=1 and scripts/publish/deploy-pages.mjs exists, deploy the built
# site to Pages from this computer (off by default: Cloudflare builds from the push). Last, wait for
# the safe verify and print the summary. A failed safe verify is reported loudly and the run exits 3,
# but nothing is rolled back: D1 holds the load, and the next step is the owner's.
#
# Each stage is a move of scripts/publish/publish-run.mjs (start, built or code-only, loaded or
# would-load, downloads, pushed, deployed, logged; refused and the aborts), which refuses a move out
# of order and records the run in $WORK/publish-run.json, so a run after an abort says what the last
# one left (state-machine catalogue PL-01). Aborted runs are logged in publish.log too.
set -uo pipefail
cd "$(dirname "$0")/../.."
WORK=.claude/publish/work
mkdir -p "$WORK"
DRY= DOWNLOADS= REBUILD=
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --downloads) DOWNLOADS=1 ;;
    --rebuild) REBUILD=1 ;;
    *) echo "unknown option: $a (use --dry-run, --downloads, --rebuild)"; exit 2 ;;
  esac
done
started=$(date +%s)
stamp() { echo "[$(( $(date +%s) - started ))s] $*"; }
stage() { node scripts/publish/publish-run.mjs "$WORK" "$@" || { echo "ABORT: the publish stage record refused: $*"; exit 1; }; }
ROUTE=full RECORDS=- LOAD=- VERIFY=- ELECTIONS=- PUSH=- DEPLOY=- VERIFY_PID=
# The safe verify of the live database, started in the background after a load: wait for it and
# set VERIFY. A failure is loud and changes nothing; the load stays.
verify_wait() {
  [ -n "$VERIFY_PID" ] || return 0
  stamp "== safe verify (waiting for it)"
  wait "$VERIFY_PID"
  VERIFY_PID=
  local rc
  rc=$(cat "$WORK/safe-verify.status" 2>/dev/null || echo 1)
  if [ "$rc" = "0" ]; then
    VERIFY=PASS
    tail -3 "$WORK/safe-verify.log"
  else
    VERIFY="FAILED (exit $rc; $WORK/safe-verify.log)"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "!!! SAFE VERIFY FAILED: the live D1 may not equal the build just loaded."
    echo "!!! Nothing was rolled back. Read $WORK/safe-verify.log. After a budget or"
    echo "!!! 7429 stop: npm run records:verify:safe -- --remote --db $WORK/last-loaded.sqlite --resume"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    tail -15 "$WORK/safe-verify.log"
  fi
}
summary() {
  echo "== summary ($(( $(date +%s) - started ))s)"
  echo "  path:          $ROUTE"
  echo "  records:build: $RECORDS"
  echo "  D1 load:       $LOAD"
  echo "  safe verify:   $VERIFY"
  echo "  Elections app: $ELECTIONS"
  echo "  push:          $PUSH"
  echo "  deploy:        $DEPLOY"
}
# An abort: wait for a running verify, record the final stage, print the summary and log the run
# (the abort itself is the caller's exit).
aborted() {
  verify_wait
  node scripts/publish/publish-run.mjs "$WORK" to "$1" || true
  summary
  echo "$(date -u +%FT%TZ) $(git rev-parse --short HEAD) $(( $(date +%s) - started ))s${DRY:+ dry-run} $ROUTE aborted:$1 verify:${VERIFY%% *}" >> "$WORK/publish.log"
}
stage start ${DRY:+--dry}

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  if [ -n "$DRY" ]; then echo "(dry run) WARNING: uncommitted changes to tracked files; a real publish would abort"
  else echo "ABORT: uncommitted changes to tracked files; commit first"; aborted refused; exit 1; fi
fi

# Full or code-only (scripts/publish/publish-path.mjs). Anything but a last line of exactly
# "PATH code-only" on its standard output is the full path (its warnings go to a log of their own,
# so a warning printed after the decision cannot hide it, or fake it).
stamp "== publish path"
node scripts/publish/publish-path.mjs ${REBUILD:+--rebuild} ${DOWNLOADS:+--downloads} > "$WORK/publish-path.log" 2> "$WORK/publish-path.err"
sed 's/^/  /' "$WORK/publish-path.log"
if [ "$(tail -1 "$WORK/publish-path.log" | tr -d '\r')" = "PATH code-only" ]; then ROUTE=code-only; fi

if [ "$ROUTE" = "code-only" ]; then
  stage to code-only
  stamp "== records:build, D1 load, safe verify and Elections app extracts: SKIPPED (code-only path; why is listed above)"
  RECORDS="skipped (code-only)" LOAD="skipped (code-only)" VERIFY="skipped (nothing loaded)" ELECTIONS="skipped (code-only)"
else
  stamp "== records:build"
  FRESH=
  if [ -n "$REBUILD" ]; then echo "  building: --rebuild given"
  elif node scripts/publish/records-freshness.mjs > "$WORK/records-freshness.log" 2> "$WORK/records-freshness.err"; then FRESH=1
  else echo "  building: $(tail -1 "$WORK/records-freshness.log")"; fi
  if [ -n "$FRESH" ]; then
    echo "  SKIPPED: the build in place is of exactly these inputs ($(tail -1 "$WORK/records-freshness.log"))"
    RECORDS="reused (built from exactly these inputs)"
  else
    npm run -s records:build > "$WORK/records-build.log" 2>&1 || { echo "ABORT: records:build failed:"; tail -15 "$WORK/records-build.log"; RECORDS=failed; aborted aborted-before-load; exit 1; }
    # Case-insensitive: the votes notice ("WARNING: CIVGRAPH_VOTES_DIR is unset ...") is upper case.
    grep -iE '^records:build|warning' "$WORK/records-build.log" | head -8
    RECORDS=built
  fi
  stage to built

  stamp "== D1 (records, maps and catalogue included)"
  if [ -n "$DRY" ]; then
    # Each dry run's output goes to a log. Its summary lines are shown, and when the DRY RUN line is
    # missing the log's tail is shown instead of nothing (a bare grep hid every failure).
    npm run -s records:deploy -- --remote --dry-run > "$WORK/records-deploy-dry.log" 2>&1
    grep -E '^DRY RUN|WARNING|migrations a real run|no migrations to apply|bounded statement' "$WORK/records-deploy-dry.log"
    grep -q '^DRY RUN' "$WORK/records-deploy-dry.log" || { echo "(dry run) records:deploy reported no delta:"; tail -12 "$WORK/records-deploy-dry.log"; }
    stage to would-load
    LOAD="would load (dry run)" VERIFY="not run (dry run)"
  else
    # The delta is idempotent and records:deploy retries each part; verify decides.
    npm run -s records:deploy -- --remote > "$WORK/records-deploy.log" 2>&1 || { echo "ABORT: records:deploy failed:"; tail -12 "$WORK/records-deploy.log"; LOAD=failed; aborted load-failed; exit 1; }
    tail -1 "$WORK/records-deploy.log"
    stage to loaded
    LOAD=loaded
    # The safe verify of the live database against the snapshot just loaded: bounded range
    # checksums inside a rows_read budget (packages/loader/src/safe-verify.mjs), never the old
    # whole-table --check. It runs while the extracts are refreshed and the push goes out;
    # verify_wait collects it.
    stamp "== safe verify started in the background ($WORK/safe-verify.log)"
    rm -f "$WORK/safe-verify.status"
    ( npm run -s records:verify:safe -- --remote --db "$WORK/last-loaded.sqlite" > "$WORK/safe-verify.log" 2>&1; echo $? > "$WORK/safe-verify.status" ) &
    VERIFY_PID=$!
  fi

  # The Elections app's R2 extracts (data/elections-app/v1/), rebuilt from the records build just
  # loaded and checked; uploaded only when their manifest differs from R2's
  # (scripts/publish/elections-app-refresh.mjs). A failure aborts before the push.
  stamp "== Elections app extracts"
  if [ -n "$DRY" ]; then
    node scripts/publish/elections-app-refresh.mjs --dry-run > "$WORK/elections-app.log" 2>&1 || { echo "(dry run) FAIL: the Elections app refresh would abort the publish:"; tail -12 "$WORK/elections-app.log"; }
    grep -E '^elections-app|^\(dry run\)|^FAIL|^PASS' "$WORK/elections-app.log"
    ELECTIONS="checked (dry run)"
  else
    node scripts/publish/elections-app-refresh.mjs > "$WORK/elections-app.log" 2>&1 || { echo "ABORT: the Elections app refresh failed (D1 is loaded; nothing pushed):"; tail -15 "$WORK/elections-app.log"; ELECTIONS=failed; aborted aborted-after-load; exit 1; }
    grep -E '^elections-app|^Uploaded|^PASS' "$WORK/elections-app.log"
    ELECTIONS=refreshed
  fi

  if [ -n "$DOWNLOADS" ]; then
    stamp "== downloads"
    npm run -s records:downloads 2>&1 | tail -1
    stage to downloads
  fi
fi

stamp "== push"
git log --oneline origin/main..HEAD | head -20
if [ -n "$DRY" ]; then
  echo "(dry run) nothing pushed, uploaded or loaded"
  PUSH="not pushed (dry run)"
elif [ "$ROUTE" = "code-only" ]; then
  git push -q origin HEAD:main || { echo "ABORT: push failed (nothing was loaded; rerun after fixing)"; PUSH=failed; aborted push-failed; exit 1; }
  git log --oneline -1 origin/main
  stage to pushed
  PUSH="pushed $(git rev-parse --short HEAD)"
else
  git push -q origin HEAD:main || { echo "ABORT: push failed (D1 already holds this build; rerun after fixing)"; PUSH=failed; aborted aborted-after-load; exit 1; }
  git log --oneline -1 origin/main
  stage to pushed
  PUSH="pushed $(git rev-parse --short HEAD)"
  # D1 now holds the records of this commit: the base of the next path decision.
  node scripts/publish/publish-path.mjs --record-load
fi

# The direct Pages deploy (scripts/publish/deploy-pages.mjs, stream speed-deploy): off unless
# CIVGRAPH_DIRECT_DEPLOY=1, until the owner switches off the Pages project's builds from GitHub.
stamp "== deploy"
if [ "${CIVGRAPH_DIRECT_DEPLOY:-}" != "1" ]; then
  echo "  direct deploy off (CIVGRAPH_DIRECT_DEPLOY is not 1): Cloudflare Pages builds from the push"
  DEPLOY="by Cloudflare from the push (direct deploy off)"
elif [ ! -f scripts/publish/deploy-pages.mjs ]; then
  echo "  WARNING: CIVGRAPH_DIRECT_DEPLOY=1 but scripts/publish/deploy-pages.mjs is missing: not deployed from here"
  DEPLOY="not deployed from here (deploy-pages.mjs missing)"
elif [ -n "$DRY" ]; then
  node scripts/publish/deploy-pages.mjs --dry-run > "$WORK/deploy-pages.log" 2>&1 || echo "(dry run) FAIL: the direct deploy would fail:"
  tail -8 "$WORK/deploy-pages.log"
  DEPLOY="checked (dry run)"
elif node scripts/publish/deploy-pages.mjs > "$WORK/deploy-pages.log" 2>&1; then
  tail -4 "$WORK/deploy-pages.log"
  stage to deployed
  DEPLOY=deployed
else
  echo "ABORT: the direct Pages deploy failed after the push (D1 and GitHub are current; the site may still run the deployment before):"
  tail -15 "$WORK/deploy-pages.log"
  DEPLOY="FAILED ($WORK/deploy-pages.log)"
  aborted deploy-failed; exit 1
fi

verify_wait
stamp "== done"
summary
echo "$(date -u +%FT%TZ) $(git rev-parse --short HEAD) $(( $(date +%s) - started ))s${DRY:+ dry-run} $ROUTE verify:${VERIFY%% *}" >> "$WORK/publish.log"
stage to logged
case "$VERIFY" in FAILED*) exit 3 ;; esac
