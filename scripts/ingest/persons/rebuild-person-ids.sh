#!/usr/bin/env bash
# Elections metadata rebuild and person-id re-stamp, in the documented order.
#
# The steps, the merge loop and the retries of Windows file-lock errors are in
# rebuild-person-ids.mjs, an explicit state machine (state-machine catalogue IN-04); this file
# keeps the old command line working (npm run persons:rebuild, rebuild-changed.mjs).
#
# Exit 2 with "NEEDS RELATIVES HARVEST" means merge_person_ids found people whose
# electionsireland pages are not on file yet: run
#   python scripts/ingest/electionsireland/harvest_ei_candidate_ids.py --relatives <ids>
# with the ids it lists, then run this again.
#
#   bash scripts/ingest/persons/rebuild-person-ids.sh            log to tmp/rebuild-person-ids.log
set -uo pipefail
cd "$(dirname "$0")/../../.."
exec node scripts/ingest/persons/rebuild-person-ids.mjs "$@"
