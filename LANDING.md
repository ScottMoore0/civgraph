# S4 mapapp: noImplicitAny review (landing notes)

Branch `nia-s4`, worktree `C:\Users\scomo\civgraph-nia-s4`, from main 7b87bd65c1. Stream S4 of the
owner-approved noImplicitAny review (8 Nov 2026). JSDoc only: no runtime line changed.

## What is done

Every file the map app's type check (`src/tsconfig.check.json`, `npm run check:types:mapapp`)
owns has a type on every parameter, plus `src/catalogue/search.js`, which now joins that check.
Measured with `noImplicitAny` forced on: 608 findings in these files before (565 plus search.js's 43), 0 after (with S0's
current branch applied; see below). The fill-in diff (`diffs\mapapp.diff`) was not used: its
inferred types were mostly `any` and structural noise and it moved module comments onto
functions, so the files were annotated by hand against how each value is produced.

Commits (oldest first):

1. pure helpers, renderer label/repair helpers, election caches, transport, panel model, council-year grouping (`src/ni-local-groups.mjs`)
2. palette, results pane contract (names what it asks of the election manager: `PaneHost`), person/party page figures, public-map rule, map relations, printed labels, storage keys
3. census overlay (`CensusEntry`, `CsvRow`, `OverlayClass`, `Licence`)
4. catalogue search (rebuilt catalogue, places, people rows) + added to the mapapp include and to the allowlist test's BASELINE
5. shared election renderer (`RendererHost`, `TableRow`, `CountRow`, `RenderResult`)
6. election trends chart (`TrendPoint`, `TrendSeries`, `TrendLayout`, `TrendLabel`, `TrendChartController`)
7. election results model (`ResultRow`, `PartyRow`, `LocalPartyRow`, `CouncilTotals`, `StvCandidate`)

Types come from `packages/types` where one fits (`LayerEntry`, `ElectionManifestEntry`,
`ApiV1.ElectionsManifestAnswer`) and from the election view model's `ElectionRecord` /
`ElectionResult` / `ElectionContext`; otherwise a local `@typedef` written from the data
(data/catalogue/*.json, data-entries.json, maps-test.json) or the builder that makes it.
Open-ended JSON fields are `unknown`, read through the coercing helpers as before.

The existing `{any}` annotations in these files are gone (ni-local-groups x2, search.js x2,
trends chart x2). No `any`, `@ts-ignore` or `@ts-expect-error` was added.

JSDoc casts kept (41, all `/** @type {X} */ (expr)`, none to any). By kind:
- `Map.get` right after a `has`/`set` (byYear, byParty, groups, councils, byName, inflight): the value is there.
- `filter(Boolean)` results (`unique`, compositeChildIds) and `.filter((row) => row.value)` in the trends tooltip: TypeScript does not narrow through them.
- object literals completed later (`plot` width/height, direct labels' x/leader).
- `[key, value]` tuples in `new Map(rows.map(...).filter(...))`.
- open JSON read as a shape: bounds pairs, places bbox, contest notes, recall petition, countInfo/mainLikeTotals, `globalThis.civgraphI18n`, approximate-segment reason, census denominator (finite value implies it was read).
- the `escapeHtml` lookup tables (`Record<string, string>`), ENTITY_TYPE_LABEL key.
- (The temporary cast on `candidate.colour` in results-model.mjs, needed only while packages/core was untyped, was dropped after the rebase on S0.)

## Rebased on main 18ddb93b12 (S0, S1a, S1b, S2a, S2b, S3, UI landed); flag flipped

Last two commits: the cast removal, then the flip (`"noImplicitAny": true` in
`src/tsconfig.check.json`, its comment, and `'noImplicitAny'` in the strict-flags test of
`tests/unit/map-typecheck.test.mjs`).

**Update: nia-s2b's config.js is on main 18ddb93b12 now, and `tsc -p src/tsconfig.check.json` with the flag on is clean there (0 errors).** Before that: The map app's program
imports `packages/config/src/config.js`, which still has 6 implicit-any findings on main
(lines 83, 104, 117, 123); nia-s2b fixes them. With nia-s2b's config.js in place,
`tsc -p src/tsconfig.check.json` is clean; on main alone, `check:types:mapapp` fails on those 6
lines only. If S2b is delayed, land everything but the last commit (846739f900, the flip).

## Proof that behaviour is unchanged (rebased HEAD)

- Every changed .js/.mjs file minifies (esbuild, comments stripped) to the same code at main and HEAD (28 files).
- `node scripts/build/app-bundle.mjs` from HEAD's and from main's sources (same worktree) gives identical output files, chunk names included (entry js=5a61c127c381 both).
- `node --test tests/unit/map-typecheck.test.mjs` 4/4; `tests/catalogue/search.test.mjs` 16/16; `test:unit` passes (448 pass before the rebase; passes in check:fast after it).
- `check:fast`: 15 failures = the 14 that main's own sources show in this worktree (missing gitignored data: tmp/records, data/browse, render/metadata/elections-test2.json, THIRD-PARTY-NOTICES, a local app/build stamp) + `check:types:mapapp` (config.js, above). Every other `check:types:*` passes.
- Browser, port 5050, serial (test:browser:maps + tests/browser/app.spec.cjs, 75 tests): 37 passed, 38 failed, the same 38 tests before and after the rebase. The failures are environmental and not from this branch: the served bundle is byte-identical to main's and every source file is code-identical; they are the election-pane and load tests (30 in app.spec.cjs, 5 load-races, 2 election-layout, 1 catalogue-load-a11y, 1 map-svg-export), which read data this checkout (and main's) does not have, chiefly render/metadata/elections-test2.json (gitignored, absent; the specs force the static election path). A run on a checkout with the built election data should be compared with main's on the same data.

## Landing steps (main session)

1. Merge nia-s4 (rebased on 18ddb93b12; nia-s2b's config.js already there).
2. Run `npm run check:types:mapapp`, `node --test tests/unit/map-typecheck.test.mjs`, `npm run test:unit`.
3. No regeneration needed: no runtime line changed, app/build is gitignored and byte-identical, no cache token moves. Nothing to upload or migrate; nothing needs the owner.

## Files other streams may touch

`src/ni-local-groups.mjs` and `src/catalogue/search.js` are imported by build scripts in the
records/pipeline programs (those type checks pass). `src/tsconfig.check.json` and
`tests/unit/map-typecheck.test.mjs` (search.js added to include and BASELINE).
