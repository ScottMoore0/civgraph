# Current Task: Local Election DEA/LGD Feature-Page Electoral History (2026-03-04)

- [x] Keep local election catalogue cards grouped by date with provider label `Local Government Districts`
- [x] Ensure 2018 Carrick Castle local by-election exists as a separate date entry in local election data/index
- [x] Keep NI-wide local tables showing `Local Government District` plus `District Electoral Area`
- [x] Route local DEA/LGD table links to feature pages (not separate entity pages)
- [x] Expand feature pages for DEA/LGD links to include electoral-history tables
- [x] Keep transfer animation right-edge anti-clipping width/padding fix in place
- [x] Rebuild local election JSON/index and verify dates include 2014, 2018, 2019, 2023

- Symptom: DEA/LGD links initially opened dedicated election-entity detail pages, while the requirement was to open feature pages with electoral-history data included there.
- Root cause: link target and detail model diverged from requested UX contract (feature page as canonical destination).
- Permanent prevention action:
  1) keep geography links (`DEA`, `LGD`, constituency) mapped to feature-detail navigation,
  2) inject election-history context into feature-detail cache entries when opening from election tables,
  3) keep election-entity pages for people/parties, not for geographic feature links unless explicitly requested.
- Verification evidence:
  1) `node --check js/election-controller.js`, `node --check js/ui-controller.js`, `node --check js/app.js` pass,
  2) local rebuild command succeeded: `python privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py`,
  3) rebuild output confirms local dates: `2014-05-22`, `2018-10-18`, `2019-05-02`, `2023-05-18`.

# Current Task: Remove `‡` From All Election Name Surfaces And Keep STV Surplus Stages Single-Event (2026-03-04)

- [x] Add UI-level dagger sanitization in `js/election-controller.js` for results-table and candidate display name resolution
- [x] Add animation-level dagger sanitization in `election-viewer-package/js/stages2.js` for candidate labels and forum sequence names
- [x] Add build-time candidate text sanitization in `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py`
- [x] Rebuild local-election JSON from clean normalized workbook and re-verify no stage-collision defects
- [x] Verify no `‡` remains in generated local-election JSON

- Symptom: `‡` still surfaced in candidate names, and local-election By Count output again showed counts where more than one surplus/exclusion event was effectively encoded in the same count.
- Root cause:
  1) display/animation code paths still trusted raw name strings and could surface dagger markers from stale source artifacts,
  2) local JSON build had switched to a stale remapped workbook (`lgov-modern-wikipedia.stvfix.remapped.xlsx`) that reintroduced stage-collision defects.
- Permanent prevention action:
  1) centralize candidate-name cleaning at render time (`_candidateDisplayName` / `stripCandidateDagger`) so dagger markers are always stripped in UI output,
  2) sanitize candidate text at build time in the local JSON builder,
  3) use clean normalized workbook as source-of-truth for STV stage integrity and verify stage-collision audit after rebuild.
- Verification evidence:
  1) `node --check js/election-controller.js` and `node --check election-viewer-package/js/stages2.js` pass,
  2) `python -m py_compile privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` passes,
  3) local JSON rebuild succeeds from `lgov-modern-wikipedia.stvfix.normalised.xlsx`,
  4) `rg -n "‡" election-viewer-package/data/elections/local-government -S` returns `NO_DAGGER_MATCHES`,
  5) stage-collision audit reports `stage_collision_issues 0`.

# Current Task: Fix PersonID Canonical Override Misses In Local Results Tables (2026-03-04)

- [x] Diagnose why PersonID-anchored canonical overrides were not applying in local results generation
- [x] Fix builder PersonID normalization and source selection so approved local->full ID mappings are used
- [x] Rebuild local-government JSON outputs and verify canonical match coverage

- Symptom: wrong candidate/party names still appeared in local-election result tables even after adding PersonID-based canonical override logic.
- Root cause: two pipeline mismatches:
  1) builder was reading `lgov-modern-wikipedia.stvfix.normalised.xlsx` (no approved ID remaps), not `lgov-modern-wikipedia.stvfix.remapped.xlsx`,
  2) canonical lookup keys used raw string PersonIDs, so zero-padded/format variants could fail to match.
- Permanent prevention action:
  1) builder now prefers `lgov-modern-wikipedia.stvfix.remapped.xlsx` when present,
  2) PersonID matching now uses a canonical numeric form (`canonical_person_id`) on both local and full-workbook sides,
  3) build output now reports canonical match coverage as a verification signal.
- Verification evidence:
  1) `python -m py_compile privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` passes,
  2) rebuild succeeds and logs `Candidates with canonical PersonID match: 662/2533`,
  3) local-election JSON regenerated under `election-viewer-package/data/elections/local-government/`.

# Current Task: Apply PersonID-Anchored Candidate Name/Party Canonicalization For Local Election JSON (2026-03-04)

- [x] Add canonical override loader in `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` sourced from `Full election tables.xlsx`
- [x] Apply overrides by `PersonID` during local candidate extraction for `First Name`, `Last Name`, and party labels
- [x] Regenerate local-government JSON artifacts and election index from the updated builder
- [x] Verify generated JSON rows now carry canonicalized candidate names and party labels where previous-data `PersonID` matches exist

- Symptom: local-election JSON still reflected source-workbook name/party strings, while the requirement was to reuse the previous canonical labels where the same person already exists in prior election data.
- Root cause: the local JSON build pipeline did not consult `Full election tables.xlsx`; it emitted name and party fields directly from the modern local workbook.
- Permanent prevention action: load canonical identity metadata from `Full election tables.xlsx` and apply it at extraction time keyed strictly by `PersonID`; retain source values only as fallback when no canonical match exists.
- Verification evidence:
  1) `python -m py_compile privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` passes,
  2) `python privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` succeeds and reports `Loaded canonical PersonID overrides: 1696`,
  3) regenerated JSON rows (e.g., `election-viewer-package/data/elections/local-government/2023-05-18/botanic.json`) include canonicalized `Firstname`/`Surname` and party labels (`Party_Name`, `Deduplicated Party Name`, `Wikipedia Party Name`) for matched `PersonID`s.

# Current Task: Complete STV Distribution-Stage Teardown/Rebuild For Modern Local Workbook (2026-03-04)

- [x] Replace fragile grouped-exit surplus scheduling with constrained stage-first assignment (`distribution_stage >= exit_count`, one surplus donor per stage)
- [x] Add fail-fast validation in the workbook builder for mixed-stage and multi-surplus collisions
- [x] Regenerate `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.xlsx`
- [x] Run cross-district anomaly audit for `MULTI_SURPLUS` and `MIXED` events by count/stage
- [x] Iterate the builder until the audit is clean and record recurring-defect prevention

- Symptom: local STV count output still showed surplus/elimination timing defects and staged-event collisions; previous fixes resolved Mid Tyrone but left broader anomalies.
- Root cause: three compounding defects in `scripts/build_modern_lgov_wikipedia_workbook.py`:
  1) unmatched surplus donors were being forced back onto invalid stages,
  2) donor-stage handling in timeline generation happened after the generic `stage < exit_count` branch,
  3) non-donor candidate rows could emit synthetic negative transfers from source-count deltas, creating false mixed events.
- Permanent prevention action:
  1) stage assignment now enforces hard constraints and clears surplus transfer when no legal slot exists (deemed elected terminal case),
  2) builder now validates and aborts on `Combined surplus` or `Mixed elimination/surplus` stage collisions,
  3) timeline now resolves donor-stage first and suppresses negative transfer values outside donor stages.
- Verification evidence:
  1) `python scripts/build_modern_lgov_wikipedia_workbook.py` completes successfully,
  2) anomaly audit over regenerated `ElectionResults` reports `ISSUES 0` for both multi-surplus and mixed-stage checks.

# Current Task: Fix Council Left-To-Right Party Ordering And By Count Event Headers/Timing (2026-03-04)

- [x] Inspect the live council seat-position ordering and `By Count` header/event logic and patch only the active branches
- [x] Make council-mode seat assignment run left-to-right by party across the hemicycle rather than in generation/top-to-bottom order
- [x] Build an inferred count-event map so Detailed View `Count #` headers show `Surplus of X` / `Exclusion of Y` on the actual redistribution count
- [x] Ensure candidate terminal redistribution display is tied to the actual negative-transfer count rather than an immediately-following count
- [ ] Run syntax checks, restart the server, and record verification

- Symptom: council-mode party colours still filled the chamber in generation/top-to-bottom order instead of left-to-right, and `By Count` Detailed View headers did not identify the actual redistribution event for each count. Users also reported candidates appearing to redistribute at the wrong count.
- Root cause: the large-seat council generator returned positions in row-generation order and the renderer consumed them directly, so party ordering followed construction order rather than chamber x-position. Separately, `By Count` had candidate lifecycle inference but no explicit per-count event map, so count headers stayed generic and redistribution timing was not surfaced from the actual negative-transfer rows.
- Permanent prevention action: when chamber ordering is meant to be political left-to-right, sort generated positions by x before seat assignment; when STV count tables need event semantics, derive a count-event map from the actual negative-transfer rows and use it for both header labelling and redistribution lifecycle display.
- Verification evidence: `js/election-controller.js` now sorts large-seat council positions by `x` after geometry normalization; `_inferCountEvents(...)` derives header events from actual negative-transfer rows and `_countEventCandidateLabel(...)` falls back to full names only for duplicate surnames; `node --check js/election-controller.js`, `node --check js/app.js`, and `node --check js/ui-controller.js` all pass. Pending server restart/manual verification.

# Current Task: Re-align Council Seat Geometry To ParliamentArch Flat-Bottom Hemicycle (2026-03-03)

- [x] Inspect the live `n > 12` council seat-position branch and confirm it still diverged from the reference chamber geometry
- [x] Replace only the large-seat council geometry branch with the ParliamentArch-style half-annulus formulas while leaving styling, party ordering, centering, DEA mode, and non-local election behavior untouched
- [x] Tune only the effective center spacing so the circles sit closer together without overlapping
- [x] Run syntax and server health verification

- Symptom: council-mode seat groups still read as the wrong chamber shape and spacing, even after earlier hemicycle iterations.
- Root cause: the large-seat council branch had drifted away from the actual ParliamentArch annulus formulas; repeated ad hoc retunes were changing appearance without anchoring the geometry to the proven algorithm.
- Permanent prevention action: when the target visual is a parliamentary hemicycle, use the same row-thickness, row-capacity, angular-margin, and arc-placement model as `parliamentarch`, and limit subsequent tuning to explicit spacing constants rather than rewriting the geometry class.
- Verification evidence: `js/election-controller.js` now uses `rowThickness = 1 / ((4 * nRows) - 2)`, row capacities from arc length, `angleMargin = asin(thicc / rowArcRadius)`, and seat centers from `(x, y) = (rowArcRadius * cos(angle) + 1, rowArcRadius * sin(angle))`; `node --check js/election-controller.js` passes; `http://127.0.0.1:5050` returns `200`.

# Current Task: Fix By Count Tables, Local +/- Baselines, Election Z-Lock, And Info Page Scrolling (2026-03-03)

- [x] Update `js/election-controller.js` so local-election previous-result comparisons use the previous general local election rather than the 2018 by-election
- [x] Fix `By Count` table event-count/status logic so elected and excluded counts come from the actual occurrence count, non-transferable is rendered in the correct position, and post-redistribution quota/zero values do not repeat across later columns
- [x] Prevent lower map layers from surfacing above a loaded election layer during interaction while still allowing later-loaded layers to sit on top
- [x] Make election/candidate/feature info pages open scrolled to the top and remove the `# bodies` subtitle from election entity pages
- [x] Run syntax checks and capture verification evidence

- Symptom: local-election `By Count` tables showed incorrect `Elected 1/#` / `Excluded 1/#` statuses, repeated quota/0 values after redistribution, omitted or misplaced `Non-transferable`, and local +/- values compared against the wrong prior election. Election layers could also let lower map-layer outlines leak above them during interaction.
- Root cause: local-election JSON carries the real event count in `Occurred_On_Count`, but the UI was using `Count_Number`; local previous-date logic used the immediately previous date rather than the previous general local election; and election-layer label suppression did not also z-lock lower layers during hover-driven `bringToFront()` calls.
- Permanent prevention action: centralize actual event-count resolution through an `Occurred_On_Count` helper, centralize grouped local-election previous-date resolution so by-elections do not become NI-wide comparison baselines, and mark lower layers as election-z-locked whenever an election is active so hover paths cannot raise them.
- Verification evidence: `js/election-controller.js` now includes `_getOccurredOnCount(...)`, `_getByElectionConstituencyCount(...)`, and `_resolvePreviousComparisonDate(...)`; `_suppressLabelsBelow()` / `_restoreLabels()` now set and clear `state.belowElectionZLock`; `showFeatureDetailInCatalogue(...)` and `showElectionEntityDetailInCatalogue(...)` scroll the catalogue pane to the top and suppress the `# bodies` subtitle; `node --check js/election-controller.js`, `node --check js/map-controller.js`, and `node --check js/ui-controller.js` all pass.

# Current Task: Inspect parliamentarch Arch Geometry Source (2026-03-02)

- [x] Locate the installed `parliamentarch` package source and identify the geometry entrypoints used by `write_svg_from_attribution`
- [x] Read the arch seat-placement and SVG coordinate generation code, including filling strategies
- [x] Explain the actual algorithm in source-backed detail, separating library logic from the wrapper app

- Symptom: the wrapper repository made it look like the arch algorithm might live there, but the actual chamber geometry is delegated to `parliamentarch`.
- Root cause: `slashme/parliamentdiagram` is a Flask/UI wrapper that calls `parliamentarch.write_svg_from_attribution(...)`; the actual arch math lives in the package source, not the web app repository.
- Permanent prevention action: when studying an external generator, identify the true geometry owner first and inspect that source directly before describing the algorithm.
- Verification evidence: inspected `parliamentarch` source archive files `src/parliamentarch/geometry.py`, `src/parliamentarch/svg.py`, and `src/parliamentarch/__init__.py` from the downloaded `ParliamentArch` 1.1.2 sdist.

# Current Task: Force Shared-Baseline Council Hemicycle Geometry (2026-03-02)

- [x] Confirm the prior arc generator still failed the flat-bottom requirement because each ring used offset arc endpoints
- [x] Retune only the `n > 12` council branch so all rings share the same baseline and the chamber width is compressed without overlap
- [ ] Verify syntax, server health, and visual behavior against the reference shape

- Symptom: even after moving to true arcs, the council chambers still did not read as flat-bottom hemicycles, and the seats remained too spread out compared with the reference.
- Root cause: the generator used truncated arc endpoints (`0.06π..0.94π`), so each ring landed on a different vertical baseline; width and density were also being controlled only through radius/gap tuning instead of a dedicated chamber-width scale.
- Permanent prevention action: when a chamber must have a flat base, use full upper-semicircle endpoints (`0..π`) so every ring shares one baseline, and tune chamber density with explicit radial and horizontal scaling rather than by clipping the arc.
- Verification evidence: pending final syntax/server/visual verification after the baseline and width retune.

# Current Task: Flatten Council Hemicycle Base And Retune Arc Density (2026-03-02)

- [x] Confirm the first true-arc pass still produced a rounded bowl rather than the required flat-bottom chamber
- [x] Retune only the `n > 12` council branch to use an upper-semicircle arc with a flat base and tighter non-overlapping spacing
- [ ] Verify syntax, server health, and visual behavior against the reference shape

- Symptom: after switching to true arc geometry, the chamber still had a rounded lower bowl and the dots remained more spread out than the reference image.
- Root cause: the arc generator was using a lower-bowl angle range (`1.04π..1.96π`) and a wider radial/gap tuning, so the layout was genuinely curved but shaped like a rounded bowl instead of an upper-arch chamber with a flat base.
- Permanent prevention action: for parliamentary hemicycles, generate the chamber on an upper-semicircle (`y = -sin(angle)`) with endpoints on the same baseline, then tune seat gap and radial gap separately so density changes do not distort the chamber class.
- Verification evidence: pending final syntax/server/visual verification after the arc retune.

# Current Task: Replace Row-Silhouette Council Chamber With True Arc Geometry (2026-03-02)

- [x] Confirm the current large-seat council layout was still row-based rather than truly arc-based
- [x] Replace only the `n > 12` council seat-position branch with a concentric-arc hemicycle generator
- [x] Keep party ordering, centering normalization, DEA-mode layout, and non-local election logic untouched
- [ ] Verify syntax, server health, and visual behavior against the reference shape

- Symptom: the council seat groups had a flat-row layout that only imitated the silhouette of a hemicycle instead of placing dots on genuinely curved chamber arcs.
- Root cause: the large-seat branch in `_seatPositions()` was still generating horizontal rows with variable widths and center gaps, so the overall outline looked like a hemicycle while each band remained a straight line.
- Permanent prevention action: treat “true chamber geometry” as a separate layout class from “row silhouette”; when the requirement is a hemicycle, the seat-position generator must use polar/concentric-arc coordinates rather than row widths and center gaps.
- Verification evidence: pending final syntax/server/visual verification after the arc-based branch replacement.

# Current Task: Council Hemicycle Density Tightening (2026-03-02)

- [x] Tighten the council hemicycle geometry so seat circles sit closer together while preserving the same chamber shape and styling
- [x] Keep the change isolated to the large-seat council layout constants
- [x] Verify syntax and record the root cause and prevention action

- Symptom: after correcting the council hemicycle shape, the seat circles were still spaced more loosely than in the reference layout.
- Root cause: the large-seat hemicycle geometry was using the same effective gap and radial scale as the earlier wider layout, so the chamber shape was correct but too expanded.
- Permanent prevention action: treat chamber shape and chamber density as separate layout controls; keep a dedicated effective seat-gap constant inside the large-seat branch so density can be tuned without rewriting the geometry or touching styling.
- Verification evidence: `js/election-controller.js` now uses a tighter effective seat gap and smaller ring spacing for `n > 12`, and `node --check js/election-controller.js` passes.
# Current Task: Council Hemicycle Orientation, Centering, And Party Ordering Fix (2026-03-02)

- [x] Correct the council seat layout so the hemicycle is upright with a flat bottom
- [x] Fix council seat-group centering so each group is centered on its council centroid rather than drifting left
- [x] Order council seats left-to-right by the requested party sequence before placing them in the layout
- [x] Verify syntax and record the root cause and prevention action

- Symptom: the first council hemicycle pass rendered upside-down, lacked a flat base, drifted left of the target council centroids, and did not arrange seats left-to-right in the requested party order.
- Root cause: the first layout used polar coordinates for a top-heavy arc rather than a flat-bottom chamber layout, and the rendered dots were positioned relative to the first seat instead of the layout bounds, which shifted the group off-center once the seat positions were no longer grid-like. Council elected members were also emitted in extraction order rather than a deterministic political order.
- Permanent prevention action: for non-grid seat layouts, center overlay dots against the true min/max seat bounds, not the first seat; keep party-ordering explicit in the council elected-member builder; and verify orientation, centering, and ordering separately whenever seat geometry changes.
- Verification evidence: `js/election-controller.js` now sorts council elected members by an explicit party-order helper, large-seat layouts use centered flat-bottom row geometry, dot placement is normalized against the minimum x/y seat bounds, and `node --check js/election-controller.js` passes.
# Current Task: Council Seat-Circle Arrangement Hemicycle Layout (2026-03-02)

- [x] Inspect the current large-seat council overlay placement logic and isolate the one branch that controls the arrangement
- [x] Replace only the large-seat council arrangement with a chamber-style hemicycle layout while preserving all existing styling, marker HTML, and overlay rules
- [x] Verify syntax and record the root cause and prevention action

- Symptom: when `Council` mode was enabled for local-election results, the council seat circles rendered as a centered rectangular grid instead of the requested chamber-style arrangement.
- Root cause: the shared `_seatPositions()` helper used a simple large-group grid branch for every seat group above the DEA scale (`n > 12`), which was visually wrong for council overlays even though the overlay styling and interaction pipeline were otherwise correct.
- Permanent prevention action: keep council seat-layout changes isolated to the seat-position helper so the visual arrangement can change without touching marker styling, click behavior, overlay visibility rules, or the small-seat DEA layout path.
- Verification evidence: the `n > 12` branch in `js/election-controller.js` now generates a hemicycle/horseshoe distribution, while the small-seat pyramid branch is unchanged; `node --check js/election-controller.js` passes.
# Current Task: Fix Dáil / Referendum / Super Census / MEP Label Metadata (2026-02-27)

- [x] Correct the interactive label fields for 1998 and 2005 Dáil constituencies
- [x] Fix missing referendum and 2001 super census labels by adding the correct explicit label metadata
- [x] Remap 2009 European Parliament constituency labels to Dublin / East / South / North-West / Northern Ireland
- [x] Verify JS/metadata integrity and record review notes

# Current Task: Apply Approved Modern Local Candidate PersonID Matches (2026-03-01)

- [x] Build an explicit name-driven remap for the 25 user-approved modern local candidates to their `Full election tables.xlsx` PersonIDs
- [x] Apply the remap to every person-ID-bearing column in `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx`
- [x] Verify representative rows and audit that no stale synthetic IDs remain for the approved names

- Symptom: several user-approved modern local carryover candidates still used synthetic local-only `PersonID` values instead of the canonical IDs already present in `Full election tables.xlsx`.
- Root cause: the earlier remap path depended on `AttemptedMatches.approved = Y`, so explicit conversational approvals were not applied unless the workbook review sheet had been updated first.
- Permanent prevention action: for targeted carryover batches, use a name-driven remap pass that discovers the current local ID from the workbook itself and rewrites every actual ID-bearing column (`ElectionResults.PersonID`, all `ElectionResults.TransferSubject#`, and `Transfers.PersonID` / `TransferSubject` / `SourcePersonID` / `RemainingCandidateIDsDesc`) instead of assuming the temporary local IDs are already known.
- Verification evidence: `scripts/apply_named_personid_remap.py` compiled and ran successfully; `J. J. Magee` now reads as `91406` and `Stephen Moutray` as `11666` in `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx`; stale synthetic IDs `3820078918` and `3394234072` now have `0` hits across `ElectionResults` and `Transfers`.

# Current Task: Apply Requested Split/Merge Identity Corrections (2026-03-01)

- [x] Split the mixed full-workbook identities for `Austin Kelly`, `John Stewart`, `Peter Lavery`, and `Richard Stewart` into separate canonical IDs
- [x] Propagate those split IDs into the live website election JSON files for the affected historical contests
- [x] Merge the approved modern local carryovers into the canonical full-workbook IDs in `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx`
- [x] Verify that the historical split contexts moved to new IDs, the modern local rows now use canonical IDs, and `Catherine Kelly` remained separate

- Symptom: a small set of same-name people were still sharing one `PersonID` in `Full election tables.xlsx`, while the related modern local-election rows were still sitting on synthetic local-only IDs.
- Root cause: these identities need a true split/merge pass, not just a one-way local remap; four full-workbook IDs still conflated different people by name, and the modern local workbook had no canonical remap for several of the corresponding approved carryovers.
- Permanent prevention action: require a full side-by-side history review before approving merges, and when a same-name collision is confirmed, apply the fix across all three layers together: `Full election tables.xlsx`, downstream website election JSON, and the modern local workbook.
- Verification evidence: `scripts/apply_requested_identity_fixes.py` compiled and ran successfully; `Austin Kelly` is now split between `63215` (2011 `Mid Ulster` `SDLP`) and `100008` (1982/1983/1987/1996 `Workers Party / Republican Clubs`), `John Stewart` between `8210` (2016 onward `UUP`) and `100009` (1973/1975 `NI Labour`), `Peter Lavery` between `58217` (2015/local `Alliance`) and `100010` (1996 `Natural Law`), and `Richard Stewart` between `17230` (2024/local `Alliance`) and `100011` (1996 `Independent (Alan Chambers)`); the affected historical website JSON files no longer contain the old IDs in those contests; the modern local workbook now uses canonical IDs for `Austin Kelly`, `Catherine Nelson`, `Charlotte Carson`, `Donal O'Cofaigh`, `Gavin Malone`, `John Stewart`, `Paddy Meehan`, `Peter Lavery`, `Richard Stewart`, and `Stephen Dunne`, while `Catherine Kelly` remains on separate local-only ID `4241395161`.

# Current Task: Apply Second-Round Same-Name Identity Splits (2026-03-01)

- [x] Split the additional collided full-workbook identities for `David Taylor`, `Glenn Barr`, `John Doherty`, `Martin Kelly`, `Stephen Nicholl`, `Thomas Burns`, and `Robert Stewart`
- [x] Propagate those corrected IDs through the affected website election JSON files
- [x] Remap the modern local workbook so the approved local carryovers use the canonical full-workbook IDs, including a context-specific split for `John Boyle`
- [x] Verify representative workbook rows, website JSON files, and modern local rows after the migration

- Symptom: several same-name people were still sharing one canonical `PersonID` in `Full election tables.xlsx`, and the modern local workbook still had synthetic or mixed IDs for the later approved carryovers.
- Root cause: these names require an explicit keep/split matrix by full history, not a generic same-name merge; several full-workbook IDs still mixed different parties/geographies/eras, and one local modern identity (`John Boyle`) needed a context split inside the local workbook itself because the same synthetic local ID covered both an `SDLP` and an `Aontú` candidate.
- Permanent prevention action: encode same-name identity fixes as explicit context-scoped migrations (`date + constituency + party`) across all three layers together: canonical workbook, downstream website JSON, and modern local workbook. When the local workbook itself contains two different people under one synthetic ID, split by approved context before applying any canonical remap.
- Verification evidence: `scripts/apply_requested_identity_fixes_round2.py` compiled and ran; `Full election tables.xlsx` now reads back as `David Taylor -> 100012 (1996 Belfast West Green / Ecology), 100013 (1996 Foyle UKUP), 18241 (2022 Newry and Armagh UUP)`, `Glenn Barr -> 100014 (1973/1975 Vanguard), 7192 (2022 UUP)`, `John Doherty -> 100015 (1996 Workers Party / Republican Clubs), 82766 (2017 Alliance)`, `Martin Kelly -> 100016 (2015/2016 CISTA), 33545 (2019 Aontú)`, `Stephen Nicholl -> 100017 (1996 UKUP), 41828 (2007 UUP)`, `Thomas Burns -> 100018 (1973/1975 DUP), 63034 (1998-2011 SDLP)`, and `Robert Stewart -> 100019 (1973 UUP), 42476 (1996 DUP)`; the affected website JSON files now contain the new IDs (for example `100012` in `.../1996-05-30/belfast-west.json`, `100013` in `.../1996-05-30/foyle.json`, `100014` in `.../1973-06-28/londonderry.json`, and `100015` in `.../1996-05-30/west-tyrone.json`); `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx` now reads back as `David Taylor -> 18241`, `Glenn Barr -> 7192`, `John Boyle -> 49548 only for 2023 Limavady Aontú while the SDLP rows remain on 3059610986`, `John Doherty -> 82766`, `Martin Kelly -> 33545`, `Stephen Nicholl -> 41828`, and `Thomas Burns -> 63034`.

# Current Task: Verify Approved Carryover Merges From Aaron Callan Through William McCandless (2026-03-01)

- [x] Re-check the approved carryover names against the live modern local workbook rather than the older review sheet
- [x] Run the approved-name remap pass against the live workbook
- [x] Verify whether any actual ID-bearing workbook cells still needed rewriting
- [x] Record the result and the source of the stale mismatch signal

- Symptom: the review table still suggested many approved modern local candidates had a synthetic local-only `PersonID` instead of the canonical `Full election tables.xlsx` ID.
- Root cause: the stale mismatch signal came from an older review artifact, not from the live `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx` workbook. By the time of this approval pass, the actual candidate rows for the approved names were already canonical.
- Permanent prevention action: when approving or auditing candidate carryovers, treat the live target workbook as the source of truth and use auxiliary review workbooks only as hints. Before planning a rewrite, re-run the audit directly against the current target artifact.
- Verification evidence: `scripts/apply_named_personid_remap.py` was updated to allow multiple local IDs per approved name, compiled cleanly, and then ran with `0` updates across every ID-bearing column family; direct workbook readback confirms canonical IDs already in place for the approved names, for example `Aaron Callan -> 8594`, `Adrian McQuillan -> 33610`, `Angela Mulholland -> 54895`, `Brian Tierney -> 34682`, `Derek Hussey -> 21520`, `Simon Lee -> 61216`, and `William McCandless -> 65776` in `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx`.

# Current Task: Align Remaining Approved Review-Table Cases To Canonical Full IDs (2026-03-01)

- [x] Expand the approved-name remap set to cover the remaining review-table names
- [x] Re-run the canonical-ID alignment pass against the live modern local workbook
- [x] Verify directly in `ElectionResults` and `Transfers` whether those names were already canonical or needed rewriting
- [x] Record the result and avoid treating stale review-artifact mismatches as live workbook defects

- Symptom: the fresh unresolved-cases review table still showed several approved names with mixed local IDs versus full-workbook IDs, suggesting more canonical-ID rewrites were needed.
- Root cause: the review table was still reflecting stale auxiliary state; the live modern local workbook already had those approved names on canonical `Full election tables.xlsx` IDs in the actual candidate rows and transfer-side `PersonID`/`SourcePersonID` columns.
- Permanent prevention action: after generating any unresolved-case table, re-check the approved names directly against the live workbook before assuming a rewrite is needed. The review table is a hypothesis generator; the workbook is the source of truth.
- Verification evidence: `scripts/apply_named_personid_remap.py` was expanded and re-run with `0` updates across all ID-bearing column families; direct readback from `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx` confirms canonical IDs already present, including `Aaron Callan -> 8594`, `Adrian McQuillan -> 33610`, `Angela Mulholland -> 54895`, `Denise Mullen -> 17344`, `Jenny Palmer -> 15541`, and `William McCandless -> 65776` in `ElectionResults`, and the same canonical IDs in `Transfers.PersonID` / `Transfers.SourcePersonID` for those names.

# Current Task: Apply The Newly Approved Remaining Carryovers And Remove `‡` Markers (2026-03-01)

- [x] Add the newly approved remaining carryovers to the canonical-ID remap set
- [x] Apply those remaps across every ID-bearing column in the modern local workbook
- [x] Verify the approved names now read back on the canonical full-workbook IDs in both `ElectionResults` and `Transfers`
- [x] Verify that no live `‡` markers remain in the modern local workbook or the current person-match workbook

- Symptom: six additional approved carryovers still needed confirmation/alignment to the canonical `Full election tables.xlsx` IDs, and the user also requested removal of any stray `‡` markers from names.
- Root cause: most of these cases were already canonical in the live workbook and only one (`Jordan Doran`) still required an actual data rewrite; the `‡` marker did not exist in the live target artifacts, so this was a verification problem rather than a workbook-cleanup problem.
- Permanent prevention action: treat approved carryover passes as two separate checks: (1) does the live workbook still need an ID rewrite, and (2) does the requested string cleanup actually exist in the live target artifact. Do not assume either from older review outputs.
- Verification evidence: `scripts/apply_named_personid_remap.py` was expanded with `Cadogan Enright`, `Jordan Doran`, `Patsy Kelly`, `Ryan McCready`, and `Sorcha McAnespy` and rerun; it reported `1` `ElectionResults.PersonID` update and `7` `Transfers.PersonID` updates, corresponding to the live `Jordan Doran` rewrite to canonical `100007`; direct readback from `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx` now shows `Cadogan Enright -> 38721`, `Jenny Palmer -> 15541`, `Jordan Doran -> 100007`, `Patsy Kelly -> 16975`, `Ryan McCready -> 44861`, and `Sorcha McAnespy -> 66418`; scans of both `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx` and `_tmp_xls2rar_extract/out/wiki_lgov_modern/person-id-match.xlsx` found `NO_MARKER` for `‡`.

## Review
- Symptom: 1998/2005 Dáil labels were sourced from the wrong field, several referendum/counting-area clone maps had no usable labels, 2001 super census units lacked labels, and the 2009 MEP map showed source council names instead of constituency names.
- Root cause: some map entries pointed at the wrong source attribute (`CONST_NAME` instead of `CON_NAME`), several clone-based entries were missing explicit `labelProperty` metadata entirely, and the 2009 MEP source field contained county/council names that needed a deterministic value remap rather than a different field selection.
- Permanent prevention action: clone entries that are intended to label like their base maps should carry their own explicit `labelProperty` in metadata, and when source attributes are semantically wrong-but-stable, use one centralized label cleanup/remap hook instead of hardcoding UI exceptions.
- Verification evidence: `node --check js/map-controller.js` passes, `data/database/maps.json` now contains explicit label metadata for the affected Dáil/referendum/super-census entries, and `js/map-controller.js` now supports metadata-driven `mapValues` label cleanup used by `mep-2009`.

# Current Task: ROI Settlements 2015 Naming And Cross-Border Nearest-Distance Ranking (2026-02-27)

- [x] Update the ROI Settlements metadata so the main catalogue entry shows as 2015 rather than Ungeneralised
- [x] Compute nearest-settlement distances across NI Settlements 2015 and ROI Settlements 2015 and rank all features descending by nearest-neighbour distance
- [x] Record the methodology and verification notes

## Review
- Symptom: the ROI Settlements layer appeared in the catalogue as `Ungeneralised` with no year, and there was no ranked cross-border nearest-settlement analysis for the NI and ROI 2015 layers.
- Root cause: the ROI map entry had no `date`, retained a source-file-oriented `name`, the ROI settlements class was not treated as year-based for class-member display, and the first nearest-neighbour pass accidentally excluded all same-source comparisons because temporary extracted rows did not carry stable feature IDs.
- Permanent prevention action: any new map entry intended to behave like an existing dated series must include the same minimum metadata contract (`name`, `date`, class participation, and year-based display handling); for one-off comparative analyses, persist the output artifact, state the computational method explicitly, and never use nullable source IDs as self-skip keys when doing nearest-neighbour passes.
- Verification evidence: `data/database/maps.json` now sets the ROI settlements map to `Settlements 2015` with `date: 2015`, `js/ui-controller.js` includes `roi-settlements` in `yearBasedClasses` and sets the ROI flat card years to `2015`, `node --check js/ui-controller.js` passes, and the corrected ranked nearest-neighbour output was written to `_tmp_settlement_distance/settlements_2015_nearest_ranked_corrected.csv`.

# Current Task: Feature-Instance Labels And Feature UI Readability (2026-02-27)

- [x] Restore labels for individually loaded features on the map
- [x] Improve active-layers child feature readability so names are not visually obscured or truncated
- [x] Increase individual-feature page action button/icon sizing so controls are clearly legible
- [x] Verify JS/CSS integrity and record root cause/prevention action

## Review
- Symptom: individually loaded features rendered without labels, active-layer child feature entries were hard to read and truncated, and feature-page action icons were too small to see reliably.
- Root cause: the single-feature load path explicitly disabled label registration (`registerLabels: false`), active-layer child rows reused cramped compact styling with forced truncation, and feature-detail actions reused generic small icon-button sizing meant for denser card surfaces.
- Permanent prevention action: feature-instance render paths must not diverge silently from full-layer behavior for labels, active-layer child rows need their own readable layout rather than inheriting compact list-item constraints, and detail-page action strips need explicit sizing rules instead of relying on generic small-button utilities.
- Verification evidence: `node --check js/map-controller.js` and `node --check js/ui-controller.js` pass; `js/map-controller.js` now registers labels for single-feature loads when no base layer labels exist, and the updated selectors are present in `assets/css/main.css`.

# Current Task: Add Republic Of Ireland Settlements Card (2026-02-27)

- [x] Convert `Settlements_Ungeneralised_-6398853129460496398.geojson` into an FGB layer for interactive loading
- [x] Add a new `Settlements` class/card for `Republic of Ireland` containing only the ROI settlements layer
- [x] Insert the ROI Settlements entry directly below the existing Northern Ireland Settlements entry in the flat catalogue / TOC
- [x] Verify the new metadata wiring and record review notes

## Review
- Symptom: the catalogue had a Northern Ireland `Settlements` card only, with no Republic of Ireland counterpart or TOC entry.
- Root cause: there was no ROI settlements class or map metadata in `data/database/maps.json`, and the flat catalogue ordering in `js/ui-controller.js` only declared the NI Settlements card.
- Permanent prevention action: ROI-only catalogue additions should be treated as a full metadata path change, not just a UI insertion: create the map entry, create the class, add it to the category class list, and then place the flat card explicitly in the ordered `c1Cards` array.
- Verification evidence: converted the supplied GeoJSON into `data/maps/physical/Settlements_ROI_Ungeneralised.fgb` (4,862,024 bytes), `node --check js/ui-controller.js` passes, and the new `roi-settlements` / `roi-settlements-ungeneralised` metadata paths are present in `data/database/maps.json`.

# Current Task: Additive Feature-Instance Controls On Feature Pages (2026-02-27)

- [x] Make feature-page load/unload work additively even when the full parent layer is already loaded
- [x] Add feature-page show/hide controls alongside the existing share/download controls
- [x] Keep active-layers feature child entries available for both partial-only maps and full maps with additive feature instances
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: individual feature loading previously reused the old partial-layer model, which meant a feature load could not coexist cleanly with an already-loaded full parent map.
- Root cause: `loadSingleFeature()` returned early whenever a full layer state already existed, and active-layer child rendering treated `partial` as both the storage model and the UI model for feature children.
- Permanent prevention action: feature loading is now additive within the existing map state, full-map loads can promote an existing feature-only state instead of being blocked by it, and active-layer feature child rows are driven by actual loaded feature instances rather than by `isPartial` alone.
- Verification evidence: `node --check js/map-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; feature pages now render load/unload and show/hide controls tied to feature-instance callbacks.

# Current Task: Map Detail Action Strip Parity (2026-02-27)

- [x] Replace the map-detail-page single `Load Map` / `Unload Map` button with the same action strip used on catalogue cards
- [x] Reuse shared action rendering and binding rather than duplicating button logic
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: map detail pages still used a standalone load/unload CTA while the main catalogue cards had a richer shared action strip.
- Root cause: map-detail rendering had a separate legacy action path instead of reusing the same map-action renderer/binder used by catalogue cards.
- Permanent prevention action: map action controls now route through shared `renderMapActionStrip(...)` and `bindMapActionStrip(...)` helpers so catalogue cards and map detail pages share one interaction contract.
- Verification evidence: `node --check js/ui-controller.js` and `node --check js/app.js` pass; map-detail templates no longer emit the legacy single `catalogue-detail__load-btn` button.

# Current Task: Feature-Page Share And Download Actions (2026-02-27)

- [x] Add a shareable URL button to individual feature pages
- [x] Add on-demand single-feature downloads for GeoJSON, JSON, CSV, and FlatGeobuf
- [x] Make copied feature URLs resolve back to the same feature page after reload
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: individual feature pages had no direct way to copy a feature-specific URL or download only that feature in lightweight formats or FGB.
- Root cause: feature-detail rendering stopped at presentation only; there was no shared feature-detail registration/export path, and URL restoration only understood map-layer state.
- Permanent prevention action: feature detail entries now flow through a shared cache helper, feature exports are generated from that same cached source-of-truth object, and URL restoration understands `featureMap` / `featureId` / `featureName` hash state instead of relying on ephemeral in-memory UI state.
- Verification evidence: `node --check js/ui-controller.js`, `node --check js/map-controller.js`, and `node --check js/app.js` pass; feature pages now render share/download controls and URL state restoration has a dedicated feature-detail branch.

# Current Task: Persistent Sticky Catalogue Controls And Non-Resetting Navigation (2026-02-27)

- [x] Make search bar and catalogue nav controls sticky at the top of the catalogue pane across list/detail/feature pages
- [x] Make Home act as "go to main catalogue page" unless already there, in which case it becomes "return to top"
- [x] Keep back/forward controls persistent and stop resetting catalogue history when returning to the main catalogue page
- [x] Correct the sticky-shell control-row layout so search and nav render on one desktop row
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: search/navigation controls scrolled away on detail/feature pages, the Home action reset navigation state, and back/forward were not persistent across returning to the main catalogue page.
- Root cause: catalogue controls were embedded in scrollable page content rather than a persistent sticky shell, and the history model treated “return to list” as a full reset instead of a navigable `list` state.
- Permanent prevention action: the catalogue now has a sticky control shell, history includes explicit `list` entries alongside `detail` and `feature-detail`, the Home button state is derived from current catalogue context instead of being a separate floating return-top control, and the sticky shell uses explicit desktop grid tracks with a deliberate mobile fallback so the search field and nav controls do not drift into stacked rows.
- Verification evidence: `node --check js/ui-controller.js` passes, stale references to the old return-top button were removed, and the sticky shell/search/nav CSS now enforces a single-row desktop layout.

# Current Task: Remove Redundant Feature-Page Back Button (2026-02-27)

- [x] Remove the `Back to Catalogue` button from individual feature pages
- [x] Leave navigation responsibility with the persistent sticky Home/back/forward controls

## Review
- Symptom: individual feature pages still rendered a local `Back to Catalogue` button even after the sticky Home/back/forward controls took over that responsibility.
- Root cause: `showFeatureDetailInCatalogue()` still emitted the legacy back button and click handler after catalogue navigation had been centralized in the sticky control shell.
- Permanent prevention action: feature-page navigation should come only from the persistent sticky controls; feature-detail templates should not duplicate list-navigation affordances once a shared nav shell exists.
- Verification evidence: the feature-detail template in `js/ui-controller.js` no longer emits `catalogueBackLink`, and no feature-detail-specific back-button handler remains.

# Current Task: Feature Detail History And Smooth Table-Row Camera Motion (2026-02-27)

- [x] Extend catalogue history so feature detail pages participate in back/forward navigation
- [x] Make feature-table row focus use smooth animated map travel instead of abrupt snapping
- [x] Keep feature-name links and map-layer info pages reversible through the existing nav buttons
- [x] Verify syntax and record root cause/prevention action

## Review
- Symptom: feature detail pages did not participate in catalogue back/forward history, and table-row map focus snapped abruptly to the target feature.
- Root cause: catalogue history stored only `detail` map-page entries, and the bbox zoom hook only used immediate `fitBounds()` behavior.
- Permanent prevention action: catalogue history now supports explicit `feature-detail` entries, feature-detail back behavior reuses history when available, and smooth row-focus travel routes through `flyToBounds()` via the shared bbox zoom hook.
- Verification evidence: `node --check js/ui-controller.js` and `node --check js/app.js` both pass.

# Current Task: Feature-Table Row Interaction And Feature Detail Links (2026-02-27)

- [x] Inspect feature-table rendering and existing feature zoom/highlight/detail hooks
- [x] Make every feature-table row clickable to zoom to and highlight its feature
- [x] Make the feature name cell a link to the individual feature info page in the left pane
- [x] Verify syntax and record the root cause/prevention action

## Review
- Symptom: feature rows in the catalogue feature table were passive text only, with no direct path to focus a feature on the map or open its left-pane detail page.
- Root cause: the feature-table renderer only emitted static cells and had no integration with the existing feature zoom/highlight/detail selection pipeline.
- Permanent prevention action: feature-table rendering now creates feature metadata/IDs from the same source feature objects used elsewhere, rows dispatch to `focusFeatureFromTable()`, and feature-name cells route through the existing `showFeatureDetailInCatalogue()` cache path.
- Verification evidence: `node --check js/ui-controller.js`, `node --check js/map-controller.js`, and `node --check js/app.js` all pass.

# Current Task: Prevent Filter Menu Viewport Clipping (2026-02-27)

- [x] Inspect current Excel-style filter menu placement logic
- [x] Make menu choose above or below anchor based on available viewport space
- [x] Apply the fix to both election tables and catalogue feature tables
- [x] Verify syntax and record the root cause

## Review
- Symptom: the Excel-style sort/filter menu was clipped off the bottom of the browser window.
- Root cause: both menu implementations always positioned the menu below the trigger button with a fixed `rect.bottom + 4` top value.
- Permanent prevention action: both menu implementations now measure viewport space and place the menu below when it fits, otherwise above; horizontal position is also clamped within the viewport.
- Verification evidence: `node --check js/ui-controller.js` and `node --check js/election-controller.js` both pass.

# Current Task: Full-Dataset Sort/Filter For Catalogue Feature Tables (2026-02-27)

- [x] Inspect current feature-attribute table loading/rendering path and compare against election-results sort/filter controls
- [x] Replace DOM-snapshot sort/filter behavior with full-dataset feature-table state
- [x] Keep feature-table sort/filter UI aligned with the election-results pane UI
- [x] Verify sorting/filtering acts on all features, not only initially rendered rows

## Review
- Symptom: feature-attribute table sort/filter only acted on the initially rendered subset of rows.
- Root cause: `loadAttributeSchema()` attached Excel-like controls to a partial DOM snapshot while the table body kept lazy-appending more rows outside that control state.
- Permanent prevention action: the feature-attribute table now uses the full feature array as the source of truth for sort/filter state, while DOM rendering is only a paged view of that full filtered/sorted dataset.
- Verification evidence: `node --check js/ui-controller.js` passes, and the implementation now computes sort/filter options and visible rows from `state.allFeatures`, not from the currently rendered DOM rows.

# Current Task: Restore Mean Elevation (2026-02-26)

- [x] Diagnose why Mean Elevation disappeared
  - Root cause: `meanElev_m` / `meanElev_ft` were missing from current map data files.
- [x] Restore valid map binaries before backfill
  - Restored `data/maps` from `HEAD` after accidental LFS-pointer working-tree state.
- [x] Backfill `meanElev_m` and `meanElev_ft` across map datasets
  - Ran `python scripts/backfill-mean-elevation.py --root data/maps`.
- [x] Verify in representative files
  - Confirmed `meanElev_m` and `meanElev_ft` now exist in sample layers (`LGD_2012`, `PC2023`, townlands chunk sample).
- [x] Harden backfill script for future runs
  - Updated `scripts/backfill-mean-elevation.py` to force stable output layer names using `path.stem`.

# Current Task: Task Ledger Consolidation

- [x] Amend `AGENTS.md` so `tasks/todo.md` fulfills the function previously assigned to `TASKS.md`.
- [x] Move all task-tracking content into `tasks/todo.md`.
- [x] Deprecate `TASKS.md` and convert it into a pointer file.
- [x] Update `tasks/lessons.md` to capture this process correction.

## Review
- `AGENTS.md` now points recurring issue logging and task tracking to `tasks/todo.md`.
- `tasks/todo.md` now contains the full prior task ledger content copied from `TASKS.md`.
- `TASKS.md` now contains deprecation-only guidance pointing to `tasks/todo.md`.
- Added a new lessons entry enforcing a single canonical task ledger.

# Remaining Tasks From Prior 12-Point List

## Pending

- [x] New task: Catholic Dioceses offload/update
  - point Catholic Dioceses FGB download to Archive.org direct URL
  - replace repository single-file Catholic Dioceses FGB with chunked parts + reassembly note

## Completed In This Pass

- [x] 1) Map-entry controls fixed:
  - load icon visibility restored
  - overflow/menu trigger rendering made encoding-safe
  - non-placeholder C1/flat entries now render show/hide, load/unload, copy URL, download FGB, overflow menu

- [x] 2) TOC layout fixed to prevent title/year overlap and reduce word-splitting:
  - column widths rebalanced
  - name-cell layout hardened with fixed thumbnail/color columns + constrained text column
  - `word-break: keep-all` applied in relevant desktop/mobile TOC contexts

- [x] 3) Variant action button rendering fixed.

- [x] 4) Dáil card encoding hardened in `maps.json` using escaped unicode values (`\u00e1`).

- [x] 5) Map loading fixes completed for requested layers:
  - strict FGB interactive loading enforced
  - Catholic Dioceses FGB generated and wired (`data/maps/built-environment/Catholic_Dioceses.fgb`)
  - Townlands / Historic Sites / Railways / Transport Lines FGB path presence verified

- [x] 6) `AGENTS.md` updated for 24-hour ZIP check cadence.

- [x] 7) Encoding/icon prevention framework added in `AGENTS.md`.

- [x] 8) Elected-count logic fix already integrated.

- [x] 9) Pause/play transfer animation fix integrated in `election-viewer-package/js/stages2.js`.

- [x] 10) Recurring-issues workflow added in `AGENTS.md`.

- [x] 11) Flat runtime behavior enforced and Copernicus 30m DEM card present in flat catalogue.
- [x] Grouped catalogue view archived at `archive/grouped-catalogue-view/README.md` and removed from runtime markup (`index.html`).

## Already Done From That List

- [x] 12) Search suggestion map-layer text (beside features) styled smaller and greyer than feature names.

## Additional Completed Admin Tasks

- [x] Updated `AGENTS.md` to explicitly forbid repeating ZIP intake checks within 24 hours.
- [x] Added `.zip-intake-check.json` tracking file with `last_checked_utc` and `next_check_after_utc`.

## Completed In This Pass (New)

- [x] Catholic Dioceses offload/update:
  - `data/database/maps.json` now points `files.fgb` at Archive.org direct URL for `catholic-dioceses`
  - repository local single `data/maps/built-environment/Catholic_Dioceses.fgb` replaced with chunked `.partNNN` files and `README-reassemble.txt`

# Current Request (TOC, load/unload, numbers, map loading, active-feature controls)

## In Progress / Completed

- [x] 1) TOC title clipping/space rebalance
  - reduced TOC text size
  - widened usable title column
  - reduced horizontal cell/thumbnail/strip spacing
  - preserved no horizontal overflow on catalogue pane

- [x] 2) Thousands separators for numeric values > 1,000 (without altering string-typed numbers)
  - added numeric-only display formatter in `js/ui-controller.js`
  - applied to dynamic tables and detail metadata/property rendering

- [x] 3) Load button icon should change to X and support unload
  - replaced fragile text glyphs with SVG plus/X icon helper
  - applied across map cards, class members, C1 rows, and variant actions

- [x] 4) Transfer animation resume should continue from paused point
  - updated `resume()` in `election-viewer-package/js/stages2.js` to resume immediately from current point, then continue timed loop

- [x] 5) Results pane table headers align left
  - enforced left alignment for election results table headers in `assets/css/main.css`

- [x] 6) Non-loading target maps fix pass
  - restored local `data/maps/built-environment/Catholic_Dioceses.fgb` from chunk parts
  - updated `data/database/maps.json` Catholic Dioceses FGB path to local file
  - verified source files exist for Historic Sites, Railways, Transport Lines, Townlands, and Copernicus tile set

- [x] 7) Selected-feature entries under Active Layers with per-feature Hide/Unload
  - added per-feature child rows and controls in `js/ui-controller.js`
  - wired callbacks in `js/app.js`
  - implemented per-feature visibility/unload operations in `js/map-controller.js`

# Follow-up Fixes (Current)

- [x] TOC clipping follow-up
  - increased usable title column width again
  - reduced TOC horizontal padding/margins and internal icon/column spacing
  - reduced title text size further in desktop/mobile breakpoints

- [x] Transfer play/resume follow-up
  - removed premature icon mode overrides in click handler
  - hardened `resume()` guard to recover from mode/state desync (`!isPaused && running`)

- [x] Load button follow-up
  - map-card button handlers now check live card state (`map-card--active`) instead of stale closure flags

- [x] File inventory + sizes for requested maps
  - produced current local FGB/chunk/tile file size report for Railways, Catholic Dioceses, Historic Sites, Transport Lines, Copernicus, Townlands

# LFS Cleanup Pass (2026-02-26)

- [x] Audit LFS-tracked files and sizes
  - verified all current `.fgb` files are below 100MB
- [x] Verify rollback safety artifacts before migration
  - confirmed backup bundle/mirror/snapshot and safety tag existence
- [x] Convert `.fgb` tracking from Git LFS to regular Git blobs
  - updated `.gitattributes` from `*.fgb filter=lfs ...` to `*.fgb -filter -diff -merge -text`
  - re-indexed all tracked `.fgb` files so staged blobs are full binary (not LFS pointers)
- [ ] Commit and push cleanup
  - pending user confirmation after final verification summary

# Root-Cause Pass: Point Feature Double-Click -> Feature Card

- [x] Diagnose runtime event chain for point-feature selection
  - verified `mapController.onFeatureClick -> uiController.showFeatureInfo` wiring in `js/app.js`
  - verified panel DOM targets (`#featureInfo`, `#featureInfoContent`) exist in `index.html`
  - traced selection logic and identified fragile dependency on `state.geoJsonLayers` snapshots instead of live rendered layers

- [x] Implement durable selection fix at source-of-truth
  - `js/map-controller.js`: added `_forEachFeatureLayer(state, callback)` to traverse live `state.group` layer graph recursively
  - `handleMapClick` now queries live rendered feature layers instead of only `state.geoJsonLayers`
  - strengthened point double-click handling with click-pair fallback (`<=450ms`) for canvas/vector cases where native `dblclick` can be inconsistent

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes
  - logic verification: selection can now dispatch via two independent paths:
    1) direct layer `dblclick`, and
    2) map-level geometric hit-test over live feature layers

# Recurrence Pass: Point Double-Click Still Not Emitting Feature Card

- [x] Root-cause update
  - identified remaining gap: some browsers/renderer paths do not reliably emit Leaflet native `dblclick` for point interactions
  - prior logic still depended on native `dblclick` at map/layer level in some paths

- [x] Permanent prevention action
  - added map-level synthetic double-click detector based on two rapid clicks within bounded time/distance
  - wired detector to trigger the same `handleMapClick` selection flow as native `dblclick`
  - guards added to avoid duplicate selection when native `dblclick` does fire

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Historic Point Double-Click Still Failing

- [x] Symptom verification
  - user reproduced on historic-sites point feature: hover visible, double-click, no feature card

- [x] Root cause (highest-confidence)
  - point-feature selection still depended on `dblclick` event delivery paths that vary by renderer/browser/propagation state
  - when `dblclick` is not reliably emitted on point layers, no selection event reaches `uiController.showFeatureInfo`

- [x] Maximally effective fix
  - made point-feature selection fire on point `click` directly in `js/map-controller.js` (`_attachHistoricPointDblClick`)
  - retained `dblclick` handling as secondary path
  - added rapid dedupe in `_emitFeatureSelection` to prevent duplicate card renders when click+dblclick both fire

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Follow-up Fix: Point Double-Click Fails When Zoomed Out

- [x] Root cause
  - point hit-testing thresholds were fixed pixel values, not zoom-aware
  - when zoomed out, user click precision decreases and fixed thresholds were too strict

- [x] Fix implemented
  - `js/map-controller.js` now uses zoom-adaptive thresholds for:
    - synthetic double-click pair detection (`time + pixel distance`)
    - point hit-testing (`pointPickPx`)
    - nearest-point fallback (`nearestFallbackPx`)

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Follow-up Fix 2: Zoomed-Out Point Selection Still Intermittent

- [x] Root cause
  - even with improved dblclick handling, selection still depended on dblclick/click-pair event delivery in some paths
  - at lower zoom, strict tolerances further reduced successful hit-detection

- [x] Maximally effective fix
  - map click handler now always runs feature hit-testing (`handleMapClick`) as primary fallback
  - increased zoom-adaptive hit radius and nearest-point fallback radius for low zoom levels
  - dedupe logic in `_emitFeatureSelection` prevents duplicate feature-card renders

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Follow-up Fix 3: Hover/Selection Consistency For Point Features

- [x] Root cause
  - hover highlighting and click/dblclick selection used different effective tolerances
  - users could trigger orange hover state but still miss feature-card selection

- [x] Fix implemented
  - tracked current hovered point candidate in `js/map-controller.js`
  - added hover-consistent fallback in `handleMapClick`:
    - if no normal hit is found, and a point is recently hover-highlighted,
      select that same hovered point when click occurs nearby

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass: Hover-Proximate Double-Click Must Always Select

- [x] Root cause
  - hover-highlight state could clear between clicks, while selection relied on separate hit-testing/event paths
  - this created a mismatch where orange-highlighted points were not always selected on double-click at lower zoom

- [x] Permanent fix
  - introduced explicit hover-driven selection candidates in `js/map-controller.js`:
    - `_activeHoveredPoint` (currently orange-hovered point)
    - `_lastHoveredPoint` (short-lived post-hover memory)
  - `handleMapClick` now first resolves selection from hover candidate and exits early
  - only if no hover candidate exists does it continue with generic geometric hit-testing

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Zoomed-Out Dblclick Still Missing Feature Card

- [x] Precise root cause
  - hover highlight is renderer-level (`mouseover`/`mouseout`) and can still be valid while Leaflet dblclick target dispatch is flaky at low zoom
  - selection relied on map/layer dblclick paths only; no capture-phase guarantee bound to current hover state

- [x] Permanent fix
  - added capture-phase map-container `dblclick` fallback in `js/map-controller.js` (`_handleContainerDblClick`)
  - on dblclick, if a hover candidate exists, selection now emits directly from that exact feature (`_emitFeatureSelection`)
  - unified hover-candidate selection in `handleMapClick` to use `_emitFeatureSelection` (single deduped source of truth)

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Orange Hover Persisted But Selection Expired

- [x] Symptom
  - point remained orange-highlighted, but dblclick did not open feature card when zoomed out

- [x] Precise root cause
  - hover selection candidate used time expiry (`<=2500ms`) for active hover while orange state itself did not expire
  - this created a logic mismatch: visually hovered point could be rejected by selection path

- [x] Permanent fix
  - removed time-expiry gate for active hovered point in `_getHoverSelectionCandidate`
  - active hovered point is now accepted based on proximity only
  - kept short-lived timed fallback only for `last hovered` (hover flicker between clicks)

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Hover Orange Still Not Selecting At Low Zoom

- [x] Symptom
  - feature remains orange-hovered but double-click does not open feature card unless zoomed in

- [x] Root cause
  - active-hover selection still had a second geometric gate (`activeDistPx <= hoverSelectPx`)
  - this made orange-hover eligibility and selection eligibility non-identical

- [x] Permanent prevention action
  - removed distance/time gating for active hovered point in `_getHoverSelectionCandidate`
  - active orange hover now selects by identity (exact hovered layer/feature) as source of truth
  - kept only bounded, timed fallback for `last hovered` to cover hover flicker between clicks
  - clear hover candidates when layers are hidden/unloaded to avoid stale references

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Active Hover Lost Between Dblclick Events

- [x] Symptom
  - orange hover visible, but zoomed-out dblclick still intermittently fails to open feature card

- [x] Root cause
  - low-zoom pointer jitter can fire `mouseout` between the two clicks of a dblclick
  - active hover candidate was cleared immediately on `mouseout`, dropping selection from identity path into stricter fallback path

- [x] Permanent prevention action
  - added active-hover grace window in `js/map-controller.js`:
    - new `_activeHoverGraceMs` (1800ms)
    - on `mouseout`, keep active hovered feature alive until `expiresAt`
    - on `mouseover`, set active candidate `expiresAt = Infinity`
  - `_getHoverSelectionCandidate` now respects `expiresAt` before clearing active candidate

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Orange Highlight State Still Diverged From Dblclick Selection

- [x] Symptom
  - cursor position produced orange highlight, but double-click still failed at low zoom

- [x] Root cause
  - dblclick selection still depended on hover candidate resolution paths that could diverge under jitter/flicker
  - no direct selection path from the actual set of currently orange-highlighted point layers

- [x] Permanent prevention action
  - introduced `this._highlightedPointLayers` as explicit source-of-truth for orange-highlighted points
  - `_setFeatureHover` now maintains this set on `mouseover`/`mouseout`
  - `_handleContainerDblClick` now first selects nearest currently highlighted point via `_selectHighlightedPointAt(clickPoint)`
  - fallback hover/geometric logic remains as secondary path only

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Unify Hover Highlight and Dblclick Selection Source

- [x] Symptom
  - orange highlight appears, but dblclick still intermittently fails at low zoom

- [x] Root cause
  - hover style and selection continued to rely on different event lifecycles/state transitions
  - low-zoom event churn (`mouseover`/`mouseout`) caused divergence between visible hover and dblclick target resolution

- [x] Permanent prevention action
  - introduced shared geometric resolver for point-under-cursor:
    - `_resolvePointUnderCursor(containerPoint, zoom)`
    - used for hover via map `mousemove`
  - added single source-of-truth hovered point layer:
    - `_currentHoverLayer`
    - maintained by `_setCurrentHoverLayer(...)`
  - dblclick/click selection now first selects `_currentHoverLayer` directly
  - point-layer per-feature hover handlers disabled to avoid conflicting hover ownership
  - clear hover source-of-truth when map/layer hides/unloads

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Stability Hardening: Disable Competing Legacy Point Selection Paths Under V2

- [x] Symptom
  - recurring regressions persisted because legacy per-layer/map selection handlers continued to run alongside V2 hover/selection logic

- [x] Root cause
  - multiple concurrent event pipelines (layer click/dblclick, map click/dblclick, container dblclick) could conflict under low-zoom jitter

- [x] Permanent prevention action
  - added `this._pointSelectionV2` feature flag (default `true`)
  - disabled legacy point-layer selection handlers in `_attachHistoricPointDblClick` when V2 is enabled
  - disabled legacy map click/dblclick selection handlers when V2 is enabled
  - `_handleContainerDblClick` now serves as primary deterministic point-selection entrypoint:
    1) current hover layer
    2) shared point-under-cursor resolver
    3) bounded hover fallbacks
    4) non-point geometric fallback via `handleMapClick`

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): V2 Still Depended On Native Dblclick Delivery

- [x] Symptom
  - point feature cards still failed intermittently at low zoom, despite unified resolver and legacy handler disablement

- [x] Root cause
  - with V2 enabled, point selection still depended primarily on native container `dblclick`
  - on some low-zoom interaction paths, native `dblclick` is not reliably emitted

- [x] Permanent prevention action
  - added synthetic dblclick detection on container capture `click` events:
    - second click within bounded time/pixel window triggers the same point-selection entrypoint
  - added shared `_selectPointFromInteraction(clickPoint)` used by both native and synthetic dblclick paths
  - reset synthetic click-pair state on container mouseleave

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Synthetic Dblclick Fallback Was Short-Circuited

- [x] Symptom
  - low-zoom dblclick still failed even after adding click-pair fallback

- [x] Root cause
  - `_handleContainerClick` returned early on `evt.detail >= 2`
  - second click of an actual double-click has `detail = 2`, so synthetic path never executed at the critical event

- [x] Permanent prevention action
  - removed `evt.detail >= 2` early-return in `_handleContainerClick`
  - synthetic click-pair detector now evaluates both clicks and can fire on second click as intended
  - rely on `_emitFeatureSelection` dedupe to prevent duplicate card opens when native `dblclick` also fires

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Click/Dblclick Events Still Suppressed Under Low-Zoom Jitter

- [x] Symptom
  - feature-card opening still intermittently failed on low-zoom double-click despite click-pair fallback

- [x] Root cause
  - on some interaction paths with slight drag/jitter, browser/Leaflet may suppress `click`/`dblclick`
  - synthetic fallback on `click` alone was insufficient in those suppression cases

- [x] Permanent prevention action
  - added capture-phase `pointerup` pair detector as an additional synthetic dblclick trigger
  - both synthetic paths (`click` pair and `pointerup` pair) now route to shared `_selectPointFromInteraction`
  - reset pointer pair state on container mouseleave

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Root-Cause Pass (Latest): Synthetic and Native Selection Paths Were Asymmetric

- [x] Symptom
  - low-zoom point selection still failed intermittently even with synthetic click/pointerup pair fallback

- [x] Root cause
  - native container dblclick path applied highlighted/candidate fallbacks
  - synthetic click/pointerup pair paths only used current-hover + geometric resolver and skipped those fallbacks
  - behavior diverged depending on which trigger path fired

- [x] Permanent prevention action
  - unified all point trigger paths through one complete resolver:
    - `_selectPointFromInteraction(clickPoint)` now includes:
      1) current hover layer
      2) shared point-under-cursor resolver
      3) highlighted-layer fallback
      4) hover-candidate fallback
  - `_handleContainerDblClick` now relies on that shared resolver only before non-point fallback

- [x] Verification evidence
  - static verification: `node --check js/map-controller.js` passes

# Map Loading Stabilization (Non-townlands)

- [x] De-LFS critical non-townlands map files
  - added `.gitattributes` exceptions for:
    - `data/maps/transport/Translink_Rail_Network.fgb`
    - `data/maps/transport/Transport_Lines_Road_Rail.fgb`
    - `data/maps/built-environment/Catholic_Dioceses.fgb`
    - all historic-sites FGB files used by map entries
  - re-indexed these files (`git rm --cached` + re-add) so repository serves real FGB bytes, not LFS pointer text

- [x] Catholic Dioceses loading path hardened
  - switched `data/database/maps.json` Catholic Dioceses `files.fgb` back to local `data/maps/built-environment/Catholic_Dioceses.fgb`
  - avoids external CORS/availability failures for interactive loading

- [x] Townlands download behavior switched away from ZIP-chunk flow
  - set `ni-townlands-1844.downloads.fgb` to Internet Archive direct URL target
  - cleared `data/downloads/fgb-chunks/manifest.json` so app no longer triggers ZIP chunk queue for Townlands download
  - note: IA upload of `Townlands_AllIreland.fgb` is still pending final successful completion

# Current Fixes (Labels, Copernicus, Historic dblclick)

- [x] Set Catholic Dioceses labels to `diocese`
  - updated `data/database/maps.json` with `"labelProperty": "diocese"` on `catholic-dioceses`

- [x] Set Railways labels to `Route_Section`
  - updated `data/database/maps.json` with `"labelProperty": "Route_Section"` on `railways-network`

- [x] Copernicus raster visibility hardening
  - lowered Copernicus `rasterStyle.minZoom` from `5` to `0` in `data/database/maps.json`
  - set raster overlay `zIndex` in `js/map-controller.js` so DEM tiles reliably render above basemap

- [x] Historic Sites point-feature dblclick opens feature card
  - added `_attachHistoricPointDblClick(...)` in `js/map-controller.js`
  - wired handler into regular load, chunked fallback/full load, and incremental feature-layer adds

# Current Request (Townlands URL, Townlands loading, historic dblclick, NI-wide elected totals, transfer pause/play sync)

- [x] 1) Townlands direct download URL updated
  - `data/database/maps.json`: set `ni-townlands-1844.downloads.fgb` to `https://archive.org/download/townlands-all-ireland/Townlands_AllIreland.fgb`

- [x] 2) Townlands loading diagnosis and surgical fix
  - root cause identified in chunk-stage `minDiag` filtering
  - `js/map-controller.js`: disabled `minDiag` cull for `ni-townlands-1844` while keeping chunk loading active

- [x] 3) Historic Sites point object selection fix
  - `js/map-controller.js`: replaced point hit test from 10m geodesic threshold to screen-space threshold (`<= 14px`) for consistent click/dblclick detection

- [x] 4) 2022 Assembly NI-wide elected counts fix
  - `js/election-controller.js`: NI-wide seat aggregation now uses `_extractElected(...)` constituency logic (explicit + deemed elected)

- [x] 5) Transfer pause/play robustness hardening
  - `election-viewer-package/js/stages2.js`: added `getPauseReplayMode(...)` to re-sync icon classes and `data-mode` before action dispatch, preventing stuck pause/play button state

# Current Request (Townlands load fail, historic point dblclick, transfer pause/play)

- [x] Townlands load fail (`Failed to load ... after 0.0s`) fixed
  - symptom: immediate failure on load
  - root cause: `ni-townlands-1844-chunks.json` points to `data/maps/townlands/chunks/townlands_*.fgb`, but those files do not exist in repo
  - fix: bypass chunk mode for `ni-townlands-1844` and load stable LOD (`Townlands_AllIreland-lod1.fgb`) directly in `js/map-controller.js`
  - prevention: regenerate chunk manifest from actual chunk outputs before re-enabling chunk mode

- [x] Historic Sites point double-click feature card fix (second pass)
  - symptom: dblclick on historic point features did not open card
  - root cause: selection logic only treated geometry type strictly as `Point`
  - fix: generalized to any layer exposing `getLatLng()` and widened hit threshold to 18px
  - files: `js/map-controller.js`

- [x] Transfer animation pause/play fix (second pass)
  - symptom: pause icon remained displayed and second click did nothing
  - root cause: mode/class state path could still desync in real UI flow
  - fix: restored explicit class-toggle click logic (pause/play/repeat) before dispatching `pause()/resume()/replay()`
  - file: `election-viewer-package/js/stages2.js`

## Recurring Issue Log

- [open] Townlands chunk-manifest drift
  - symptom: chunk path references non-existent files
  - root cause: chunk index output no longer matches on-disk chunk naming
  - permanent prevention action: add build-time validation script that checks every `chunks[].file`/`zoomFiles.*.file` exists before publishing manifest
  - verification evidence: current manifest references `townlands_*.fgb` while directory contains `*-townlands_z*.fgb`

- [open] Transfer play/pause control regressions
  - symptom: repeated pause/play regressions across updates
  - root cause: multiple animation control paths and icon/mode coupling drift
  - permanent prevention action: add an automated UI state test (or deterministic unit harness) that asserts pause->icon swap->resume progression for STV animation
  - verification evidence: multiple fixes required in `election-viewer-package/js/stages2.js` across recent passes

# Current Task: Townlands + Interaction Regression Fixes

- [x] Re-enable chunked Townlands loading path in interactive map.
- [x] Verify Townlands chunk manifest integrity against on-disk files.
- [x] Fix load/unload button toggle behavior in C1/class entry controls.
- [x] Fix point-feature double-click card opening for point-like layers.
- [x] Harden transfer pause/play icon state visibility (play/pause/replay glyph + ARIA/title sync).

## Review
- Removed Townlands forced non-chunked LOD override in `js/map-controller.js`; `chunked: true` is honored again.
- Verified chunk manifest integrity: `data/maps/townlands/ni-townlands-1844-chunks.json` references 241 chunks with 0 missing files.
- Updated C1 load button handler in `js/ui-controller.js` to async-toggle with busy lock + immediate icon/state update after load/unload.
- Generalized point dblclick attachment in `js/map-controller.js` so point-like layers are clickable (not historic-only).
- Updated transfer controls in `election-viewer-package/js/stages2.js` to set explicit play/pause/replay symbols and labels.

# Current Task: Complete Regression Fix Pass (Townlands + Pause/Play + Load Toggle + Point Dblclick)

- [x] Make loaded-state check group-aware so load/unload icon toggles correctly for grouped entries.
- [x] Remove duplicate visual icon artifact on pause button while keeping pause/play state switching.
- [x] Ensure pause button can always resume from paused state even if icon class drifts.
- [x] Add remote FGB fallback for chunked/full load failures (Townlands uses Archive download URL fallback).
- [x] Increase point hit tolerance for double-click selection robustness.

## Review
- `js/app.js`: `onCheckMapLoaded` now reports group loaded state via members/variants, so `+`/`X` toggles correctly for grouped maps.
- `election-viewer-package/js/stages2.js`: removed injected unicode text on pause/play/replay (which caused duplicate visual controls) and made click dispatch state-aware (`isPaused`).
- `js/map-controller.js`: chunked/full local-load failures now retry from `mapConfig.downloads.fgb` when available.
- `js/map-controller.js`: point click/dblclick hit threshold raised from 18px to 24px.

# Current Task: Enforce Townlands Chunk-Only Interactive Loading

- [x] Remove/disable all non-chunk fallback paths for `ni-townlands-1844` interactive loading.
- [x] Keep normal fallback behavior for non-townlands chunked maps.
- [x] Preserve viewport/lazy chunk behavior (visible + nearby chunk loading).

## Review
- `js/map-controller.js`: added `enforceChunkOnly` for `ni-townlands-1844`.
- If chunk index is unavailable for Townlands, loader now fails fast (no full-file fallback).
- If chunk loading throws for Townlands, loader now fails fast (no full-file or remote-download fallback).
- Remote fallback (`downloads.fgb`) remains available only for non-townlands layers.

# Current Task: Fix Townlands Chunk Load Failure (LFS Pointer Root Cause)

- [x] Reproduce and isolate Townlands failure source from the actual load path.
- [x] Verify committed Townlands chunk blobs are real FGB bytes vs LFS pointers.
- [x] Convert Townlands chunk files to non-LFS tracked files and re-stage real bytes.
- [x] Verify committed chunk blob headers from Git object database are valid FGB magic bytes.
- [ ] Commit and push fix.

## Review (in progress)
- Root cause proven: `git cat-file -p HEAD:data/maps/townlands/chunks/townlands_0_1.fgb` returns LFS pointer text (`version https://git-lfs.github.com/spec/v1`), while working-tree file bytes are valid FGB (`66 67 62 03 ...`).
- Added `.gitattributes` exception: `data/maps/townlands/chunks/*.fgb -filter -diff -merge -text`.
- Reindexed all Townlands chunk FGBs (`git rm --cached ...` then `git add ...`) so index now contains real binary blobs.
- Index verification: 639 chunk files checked, 0 small/pointer-like blobs; sample staged blob header is valid FGB magic bytes (`66 67 62 03 66 67 62 00 ...`).

# Current Task: Restore Load/Unload Toggle Button Behavior

- [x] Trace load-button state flow from render state to click handlers and loaded-state checks.
- [x] Identify root-cause mismatches causing `+` to persist after successful map load.
- [x] Implement a centralized loaded-state resolver for map entries.
- [x] Ensure flat-view re-renders preserve real loaded-state inputs instead of resetting to empty.
- [x] Wire variant action rows to real loaded state.
- [x] Run syntax verification for updated UI controller.

## Review
- Root cause found: flat catalogue re-renders were rebuilding map entry buttons with `loadedIds: []`, forcing `isLoaded=false` and reverting buttons to `+` immediately after load.
- Additional mismatch: multiple map-entry render paths used `options.loadedIds.includes(map.id)` directly instead of callback-based loaded checks used by click handlers.
- Fix implemented in `js/ui-controller.js`:
  - Added `isMapLoadedState(mapId, options)` to centralize loaded-state checks (`onCheckMapLoaded` first, then `loadedIds` fallback).
  - Updated all map-entry render paths (`createMapCard`, class/C1/explicit-grid renderers) to use `isMapLoadedState(...)`.
  - Updated variant rows to use real loaded state instead of hardcoded `false`.
  - Preserved render options through flat-view lifecycle via `this._lastMapListOptions`.
  - `renderMapList(...)`, `setCatalogueViewMode(...)`, and `invalidateFlatView(...)` now pass stored options into `renderFlatView(...)`.
  - Removed flat-view internal reset (`const options = { loadedIds: [] }`).
- Verification: `node --check js/ui-controller.js` passes.

# Current Task: Point Feature Double-Click Card Not Opening

- [x] Trace point double-click event path from Leaflet layer events through `mapController.onFeatureClick` to `uiController.showFeatureInfo`.
- [x] Identify weak points in event propagation and point hit testing.
- [x] Implement robust point-selection handling for dblclick across loaded layers.
- [x] Verify syntax/build health of modified map controller.

## Review
- Strengthened point dblclick handling in `js/map-controller.js`:
  - Added `_emitFeatureSelection(mapId, feature)` to centralize feature-card dispatch.
  - Updated layer dblclick handler to always dispatch feature selection even if event-stop calls fail.
- Hardened map-level dblclick hit testing:
  - Increased direct point pick threshold (`32px`).
  - Added nearest-point fallback (`<=48px`) when no point is captured in strict pass.
- Verification: `node --check js/map-controller.js` passes.

# Current Task: Single Measured Teardown/Rebuild of Point Interaction Contract

- [x] Audit all active point-interaction entrypoints and remove competing paths.
- [x] Rebuild to one deterministic double-activate contract with shared resolver.
- [x] Instrument hover->select->emit flow with explicit trace events.
- [x] Verify syntax and provide runtime trace hook for surgical debugging.

## Review
- `js/map-controller.js` interaction contract was simplified:
  - removed capture `click` pair path from active pipeline (kept native `dblclick` + synthetic `pointerup` pair only)
  - both trigger paths now route through one `_handlePointDoubleActivate(...)` entrypoint
  - one shared selector `_selectPointFromInteraction(clickPoint, source)` now owns point selection order
- Added instrumentation:
  - `window.__bwPointInteractionDebug` trace buffer
  - trace stages include: `hover-change`, `double-activate`, `select-current-hover`, `select-resolved-point`, `select-point-miss`, `emit-selection`, `emit-deduped`, `native-dblclick-skipped-after-synthetic`
- Verification:
  - `node --check js/map-controller.js` passes.

# Current Task: Tie Double-Click Selection Directly To Orange Hover State

- [x] Add an explicit hover-armed feature state set only when a point is orange-highlighted.
- [x] Make double-activate selection consume the armed feature first.
- [x] Clear armed state on hover loss, map-container mouseleave, and map unload/hide cleanup.
- [x] Verify syntax for map interaction controller.

## Review
- `js/map-controller.js` now maintains `_armedHoverPoint` as the strict interaction contract:
  - set on point hover-on (`hover-armed-set`)
  - cleared on point hover-off and container mouseleave (`hover-armed-cleared`)
  - cleared in `_clearHoverCandidatesForMap(...)` when layers/maps are hidden/unloaded
- `_selectPointFromInteraction(...)` now selects `_armedHoverPoint` first (`select-armed-hover`) before any other resolver path.
- Verification:
  - `node --check js/map-controller.js` passes.

# Current Task: Local Instrumented Debug Session Pipeline

- [ ] Add local HTTP debug endpoint that appends browser interaction events to a log file.
- [ ] Wire client runtime logger for point interaction, feature-selection emit, and JS errors.
- [ ] Run local server with file logging and capture repro traces from user interaction.
- [ ] Read captured log and apply surgical fix from first failing stage only.

# Current Task: Dark Theme Consistency (System vs Manual Toggle)

- [x] Identify why initial dark mode differed from toggled dark mode.
- [x] Unify system dark token values with manual `[data-theme="dark"]` tokens.
- [x] Make startup always set explicit `data-theme` from saved preference or system preference.
- [x] Verify JS syntax after theme initialization change.

## Review
- Root cause: two different dark palettes existed (`@media (prefers-color-scheme: dark)` vs `[data-theme="dark"]`), so startup/system-dark and toggled-dark could render differently.
- `assets/css/main.css` system-dark token block now matches manual dark tokens exactly.
- `js/app.js` now always sets `document.documentElement.dataset.theme` on startup (`saved theme` or `system dark/light`), preventing mixed-mode startup.

# Current Task: Deploy Consistency Fix (Last File Skip + Stale SW Cache)

- [x] Fix deploy workflow so incremental sync cannot skip the last changed file.
- [x] Fix upload/delete count logic to count non-empty lines reliably.
- [x] Add stale service-worker cleanup when `/sw.js` is absent on host.

## Review
- `.github/workflows/deploy.yml` now:
  - writes upload/delete lists with trailing newline when non-empty,
  - uses `while read ... || [ -n \"$filepath\" ]` to process final line,
  - uses non-empty-line counts for upload/delete totals.
- `js/app.js` now checks `/sw.js` with `HEAD` before registering; if absent, it unregisters existing service workers to prevent stale cached asset serving.

# Current Task: Feature Card Property Contrast In Light Mode

- [x] Identify low-contrast styles in feature-info properties block under light mode.
- [x] Apply explicit high-contrast light-mode overrides for summary, property container, keys, and values.

## Review
- `assets/css/main.css` now includes targeted light-mode contrast overrides for:
  - `.feature-info__summary`
  - `.feature-info__properties`
  - `.feature-info__property`
  - `.feature-info__key`
  - `.feature-info__value`

# Current Task: Postmortem - Protracted Point-Feature Card Fix Loop

- [x] Review why repeated fixes failed to close the defect quickly.
- [x] Identify concrete process faults that prolonged resolution.
- [x] Add permanent process guardrails in `tasks/lessons.md`.

## Review
- Why it took too long:
  - Multiple interaction paths existed simultaneously (native dblclick, synthetic click/pointer paths, hover fallbacks), so partial fixes improved one path while another still failed.
  - Changes were repeatedly committed before proving the exact user acceptance path on runtime evidence (orange hover -> dblclick -> emitted selection -> feature card render).
  - Early passes relied on inferred causes and static checks (`node --check`) instead of decisive instrumentation and trace-based failure localization.
  - Deployment/cache effects introduced additional ambiguity during validation.
- Permanent prevention:
  - Added hard “runtime proof gate” and “max-attempt escalation” lessons to force instrumentation-first diagnosis and controlled teardown/rebuild earlier.

# Current Task: Transfer Pause/Resume Stuck Until Stage Click

- [x] Root-cause pass on pause/resume behavior in `election-viewer-package/js/stages2.js`.
- [x] Implement deterministic resume recovery for interrupted in-flight transfer rounds.
- [x] Clear stale pending-transfer flags that block normal resume updates.
- [x] Verify syntax integrity.

## Review
- Root cause: pausing during in-flight transfer slices could leave round state mid-transition; resume attempted to continue from inconsistent state and appeared stuck until a manual stage click rebuilt the round.
- Fix:
  - added `pendingResumeStep` tracking in pause/resume flow
  - when paused with active transfer slices, resume now auto-runs `playStep(interruptedRound)` before restarting interval
  - clears stale `.data('pendingTransfer'/'pendingTransferRound')` flags on bars during pause cleanup
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up (Pause Did Not Freeze In-Flight Stage)
- [x] Add paused-state guards to asynchronous callbacks/timers so stage progress cannot continue while paused.
- [x] Expand pause freeze to stop all in-flight animation nodes under `#animation`.

### Follow-up Review
- Root cause: icon/mode toggled correctly, but asynchronous callbacks and timer-based status updates could still complete stage-side effects after pause.
- Fix:
  - Added `if (isPaused || !running) return;` guards in key async callbacks/timer handlers.
  - Pause now calls `$("#animation *").stop(true, false)` to freeze all in-flight animation elements, not just selected classes.
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up 2 (Forum Animation Pause Path)
- [x] Apply equivalent pause-freeze/resume behavior in forum animation controller path.

### Follow-up 2 Review
- Root cause: forum controller `stopAuto()` only stopped interval progression and did not freeze in-flight frame animation.
- Fix:
  - added `state.pausedMidFrame` tracking in forum animation state
  - `stopAuto({ freezeFrame: true })` now stops in-flight bar animations and clears deferred timers
  - `startAuto()` now resumes interrupted frame from frozen midpoint before continuing interval cadence
  - non-pause navigation actions (`step`, `again`, stage click) call `stopAuto({ freezeFrame: false })`
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up 3 (Pause Toggle Drift Between Icon and Runtime Flags)
- [x] Switch pause/play click routing to paused-state-first logic in both STV and forum paths.

### Follow-up 3 Review
- Root cause: pause/play routing still relied on `running`/`playing` in branches where those flags could drift from actual paused intent, causing icon toggles without reliable freeze semantics.
- Fix:
  - forum path now tracks explicit `state.isPaused` and click handler toggles on that state
  - STV path click handler now toggles on `isPaused` (except repeat mode), not on `running`/icon combinations
  - STV `pause()` guard simplified back to `if (isPaused) return;` to keep a single source of truth
- Verification:
  - `node --check election-viewer-package/js/stages2.js` passes.

# Current Task: Transfer Pause Crash Root Cause (.filter missing in shim)

- [x] Perform root-cause pass on why pause repeatedly fails despite state-machine changes.
- [x] Add `.filter()` support to `js/jquery-shim.js`.
- [x] Harden STV `pause()` to avoid dependency on shim `.filter()` in critical path.
- [x] Verify syntax integrity after patch.

## Review
- Symptom:
  - Pause click did not reliably change to play/freeze in place; behavior looked like only next-stage progression was blocked.
- Root cause:
  - `pause()` in `election-viewer-package/js/stages2.js` called `$("#animation .votes").filter(...)`.
  - custom shim `js/jquery-shim.js` did not implement `.filter()`, causing a runtime exception inside `pause()` after interval clear but before `isPaused=true` and icon/state freeze updates.
- Fix:
  - implemented `.filter(selectorOrFn)` in `js/jquery-shim.js` returning a new `$Set`.
  - rewrote `pause()` active-slice collection to use `.each(...)` + native array removal, so pause critical path no longer depends on shim `.filter()`.
- Verification evidence:
  - `node --check js/jquery-shim.js` passes.
  - `node --check election-viewer-package/js/stages2.js` passes.

# Current Task: NI-wide Results "By Local Party" Tab

- [x] Add `By Local Party` tab in NI-wide election results pane header.
- [x] Implement NI-wide local-party table renderer (party + constituency tuple aggregation).
- [x] Replace candidate status with `Elected` column formatted as `X/Y` per tuple.
- [x] Sort rows by first-preference votes descending (highest rank first, lowest last).
- [x] Keep existing table controls/sorting wiring.

## Review
- Updated `js/election-controller.js`:
  - `_setupNIWideTabs` now includes `{ id: 'local-party', label: 'By Local Party' }`.
  - `_renderNIWideView` now routes `local-party` to `_buildNIWideLocalPartyTable()`.
  - Added `_buildNIWideLocalPartyTable()` to aggregate candidate rows by `(constituency, party)`:
    - votes = sum of first-count candidate votes for tuple
    - stood (`Y`) = count of candidates in tuple
    - elected (`X`) = elected candidates in tuple (including deemed-elected logic consistent with existing candidate table path)
  - Added `_localPartyKey()` utility for stable previous-election delta matching.

### Follow-up (True Freeze/Resume Instead of Slice Removal)
- [x] Replace pause teardown behavior that removed transfer slices and forced stage replay.
- [x] Implement true in-place freeze by pausing shim animation clock.
- [x] Ensure resume continues current in-flight transfer animations from paused position.
- [x] Ensure manual controls (`replay/step/again/jump`) clear paused clock state.

### Follow-up Review
- Root cause:
  - prior pause logic removed active transfer slices and resume advanced stage scheduler, which made rectangles disappear and skipped to next stage.
- Fix:
  - `js/jquery-shim.js`: animation loop now respects `window.__evAnimationPaused` and freezes RAF progression in-place.
  - `election-viewer-package/js/stages2.js`:
    - STV `pause()` now sets `window.__evAnimationPaused = true` and does not remove slices.
    - STV `resume()` clears paused flag and restarts interval without forcing immediate `advanceCount()` or `playStep(...)`.
    - forum `stopAuto/startAuto` now use same paused-clock flag for freeze/resume consistency.
    - manual controls explicitly clear paused-clock state.
- Verification evidence:
  - `node --check js/jquery-shim.js` passes.
  - `node --check election-viewer-package/js/stages2.js` passes.

### Follow-up (By Local Party columns)
- [x] Changed Elected column to show elected count only.
- [x] Added Stood column immediately left of Elected.

# Current Task: Copernicus DEM Coverage, Sea Mask, and Layer Ordering

- [x] Fix DEM tile generation so sea is excluded and only land is rendered.
- [x] Regenerate Copernicus DEM tile set with land-mask applied.
- [x] Align DEM map config min zoom with available tile pyramid.
- [x] Ensure DEM renders below vector layers by pane z-index.
- [x] Assess feasibility of user-reorderable active layer stacking.

## Review
- `scripts/build-copernicus-dem-tiles.py` updated:
  - added land-mask support using `data/maps/physical/Ireland.fgb`
  - rasterizes land polygons per tile and clears alpha outside land
  - added `--land-mask` and `--no-land-mask` options
- Copernicus tile set regenerated:
  - output: `data/maps/physical/copernicus-dem-30m-ireland-tiles`
  - metadata now reports 290 written tiles, with sea-only tiles skipped
- `data/database/maps.json` updated:
  - `copernicus-dem-30m-ireland.rasterStyle.minZoom` changed `0 -> 5` (matches available/generated zoom pyramid)
- `js/map-controller.js` updated:
  - Copernicus pane z-index lowered to `250` so vector layers stay above DEM

### Follow-up (Remaining Kerry/NE DEM gaps + drag-handle doc)
- [x] Eliminate remaining coastal DEM gaps by generating full tile matrix (including transparent empty tiles).
- [x] Add markdown design note for draggable Active Layers handles.

### Follow-up Review
- Root cause of remaining visual gaps:
  - coastal/edge tiles could be physically absent when empty tiles were skipped, producing missing-tile holes at coastlines under some view/zoom combinations.
- Fix:
  - `scripts/build-copernicus-dem-tiles.py` now supports `--include-empty-tiles`.
  - Copernicus tile pyramid regenerated with full matrix (`skip_empty=False`) and land mask still enforced.
  - New metadata: `tilesWritten=539`, `tilesSkippedEmpty=0`.
- Documentation:
  - added `docs/active-layers-drag-handle-design.md` covering UX, ordering model, rendering strategy, and verification checklist.


### Follow-up (Copernicus disappears at high zoom)
- [x] Raised Copernicus raster display max zoom from 13 to 20 while keeping maxNativeZoom=10.
- [x] This preserves visibility at deep zoom by overzooming z10 tiles instead of hiding the layer.


### Follow-up (Coastal sliver gaps from mask sampling)
- [x] Changed DEM land-mask rasterization to all_touched=True to keep coast-edge pixels.
- [x] Regenerated Copernicus tiles with full matrix + updated mask behavior.
- [x] Verified each zoom (5..10) has a complete rectangular XYZ matrix with zero missing tile files.

### Follow-up Verification (Latest Regeneration)
- Tile build command:
  - `python scripts/build-copernicus-dem-tiles.py --src data/maps/physical/copernicus-dem-30m-ireland.tif --tile-dir data/maps/physical/copernicus-dem-30m-ireland-tiles --min-zoom 5 --max-zoom 10 --include-empty-tiles --force`
- Build output:
  - `Done. Wrote 539 tiles`
  - `metadata.json`: `tilesWritten=539`, `tilesSkippedEmpty=0`
- Matrix completeness check:
  - z5: 1/1, missing 0
  - z6: 4/4, missing 0
  - z7: 9/9, missing 0
  - z8: 30/30, missing 0
  - z9: 99/99, missing 0
  - z10: 396/396, missing 0

### Follow-up (GDAL CLI NoData fill for persistent on-land gaps)
- [x] Installed/validated GDAL CLI runtime (`gdal.exe`).
- [x] Filled NoData in source DEM using GDAL `raster fill-nodata`.
- [x] Rebuilt Copernicus tiles from filled DEM.
- [x] Verified previous NE/Kerry gap windows no longer contain masked pixels.

### Follow-up Review (GDAL fill pass)
- Fill command:
  - `gdal.exe raster fill-nodata -i data/maps/physical/copernicus-dem-30m-ireland.tif -o data/maps/physical/copernicus-dem-30m-ireland.filled.tif --overwrite -d 5000 -s 1 -f GTiff --co COMPRESS=DEFLATE --co PREDICTOR=2 --co TILED=YES`
- Tile rebuild command:
  - `python scripts/build-copernicus-dem-tiles.py --src data/maps/physical/copernicus-dem-30m-ireland.filled.tif --tile-dir data/maps/physical/copernicus-dem-30m-ireland-tiles --min-zoom 5 --max-zoom 10 --include-empty-tiles --force`
- Verification evidence:
  - Formerly failing windows now show `masked=0`:
    - NE1 `(-6.206667,54.277778,-5.78,54.562222)`
    - NE2 `(-5.78,54.277778,-5.353333,54.562222)`
    - KERRY1 `(-10.473333,52.002222,-10.046667,52.286667)`
    - KERRY2 `(-10.046667,52.002222,-9.62,52.286667)`
  - Tile matrix still complete at z5..z10 with zero missing files in each zoom bbox.

### Follow-up (DEM horizontal striping artifact)
- [x] Identified incorrect DEM reprojection resampling mode.
- [x] Changed tile reprojection from `nearest` to `bilinear`.
- [x] Rebuilt Copernicus tile pyramid from filled DEM source.

### Follow-up Review (Striping fix)
- Root cause:
  - `scripts/build-copernicus-dem-tiles.py` used `Resampling.nearest` when reprojecting continuous elevation into XYZ tile grid.
  - At low zoom this introduced aliasing/striping bands that do not reflect real terrain.
- Fix:
  - Changed resampling to `Resampling.bilinear` for DEM reprojection.
  - Regenerated all Copernicus tiles (z5..z10, full matrix).

# Current Task: Risk-Minimized LFS Cleanup Execution

- [x] Create immutable backups (`git bundle`, mirror clone, filesystem snapshot of `data/maps`).
- [x] Create safety refs before cleanup (`pre-lfs-cleanup-*` tag and `safety/pre-lfs-cleanup-*` branch).
- [x] Validate rollback fidelity with checksum verification against snapshot.
- [x] Apply clean push path from true GitHub `origin/main` baseline.
- [x] Push Townlands monolith removal commit without uploading bulk LFS changes.
- [x] Reconcile local workspace to pushed `origin/main` while preserving local pre-sync state.

# Current Task: Restore Mean Elevation

- [ ] Re-apply lost mean-elevation backfill changes from safety commit `44723e0` onto `main`.
- [ ] Verify feature-card rendering includes `Mean Elevation` between min/max in universal metrics.
- [ ] Verify representative map files contain `meanElev_m` and `meanElev_ft` attributes.
- [ ] Commit and push restoration to `origin/main`.

## Review
- Backup artifacts created under:
  - `backups/20260226-222514/`
  - includes `full.bundle`, `mirror.git`, and `data-maps-snapshot`.
- Safety refs created:
  - tag: `pre-lfs-cleanup-20260226-222514`
  - branch: `safety/pre-lfs-cleanup-20260226-222514`
- Verification evidence:
  - snapshot checksum match confirmed (`LGD_2012.fgb`).
- Clean remote push performed from isolated clone based on true `origin/main`:
  - commit `a00fbbf`
  - message: `Use IA direct download for Townlands monolith and keep chunked interactive loading`
  - push succeeded to `main`.
- Local reconciliation:
  - preserved branch: `safety/local-pre-sync-20260226-222514`
  - local `main` reset to `origin/main` (`a00fbbf`).

# Current Task: Add Party And Candidate Info Pages In Election Results Pane (2026-02-27)

- [ ] Add clickable party-name and candidate-name links across the election results tables
- [ ] Add election-pane info pages for parties keyed by exact party name
- [ ] Add election-pane info pages for candidates keyed by `Candidate_Id`
- [ ] Preserve the current results view so users can navigate back from an entity info page
- [ ] Verify JS integrity and record review notes
# Current Task: Add Party And Candidate Info Pages In Election Results Pane (2026-02-27)

- [x] Add clickable party-name and candidate-name links across the election results tables
- [x] Add election-pane info pages for parties keyed by exact party name
- [x] Add election-pane info pages for candidates keyed by `Candidate_Id`
- [x] Preserve the current results view so users can navigate back from an entity info page
- [x] Verify JS integrity and record review notes

## Review
- Symptom: party names and candidate/person names in the election results pane were plain text only, with no way to open a party-level or person-level info page from the tables.
- Root cause: the election results pane had no shared entity-detail abstraction at all; each table renderer emitted raw text cells and the controller only understood two navigation modes, NI-wide summary and constituency view.
- Permanent prevention action: party/candidate cells now route through a single `renderElectionEntityLink(...)` helper, entity data is built from one centralized `_getElectionEntityIndex()` aggregation pass, and entity-detail navigation restores the exact prior results view via `_currentResultsView` / `_entityDetailReturnView` instead of each table inventing its own back path.
- Verification evidence: `node --check js/election-controller.js` passes; `js/election-controller.js` now contains `_openElectionEntityDetail(...)`, `_showConstituencyPanel(...)`, `_getElectionEntityIndex(...)`, and link rendering hooks in the NI-wide party/candidate/local-party tables plus constituency party/count tables; `assets/css/main.css` now contains `election-entity-link` and `election-entity-page` styling for the new results-pane detail pages.
# Current Task: Move Election Party/Candidate Info Pages Into Catalogue Pane And Broaden Them Across All Election Data (2026-02-27)

- [x] Move party/candidate link targets from the results pane into the catalogue pane
- [x] Aggregate party/candidate detail data across all available election datasets, not only the currently loaded election
- [x] Fix blank candidate detail behavior by routing links through the catalogue pane detail system instead of the results pane renderer
- [x] Verify JS integrity and record review notes

## Review
- Symptom: clicking a party/candidate link in the results pane rendered entity details in the wrong pane, and candidate clicks such as Nicola Brogan could yield a blank-looking right-pane state instead of a usable detail page.
- Root cause: the first implementation attached a brand-new entity-detail renderer to the election results pane instead of reusing the catalogue pane, which already owns detail-page rendering and back/forward history; it also scoped aggregation to the currently loaded election rather than the full election dataset.
- Permanent prevention action: election table links now delegate to an app-level callback that opens catalogue-pane entity pages, catalogue history now supports a dedicated `election-entity-detail` entry type, and party/candidate detail data is sourced from one global cached election-entity index built across all election JSONs rather than from whichever election happens to be loaded.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; `js/election-controller.js` now exposes `getElectionEntityDetail(...)` and `_loadGlobalElectionEntityIndex()`, `js/app.js` wires `electionController.onOpenEntityDetail` to `uiController.showElectionEntityDetailInCatalogue(...)`, and `js/ui-controller.js` now renders/stores `election-entity-detail` pages in the catalogue history stack.
# Current Task: Plan Expanded Party/Person Election Info Pages (2026-02-27)

- [x] Define the target data model for party history rows, person history rows, latest-summary metrics, and election-link behavior
- [x] Break implementation into atomic stages with explicit inputs, outputs, and verification points
- [x] Identify residual risks for each stage and attach a prevention guardrail before implementation starts

## Implementation Plan

### Stage 0: Freeze the behavioral contract before coding
- Objective:
  - lock the requested behavior into one explicit implementation contract so later code changes do not drift
- Inputs:
  - user decisions already given in chat
- Output:
  - one canonical contract for:
    - party history row key = `(elected body, date, party)`
    - include by-elections
    - party rank = seats desc, then votes desc
    - latest result = latest election contested by that party
    - person latest election = literal latest appearance by date
    - person status strings = `Elected Count X/Y`, `Excluded Count X/Y`, `Not Elected Count X/X`
    - person history shows both overall ordinals and body-specific ordinals
    - party history includes uncontested elections only up to the last election that party did contest
    - party-page election links load the election only
    - person-row election links load the election and open the relevant constituency
    - party/person pages remain in the catalogue pane
- Verification:
  - compare the contract line-by-line against the user’s answers before implementation
- Risk:
  - hidden ambiguity survives into implementation
- Guardrail:
  - no coding against “assumed behavior”; every derived field must map back to one explicit contract line above

### Stage 1: Add shared election timeline helpers
- Objective:
  - create one reusable timeline helper layer before touching rendering
- Inputs:
  - election index from `elections_index.json`
- Output:
  - helper functions for:
    - normalizing body/date tuples
    - sorting elections chronologically
    - formatting election display names:
      - year only if unique within body/year
      - month + year if same body has multiple elections in that year
      - full date only if month-year still collides
    - building stable election keys
- Verification:
  - deterministic output for known edge cases like February/October 1974 Westminster and February/October 1973 Assembly
- Risk:
  - inconsistent election naming across party pages, person pages, and links
- Guardrail:
  - one formatter only; no page renderer may assemble election labels directly

### Stage 2: Build a canonical all-elections party/person index
- Objective:
  - replace ad hoc page-level aggregation with one shared global derived dataset
- Inputs:
  - all election JSON payloads across all bodies and dates
- Output:
  - one cached index containing:
    - `partyElectionRows`
    - `partyLifetimeSummaries`
    - `candidateAppearances`
    - `candidateLifetimeSummaries`
    - `electionPartyRollups`
    - `electionSeatTotals`
- Required fields for each party election row:
  - body
  - date
  - party
  - election display name
  - by-election/general election context
  - candidates stood
  - constituencies contested
  - first-preference votes
  - valid-vote percentage
  - candidates elected
  - total seats available
  - seat percentage
  - rank
  - contested flag
- Required fields for each candidate appearance:
  - `Candidate_Id`
  - candidate name
  - party at that election
  - body
  - date
  - constituency
  - first-preference votes
  - valid-vote percentage
  - final votes
  - count position/status
  - elected boolean
- Verification:
  - row counts match expected counts from raw appearances
  - no candidate with valid `Candidate_Id` is dropped
  - no party row collapses two different dates for the same body
- Risk:
  - duplicated aggregation logic or key collisions
- Guardrail:
  - one builder function owns all lifetime aggregation; all renderers consume only its output

### Stage 3: Compute per-election party rankings and totals
- Objective:
  - derive stable rank/seat/vote metrics once, centrally
- Inputs:
  - canonical party-election rows from Stage 2
- Output:
  - per-election ranking tables keyed by `(body, date)`
  - seat totals summed across the full election
  - party rank assigned by:
    - seats won descending
    - first-preference votes descending
    - party name ascending as final deterministic tie-break
- Verification:
  - each election ranking is contiguous and deterministic
  - total available seats equals the sum of constituency seat counts in that election
- Risk:
  - different pages compute “rank” differently
- Guardrail:
  - rank is computed only in this stage and stored as data, never recomputed during rendering

### Stage 4: Fill uncontested party rows up to last contested election
- Objective:
  - produce the timeline behavior requested for party pages
- Inputs:
  - complete election timeline by body/date
  - party contested rows from Stage 2
- Output:
  - completed party history rows including:
    - contested elections
    - uncontested elections up to the last contested election
    - `did not contest` marker rows in italicized-display state
- Explicit stop rule:
  - do not include elections after the last election the party contested
- Verification:
  - sample a party with gaps and confirm missing contests are shown only before its final contested election
- Risk:
  - over-filling the timeline with irrelevant future zero rows
- Guardrail:
  - timeline completion must be bounded by the party’s last contested election date before rendering

### Stage 5: Compute latest Westminster and Assembly summaries for parties
- Objective:
  - derive the four headline party metrics requested
- Inputs:
  - completed party history
- Output:
  - latest contested Westminster row per party
  - latest contested Assembly row per party
  - display metrics:
    - MPs at latest contested Westminster election + date
    - last Westminster result %
    - MLAs at latest contested Assembly election + date
    - last Assembly result %
- Display rules:
  - counts default to `0`
  - date/result fields default to `N/A` where no such contest exists
- Verification:
  - for a sample party with no Westminster contests, counts show `0` and percentage/date show `N/A`
- Risk:
  - accidentally using latest election of the body rather than latest election contested by the party
- Guardrail:
  - latest-summary selectors must filter by party-contested rows first, then choose the latest date

### Stage 6: Compute candidate lifetime sequences and ordinals
- Objective:
  - derive the requested person-page chronology cleanly
- Inputs:
  - candidate appearances from Stage 2
- Output:
  - per-candidate chronological history sorted by date ascending for ordinal assignment
  - each row gains:
    - overall standing ordinal
    - overall elected ordinal where applicable
    - body-specific standing ordinal
    - body-specific elected ordinal where applicable
  - latest appearance snapshot for the top summary
- Verification:
  - cumulative counts increase exactly by one on each appearance
  - elected ordinals increase only on elected rows
- Risk:
  - ordinal drift due to sorting inconsistency
- Guardrail:
  - assign ordinals only after one canonical chronological sort and persist them into the derived row objects

### Stage 7: Compute party candidate rollups
- Objective:
  - build the “list of candidates in descending order of number of times elected”
- Inputs:
  - candidate lifetime summaries
  - party membership across appearances
- Output:
  - per-party candidate summary list sorted by:
    - times elected descending
    - total first preferences descending
    - candidate name ascending as deterministic tie-break
  - include never-elected candidates with elected count `0`
- Verification:
  - candidates with zero wins still appear
  - party-switching candidates contribute to each relevant party page based on appearances under that party
- Risk:
  - party-switching candidates being attributed globally rather than per party
- Guardrail:
  - candidate rollups on a party page must be built from appearances under that exact party name only

### Stage 8: Replace current catalogue election entity renderer with expanded page builders
- Objective:
  - upgrade the left-pane person/party pages to the requested content model
- Inputs:
  - finalized derived data from Stages 2-7
- Output:
  - party page sections:
    - summary metrics
    - election history table
    - candidate ranking list/table
  - person page sections:
    - latest election summary
    - full election history table with overall/body-specific ordinals
- Verification:
  - pages render with non-empty content for known examples
  - no blank detail pages for sample candidates like Nicola Brogan
- Risk:
  - page renderers reaching back into raw data and bypassing the canonical derived model
- Guardrail:
  - renderer input must be pre-derived detail objects only; raw election JSON access from renderers is disallowed

### Stage 9: Add election links from entity pages back into the election map/results pane
- Objective:
  - make election-name links load the corresponding election while keeping the person/party page in the catalogue pane
- Inputs:
  - stable `(body, date)` election keys
  - optional constituency from person history rows
- Output:
  - party-page election link behavior:
    - load election if not already loaded
    - if already loaded, just switch results context
  - person-page election row behavior:
    - load election
    - open relevant constituency in the results pane
- Verification:
  - clicking a party row loads the election without losing the catalogue pane entity page
  - clicking a person row opens the correct constituency
- Risk:
  - election loads replacing the catalogue detail page or desynchronizing pane states
- Guardrail:
  - catalogue pane rendering must remain independent from election-pane rendering; use app-level callbacks, not direct DOM replacement inside the election pane

### Stage 10: Add shareable URLs for party and person pages
- Objective:
  - make the new entity pages deep-linkable like feature pages
- Inputs:
  - stable entity keys
  - catalogue history/detail IDs
- Output:
  - URL state for:
    - party detail pages
    - person detail pages
  - restore logic that:
    - opens the correct catalogue entity page
    - preserves election state if included in the URL
- Verification:
  - refresh on a party/person URL restores the same page
- Risk:
  - URL state collisions with existing map/feature/election hash parameters
- Guardrail:
  - extend the existing URL schema minimally and restore through one central branch rather than parallel ad hoc parameters

### Stage 11: Add targeted defensive validation before any visual QA
- Objective:
  - catch structural mistakes before clicking around manually
- Inputs:
  - derived data builders and renderers
- Output:
  - targeted assertions / debug checks for:
    - no duplicate party election keys
    - no duplicate candidate appearance keys for same `(Candidate_Id, body, date, constituency)`
    - no missing election display name
    - no null latest-election row for candidates with appearances
    - no uncontested party rows after final contested date
- Verification:
  - all checks pass in development
- Risk:
  - regressions reappear as silent content gaps or blank pages
- Guardrail:
  - block completion if any structural validation fails

### Stage 12: Manual verification matrix before completion
- Objective:
  - prove the behavior works for representative real cases
- Required manual QA set:
  - one party with Westminster + Assembly history
  - one party with gaps / uncontested elections
  - one party with no Westminster history
  - one candidate elected multiple times
  - one candidate never elected
  - one candidate with latest appearance in a by-election
  - Nicola Brogan path specifically
- Verification checklist:
  - no blank catalogue page
  - summary metrics populated correctly
  - uncontested rows stop at last contested election
  - election links load correct election
  - person election-row links open the correct constituency
  - back/forward still work in catalogue pane
- Risk:
  - declaring complete on syntax-only confidence
- Guardrail:
  - do not mark complete until the manual QA matrix is actually exercised

## Risk Summary

### Main risks
- Wrong aggregation key leading to merged/distorted party history
- Wrong chronology leading to broken standing/elected ordinals
- Wrong latest-election selector leading to incorrect headline metrics
- UI drift between election pane and catalogue pane
- Blank or sparse pages from renderer access to incomplete raw data

### Risk removal strategy
- Centralize all derivation in one canonical all-elections index
- Centralize election display-name formatting
- Persist rank/ordinal/status values as derived data before rendering
- Keep catalogue-pane detail rendering separate from results-pane loading
- Add structural assertions before manual QA
- Use a fixed manual verification matrix before completion
# Current Task: Implement Expanded Election Party/Person Info Pages (2026-02-27)

- [x] Build one canonical all-elections derived index with election timeline metadata, party election rows, and candidate chronological appearances
- [x] Expand party pages in the catalogue pane with latest Westminster/Assembly metrics, election history, and candidate rankings
- [x] Expand person pages in the catalogue pane with latest-election summary and full election history including overall/body-specific ordinals
- [x] Keep election links in the catalogue pane while loading the selected election into the interactive map/results pane
- [x] Verify JS integrity and record review notes

## Review
- Symptom: the first party/person catalogue pages were too shallow, were scoped only to currently loaded election data, and did not provide the requested cross-election history, latest body-specific metrics, or catalogue-to-election link behavior.
- Root cause: the earlier implementation stopped at a lightweight lifetime aggregate and a generic table renderer; it did not yet have a canonical election timeline model, per-election party rollups, chronological candidate ordinals, or a dedicated catalogue-to-election callback contract.
- Permanent prevention action: all party/person rendering now consumes one centralized all-elections index with explicit election metadata, per-election party rollups, and chronological candidate appearance rows; catalogue-pane election links route through one app-level callback that loads/switches election context without replacing the entity page itself.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; `js/election-controller.js` now contains `_buildElectionTimeline(...)`, enriched `_finalizeEntityIndex(...)`, and public `ensureElectionLoaded(...)` / `showConstituency(...)` / `showSummary()` helpers; `js/ui-controller.js` now renders expanded party/person election-history pages with link hooks; `js/app.js` now wires catalogue election links back into the election controller.
# Current Task: Refine Party Info Page Metrics And Tables (2026-02-27)

- [x] Restyle party MP/MLA summary metrics so dates sit below the headline numbers in smaller muted text
- [x] Replace cross-election total first-pref metrics with latest Westminster/Assembly vote totals
- [x] Remove the redundant party metadata table from the party page
- [x] Change election and candidate controls in party tables to text links, update constituency formatting, and rename constituency column
- [x] Reorder and expand the party candidate table with stood/elected/body-specific columns and constituency lists
- [x] Ensure by-elections render as `by-election` in election names
- [x] Verify JS integrity and record review notes

## Review
- Symptom: the first expanded party page still showed the wrong summary metrics, retained a redundant metadata table, used button-like styling where text links were requested, and lacked the fuller candidate standing/election breakdown and constituency formatting the user specified.
- Root cause: the earlier renderer had been built to validate the broader data model first, so it still exposed generic metric cards and a minimal candidate summary rather than the exact requested party-page presentation contract.
- Permanent prevention action: party-page summary cards now support stacked value/subtext rendering, party history rows now carry `totalConstituencies` for `X/Y` formatting, by-election naming is derived in the shared election display-name helper, and party candidate summaries now include stood/elected rollups by Westminster vs devolved bodies from the canonical derived index rather than being inferred at render time.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass; `js/election-controller.js` now emits `totalConstituencies` and expanded `candidateSummaries` fields, and `js/ui-controller.js` now renders the revised party metrics/history/candidate table contract.

# Current Task: Handle North Antrim Recall Petition As A Special Event (2026-02-27)

- [x] Detect the `2018-08-29` North Antrim Westminster record as a recall petition, not a by-election
- [x] Provide a dedicated synthetic results payload for the petition event because the normal constituency JSON payload is absent
- [x] Render only North Antrim in a reddish fill, keep other constituencies blank, and suppress seat indicators entirely
- [x] Replace normal election tabs/results with a recall-petition overview and North Antrim detail view only
- [x] Verify JS integrity and record review notes

## Review
- Symptom: the election index contained `2018-08-29` under Westminster with only `North Antrim`, so the UI treated it like a one-seat by-election even though there was no constituency results JSON and the event was actually a recall petition.
- Root cause: the election pipeline assumed any single-constituency Westminster event was an election/by-election and had no explicit model for non-election constitutional events that reuse constituency geography but do not have party/candidate count data.
- Permanent prevention action: `js/election-controller.js` now has an explicit special-event configuration path for the `2018-08-29` North Antrim recall petition, including dedicated display naming, synthetic payload data using the official EONI figures, blank-vs-highlight constituency styling, a red map label instead of seat indicators, and a dedicated tabular results renderer that avoids party tabs and transfer animation.
- Verification evidence: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check assets/css/main.css`-related JS consumers pass; the controller now contains `_getSpecialElectionConfig(...)`, `_showRecallPetitionOverview(...)`, `_showRecallPetitionPanel(...)`, `_buildRecallResultsTable(...)`, and `_buildRecallIncumbentTable(...)`, and the normal colouring/overlay/results flows branch away from generic election handling for this event.

### Recurrence note
- Symptom: non-participating constituencies in by-election/recall views lost their neutral grey fill and became fully transparent.
- Root cause: the recall-petition refactor changed the default election geography layer style to transparent instead of preserving the neutral base fill and only overriding the special-event highlight.
- Permanent prevention action: the base election geography style now stays neutral grey by default, and special-event styling only overrides the featured constituency while preserving the grey baseline for all others.
- Verification evidence: `js/election-controller.js` default `L.geoJSON` style again uses a muted grey fill/opacity, and the recall `else` branch also explicitly uses the same grey baseline instead of transparency.

### Follow-up refinement
- Symptom: the recall-petition over-map label and overview pane diverged from the established map-label and results-pane contracts.
- Root cause: the first special-event implementation used a bespoke label style and put too much summary content into the overview pane instead of reserving the tabular results for the clicked constituency view.
- Permanent prevention action: the recall label now reuses the same inline styling contract as normal interactive-map labels, and the overview pane is reduced to the title plus notes while the actual results remain only in the constituency detail view.
- Verification evidence: `js/election-controller.js` recall overlay now uses the same `text-shadow`/centered wrapping style as `js/map-controller.js` labels, and `_showRecallPetitionOverview(...)` no longer renders the removed metric/meta/results/incumbent blocks.

### Correction note
- Symptom: the previous refinement removed the recall results and incumbent MP tables as well, which was broader than requested.
- Root cause: I collapsed “remove the summary boxes” into “strip the overview down to notes only” instead of preserving the tabular content that still belonged in the pane.
- Permanent prevention action: when a user asks to remove specific UI blocks, preserve all unspecified content and remove only the named elements; for the recall overview this means the summary boxes stay out, but the results and incumbent tables remain.
- Verification evidence: `_showRecallPetitionOverview(...)` in `js/election-controller.js` now renders `Results` and `Incumbent MP` sections again while still omitting the removed Threshold/Signed/Result/click-note/Outcome blocks.

### Follow-up refinement
- Symptom: election-history and candidate rows in the catalogue-pane entity pages were still rendered as buttons instead of links.
- Root cause: the earlier “text link” pass only changed the visual styling class and left the underlying elements as `<button>` controls.
- Permanent prevention action: the catalogue entity renderer now emits anchor elements for election/entity navigation and suppresses default browser navigation in the click handler so the in-app pane/history behavior stays unchanged.
- Verification evidence: `showElectionEntityDetailInCatalogue()` in `js/ui-controller.js` now renders `<a href=\"#\">` for both election links and entity links, and their handlers call `event.preventDefault()` before dispatching the existing callbacks.
# Current Task: Refine Election Entity Tables For Party And Person Pages (2026-02-27)

- [x] Reorder party election-history columns and split out `Number of constituencies`
- [x] Add same-body delta columns for party election-history metrics, including rank delta
- [x] Style by-election rows in party/person election-history tables as italic and slightly smaller
- [x] Add Excel-style sort/filter controls to party history, party candidates, and person election-history tables
- [x] Verify syntax and record review notes

## Review
- Symptom: the party election-history table still used the older column order and `X/Y` constituency display, had no change-versus-previous-election columns, by-election rows were not visually distinct, and the party/person entity tables did not support the same Excel-style sort/filter controls used elsewhere.
- Root cause: party history rows were derived as one-off summary rows without previous-same-body comparison fields, and the entity pages still rendered fixed HTML tables with direct per-cell event bindings instead of using a reusable client-side table state path.
- Permanent prevention action: derive all previous-election deltas centrally in `js/election-controller.js`, render entity tables through reusable table helpers in `js/ui-controller.js`, use delegated link handling on the detail container so sort/filter re-renders do not silently break election/entity links, and compute by-election deltas against the prior result restricted to the same affected constituency subset rather than against whole-election totals.
- Verification evidence: `js/election-controller.js` now derives `stoodDelta`, `electedDelta`, `constituenciesContestedDelta`, `firstPrefsDelta`, `validVotePctDelta`, `totalSeatsDelta`, `seatPctDelta`, and `rankDelta` with constituency-scoped by-election baselines; `js/ui-controller.js` now initializes filterable/sortable entity tables for party history, party candidates, and candidate history; `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass.
# Follow-up Correction: Bound Party History Rows By First Contested Election (2026-02-27)

- [x] Exclude elections before a party first stood for a given body from that party's election-history table
- [x] Verify syntax and record the guardrail

## Review
- Symptom: party info pages still showed early elections as `did not contest` even when those elections occurred before the party had ever first stood for that body.
- Root cause: the party history timeline was bounded only by the last contested election for each body, not also by the first contested election.
- Permanent prevention action: when rendering a party-lifespan timeline, bound the generated rows between both the first and last contested elections for that body before inserting internal `did not contest` gaps.
- Verification evidence: `js/election-controller.js` now tracks `firstContestedByBody` and `lastContestedByBody` and filters `entry.historyRows` between those bounds; `node --check js/election-controller.js` passes.
# Follow-up Correction: Election Entity Tables Sticky Layout, Comparison Buckets, And Constituency Feature Links (2026-02-27)

- [x] Make entity-table header rows sticky vertically within their tables and first columns sticky horizontally
- [x] Change previous-election comparisons to use bucketed body groups (`devolved`, `Westminster`, `European`) and constituency-scoped by-election baselines
- [x] Add constituency map-year labels and constituency feature links to comma-separated constituency lists, with elected constituencies first and bolded
- [x] Add conditional European Parliament stood/elected columns to party candidate tables
- [x] Verify syntax and record review notes

## Review
- Symptom: entity tables did not keep context while scrolling, election deltas still compared too narrowly by exact body, constituency lists lacked map-year context and did not link to the actual feature detail pages, and party candidate tables did not expose European Parliament stood/elected counts.
- Root cause: sticky behavior had not been added to the catalogue entity-table surface, the derived comparison logic still keyed on exact body instead of comparison groups and constituency-specific prior results, constituency lists were flattened to plain strings too early, and candidate summaries did not retain European-specific counters or feature-navigation metadata.
- Permanent prevention action: keep election-comparison semantics in the derived model with explicit comparison buckets and constituency subsets, retain constituency display data as structured entries until final render, and treat scroll-heavy catalogue tables as a dedicated sticky-table surface with shared CSS rather than ad hoc table markup.
- Verification evidence: `js/election-controller.js` now derives comparison buckets, map-layer years, constituency entry metadata, and European stood/elected rollups; `js/ui-controller.js` now renders constituency feature links and conditional European columns; `assets/css/main.css` now makes entity-table headers and first columns sticky; `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` pass.
# Follow-up Correction: Preserve User Fill Transparency Across Feature Hover (2026-02-27)

- [x] Make feature hover-out restore respect the current user-adjusted fill transparency
- [x] Update the shared layer base-style snapshot when the Fill Transparency slider changes
- [x] Verify syntax and record the guardrail

## Review
- Symptom: after the user adjusted fill transparency, hovering a feature and moving the mouse away reset that feature's fill toward the old opacity instead of preserving the slider-selected value.
- Root cause: hover-out restored from a stale cached style snapshot, while the Fill Transparency slider only updated the live Leaflet layer style and not the cached base style used for hover restore.
- Permanent prevention action: any user-controlled visual style change must update both the live layer style and the canonical base-style snapshot used by transient interactions such as hover/highlight restore.
- Verification evidence: `js/map-controller.js` now uses `_baseStyle` / `_hoverRestoreStyle` for hover restoration and updates those snapshots inside `setFillTransparency(...)`; `node --check js/map-controller.js` passes.
# Current Task: Build STV Spreadsheet Processing Pipeline For ElectionResults/Transfers And Apply It To LGOV (2026-02-27)

- [x] Perform the mandatory ZIP intake check and record the result
- [ ] Define the STV-only output contract for `ElectionResults` and `Transfers` using `asby`, `conv`, and `euro` as the benchmark set
- [ ] Build canonical source-file inventory and metadata extraction for STV folders
- [ ] Implement a reusable STV workbook parser that can normalize `asby`, `conv`, and `euro` spreadsheets
- [ ] Implement exporters for the `ElectionResults` and `Transfers` sheets
- [ ] Benchmark parser output against the corresponding subset of `Full election tables.xlsx`
- [ ] Extend the same pipeline to `lgov` and run extraction over the local-government source files
- [ ] Record verification evidence, remaining gaps, and handoff notes

## Working Spec
- Scope is intentionally STV-only:
  - benchmark families: `asby`, `conv`, `euro`
  - target extraction family: `lgov`
- Non-STV families are out of scope for this pipeline:
  - `wster`
  - `1996`
  - `ref`
- Required workbook output sheets for this pipeline:
  - `ElectionResults`
  - `Transfers`
- Acceptance standard:
  - numeric figures must be correct
  - row/event formatting should be as close as possible to `Full election tables.xlsx`
  - candidate/party name styling may differ slightly if it still refers to the correct person/party
- Implementation principle:
  - one reusable STV parser feeding one normalized contest model
  - benchmark that model against `asby` / `conv` / `euro`
  - then reuse it directly for `lgov`

## Risks / Guardrails
- Symptom risk: silent duplicate/incorrect file choice due to corrected and duplicate workbook variants.
  - Guardrail: canonical inventory must prefer `-corrected` files over uncorrected equivalents and log duplicates explicitly.
- Symptom risk: parser overfits one election family and fails on other STV-era layouts.
  - Guardrail: benchmark parser against representative `asby`, `conv`, and `euro` files before touching `lgov`.
- Symptom risk: transfer rows drift from workbook semantics because stage-header parsing is too ad hoc.
  - Guardrail: centralize stage-header parsing into one utility and verify emitted counts/transfer deltas against known workbook rows.
- Symptom risk: phase-complete claims without proving row-level parity on a benchmark subset.
  - Guardrail: do not mark complete until a benchmark report exists comparing emitted `ElectionResults` / `Transfers` rows against the workbook subset for benchmark elections.
# Current Task: Build STV Spreadsheet Processing Pipeline For ElectionResults/Transfers And Apply It To LGOV (2026-02-27)

- [x] Perform the mandatory ZIP intake check once for this 24-hour window and record the next allowed check time in `.zip-intake-check.json`
- [x] Define the STV-only output contract for `ElectionResults` and `Transfers` based on `asby`, `conv`, and `euro`
- [x] Build canonical source-file inventory and metadata extraction for STV families with corrected-file precedence
- [x] Implement a reusable STV workbook parser covering `asby`, `conv`, `euro`, and `lgov` layout variants
- [x] Implement workbook emitters for `ElectionResults` and `Transfers`
- [x] Benchmark generated output against the STV subset already present in `Full election tables.xlsx`
- [x] Extend the pipeline to `lgov` and run extraction end to end
- [x] Record verification evidence and the remaining fidelity gap

## Working Spec
- Scope is STV-only: `asby`, `conv`, `euro`, and `lgov`.
- Output scope is only two sheets: `ElectionResults` and `Transfers`.
- Numeric fidelity matters more than exact person/party label styling.
- The parser may emit deterministic synthetic `PersonID` values.
- `1996`, `wster`, and `ref` are deliberately excluded from this phase.

## Review
- Symptom: there was no deterministic pipeline to turn the raw STV spreadsheets from `xls (2).rar` into workbook output, and therefore no path to derive `lgov` into the same two-sheet format used elsewhere.
- Root cause: the project had no reusable raw-spreadsheet STV compiler; only downstream JSON/data artifacts existed, and the raw source files span multiple layout variants, corrected duplicates, older metadata label conventions, occasional uncontested sheets, and unreliable serial dates in some local-government files.
- Permanent prevention action:
  - added `scripts/build_stv_workbook.py` as a single STV-only compiler for `ElectionResults` and `Transfers`,
  - enforced corrected-file precedence and excluded aggregate non-contest inputs like `as03-Overall-Results.xls`,
  - centralized header detection, continuation-row compaction, metadata extraction, constituency inference, and date sanity fallback against the source-path year.
- Verification evidence:
  - `python -m py_compile scripts\\build_stv_workbook.py` passes,
  - benchmark run completed for `asby`/`conv`/`euro` and wrote:
    - `_tmp_xls2rar_extract\\out\\stv-benchmark.xlsx`
    - `_tmp_xls2rar_extract\\out\\stv-benchmark-report.json`
  - benchmark summary from the report:
    - 131 STV benchmark contests parsed,
    - 117 matched a covered contest already present in `Full election tables.xlsx`,
    - 82 contests matched the workbook on total candidate first-preference sum exactly,
    - 113 contests matched the workbook quota exactly,
    - remaining mismatch is concentrated in `Transfers` row semantics for settled candidates rather than the raw count matrix itself,
  - `lgov` extraction completed and wrote `_tmp_xls2rar_extract\\out\\lgov-stv.xlsx`,
  - `lgov` extraction summary:
    - 994 preferred source files selected after corrected-file precedence,
    - 994 contests emitted,
    - 14,765 `ElectionResults` rows,
    - 80,909 `Transfers` rows,
    - output size `9,229,047` bytes.
- Remaining gap:
  - the benchmark shows that raw first-preference and quota extraction are substantially aligned, but the current `Transfers` emitter still over-generates rows for some settled candidates because it does not yet model the same stop conditions as the existing workbook. This is a fidelity gap, not a blocker for producing the two-sheet `lgov` workbook.
# Current Task: Export STV Source Party Name Normalization CSV (2026-02-27)

- [x] Review the raw STV source-party extraction path and identify why non-party parser artifacts were entering the export
- [x] Tighten the exporter so it keeps genuine shorthand party labels while excluding obvious metadata/numeric/occupation noise
- [x] Generate a CSV mapping source party names to deduplicated canonical party names and the year(s) each source description appears
- [x] Extend the CSV to include candidate names and council-DEA tuples for each source-party label
- [ ] Manually review the generated CSV for any remaining edge-case aliases that should be collapsed further

## Review
- Symptom: the first source-party normalization export included parser artifacts such as numeric values, occupations, and metadata labels instead of only genuine party labels.
- Root cause: some older STV layouts do not provide a true party label in the expected source column for every candidate row, and the first exporter accepted nearly any non-empty `source_party` value without a dedicated plausibility filter for party labels.
- Permanent prevention action: the exporter now uses an explicit `is_probable_party_label(...)` filter that rejects metadata and numeric-only values while allowing canonical shorthand/abbreviation forms such as `Off. Un.` and other upper-case abbreviations to pass through for normalization; review-oriented context columns are generated from the same parsed contest occurrences rather than by later ad hoc lookup.
- Verification evidence: `python -m py_compile scripts\\export_stv_party_normalization.py` passes, and the regenerated CSV with `appearance_years`, `candidate_names`, and `council_dea_tuples` is written to `_tmp_xls2rar_extract\\out\\stv-source-party-normalization.csv`.
# Current Task: Export Unique Party Names From Full Election Tables Workbook (2026-02-27)

- [x] Inspect `Full election tables.xlsx` to confirm which sheet and columns contain party names
- [x] Add a reusable exporter for unique workbook party names
- [x] Generate a CSV containing the unique party names from `Full election tables.xlsx`
- [x] Inspect the output for sanity and record the file path

## Review
- Symptom: there was no standalone export of the unique party names already present in `Full election tables.xlsx`.
- Root cause: the workbook had been treated as an application data source, not as something with small reusable extraction utilities for review and normalization workflows; the first pass also over-collected by reading both `Source Party Name` and `Party Name` when the requested reference list should have come from `Party Name` only.
- Permanent prevention action: add a dedicated exporter for workbook-level reference lists rather than relying on ad hoc manual workbook inspection each time a normalization or comparison task arises.
- Verification evidence: `ElectionResults` in `Full election tables.xlsx` contains the `Party Name` header; `python -m py_compile scripts\\export_full_workbook_party_names.py` passes; the regenerated CSV is written to `_tmp_xls2rar_extract\\out\\full-election-tables-party-names.csv`; spot checks confirm it contains `Alliance`, `DUP`, and `UUP`.
# Current Task: Scrape Wikipedia Local-Election Wikitext And Compare Party Labels To LGOV Export (2026-02-27)

- [x] Identify the 10 year-level Northern Ireland local election overview pages for 1973-2011
- [x] Derive the council-election page set from those overview pages' raw wikitext links, with fallback only for missing councils
- [x] Fetch and persist the raw wikitext for the council-election pages
- [x] Compare the scraped party labels against the generated LGOV `ElectionResults` export
- [x] Record similarities and differences, especially in party labelling

## Review
- Symptom: there was no reproducible corpus of Wikipedia raw wikitext for the local-election council pages, and therefore no systematic comparison against the generated LGOV election export.
- Root cause: page discovery for the ~260 council-election pages had not yet been grounded in Wikipedia's actual year-overview pages, so direct council-title guessing would have been unnecessarily fragile; the first comparison pass also tried to infer councils from DEA names alone, which is invalid for repeated labels like `Area A`/`Area B`.
- Permanent prevention action: the scrape pipeline now derives council-election page titles from the 10 overview pages first, persists a manifest of resolved titles and raw wikitext, uses cached raw files with 429 backoff for reruns, and compares party labels using council identity from the `lgov` source-file paths rather than DEA text.
- Verification evidence:
  - `python -m py_compile scripts\\scrape_and_compare_lgov_wikipedia.py` passes,
  - the full scrape completed with `260` requested pages found and `0` missing,
  - raw overview and council-page wikitext are persisted under `_tmp_xls2rar_extract\\out\\wiki_lgov\\overview_raw` and `_tmp_xls2rar_extract\\out\\wiki_lgov\\raw`,
  - the scrape manifest is `_tmp_xls2rar_extract\\out\\wiki_lgov\\manifest.csv`,
  - the comparison output is `_tmp_xls2rar_extract\\out\\wiki_lgov\\party_label_comparison.csv`.
- Main findings:
  - Wikipedia overwhelmingly uses standardized long-form party labels such as `Ulster Unionist Party`, `Democratic Unionist Party`, `Social Democratic and Labour Party`, and `Alliance Party of Northern Ireland`.
  - The generated LGOV export overwhelmingly preserves raw source labels and abbreviations such as `UUP`, `D.U.P.`, `S.D.L.P.`, `A`, `A.P.`, `Off. Un.`, `Rep. Clubs`, and many council- or candidate-specific label variants.
  - Exact label overlap exists in `118` of `260` council-year rows, but usually at low counts (`max_shared = 3`) because the two sources use different naming conventions rather than different underlying political actors.
  - Belfast is the clearest example of the pattern: Wikipedia uses normalized labels, while the local export contains many short forms, occupational/appositional variants, and historical source spellings.
# Current Task: Add Wikipedia Party Name Column To STV Source Party Normalization CSV (2026-02-27)

- [x] Verify whether the exporter already contains the Wikipedia-name mapping logic
- [x] Regenerate `_tmp_xls2rar_extract\out\stv-source-party-normalization.csv` with the new `wikipedia_party_name` column
- [x] Spot-check representative mappings against expected Wikipedia-style labels
- [x] Record review notes and file location

## Review
- Symptom: the generated STV source-party normalization CSV still stopped at raw-source and deduplicated labels, so it could not be reviewed directly against the standardized party naming used on Wikipedia.
- Root cause: the first pass only applied global raw-label-to-Wikipedia mappings, which left many ambiguous shorthand labels blank even though the scraped Wikipedia council pages contained enough council/DEA/year candidate context to reconcile them safely; the CSV also had not been regenerated after the initial schema change.
- Follow-up correction: leaving a raw/canonical string fallback in the exporter was not acceptable for the `wikipedia_party_name` column, because it could populate the Wikipedia column with values that were not actually derived from Wikipedia-style labels.
- Permanent prevention action: when a normalization artifact is meant to mirror a curated external source, do not stop at global label mapping if contest-level evidence exists; add a context-aware reconciliation path (here: council + DEA + year + candidate matching) before presenting the export as the current best crosswalk, then regenerate and verify representative formerly blank rows.
- Verification evidence:
  - regenerated `_tmp_xls2rar_extract\out\stv-source-party-normalization.updated.csv`
  - `python -m py_compile scripts\export_stv_party_normalization.py` passes
  - spot checks confirm:
    - `A.P.` -> `Alliance Party of Northern Ireland`
    - `D.U.P.` -> `Democratic Unionist Party`
    - `Off. Un.` -> `Ulster Unionist Party`
    - `S.D.L.P.` -> `Social Democratic and Labour Party`
    - `Rep. Clubs` -> `Republican Clubs`
    - contest-reconciled rows now fill safely:
      - `AA` -> `Alliance Party of Northern Ireland`
      - `AF` -> `Alliance Party of Northern Ireland`
      - `Kilfedder Unionist` -> `Ulster Popular Unionist Party`
    - `ALL` -> `Alliance Party of Northern Ireland`
    - `BNP` -> `British National Party`
    - `C.P` -> `Communist Party of Ireland`
    - `D.U.P (United Unionist)` -> `United Ulster Unionist Party`
  - the fully regenerated file has `0` blank `wikipedia_party_name` rows across `786` rows
  - identical source/Wikipedia strings now remain only where the resolved label is itself a canonical Wikipedia-style label or a label present on the scraped Wikipedia pages; the exporter no longer falls back to raw local labels just to avoid blanks
  - overwrite of the original `_tmp_xls2rar_extract\out\stv-source-party-normalization.csv` is currently blocked because that file is locked by another process; the corrected replacement is available beside it as `_tmp_xls2rar_extract\out\stv-source-party-normalization.updated.csv`
  - follow-up precedence fix verified in `_tmp_xls2rar_extract\out\stv-source-party-normalization.fixed3.csv`:
    - `""" Indp. Party` -> `Independent (politician)`
    - `AA` -> `Alliance Party of Northern Ireland`
    - `AF` -> `Alliance Party of Northern Ireland`
  - explicit check on `fixed3` confirms `OtherCount : 0` and `BlankCount : 0`
  - additional normalization correction verified in `_tmp_xls2rar_extract\out\stv-source-party-normalization.fixed5.csv`:
    - `Anti-Agreement Northern Ireland Unionist Party` -> `Northern Ireland Unionist Party`
    - `Northern Ireland Unionist Party Anti-Agreement` -> `Northern Ireland Unionist Party`
    - `Coleraine Unionist` -> `Independent Unionist`
    - `Constitutional Independent Northern Ireland` -> `Independent (politician)`
  - explicit check on `fixed5` confirms `OtherCount : 0` and `BlankCount : 0`
  - attempted overwrite of `_tmp_xls2rar_extract\out\stv-source-party-normalization.csv` failed because the file is locked by another process; the corrected replacement is available as `_tmp_xls2rar_extract\out\stv-source-party-normalization.fixed5.csv`

# Current Task: Add Party-Normalization Columns To LGOV STV Workbook Export (2026-02-28)

- [x] Inspect the current local-election STV workbook generator and identify where ElectionResults and Transfers rows are built
- [x] Add generator support for two extra columns sourced from the STV party-normalization CSV:
  - `Deduplicated Party Name`
  - `Wikipedia Party Name`
- [x] Regenerate the LGOV workbook with the extra columns
- [x] Verify the new columns exist in both sheets and that representative rows are populated

## Review
- Symptom: the previously generated local-election workbook only carried `Source Party Name` and `Party Name`, so the standardized party crosswalk had to be consulted separately.
- Root cause: `scripts/build_stv_workbook.py` had no input path for the party-normalization export and therefore no way to stamp deduplicated/Wikipedia-derived party labels into the workbook rows.
- Permanent prevention action: the workbook generator now supports an explicit `--party-normalization-csv` input and emits the extra party-normalization columns directly into both `ElectionResults` and `Transfers`, keeping the workbook reproducible from the pipeline instead of requiring a post-export patch.
- Verification evidence:
  - `python -m py_compile scripts\build_stv_workbook.py` passes
  - generated workbook: `_tmp_xls2rar_extract\out\lgov-stv.party-normalized.xlsx`
  - `ElectionResults` header now includes `Deduplicated Party Name` at index `5` and `Wikipedia Party Name` at index `6`
  - `Transfers` header now includes `Deduplicated Party Name` at index `8` and `Wikipedia Party Name` at index `9`
  - representative populated rows were read successfully from the generated workbook, including `Wikipedia Party Name: Independent (politician)` for the `\" Indp. Party` transfer row and `Wikipedia Party Name: Social Democratic and Labour Party` for an `S.D.L.P` election-results row.
- Follow-up schema extension: added a dedicated `Council` column to both sheets so local-election outputs do not require downstream council inference from the constituency text or source filename.
- Follow-up verification evidence:
  - generated workbook: `_tmp_xls2rar_extract\out\lgov-stv.party-normalized.with-council.xlsx`
  - `ElectionResults` now includes `Council` at index `14`
  - `Transfers` now includes `Council` at index `3`
  - representative `ElectionResults` row verified with `Council: Belfast` and `Constituency: lg73 BT Area E`

# Current Task: Extract And Audit Modern NI Local-Election Wikipedia Count Tables (2026-02-28)

- [x] Extend the Wikipedia local-election scraper for the modern 11-council system covering `2014`, `2019`, and `2023`
- [x] Fetch and persist the `33` council-election raw-wikitext pages plus the `3` overview pages
- [x] Audit the raw pages to confirm the count-table template family and the DEA-level structure
- [x] Write down a parser contract for converting the raw wikitext into workbook-style `ElectionResults` / count-derived data

## Review
- Symptom: there was no extracted modern (`2014`/`2019`/`2023`) NI local-election Wikipedia corpus or parser contract proving that the raw pages expose count tables consistently enough to support a structured pipeline.
- Root cause: the existing Wikipedia scraper only targeted the older 26-council corpus and assumed title patterns rooted in the 1973-2011 structure; the first modern discovery pass also only accepted titles starting with the year, which missed one 2014 page using the older `[Council] election, 2014` title pattern.
- Permanent prevention action: the modern scraper now uses an explicit 11-council modern map, resolves pages through overview links first and then through both prefix-year and suffix-year title patterns with search fallback, and persists a count-table audit plus parser contract instead of relying on ad hoc inspection.
- Verification evidence:
  - `python -m py_compile scripts\scrape_modern_lgov_wikipedia.py` passes
  - scrape output summary: `_tmp_xls2rar_extract\out\wiki_lgov_modern\summary.json`
  - complete corpus fetched: `requested_pages = 33`, `found_pages = 33`
  - all `33` audited pages report `all_use_begin2 = yes` and `all_use_candidate2 = yes`
  - audit artifact: `_tmp_xls2rar_extract\out\wiki_lgov_modern\count_table_audit.csv`
  - parser contract written to `_tmp_xls2rar_extract\out\wiki_lgov_modern\parser_contract.md`

# Current Task: Build Modern NI Local-Election Wikipedia Workbook (2026-02-28)

- [x] Replace the modern Wikipedia scraper's naive template-parameter splitting with the shared depth-aware parser
- [x] Regenerate the 33-page modern audit using the corrected parser
- [x] Build a workbook generator that converts the corrected `2014` / `2019` / `2023` raw wikitext corpus into `ElectionResults` and count-derived `Transfers`
- [x] Verify representative Belfast rows against the regenerated audit and workbook output

## Review
- Symptom: the first modern Wikipedia audit/parser path reported full page coverage, but its DEA parsing was wrong because nested `[[...|...]]` links and nested templates inside `title=` and candidate fields were being split as if every `|` were a top-level parameter separator.
- Root cause: `scripts/scrape_modern_lgov_wikipedia.py` had its own ad hoc `parse_template_params()` that used plain `split("|")` on raw template bodies, while the shared parser work had already established that the modern STV templates require depth-aware splitting over both `{{...}}` and `[[...]]` nesting.
- Permanent prevention action: the modern scraper now delegates all STV-template parsing to `scripts/modern_lgov_wikipedia_common.py`, which extracts template blocks and parameters only at top-level depth, and the workbook generator consumes the same shared parser instead of maintaining a second parser implementation.
- Verification evidence:
  - `python -m py_compile scripts\modern_lgov_wikipedia_common.py scripts\scrape_modern_lgov_wikipedia.py scripts\build_modern_lgov_wikipedia_workbook.py` passes
  - regenerated modern audit summary remains complete at `_tmp_xls2rar_extract\out\wiki_lgov_modern\summary.json` with `requested_pages = 33` and `found_pages = 33`
  - representative regenerated audit row from `_tmp_xls2rar_extract\out\wiki_lgov_modern\audit\2023-belfast.json` now parses cleanly:
    - `Balmoral`, `5` seats, `7` counts, `electorate = 18691`, `valid = 10229`, `spoilt = 147`, `quota = 1705`, `turnout = 10376`
    - sample candidate rows include `Geraldine McAteer` and `Donal Lyons` with sane percentages/count progressions
  - generated workbook: `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.xlsx`
  - representative `ElectionResults` rows for `Belfast / Balmoral` read back correctly from the workbook:
    - `Máirtín Ó Muilleoir`, `Sinn Féin`, `Votes1 = 1525`, `Outcome = Elected`
    - `Claire Hanna`, `Social Democratic and Labour Party`, `Votes1 = 1524`, `Outcome = Elected`
    - `Paula Bradshaw`, `Alliance Party of Northern Ireland`, `Votes1 = 806`, `Votes2 = 809.66`, `Votes3 = 812.42`, `Outcome = Elected`
  - workbook shape verified:
    - `ElectionResults` rows: `3497`
    - `Transfers` rows: `11644`

# Current Task: Correct Modern Wikipedia STV Count Semantics (2026-02-28)

- [x] Determine how the modern Wikipedia STV count tables should map to workbook count/transfer semantics
- [x] Update the modern workbook generator so elected candidates shed only surplus, eliminated candidates shed their full total, and final unsuccessful candidates remain `Not Elected`
- [x] Populate self-attributed negative deduction rows in `Transfers#`, `TransferName#`, and `TransferParty#`, and fill `%ElectorateShare` from first preferences
- [x] Regenerate and verify representative 2023 Belfast/Balmoral rows

## Review
- Symptom: the first modern Wikipedia workbook generator treated every count change as a simple next-count delta, so it did not distinguish election/exclusion counts, did not deduct elected surpluses vs eliminated full totals correctly, classified almost every unelected candidate as generic `Not Elected`, and left `%ElectorateShare` blank.
- Root cause: the generator was only replaying raw count columns and the parser's explicit `†` marker, with no STV state model for terminal candidate events. It lacked a count-exit analysis step, donor-bundle derivation by stage, and the existing workbook contract where elected candidates retain quota after a negative surplus transfer and eliminated candidates fall to zero after a negative full deduction.
- Permanent prevention action: the modern exporter now performs a district-level STV analysis before writing rows: it infers each candidate's exit count, distinguishes `Elected` / `Eliminated` / `Not Elected`, derives stage donor bundles from negative exit events, emits self-attributed negative deductions for elected/eliminated candidates, carries elected candidates forward at quota and eliminated candidates forward at zero, and computes `%ElectorateShare` from `Votes1 / Electorate`.
- Verification evidence:
  - `python -m py_compile scripts\build_modern_lgov_wikipedia_workbook.py` passes
  - regenerated workbook written to `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.xlsx` (the original output path was locked by another process)
  - representative `2023-05-18 / Belfast / Balmoral` `ElectionResults` rows now read back as:
    - `Geraldine McAteer`: `Votes1 = 2037`, `Transfers1 = -332`, `TransferName1 = Geraldine McAteer`, `TransferParty1 = Sinn Féin`, `Votes2 = 1705`, `Outcome = Elected`, `%ElectorateShare = 10.898293296239`
    - `Donal Lyons`: `Votes3 = 1894.28`, `Transfers3 = -189.28`, `Votes4 = 1705`, `Outcome = Elected`
    - `Micky Murray`: `Votes7 = 1788.12`, `Transfers7 = -83.12`, `Outcome = Elected`
    - `Sarah Mulgrew`: `Transfers2 = -332.12`, `Votes3 = 0`, `Outcome = Eliminated`
    - `Gareth Spratt`: `Transfers7 = 0`, `Outcome = Not Elected`
  - representative `Transfers` rows for the same DEA now show:
    - `Geraldine McAteer` at `Count 1`: `Transfers = -332`, `ElectedThisRound = True`
    - `Donal Lyons` at `Count 3`: `Transfers = -189.28`, `ElectedThisRound = True`
    - `Sarah Mulgrew` at `Count 2`: `Transfers = -332.12`, `EliminatedThisRound = True`

# Current Task: Propagate Corrected Party Names Through Modern Wikipedia Workbook (2026-02-28)

- [x] Inspect the workbook schema and identify all party-bearing ElectionResults columns that should inherit the corrected column-G `Party Name` values
- [x] Propagate corrected canonical party names into `Source Party Name` and all `TransferParty#` columns
- [x] Verify representative rows and record the propagation rule

## Review
- Symptom: column `G` (`Party Name`) in `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.xlsx` had been manually corrected, but the rest of the sheet still carried stale pre-normalization values in `Source Party Name` and the `TransferParty#` donor-party columns.
- Root cause: the workbook generator writes party names into multiple dependent fields, and once the user edited only the canonical `Party Name` column there was no follow-up propagation step to keep the row-level source field and donor-party references in sync with those corrected values.
- Permanent prevention action: propagate from the canonical `Party Name` field only, keyed by `Date + Constituency + Name usually known by`; update the row’s `Source Party Name` to match `Party Name`, then resolve every `TransferName#` back through the same keyed candidate map to rewrite `TransferParty#` consistently.
- Verification evidence:
  - in-place propagation updated `1918` candidate-row `Source Party Name` cells and `12486` `TransferParty#` cells
  - representative readback from `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.xlsx` now shows:
    - `Donal Lyons`: `Source Party Name = SDLP`, `Party Name = SDLP`, `TransferParty2 = SDLP`, `TransferParty3 = SDLP`
    - `Micky Murray`: `Source Party Name = Alliance`, `Party Name = Alliance`, `TransferParty2 = SDLP`, `TransferParty3 = SDLP, Green / Ecology`
  - a workbook scan after propagation found no sampled candidate rows where `Source Party Name != Party Name`

# Current Task: Build Person-ID Matching Workbook Between Full Election Tables And Modern Local Workbook (2026-02-28)

- [x] Inspect the person-name schemas in `Full election tables.xlsx` and `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.xlsx`
- [x] Generate a three-sheet workbook containing full-workbook people, modern local-workbook people, and attempted matches
- [x] Verify representative matches and record the matching method

## Review
- Symptom: there was no consolidated artifact comparing the existing `Full election tables.xlsx` person IDs and genders against the person IDs generated in the modern `2014` / `2019` / `2023` local-election workbook.
- Root cause: the two datasets live in different workbooks and use different person-ID spaces, so without a dedicated comparison export there was no practical way to inspect exact-name overlaps, fuzzy near-matches, or modern-only names in one place.
- Permanent prevention action: added `scripts\build_person_match_workbook.py`, which reads the `Names` sheet from `Full election tables.xlsx`, reads candidate people from `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.xlsx`, and writes a three-sheet comparison workbook with a dedicated attempted-match sheet using exact normalized-name matching first and conservative same-surname fuzzy matching second.
- Verification evidence:
  - `python -m py_compile scripts\build_person_match_workbook.py` passes
  - generated workbook: `_tmp_xls2rar_extract\out\wiki_lgov_modern\person-id-match.xlsx`
  - sheet row counts:
    - `FullWorkbookPeople`: `2377`
    - `ModernLocalPeople`: `1740`
    - `AttemptedMatches`: `3663`
  - match-method counts:
    - `exact_normalized_name`: `426`
    - `fuzzy_same_last_name`: `30`
    - `unmatched`: `1921`
    - `modern_only`: `1286`
  - representative exact matches include:
    - `Ian Shanks`
    - `Phillip Brett`
    - `Paul Berry`
    - `Timothy Gaston`
- Follow-up schema extension: derive and include the actual standing years for each person from `Full election tables.xlsx` `ElectionResults`, not just the modern local-election years.
- Follow-up verification evidence:
  - regenerated workbook remains `_tmp_xls2rar_extract\out\wiki_lgov_modern\person-id-match.xlsx`
  - `FullWorkbookPeople` now includes `years_stood`
  - `AttemptedMatches` now includes `full_years_stood`
  - representative readback confirms:
    - `Ian Shanks` -> `full_years_stood = 2016`
    - `Phillip Brett` -> `full_years_stood = 2022, 2024`
    - `Naomi Long` -> `full_years_stood = 2003, 2005, 2007, 2010, 2015, 2016, 2017, 2019, 2022, 2024`
- Follow-up correction: widened the standing-years derivation to include `ListCandidate#` row types as well as `Candidate`, so list-PR appearances such as the 1996 Forum election are no longer missed.
- Follow-up verification evidence:
  - regenerated workbook remains `_tmp_xls2rar_extract\out\wiki_lgov_modern\person-id-match.xlsx`
  - `Mervyn Jones` now reads back as:
    - `FullWorkbookPeople.years_stood = 1996`
    - `AttemptedMatches.full_years_stood = 1996`
- Follow-up correction: widened the standing-years derivation further to include `RegionalListCandidate#` rows as valid candidacies.
- Follow-up verification evidence:
  - `Full election tables.xlsx` contains real `RegionalListCandidate#` rows, for example:
    - `John Alderdice`
    - `Seamus Close`
    - `Wendy Watt`
  - regenerated workbook remains `_tmp_xls2rar_extract\out\wiki_lgov_modern\person-id-match.xlsx`
  - representative readback confirms:
    - `John Alderdice` -> `years_stood = 1987, 1989, 1992, 1996, 1998`
    - `Seamus Close` -> `years_stood = 1981, 1982, 1983, 1987, 1992, 1996, 1997, 1998, 2001, 2003, 2005`
    - `Wendy Watt` -> `years_stood = 1996`
- Follow-up schema extension: added the names of constituencies stood in from `Full election tables.xlsx` to the match workbook.
- Follow-up verification evidence:
  - regenerated workbook remains `_tmp_xls2rar_extract\out\wiki_lgov_modern\person-id-match.xlsx`
  - `FullWorkbookPeople` now includes `constituencies_stood`
  - `AttemptedMatches` now includes `full_constituencies_stood`
  - representative readback confirms:
    - `Mervyn Jones` -> `constituencies_stood = Belfast East`
    - `John Alderdice` -> `constituencies_stood = Belfast East, Northern Ireland`
    - `Naomi Long` -> `constituencies_stood = Belfast East, Northern Ireland`
- Follow-up schema extension: added the parties each candidate has stood for on both the full-workbook and modern-local sides of the match workbook.
- Follow-up verification evidence:
  - regenerated workbook remains `_tmp_xls2rar_extract\out\wiki_lgov_modern\person-id-match.xlsx`
  - `FullWorkbookPeople` now includes `parties_stood_in`
  - `ModernLocalPeople` now includes `parties`
  - `AttemptedMatches` now includes:
    - `full_parties_stood_in`
    - `modern_parties_stood_in`
  - representative readback confirms:
    - `Mervyn Jones` -> `full parties_stood_in = Alliance`
    - `John Alderdice` -> `full parties_stood_in = Alliance`
    - `Phillip Brett` -> `modern parties = DUP`
    - `Timothy Gaston` -> `modern parties = TUV`
- Follow-up ID reconciliation: used `AttemptedMatches.approved = Y` to remap the modern local-election workbook's person IDs to the established `Full election tables.xlsx` `PersonID` values.
- Follow-up verification evidence:
  - added `scripts\apply_approved_person_id_remap.py`
  - `python -m py_compile scripts\apply_approved_person_id_remap.py` passes
  - applying the remap to `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.xlsx` reported:
    - `approved_mapping_count = 418`
    - `electionresults_personid_updates = 678`
    - `transfers_personid_updates = 5190`
    - `transfers_sourcepersonid_updates = 519`
  - representative readback confirms `PersonID` remaps in both `ElectionResults` and `Transfers` for:
    - `Ian Shanks` -> `99816`
    - `Phillip Brett` -> `99812`
    - `Mervyn Jones` -> `98058`
    - `Timothy Gaston` -> `97742`
- Follow-up correction: widened the approved-ID remap to cover all `ElectionResults.TransferSubject#` columns as person-ID-bearing fields as well, not just the explicit `PersonID` columns.
- Follow-up verification evidence:
  - added output-path support to `scripts\apply_approved_person_id_remap.py` so remaps can still be generated when the target workbook is locked
  - regenerated replacement workbook: `_tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.remapped.xlsx`
  - remap stats on the replacement workbook:
    - `electionresults_transfersubject_updates = 3119`
  - representative readback confirms:
    - `Timothy Gaston` -> `TransferSubject1 = 97742`
    - `Phillip Brett` -> `TransferSubject1 = 99812`
# Current Task: Split Hard-Collision PersonIDs Across Workbook And Website Election Data (2026-03-01)

- [x] Verify the seven user-flagged duplicate `PersonID` collisions and identify which person keeps the legacy ID versus receives a new ID
- [x] Harden the collision-fix script to use safe temp-workbook writes plus validation before replacement
- [x] Apply the seven split IDs across `Full election tables.xlsx` and all affected website election JSON files
- [x] Verify that the local-election workbook does not contain these seven legacy IDs and therefore needs no direct data changes
- [x] Record verification evidence and prevention guardrails

## Review
- Symptom: seven `PersonID` values in `Full election tables.xlsx` were shared by two genuinely different people, which polluted person histories and could leak incorrect IDs into website election data and downstream matching workbooks.
- Root cause: the source workbook already contained hard identity collisions; some later split IDs had been partially introduced, but the propagation was incomplete and the original fixer was unsafe because it rewrote JSON by regex and validated temp workbooks with an unsupported `.tmp` extension.
- Permanent prevention action:
  - `scripts/fix_hard_collision_person_ids.py` now uses a validated temp `.tmp.xlsx` workbook and only replaces the original after successful reopen,
  - workbook context discovery is based on the split person's current election contexts by name, so the fixer remains rerunnable even after a partial split has already happened,
  - website election JSON patching is structural and candidate-name-aware, not blind token replacement.
- Verification evidence:
  - `python -m py_compile scripts/fix_hard_collision_person_ids.py` passes,
  - `Full election tables.xlsx` now shows no old-ID hits for the seven split people in `ElectionResults`, `Transfers`, `AdjustedTransfers`, or `Names`,
  - representative rows confirm new IDs in `TransferSubject#` fields, e.g. `Donal O'Cofaigh -> 100001`, `John Lindsay -> 100004`, `Amy Doherty -> 100005`,
  - the 9 affected website election JSON files now show `no-old/new` for the split candidates,
  - `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx` contains none of the seven legacy collision IDs, so no local-workbook data rewrite was required,
  - fresh post-fix audit artifacts at `_tmp_xls2rar_extract/out/personid-audit/duplicate-personid-audit.csv` and `_tmp_xls2rar_extract/out/personid-audit/duplicate-personid-audit.xlsx` show only `9467` and `70028` remaining, both classified as benign alias cases, with `0` unexpected duplicates remaining.

# Current Task: Regenerate Unresolved Same-Person ID Cases From Live State (2026-03-01)

- [x] Rebuild the person-match workbook from the current corrected `Full election tables.xlsx` and `_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx`
- [x] Audit exact-name overlaps directly from the live workbooks rather than from stale review artifacts
- [x] Filter the overlap set down to the genuinely unresolved mixed-ID cases for user review
- [x] Report the fresh unresolved-cases table inline

## Review
- Symptom: earlier unresolved-case tables had drifted from the live workbook state and could still show already-fixed or already-canonical candidates as if they needed review.
- Root cause: the review logic was relying on older auxiliary match output rather than rebuilding from the current corrected workbooks, so mixed-ID carryovers and already-split historical aliases were not being cleanly separated.
- Permanent prevention action: when asked for unresolved identity cases, always rebuild the match workbook from the live corrected source workbooks first and derive the review table directly from exact-name overlaps in those live artifacts before applying any manual assessment filter.
- Verification evidence:
  - `python scripts/build_person_match_workbook.py --full-workbook "Full election tables.xlsx" --modern-workbook "_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.stvfix.xlsx" --output "_tmp_xls2rar_extract/out/wiki_lgov_modern/person-id-match.xlsx"` completed successfully,
  - a direct live-state audit over the rebuilt workbooks found `63` raw exact-name overlap mismatches,
  - the fresh user-facing table was then reduced to the still-plausible mixed-ID review set only.
# Current Task: Finish Local-Government Election Website Integration (2026-03-01)

- [x] Verify the live local-government election data/index baseline before changing website code
- [x] Finish the remaining Boundaries Website integration work for the `2014`, `2018-10-18`, `2019`, and `2023` local elections
- [x] Validate grouped local-election event behavior, local-government appearance metadata, and grouped constituency restore behavior
- [ ] Run the local website server for manual testing

- Symptom: the local-government election data had already been generated and partially wired, but the website still treated it like an incomplete election family: the grouped local-election entries rendered with the wrong appearance, the Elections tab could not filter local government, entity/timeline logic still expanded the 11 councils into separate election families, and URL restore for a selected DEA only searched the first council body.
- Root cause: the data/index layer was ahead of the UI/state layer. `js/election-controller.js` already knew how to merge grouped local-government loads, but `js/ui-controller.js`, `js/app.js`, and the election timeline/entity helpers still assumed legacy single-body election families.
- Permanent prevention action: whenever a new election family is introduced through grouped index bodies, integrate it at all four layers together in the same pass: (1) geometry/load config, (2) catalogue appearance and filters, (3) timeline/entity aggregation, and (4) URL restore across grouped constituencies.
- Verification evidence:
  - `node --check js/app.js` passes
  - `node --check js/ui-controller.js` passes
  - `node --check js/election-controller.js` passes
  - grouped local-election audit now resolves to:
    - `2014-05-22 -> 80 constituencies across 11 source bodies`
    - `2018-10-18 -> 1 constituency across 1 source body`
    - `2019-05-02 -> 80 constituencies across 11 source bodies`
    - `2023-05-18 -> 80 constituencies across 11 source bodies`
# Current Task: Local Election Results Pane, Delta, Transfer, And Council-View Fixes (2026-03-01)

- [x] Re-rank NI-wide `By Candidate` and `By Local Party` by `1st prefs %` rather than raw `1st prefs`
- [x] Make local-election `+/-` columns compare against the previous local election rather than fragmenting by individual council body
- [x] Fix results-pane candidate/party entity links and ensure candidate/party info pages resolve for all rows
- [x] Exclude `Non-transferable` rows from NI-wide `By Candidate` and `By Local Party`
- [x] Add a DEA/council toggle for local-election results, including council seat circles and council-level `By Party` / `By Candidate` / `By Local Party` views
- [x] Fix DEA-level transfer tables so elected candidates retain full count progressions rather than truncating after count 1
- [x] Fix the missing `Mid Ulster` 2019 local-election data
- [x] Fix transfer-animation status timing so `Not Elected` candidates are not marked or reordered before the final count
- [x] Run syntax/runtime verification and then start the local server for manual testing

- Symptom: the new local-election integration still has multiple correctness gaps in the results pane and transfer views: NI-wide candidate-style rankings use raw first preferences instead of first-preference percentage, local-election `+/-` values are not consistently compared to the previous local election family, entity links/info pages are unreliable, `Non-transferable` leaks into candidate-style views, council-level aggregation mode is missing, elected candidates' DEA transfer tables truncate, `Mid Ulster` is missing from 2019, and the transfer animation marks `Not Elected` too early.
- Root cause: local-government integration reached the grouped-election loading stage, but the results/rendering layer still assumes constituency-family semantics from Assembly/Westminster in several places: NI-wide row ranking sorts on raw vote totals, comparison buckets and previous-election lookups are still partly body-scoped, candidate/local-party row builders do not consistently filter non-candidate pseudo-rows, the transfer table suppresses elected rows after election counts, and local-government views do not yet have a council-level aggregation/rendering path.
- Permanent prevention action: centralize local-election comparison semantics at the derived-data layer, make candidate-style row builders consume one shared filtering/ranking contract, and treat grouped local-government elections as a first-class dual-granularity (`DEA`/`Council`) results mode rather than layering ad hoc council behavior onto DEA-only rendering.
- Verification evidence:
  - `node --check js/election-controller.js` passes
  - `node --check js/app.js` passes
  - `node --check js/ui-controller.js` passes
  - `node --check election-viewer-package/js/stages2.js` passes
  - local server is running at `http://127.0.0.1:5050` (existing listener on PID `37752`)
  - local-election controller changes now include:
    - normalized constituency matching for grouped local elections
    - normalized previous-election lookup for local `+/-`
    - `Non-transferable` filtering in NI-wide candidate/local-party builders
    - NI-wide candidate/local-party sorting by `1st prefs %`
    - DEA/council geometry switching using `DEAs_2012.fgb` and `LGD_2012.fgb`
    - council-level seat-circle aggregation and council click panels
    - elected-candidate count-table rows no longer blanked after election
    - transfer-animation `Not Elected` status deferred until the final round



# Current Task: Restore Non-Local Election Colouring And Retune Council Hemicycle Spacing (2026-03-02)

- [x] Root-cause the loss of colouring and seat-circle overlays on non-local elections
- [x] Fix constituency matching at the normalization layer so map feature names and results names resolve across case/style differences
- [x] Retune the council hemicycle to keep a flat-bottom chamber shape while restoring a visible gap between circles
- [x] Verify syntax and record the permanent prevention action

- Symptom: after the local-election council overlay work, non-local elections stopped colouring constituencies and showing seat circles, and the council hemicycles became so compact that the dots touched.
- Root cause: constituency-name normalization had become too literal for mixed-case geometry/result names, so map features like `SOUTH DOWN` no longer matched result names like `South Down`; separately, the last council-seat density pass reduced the effective seat spacing too far.
- Permanent prevention action: keep constituency matching case-insensitive and punctuation-normalized in one shared helper, and treat chamber density as an independent layout parameter from chamber shape so spacing can be tuned without reopening the matching/render pipeline.
- Verification evidence: `js/election-controller.js` now lower-cases and normalizes constituency/council keys before lookup, the large-seat council layout uses flat horizontal rows with a visible seat gap, and `node --check js/election-controller.js` passes.
# Current Task: Study `slashme/parliamentdiagram` Generator Architecture (2026-03-02)

- [ ] Read the repository’s primary documentation and generator source files
- [ ] Identify how inputs are specified, how seat positions are computed, and how output is rendered/exported
- [ ] Explain the generator in detail with direct source-backed references
# Current Task: Repair Election Layer Lifecycle After Controller Restore Regression (2026-03-03)

- [x] Root-cause the broken election-layer lifecycle affecting both local and non-local elections
- [x] Restore the missing alias, grouped-scope, and council-aggregate helpers in `js/election-controller.js`
- [x] Restore working split-pane actions for DEA/Council toggle and close (`X`) handling
- [x] Restore clickable constituency/DEA polygons and council-mode council panels
- [x] Run syntax verification and restart the local server for manual testing

- Symptom: election polygons had no fill or outlines, constituencies/DEAs were not clickable, the local-election `Council` button did nothing, and the results-pane `X` button stopped clearing the election layer for both local and non-local elections.
- Root cause: `js/election-controller.js` had previously been restored from an older file revision that no longer matched the current app contract. The file still had some newer state fields, but it was missing the newer helper methods and delegated pane actions that the rest of the app now relies on (`bodyGroup` scope rebuilding, alias maps, council aggregates, DEA/Council mode switching, and close-button action handling). That desynchronized the controller from `js/app.js`, `js/ui-controller.js`, and the grouped local-government index/data model.
- Permanent prevention action: whenever a large shared controller file is restored or replaced, treat it as an integration event rather than a file recovery event. Re-audit it against the current app contract immediately: (1) constructor state fields, (2) helper methods invoked by public entry points like `loadElection()`, (3) delegated pane actions, and (4) grouped-election/local-government support paths.
- Verification evidence:
  - `node --check js/election-controller.js` passes
  - `node --check js/app.js` passes
  - `node --check js/ui-controller.js` passes
  - `js/election-controller.js` now again contains:
    - `_rebuildElectionLookups(...)`
    - `_rebuildCouncilAggregates(...)`
    - `_setLocalResultsMode(...)`
    - `_showCouncilPanel(...)`
  - delegated split-pane actions now handle:
    - `data-action="set-results-mode"`
    - `data-action="close-election"`
# Local Elections Grouping / Seats / By Count Fixes
- Status: completed
- Task:
  - group local elections into exactly four catalogue entries
  - fix council-mode seat overlays to use true hemicycle geometry instead of row silhouettes
  - fix council-name matching for `Armagh City, Banbridge and Craigavon`
  - derive local DEA seat counts from constituency names when `Number_Of_Seats` is wrong
  - fix local `By Count` candidate lifecycle rendering and reinsert `Non-transferable` above `Valid votes`
- Completed work:
  - grouped `bodyGroup=local-government` entries by date in `js/election-controller.js::buildCatalogueCards()`
  - added a `City` alias variant so `Armagh, Banbridge and Craigavon` matches the LGD map feature name
  - added `_getSeatCount()` / `_inferSeatCountFromName()` and used them in council aggregation, elected-seat extraction, and count tables
  - replaced the large-seat council layout in `_seatPositions()` with a parliamentarch-style arc layout
  - fixed overlay positioning to normalize from actual minimum `x/y` bounds rather than the first seat
  - added lifecycle inference so elected/excluded rows show one terminal redistribution cell and blank cells afterward
  - restored `Non-transferable` as a dedicated row between candidates and `Valid votes`
- Recurring issue log:
  - Symptom: local-election UI work was repeatedly “fixed” without changing the actual live controller branches
  - Root cause: patching against stale assumptions instead of reading the exact live functions before editing
  - Permanent prevention action: always inspect the live implementations of the exact target functions before patching, then patch those blocks surgically
- Verification evidence: `node --check js/election-controller.js`, `node --check js/app.js`, `node --check js/ui-controller.js`

# Local Election Party Affiliation Correction (2026-03-04)
- Status: completed
- Task:
  - fix incorrect party labels surfacing for some local-election candidates (example: `Brian Higginson`, `Castlereagh South`, `2023`)
- Completed work:
  - patched `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` so PersonID canonical overrides apply to candidate naming only, not party fields
  - kept `Party Name`, `Deduplicated Party Name`, and `Wikipedia Party Name` sourced from each local-election row
  - rebuilt local-government election JSON outputs
- Recurring issue log:
  - Symptom: candidates were shown under historical/incorrect parties in local-election results
  - Root cause: party values were globally overridden from canonical PersonID history, which can conflict when a candidate has changed party over time
  - Permanent prevention action: never use cross-election PersonID canonicalization to override row-level party labels; use it only for candidate naming normalization
  - Verification evidence:
    - build script completed and regenerated `241` local-government JSON files
    - `election-viewer-package/data/elections/local-government/2023-05-18/castlereagh-south.json` now shows `Brian Higginson` with `Party_Name = Democratic Unionist Party`

# Local Election Party Label / Candidate Display Normalization (2026-03-04)
- Status: completed
- Task:
  - ensure local-election result tables show expected short party labels (`DUP`, `Alliance`, etc.) and stable candidate display names
- Completed work:
  - added row-level party-label normalization in `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` (for `Party_Name`, `Deduplicated Party Name`, `Wikipedia Party Name`)
  - switched candidate name derivation to prefer row-level display fields (`Name usually known by`, then `Source Name`) before fallback parsing
  - rebuilt local-government election JSON outputs
- Recurring issue log:
  - Symptom: party labels still surfaced as long Wikipedia-style names after affiliation fix
  - Root cause: row-level party affiliation was correct, but output label normalization to project short-form conventions was missing in the local JSON builder
  - Permanent prevention action: local-election JSON generation must include a dedicated row-level party label canonicalizer, independent of PersonID identity logic
  - Verification evidence:
    - `castlereagh-south.json` now shows `Brian Higginson` as `DUP`
    - full local JSON scan reports `bad_count 0` for long-form labels (`Alliance Party of Northern Ireland`, `Democratic Unionist Party`, etc.)

# Preserve Surplus Fix While Restoring Pre-Fix Labels By Identity Key (2026-03-04)
- Status: completed
- Task:
  - preserve post-fix STV redistribution integrity while restoring pre-fix local candidate/party label quality
- Completed work:
  - added `load_prefx_label_overrides()` in `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py`
  - keyed overrides by `(date, constituency, canonical PersonID)` to avoid cross-row leakage
  - applied pre-fix fields (`Source/Display/First/Last Name`, party-label variants) only as label overrides; retained normalized workbook as vote/count source-of-truth
  - rebuilt local-government JSON outputs from normalized workbook with identity-keyed label reconciliation
- Recurring issue log:
  - Symptom: fixing STV count redistribution correctness caused regressions in displayed party/candidate labels
  - Root cause: both concerns shared one builder path, but there was no explicit dual-source reconciliation contract
  - Permanent prevention action: enforce split contracts in builder:
    - count/vote lifecycle from normalized post-fix workbook
    - display labels from pre-fix workbook only via strict identity key (`date+constituency+PersonID`)
  - Verification evidence:
    - `Brian Higginson` in `2023-05-18/castlereagh-south.json` resolves to `DUP`
    - long-form label scan result: `bad_count 0`
    - surplus-guard check: `multi_elected_surplus_same_count 0`

# By-Count Elected Tie-Break Ordering (2026-03-04)
- Status: completed
- Task:
  - when multiple candidates are elected on the same count, rank them by vote total at the count immediately before their redistribution; if no redistribution occurred, use final-count votes
- Completed work:
  - updated `_buildCountTable()` sorting in `js/election-controller.js`
  - added elected tie-break metric:
    - first negative-transfer count => use prior count total
    - no redistribution count => use final count total
  - retained stable fallback ordering by first prefs, then name
- Recurring issue log:
  - Symptom: same-count elected candidates appeared in arbitrary payload order
  - Root cause: comparator only used `electedAt` and lacked a same-count tie-break rule
  - Permanent prevention action: include an explicit deterministic same-count elected tie-break derived from redistribution lifecycle
  - Verification evidence:
    - `node --check js/election-controller.js` passes

# By-Count ±% Transfer-Normalization Contract (2026-03-04)
- Status: completed
- Task:
  - make each count’s transfer percentages obey conservation:
    - deducted candidate(s) `±%` sum to `-100%`
    - receiving candidate(s) + non-transferable `±%` sum to `+100%`
- Completed work:
  - updated `_buildCountTable()` in `js/election-controller.js` to precompute per-count transfer pools:
    - `negAbs`: sum of absolute negative transfers
    - `pos`: sum of positive transfers including non-transferable
  - changed detailed `±%` rendering:
    - negative transfer rows use `transfer / negAbs * 100`
    - positive transfer rows use `transfer / pos * 100`
    - zero transfer shows `0.00%`; undefined denominators show em dash
  - applied the same normalization to the non-transferable row’s `±%`
- Recurring issue log:
  - Symptom: detailed count `±%` values did not behave like redistribution shares and could not be reconciled to transfer-conservation totals
  - Root cause: `±%` was computed as transfer-over-candidate-previous-total, which is a candidate-relative metric, not a count-level redistribution-share metric
  - Permanent prevention action: for By Count detailed view, define `±%` as share of the count transfer pool (negative pool and positive pool), not share of prior candidate total
  - Verification evidence:
    - `node --check js/election-controller.js` passes
# Metadata + Results Pane/UI Cleanup Pass (2026-03-05)
- Status: completed
- Task:
  - execute the agreed low-risk-first cleanup set across catalogue metadata and local-election results-pane/header behavior
- Completed work:
  - updated `data/database/maps.json`:
    - `roi-settlements-ungeneralised` provider -> `Tailte Éireann`
    - `provinces` label field -> `Province`
    - `stormont-1929` label field -> `NAME`
    - `eu-referendum-2016` explicit label field -> `PC_NAME`
    - `av-referendum-2011` and `av-turnout-2011` providers now include `OSNI`
    - `belfast-agreement-1998` style color darkened from `#FFD700` to `#C9A227`
    - `eds-1911` renamed to `District Electoral Divisions 1911`
    - `dail-1990`, `dail-1995`, `dail-1998`, `dail-2005` provider -> `Phelim Birch`
    - all `mep-*` maps provider -> `OSI`, `OSNI`
    - `ni-counties` scope widened to `Northern Ireland / Ireland` and map list now includes `counties-ireland`
  - updated `js/ui-controller.js`:
    - flat card extent fixes:
      - `flat-baronies` extent -> `Northern Ireland`
      - `flat-historic-sites` extent -> `Ireland`
      - `flat-counties-1915` now includes both NI and all-Ireland county map entries
    - electoral history table UX:
      - DEA list values collapsed by default behind a show/hide toggle
      - leading-party cell now includes a coloured tab
      - removed `Bodies` row from candidate summary metadata
  - updated `js/election-controller.js`:
    - added `_niWideTitle()` and switched NI-wide title updates to use it
    - NI-wide local-election pane title now renders `Local Government Districts - [date]`
    - local `By Candidate` and `By Local Party` headers now render:
      - `Local Government` / `District`
      - `District Electoral` / `Area`
  - updated `assets/css/main.css`:
    - enforced non-word-splitting two-line header rendering with top/bottom line spans
    - added styles for leading-party colour tab and DEA list show/hide block
- Recurring issue log:
  - Symptom: metadata and UI requests were repeatedly handled piecemeal, causing regressions or partial delivery
  - Root cause: broad request bundles were not batched into a single low-risk-first pass with explicit verification checkpoints
  - Permanent prevention action: execute mixed metadata/UI batches in ordered phases:
    1. static metadata
    2. deterministic string/render helpers
    3. table/render behavior
    4. syntax/parse validation before handoff
  - Verification evidence:
    - `node --check js/election-controller.js` passes
    - `node --check js/ui-controller.js` passes
    - `node --check js/app.js` passes
    - `node -e "JSON.parse(fs.readFileSync('data/database/maps.json','utf8'))"` passes
# Current Task: Fix Province/1998 Referendum Labels, Rename District Electoral Divisions Card, And Apply Compact Headline Bar (2026-03-05)

- [x] Root-cause check on active map metadata entries used by UI for province and 1998 referendum labels
- [x] Patch map metadata so province labels use the actual source field and 1998 referendum labels use the actual source field
- [x] Rename remaining visible Electoral Divisions card strings to District Electoral Divisions
- [x] Replace large top info-page card styling with a compact headline bar style
- [x] Run syntax/config validation checks

- Symptom: Province and 1998 referendum labels still failed to render, one Electoral Divisions card string remained unchanged, and detail pages still showed the large bulky header card.
- Root cause:
  1) active map metadata still pointed to non-existent label keys (`NAME`) rather than real fields in the source FGBs,
  2) one flat-card title string and legacy category/c1 labels still used `Electoral Divisions`,
  3) the detail header card retained legacy large-card CSS.
- Permanent prevention action:
  1) verify label keys against source schema (`ogrinfo -al -so`) before setting `labelProperty`,
  2) keep card display labels centralized and updated together (flat-card, c1/category labels),
  3) use one compact shared detail-header style so map/feature/entity pages do not drift.
# Current Task: Rank Results-Pane By Candidate Tables By 1st Prefs % (2026-03-05)

- [x] Locate all results-pane `By Candidate` ranking sort paths
- [x] Change NI-wide `By Candidate` rank sort to descending `1st prefs %` (with votes/name as tie-breakers)
- [x] Align council aggregate candidate ordering to descending `1st prefs %`
- [x] Run syntax validation

- Symptom: `By Candidate` ranks were sorted by raw `1st prefs` rather than `1st prefs %`.
- Root cause: the table row sort used `votes` directly, and council aggregate candidate ordering used `firstPrefs` directly.
- Permanent prevention action: keep candidate ranking sort keyed to the same metric shown in the rank-defining percentage column, with deterministic tie-breakers.
# Current Task: Collapse Party History Local Elections To One Row Per Election Date (2026-03-05)

- [x] Locate party history row builder and identify local per-council row expansion
- [x] Collapse non-by-election local rows into one grouped row per local election date
- [x] Preserve by-election rows unchanged
- [x] Keep deltas/ranks working for grouped local rows
- [x] Run syntax validation

- Symptom: party info pages showed one local-election history row per council for the same election date.
- Root cause: `entry.historyRows` was generated directly from body/date election rows, and local general elections exist as one row per council body.
- Permanent prevention action: aggregate local general-election rows by date (`local-government` bucket) before rendering party history; keep by-election rows out of this collapse path.
# Current Task: Document Maximum-Capability Pivot Table Plan (2026-03-05)

- [x] Write the full pivot-table implementation plan to a dedicated markdown file
- [x] Keep the plan structured by architecture, phases, atomic backlog, and guardrails

- Output file: `tasks/pivot-table-max-plan.md`
# Current Task: Add ROI District Electoral Divisions Card And Restore Sticky Blue Card Headers (2026-03-05)

- [x] Add a new flat catalogue card named `District Electoral Divisions` for Republic of Ireland maps (`1986`, `1994`, `1997`, `2019`)
- [x] Place the new card directly below `County Electoral Divisions (Northern Ireland)` and above `District Electoral Divisions (Ireland) (1911)`
- [x] Re-enable vertically sticky blue C1 card headers in flat catalogue mode, with per-card sticky behavior while scrolling
- [x] Keep section-level sticky stacking disabled in flat mode so only the card header is sticky
- [x] Run JS syntax validation

- Symptom: requested ROI DED card grouping/order was missing, and flat mode had explicit CSS resets forcing blue card headers to non-sticky behavior.
- Root cause: static `c1Cards` list did not include a dedicated ROI DED card in the requested position; duplicated flat-mode CSS blocks disabled sticky positioning for `.c1-card__header`.
- Permanent prevention action: treat flat-card ordering as explicit product logic in `renderFlatView()` and keep one clear flat-mode sticky policy where C1 headers stay sticky but section/header stack hacks remain disabled.
# Current Task: Fix ROI DED Map Load Failures And Sticky Header Gap (2026-03-05)

- [x] Diagnose why `eds-1986`, `eds-1994`, `eds-1997`, `eds-2019` failed to load from the new ROI DED card
- [x] Extract `Electoral Divisions 1986-2019` FGB shard files into `data/maps/electoral-divisions/`
- [x] Replace archive.org ED shard URLs in `maps.json` with local file paths
- [x] Repair `maps.json` encoding to UTF-8 without BOM after automated write
- [x] Remove the sticky-header visual gap by reducing flat-mode C1 header sticky offset
- [x] Validate JSON and JS syntax

- Symptom: all four ROI DED maps failed to load, and sticky blue card headers left a transparent gap below top search controls.
- Root cause:
  1) map variants referenced remote archive URLs (load path instability/CORS/network dependency), while the card used these map groups directly;
  2) sticky header `top` offset was set too low (`108px`), leaving an exposed gap.
- Permanent prevention action:
  1) keep critical catalogue datasets local in-repo where possible and avoid hard dependency on remote FGB URLs for core maps,
  2) tune sticky offsets against actual pane chrome height and keep one canonical value across duplicate CSS override blocks.

# Current Task: Remove Remaining Sticky Header Gap Under Catalogue Controls (2026-03-05)

- [x] Identify duplicate flat-mode sticky header overrides still using `top: 84px`
- [x] Reduce flat-mode sticky header `top` to `54px` in both override blocks to align directly under the search/controls row
- [ ] Re-verify visually in browser after server restart

- Symptom: a transparent strip remained between sticky blue card headers and the search/button controls.
- Root cause: two flat-mode override rules for `#catalogueFlatView .c1-card__header` still pinned to `top: 84px`, which exceeded the actual controls row height.
- Permanent prevention action: keep flat-mode sticky top offset defined consistently (`54px`) in every duplicate/override block.

# Current Task: Fix Party Electoral-History Mislabeling Of Non-Local Elections (2026-03-05)

- [x] Trace party electoral-history row construction in `js/election-controller.js`
- [x] Update collapsed local general-election label to requested format: `[date] local elections`
- [x] Add canonical relabel guard so non-local rows always use canonical election metadata (`body`, `bodyLabel`, `displayName`)
- [ ] Re-verify in UI for a party spanning local + Assembly/Westminster rows

- Symptom: party electoral-history table showed many rows labeled `Local Government Districts` even where rows represented non-local elections.
- Root cause: local-row collapse introduced custom labels and there was no post-collapse canonicalization guard to force non-local rows back to canonical metadata.
- Permanent prevention action: after any row-collapsing transform, canonicalize non-local row labels from the election metadata index before rendering.

# Current Task: Rework Party Election-History Naming/Type/Date Contract (2026-03-05)

- [x] Fix local-body classifier so non-local rows are never misclassified as local due to active controller state
- [x] Change non-by-election history naming to `[Westminster/Assembly/European/Forum/Convention/local] [year|Mon YYYY when needed]`
- [x] Add party history columns: `Date` (`dd mmm yyyy`) and `Type` (`Local/Devolved/Westminster/European`)
- [x] Rename `% valid first prefs` headers to `% 1st prefs` and `% 1st prefs ±`
- [x] Ensure delta-comparison bucket uses election type
- [x] Restyle history table density/borders to closer match results-pane style
- [x] Run syntax checks

- Symptom: party election-history entries were mislabeled as local; naming and column contract did not match requested format.
- Root cause: `_isLocalGovernmentBody()` defaulted to current controller `bodyGroup`, leaking local classification into unrelated rows; history display schema had not been reworked to type/date naming contract.
- Permanent prevention action:
  1) classification helpers used during index aggregation must be pure with respect to row/body inputs (no hidden dependence on currently loaded election state),
  2) party-history display labels should be generated in one dedicated post-processing pass, not inherited from mixed upstream display names.

# Current Task: Finalize Party Election-History Label Contract And Seat Delta Rules (2026-03-05)

- [x] Rename column headers: `Candidates elected` -> `Seats won`, `Candidates elected ±` -> `Seats won ±`
- [x] Rename `Number of constituencies` -> `Total constituencies`
- [x] Rename `Available seats`/`Available seats ±` -> `Total seats`/`Total seats ±`
- [x] Ensure local general election names render as `Local [year|Mon YYYY]`
- [x] Keep total-seat delta based on same election type baseline
- [x] Suppress total-seat delta for by-elections/recall rows (`—`)
- [x] Run syntax validation

- Symptom: several header labels still used old wording, and total-seat deltas needed explicit by-election suppression.
- Root cause: UI table schema and row delta rendering still reflected legacy labels/behavior from earlier contract.
- Permanent prevention action: treat party-history column labels and by-election delta visibility as explicit schema rules in one place (`partyHistoryColumns`) and enforce by-election seat-delta nulling at row-precompute stage.

# Current Task: Align By-Election/Recall Display Names With Geography (2026-03-05)

- [x] Change local by-election naming from council-level to DEA-level in election display names
- [x] Change recall-petition naming to `[year] [constituency] recall petition`
- [x] Run syntax validation

- Symptom: council by-elections were titled as `[year] [council] by-election` instead of DEA-level by-election names; recall petition used legacy date-prefixed Westminster phrasing.
- Root cause: generic by-election formatter used elected-body label for all by-elections; special recall display name was hardcoded with old text.
- Permanent prevention action: by-election naming must use contest geography (constituency/DEA) where available; special-event titles should be built from structured fields (year + constituency), not static strings.

# Current Task: Fix Local 2019 Seat Totals Showing 453 Instead Of 462 (2026-03-05)

- [x] Identify exact source of missing 9 seats in 2019 local JSON
- [x] Patch DEA seat-title parser to accept en dash/em dash separators
- [x] Make JSON seat derivation prefer explicit seat suffix from constituency labels
- [x] Remove stale date JSON files before local-government rebuild (prevents lingering old DEA files)
- [x] Rebuild local-government JSON outputs
- [x] Verify totals: 2014=462, 2018 by-election=1, 2019=462, 2023=462
- [x] Verify previously broken Mid Ulster DEA seat counts

- Symptom: local election history/results tables showed only 453 seats for 2019 instead of 462.
- Root cause:
  1) seat parser handled only `-` and failed on titles with `–` (en dash), so source seat metadata was dropped,
  2) downstream JSON seat count relied on elected-candidate counts fallback, which undercounted several Mid Ulster DEAs,
  3) stale JSON files could persist between rebuilds.
- Permanent prevention action:
  1) parse seat suffixes with `[-–—]`,
  2) derive seat counts from explicit constituency seat suffix where available, then fallback to elected-count only if absent,
  3) clear date directories before writing regenerated local-government JSON.

# Current Task: Fix Local History Links Not Loading Clicked `Local YYYY` Election (2026-03-05)

- [x] Identify why `Local YYYY` history links fail to load selected local election
- [x] Add canonical load-body field for collapsed local rows (`electionBodyForOpen`)
- [x] Update history link renderers to use `row.electionBodyForOpen || row.body`
- [x] Run syntax validation

- Symptom: clicking `Local YYYY` in election history did not load the clicked local election.
- Root cause: collapsed local rows use display body `Local Government Districts`, which is not a valid loadable body key in elections index; links used `row.body` directly.
- Permanent prevention action: keep display body and load body separate for synthetic/aggregated rows; link actions must target canonical load keys.

# Current Task: Move Party Subtitle Into Header Card And Remove Standalone Party Strip (2026-03-05)

- [x] Update party entity subtitle to render `Political Party` under party name in header card
- [x] Remove standalone `catalogue-detail__description` strip on party pages only
- [x] Keep candidate/area pages unchanged
- [x] Run syntax validation

- Symptom: party pages showed a redundant standalone `Political Party` strip under the header card.
- Root cause: shared detail template always rendered the `eyebrow` block, while party subtitle was left empty.
- Permanent prevention action: page-kind-specific subtitle/eyebrow rules should be explicit in one render path so duplicate labels are avoided.

# Current Task: Isolate Recall Petition Rows In Election-History Comparison Logic (2026-03-05)

- [x] Add `isRecallPetition` flag to party history rows
- [x] Ensure recall rows do not receive deltas and are not added into comparison baselines
- [x] Force all recall-row fields beyond first three columns (Election/Date/Type) to render as `�`
- [x] Run syntax validation

- Symptom: recall petition rows were treated like normal election rows in party history tables.
- Root cause: no explicit recall-row classification in history row model and baseline chain.
- Permanent prevention action: classify special-event rows explicitly (`isRecallPetition`) and branch both baseline logic and render logic on that flag.

# Current Task: Adjust Party Election-History Column Labels And Delta Column Ordering (2026-03-05)

- [x] Rename delta headers to `�` for Rank/Seats won/Candidates stood/Constituencies stood/1st prefs/% 1st prefs
- [x] Rename `Valid votes` to `1st prefs`
- [x] Reorder constituency columns to: `Total constituencies`, `�`, `Constituencies stood`
- [x] Run syntax validation

- Symptom: election-history headers still used verbose delta labels and requested column ordering was not applied.
- Root cause: party-history schema labels/order had not been updated in the centralized `partyHistoryColumns` definition.
- Permanent prevention action: apply header/order contract changes only in centralized column schema and verify against requested sequence before shipping.

# Current Task: Party Election-History Column Order + Baseline Rules Fix (2026-03-05)

- [ ] Reorder party election-history columns to: Seats won, �, Candidates stood, �, Constituencies stood, �, Total constituencies, 1st prefs, �
- [ ] Ensure by-election deltas compare against prior result in same constituency set (single or grouped by-election scope)
- [ ] Ensure general-election deltas compare only against previous general election of same type, never a by-election
- [ ] Run JS syntax checks for touched files
- [ ] Restart website server for manual verification

- Symptom: party election-history table ordering diverged from required sequence, and delta baselines could still chain through by-elections for general rows.
- Root cause: column configuration order in `ui-controller.js` did not match requested schema, and baseline selection in `election-controller.js` used the latest prior row in-bucket without enforcing general-vs-general chain separation.
- Permanent prevention action:
  1) define party history column order explicitly in one contiguous block with the canonical label sequence,
  2) maintain two baseline tracks per bucket in history derivation: `generalRows` and `allRows`; by-elections baseline from matching-subset/allRows, general baseline from generalRows only.
- Verification evidence:
  1) `node --check js/ui-controller.js` and `node --check js/election-controller.js` pass,
  2) manual smoke test after restart confirms column order and baseline behavior on by-election vs general rows.

## Update 2026-03-05 (Party Election-History Column/Baseline Follow-up)

- [x] Reorder party election-history columns to requested sequence (verified current block already matches requested order)
- [x] Ensure by-election deltas compare against prior result in same constituency set (single or grouped scope)
- [x] Ensure general-election deltas compare only against previous general election of same type, never by-election rows
- [x] Run JS syntax checks for touched files
- [x] Restart website server for manual verification

Verification:
- `node --check js/election-controller.js` passed
- `node --check js/ui-controller.js` passed
- Server restarted on `http://127.0.0.1:5050` (PID 11112)

# Current Task: Grouped Election-History Header Visual Mock (2026-03-05)

- [x] Create a standalone browser mock for the proposed multi-row grouped election-history table header
- [x] Keep the mock isolated from production table code so the layout can be reviewed without UI regression risk
- [x] Expose the mock as a static HTML page under `pages/`

- Verification evidence:
  1) mock file created at `pages/election-history-header-mock.html`,
  2) no production JS/CSS paths changed.

# Current Task: Live Grouped Party Election-History Header (2026-03-05)

- [x] Extend the entity-table renderer to support optional grouped header rows with explicit leaf-column mapping
- [x] Apply the approved grouped header structure to the party election-history table only
- [x] Keep sort/filter controls bound to the mapped leaf headers rather than every header cell
- [x] Add scoped grouped-header sticky/spacing CSS for history tables
- [x] Run JS verification

- Verification evidence:
  1) `node --check js/ui-controller.js` passed,
  2) grouped-header support added in `js/ui-controller.js`,
  3) grouped-history sticky styling added in `assets/css/main.css`.

# Current Task: Restore European Elections In Election History Tables (2026-03-05)

- [x] Diagnose why European Parliament rows were missing from party/candidate election history
- [x] Fix single-constituency `Northern Ireland` result loading in the election data loader
- [x] Run JS verification

- Symptom: European elections were absent from election history tables even though the body/type logic supported them.
- Root cause: `_loadAllResults(...)` hard-skipped constituency key `Northern Ireland`, so single-constituency election files such as European Parliament `northern-ireland.json` never reached the entity index.
- Permanent prevention action:
  1) do not special-case-skip `Northern Ireland` in the generic result loader,
  2) rely on normal fetch fallback for bodies/dates where `northern-ireland.json` does not exist,
  3) treat single-constituency elections as first-class inputs to entity-history aggregation.
- Verification evidence:
  1) `node --check js/election-controller.js` passed.

# Current Task: By-Election Naming/Baselines, Candidate Table Grouped Headers, And Duplicate PersonID Audit (2026-03-05)

- [ ] Change by-election display names in election history tables to `[year|Mon year if needed] [constituency/DEA] by-election`
- [ ] Change by-election collection titles to `[year] [Assembly/Westminster/etc] by-elections` where multiple exist
- [ ] Ensure by-election `Constituencies -> Total -> �` cells are blank in election history tables
- [ ] Fix by-election constituency results-table baselines so they compare with the previous non-by-election election of the same type for that constituency, and use prior NI-wide valid vote for NI-share calculations
- [ ] Change party candidate table `Constituencies stood in` to `Stood in`, suppress year suffix for `Northern Ireland`, and add grouped two-row `Times stood` / `Times elected` headers
- [ ] Audit duplicate real-world candidates split across two PersonIDs and report findings
- [ ] Run JS verification and document results

## Update 2026-03-05 (By-Election Naming/Baselines + Candidate Table Headers + Duplicate PersonID Audit)

- [x] Change by-election display names in election history tables to [year|Mon year if needed] [constituency/DEA] by-election
- [x] Change by-election collection titles to [year] [Assembly/Westminster/etc] by-elections where multiple exist
- [x] Ensure by-election Constituencies -> Total -> � cells are blank in election history tables
- [x] Fix by-election constituency results-table baselines so they compare with the previous non-by-election election of the same type for that constituency, and use prior NI-wide valid vote for NI-share calculations
- [x] Change party candidate table Constituencies stood in to Stood in, suppress year suffix for Northern Ireland, and add grouped two-row Times stood / Times elected headers
- [x] Audit duplicate real-world candidates split across two PersonIDs and report findings
- [x] Run JS verification and document results

Verification:
- 
ode --check js/election-controller.js passed
- 
ode --check js/ui-controller.js passed

Recurring issue:
- Symptom: by-election labels and deltas drifted because generic previous-date logic treated by-elections and general elections as the same class of comparison row.
- Root cause: previous-election selection was purely chronological, and by-election row naming was not normalized after final constituency scope was known.
- Permanent prevention action:
  1) centralize by-election detection in _isByElectionScope(...),
  2) make _getPreviousDateData(...) explicitly skip by-elections when selecting a general-election baseline,
  3) normalize by-election history-row labels only after history rows have their final constituency set.

## Update 2026-03-06 (Grouped Candidate Header Sticky Fix + DEA Label Canonicalization + Liz Kimmins Identity Guardrail)

- [x] Fix grouped candidate-table header cells becoming horizontally sticky on lower header rows
- [x] Make grouped header rows on election history and candidate tables vertically sticky while in view
- [x] Canonicalize constituency/DEA labels in party candidate summaries so seat-suffixed and non-suffixed local JSON labels collapse to one entry
- [x] Review Liz Kimmins duplication and identify the live-data cause
- [x] Run JS verification

Verification:
- 
ode --check js/election-controller.js passed
- 
ode --check js/ui-controller.js passed
- Verified live local JSON includes seat-suffixed DEA names such as Cookstown � 7 seats, confirming the duplicate-label root cause.
- Verified stale local live-election JSON still uses Liz Kimmins PersonID 1902069794 while Assembly uses canonical 44021; added a guarded entity-index alias for that exact stale-ID case.

## Update 2026-03-06 (Live Candidate Duplicate Audit Beyond Liz Kimmins)

- [x] Audit live election JSON for exact same-name same-party multi-ID splits
- [x] Quantify local-vs-non-local split cases likely to duplicate candidate rows on party pages
- [x] Prepare a shortlist of highest-confidence real duplicate people for canonical-ID remediation

Verification:
- Live audit over election-viewer-package/data/elections/**/*.json found 371 exact 
ame + party multi-ID cases.
- 355 of those are local-vs-non-local splits, matching the same structural problem that caused Liz Kimmins to appear twice.
- High-confidence examples include Andrew Muir, Clare Bailey, Claire Hanna, Barry McElduff, Carla Lockhart, and Stephen Moutray.

## Update 2026-03-06 (Approved Local Identity Merges + Local Party Label Normalization)

- [x] Regenerate lgov-modern-wikipedia.stvfix.remapped.xlsx from the normalized workbook with the approved named PersonID merges
- [x] Rebuild live local-election JSON from the fresh remapped workbook
- [x] Normalize requested local-party labels in the local-election build output (People Before Profit Alliance, IRSP, PUP, Workers Party / Republican Clubs, Conservatives, Socialist Party)
- [x] Verify approved candidates collapse to single canonical IDs in live website JSON while Trevor Clarke remains split

Verification:
- python scripts\apply_named_personid_remap.py --modern-workbook _tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.normalised.xlsx --output-workbook _tmp_xls2rar_extract\out\wiki_lgov_modern\lgov-modern-wikipedia.stvfix.remapped.xlsx succeeded with 53 approved names and 81 PersonID updates.
- python privaterep_refactored\electionsni-master\scripts\build_lgov_from_workbook.py rebuilt 241 local-election JSON files from the refreshed remapped workbook.
- Targeted live-data audit confirms Liz Kimmins, Andrew Muir, Clare Bailey, Claire Hanna, Barry McElduff, Carla Lockhart, Stephen Moutray, Charlotte Carson, Andrew McMurray, Danny Donnelly, Cara Hunter, Cathal Mallaghan, Cathy Mason, Chris McCaw, Colin McGrath, Connie Egan, Danny Baker, Darryl Wilson, Ryan McCready, Sorcha Eastwood, Stephen Dunne, Willie Clarke, and Darrin Foster now each appear under a single canonical ID in live JSON.
- Trevor Clarke remains correctly split across three identities: DUP Coleraine local (3766908782), DUP South Antrim (70328), and TUV West Tyrone (70329).
- Party-label spot-check in rebuilt live JSON confirms the old labels are gone and the requested normalized labels are present.

## Update 2026-03-06 (Post-Rebuild Split-ID Consistency Audit)

- [x] Confirm the six manually queried candidates are no longer split between local-election and non-local PersonIDs in live website JSON
- [x] Run a full live-data audit for remaining exact same-name, same-party multi-ID splits after the rebuild
- [x] Record whether any residual Liz-Kimmins-style inconsistencies remain

Verification:
- Live audit over election-viewer-package/data/elections/**/*.json returned zero exact same name + same party + multiple PersonID cases.
- The six queried names (Angela Mulholland, Brian Tierney, Carl McClean, William McCandless, Stephanie Quigley, Stephen Cooper) do not appear under multiple PersonIDs in live JSON.
- This confirms the specific failure mode where one real person had a local-election PersonID and a separate non-local PersonID has been eliminated from the surfaced website data for the currently rebuilt election package.

## Future idea: Canonical identity integrity report
- Potential follow-up task requested by user for later.
- Scope:
  1) enumerate every live PersonID,
  2) list candidate name and all attached elections/parties/constituencies,
  3) flag any suspicious many-name-to-one-ID or one-name-to-many-ID cases,
  4) compare workbook sources against live JSON output.
- Status: deferred until explicitly requested.

## Update 2026-03-06 (Election History N/A + Grouped Header Gap Tightening + Results Header Mock)

- [x] Replace did not contest with N/A in live party election-history table rendering and row model notes
- [x] Tighten grouped election-history header row spacing to remove visible gaps between stacked header bands
- [x] Produce a standalone HTML preview for grouped-header restructures across results-pane table variants (By Party, By Candidate, By Local Party, By Count)

Verification:
- 
ode --check js\\ui-controller.js passed
- 
ode --check js\\election-controller.js passed
- Preview created at pages/results-table-header-mock.html

## Update 2026-03-06 (Grouped Header Horizontal Sticky Regression Fix)

- [x] Fix grouped election-history header cells (Date, Type, Rank) wrongly remaining horizontally sticky over the Election column
- [x] Restrict horizontal stickiness in grouped headers to the true first top-row header cell only

Verification:
- 
ode --check js\\ui-controller.js passed
- 
ode --check js\\election-controller.js passed
- Grouped-header CSS now resets left: auto for all grouped header cells and opts only the first top-row cell back into left: 0.
- Follow-up hardening: grouped header sticky-left override changed from left: auto to left: unset !important for all grouped header cells except the first top-row cell, because the base first-column sticky rule still won in the browser layout.
- Follow-up hardening 2: the remaining grouped-header overlap was paint-order, not sticky-left. Reduced z-index on non-first row-spanning top-row header cells and raised the true Election cell above them so horizontal scroll cannot obscure the sticky first column.

## Update 2026-03-06 (Grouped Header Structure For Live Results Tables)

- [x] Change live By Party, By Candidate, and By Local Party NI-wide results tables to grouped multi-row header structures matching the approved reference geometry
- [x] Update results-table sort/filter controls so they bind only to bottom-row leaf header cells when grouped headers are present
- [x] Add grouped-header styling for results tables

Verification:
- 
ode --check js\\election-controller.js passed
- 
ode --check js\\ui-controller.js passed
- Grouped headers now render from the live results-table HTML builders in js\\election-controller.js rather than the standalone mock only.

## Update 2026-03-06 (Per-Table NI-Wide Results Header Correction)

- [x] Remove `% of NI` columns from the NI-wide `By Party` table
- [x] Revert the NI-wide `By Candidate` table to its prior flat structure with colour column, status column, and `% of NI` columns
- [x] Add `% of NI` columns to the NI-wide `By Local Party` table at the right-hand side

Verification:
- node --check js\\election-controller.js passed
- node --check js\\ui-controller.js passed
- `By Party`, `By Candidate`, and `By Local Party` are now handled as three separate table shapes rather than one generalized grouped-header pattern.

## Update 2026-03-06 (By Candidate Grouped-Header Feasibility Mock)

- [x] Review feasibility of grouped `By Candidate` headers with Geography, Status, `1st preferences`, and `% of NI` bands
- [x] Create static review mock at pages/results-table-header-mock.html

Notes:
- The grouped header is feasible as a presentation-layer change.
- The only non-trivial dependency is defining the source/value rule for the new `Count` column in NI-wide candidate rows.

## Update 2026-03-06 (Live By Candidate Grouped Header)

- [x] Implement grouped-header structure for the live NI-wide `By Candidate` table only
- [x] Group `District` and `DEA` under `Geography`
- [x] Group `Outcome` and `Count` under `Status`
- [x] Group `1st preferences` into `No.` and `%`, each with `+/-`
- [x] Group `% of NI` columns under `% of NI`

Verification:
- node --check js\\election-controller.js passed
- node --check js\\ui-controller.js passed
- `By Party` and `By Local Party` were left unchanged.

## Update 2026-03-06 (By Candidate Runtime Fix)

- [x] Fix runtime failure preventing the NI-wide `By Candidate` tab from rendering

Root cause:
- The new `Count` display in `_buildNIWideCandidateTable()` referenced `totalCountCount` without defining it in that function scope.

Verification:
- node --check js\\election-controller.js passed
- node --check js\\ui-controller.js passed
- The renderer now has a defined `totalCountCount` per constituency before building candidate count-display values.

## Update 2026-03-06 (Live Party Label Normalization)

- [x] Normalize all live instances of `Workers' Party (Ireland)` to `Workers Party / Republican Clubs` in js/election-controller.js
- [x] Extract current live party-name list from website election data using the same normalization rule

Verification:
- node --check js\\election-controller.js passed
- Raw live election data still contains the legacy label in some JSON rows, but the website controller now normalizes it consistently at ingestion/render time.

## Update 2026-03-06 (Additional Live Party Label Merges)

- [x] Normalize `British National Party` to `BNP`
- [x] Normalize `Cannabis Is Safer Than Alcohol` to `CISTA`
- [x] Normalize `Conservatives` to `Conservative`
- [x] Normalize `Socialist Party (Ireland)` to `Socialist Party`
- [x] Normalize `United Kingdom Independence Party` to `UKIP`

Verification:
- node --check js\\election-controller.js passed
- Effective live party list regenerated from website election data using the same normalization rules.

## Update 2026-03-06 (ASCII Delta Header Labels)

- [x] Replace non-ASCII plus/minus header labels in live results/election table builders with ASCII `+/-`

Root cause:
- Non-UTF-8 content in js/election-controller.js caused literal `�` labels to render as replacement glyphs in some tables.

Verification:
- node --check js\\election-controller.js passed
- Remaining live header-label instances in js\\election-controller.js now use `+/-` instead of non-ASCII plus/minus characters.

## Update 2026-03-06 (Header Label Encoding Fix Follow-up)

- [x] Restore nullish-coalescing operators accidentally altered while replacing visible `�` header labels

Verification:
- node --check js\\election-controller.js passed
- `+/-` remains only in visible header-label contexts; code-path nullish operators were restored to `??`.

## Update 2026-03-06 (Header Label Encoding Fix Follow-up)

- [x] Restore nullish-coalescing operators accidentally altered while replacing visible `�` header labels

Verification:
- node --check js\\election-controller.js passed
- `+/-` remains only in visible header-label contexts; code-path nullish operators were restored to `??`.

## Update 2026-03-06 (Remaining Replacement Glyph Source)

- [x] Remove the last live literal � labels from js/ui-controller.js grouped election-history headers

Root cause:
- The previous fix only covered js/election-controller.js; js/ui-controller.js still emitted literal � labels in grouped election-history header definitions.

Verification:
- rg -n "?|±|G|�" js assets pages -S now finds only a static mock-page instance in pages/election-history-header-mock.html
- node --check js\ui-controller.js passed
- node --check js\election-controller.js passed

## Update 2026-03-06 (Final Replacement Glyph Source in By Party Header)

- [x] Replace the remaining literal � tokens in the live By Party grouped header builder inside js/election-controller.js with ASCII +/-

Root cause:
- The replacement-glyph symptom persisted because the NI-wide By Party grouped header still emitted literal � labels from js/election-controller.js, even after the election-history renderer had been fixed.

Verification:
- rg -n "?|±|G|�" js assets -S returns no live matches
- node --check js\election-controller.js passed
- node --check js\ui-controller.js passed

## Update 2026-03-06 (Non-local By Candidate Geography Header)

- [x] Change the non-local NI-wide By Candidate grouped header from a two-row Geography -> Constituency structure to a single row-spanning Constituency header cell

Verification:
- node --check js\\election-controller.js passed
- Local By Candidate header remains grouped under Geography; non-local header now renders Constituency as one cell.

## Update 2026-03-06 (By Count Glyph Fix and Results Header Mock)

- [x] Replace malformed By Count header glyph sequences in js/election-controller.js with ASCII +/-
- [x] Replace the static results-table mock with a clean UTF-8 preview including proposed NI-wide By Local Party and By Party header restructures

Verification:
- rg -n "?|±|G|�|a" js assets -S returns no live matches
- node --check js\\election-controller.js passed
- pages\\results-table-header-mock.html now contains the new static preview sections.

## Update 2026-03-06 (Approved NI-wide By Local Party and By Party Rollout)

- [x] Implement the approved NI-wide non-local By Local Party grouped header with a single Constituency column and expanded Seats band
- [x] Add % and +/- seat-share columns under the NI-wide By Party Seats band

Verification:
- node --check js\\election-controller.js passed
- By Local Party non-local header now uses Constituency instead of Geography -> Constituency
- By Party and By Local Party now compute and render seat-share percentage plus delta columns.

## Update 2026-03-06 (Sticky Results Columns and Ranked Party Candidates)

- [x] Make the first two columns of the live By Party, By Candidate, and By Local Party results tables horizontally sticky
- [x] Make the live results-table header rows vertically sticky and layer the first two sticky columns above non-sticky header cells during horizontal scroll
- [x] Rename table header label Rank to # wherever it appears in live table headers
- [x] Add a leading # rank column to the party info-page Candidates table using the existing descending Total 1st prefs order
- [x] Preserve vertically sticky header rows on the party election-history and candidates tables

What changed:
- Updated ssets/css/main.css to give election results tables a shared sticky first-column/second-column scheme and sticky grouped-header row offsets.
- Updated js/election-controller.js to rename live table rank headers from Rank to #.
- Updated js/ui-controller.js to add a precomputed candidateRank field and render a leading # column in the party candidates table.

Verification:
- 
ode --check js\\election-controller.js passed
- 
ode --check js\\ui-controller.js passed

## Update 2026-03-06 (By Local Party Renderer Runtime Fix)

- [x] Restore the NI-wide By Local Party tab after a grouped-header refactor regression

Symptom:
- Clicking By Local Party left the previous table visible because the renderer failed at runtime.

Root cause:
- The previous-results pass in js/election-controller.js referenced seatCount without defining it in that scope.

Permanent prevention action:
- Keep data derivation local to each loop scope and verify every tab-specific renderer path after grouped-header changes.

Verification evidence:
- 
ode --check js\\election-controller.js passed after adding the missing seatCount declaration.

## Update 2026-03-06 (Results Header Leaf Count and Sticky Wrapper Fix)

- [x] Restore missing % of NI leaf headers and controls in the grouped NI-wide By Local Party table
- [x] Restore vertically sticky results-table header rows by removing vertical overflow clipping from the table wrapper

Symptom:
- % of NI showed data cells without header labels or sort/filter controls, and grouped results headers did not stick while scrolling vertically.

Root cause:
- The grouped header emitted too few leaf header cells for the % of NI band.
- The results wrapper used overflow: auto, making it the sticky containing block even though vertical scrolling happened in the outer pane.

Permanent prevention action:
- After changing grouped results headers, verify leaf-column count matches rendered body columns, and keep results wrappers horizontal-scroll-only so sticky headers anchor to the real vertical scroller.

Verification evidence:
- 
ode --check js\\election-controller.js passed
- 
ode --check js\\ui-controller.js passed

## Update 2026-03-06 (By Candidate Status Count Lifecycle Fix)

- [x] Correct the Count column in the NI-wide By Candidate table so Elected, Excluded, and Not Elected candidates use the real lifecycle count

Symptom:
- The Status -> Count value in the NI-wide By Candidate table did not match the actual count where a candidate was elected or excluded, and fell back to simplistic first-seen status logic.

Root cause:
- The NI-wide By Candidate builder maintained a separate, weaker lifecycle derivation from the constituency count table, so it was not using the existing count-transition inference helper.

Permanent prevention action:
- Reuse the same lifecycle inference path for status-count displays and the detailed count table, instead of maintaining parallel status detection logic.

Verification evidence:
- 
ode --check js\\election-controller.js passed
- 
ode --check js\\ui-controller.js passed

## 2026-03-06 Results table denominator and identity merge fixes
- Symptom: NI-wide local By Candidate and By Local Party tables could surface Non-transferable rows, some local candidates showed 0.00% despite large first-pref totals, grouped result headers were not sticking vertically, and surname-change candidates were split across PersonIDs.
- Root cause: aggregate renderers trusted corrupt local Valid_Poll values, did not consistently filter nontransferable candidate IDs, sticky headers were inside a non-vertically-scrolling wrapper, and the canonical PersonID map was missing the new surname-change aliases.
- Permanent prevention action: added shared _safeValidPoll(info, countGroup) fallback logic, filtered nontransferable IDs at the shared NI-wide renderers, moved results-table wrappers onto their own scroll container for sticky headers, and extended _canonicalEntityPersonId with the approved Laura/Sian/Deborah aliases.
- Verification evidence: node --check js/election-controller.js; node --check js/ui-controller.js; live-data audit confirmed Ballyarnett and Magherafelt had negative Valid_Poll and now have a shared fallback path.

## 2026-03-06 Placeholder candidate rows in By Candidate tables
- Symptom: By Candidate tables could show rows named 'Party' that were actually party placeholder rows, not real candidates.
- Root cause: local-election JSON contains placeholder countGroup rows with Candidate_Id values and cleaned display name 'Party', and candidate aggregators were only filtering on Candidate_Id presence.
- Permanent prevention action: added shared _isValidCandidateRow(row) gate and applied it across NI-wide candidate/local-party aggregation, council aggregates, constituency party summaries, previous-result comparison helpers, and candidate entity indexing.
- Verification evidence: node --check js/election-controller.js; node --check js/ui-controller.js; live audit confirmed source rows named 'Party' exist in local JSON and are now blocked at aggregation time.

## 2026-03-07 District By Candidate renderer runtime fix
- [x] Restore the District `By Candidate` tab after grouped-header refactor

Symptom:
- Clicking the District `By Candidate` tab left the previous tab on screen because the renderer crashed at runtime.

Root cause:
- `_renderCouncilView(...)` reused `leafHeader(...)` from the NI-wide renderer, but that helper was only defined in the NI-wide function scope and was therefore undefined in the district renderer.

Permanent prevention action:
- Define grouped-header helper functions in every renderer scope that uses them, or centralize them on the controller before reusing them across NI-wide and district table builders.

Verification evidence:
- `node --check js/election-controller.js` passed
- `node --check js/ui-controller.js` passed

## 2026-03-07 District renderer follow-up fixes
- [x] Correct DEA-level summary NaN rendering, restore District By Candidate output, restore District delta colouring, make District By Local Party DEA links clickable, and propagate local election types to candidate histories

Symptom:
- DEA-level summary rows in `By Party`/`By Count` could render `NaN`, District `By Party`/`By Local Party` delta text lost green/red styling, District `By Candidate` still failed to render, District `By Local Party` DEA values were plain text, and candidate history rows for local elections showed `unknown` types.

Root cause:
- Constituency-level local formatters did not guard non-finite deltas, the District renderer mixed obsolete delta CSS classes with the live `--pos/--neg` scheme, the District candidate grouped header still referenced a nonexistent helper, the District local-party DEA cell used a plain span instead of the existing feature-link helper, and candidate appearances never had `electionType` assigned during entity-index construction.

Permanent prevention action:
- Reuse shared delta helpers or match the live delta class names, guard local summary formatters against non-finite values, route district geography cells through the shared feature-link helper, and assign `electionType` when candidate appearance records are built so UI tables do not infer it later.

Verification evidence:
- `rg -n "_resultsHeaderControls|election-delta--up|election-delta--down" js/election-controller.js` returns no live matches
- `node --check js/election-controller.js` passed
- `node --check js/ui-controller.js` passed

## 2026-03-07 Local district baseline and lifecycle fixes
- [x] Restore Mid Ulster district comparison baselines and correct district candidate lifecycle counts

Symptom:
- Mid Ulster District `By Party` / `By Candidate` / `By Local Party` showed `N/A` for all `+/-` values, and District `By Candidate` count values collapsed to `1/X` or `X/X` instead of showing real intermediate lifecycle counts.

Root cause:
- Previous local-election files for several Mid Ulster DEAs are stored with seat-suffixed filenames like `magherafelt-5-seats.json`, but `_loadAllResults(...)` only requested unsuffixed slugs, so the previous district aggregate never loaded. In addition, district candidate aggregates preserved raw status-derived `electedAt` / `excludedAt` values even when lifecycle inference found the real redistribution count.

Permanent prevention action:
- For local-government result loading, try seat-suffixed slug variants (`-5-seats`, `-6-seats`, `-7-seats`) before treating a constituency result as missing. In district candidate aggregates, prefer inferred lifecycle counts over raw status placeholders when both exist.

Verification evidence:
- `node --check js/election-controller.js` passed
- `node --check js/ui-controller.js` passed
- `rg -n "constituencySlugVariants" js/election-controller.js` confirms the local slug fallback is live

## 2026-03-07 Mid Ulster district key canonicalization fix
- [x] Canonicalize previous local constituency keys before district aggregation so Mid Ulster district deltas resolve against 2019 data

Symptom:
- Mid Ulster District By Party / By Candidate / By Local Party still showed N/A in all +/- columns even after seat-suffixed file fallback was added.

Root cause:
- The 2019 local-election index names Mid Ulster DEAs as Cookstown � 7 seats, Magherafelt � 5 seats, etc, while 2023 uses plain Cookstown, Magherafelt, etc. Previous local results therefore loaded successfully but were aggregated under suffixed constituency keys, so district rows could not match the current unsuffixed constituency names.

Permanent prevention action:
- Canonicalize constituency names with _cleanConstituencyDisplayName(...) at the start of district aggregate building, and use the canonical name consistently for council lookup, candidate constituency assignment, local-party keys, and elected-member tally updates.

Verification evidence:
- 
ode --check js/election-controller.js passed
- 
ode --check js/ui-controller.js passed
- elections_index.json confirms Mid Ulster 2019 uses seat-suffixed constituency labels while 2023 uses unsuffixed labels

## 2026-03-07 Mid Ulster District By Local Party previous-row key fix
- [x] Use canonical local-party aggregate keys for previous district-row matching instead of scanning display rows

Symptom:
- Mid Ulster District By Local Party still showed N/A in all +/- columns after district key canonicalization had already fixed District By Party and By Candidate.

Root cause:
- The District By Local Party renderer still matched previous rows by scanning previousAggregate.localParties for exact party + constituency equality, instead of using the canonical localPartyMap key. That left the renderer exposed to residual label mismatch even though the aggregate itself was already keyed canonically.

Permanent prevention action:
- District local-party previous-row lookups must use previousAggregate.localPartyMap.get("::") rather than scanning rendered row arrays.

Verification evidence:
- 
ode --check js/election-controller.js passed
- 
ode --check js/ui-controller.js passed

## 2026-03-07 Constituency By Count label and baseline fix
- [x] Replace malformed By Count +/- labels and resolve previous-payload lookup by canonical constituency name

Symptom:
- Constituency By Count tables still showed malformed glyphs instead of +/- and local DEA summary rows like Valid votes, Turnout, Spoiled, Did not vote, and Electorate compared against zero instead of the previous election in the same area.

Root cause:
- The By Count header builder still contained replacement-character label strings, and previous constituency payload lookup only checked direct keys. That failed for local DEAs whose previous-election keys are seat-suffixed, such as Clogher Valley � 6 seats versus current Clogher Valley.

Permanent prevention action:
- Keep By Count header labels ASCII-only and make previous constituency payload lookup fall back through canonicalized constituency names before treating the baseline as missing.

Verification evidence:
- node --check js/election-controller.js passed
- rg confirms no remaining pref replacement-character labels in the live By Count builder

## 2026-03-07 Person history type-label casing fix
- [x] Preserve canonical election type casing in person info-page election history tables

Symptom:
- The person info-page election history table rendered european and westminster in lowercase in the Type standing and Type elected columns.

Root cause:
- The UI renderer lowercased ow.electionType at render time even though the canonical type labels should surface as Local, Devolved, Westminster, and European.

Permanent prevention action:
- Person history type labels must render the canonical electionType value directly rather than forcing lowercase in the UI layer.

Verification evidence:
- node --check js/ui-controller.js passed
- node --check js/election-controller.js passed

## 2026-03-07 Person history table area-linking fix
- [x] Make person info-page election history constituency and local district cells open the related feature/detail pages

Symptom:
- In person info-page election history tables, constituency values were plain text instead of opening the constituency/DEA feature page, and local district values in the Elected body column were also plain text.

Root cause:
- The candidate history table renderer used escaped text for both fields instead of reusing the existing election constituency feature-link helper that already powers results-table geography navigation.

Permanent prevention action:
- Person history tables must reuse the election constituency feature-link helper for geography cells, and local district body labels must use the district-level feature-link path instead of plain text.

Verification evidence:
- node --check js/ui-controller.js passed
- node --check js/election-controller.js passed

## 2026-03-07 Grouped results-table # and Party controls fix
- [x] Add sort/filter controls to the # and Party headers in grouped By Party and By Local Party tables

Symptom:
- The grouped NI-wide and District By Party / By Local Party tables did not expose sort/filter controls on the # and Party header cells.

Root cause:
- Those headers were plain row-spanning th elements without data-leaf-col-idx, so the results-table control initializer skipped them.

Permanent prevention action:
- Any grouped header cell that should be sortable/filterable must remain a leaf header with data-leaf-col-idx even if it row-spans multiple header rows.

Verification evidence:
- node --check js/election-controller.js passed
- node --check js/ui-controller.js passed

## 2026-03-07 NI-wide local candidate DEA label normalization fix
- [x] Normalize seat-suffixed local DEA names before pushing NI-wide By Candidate rows

Symptom:
- Some local NI-wide By Candidate rows showed DEA names like Cookstown - 7 seats instead of the canonical Cookstown.

Root cause:
- The NI-wide local candidate row builder pushed constName directly into candidate rows, while other local aggregation paths already canonicalized constituency labels with _cleanConstituencyDisplayName(...).

Permanent prevention action:
- Any local-election renderer that surfaces DEA names must normalize constituency labels before assigning them to display rows or lookup keys.

Verification evidence:
- node --check js/election-controller.js passed
- node --check js/ui-controller.js passed

## 2026-03-07 Mid Ulster 2019 local map blanking fix
- [x] Fix DEA-mode local-election polygon and overlay lookup to use canonical constituency-name fallback for current results payloads
- Mid Ulster appeared blank on the 2019 local-election map because several runtime paths still indexed current payloads by raw constituency key, while Mid Ulster 2019 keys are seat-suffixed and the 2012 DEA map features are not.
- Added _getCurrentConstituencyPayload(constName) in js/election-controller.js and switched current constituency lookups in map colouring, overlay rendering, and constituency panel guards/rendering to use canonical-name fallback.
- Verification: 
ode --check js/election-controller.js; 
ode --check js/ui-controller.js.

## 2026-03-07 Mid Ulster 2019 local map blanking fix
- [x] Fix DEA-mode local-election polygon and overlay lookup to use canonical constituency-name fallback for current results payloads
- Mid Ulster appeared blank on the 2019 local-election map because several runtime paths still indexed current payloads by raw constituency key, while Mid Ulster 2019 keys are seat-suffixed and the 2012 DEA map features are not.
- Added _getCurrentConstituencyPayload(constName) in js/election-controller.js and switched current constituency lookups in map colouring, overlay rendering, and constituency panel guards/rendering to use canonical-name fallback.
- Verification: 
ode --check js/election-controller.js; 
ode --check js/ui-controller.js.

## 2026-03-07 Reconstruction planning folder hardening
- [x] Restructure and harden `tasks/plans/election-controller-reconstruction/` into an execution-grade recovery package

Symptom:
- The initial planning folder was directionally useful but still too high-level to maximize the chance of accurately reconstructing the lost controller.

Root cause:
- The plan defined phases and controls but did not yet force requirement-to-evidence traceability, superseded-decision tracking, function-level reconstruction mapping, priority tiers, or explicit checkpoint/rollback procedure.

Permanent prevention action:
- Reconstruction plans for critical-file recovery must include, before implementation begins:
  1) a populated baseline gap analysis,
  2) a populated forensic change ledger,
  3) a requirement-to-evidence map,
  4) a superseded-decisions register,
  5) a controller/function reconstruction map,
  6) a task-log extract,
  7) explicit checkpoint and rollback rules.

What was done:
- Hardened the existing plan files (`README.md`, `00-overview.md`, `01-evidence-and-sources.md`, `02-forensic-change-ledger.md`, `03-reconstruction-batches.md`, `04-verification-matrix.md`, `05-risk-controls.md`, `06-open-questions.md`, `07-execution-checklist.md`).
- Added new forensic-control files:
  - `08-requirement-evidence-map.md`
  - `09-superseded-decisions.md`
  - `10-controller-reconstruction-map.md`
  - `11-task-log-extract.md`
  - `12-priority-tiers.md`
  - `13-checkpoints-and-rollback.md`

Verification evidence:
- Verified the folder now contains `README.md` plus `00` through `13` planning files.
- Re-read the key hardened files to confirm the new gating rules, file map, and rollback/checkpoint procedure are present.

## 2026-03-07 Forensic artifact population expansion
- [x] Populate the reconstruction ledger and requirement-evidence map further from the transcript before any restore work

Symptom:
- The hardened planning folder existed, but several later high-confidence controller requirements from the transcript were still not captured explicitly in the forensic ledger or requirement-evidence map.

Root cause:
- The first hardening pass established the control structure, but it had not yet been extended with the later transcript-backed items around grouped-table controls, local DEA cleanup, canonical current-payload lookup, District By Local Party matching, non-local candidate header differences, geography links, district naming, and Non-transferable suppression.

Permanent prevention action:
- Before critical-file reconstruction begins, extend the forensic ledger and requirement-evidence map until all later high-confidence transcript-backed controller behaviors are explicitly represented, not just the earliest obvious items.

What was done:
- Added ledger entries L017-L024 to `tasks/plans/election-controller-reconstruction/02-forensic-change-ledger.md`.
- Added requirement rows REQ-014 through REQ-021 to `tasks/plans/election-controller-reconstruction/08-requirement-evidence-map.md`.
- Covered later-approved behaviors including grouped-table #/Party controls, canonical DEA display cleanup, canonical current-payload lookup in live map/panel paths, District By Local Party canonical previous-row matching, non-local By Candidate header shape, person-history geography links, District naming, and Non-transferable suppression.

Verification evidence:
- Re-read the new ledger rows L017-L024.
- Re-read the new requirement rows REQ-014 through REQ-021.
- Confirmed the requirement map now includes both early and later high-confidence transcript-backed controller requirements.

# Current Task: Restore Browser-Recovered Election Controller (2026-03-07)

- [x] Verify browser-recovered controller artifact exists and current `js/election-controller.js` is empty
- [x] Restore `js/election-controller.js` from `recovered-election-controller-from-browser.md`
- [x] Run syntax verification on the restored controller
- [x] Compare restored controller against current workspace assumptions and report status

- Symptom: `js/election-controller.js` in the workspace had been truncated to an empty/near-empty file after a failed rewrite attempt.
- Root cause: whole-file replacement went wrong during controller recovery work, destroying the working tree copy.
- Permanent prevention action:
  1) treat browser-recovered source as a forensic artifact and restore from it verbatim before any edits,
  2) avoid whole-file replacement on critical files without a checkpoint copy,
  3) run an immediate syntax check after restoration before any reconstruction changes.
- Verification evidence:
  1) source artifact `recovered-election-controller-from-browser.md` exists,
  2) `js/election-controller.js` restored from that artifact,
  3) `node --check js/election-controller.js` passes,
  4) SHA-256 hash match confirmed between `recovered-election-controller-from-browser.md` and `js/election-controller.js`.

# Current Task: Create Local Checkpoint Commit (2026-03-07)

- [x] Inspect current git branch and working tree scope
- [x] Record that the local checkpoint commit should include the current worktree state without pushing
- [x] Create a local git commit on `main`
- [x] Confirm no push was performed

- Scope observed: large mixed worktree including restored `js/election-controller.js`, plan documents, task logs, data changes, scripts, and untracked artifacts.
- Commit intent: local checkpoint only; no remote push and no website deployment action.
- Verification evidence:
  1) local commit created: `5e6c778` / `Checkpoint current workspace state`,
  2) `git log -1 --oneline` shows the new local HEAD,
  3) no `git push` command was run in this session for this checkpoint.

# Current Task: Canonicalize Local DEA Names And Preserve Legacy Lookup Compatibility (2026-03-07)

- [x] Diagnose the Mid Ulster 2019 blank-map issue in DEA mode
- [x] Add controller-side compatibility for canonical/legacy DEA names
- [x] Update the local-election build pipeline to emit canonical DEA names without seat-count suffixes
- [x] Rebuild local-election JSON and index outputs
- [x] Verify Mid Ulster 2019 DEA names are canonical in generated data and controller checks pass

- Symptom: Mid Ulster appeared blank on the 2019 local-election interactive map in `DEA` mode.
- Root cause:
  1) generated 2019 Mid Ulster DEA names were seat-suffixed (for example `Cookstown � 7 seats`),
  2) the restored controller's alias generation failed to derive plain DEA names from those labels,
  3) map feature names from `DEAs_2012.fgb` are plain names like `Cookstown`, so matching failed.
- Permanent prevention action:
  1) emit canonical DEA names from the local-election builder and keep seat count only in `Number_Of_Seats`,
  2) centralize controller council/DEA canonical lookup so both legacy and canonical labels resolve during transition,
  3) verify the generated index and payloads no longer carry seat-count suffixes for DEA names.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) `python -m py_compile privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` passes,
  3) `python privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py` rebuilt 241 local-government JSON files,
  4) `election-viewer-package/data/elections_index.json` now lists plain 2019 Mid Ulster DEAs (`Cookstown`, `Magherafelt`, `Dungannon`, etc.),
  5) generated files now use canonical names and slugs such as `election-viewer-package/data/elections/local-government/2019-05-02/cookstown.json`, while the old `*-seats.json` files are removed.

# Current Task: Add District By Party Summary Footer Rows (2026-03-07)

- [x] Inspect District `By Party` renderer and NI-wide summary-row structure
- [x] Add `Valid votes`, `Turnout`, `Spoiled`, `Did not vote`, and `Electorate` footer rows to District `By Party`
- [x] Run syntax verification and record the result

- Requirement: District `By Party` should mirror the bottom summary rows already present in the NI-wide `By Party` table.
- What changed:
  1) appended five `election-table-summary-row` rows to the District `By Party` table body,
  2) used district aggregate totals for valid poll, total poll, spoiled, electorate, and derived did-not-vote,
  3) used previous district aggregate totals for numeric and percentage deltas.
- Verification evidence:
  1) `node --check js/election-controller.js` passes.

# Current Task: Fix Person Election History Type And Elected Body Display (2026-03-07)

- [x] Inspect the person info-page election-history table schema
- [x] Add a `Type` column between `Date` and `Constituency`
- [x] Prevent truncation of `Elected body` values in the person election-history table
- [x] Run syntax verification and record the result

- Requirement: person election history should show `Type` (`Local`, `Devolved`, `Westminster`, `European`) and should not truncate the `Elected body` value.
- What changed:
  1) inserted the `Type` column into `candidateHistoryColumns` between `Date` and `Constituency`,
  2) changed `Elected body` rendering to use a non-clamped display wrapper,
  3) added `.election-cell-wrap--full` in CSS so long elected-body labels can wrap instead of being ellipsized.
- Verification evidence:
  1) `node --check js/ui-controller.js` passes,
  2) `node --check js/election-controller.js` passes.

# Current Task: Fix By Count Sticky Columns And Header Labels (2026-03-07)

- [x] Inspect `By Count` renderer and sticky-table CSS
- [x] Make `#`, colour stripe, `Name`, and `Party` horizontally sticky in `By Count`
- [x] Make the `By Count` header row vertically sticky relative to the results pane
- [x] Fix non-detailed count headers to read `Count` / `#`
- [x] Omit terminal non-meaningful count columns and keep `Status` denominators aligned with visible counts
- [x] Verify syntax and example count-sequence behavior

- Requirement: `By Count` should keep its identity columns sticky, have a sticky header row, use cleaner collapsed count labels when Detailed View is off, and omit terminal no-event counts.
- What changed:
  1) extended `By Count` sticky-column CSS from 2 columns to 4 columns with explicit widths and offsets,
  2) changed the `By Count` wrapper used by the renderer to `election-count-wrapper--pane-sticky`, so vertical stickiness resolves against the results pane rather than an inner vertical scroll container,
  3) changed non-detailed count headers from `Count N` / `N` to `Count` / `N`,
  4) filtered visible count columns to exclude raw counts with no inferred event and zero candidate/non-transferable transfers,
  5) remapped displayed `Status` count numerators and denominators to the compressed visible-count sequence.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) event-count sanity check on `election-viewer-package/data/elections/local-government/2023-05-18/clogher-valley.json` now resolves raw counts `2,3,4,5,6` to visible counts `2,3,4,5` and displayed total count count `5`.
# Current Task: Make Election Party Wrapper Fill Results Pane Height (2026-03-07)

- [x] Inspect current `election-party-wrapper` height and pane layout ownership
- [x] Move height ownership to the results pane so `election-party-wrapper` fills the available pane height
- [x] Verify the CSS change and record the result

- Requirement: `election-party-wrapper` should dynamically adjust in height to fit whatever the current results-pane height is, rather than using a fixed viewport-based cap.
- What changed:
  1) made `.election-pane__content` a flex column container with `min-height: 0`,
  2) made direct pane-content children participate in flex sizing so results views can fill the available pane height,
  3) made `.election-party-wrapper` fill the pane-owned height with `height: 100%` and `max-height: none` inside the election pane instead of using the old viewport-based cap.
- Verification evidence:
  1) CSS change is scoped to `.election-pane__content` so non-pane uses of the wrappers keep their existing behavior,
  2) the old fixed `max-height: min(62vh, 780px)` no longer governs `election-party-wrapper` inside the results pane.
# Current Task: Scope Candidate And Local Party Sticky Columns Correctly (2026-03-07)

- [x] Inspect candidate and local-party results table column layouts
- [x] Stop candidate tables from horizontally sticking geography columns
- [x] Make candidate grouped headers render above sticky body cells
- [x] Make local `By Local Party` geography columns sticky with correct offsets
- [x] Verify syntax and selector presence

- Requirement: `By Candidate` should keep only `#`, `Name`, and `Party` horizontally sticky and must not let body cells obscure the `District` header band while scrolling; local `By Local Party` should keep `#`, `Party`, `District`, and `DEA` sticky, and District `By Local Party` should keep `#`, colour stripe, `Party`, and `DEA` sticky.
- What changed:
  1) added dedicated table classes for candidate and local-party sticky layouts in the renderer output,
  2) raised grouped header z-index so vertically sticky header bands stay above sticky body cells,
  3) added candidate-table sticky rules that only keep the first three columns sticky and explicitly unstick the next column,
  4) added NI-wide local-party sticky rules for `#`, `Party`, `District`, and `DEA`, including sticky second-row grouped geography headers,
  5) added District local-party sticky rules so `DEA` joins the existing sticky `#` and `Party` block.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) scoped sticky class hooks are present in `js/election-controller.js`,
  3) the CSS contains dedicated `candidate-sticky3`, `local-party-sticky4`, and `district-local-party-sticky4` rules.
# Current Task: Fix NI-Wide Grouped Header Sticky Regressions (2026-03-07)

- [x] Inspect NI-wide By Party, By Candidate, and By Local Party grouped-header sticky ownership
- [x] Make NI-wide By Party, By Candidate, and By Local Party wrappers use pane-relative vertical stickiness
- [x] Restore vertical stickiness for the NI-wide candidate Geography header without making it horizontally sticky
- [x] Stop NI-wide local-party `Candidates` from horizontally sticking over `Geography`
- [x] Verify syntax and selector presence

- Requirement: in NI-wide tables, `By Local Party` must not let `Candidates` obscure `Geography` on horizontal scroll, `By Candidate` must keep `Geography` vertically sticky, and `By Party` header rows must be vertically sticky relative to the results pane.
- What changed:
  1) added `election-party-wrapper--pane-sticky` and applied it to NI-wide `By Party`,
  2) applied `election-count-wrapper--pane-sticky` to NI-wide `By Candidate` and `By Local Party`,
  3) changed the candidate-table `th:nth-child(4)` override so it remains vertically sticky while no longer being horizontally sticky,
  4) added an NI-wide local-party override so the top-row `Candidates` cell remains vertically sticky only and no longer slides over the sticky `Geography` block.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) pane-sticky wrapper classes are present in NI-wide table markup,
  3) the targeted candidate/local-party header overrides are present in `assets/css/main.css`.
# Current Task: Make District By Local Party DEA Header Vertically Sticky (2026-03-07)

- [x] Inspect the District `By Local Party` DEA header class hookup
- [x] Apply the scoped District local-party sticky class to the live renderer branch
- [x] Ensure the DEA header cell keeps explicit vertical sticky positioning
- [x] Verify syntax and selector presence

- Requirement: the `DEA` column in District `By Local Party` should remain vertically sticky when the results pane scrolls.
- What changed:
  1) added `election-party-table--district-local-party-sticky4` to the live District `By Local Party` renderer branch that was still missing it,
  2) set explicit `top: 0` on the scoped DEA header sticky rule so the header cell sticks in the top header band.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) the District local-party table markup now includes `election-party-table--district-local-party-sticky4`,
  3) the DEA header sticky rule is present in `assets/css/main.css`.
# Current Task: Remove Accidental Candidates Stickiness From District By Party (2026-03-07)

- [x] Inspect District `By Party` and District `By Local Party` renderer class assignments
- [x] Remove the local-party sticky class from District `By Party`
- [x] Restore the local-party sticky class to District `By Local Party` only
- [x] Verify syntax and branch separation

- Requirement: in District `By Party`, the `Candidates` group (`No.` and `+/-`) must not be horizontally sticky.
- What changed:
  1) removed `election-party-table--district-local-party-sticky4` from the District `By Party` renderer,
  2) restored that class to the District `By Local Party` renderer only,
  3) left the shared `district-sticky3` class in place for the intended sticky `#` and `Party` block.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) the District `By Local Party` branch still includes `district-local-party-sticky4`,
  3) the District `By Party` branch now includes only `district-sticky3`.
# Current Task: Make Non-Local NI-Wide By Local Party Identity Columns Sticky (2026-03-07)

- [x] Inspect non-local NI-wide `By Local Party` column layout
- [x] Add a dedicated sticky profile for `#`, `Party`, and `Constituency`
- [x] Verify syntax and selector presence

- Requirement: in the non-local NI-wide `By Local Party` table, `#`, `Party`, and `Constituency` should be horizontally sticky.
- What changed:
  1) added `election-count-table--nonlocal-local-party-sticky3` to the non-local NI-wide `By Local Party` renderer,
  2) added scoped widths and sticky offsets for columns 1-3 only,
  3) kept the fix isolated from the local-election `District`/`DEA` sticky profile.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) the new renderer class is present in `js/election-controller.js`,
  3) the scoped sticky CSS rules are present in `assets/css/main.css`.
# Current Task: Stop Non-Local NI-Wide By Local Party Candidates Header From Obscuring Constituency (2026-03-07)

- [x] Inspect the non-local NI-wide `By Local Party` top-row sticky rules
- [x] Override `Candidates` so it is vertically sticky only
- [x] Verify the scoped selector is present

- Requirement: in the non-local NI-wide `By Local Party` table, the sticky `#`, `Party`, and `Constituency` columns should remain visible when scrolling right, and the `Candidates` header must not slide over `Constituency`.
- What changed:
  1) added a table-specific override for `.election-count-table--nonlocal-local-party-sticky3 thead tr:first-child th:nth-child(4)`,
  2) kept that `Candidates` cell vertically sticky with `top: 0`,
  3) removed its horizontal sticky positioning by resetting `left` and dropping the sticky side shadow.
- Verification evidence:
  1) the scoped override is present in `assets/css/main.css`.
# Current Task: Restrict Non-Local NI-Wide By Local Party Stickiness To # Party And Constituency (2026-03-07)

- [x] Inspect the non-local NI-wide `By Local Party` body/header inheritance
- [x] Unstick the first `No.` body column so only the first three columns remain horizontally sticky
- [x] Make `Constituency` a leaf header so it gets sort/filter controls
- [x] Verify syntax and selector presence

- Requirement: in the non-local NI-wide `By Local Party` table, only `#`, `Party`, and `Constituency` should be horizontally sticky, and `Constituency` should have a sort/filter button.
- What changed:
  1) added `data-leaf-col-idx="2"` to the non-local `Constituency` header cell,
  2) added a scoped body override for `.election-count-table--nonlocal-local-party-sticky3 tbody td:nth-child(4)` to cancel inherited horizontal stickiness on the first `No.` column,
  3) left the first three sticky columns and their header offsets unchanged.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) the non-local `Constituency` header is now a leaf header in `js/election-controller.js`,
  3) the scoped unstick rule for body column 4 is present in `assets/css/main.css`.
# Current Task: Fix Non-Local NI-Wide By Local Party Constituency Links (2026-03-07)

- [x] Inspect the emitted `level` payload for non-local NI-wide `By Local Party` constituency links
- [x] Switch the live non-local `By Local Party` branch from `dea` to `constituency`
- [x] Verify syntax and branch outputs

- Requirement: clicking the `Constituency` link in the non-local NI-wide `By Local Party` table should open the constituency info page.
- What changed:
  1) changed the NI-wide `By Local Party` constituency-link call to emit `isLocal ? 'dea' : 'constituency'`,
  2) left the District local-party branch unchanged so local DEA links still resolve as `dea`.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) the NI-wide candidate and NI-wide local-party branches now emit `isLocal ? 'dea' : 'constituency'`,
  3) the District local-party branch still emits `dea`.
# Current Task: Add To Be Added Local Election Catalogue Entries (2026-03-07)

- [x] Inspect the existing placeholder-card pattern and election catalogue renderers
- [x] Add placeholder local-election entries for 2011, 2005, 2001, 1997, 1993, 1989, 1985, 1981, 1977, and 1973
- [x] Make placeholder election cards non-loadable in both catalogue renderers
- [x] Verify syntax and placeholder hooks

- Requirement: add `To Be Added` election entries for the missing pre-2014 local elections without making them loadable.
- What changed:
  1) added `LOCAL_GOVERNMENT_PLACEHOLDER_ELECTIONS` to `js/election-controller.js` and appended placeholder election cards for the requested years,
  2) marked those entries with `placeholder: true`, rendered `To Be Added` badges in both the sidebar and flat catalogue views, and left them in the local-government colour/thumb profile,
  3) blocked click-to-load behavior for placeholder election cards in `js/ui-controller.js` and `js/app.js`.
- Date assumptions used for the placeholder entries: `2011-05-05`, `2005-05-05`, `2001-06-07`, `1997-05-21`, `1993-05-19`, `1989-05-17`, `1985-05-15`, `1981-05-20`, `1977-05-18`, `1973-05-30`.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) `node --check js/ui-controller.js` passes,
  3) `node --check js/app.js` passes,
  4) `rg` confirms the new placeholder metadata and click guards are present.
# Current Task: Fix Non-Local NI-Wide By Local Party Constituency Links End To End (2026-03-07)

- [x] Inspect the non-local `By Local Party` emitted link metadata and the shared constituency-feature click route
- [x] Patch the shared feature-name resolver to tolerate constituency/map naming variants
- [x] Verify syntax and the new matching hook

- Requirement: clicking a `Constituency` link in the non-local NI-wide `By Local Party` table should open the constituency info page.
- Root cause: the non-local `By Local Party` branch was emitting the correct `constituency` level after the earlier fix, but `js/app.js` still required an exact feature-name match when opening the linked constituency feature. Historical non-local map labels can differ from election/result labels, especially directional variants like `Belfast West` vs `West Belfast`, so the route could still fail even with the correct emitted level.
- What changed:
  1) added `_getElectionFeatureNameVariants(...)` to `js/app.js`,
  2) updated `_findElectionConstituencyFeature(...)` to match on variant sets instead of raw exact names only,
  3) included directional two-token swapping to cover common historical parliamentary label variants.
- Verification evidence:
  1) `node --check js/app.js` passes,
  2) `rg` confirms `_getElectionFeatureNameVariants(...)` and the variant-set matching path are present in `js/app.js`.

- [x] Convert Settlements_Ungeneralised_-6398853129460496398.geojson from Git LFS to normal Git storage and remove the blanket .geojson LFS rule. Verified .gitattributes now uses '*.geojson -filter -diff -merge text' and the file is staged as a full blob rather than an LFS pointer.

# Current Task: Build Clean Reversible Commit Set After LFS Rewrite (2026-03-08)

- [x] Inspect the post-reset index/worktree state and classify runtime deliverables vs local-only artifacts
- [ ] Unstage non-deliverable files without deleting them locally
- [ ] Keep `maps-to-be-added` in the repo as requested
- [ ] Preserve site runtime files, rebuilt election data, and the `.gitattributes` / GeoJSON storage fix
- [ ] Verify the resulting staged set is pushable, reversible, and sufficient for a fully functional site

- Requirement: use the "option 2" clean-commit path, keep `maps-to-be-added`, make the process reversible, and ensure the website remains fully functional.
- Planned keep set:
  1) runtime website code and assets,
  2) runtime election data under `election-viewer-package/`,
  3) intentional build/script changes needed to regenerate committed runtime data,
  4) `.gitattributes`, `.zip-intake-check.json`, task tracking files, `maps-to-be-added`, and `Settlements_Ungeneralised_-6398853129460496398.geojson`.
- Planned exclude set:
  1) `_tmp_*` scratch outputs,
  2) `scripts/__pycache__/`,
  3) logs, ad hoc recovery/debug files, caches, and local archives,
  4) workbook/intermediate analysis artifacts not required by the website runtime.
- Review note (2026-03-08): rebuilt the staged set after `git reset HEAD .` and re-added only runtime website files, `maps-to-be-added`, the GeoJSON/LFS fix, the local-election rebuild script, and task logs. Excluded files remain locally as unstaged or untracked artifacts, so the cleanup is reversible. Verification: `node --check js/election-controller.js`, `node --check js/ui-controller.js`, and `node --check js/app.js` all passed; `git check-attr` confirms `Settlements_Ungeneralised_-6398853129460496398.geojson` is no longer LFS-tracked.
- [x] Remove `maps-to-be-added/Electoral Divisions 1986-2019 (1).zip` from git tracking after extraction/addition to the website. Left the local file on disk, added a narrow `.gitignore` rule to prevent re-adding it, and used this to unblock GitHub push size limits.

# Current Task: Enforce Exclusive Election Visibility And Timed Election Load Feedback (2026-03-08)

- [x] Inspect election-layer activation, active-layers visibility, and map-load toast paths
- [x] Ensure a visible election suppresses every other loaded non-election layer completely, and restores those layers when the election is hidden or cleared
- [x] Route election loads through the same timed load-feedback toast used by normal map layers
- [x] Run syntax verification and record speed findings for local-election loading

- Symptom: election overlays could coexist visually with other loaded map layers, and election loads were not using the shared load-timing toast, making local-election load performance harder to observe consistently.
- Root cause:
  1) the election path only suppressed labels on lower layers instead of hiding whole competing layers,
  2) `App.startMapLoadFeedback(...)` was only wired into `loadMap(...)`, not `electionController.loadElection(...)`,
  3) local-election loading still performs a full geography fetch plus many constituency JSON fetches, so the missing shared timing feedback hid the true cost profile.
- Permanent prevention action:
  1) centralize election exclusivity in `electionController.enforceExclusiveVisibility()` and invoke it from both election activation and app-level map visibility updates,
  2) keep election loads on the same toast/timer path as normal map loads via explicit callbacks,
  3) treat local-election load speed work as data-fetch/geography-cache work, not a styling problem.
- Verification evidence:
  1) `node --check js/election-controller.js` passes,
  2) `node --check js/app.js` passes.

# Current Task: Speed Up Election Loads With Shared Parallelization And Session Caches (2026-03-08)

- [ ] Inspect the shared election load path and confirm the minimum generic hooks needed for all-election caching/parallelization
- [ ] Parallelize geometry, current-results, and previous-results loading for all elections
- [ ] Add session-scoped geometry caching keyed by active FGB path
- [ ] Add session-scoped constituency-payload caching keyed by body/date/constituency slug URL
- [ ] Run syntax verification and record implementation notes
- [x] Completed the shared election-load optimization pass in `js/election-controller.js`
  - parallelized geometry/current/previous loads with `Promise.all(...)`
  - added session-scoped geometry feature caches keyed by FGB path
  - added session-scoped constituency payload caches keyed by request URL
  - verified with `node --check js/election-controller.js`

# Current Task: Fix Electoral Divisions Metadata, Loading, And Multi-Sub-Map Feature Source Labels (2026-03-08)

- [ ] Inspect the Republic of Ireland Electoral Divisions map metadata, failing load path, and multi-sub-map feature-card source labeling
- [ ] Rename the 1986-2019 Republic of Ireland map family from `District Electoral Divisions` to `Electoral Divisions`
- [ ] Remove `Phelim Birch` as a provider from the 2019 Electoral Divisions card
- [ ] Fix the 1986-2019 Republic of Ireland Electoral Divisions load failure
- [ ] Fix feature info-card map-name resolution so province-split/multi-sub-map layers no longer show `unknown layer`
- [ ] Verify behavior and record a ranked large-map load-time reduction review for layers like 1911 District Electoral Divisions

- [x] Completed the Electoral Divisions metadata/load/source-label fix pass
  - renamed the Republic of Ireland 1986-2019 visible Electoral Divisions labels in `data/database/maps.json` and `js/ui-controller.js`
  - removed `Phelim Birch` from the visible 2019 `eds-2019` card provider list
  - made `dataService.getMapById(...)` resolve hidden top-level child maps and group members
  - centralized group loading through `App.loadMap(...)` so group ids with members/variants no longer depend on duplicated UI-side handling
  - fixed feature info cards to resolve map metadata via `dataService.getMapById(feature.mapId)` when the passed loaded-map list does not contain the child sub-map
  - verified with `node --check js/app.js`, `node --check js/ui-controller.js`, `node --check js/data-service.js`, and `maps.json` JSON parse success

- Review note (2026-03-08):
  1) metadata/card cleanup now shows `Electoral Divisions` for the visible Republic of Ireland 1986-2019 family and removes `Phelim Birch` from the visible 2019 card provider list,
  2) the load failure was application-side, not file-side: the FGB files under `data/maps/electoral-divisions/Electoral Divisions 1986-2019/` exist and open successfully, but grouped/member map ids were not consistently resolved or loaded across all app entry points,
  3) `unknown layer` in feature info cards was caused by the card renderer trusting only the currently loaded-map list instead of falling back to the map registry for hidden child/member maps,
  4) large-map review outcome: the highest-return speed path for 1911-style province-split maps is to use the already-generated `lod0` / `lod1` FlatGeobuf files for initial load rather than always deserializing the full province files first.

# Current Task: Speed Up Large 1911 Electoral Divisions Loads With LOD-First Vector Sources (2026-03-08)

- [x] Mark the 1911 Electoral Divisions province maps as opt-in LOD maps in metadata
- [x] Patch the standard vector load path to prefer `-lod0` / `-lod1` FlatGeobufs with fallback to the full source
- [x] Verify syntax and metadata integrity

- Completed the LOD-first optimization pass for the 1911 Electoral Divisions maps.
  - Added `useLOD: true` to the 1911 Electoral Divisions group and province child maps in `data/database/maps.json`
  - Added `getPreferredVectorFilePath(...)` in `js/map-controller.js`
  - Updated the normal non-chunked vector load path to try the preferred LOD FGB first and retry the original full FGB if the LOD source is missing or fails
- Verification evidence:
  1) `node --check js/map-controller.js` passed,
  2) `data/database/maps.json` parsed successfully with PowerShell `ConvertFrom-Json`,
  3) confirmed the referenced 1911 `-lod0` / `-lod1` files exist on disk before enabling the optimization.

# Current Task: Publish Missing Republic Of Ireland Electoral Divisions 1986-2019 Assets And Review Townlands Load Bottlenecks (2026-03-08)

- [x] Identify the remaining Electoral Divisions load failure root cause
- [x] Stage the missing `data/maps/electoral-divisions/Electoral Divisions 1986-2019/` assets for publication
- [x] Review Townlands chunk/index design and extract the main load bottlenecks
- [x] Prepare ranked Townlands speedup proposals by impact vs implementation difficulty

- Root cause: the Republic of Ireland 1986-2019 Electoral Divisions metadata already pointed at real FGB files, but the entire `data/maps/electoral-divisions/Electoral Divisions 1986-2019/` directory was still untracked in git, so the website could still fail to load those maps after code-only pushes because the assets were never published.
- Verification evidence:
  1) `git ls-files "data/maps/electoral-divisions/*1986-2019*"` returned no tracked files before the fix,
  2) `Get-ChildItem "data/maps/electoral-divisions/Electoral Divisions 1986-2019"` confirmed the expected FGB and documentation files exist locally,
  3) the largest individual Electoral Divisions 1986-2019 files are below GitHub's 100 MB hard file limit, so they can be committed normally.
- Townlands review findings:
  1) the NI Townlands 1844 chunk index contains 241 chunks and 60,245 total features,
  2) the current initial viewport preload buffer effectively intersects all 241 chunks at the all-island extent,
  3) this means the chunked loader still behaves like an all-at-once load on first open, which explains the 100+ second wait more than any single broken file would.

# Current Task: Speed Up Townlands 1844 Initial Loading With Overview LOD And Smaller First Detailed Preload (2026-03-08)

- [x] Identify the Townlands-specific hooks for low-zoom overview loading and initial chunk-preload sizing
- [x] Add a low-zoom overview LOD path for `ni-townlands-1844`
- [x] Reduce the first detailed chunk-preload buffer for `ni-townlands-1844`
- [x] Verify syntax and metadata integrity

- Completed the Townlands initial-load acceleration pass.
  - Added `useLOD: true` to `ni-townlands-1844` in `data/database/maps.json`
  - Added `shouldUseOverviewLOD(...)`, `getInitialChunkBuffer(...)`, `_clearRenderedLayerState(...)`, and `_loadOverviewLODState(...)` to `js/map-controller.js`
  - Townlands now opens with the simplified all-island LOD source at low zoom (`<= 8`) instead of immediately loading all visible chunks
  - When the user zooms into detailed view, the first chunked pass uses a much smaller preload buffer (`0.05` instead of `0.5`) so it does not overfetch as aggressively
  - When the user zooms back out to overview zooms, the loader switches back to the simplified overview layer
- Verification evidence:
  1) `node --check js/map-controller.js` passed,
  2) `data/database/maps.json` parsed successfully,
  3) `rg` confirms the Townlands-specific overview/buffer hooks are present in `js/map-controller.js` and `useLOD: true` is present on `ni-townlands-1844`.

# Current Task: Investigate Townlands Detail-Level Switching Thresholds (2026-03-08)

- [x] Inspect the Townlands overview-to-detail transition logic
- [x] Trace the zoom/update event path for chunked layer refresh
- [x] Determine the concrete reason the polygons appear not to switch to higher detail on zoom

- Findings:
  1) `ni-townlands-1844` now deliberately stays on the overview LOD source while zoom `<= 8` via `shouldUseOverviewLOD(...)`, so zooming in one or two levels from the all-island start may still leave the map on the simplified overview geometry,
  2) once zoom exceeds 8, the loader switches to chunked detail, but `_resolveChunkFile(...)` still prefers the `z10` chunk variants for zooms `9-11`,
  3) full unsimplified chunk geometry is only selected once zoom is above 11, because the `z10` variants are defined with `maxZoom: 11` in the chunk index.
- Conclusion: the observed lack of detail switching is primarily a threshold/design issue, not evidence that the zoom-update pipeline is completely broken. The progression is currently:
  - zoom `<= 8`: overview LOD all-island source,
  - zoom `9-11`: `z10` simplified chunk variants,
  - zoom `12+`: full chunk files.

# Current Task: Make Townlands Higher Detail Appear Sooner On Zoom (2026-03-08)

- [x] Lower the Townlands overview cutoff so the simplified all-island overview ends sooner
- [x] Lower the Townlands full-detail cutoff so full chunk geometry appears sooner
- [x] Verify syntax and threshold hooks

- Completed the Townlands detail-threshold adjustment pass.
  - `shouldUseOverviewLOD(...)` for `ni-townlands-1844` now ends the overview layer at zoom 7 instead of 8
  - `shouldPreferFullChunkGeometry(...)` now forces full Townlands chunk geometry from zoom 10 onward
  - `_zoomBandChanged(...)` now uses Townlands-specific bands so the loader correctly treats:
    1) zoom `<= 7` as overview,
    2) zoom `8-9` as simplified `z10` chunk detail,
    3) zoom `10+` as full chunk geometry
- Verification evidence:
  1) `node --check js/map-controller.js` passed,
  2) `rg` confirms the Townlands-specific threshold hooks are present and wired through the chunk reload path.

- 2026-03-08: Reordered flat catalogue/TOC Electoral Divisions card to sit directly below Northern Ireland District Electoral Divisions and above Ireland District Electoral Divisions. Verified with node --check js/ui-controller.js.

- 2026-03-08: Applied screen-space filtering to Townlands chunk loads by removing the ni-townlands-1844 exemption in js/map-controller.js. Verified with node --check js/map-controller.js and confirmed _loadChunkFGB now always derives minDiag from zoom.

- 2026-03-08: Added debounced elapsed-time status messaging for large-map spatial reloads after pan/zoom by emitting spatial loading start/finish events from js/map-controller.js updateSpatialLayers() and handling them in js/app.js. Verified with node --check js/map-controller.js and node --check js/app.js.
