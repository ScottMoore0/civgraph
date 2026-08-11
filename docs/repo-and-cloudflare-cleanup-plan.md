# Repo and Cloudflare cleanup — findings and plan

Written 2026-08-10. Supersedes nothing; this is the first written record of work
that had until now existed only in conversation.

The goal is to make the repository and its Cloudflare deployment legible enough
that an outside developer can understand the project and contribute to it. This
document records what was found, what was changed, and what remains — with the
reasoning, because the reasoning is what evaporates.

---

## 1. The finding that matters most: the catalogue is three stores, not one

**Corrected 2026-08-10.** An earlier draft of this section called `maps.json`
"the Leaflet-era catalogue" and said the live site reads
`maps-test-index.json` instead. That is wrong, and it is worth recording as
wrong, because it is the same mistake it was written to warn about. Production
serves `data/database/maps.json` at HTTP 200 and the shipped bundle fetches it —
`app/build/chunks/app-DO3PRBQ5.js` contains the path. Nothing here is dead.

The catalogue is **one logical record split across three stores**, joined by
string id:

| Store | Size | Owns | Loaded by |
|---|---|---|---|
| `data/database/maps.json` | 1,039 entries, 1.4 MB | provenance and presentation | `dataService` |
| `test/metadata/maps-test-index.json` | 1,146 layers, 4.2 MB | rendering | `TestMetadataService` |
| `c1Cards` in `src/ui-controller.js:3491` | 129 hand-written cards | navigation | compiled into the bundle |

Field ownership barely overlaps, which is why no store is redundant:

- **only `maps.json`** — `licence`, `licenseUrl`, `attribution`, `sourceCredits`,
  `sourceDownloads`, `downloads`, `references`, `featureCount`, `featured`,
  `hidden`, `placeholder`, `isGroup`/`members`, `files`
- **only the live index** — `tileUrl`, `tiles`, `tilesFallback`, `promoteId`,
  `minzoom`/`maxzoom`, `sourceLayer`, `renderer`, `geometryType`,
  `featureIndexUrl`, `detailUrl`, `loadable`, `status`, `aliasOf`
- **shared, and therefore able to drift** — 17 fields: `id`, `name`,
  `description`, `category`, `provider`, `bounds`, `style`, `variants`,
  `keywords`, `labelProperty`, `idProperty`, `cloneOf`, `parentId`, dates

The join is a bare string id plus a `-vector-test` suffix convention, enforced
nowhere: **757 ids join, 282 are catalogue-only, 389 are live-only** (157 alias,
90 variant, 60 pmtiles, 50 image, 23 raster, 9 3D).

**Why this trap is expensive.** Four "broken layer" diagnoses during this work
were really the wrong store being read:

| Diagnosed as broken | Reality |
|---|---|
| 24 DoBIH hill layers, `.fgb` all 404 | PMTiles for all 24 already published and serving |
| Townlands NI and RoI variants, `.fgb` 404 | 41 county-sharded PMTiles, all serving |
| "MapLibre tiles were never generated" | tested `tilesFallback`, not `tileUrl` |
| `Wards_2012_FullRes` / Leinster 1931–36 missing | superseded names; live PMTiles serve |

`validate-c1-coverage.mjs` already guards the store-2 → store-3 edge, and its
header records what that gap cost: four days lost on the 1941–43 and 1985 Ward
composites, which were correctly categorised, tiled, indexed and served, and
invisible because no card listed them.

**Store-1 → store-2 is now guarded too** —
`validate-catalogue-render-parity.mjs`, added 2026-08-11 and wired into
`npm run check`. See §2 for what it found.

---

## 2. Completed

### Production bugs found and fixed

Both had the identical shape — a file present in the repo, absent from the store
production actually reads, and a request that looked healthy from outside.

- **FlatGeobuf runtime** (`ffedc79151`). `app/src/app.js` loaded
  `/app/js/libs/flatgeobuf-geojson.min.js` before parsing any FGB layer, but
  `copyAnimationRuntimeAssets()` had never been told to copy it. Pages answered
  with its SPA fallback: `index.html` at HTTP 200, which `nosniff` then blocked
  from executing. **Every FGB layer load was failing** while the URL looked fine
  to any status-code check. Found only because a cache-busting query bypassed the
  fallback and returned the honest 404.

- **Catholic Dioceses chunks** (`598649b589`). 18 tracked `data/maps` files did
  not exist on R2 at all, including `Catholic_Dioceses.fgb.part001-003`. The
  Pages Function intercepts `data/maps/*` and reads R2, so those paths 404'd
  while the repo copy sat unused. The layer is registered in `maps.json` and
  referenced by the live bundle.

### Structural work

- **Leaflet stack archived, `js/` → `src/`** (`fb5d246cad`, `59c9fc1fa1`). The
  stack had stopped working everywhere: `js/colour-palettes.js` imported JSON
  with no import attribute, which modern browsers reject, so the module graph
  failed to instantiate whenever served unbundled — which is how it was served
  and how the tests loaded it. All 8 tests across 7 specs were already failing.
  Archiving cost nothing.
- **`data/maps` untracked** (`598649b589`). Production serves it from R2; proven
  by fetching a file present in both places, where production returned the
  4,300,570-byte R2 copy over the repo's 3,422,232. Tracked tree 5.68 → 5.53 GB.
- **DoBIH** (`fe1cea35d8`, `c68546517f`). FGB render references removed per the
  decision that FGB is a download format and only MapLibre renders. 288
  `sourceDownloads` entries now mirror to the IA item that already existed and
  was unlinked; all 12 distinct mirror URLs verified against their recorded byte
  counts.

### Guards added

- **`validate-asset-references.mjs`** — every `src`/`href`/`loadClassicScript()`
  path must exist after build. Negative-tested against the FlatGeobuf bug.
- **`validate-r2-serving-parity.mjs`** — everything referenced under an
  R2-served prefix must exist in the bucket. Served prefixes are discovered from
  `functions/`, not hardcoded. Found 36 gaps where a manual git-tracked
  comparison found 18, because 29 of them exist nowhere at all. Parity is now
  36 → 5.
- Two `check:root` assertions **inverted** so the MapLibre promotion is
  irreversible rather than merely current.
- **`validate-catalogue-render-parity.mjs`** — the catalogue record and the
  render record must agree about the same layer. Negative-tested: a tampered
  `name` and a tampered `provider` on a joined layer both fail the build.

  Most of the apparent disagreement is not disagreement. Comparing raw values
  reports ~750 of 757 joined records as mismatched, because the render record is
  derived with systematic transforms — `keywords` gains generated terms,
  `category` is resolved from a slug to a display label through the `categories`
  table both documents carry, `style` gains `fillColor`/`fillOpacity`. Those are
  normalised away so real defects are visible instead of buried.

  Getting that normalisation right mattered more than it sounds. An initial pass
  treated `keywords` as a benign superset on the strength of two sampled
  records; checking all 757 showed **166 layers where the render record dropped
  catalogue keywords**, and in 6 cases replaced the year outright —
  `eds-connacht-1919` is tagged 1970, `roi-local-authorities-2024` is tagged
  2019. On a site whose central feature is a time slider, those layers are
  unfindable by their own year and surface under someone else's. The same pass
  wrongly proposed failing on `bounds`; the 61 differences are catalogue
  hand-entered island-wide approximations (`[[51.4,-10.75],[55.5,-5.4]]` recurs
  verbatim across unrelated layers) against render values computed from
  geometry, so failing would have asserted the wrong direction of authority.
  `bounds` is advisory for that reason.

  **398 findings baselined** (ratchet: may shrink, never grow) — 1 attribution,
  29 content, 263 identity, 105 advisory. Attribution findings print on every
  run even when baselined, because `deds-ni-1926` credits OSI/OSM in the render
  record and OSNI/PRONI in the catalogue, and `NOTICE` makes the catalogue
  authoritative for attribution. `labelProperty` is advisory rather than
  blocking: PMTiles conversion renames attributes, so a catalogue `NAME_TAG`
  against a render `Name` may mean the catalogue is stale, and deciding needs
  the real tile attributes rather than an assumption.

---

## 3. Outstanding

### Blocking everything contributor-facing

~~**No licence.**~~ **Resolved 2026-08-10: MIT.** `LICENSE` holds the canonical
MIT text (unmodified, so GitHub's detector recognises it), `package.json`
declares `"license": "MIT"` alongside the identity fields it had been missing
entirely, and `README.md` carries a Licence section.

The one subtlety worth preserving: **MIT covers the code, not the data.** The
repository tracks 13,509 files under `data/`, including ~1.2 GB of census
material and 365 MB of scanned books obtained under the Open Government Licence
and Creative Commons Attribution — the catalogue records several hundred CC BY
and several dozen OGL references. Those are attribution licences whose terms
travel with the data and cannot be replaced by the MIT grant, so `NOTICE` states
the scope explicitly and points at `maps.json`/`sources.json` as authoritative
per-layer. Keeping the scope note out of `LICENSE` itself is deliberate: editing
the MIT text would break automated licence detection.

**Cloudflare configuration is not in the repository.** (Inventoried in
`cloudflare-inventory.md` — every binding verified against production — but that
documents the state rather than version-controlling it.) No `wrangler.toml`, no
`_routes.json`, no deploy workflow. The Pages project, its build command and
every binding live only in the dashboard. A contributor cannot see that
`PRONI_DB` is D1, what schema it expects, which R2 bucket
`functions/data/maps/[[path]].js` reads, or how the site deploys. This is a
larger barrier than any directory name.

### Repo structure

- **`data/` is 5.02 GB of the repo.** The R2 proxy pattern is proven and
  `upload-tree-r2.mjs` is verified on 50,824 files. Three groups:
  - never deployed, no proxy needed — `census` (330 MB), `books` (365 MB),
    `timeline-transitions` (153 MB). Safest, ~848 MB.
  - needs a proxy Function first — `graph` (2 GB), `timeline-transition-overlays`
    (852 MB), `browse` (356 MB), `documents` (167 MB).
  - **do not touch** — `data/database`; `maps.json` and `sources.json` are live
    build and runtime inputs.
- **`test` / `test2` / `tests`.** `test/` holds 2,066 metadata files plus
  `test/src`; `tests/` is the Playwright suite; `test2/` is a compatibility
  redirect. A newcomer will guess wrong.
- **Tracked build artifacts.** `app/build/` is committed, so `src` edits need
  rebuild-and-commit. A Pages build step would fix it but changes the deploy
  model.
- **`.git` is 5.87 GB.** Untracking going forward will not shrink history; that
  needs another `filter-repo`, which invalidates every clone.
- **`src/` orphans** — `fgb-worker.js`, `sql.js-httpvfs/*`, `libs/pako.min.js`
  have no static importer. Needs a *runtime* check: static analysis is exactly
  what wrongly cleared the Leaflet files and the `js/` directory.

### Data integrity

- ~~**Parity: 5 referenced objects absent from R2.**~~ **Resolved 2026-08-10 —
  parity is 0**, from 36 when the validator was written. All five were stale
  paths in `maps.json` for layers that render correctly today, and the
  instinct to check before assuming was right again: every one had a live
  MapLibre equivalent already published and serving.

  | `maps.json` claimed (404) | What actually exists |
  |---|---|
  | `Wards_2012_FullRes.fgb` | `wards-2012-full-vector-test.pmtiles`, plus `Wards_2012-lod0/-lod1.fgb` |
  | `Wards_DEDs_Leinster_1931.fgb` | `eds-leinster-1931-vector-test.pmtiles` |
  | `Wards_DEDs_Leinster_1936.fgb` | `eds-leinster-1936-vector-test.pmtiles` |
  | `OSNI_Townlands.fgb` | 41 county-sharded PMTiles; `osni-open-data-50k-boundaries-townlands.fgb` |
  | `OSI_Townlands.fgb` | the same county shards (2,697 objects under `townlands/`) |

  Two supersessions caused all five: LOD variants replaced the monolithic
  "FullRes" file, and a reorganisation moved the ED and townlands data to
  `<year>_CSO_EDs_<province>` and per-county naming. The dead `files.fgb` keys
  were removed — matching the DoBIH precedent, which drops the `files` key
  rather than leaving an empty object. No data was missing and nothing needed
  regenerating.
- **`roi-local-authorities-2024` has an unresolved vintage.** Its id and its
  catalogue keyword say 2024; its catalogue `name` ("Local Authorities 2019")
  and `date` (`2019`) say 2019, and the render record agrees with those. All 27
  sibling `roi-local-authorities-<year>` layers have id-year matching name-year,
  so this one is the outlier. It was deliberately left alone when the other five
  wrong-year layers were corrected, because the evidence points both ways and
  editing either side could make it wrong: the fix depends on which vintage the
  OSi source at `ed592af6f0444bf1b0becdb5925f9477` actually is. Note that four
  ED records already carry explicit "Vintage note: the id says X but this record
  serves Y" descriptions, so an id that disagrees with its content is a known,
  documented pattern here rather than necessarily a defect — this may need the
  same note rather than a changed year.
- **No browser coverage** for timeline races, share-URL restoration or slider
  behaviour. The 7 archived specs never provided it (they were red), but the gap
  is real. `window.__civgraphTest2` exposes `app`, `mapController` and
  `metadataService` — but not the time-slider, so that surface needs extending.

---

## 4. Recurring lesson

Seven times during this work, a success signal was wrong:

- `ia upload` exited 0 with the object absent from the item
- a green 16-step check suite passed over a commit whose index was broken
  (`git add` aborts silently when any pathspec matches nothing)
- a missing asset returned HTTP 200 serving `index.html`
- a stale edge cache served a deleted object for 8 days
- two jobs reported "DONE" having done nothing (a mangled `ArgumentList`, an
  em-dash breaking a PowerShell string)
- substring matches produced three false "this is dead" conclusions
  (`js/web-vitals-4.iife.js` inside `assets/js/...`; `js/stages2.js` inside
  `election-viewer-package/js/...`)

**Verify against the thing itself, not against a report of it.** Both validators
added here follow that rule: they ask the filesystem and the bucket what is
actually there, rather than asking whether a process claimed success.
