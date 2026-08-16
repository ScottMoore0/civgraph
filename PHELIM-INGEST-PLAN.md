# Phelim Birch delivery — ingest plan

> **Status: point-in-time ingest plan — 2026-08-03. Superseded in part.** Written
> to resolve three complaints raised on 2026-08-01. Further deliveries from the
> same contributor have arrived since through the contributions system: five
> corrected Local Authorities layers were reviewed, verified and published on
> 2026-08-16 (see the approved records in the contribution queue and
> `data/maps/_archive/*_archived_20260816.fgb`). Treat the mechanism described
> here as historical; new deliveries now arrive via `/browse/` submissions.

Resolves the three complaints raised in the Civgraph group chat on 2026-08-01:

1. "the brand new DED/ward files (e.g. 1941, 1963) look fine but the set from 1946-1985 still has the old versions of the map files"
2. "I'm not seeing any local authority updates either"
3. "no all-Ireland section or anything"

**Root cause, established 2026-08-03.** All three are the same fault. Phelim delivered
95 new `.fgb` files on **2026-07-26** as a 3-part Google Drive export. It is still sitting
unextracted in `C:\Users\scomo\Downloads\`. The 31 July refresh ingested **20 of the 95**
and nobody diffed the result against what arrived. Every layer he complains about is in
the 75 that were not ingested.

There is no bug in the site and no bug in the pipeline. There is an un-processed delivery.

---

## The delivery

```
C:\Users\scomo\Downloads\Civgraph-20260726T221903Z-1-001.zip   1,493,172,854 B
C:\Users\scomo\Downloads\Civgraph-20260726T221903Z-1-002.zip   1,153,918,409 B
C:\Users\scomo\Downloads\Civgraph-20260726T221903Z-1-003.zip     758,451,465 B
```

Each part is an independently-openable zip (Drive splits by file, not a spanned archive).
Contains 116 `.fgb`, 22 build-spec `.txt`, and a large unrelated `UK Data Service` tree.

Phelim marks what is already published with a `Files already on the site` subfolder, so
"new" is unambiguous:

| Folder | New | Ingested 31 Jul | **Outstanding** |
|---|---|---|---|
| `Civgraph/Townlands` | 26 | 0 | **26** |
| `Civgraph/EDs` | 35 | 14 | **21** |
| `Civgraph/Local Authorities` | 19 | 6 | **13** |
| `Civgraph/CSO EDs` | 8 | 0 | **8** |
| `Civgraph/Counties & Provinces` | 5 | 0 | **5** |
| `Civgraph/Dáil Constituencies` | 1 | 0 | **1** |
| `Civgraph/` (root) | 1 | 0 | **1** |
| | **95** | **20** | **75** |

Provenance proof (byte-exact size match, cache ↔ zip): `eds-leinster-1963.fgb` =
`Wards_DEDs_Leinster_1963.fgb` (29,469,016); `eds-munster-1957.fgb` =
`Wards_DEDs_Munster_1957.fgb` (42,857,192); `eds-leinster-1941.fgb` =
`Wards_DEDs_Leinster_1941.fgb` (29,505,080); `eds-munster-1921.fgb` =
`Wards_DEDs_Munster_1921.fgb` (42,785,664). The 31 July batch came from this zip.

The Local Authorities ingest took the first six files in chronological order — 1915,
1920-06-19, 1920-06-25, 1920-10-04, 1921, 1927 — and stopped. The next file is 1930.
That is exactly where the deployed tiles stop being refreshed and exactly what his
screenshot points at.

---

## The notes are the metadata

`Civgraph/EDs/*.txt` — 22 files, one per composite year, in a consistent format:

```
Files to use - DEDs_Connacht_1957, Wards_DEDs_Leinster_1957,
               Wards_DEDs_Munster_1957, DEDs_Ulster_1921
Name         - District Electoral Divisions/Wards 1957
Provider     - Phelim Birch, Paddy Matthews
Date         - 01/11/1957
Notes        - Modified version of ... 1965. In 1965, Cork county borough's boundary
               expanded further into the DEDs of Bishopstown, St. Mary's and Blackrock ...
Sources:     - Local Government Provisional Orders Confirmation Act, 1955
             - Irish Townland and Historical Map Viewer (6 Inch Last Edition basemap) ...
Category card - Small Electoral Units -> Electoral Divisions (Republic of Ireland)
Attribute to use for feature labels - ENGLISH
```

**Drive the metadata from these files. Do not hand-author it.** They carry name, date,
provider, exact province composition, editorial note, citation list, intended catalogue
card, and the label attribute. The 1970 note cites 20 sources including Dublin City
Council 1954 minutes.

Notes exist for the EDs series **only**. Local Authorities, Townlands, CSO EDs, Counties
& Provinces and Dáil Constituencies have none — consistent with his "I'll fix the notes".

---

## BLOCKERS

### B-1 · `DEDs_Connacht_1957` — RESOLVED 2026-08-03

Nine notes referenced `DEDs_Connacht_1957`, which is not in the delivery; the delivery
contains `DEDs_Connacht_1963`, which no note references. Put to Phelim directly, he
confirmed:

> **"Ah yeah the year's meant to be 1957. Mixed it up w the Ulster change."**

**The filename is wrong, not the data.** `DEDs_Connacht_1963.fgb` (25,857,816 B) *is* the
1957 Connacht file — he transposed the year from the Ulster series, which genuinely does
have a 1963 change (`DEDs_Ulster_1963`).

**Action:** ingest `DEDs_Connacht_1963.fgb` **as** `eds-connacht-1957`, and record the
rename in the P0-3 delivery manifest so it is auditable rather than folklore.

Two consequences:

- **All 22 ED composites are buildable.** There is no blocked subset; Phase 1b is deleted
  and its nine years fold into Phase 1.
- **The 31 July ingest was right by accident.** It created `eds-connacht-1957.fgb` from
  those bytes. I flagged that as a silent mislabel; it turns out to be the correct
  outcome. Verified: no live layer is labelled Connacht 1963, so nothing downstream needs
  correcting. Leave it alone.

### B-2 · Card hierarchy does not exist — STILL OPEN

Every note specifies `Category card - Small Electoral Units -> Electoral Divisions
(Republic of Ireland)` — a two-level hierarchy. The live catalogue category is flat
(`Electoral Divisions`), and "Small Electoral Units" does not exist.

Also unresolved: his "no all-Ireland section". The most likely referents are the 26
un-ingested all-island `Townlands_<County>` files and the 5 un-ingested `Counties &
Provinces` files, but this is inference.

**Ask:** *"Do you want a 'Small Electoral Units' parent card with 'Electoral Divisions
(Republic of Ireland)' under it? And by 'all-Ireland section', do you mean the Townlands
and Counties sets from the 26 July drop, or a specific new card?"*

Phase 3 and the card wiring are held until this is answered. Phases 1, 2, 4 and 5 are not
blocked by it.

---

## Phase 0 · Preserve and stage (do first, no exceptions)

### P0-1 · Copy the zips out of Downloads

**Risk: None. Difficulty: trivial.**

Downloads is not durable storage. Copy — do not move — all three parts to a working
location outside the repo (they must never be committed; 3.2 GB, and the UKDS tree is
third-party licensed material).

```bash
mkdir -p /d/civgraph-intake/2026-07-26
cp "/c/Users/scomo/Downloads/Civgraph-20260726T221903Z-1-00"{1,2,3}.zip /d/civgraph-intake/2026-07-26/
```

**Verify:** three files present, byte sizes match the table above.

### P0-2 · Extract only what is needed

**Risk: None.** Extract the six Civgraph data folders and the notes. **Do not extract the
`UK Data Service` tree** — it is the bulk of the 3.2 GB, is unrelated to this work, and is
licensed material that should not be casually copied about.

**Verify:** 116 `.fgb` and 22 `.txt` present; no `UK Data Service` directory.

### P0-3 · Record a manifest of the delivery

**Risk: None.** Write `data/intake/2026-07-26-phelim-delivery.json` recording, per file:
folder, filename, byte size, sha256, and `alreadyOnSite: true|false`. Commit **this file
only** — it is small, and it is the artefact that makes the next delivery diffable.

**Verify:** 116 entries; `alreadyOnSite` true for the 21 files under
`Files already on the site`.

### P0-4 · Confirm nothing newer arrived

**Risk: None.** Check for a delivery later than 26 July by another route (email, WhatsApp,
a second Drive link). If one exists, stop and re-baseline — this plan is written against
the 26 July contents.

---

## Phase 1 · All 22 ED composites

**Impact: highest — this is complaint 1. Difficulty: medium. Risk: Medium.**

Years: **1941, 1942, 1943, 1944, 1946, 1950, 1953, 1954, 1955, 1957, 1965, 1966, 1970,
1971, 1977, 1980, 1983, 1985, 1986, 1994, ED 1997, ED 2019** — all buildable following
B-1's resolution. Ingest `DEDs_Connacht_1963.fgb` as `eds-connacht-1957`.

### P1-1 · Parse the notes into a build spec

Write `scripts/parse-phelim-ed-notes.mjs`: read the 22 `.txt`, emit JSON with
`{year, name, provider, date, filesToUse[], notes, sources[], categoryCard, labelAttribute}`.
Fail loudly on any note that does not match the expected shape rather than skipping it.

**Verify:** 22 specs parsed; `filesToUse` has 4 entries each; every referenced filename
resolves to a delivered file **after applying the B-1 rename** (`DEDs_Connacht_1957` →
`DEDs_Connacht_1963.fgb`). Encode that rename as an explicit alias table in the script, not
as a silent fallback — this check is what will catch the next transposed filename.

### P1-2 · Add the outstanding sources to the intake manifest

Add entries to `test/source-cache/vector-intake/manifest.json` for the 21 outstanding
`Civgraph/EDs` files. **Preserve Phelim's filenames in the manifest** and record the
canonical rename separately, so a future diff against his delivery is possible. The
31 July ingest renamed `Wards_DEDs_Leinster_1963.fgb` → `eds-leinster-1963.fgb` with no
record, which is why the Connacht mislabel went unnoticed.

**Verify:** manifest entry count rises by 21; `node scripts/build-test-vector-intake.mjs`
reports them as present in cache, nothing to download.

### P1-3 · Convert, tile, upload, promote

Run the guarded pipeline. It is conservative by design — `build-test-vector-batch` is a
dry inventory unless `--execute`, and `build-test-pmtiles` retains directory MVT as a
fallback "so a bad or oversized archive cannot strand a layer".

```bash
node scripts/build-test-vector-batch.mjs                      # dry inventory — review first
node scripts/build-test-vector-batch.mjs --execute --limit 5   # in small batches
node scripts/build-test-pmtiles.mjs
node scripts/write-test-cdn-upload-manifest.mjs
node scripts/upload-test-pmtiles-r2.mjs                        # see note below
node scripts/promote-test-converted-layers.mjs
node scripts/repair-alias-layers.mjs                           # idempotent; restores alias invariant
npm run check
```

**Upload note:** for bulk uploads use the S3-endpoint path, not the REST API path — the
REST path is rate-limited to roughly 1.4 objects/second. Source `.env.local` for the R2
keys first.

**Use `--limit 5` and repeat.** Do not run the whole batch in one pass: these are 29–43 MB
sources producing multi-megabyte pyramids, and a partial failure is much easier to reason
about in batches of five.

**Verify after each batch:**
- deployed tile `Last-Modified` is today and size is in the new-generation band
  (Leinster ≈ 5.3 MB, Munster ≈ 7.2 MB, Connacht ≈ 4.65 MB, Ulster ≈ 2.5 MB)
- `node scripts/repair-alias-layers.mjs --check` → `0 out of sync`
- `npm run check` → exit 0

**Rollback:** the previous pyramids remain in R2 under their existing keys until
overwritten; keep the pre-run CDN manifest so a bad batch can be re-pointed. Metadata
changes are a single commit and revertible.

### P1-4 · Apply the notes as metadata

Write the parsed spec into the catalogue: name, date, provider ("Phelim Birch, Paddy
Matthews" — currently several of these records credit only "Phelim Birch"), the editorial
note, and the source citations. Set the label attribute to `ENGLISH` per the notes.

**Verify:** spot-check three records in the live sources panel and confirm the citation
list matches the `.txt`.

---

## Phase 2 · Local Authorities 1930 onward

**Impact: high — this is complaint 2, and it is the cleanest fix in the plan.**
**Difficulty: low. Risk: Low.**

Thirteen files, no blockers, no notes needed (the existing records already carry names and
dates): **1930, 1931, 1941, 1942, 1944, 1950, 1953, 1955, 1957, 1965, 1966, 1977, 1980.**

Same sequence as P1-2 → P1-3. Smaller sources (≈2.8 MB each), so a single
`--execute --limit 13` pass is acceptable.

**Verify:** all 13 deployed tiles carry today's `Last-Modified`; the series shows one
generation from 1915 to 1980 rather than the current 1915–1927 / 1930-onward split.

**Why do this before Phase 3:** it is the complaint with the least ambiguity, it needs no
answer from Phelim, and it demonstrably closes one of his three points.

---

## Phase 3 · The remaining series — HELD pending B-2

**Impact: medium-high. Difficulty: medium. Risk: Low.**

41 files, none blocked technically, all blocked on knowing where they go:

- **Townlands** — 26 county files (`Townlands_Carlow` … `Townlands_Wicklow`). Likely the
  "all-Ireland section". County-level granularity the catalogue does not currently have.
- **CSO EDs** — 8 files (2006 and 2022 × 4 provinces). The deployed 2006 tiles are from
  29 May, so these are updates.
- **Counties & Provinces** — 5 files (1915, 1922, 1927, 1955, 1957 Counties).
- **Dáil Constituencies** — 1 file (1959).
- **root** — `Dublin_Electoral_Counties_1985`.

Do not ingest these until B-2 is answered. Ingesting 26 Townlands files into the wrong
card is worse than leaving them, because it is harder to undo than to do.

---

## Phase 4 · Correct the composition errors

**Impact: high — this is a correctness defect, not a freshness one. Difficulty: low.**
**Risk: Low. No longer blocked.**

**Phelim's B-1 answer strengthens this finding.** He confirmed the Ulster series genuinely
changes in 1963 ("mixed it up w the Ulster change") — so serving 1963 Ulster geometry on a
1941 map is a substantive error, not a labelling quirk. Ten composites are affected:

> **1941, 1942, 1943, 1944, 1946, 1950, 1953, 1954, 1955, 1957** — each aliases
> `eds-ulster-1986`, which holds `DEDs_Ulster_1963` bytes, while its note specifies
> `DEDs_Ulster_1921` and its own description claims "Ulster (= 1921 boundaries)".

Comparing his 1957 spec against what is currently live:

| Province | Note specifies | Live serves |
|---|---|---|
| Leinster | `Wards_DEDs_Leinster_1957` | stale 8-Jul tile, 2.45 MB against a 29.5 MB source |
| Munster | `Wards_DEDs_Munster_1957` | correct |
| Connacht | `DEDs_Connacht_1957` | `eds-connacht-1919`, an old-generation tile |
| Ulster | **`DEDs_Ulster_1921`** | **`eds-ulster-1986`, which holds `DEDs_Ulster_1963` bytes** |

`DEDs_Ulster_1921.fgb` (14,237,160 B) was never ingested; every Ulster file in the cache
is `DEDs_Ulster_1963` (14,236,936 B). So the 1941–1957 composites are built on the wrong
Ulster geometry, and the layer description asserting "Ulster (= 1921 boundaries)" is
**currently false**.

Fix: ingest `DEDs_Ulster_1921` and `DEDs_Connacht_1919` (both outstanding), then re-point
the 1941–1957 alias targets to match the notes, then re-run `repair-alias-layers.mjs`.

**Do not "fix" the aliasing itself.** Alias reuse is deliberate deduplication —
`scripts/repair-alias-layers.mjs` documents it: *"Where a boundary set did not change
between two years, the later year does not get its own PMTiles archive — it points at the
earlier year's. That is deliberate deduplication, not an error, and 149 layers rely on
it."* All 56 `eds-roi` aliases disclose their province/year provenance in their
description, and the invariant is currently clean. The defect is that some aliases point
at the wrong target, not that aliases exist.

**Verify:** the 1941 record's description ("assembled from Connacht (= 1919 boundaries),
Leinster 1941, Munster (= 1921 boundaries), Ulster (= 1921 boundaries)") becomes true of
the tiles actually served. Check by feature count or a geometry spot-check, not by size
alone.

---

## Phase 5 · Stop this recurring

**Impact: high — this is what failed. Difficulty: low. Risk: None.**

Nothing detected that a 95-file delivery had been 21%-ingested, and nothing detected that
one series was split across two source generations. Both are cheap to check.

### P5-1 · Delivery reconciliation check

`scripts/validate-intake-delivery.mjs`: read `data/intake/*.json` (from P0-3), and for
each delivered file that is not marked `alreadyOnSite`, assert it is either present in the
source cache or listed in a documented `deferred` set with a reason. Fail otherwise.

This alone would have caught all three complaints on 31 July.

### P5-2 · Source-generation consistency check

`scripts/validate-source-generation.mjs`: group deployed layers by series (`eds-leinster-*`,
`roi-local-authorities-*`, …) and fail when members span materially different generations
— cluster on deployed `Last-Modified` and archive size, which is precisely the signal that
identified the ten stale ED layers and the Local Authorities cut-off.

### P5-3 · Note-to-metadata drift check

Assert that where a build-spec note exists, the live record's provider, date, composition
and citation list match it. This is what would have caught the Ulster 1921/1963 mismatch.

Wire all three into `npm run check`.

---

## Sequencing

```
P0-1 … P0-4                 preserve, extract, manifest, confirm currency
   ↓
Phase 2     Local Authorities 1930-1980       ← ship first: 13 files, no ambiguity
Phase 1     all 22 ED composites              ← B-1 resolved
Phase 4     Ulster 1921 / Connacht correction ← B-1 resolved
   ↓
Phase 3     Townlands / CSO / Counties / Dáil ← STILL needs B-2
   ↓
Phase 5     the three validators              ← any time; before the next delivery
```

Only **B-2** now gates anything, and it gates Phase 3 alone. Phase 2 goes first
deliberately: 13 files, no notes needed, no open questions, and it closes one of his three
complaints on its own.

---

## What to tell Phelim now

He is right on all three counts, and the cause is on our side: his 26 July delivery was
only partly ingested. Specifically —

- The ten ED/ward layers he flagged (Leinster 1957/1971/1977, Munster
  1955/1965/1966/1970/1971/1980/1983) all have new source files in his delivery that were
  never processed.
- Local Authorities: the ingest stopped after 1927; the 13 files from 1930 to 1980 are
  untouched. That is why 1930 and 1931 look wrong to him.
- The Townlands, CSO ED, Counties and Dáil files were not ingested at all.
- His notes are exactly what is needed and will be used as the metadata source rather
  than transcribed by hand.

**B-1 is answered** — `DEDs_Connacht_1963` is the 1957 file, filename transposed from the
Ulster series. One question left: **B-2**, the card hierarchy and what "all-Ireland
section" means.

Worth telling him too: his notes let us find a real error he had not reported. Ten
composites from 1941 to 1957 are serving post-1963 Ulster boundaries where his specs say
1921 — Phase 4 fixes that, and it was only findable because he wrote the composition down.

---

## Appendix · Outstanding file list

**EDs (21)** — `DEDs_Connacht_1919`, `DEDs_Ulster_1921`, `EDs_Leinster_1997`,
`EDs_Munster_2019`, `Wards_DEDs_Connacht_1986`, `Wards_DEDs_Leinster_1946`,
`Wards_DEDs_Leinster_1953`, `Wards_DEDs_Leinster_1954`, `Wards_DEDs_Leinster_1971`,
`Wards_DEDs_Leinster_1977`, `Wards_DEDs_Leinster_1986`, `Wards_DEDs_Leinster_1994`,
`Wards_DEDs_Munster_1944`, `Wards_DEDs_Munster_1950`, `Wards_DEDs_Munster_1955`,
`Wards_DEDs_Munster_1965`, `Wards_DEDs_Munster_1966`, `Wards_DEDs_Munster_1970`,
`Wards_DEDs_Munster_1971`, `Wards_DEDs_Munster_1980`, `Wards_DEDs_Munster_1983`

**Local Authorities (13)** — `1930`, `1931`, `1941`, `1942`, `1944`, `1950`, `1953`,
`1955`, `1957`, `1965`, `1966`, `1977`, `1980`

**Townlands (26)** — Carlow, Cavan, Clare, Cork, Donegal, Dublin, Galway, Kerry, Kildare,
Kilkenny, Laois, Leitrim, Limerick, Longford, Louth, Mayo, Meath, Monaghan, Offaly,
Roscommon, Sligo, Tipperary, Waterford, Westmeath, Wexford, Wicklow

**CSO EDs (8)** — `2006_CSO_EDs_{Connacht,Leinster,Munster,Ulster}`,
`2022_CSO_EDs_{Connacht,Leinster,Munster,Ulster}`

**Counties & Provinces (5)** — `1915 Counties`, `1922 Counties`, `1927 Counties`,
`1955 Counties`, `1957 Counties`

**Dáil Constituencies (1)** — `1959`

**Root (1)** — `Dublin_Electoral_Counties_1985`

---

## Method note

Findings rest on: byte-size and sha256 matching between zip entries and the source cache;
HTTP `Last-Modified` and `Content-Length` on deployed R2 archives; parsing all 22 build-spec
notes and resolving every referenced filename against the delivery; and
`repair-alias-layers.mjs --check`. Where identity is claimed between a zip entry and a
cached file it is by exact byte size, corroborated by sha256 on the intra-cache duplicates.
Geometry content was not compared — Phase 4's verification should do that.
