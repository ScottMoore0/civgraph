# packages/

npm workspaces (`"workspaces": ["packages/*"]` in the root package.json) for the code more than
one part of the site shares: refactor item 1, REFACTOR-PLAN.md section 2. Each package is
`@civgraph/<name>`, `"private": true` (never published to npm), `"type": "module"`, and says
what it offers in its `exports`. The repository root stays the one deployable site.

| Package | Holds | Old paths (one-line re-exports, kept until 8 Dec 2026) |
|---|---|---|
| `@civgraph/storage` | the RecordStore interface (`store.js`), the D1 adapter (`d1.js`; `.` is the runtime entry) and the node:sqlite adapter (`sqlite.mjs`, entry `@civgraph/storage/node`) | `functions/_lib/storage/store.js`, `functions/_lib/storage/d1.js`, `scripts/lib/storage/sqlite.mjs` |
| `@civgraph/core` | pure domain code with no I/O (`src/`: date-format, election-domain, election-view-model, party-names, html escaping, format, election-slug-aliases); the browser bundles and the Functions import it by relative path, Node by name | `src/date-format.mjs`, `src/election-domain.mjs`, `src/election-view-model.mjs`, `src/party-names.mjs`, `functions/_lib/html.js`, `functions/_lib/format.js`, `functions/_lib/election-slug-aliases.js` |
| `@civgraph/config` | the configuration: the runtime half (`src/config.js`, entry `@civgraph/config`: site, API, bindings, runtime variables, cache), read by the Functions and the browser bundles, and the node half (`src/node.mjs`, entry `@civgraph/config/node`: REPO_ROOT, repository paths, build variables, loadConfig) | `functions/_lib/config.js`, `scripts/lib/config.mjs` (`node scripts/lib/config.mjs` still prints the config) |
| `@civgraph/schema` | the records schema: the D1 migrations (`migrations/*.sql`, `wrangler.toml` `migrations_dir`) and the table list (`src/schema.mjs`, entry `@civgraph/schema`) | `scripts/records/schema.mjs`; `migrations/` keeps a pointer README |
| `@civgraph/loader` | the records loader (`src/`: ingest-*, build-records-db, delta, deploy, verify, parity crawl, local-api, paths); `npm run records:*` call it there. `scripts/records/paths.py` and `proni/*.py` stay in scripts/ (Python, not part of the package) | every `scripts/records/*.mjs` (a CLI still runs from its old path: the guards compare the file name) |
| `@civgraph/api` | the named queries of the Functions (`src/queries/`, ST-6); the handlers follow (PKG-8, see the landing notes) | every `functions/_lib/queries/*.js` |
| `@civgraph/intake` | the intake framework (`src/`: batch, plan, stage, review, commands, statuses, item-status, the plugin API `plugins.mjs` and `plugin-cli.mjs`, the frozen clock); `scripts/intake/intake.mjs` stays the CLI and `scripts/intake/batch.schema.json` stays put (the statuses registry cites it) | every `scripts/intake/lib/*.mjs` and `lib/frozen-clock/clock.mjs` |
| `@civgraph/maps-pipeline` | the map build pipeline (`src/tiles/`: vector intake and batches, layer plan, PMTiles, feature indexes, alias repair, promotion; `src/thumbnails/`: feature thumbnails and the manifest); the npm build scripts call it there. The Python tilers and `regen-thumbnails.py` stay in scripts/build | every `scripts/build/tiles/*.mjs` and `scripts/build/thumbnails/*.mjs` (each CLI still runs from its old path) |

Nothing under `packages/` is published: `scripts/build/site.mjs` builds `dist/` from an
allow-list that does not name it (`tests/unit/site-build.test.mjs` holds that).

## How code imports a package

- **Node** (scripts/, tests/, other packages): by name, `@civgraph/storage/node`. npm links each
  workspace into `node_modules/@civgraph/`, so run `npm install` once after pulling a new package.
- **Pages Functions** (`functions/`): by relative path into `packages/<name>/src/`. Pages bundles
  `functions/` with esbuild, which follows a relative path anywhere in the project
  (`wrangler pages functions build` proves the bundle locally); a bare `@civgraph/*` name would
  also depend on the Pages build's `npm install` having linked the workspaces, which only a
  preview deploy can show. Switch to names after one.
- **Browser modules served as files** (src/, assets/, browse/): not yet. `packages/` is not in
  `dist/`, so a module the browser fetches cannot import from it; the core, config, ui and map
  packages wait for a build step that copies or bundles them (see the landing notes).

## Rules

The dependency rules are REFACTOR-PLAN.md section 2.2: in short, only `@civgraph/storage` touches
a D1, R2 or `node:sqlite` API, and a runtime entry never imports `node:*`.
