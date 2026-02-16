# Animation integration test plan

This checklist supplements the transfer lookup documentation and focuses on
validating the NICVA-style animation pipeline end to end. It is intended for
engineers performing regression checks after changes to the workbook import,
API payload, or browser runtime.

## 1. Automated smoke tests

Run the focused pytest module to ensure the server payload exposes the
authoritative transfer map and list that the animation expects:

```bash
pytest tests/test_routes_authoritative_transfer_payload.py
```

The test constructs a minimal Assembly election subset and asserts that
`_prepare_election_payload` threads the cached lookup through both
`authoritative_transfer_lookup` (dict) and `authoritative_transfer_events`
(sorted list). It also confirms the response is a deep copy, so mutating the
JSON sent to the browser cannot corrupt the shared cache.

If pandas is not installed in the execution environment the test will be
skipped; install the optional dependency locally to exercise the full pathway.

## 2. API spot checks

1. Launch the web application with the usual development command (for example,
   `FLASK_APP=ni_votes.web.app flask run`).
2. Query `/api/search_elections` with a payload that includes at least one STV
   election. Inspect the JSON and confirm the presence of:
   * `authoritative_transfer_lookup` keyed by count number; and
   * `authoritative_transfer_events`, ordered by count and ready for direct
     iteration.
3. Spot check that combined donor labels (e.g., "Surplus of A & B") match the
   wording in the workbook and that counts without transfers omit the
   additional keys.

## 3. Front-end verification

With the development server still running:

1. Load the election viewer and click **Load animation** for an STV election
   with multiple counts.
2. Step through the counts using the first/previous/next controls. Confirm the
   stage indicators, quota marker, and metadata banner update in sync.
3. On a count that redistributes a combined surplus or exclusion:
   * Observe the donor rectangle peel away from the candidate bar, stage at the
     hub, then split into the per-destination blocks defined in the transfer
     lookup.
   * Verify that non-transferable segments land on the dedicated bar and that
     exhausted votes absorb rounding differences.
4. Toggle **Unload animation** and reload to ensure timers, staged blocks, and
   ordering reset cleanly.

Document any discrepancies (incorrect donor labels, missing segments, or
animation glitches) against the count number so they can be cross-referenced
with the authoritative transfer data.

## 4. Scenario builder viewer regression

The scenario builder now shares the election viewer components. After running a
scenario in the web UI you should be redirected automatically to
`/job_result?job_id=...`. Verify the following on that page:

1. The **candidate results** table lists every candidate from the scenario with
   first-preference and per-count totals.
2. The **party results** table mirrors the one shown in the election viewer and
   includes vote and seat tallies per party.
3. A **static transfer preview** image appears. When the scenario contains more
   than one count, clicking the image should open the animation modal and allow
   stepping through counts using the familiar controls.

Capture console logs and the scenario JSON if any element is missing. The
server emits the same payload contract used by the election viewer, so the
behaviour should remain identical to a workbook-backed election listing.
