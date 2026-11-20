# packages/

npm workspaces (`"workspaces": ["packages/*"]` in the root package.json) for the code more than
one part of the site shares: refactor item 1, REFACTOR-PLAN.md section 2. Each package is
`@civgraph/<name>`, `"private": true` (never published to npm), `"type": "module"`, and says
what it offers in its `exports`. The repository root stays the one deployable site.

| Package | Holds | Moved from (history only: no old path keeps a re-export. The package move's 120 one-line re-exports were removed on 8 Nov 2026 and rf10-gallery's five on 19 Nov 2026; import the package path or name) |
|---|---|---|
| `@civgraph/storage` | the RecordStore interface (`store.js`), the D1 adapter (`d1.js`; `.` is the runtime entry) and the node:sqlite adapter (`sqlite.mjs`, entry `@civgraph/storage/node`) | `functions/_lib/storage/store.js`, `functions/_lib/storage/d1.js`, `scripts/lib/storage/sqlite.mjs` (removed) |
| `@civgraph/core` | pure domain code with no I/O (`src/`: date-format, election-domain, election-view-model, party-names, html escaping, format, election-slug-aliases, layer-index: the layer file and API URLs, PKG-8) | `src/date-format.mjs`, `src/election-domain.mjs`, `src/election-view-model.mjs`, `src/party-names.mjs`, `functions/_lib/layer-index.js`, `functions/_lib/html.js`, `functions/_lib/format.js`, `functions/_lib/election-slug-aliases.js` (removed) |
| `@civgraph/config` | the configuration: the runtime half (`src/config.js`, entry `@civgraph/config`: site, API, bindings, runtime variables, cache), read by the Functions and the browser bundles, and the node half (`src/node.mjs`, entry `@civgraph/config/node`: REPO_ROOT, repository paths, build variables, loadConfig) | `functions/_lib/config.js`, `scripts/lib/config.mjs` (removed; `node packages/config/src/node.mjs` prints the config) |
| `@civgraph/schema` | the records schema: the D1 migrations (`migrations/*.sql`, `wrangler.toml` `migrations_dir`) and the table list (`src/schema.mjs`, entry `@civgraph/schema`) | `scripts/records/schema.mjs` (removed); `migrations/` keeps a pointer README |
| `@civgraph/loader` | the records loader (`src/`: ingest-*, build-records-db, delta, deploy, verify, parity crawl, local-api, paths); `npm run records:*` call it there. `scripts/records/paths.py` and `proni/*.py` stay in scripts/ (Python, not part of the package) | every `scripts/records/*.mjs` that moved (removed; `parity-crawl.mjs` and `provenance-parity.mjs` there are scripts of their own, not re-exports) |
| `@civgraph/api` | the handlers of `/_api` (`src/handlers/`, the same tree as `functions/_api/`, helpers included), `/api/v1` (`src/v1/`: route, delegate, ROUTES, OpenAPI, contracts), the dataset state and response helpers (`src/respond.js`, `src/dataset-state.js`, `src/contribution-status.js`) and the named queries (`src/queries/`, ST-6). Each route file under `functions/` is a one-line named re-export of its handlers (`export { onRequestGet } from ...`: Pages finds routes by named exports, so not `export *`) | `functions/_lib/{api/*,respond,dataset-state,contribution-status}.js`, `functions/_lib/queries/*.js` (removed). The one-line files under `functions/_api/**` and `functions/api/[[path]].js` stay: they are the Pages route entry points, not old-path re-exports |
| `@civgraph/intake` | the intake framework (`src/`: batch, plan, stage, review, commands, statuses, item-status, the plugin API `plugins.mjs` and `plugin-cli.mjs`, the frozen clock); `scripts/intake/intake.mjs` stays the CLI and `scripts/intake/batch.schema.json` stays put (the statuses registry cites it) | every `scripts/intake/lib/*.mjs` and `lib/frozen-clock/clock.mjs` (removed) |
| `@civgraph/maps-pipeline` | the map build pipeline (`src/tiles/`: vector intake and batches, layer plan, PMTiles, feature indexes, alias repair, promotion; `src/thumbnails/`: feature thumbnails and the manifest); the npm build scripts call it there. The Python tilers and `regen-thumbnails.py` stay in scripts/build | every `scripts/build/tiles/*.mjs` and `scripts/build/thumbnails/*.mjs` (removed; the npm scripts call the package files) |
| `@civgraph/types` | type declarations (`.d.ts`, types only) of the shared data shapes for JSDoc: `generated/` is written by `src/generate.mjs` (`npm run build:types`) from the JSON Schemas in data/schemas and registries/schemas, the /api/v1 contracts and the records tables; `hand/core.d.ts` names the core shapes (Election, Contest, Candidacy, Count, Person, Party, Council, Office, MapEntry, LayerEntry, CatalogueSeries, the answer envelopes); entry `index.d.ts` | (new) |
| `@civgraph/registries` | the data registries' code (`src/`: index/loadRegistry, councils, parties, offices, layers, statuses, status-machines, validate, check, legacy-sources, `seed/`), their JSON Schemas (`schemas/`) and the generated browser slices (`src/browser/`, `node packages/registries/src/browser/build.mjs` from either path); the data stays in `data/registries/` (out of dist/) | every `registries/**/*.mjs` (removed; the slices' .json and the schemas never had a copy at the old path) |
| `@civgraph/ui` | the design system: tokens, base and component stylesheets, the gallery's browser files and the UI state helpers (`assets/`, served at `/assets/ui/`: `packages/served.json` maps the prefix, `scripts/build/site.mjs` copies them into dist/ there and the dev servers serve them there; URLs and cache tokens unchanged), the shell, component and record templates (`src/templates/`) and the gallery page (`src/gallery/route.js`) | `functions/_templates/**/*.js` and the `assets/ui/state/machine.js` alias (removed); `functions/design-system/index.js` stays as the gallery's Pages route entry point |
| `@civgraph/map` | the map app: its modules (`src/`: `app/`, `election/`, `renderer/`, `state-helpers.mjs`; and since rf9-mapapp, 12 Nov 2026, the catalogue pane `ui-controller.js`, `catalogue/`, `data-service.js`, `feature-loader.js`, the election renderer and trend chart and the rest of the old root `src/` modules) and its entry, election manager, adapter and workers (`app/`); esbuild bundles `app/boot.js` (scripts/build/app-bundle.mjs); `/app/src/` (the two module workers), `/src/map/` and the old `/src/*.js` and `/src/catalogue/` paths stay served at their URLs through `packages/served.json` (`tests/unit/map-served-paths.test.mjs`), and `scripts/lib/map-app-source.mjs` names the files the checks read. The type check is the map's package projects (`packages/map/tsconfig.check.json` until 20 Nov 2026) | `src/map/**`, `app/src/**`, `src/*.js`, `src/*.mjs`, `src/catalogue/**` (no re-exports: all are served paths, which the package now answers; a branch editing a moved file merges as a rename). `src/` keeps only the vendored `libs/` and `sql.js-httpvfs/`. rf10-gallery (13 Nov 2026) moved the map's pure drawing code to `src/views/`; the five re-exports it left at `src/app/legend-view.mjs`, `src/app/timeline/timeline-view.mjs`, `src/election-renderer.mjs`, `src/colours.mjs` and `src/specimens.mjs` were removed on 19 Nov 2026 (owner decision 7.2): import `src/views/` (`@civgraph/map/views/...`). Their served addresses (`/src/election-renderer.mjs`, `/src/map/colours.mjs`, `/src/map/specimens.mjs`, `/src/map/app/legend-view.mjs`, `/src/map/app/timeline/timeline-view.mjs`) answer 301 with `/src/map/views/<file>` (site/_redirects; `tests/unit/map-views.test.mjs`) |

Nothing under `packages/` is published: `scripts/build/site.mjs` builds `dist/` from an
allow-list that does not name it (`tests/unit/site-build.test.mjs` holds that).

## How code imports a package

**By name, since 18 Nov 2026 (rf-final)**: a module the site does not serve as a file imports
another package by its `@civgraph/<name>` name and a subpath its `exports` reach:
`import { openSqlite } from '@civgraph/storage/node'`, `import { escapeHtml } from
'@civgraph/core/html.js'`, `/** @typedef {import('@civgraph/types').Council} Council */`.
Inside one package, imports stay relative. `tests/unit/packages.test.mjs` holds both rules, and
`node scripts/lib/package-names.mjs --write` rewrites a relative cross-package import to its
name (it picks the package's own entry, such as `@civgraph/storage/node`, before a pattern, and
only a name that resolves back to the same file).

- **Resolution.** Node, tsc (`nodenext` and `bundler`), esbuild and the Pages Functions bundler
  all resolve a name through `node_modules/@civgraph/<name>` (npm's workspace links) and the
  package's `exports`, to the same file the relative path named: `check:boundaries` resolves
  names the same way and lists the very same edges.
- **Worktrees and check:clean** get their own `node_modules`: junctions to the main checkout's
  entries, with the `@civgraph` links pointing at their OWN `packages/`
  (`scripts/lib/node-modules-links.mjs`), so a name never runs another checkout's copy, and
  `REPO_ROOT` (`config/src/node.mjs`) and `DEFAULT_REPO` (`intake/src/batch.mjs`) stay the
  checkout's own. A worktree made before 18 Nov 2026 joined `node_modules` to main's whole:
  `npm run worktree:links -- <name>` converts it (`npm run land` does so before its gates).
- **The Pages build and the deploy** (`scripts/publish/deploy-pages.mjs`) run `npm ci` in a
  clean stage, which makes the workspace links there. A preview deployment on 18 Nov 2026
  (branch `preview-direct`) proved the Functions resolve the names.
- **The map package** exports `./*` (its `src/`), `./app/*` (its `app/` folder) and
  `./src/app/*` (its `src/app/`, which `./app/*` would otherwise shadow).

**Served files keep relative imports.** A module the site serves to the browser as a file
(everything under `site/` and `render/`, and every source `packages/served.json` maps: the map
package's served modules, `/assets/ui/`, the `/pkg/` allowlist) imports by relative path, never
by name: the browser resolves URLs and knows no package names. Browser modules the site serves
as files (assets/, browse/, apps/) import nothing from `packages/` by a relative path: it is not
in `dist/`. The map app and the catalogue reach the core and config packages through the
esbuild bundles; a served, unbundled page reaches an allowlisted module through `/pkg/` (next
section).

## How packages are type-checked

**Per package, with project references, since 18 Nov 2026 (TS-4)**: `npm run check:types:packages`
is `tsc -b config/tsconfig.packages.json`, a solution that references one composite project per
package, `packages/<name>/tsconfig.project.json` (not `tsconfig.json`: esbuild, the map bundler
and the Functions bundler, would read that, and `packages/types/tsconfig.json` is taken). Each
project is `strict` plus the stricter flags its files pass, in its package's environment (the DOM,
plus `functions/_lib/runtime.d.mts` for api and storage; Node for the node halves, loader,
intake, maps-pipeline, schema and registries), and references the projects it imports: tsc
checks it against their declarations, emitted to `tmp/tsbuild/<project>/` (gitignored), and
builds only what changed since the last run. Nothing else is emitted.

- **Split projects.** tsc -b refuses a cycle, and a project holds one environment, so five
  packages have two projects (no file moved): config and storage (`tsconfig.project.json`, the
  runtime half; `tsconfig.project.node.json`, the node half), registries
  (`tsconfig.project.browser.json`, the slices of `src/browser/` that core imports; the rest,
  with the slices' generator `src/browser/build.mjs`), map (`tsconfig.project.views.json`,
  `src/views/`, which ui draws with; the rest) and ui (`tsconfig.project.base.json`, the two
  modules the api imports, `src/page-types.mjs` and `src/templates/proni/record-view.js`; the
  rest, which imports the api).
- **A new file** in a package joins its project (most includes are globs) and must check clean.
  `tests/unit/packages-typecheck.test.mjs` holds the projects: every package script file is in
  exactly one project (the LEFT list of files not yet clean has been empty since 20 Nov 2026,
  stream w20-refactor, and only shrinks), the flags and include lists only grow, and no file
  silences the checker.
- The older checks (`check:types:shared`, `:functions`, `:records`, `:intake`, `:ui`,
  `:pipeline`) still run, over the files outside `packages/` as well.

## Served package modules (`/pkg/`)

Since 11 Nov 2026 (owner-approved; the Elections app's arch audit P3) a short allowlist of pure
package modules is served at `/pkg/<its path under packages/>`, so an unbundled page imports the
package's code instead of copying it. The layout is mirrored, so the modules' relative imports of
each other keep working (`/pkg/ui/src/templates/components/index.js` imports
`/pkg/core/src/html.js`).

- **The allowlist** is the `pkg/...` keys of `packages/served.json`: one file per key, never a
  directory. `scripts/build/site.mjs` copies exactly those into `dist/pkg/`, and the dev and test
  servers answer exactly those paths. `tests/unit/served-pkg.test.mjs` lists them, and fails when
  a served module imports one that is not served, uses a Node-only API, or comes from a package
  that is never served (storage, loader, schema, intake, api, maps-pipeline, types,
  `config/src/node.mjs`, any JSON).
- **Headers** (`site/_headers`, `/pkg/*`): `Content-Type: text/javascript`, `no-cache,
  must-revalidate` (the names are not content-hashed: a page's import map versions them), never
  indexed. Static, never a Function.
- **Node and tsc** resolve a page's import through `site/pkg/<path>`: one line,
  `export * from '<up>/packages/<path>'`, for each module a page imports directly (the test holds
  each to that one line; a module with a default export needs a different shim).
- **check:boundaries**: `site/pkg/` is the `site-pkg` unit (core, ui, config, registries-browser
  and, since 14 Nov 2026, map-views only). The Elections app's unit may import `site-pkg`, never a package unit, and its ESLint
  rules forbid any `packages/` import.

**The /maps/ trend chart** (14 Nov 2026, stream el-places): the Elections app's area pages draw
the party-share chart with `packages/map/src/views/election-trend-chart.mjs`, served at
`/pkg/map/src/views/election-trend-chart.mjs`. Its key stands before `src/map/` in `served.json`,
because the first key whose source holds a file gives its served path (the map app bundles it, so
it read nothing at `/src/map/views/`).

**To serve another module:** add `"pkg/<path>": "packages/<path>"` to `packages/served.json` (and
the same for every module it imports), add it to the list in `tests/unit/served-pkg.test.mjs`,
add a `site/pkg/<path>` re-export if a page imports it directly, and import it from the page by
the relative path that lands on `/pkg/` (from `site/apps/x/lib/y.js`: `../../../pkg/core/src/html.js`).

**Browse adopted it on 12 Nov 2026** (stream rf8-types): `site/browse/browse.js` imports core's
`escapeHtml` (html.js), `slugify` (format.js) and `candidateReturnWithoutPoll` and `partyHadNoPoll`
(unopposed.mjs) from `../pkg/core/src/`, and the three pages that load it (Browse, the catalogue,
the records page) list those modules in their import maps (`tests/unit/ui-module-tokens.test.mjs`
prints the map to paste); `config/boundaries.json` lets the `site` unit import `site-pkg`.
`site/apps/proni-search/` would import the same way (`../../pkg/...`), needing no new served
module for the helpers above; a registry slice (`registries/src/browser/*.mjs` with its
`.data.mjs`) or another core module is one more allowlist entry each.

## Rules

The dependency rules are REFACTOR-PLAN.md section 2.2: in short, only `@civgraph/storage` touches
a D1, R2 or `node:sqlite` API, and a runtime entry never imports `node:*`.
