# rf-pipeline (refactor stream 4): landing notes

Branch `rf-pipeline`, worktree `C:\Users\scomo\civgraph-rf-pipeline`.
**Based on `rf-records` (e9d48ae1ff), not on main directly**: the coordinator asked this stream to
build on rf-records' shared `scripts/lib/state-machine.mjs` and `layerIdForm`. Main had not moved
(95cec4d53c) when this was written. Land rf-records first, then rebase this branch on main; its own
dependency commits (typescript, @types/node) were dropped as already upstream.

## Commits (oldest first)

1. f7ffc9f6de CDN upload manifest keeps each archive's existing R2 key (`scripts/publish/pmtiles-keys.mjs`). Fixes the 934-key rewrite.
2. 62b6fbff99 One R2 credential loader (`scripts/publish/r2-env.mjs`) for every S3 publish script; `r2-upload-manifest` no longer needs `--env-file`.
3. 0b56e87aad Layer lifecycle machine; the CDN switch is a guarded `verified -> serving` (range check must be of the URL it will serve).
4. 19c636d868 `layers.mjs` run is a stage machine (`layer-publish-run.mjs`); `tsconfig.pipeline.json` + `check:types:pipeline`.
5. 50e23e3ed8 Config adoption: origins and research User-Agent from `scripts/lib/config.mjs` in 20 files; ratchet test.
6. 1846113ae6 Switch guard also compares local archive size with the CDN's Content-Range total.
7. c72ad6cf26 `layers.mjs` resume marker (`tmp/layer-publish-run.json`).
8. 85673510b2 NI grouped round status machine; unknown intake work status warned.
9. 3b60cad4bc Translation file status machine; `reviewed` reachable via `META.<lang>.reviewedBy`.
10. 57c69f6bae Machines moved onto the shared `scripts/lib/state-machine.mjs`; guards via `scripts/publish/transition-check.mjs`; `check:types:pipeline` uses `scripts/lib/typecheck.mjs` and joins the `check` chain.
11. e3a7dee773 R2 key migration machine (`key-migration.mjs`); r2-copy-keys validates pair shape, records states in its receipt.
12. 20e0bf19b0 Publish stages machine (`publish-run.mjs`) driven by `publish.sh`; aborted runs logged; warning after an unsettled run.
13. 83e68fabe8 Light items: perf mode toggle, closed status lists, `colourOutcome`, `isUnopposedContest`.
14. 162da372ba Type check widened to scripts/i18n, maps, dev (37 files).

State-machine catalogue coverage: PL-01, PL-02, PL-03, PL-04, PL-05 (full) and PL-L (all six light items).

## Landing steps

1. Land `rf-records` first. Then `git rebase main` on this branch. Expected conflicts: only the
   shared files below (package.json scripts and `check` chain, CHECKS.md types row). Keep both sides.
2. Regenerations: **none**. No generated file is committed. Regenerating
   `render/metadata/cdn-upload-manifest.json` is now safe (it reproduces all 934 committed keys).
3. Migrations: none. R2 uploads: none. D1: none.
4. Run `npm run check:fast` (with the records and app builds present) and `npm run check:types:pipeline`.
5. **Owner decision (R2 upload, needs approval; nothing was uploaded):** the switch now refuses
   three layers whose local archives were rebuilt and never uploaded. See "The three stale admin-areas
   layers" below. They keep serving the CDN copy as they do now. To publish the rebuilds after approval:
   `node scripts/publish/layers.mjs --ids admin-areas-1921-05-03-vector,admin-areas-1924-06-01-vector,admin-areas-1928-01-23-vector --no-build`.
6. Behaviour notes for the owner:
   - The S3 publish scripts (including `npm run sync:thumbnails` and `npm run check:r2-parity`) now
     load `.env.local` from the repository root themselves; a set environment still wins.
     `check:r2-parity` (part of `npm run verify`, not `check`) therefore runs instead of skipping
     when `.env.local` exists.
   - `publish.sh` writes `.claude/publish/work/publish-run.json` and logs aborted runs to
     `publish.log` (`aborted:<stage>`). Commands and order are unchanged; the wrapper is untouched.

## The three stale admin-areas layers

Checked 7 Nov 2026 by reading main's local archives and making HEAD and Range requests to the public CDN. Nothing was uploaded.

| Layer id | Local archive (main checkout) | R2 object the live tileUrl serves |
|---|---|---|
| `admin-areas-1921-05-03-vector` | 897,157 B, md5 `b553085b4ed57cb4ba9932b73afa20b1`, built 2026-10-31 01:59, 44 features | 812,914 B, ETag `2fc5efaab3c5a3faa167ae9ac09c760c`, Last-Modified 2026-08-16 19:54:57 GMT, 38 features |
| `admin-areas-1924-06-01-vector` | 903,394 B, md5 `b68a975d3af179ff62eec653c3c4265c`, built 2026-10-31 01:59, 45 features | 812,929 B, ETag `88af35e01ef286092ccf72ffd055383f`, Last-Modified 2026-08-16 19:54:57 GMT, 38 features |
| `admin-areas-1928-01-23-vector` | 903,571 B, md5 `4dc19d542b5d496fdbc91a9f187a7798`, built 2026-10-31 01:59, 45 features | 812,905 B, ETag `9770464ae1cd16b3e307e782f9badf6d`, Last-Modified 2026-08-16 19:54:57 GMT, 38 features |

Paths: the local archives are at `render/pmtiles/generated/<id>-test.pmtiles`. The tileUrls are
`https://data.civgraph.net/data/maps/test/pmtiles/generated/<id>-test.pmtiles`. Feature counts
come from each archive's PMTiles tilestats. The R2 ETags are single-part MD5s, so they compare
directly with the local md5s.

- **Rebuilt by** 5b726d458e (2026-10-31 02:21, "Northern Ireland boundary history and Stormont
  results from public sources: Armagh, Keady, Lurgan, Bangor, Larne and Newtownabbey drawn through
  the dated council editions 1921-1969 ..."). That commit turned these three editions from alias
  layers into vector layers of their own and set `builtAt` 2026-10-31T01:59:49Z. Their layer
  details added Armagh Rural District, Armagh Urban District, Keady Urban District and Lurgan
  Urban District.
- **Switched without an upload** by 265f38c88a (2026-10-31 17:32). The range check
  (`byteRangeVerifiedAt` 2026-10-31T17:11:52Z) passed on the August object, which the old switch
  accepted because it did not compare sizes. The batch's later upload, a6609f75ee (1 Nov, 51 tile
  sets), did not include these three. `maps-test.json` records the local sizes as
  `tilePackage.bytes`, not the served ones.
- **Production serves a stale version**: the 16 Aug 2026 archives (38 features each). They predate
  the 31 Oct redraw, so they lack the 6 or 7 districts drawn that day. The catalogue metadata and
  layer details already describe the rebuilt 44 or 45 features. Uploading the local archives to the
  same keys corrects it (step 5).

## Tests run

- New unit tests (all in `tests/unit/`, so in `test:unit`): pmtiles-keys (6), r2-env (6),
  layer-lifecycle (7), layer-publish-run (6), pipeline-config-adoption (2), ni-local-round-status (3),
  translation-status (2), key-migration (5), publish-run (4). All pass; `test:unit` passes.
- Equivalence: regenerated manifest keys = committed (934/934); the CDN switch on today's reports
  writes byte-identical metadata to the old script except the three refused layers above; the
  layers.mjs command list is pinned by a test; the round-status machine equals the old derivation
  for every combination; `npm run check:i18n` up to date; `r2-copy-keys plan` (925 pairs) validates.
- `npm run check:types:pipeline`: OK, 37 files clean (2 notes in `scripts/lib/stable-generated-json.mjs`, rf-records' folder).
- `npm run check:fast` in the worktree: 58 steps ok; the 13 failures all read gitignored build
  output absent from a worktree (tmp/records, app/build), and fail the same way on the base.
- `npm run check:clean`: CHECKS OK, 71 steps (details at the end of this file).

## Files others may touch

- `package.json`: script `check:types:pipeline`, appended to the `check` chain after `check:types:records`.
- `CHECKS.md`: the Types row names `check:types:pipeline`.
- `tsconfig.pipeline.json` (new, root).
- `scripts/lib/*`: **not edited**; imports `config.mjs`, `state-machine.mjs`, `layer-renames.mjs`, `typecheck.mjs`.
- `tests/unit/*.test.mjs`: nine new files, none edited from other streams.

## Requests to other streams

- **rf-records (scripts/lib):**
  - Fold `scripts/publish/transition-check.mjs` (defineGuards, checkTransition: guards keyed
    `from->to` with a refusal reason) into `scripts/lib/state-machine.mjs`, then this stream's
    modules can import it from there.
  - `scripts/lib/stable-generated-json.mjs` lines 31 and 41: TS2538 (index typed `string | undefined`).
  - `scripts/lib/config.mjs` BUILD_VARS: add `R2_S3_ENDPOINT` (secret) and `R2_BUCKET`
    (default `boundaries-data`), which `scripts/publish/r2-env.mjs` reads; `R2_ACCOUNT_ID` is listed but no script reads it.
- **rf-functions / main session:** Node scripts that import `scripts/lib/config.mjs` print
  `MODULE_TYPELESS_PACKAGE_JSON` because `functions/_lib/config.js` is ESM with no package type.
  A `functions/_lib/package.json` with `{"type": "module"}` (or the equivalent) would silence it.
- **rf-ingest (scripts/intake):** the intake's second driver runs `switch-pmtiles-to-cdn.mjs`
  (IN-01); the switch now refuses a layer whose range check fetched another URL or another
  size, and prints why. Its `verifyCdn: false` path should not skip the range check, since without
  one the switch does nothing. `node --env-file=.env.local` in the intake commands still works
  but is no longer needed for the S3 scripts.
- **rf-registries:** `ROUND_WORK_STATUSES` in `scripts/build/build-ni-local-grouped.mjs`
  (done, partial, held, no-election) belongs in the round-status registry (RG-03).
- **Owner (optional):** three scripts keep their own User-Agents instead of
  `civgraph-research (+https://civgraph.net)`: build-external-source-indexes.mjs,
  render_cited_sources.mjs, dev-server.mjs (dev preview). Unify only if wanted.

## Follow-ups once rf-registries lands (not done here: this branch cannot import an unlanded branch besides rf-records)

rf-registries' LANDING.md asks this stream to adopt its registries in `scripts/build` and
`scripts/check`. One slice after it lands:
- `build-ni-local-grouped.mjs`: replace `groupedRoundStatus` (this branch's machine, same
  semantics) with `siteRoundStatus`, the missing reason with `missingRoundReason`, and move
  `ROUND_WORK_STATUSES` into the election-round registry entry; `AUTHORITY_STEM_ALIASES` with
  councils `formerStems`.
- `build-test2-election-manifest.mjs`: the six council sets and the `'applied'` filter (RG-05).
- `election-data-audit.mjs`: `VALID_CONTEST_STATUSES`; `COLOUR_STATUS_SPELLINGS` (added here) could
  join the registry as a spelling table.
- `browse-party-label-folds.json` move, the browser registry modules and the `site.mjs` decision
  are as rf-registries lists them.

## check:clean

`npm run check:clean` (clean export of commit 83e68fabe8, with CI's builds including the records
build, then the offline check chain): **CHECKS OK, 71 steps** (including `check:types:records`,
`check:types:pipeline`, `test:unit`, lint). The last commit, 162da372ba, only widened the type
check and added JSDoc; `npm run check:types:pipeline` passes on it (37 files).
