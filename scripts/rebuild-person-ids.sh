#!/usr/bin/env bash
# Elections metadata rebuild and person-id re-stamp, in the documented order.
#
# The order matters: running the election manifest on its own and committing wipes every
# personId and name_id it writes, so the registry steps must follow it every time.
# Retries Windows file-lock errors (EBUSY/EPERM/Errno 22), which a sync client or an editor
# holding a file open can cause mid-run.
#
# Exit 2 with "NEEDS RELATIVES HARVEST" means merge_person_ids found people whose
# electionsireland pages are not on file yet: run
#   python scripts/harvest_ei_candidate_ids.py --relatives <ids>
# with the ids it lists, then run this again.
#
#   bash scripts/rebuild-person-ids.sh            log to tmp/rebuild-person-ids.log
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p tmp
LOG=${LOG:-tmp/rebuild-person-ids.log}
: > "$LOG"
run() {
  for attempt in 1 2 3 4; do
    "$@" >> "$LOG" 2>&1 && return 0
    if tail -30 "$LOG" | grep -q "Errno 22\|UNKNOWN\|EBUSY\|EPERM"; then echo "retry $attempt: $*" >> "$LOG"; sleep 5; continue; fi
    echo "FAILED: $*" | tee -a "$LOG"; return 1
  done
  echo "FAILED after retries: $*" | tee -a "$LOG"; return 1
}
run node scripts/build-test2-election-manifest.mjs ${MANIFEST_ARGS:-} || exit 1
run node scripts/build-test2-election-summaries.mjs || exit 1
run python scripts/build_person_registry_v2.py --force || exit 1
run python scripts/apply_person_ids_v2.py || exit 1
for i in 1 2 3 4 5 6; do
  run python scripts/merge_person_ids.py || exit 1
  if tail -40 "$LOG" | grep -q "without their pages on file"; then
    echo "NEEDS RELATIVES HARVEST" | tee -a "$LOG"
    tail -40 "$LOG" | grep -A3 "without their pages" | tee -a "$LOG"
    exit 2
  fi
  if tail -15 "$LOG" | grep -qi "nothing to merge"; then echo "merge loop done after $i pass(es)" >> "$LOG"; break; fi
  run python scripts/apply_person_ids_v2.py || exit 1
done
run python scripts/build_name_registry.py || exit 1
run python scripts/audit_person_ids.py || exit 1
echo "PERSON IDS OK" | tee -a "$LOG"
