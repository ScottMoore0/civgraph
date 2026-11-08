# Landing: pkg2 (the package move's deferred steps)

Branch `pkg2`, worktree `C:\Users\scomo\civgraph-pkg2`, rebased on main 17c683abae (the
retired-service-worker afterEach fix; git carried it into the renamed `.cjs` spec). Owner
approval 8 Nov 2026. Nothing pushed, deployed, published or uploaded; no `wrangler pages deploy`
or preview deploy; `wrangler pages functions build` and `wrangler pages dev` ran locally only.
TS-4 skipped as instructed (it goes with the noImplicitAny work).

## Commits (oldest first)

| Step | Commit | What |
|---|---|---|
| 1 PKG-8 | 5d6b085a3a | `functions/_api/**` -> `packages/api/src/handlers/**` (same tree, helpers too); `functions/_lib/api/*` + `functions/api/[[path]].js` -> `packages/api/src/v1/` (`route.js`); `respond`, `dataset-state`, `contribution-status` -> `packages/api/src/`; pure `layer-index` -> `packages/core/src/`. Route files are one-line NAMED re-exports (`export { onRequestGet } from ...`: Pages finds routes by named exports, `export *` would drop the route); helper paths `export *`. |
| 2 registries | b13951ab92 | `registries/` -> `packages/registries` (`src/`, `src/browser/` slices, `schemas/`); old `.mjs` paths re-export (slices re-export `default`); both CLIs (`node registries/browser/build.mjs`, `registries/seed/layer-types.mjs`) run from either path. `data/registries` unchanged and out of dist/. |
| 3 PKG-9 | 939d9cbd32 | `assets/ui/**` -> `packages/ui/assets/**`, `functions/_templates/**` -> `packages/ui/src/templates/**`, gallery route -> `packages/ui/src/gallery/route.js`. New `packages/served.json` (served prefix -> package source): `scripts/build/site.mjs` (`sourceOf`/`servedOf`) copies package files to their served paths in dist/; the three dev servers, the cache-token stamps/checks and asset-refs read through it. `assets/ui/state/machine.js` stays as an alias (Node and tsc resolve the served-URL imports of browse/ and apps/ through it; never served). |
| 4 PKG-10 | d3570cfaf3 | `src/map/**` -> `packages/map/src/**`, `app/src/**` -> `packages/map/app/**`; both prefixes stay served via `packages/served.json` (the two module workers live at `/app/src/`). esbuild entry `packages/map/app/boot.js`; every path-literal reader updated (map-app-source, election-route, i18n extraction, cdn-manifest, rename-layer-ids, registry `sources` with a widened schema pattern, typecheck allowlist, eslint). No re-exports (both are served prefixes the package now answers). Lockfile gains the ui and map workspaces. |
| 5 type module | a33f453bbf | Root `"type": "module"`; the 32 CommonJS Playwright specs, `tests/browser/helpers/base-url`, `playwright.config`, `_dev-server` renamed `.cjs` (requires name the extension); scripts/docs follow. Browser-only CJS (election viewer copies, sql.js-httpvfs) untouched. No functions/package.json needed. |
| 6 PKG-0/1 | be8cfca436 | `boundaries.json` + `scripts/check/boundaries.mjs` (`check:boundaries`, in the chain, CHECKS.md row, `tests/unit/boundaries.test.mjs`); baseline EMPTY. Cleared: state-machine, layer-renames, primary-feature-keys -> core; layer-bounds, safe-artefact-write -> maps-pipeline (scripts/lib re-exports); the layer-id prefix table url-compat -> core/layer-renames; `loadElectionPage` ui template -> `packages/api/src/pages/election.js`; parity-crawl back to `scripts/records/` (a tool that runs the catalogue search). Recorded departures from the plan table: core may read the generated registry slices; map may import src/ until F2/F4. |
| fix | 465c14a11e | The setHidden test walks packages/map; `sourceOf` maps a served directory named without its slash (docs cite `src/map`, `app/src`). Both only showed in a clean export (caught by check:clean). |

## Results

- After every step: `check:fast` same failures as untouched main in a fresh worktree (env only:
  asset-refs, doc-paths, notices, test2 without build output), all green once `build:site` had
  run; `test:unit` 452/452 at the end (449 at the start). records functions test + tests/functions
  98/98 with copies of main's tmp/records; v1 contract baseline untouched.
- Functions bundle (`wrangler pages functions build`, 4.85.0): identical code before/after steps 1
  and 5 (only esbuild path comments differ in step 1), same routes file.
- `wrangler pages dev dist` with a copy of the records DB as local ELECTIONS_DB: 40 routes
  (/api/v1/, openapi.json, elections, parties, /_api/*, a person page, /data/browse, /data/graph,
  render/metadata, PRONI API, /design-system/, static shell, served package files) answer with the
  same status, headers and bodies as main, except /maps/ (cache tokens follow chunk names) and a
  random error id.
- dist/: same 4,972 files; same bytes apart from app-bundle chunk names, the tokens that follow
  them (maps/, sw.js), deploy-stamp, and raw copies of src/ and app/src/ files whose import paths
  changed (bundled, never loaded raw; the two workers are byte-identical).
- App bundle: each chunk identical with chunk names normalised through step 5, except esbuild's
  Node-mode interop flag on the maplibre-gl CommonJS import (`__toESM(x, 1)`, 5 places) once its
  importers sit in a `"type": "module"` package; maplibre-gl sets no `__esModule`, so the default
  import is the same object. Step 6 moved one constant between modules: minified names reorder.
- Browser, port 5050, after steps 3, 4, 5, 6: test:browser:maps 34/34, app.spec 41/41; also
  site-shell + ui-state-machines 62/62, map-svg-export + ni-local-grouped + retired-service-worker
  15/15, timeline-and-url-state with app 45/45. Playwright lists 231 tests in 32 files, as main.
- check:clean (final, on 465c14a11e): CLEAN-EXPORT CHECKS OK, 76 steps, records:check 56 pass / 0 fail / 1 skipped. The first run (on be8cfca436) failed doc-paths and one unit test, fixed in 465c14a11e.

## Landing steps (main session)

1. Fast-forward main to `pkg2`.
2. `npm install` (lockfile: `@civgraph/registries`, `@civgraph/ui`, `@civgraph/map` workspaces).
3. `npm run build`, then commit the re-stamped tokens (sw.js VERSION, maps/index.html,
   maps/classic/index.html, assets/thumbnails/manifest.json, tasks/test2-election-data-audit.*):
   chunk names change because esbuild hashes module paths. Every other HTML token is unchanged.
4. No R2, D1, KV change; no migration. Pages build command unchanged; Functions bundle unchanged.
5. Other streams: a branch editing a moved file merges as a rename; new files go in the package.
   Run single specs as `.spec.cjs`. `npm run check:boundaries` must stay clean (empty baseline).
   Imports stay relative (tests/unit/packages.test.mjs).
6. Delete the re-exports on or after 8 Dec 2026 (`git grep "kept until 8 Dec 2026"`); keep
   `assets/ui/state/machine.js` (alias, see step 3) until browse/ and apps/ import differently.
7. Owner: CLAUDE.md still names `app/src/app.js` (now `packages/map/app/app.js`); doc-paths
   accepts it as a served path, but the line could be updated (not edited here).

## Notes and what is left

- Playwright's loader fails ("module is not linked") importing the gallery through its
  functions/ re-export; the site-shell spec imports `packages/ui/src/gallery/route.js` directly.
- boundaries does not see computed imports (`packages/loader/src/local-api.mjs` starts the
  Functions by path, as a dev server) or bare `@civgraph` names (forbidden anyway).
- Left: TS-4; bare-name route files (`@civgraph/api/...`) once worktrees run their own install
  and a preview deploy confirms Pages bundles workspace links; the decide.js registry import;
  F2/F4 moving the rest of the map app out of src/ (then drop map -> frontend).

Files other streams may also touch: package.json, package-lock.json, CHECKS.md, README.md,
packages/README.md, eslint.config.mjs, tsconfig.ui*.json, src/tsconfig.check.json,
functions/tsconfig.check.json (unchanged), playwright.config.cjs, every tests/browser spec
(renamed), scripts/build/site.mjs, scripts/dev/*, tools/dev-site/server.mjs, the cache-token and
asset-ref checks, scripts/check/rules/election-route.mjs, scripts/lib/map-app-source.mjs,
scripts/i18n/extract-ui-strings.mjs, data/registries/*.json (descriptions/sources).
