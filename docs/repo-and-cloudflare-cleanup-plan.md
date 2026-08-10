# Repo and Cloudflare cleanup — findings and plan

Written 2026-08-10. Supersedes nothing; this is the first written record of work
that had until now existed only in conversation.

The goal is to make the repository and its Cloudflare deployment legible enough
that an outside developer can understand the project and contribute to it. This
document records what was found, what was changed, and what remains — with the
reasoning, because the reasoning is what evaporates.

---

## 1. The finding that matters most: there are two catalogues

`data/database/maps.json` is the Leaflet-era catalogue. `test/metadata/maps-test-index.json`
is the MapLibre catalogue, and it is the one the live site reads —
`app/src/app.js:190` fetches it directly.

**During this work, three separate "broken layer" diagnoses turned out to be
readings of the dead catalogue:**

| Diagnosed as broken | Reality |
|---|---|
| 24 DoBIH hill layers, `.fgb` all 404 | MapLibre PMTiles for all 24 already published and serving |
| Townlands NI and RoI variants, `.fgb` 404 | live site uses 41 county-sharded PMTiles, all serving |
| "MapLibre tiles were never generated" | tested `tilesFallback`, not `tileUrl`; the real tiles exist |

Each cost significant time. Any contributor would hit the same trap, because
nothing in the repo says which catalogue is authoritative.

**This belongs above every cosmetic item on the list.** Options: retire
`maps.json` entirely, or make its status explicit and machine-enforced so a stale
entry cannot masquerade as a live one.

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

---

## 3. Outstanding

### Blocking everything contributor-facing

**No licence.** No `LICENSE` file, no `license` field in `package.json`. Default
copyright applies, so nobody may legally fork or contribute. Every other
contributor-facing item is downstream of this. Recommendation on file: MIT for
code, CC BY 4.0 for Civgraph's own data contributions with per-source terms
passed through (the repo already records these — `maps.json` alone carries 482
"CC BY" and 42 "Open Government Licence" references). Decision is yours.

**Cloudflare configuration is not in the repository.** No `wrangler.toml`, no
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

- **Parity: 5 referenced objects absent from R2.** Two are the townlands NI/RoI
  entries in the dead catalogue — stale, not broken. Three are unknown:
  `Wards_2012_FullRes.fgb`, `Wards_DEDs_Leinster_1931.fgb`, `_1936.fgb`. Worth
  checking whether an existing scrape or IA item covers them before assuming
  they were never produced — that assumption was wrong for DoBIH.
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
