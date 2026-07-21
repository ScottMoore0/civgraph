# Feasibility: digitising the 2011 NI local election count sheets (Wikipedia / ARK / EONI)

**Verdict up front: HIGH feasibility, and most of the pipeline already exists in-repo.** The 2011
local-government transfer detail can be reconstructed to the same schema the 2014+ elections use, wired
into the map/viewer, and fed to the model's transfer-covariate layer — extending the revealed-behaviour
series back from 2014 to 2011 (and, via the same ARK route, potentially to 1985). What follows is what
the current data is, what the target is, what each source offers, and the concrete integration path.

## 1. What the 2011 data is *now*

- **100 per-ward JSON files** at `election-viewer-package/data/elections/local-government/2011-05-05/`
  (one per DEA), each `{ "Constituency": { "countInfo": {...}, "countGroup": [...] } }`.
- `countInfo` has quota, electorate, total/valid poll, spoiled — **present and usable**.
- `countGroup` is a flat candidate list with **first-preference votes + an `Elected` flag only**:
  every entry is `Count_Number: 1`, and there is **no `Transfers`, `Total_Votes`, `Status`, or
  `Occurred_On_Count` field**. So the *outcome* (who won) and *first prefs* are digitised; the
  **count-by-count transfer flow is not**.
- **Data quality is imperfect even at first-pref level.** e.g. the `loughside.json` record lists nine
  candidates as `Elected: true` with several `0.00`-vote entries — a parse/merge artifact, not a real
  result. So this is not merely incomplete; the existing first-pref layer itself needs re-validation.
- **No `_bundle.json` / `_aggregates.json`.** Those council-level rollups (party seat/first-pref
  totals used for map colouring and summaries) exist only for **2014, 2018, 2019, 2023**. 2011 has none,
  so the council-level map/summary layer has nothing to draw from for that year.
- **Not served as static JSON on R2** (`data.civgraph.net/.../2011-05-05/*.json` → 404); the live site
  is a SPA that bundles this data from the `election-viewer-package` tree, so "showing on the site"
  means fixing the bundled files + rebuild, not an R2 upload.

## 2. The target schema (what 2014 has and 2011 must match)

Per-ward `countGroup` entries gain: `Count_Number` (1..N), `Transfers` (signed vote-value, e.g.
`-618.19` for an elimination parcel leaving a candidate), `Total_Votes` (running total after that
count), `Status` (`Elected`/`Excluded`/`Continuing`), `Occurred_On_Count`, plus party metadata
(`Party_Name`, `Party_Colour`, dedup/Wikipedia party names, `candidateName`, `id`). The viewer's
`stages2.js` renders the stage-by-stage chart directly from this; with only `Count_Number: 1` present,
2011 renders as first-prefs with **no transfer visualisation**. Reaching the target schema is exactly
what unlocks both the map display *and* the model.

## 3. The three sources — availability confirmed, and what each gives

| source | 2011 coverage (verified) | transfer detail | non-transferables | parse difficulty |
|---|---|---|---|---|
| **Wikipedia** | ✅ per-council articles carry `STV Election box` templates — Antrim alone has **35 template blocks**, `numcounts = 6–7` | **Full** — per-stage running totals in `count1..countN` params | Derived (residual) | **Low** — structured wikitext |
| **ARK Elections** | ✅ `ark.ac.uk/elections/flg11.htm` + per-council pages (quota + transfers); historic XLS count sheets with explicit **stage columns + a "Non-transferable" row** | **Full** | **Explicit** (own row) | Low–Medium (XLS/HTML tables) |
| **EONI via Wayback** | ✅ results pages archived (e.g. 2017-03-10 snapshot, HTTP 200) | Full (official count sheets, PDF) | Explicit | **High** — PDF/table OCR |

Cross-source notes:
- **Wikipedia** is the richest *structured* source and the easiest to parse, but its non-transferable
  pile is not always tabulated — it must be derived as the residual (`parcel − Σ destination gains`),
  the same method the model already uses for Assembly counts.
- **ARK** is the cleanest *official transcription* and is the only one that gives **non-transferables
  explicitly as their own row** — the field the transfer model most wants — and it spans the whole
  series (`flg73`…`flg19`), so the same converter reaches 1985–2005 too.
- **EONI** is the *primary* official source (the returning officer's own count sheets) and is the right
  arbiter for disputes, but PDF table extraction is the highest-effort path; best used as the
  tie-breaker/validator rather than the bulk ingest.

The sensible design is **ARK or Wikipedia as the bulk ingest, the other as an independent
cross-check, and EONI (Wayback) as the authoritative tie-breaker** where the two disagree — a
three-source triangulation that makes the digitised result auditable rather than single-sourced.

## 4. Most of this is already built

The repo already contains the scaffolding for all three sources — this is not a from-scratch project:

- `scripts/scrape_2011_lgov_wikipedia.py` — scrapes the 26 council articles and emits a `_bundle.json`
  in election-viewer format; uses `scripts/modern_lgov_wikipedia_common.py::parse_count_tables`, which
  already extracts the per-count `count1..countN` columns and `numcounts`/quota/electorate.
- `scripts/ark_to_election_json.py` — converts ARK per-DEA XLS (documented layout: stage columns +
  Non-transferable + Totals + metadata rows) **directly into the target
  `election-viewer-package/data/elections/local-government/{DATE}/{dea}.json` schema**, 1973–2011.
- `scripts/download_eoni_pdfs.py`, `scripts/parse_eoni_pdfs.py`, `scripts/scrape_eoni_archive.py` —
  the EONI PDF ingest path.
- `scripts/scrape_and_compare_lgov_wikipedia.py`, `scripts/update_elections_index_pre2014.py`,
  `scripts/restructure_election_bundles.py`, `scripts/normalise_lgov_person_ids.py` — comparison,
  index, restructuring, and identity-resolution helpers.

The staging dirs (`_tmp_2011_lgov/`, `_tmp_xls2rar_extract/`) are gitignored scratch and were wiped by
container churn, so the scrapers need re-running, but the **parsers, the target schema, the party-name
canonicalisation, and the person-ID plumbing already exist**.

## 5. Integration path — map *and* model, end to end (verified)

The build chain is already wired so that fixing the source files propagates automatically:

```
election-viewer-package/data/elections/local-government/2011-05-05/{dea}.json   ← digitise here
        │  (countGroup now with Count_Number 1..N, Transfers, Total_Votes, Status)
        ├─► npm run build:test2:elections
        │        build-test2-election-manifest.mjs reads election-viewer-package/data/elections
        │        → test/metadata/elections-test2/local-government-...__2011-05-05.json
        │
        ├─► regenerate _bundle.json / _aggregates.json for 2011  → council map colouring + summaries
        │
        └─► the SITE: stages2.js renders the per-ward transfer chart from countGroup (no code change)
```

- **Map/site display:** once the per-ward files carry the full `countGroup` and the `_bundle`/
  `_aggregates` rollups are regenerated (the 2014 build step, pointed at 2011), the 2011 layer renders
  identically to 2014 — stage-by-stage transfers in the ward view, party totals on the council map.
- **Model:** `analysis/border-poll-dry-run/v9/augment/transfer_covariates.py` (and `_dea.py`) read
  `test/metadata/elections-test2/`. Because `build-test2-election-manifest.mjs` sources from the
  viewer-package tree, the digitised 2011 counts flow through to the metadata the covariate scripts
  already parse — `elim_flows()` picks up the single-source elimination stages with **no change to the
  model code**. That extends `transfer_openness_timeseries.py` and the DEA covariates back to 2011, and
  (via ARK) opens 2001/2005 and 1985–1997.

## 6. The honest caveats

- **Boundary vintage.** 2011 used the **26-council / old-DEA** geography, not the current 11-council /
  80-DEA one. The covariates land on 2011 DEAs; feeding them into the modern DZ→DEA softness layer needs
  an **old-DEA → new-DEA (or → DZ) crosswalk**, which is an extra step (areas were split/merged in the
  2014 reform). Useful immediately for the **time series** (NI-level and old-DEA); needs the crosswalk
  before it sharpens the *current-geography* softness surface.
- **Same STV limits as before.** Vote-value not voter-count (fractional WIGM), blended/conditional
  provenance, single-source stages only, bulk multi-eliminations non-attributable — identical to the
  Assembly treatment already documented in `TRANSFERS_FEASIBILITY.md`. Digitising 2011 adds *coverage*,
  not new certainty about provenance.
- **First-pref re-validation.** The existing 2011 first-pref layer has at least one corrupt ward
  (Loughside); the digitisation should **replace** the 2011 files wholesale from the triangulated
  sources rather than patch transfers onto a shaky base, and cross-check first-pref totals against the
  known seat outcomes.
- **Effort:** moderate. The parsers exist; the real work is re-running the scrapers, three-way
  reconciliation (party-name and candidate-identity matching across Wikipedia/ARK/EONI is the fiddly
  part — hence the existing `normalise_lgov_person_ids.py` / party-canonicalisation helpers), QA against
  seat outcomes, and the old→new DEA crosswalk for full model use.

## Verdict

**Digitising 2011 to full count-detail is HIGH-feasibility and largely pre-built.** All three named
sources carry the transfer data and are live/archived (Wikipedia richest+easiest, ARK cleanest with
explicit non-transferables and the widest year span, EONI the authoritative tie-breaker). The target
schema, the scrapers, and the build+model wiring already exist; the deliverable is running and
reconciling them, regenerating the rollups, and adding an old→new DEA crosswalk. Doing so makes 2011
render on the site exactly like 2014 **and** extends the model's revealed-behaviour transfer covariate
one full electoral cycle earlier — with the ARK route offering 1985–2005 as the natural follow-on.
