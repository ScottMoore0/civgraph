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
- results-model.mjs `buildLocalPartySummary`: `candidate.colour` as `string | undefined`, ONLY because main's untyped `resolvePartyColour` reads its `sourceColour` as a string. S0 types it `unknown`: drop this cast (and its comment line) in the flip commit.

## Proof that behaviour is unchanged

- Every changed .js/.mjs file minifies (esbuild, comments stripped) to the same code at main and HEAD (all 28 files "same").
- `node scripts/build/app-bundle.mjs` from HEAD's sources and from main's sources (same worktree) gives identical output files, chunk names included (entry js=aac2b10b65d4 both).
- `check:types:mapapp` (flag as committed) passes; `test:unit` 448 pass / 0 fail; `tests/catalogue/search.test.mjs` 16 pass.
- `check:fast`: the same 14 failures as main's sources in the same worktree, all missing gitignored data (tmp/records, data/browse, THIRD-PARTY-NOTICES, a local app/build stamp); every `check:types:*` passes.
- Browser (port 5050, serial): see the result line at the end.

## Landing steps (main session)

The flag CANNOT flip yet: `tsc -p` fails on any imported file, and the mapapp program imports
`packages/core/src/*.mjs` (S0; about 180 findings on main) and `packages/config/src/config.js`
(S2b's file; 6 findings: lines 83, 104, 117, 123). With S0's branch applied (both its commits,
f498268881 and d9d3370154) my files show 0 findings and only config.js's 6 remain.

1. Land S0 and S2b (or at least config.js's fix) first.
2. Rebase nia-s4 on that main; re-run with the flag forced on (a throwaway
   `src/tsconfig.nia.json` = `{ "extends": "./tsconfig.check.json", "compilerOptions": { "noImplicitAny": true } }`,
   `node node_modules/typescript/bin/tsc -p src/tsconfig.nia.json`). Fix anything S0's final types moved.
3. Flip commit:
   - `src/tsconfig.check.json`: add `"noImplicitAny": true,` after `"strictNullChecks": true,`, and in its `//` comment say noImplicitAny is on (8 Nov 2026 review).
   - `tests/unit/map-typecheck.test.mjs`, test "the strict flags stay on": add `'noImplicitAny'` to `flags` (and the test name to "(round 3, noImplicitAny 8 Nov 2026)").
   - `packages/map/src/election/results-model.mjs`: remove the temporary `string | undefined` cast on `candidate.colour` and its comment line.
   - run `npm run check:types:mapapp`, `node --test tests/unit/map-typecheck.test.mjs`, `npm run test:unit`.
4. No regeneration needed (app/build is gitignored and byte-identical; no cache token moves).

## Files other streams may touch

`src/ni-local-groups.mjs` and `src/catalogue/search.js` are imported by build scripts in the
records/pipeline programs (those type checks pass). `src/tsconfig.check.json` and
`tests/unit/map-typecheck.test.mjs` (search.js added to include and BASELINE).
