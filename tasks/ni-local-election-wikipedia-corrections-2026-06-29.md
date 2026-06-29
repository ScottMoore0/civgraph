# NI Local-Government Election Corrections (Wikipedia gap audit apply)

Date: 2026-06-29
Source evidence: `_tmp_xls2rar_extract/out/wiki_election_gap_search/election-gap-findings.json`
(English Wikipedia STV election-box data, audited 2026-06-28; 38 resolvable findings).

## What was applied

The 38 resolvable Wikipedia findings split into three mechanisms once cross-checked
against the raw source files (`election-viewer-package/data/elections/local-government/<date>/`):

1. **24 valid-poll corrections** — genuine import corruption (negative/truncated `Valid_Poll`,
   e.g. Ballyarnett 2023 `-179`, Armagh Area C 1973 `166`, and the 1975 Constitutional Convention
   Armagh seat `28136`->`59388`) while candidate first-preference rows were intact. Overlaid the
   Wikipedia `Valid_Poll` (+`Spoiled`/`Total_Electorate` where given, and a repaired `Total_Poll`
   when it was below the corrected valid poll).
   File: `data/elections/corrections/ni-local-valid-poll-corrections.json`.

2. **9 source-file aliases** — authoritative raw files already existed with full candidate data
   and valid polls matching Wikipedia exactly, but the manifest constituency name did not slugify
   to the historical filename (`Giant's Causeway` -> `giant-s-causeway.json`;
   `lgNN-NoD-Ballyholme-&-Groomsport` -> `lgNN-nod-ballyholme-groomsport.json`).
   File: `data/elections/corrections/ni-local-source-file-aliases.json`.
   These surface the richer source data (full transfer counts), not Wikipedia first-prefs.

3. **9 duplicate-placeholder suppressions** — Belfast `Area-F`/`Area-G`/`Area-H`/`Area-H-corrected`
   (1973/1977/1981) were empty placeholder rows duplicating the already-populated
   `Belfast Area F/G/H` rows. Added to `LOCAL_GOVERNMENT_DUPLICATE_RESULT_ALIASES`
   (same mechanism as the earlier 1977 `Area-A-corrected` fix). (`Area-F` was added in a
   2026-06-29 follow-up after it was confirmed to be the same duplicate class.)

Wiring: `scripts/build-test2-election-manifest.mjs` loads the two correction sidecars,
resolves source-file aliases in `findResultFile`'s place, and overlays valid-poll corrections
before `summarizeResult`.

## Review-sidecar hygiene

Removed the now-resolved records from `valid-poll-review.json` (now empty) and
`candidate-row-review.json` (24 + 18 records removed across the initial pass and the 2026-06-29
follow-up). The only remaining flagged records are **10x Dáil-era (1918–1957) candidate rows**
(Kerry South, several Cork/Mayo/Tipperary/Galway, Trinity College), which are out of scope for the
two crawled category trees — and many 1918–1922 seats were returned unopposed, so an empty
candidate list may be correct rather than a gap.

## Verification

- `npm run build:test2:elections`, `npm run build:browse` (browse + graph) regenerated.
- `npm run check:test2`: 0 blocking, **10 warnings** (down from 54), all out-of-scope Dáil-era;
  PMTiles/CDN 0/0; performance dashboard all PASS.
- `npm run check:graph`: PASS (165,196 entities, 1,111,483 statements).
- `npm run check:pages-assets`: PASS.
- `npm run check` (full): the only failure is `check:approved-publication`, caused by an
  untracked local artifact (`tasks/absence-integration-ready-2026-06-15/.../refinement-validation-report.json`)
  that is absent from the isolated worktree but present in the main checkout — environmental, not a regression.

## Follow-up 2026-06-30: Dáil-era gaps closed (audit now 0 warnings)

The 10 remaining Dáil candidate-row gaps were resolved, taking the `/test2` election audit to
**0 blocking / 0 warnings** (from 54 originally):

- **6 via source-file alias** — the combined 1921/1922 constituencies (`Cork East & North East`,
  `Cork Mid, North, South, South East & West` ×2 years, `Mayo North & West`, `Tipperary Mid, North & South`)
  already had authoritative raw files in `election-viewer-package/data/elections/dail-eireann/<date>/`;
  they were unmatched only because the manifest name (`&`) didn't slugify to the filename (`and`/omitted).
  Added to the now-generalised `election-source-file-aliases.json`.
- **4 via populated raw results** (Wikipedia-sourced, with `source_url`):
  - `1957-03-05/kerry-south.json` — contested, 3 seats (Palmer FG, Crowley FF, Rice SF elected; Flynn FF).
  - `1938-06-17/kerry-south.json` — uncontested (Crowley FF, Flynn FF, Lynch FG returned unopposed).
  - `1921-05-24/galway.json` — uncontested, 7 Sinn Féin returned unopposed.
  - `1918-12-14/dublin-university.json` (new) — contested, 2 seats (Samuels IU, Woods Ind.U elected;
    Jellett IU, Gwynn IN), from the Wikipedia STV election box.

`candidate-row-review.json` is now empty. Note: many of the matching-bug constituencies' data had been
in the repo all along — the Wikipedia pages mainly served to confirm and locate it.
