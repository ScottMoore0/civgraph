# Catalogue taxonomy — derivation pipeline

Derives a three-level structure for the map catalogue — **shelf → subject → entry → map** —
from `data/database/maps.json` and `src/ui-controller.js`, without changing either.

Nothing here writes to the site. Output is JSON plus three self-contained review pages, all
under `build/catalogue-prototype/` (gitignored).

## Why this exists

The catalogue's browsing structure was hand-listed: 128 cards named in `c1Cards`, grouped by
display-name string into 15 sections. That left 171 maps in per-category catch-alls (`Boundaries`
63, `Points of Interest` 34) and 110 more filed under the name of the council that published
them, so a third of the catalogue had no subject recorded anywhere.

These scripts assign one instead, and derive the levels above it from the result rather than
guessing them. Every step asserts its own totals, because the two errors that actually happened
during this work — a merge silently replacing a family of nine, and a subject ending up with two
kinds — were both invisible without a check.

## Run order

```
node scripts/catalogue-taxonomy/nosubject.mjs  build/catalogue-prototype/nosubject.json
node scripts/catalogue-taxonomy/assign.mjs     build/catalogue-prototype/nosubject.json  build/catalogue-prototype/subjects-a.json
node scripts/catalogue-taxonomy/remaining.mjs  build/catalogue-prototype/remaining.json
node scripts/catalogue-taxonomy/assign2.mjs    build/catalogue-prototype/remaining.json  build/catalogue-prototype/subjects-b.json
node scripts/catalogue-taxonomy/merge.mjs      build/catalogue-prototype/subjects-a.json build/catalogue-prototype/subjects-b.json build/catalogue-prototype/subjects.json
node scripts/catalogue-taxonomy/entries.mjs    build/catalogue-prototype/subjects.json   build/catalogue-prototype/entries.json
node scripts/catalogue-taxonomy/shelves.mjs    build/catalogue-prototype/entries.json    build/catalogue-prototype/shelves.json
node scripts/catalogue-taxonomy/stubs.mjs      build/catalogue-prototype/subjects-unrenderable.json
```

Then the review pages:

```
node scripts/catalogue-taxonomy/buildreview.mjs   build/catalogue-prototype/subjects.json build/catalogue-prototype/subjects-review.html
node scripts/catalogue-taxonomy/buildentries.mjs  build/catalogue-prototype/entries.json  build/catalogue-prototype/entries-review.html
node scripts/catalogue-taxonomy/buildshelves.mjs  build/catalogue-prototype/shelves.json  build/catalogue-prototype/entries.json build/catalogue-prototype/structure-review.html
```

Scripts must be run from the repository root.

## What each script does

| script | role |
|---|---|
| `nosubject.mjs` | isolates the 283 renderable maps with no subject — those in a per-category catch-all, and those under a publisher-named card |
| `assign.mjs` | assigns a subject to those 283, by ordered name rules plus explicit corrections |
| `remaining.mjs` | lists the 475 maps that already sit in a hand-authored card, with their card |
| `assign2.mjs` | assigns a subject to those 475, per map with the card only as context — several curated cards are grab-bags too |
| `merge.mjs` | joins both passes into one table, reconciles where they drifted, and makes `kind` a property of the subject |
| `entries.mjs` | groups maps into entries: same stem after stripping years, dates and bracketed publishers; then lone maps sharing a prefix; then named singular/plural pairs |
| `shelves.mjs` | groups the subjects onto shelves; fails if a subject sits on two shelves or none |
| `stubs.mjs` | assigns a subject to the 273 rows that cannot draw anything yet (155 stubs, 118 hidden), by category rather than by name |
| `build*.mjs` | render the three review pages |

## Two rules the assignments depend on

**Thematic before physical.** Physical-geography words appear as qualifiers inside thematic
names: "Coastal Flood Extents" is flooding, "Coastal Habitat Networks" is habitat, and "Karst
Data (Ireland — all-island)" is geology. Every thematic rule is tested before the physical block,
and reordering these two blocks moves about twenty maps.

**Districts are geography, the rest is the event.** Polling *districts* are electoral boundaries;
polling *stations* and results are datasets about an election. The same split governs
constituencies against results.

## Known limits

- `kind` (Boundary / Dataset) is a property of the subject. Moving a subject between the two
  lists changes every map under it, which is intended.
- Four maps could not be classified from their names and were resolved from their
  data.gov.ie records: `Boundaries` and `Locations` are both a 2017 Roscommon/Longford
  wetlands survey, `Fossit 3 - Town` is Fossitt habitat classification, and `GZT Current Plan`
  is generalised zoning types.
- Two pairs of maps share a display name in `maps.json` and nearly merged wrongly:
  `Settlements 2015` (`settlements-2015` and `roi-settlements-ungeneralised`) and
  `03 May 1921` (`admin-areas-1921-05-03` and `eds-roi-1921-05-03`).
- Entry names are derived stems and have not all been reviewed for readability.
