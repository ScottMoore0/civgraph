# packages/

npm workspaces (`"workspaces": ["packages/*"]` in the root package.json) for the code more than
one part of the site shares: refactor item 1, REFACTOR-PLAN.md section 2. Each package is
`@civgraph/<name>`, `"private": true` (never published to npm), `"type": "module"`, and says
what it offers in its `exports`. The repository root stays the one deployable site.

| Package | Holds | Old paths (one-line re-exports, kept until 8 Dec 2026) |
|---|---|---|
| `@civgraph/storage` | the RecordStore interface (`store.js`), the D1 adapter (`d1.js`; `.` is the runtime entry) and the node:sqlite adapter (`sqlite.mjs`, entry `@civgraph/storage/node`) | `packages/storage/src/store.js`, `packages/storage/src/d1.js`, `packages/storage/src/sqlite.mjs` |
| `@civgraph/core` | pure domain code with no I/O (`src/`: date-format, election-domain, election-view-model, party-names, html escaping, format, election-slug-aliases, layer-index: the layer file and API URLs, PKG-8) | `packages/core/src/date-format.mjs`, `packages/core/src/election-domain.mjs`, `packages/core/src/election-view-model.mjs`, `packages/core/src/party-names.mjs`, `packages/core/src/layer-index.js`, `packages/core/src/html.js`, `packages/core/src/format.js`, `packages/core/src/election-slug-aliases.js` |
| `@civgraph/config` | the configuration: the runtime half (`src/config.js`, entry `@civgraph/config`: site, API, bindings, runtime variables, cache), read by the Functions and the browser bundles, and the node half (`src/node.mjs`, entry `@civgraph/config/node`: REPO_ROOT, repository paths, build variables, loadConfig) | `packages/config/src/config.js`, `packages/config/src/node.mjs` (`node packages/config/src/node.mjs` still prints the config) |
| `@civgraph/schema` | the records schema: the D1 migrations (`migrations/*.sql`, `wrangler.toml` `migrations_dir`) and the table list (`src/schema.mjs`, entry `@civgraph/schema`) | `packages/schema/src/schema.mjs`; `migrations/` keeps a pointer README |
| `@civgraph/loader` | the records loader (`src/`: ingest-*, build-records-db, delta, deploy, verify, parity crawl, local-api, paths); `npm run records:*` call it there. `scripts/records/paths.py` and `proni/*.py` stay in scripts/ (Python, not part of the package) | every `scripts/records/*.mjs` (a CLI still runs from its old path: the guards compare the file name) |
| `@civgraph/api` | the handlers of `/_api` (`src/handlers/`, the same tree as `functions/_api/`, helpers included), `/api/v1` (`src/v1/`: route, delegate, ROUTES, OpenAPI, contracts), the dataset state and response helpers (`src/respond.js`, `src/dataset-state.js`, `src/contribution-status.js`) and the named queries (`src/queries/`, ST-6). Each route file under `functions/` is a one-line named re-export of its handlers (`export { onRequestGet } from ...`: Pages finds routes by named exports, so not `export *`) | every `functions/_api/**/*.js`, `functions/api/[[path]].js`, `functions/_lib/{api/*,respond,dataset-state,contribution-status}.js`, `functions/_lib/queries/*.js` |
| `@civgraph/intake` | the intake framework (`src/`: batch, plan, stage, review, commands, statuses, item-status, the plugin API `plugins.mjs` and `plugin-cli.mjs`, the frozen clock); `scripts/intake/intake.mjs` stays the CLI and `scripts/intake/batch.schema.json` stays put (the statuses registry cites it) | every `scripts/intake/lib/*.mjs` and `lib/frozen-clock/clock.mjs` |
| `@civgraph/maps-pipeline` | the map build pipeline (`src/tiles/`: vector intake and batches, layer plan, PMTiles, feature indexes, alias repair, promotion; `src/thumbnails/`: feature thumbnails and the manifest); the npm build scripts call it there. The Python tilers and `regen-thumbnails.py` stay in scripts/build | every `scripts/build/tiles/*.mjs` and `scripts/build/thumbnails/*.mjs` (each CLI still runs from its old path) |
| `@civgraph/types` | type declarations (`.d.ts`, types only) of the shared data shapes for JSDoc: `generated/` is written by `src/generate.mjs` (`npm run build:types`) from the JSON Schemas in data/schemas and registries/schemas, the /api/v1 contracts and the records tables; `hand/core.d.ts` names the core shapes (Election, Contest, Candidacy, Count, Person, Party, Council, Office, MapEntry, LayerEntry, CatalogueSeries, the answer envelopes); entry `index.d.ts` | (new) |
| `@civgraph/registries` | the data registries' code (`src/`: index/loadRegistry, councils, parties, offices, layers, statuses, status-machines, validate, check, legacy-sources, `seed/`), their JSON Schemas (`schemas/`) and the generated browser slices (`src/browser/`, `node packages/registries/src/browser/build.mjs` from either path); the data stays in `data/registries/` (out of dist/) | every `registries/**/*.mjs` (the browser slices' modules re-export `default`; the slices' .json and the schemas have no copy at the old path) |
| `@civgraph/ui` | the design system: tokens, base and component stylesheets, the gallery's browser files and the UI state helpers (`assets/`, served at `/assets/ui/`: `packages/served.json` maps the prefix, `scripts/build/site.mjs` copies them into dist/ there and the dev servers serve them there; URLs and cache tokens unchanged), the shell, component and record templates (`src/templates/`) and the gallery page (`src/gallery/route.js`) | `functions/_templates/**/*.js`, `functions/design-system/index.js` (route re-export); `assets/ui/state/machine.js` stays as an alias so Node and tsc resolve the served-URL imports of browse/ and apps/ (never served: the package file is) |
| `@civgraph/map` | the map app: its modules (`src/`: `app/`, `election/`, `renderer/`, `state-helpers.mjs`) and its entry, election manager, adapter and workers (`app/`); esbuild bundles `app/boot.js` (scripts/build/app-bundle.mjs); `/app/src/` (the two module workers) and `/src/map/` stay served at their URLs through `packages/served.json`, and `scripts/lib/map-app-source.mjs` names the files the checks read | `src/map/**`, `app/src/**` (no re-exports: both are served prefixes, which the package now answers; a branch editing a moved file merges as a rename) |

Nothing under `packages/` is published: `scripts/build/site.mjs` builds `dist/` from an
allow-list that does not name it (`tests/unit/site-build.test.mjs` holds that).

## How code imports a package

**By relative path, everywhere**: `import { openSqlite } from '../../packages/storage/src/sqlite.mjs'`,
never by the `@civgraph/<name>` name (tests/unit/packages.test.mjs fails on one). Why:

- Worktrees junction `node_modules` to the main checkout's (parallel-2026-11-07 COMMON.md), and
  npm's workspace links there point at the main checkout's `packages/`. A name would run the
  main checkout's copy of a package from a worktree, and a package that finds the repository
  from its own location (`REPO_ROOT` in `config/src/node.mjs`, `DEFAULT_REPO` in
  `intake/src/batch.mjs`) would then read and write the main checkout. `npm run check:clean`
  links `node_modules` into its export the same way. A relative path always stays inside the
  checkout it is in.
- The Pages build and the Functions bundle never depend on the workspace links: esbuild (the
  app bundle) and the Pages Functions bundler follow a relative path anywhere in the project
  (`wrangler pages functions build` proves it locally).

The `exports` in each package.json and the workspace links are kept for the later switch to
names, once worktrees run their own `npm install` and a Pages preview deploy has shown the
Functions resolve them.

Browser modules the site serves as files (assets/, browse/, apps/) import nothing from
`packages/`: it is not in `dist/`. The map app and the catalogue reach the core and config
packages only through the esbuild bundles.

## Rules

The dependency rules are REFACTOR-PLAN.md section 2.2: in short, only `@civgraph/storage` touches
a D1, R2 or `node:sqlite` API, and a runtime entry never imports `node:*`.
