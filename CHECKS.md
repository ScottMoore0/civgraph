# Checks

> **Status: current, 7 November 2026.** Area 4 of the site restructure (checks and CI), with the
> refactor groundwork's tests (REFACTOR-PLAN.md, kept with the design documents outside the repository).
> Every check, test and verify script is in exactly one tier below.

## The four tiers

| Tier | Command | Reaches the network? | Runs |
|---|---|---|---|
| 1. Fast local | `npm run check:fast` | no | after a change, by you; `npm run rebuild` runs it (or the app subset) for what changed |
| 2. Full local | `npm run check:full`, and `npm run check:clean` | see note | before you hand a branch over |
| 3. CI | `.github/workflows/ci.yml` (`npm run check:ci`, `npm run test:browser:maps`) | no | every push to main and every pull request |
| 4. Opt-in remote | `npm run verify`, `npm run verify:public` | yes, bounded | by hand, after a publish; never by default, never in CI |

**1. Fast local.** `check:fast` (`scripts/check/run.mjs`) runs every step of `npm run check`
in parallel and prints only the failures. It is offline: nothing in it reads a remote
database, R2 or the deployed site. Many steps read build output (the app build, the
catalogue import, `tmp/records`), so run `npm run rebuild` first, which builds what the
changed files need and then runs the checks.

**2. Full local.**
- `check:full` is tier 1, then `records:check` (the records database tests in
  `tests/records/`), `test:browser:maps` (the map app at `/maps/`, and the retired apps' service workers), `test:catalogue` and
  `test:i18n`. The last two serve the tree through `tools/dev-site/server.mjs`, which
  answers the map APIs (`/_api/layers`, `/_api/catalogue`) from the working tree and the
  records API (`/_api/parties`, `/_api/persons`, `/_api/elections` and the other routes that
  read only the records database) from `tmp/records` through `scripts/records/local-api.mjs`,
  and proxies the rest of `/_api/` and `/_r/` to the live site, so they read production's
  public API (GET only) for those. That ends when they move to `wrangler pages dev` with the
  local database (DESIGN.md step C3b).
- `test:browser:shell` (`tests/browser/site-shell.spec.js`) holds every page type to the
  shared shell (`functions/_templates/shell.js`) at 375 px and 1280 px, in light and dark:
  48 cases, each saving a screenshot to `test-results/site-shell/`. Run it after changing
  the shell, the token set (`assets/ui/`) or a page's head, header or footer.
- `check:clean` (`scripts/check/clean.mjs`) exports exactly what a commit would contain into
  a temporary directory, links `node_modules`, runs the CI builds and the tier 1 checks
  there, and unlinks `node_modules` before deleting the export. A check that needs a
  gitignored file fails here as it would in CI. It needs about 11 GB of free space for the
  records build.

**3. CI.** One workflow, `.github/workflows/ci.yml`, with no path filters: a validator
whose inputs fell outside a filter never ran (the `docs/**` gap, closed 2026-09-20).
- Job `check`: free disk (the records build writes about 10.8 GB; a runner guarantees
  14 GB), `npm ci`, then `npm run check:ci`, which is `check:clean`'s build-and-check run in
  place. The builds are `npm run build`, `records:build` and `records:check` (`BUILD_STEPS` in
  `scripts/check/clean.mjs`); since data phase 3 the records build also loads the maps,
  layers and catalogue, so there is no separate catalogue import. Then the browser specs of
  the map app (`test:browser:maps`), in the same job because they read the records build's
  election documents: `scripts/dev/test-server.py` serves those URLs from `tmp/records`, as
  the compatibility Functions serve them from D1, and the maps API URLs the app reads
  (`/_api/layers?view=index`, `/_api/catalogue?view=pane`, ...) from the tracked files
  their rows are loaded from. It answers the records API (the party and person pages read
  `/_api/parties` and `/_api/persons`) by running those Functions against the build's
  database in a Node process (`scripts/records/local-api.mjs`, tested in `records:check`);
  no other Function runs. `playwright.config.js` still turns the app's elections API off
  for the local origin, so the app loads the election documents by their bundle URLs;
  `records:check` tests the API. The
  config never reuses a server already on its port (one from another worktree would serve
  that tree); set `PW_REUSE_SERVER=1` to reuse your own.
- Job `pages-build`: the Pages build exactly as Cloudflare runs it (`npm run build:site`:
  `npm run build`, then `scripts/build/site.mjs`, which writes `dist/` from its allow-list
  and fails above 18,500 files or on a file over 25 MiB), and the 20,000-file hard limit
  counted in `dist/`.
- No secrets, no remote D1 or R2, no request to the deployed site, no schedule.
  `npm run check:ci-workflow` (`scripts/check/rules/ci-workflow.mjs`, in tier 1) fails if any
  of that changes.
- Do not push a branch to test CI: a pushed branch is a public Pages preview. Use
  `npm run check:clean`.

**4. Opt-in remote.** Run these by hand after a publish.
- `verify` needs wrangler signed in. It runs `verify:proxies`, `verify:map-tokens`,
  `verify:deploy`, `verify:source-cache`, `verify:records` and `check:r2-parity`. `verify:records` is bounded: one statement per wrangler call, 50 keys
  sampled per table, no table scanned. Since data phase 3 it covers the maps, layers and
  catalogue tables too, which is what `verify:catalogue-d1` did for the old catalogue database.
- `verify:public` needs no credentials. It runs the CDN byte-range check
  (`verify:test:pmtiles-cdn`), `verify:proxies`, `verify:deploy` and `verify:browser`
  (production-parity specs with `--retries 2`, `scripts/publish/verify-browser.mjs`).
- The publish script (`scripts/publish/publish.sh`) runs its own bounded records verify.

## What guards what (tier 1, the `npm run check` chain)

| Area | Checks |
|---|---|
| Publication rights and sources | `check:approved-publication`, `check:raw-source-documents`, `check:medium-priority-publication`, `check:peatland-geoportal`, `check:external-sources`, `check:election-source-enrichments`, `check:ni-register-interests`, `check:book-files`, `check:r2-allowlist`, `check:public-prefixes` |
| Pages deploy limits and routing | `check:pages-assets` (`scripts/build/site.mjs --check`: what `dist/` would hold, 18,500 files, 25 MiB each; `tests/unit/site-build.test.mjs` holds the allow-list to what the pages name), `check:routes-manifest`, `check:method-guards`, `check:asset-refs`, `check:root`, `check:test2` (`/test2/` is a 301 and `test2/sw.js` the kill switch), `check:map-tiles` (the layer metadata, tile budgets and CDN manifest) |
| Election records | `check:provenance` (provenance budget and freshness), `check:candidate-name-party`, `check:graph`, `check:browse-contract`, `test:elections-unit`, `test:browse-pages` |
| Maps catalogue (the tracked sources data phase 3 loads into D1; phase 4 replaces most) | `check:c1-coverage`, `check:catalogue-render-parity`, `check:catalogue-display-fields`, `check:render-time-series`, `check:test-index-parity`, `check:public-map-count`, `check:browse-hidden`, `check:catalogue-file-urls`, `check:provider-names`, `check:shared-file-attribution`, `check:composite-relations`, `check:polygon-labels`, `check:vector-promote-id`, `check:chunked-bounds`, `check:tile-freshness`, `check:tile-content` |
| Map-layer intake | `check:intake-delivery`, `check:source-paths`, `check:composite-composition`, `test:intake-validators`, `test:intake`, `check:types:intake` (checkJs over the typed intake modules, scripts/intake/tsconfig.json) |
| Committed generated files | `check:site-figures`, `check:status`, `check:sitemap`, `check:corpus-index`, `check:notices`, `check:og-preview`, `check:site-partials`, `check:i18n`, `check:viewer-parity`, `check:browse-cache`, `check:app-shell-cache` |
| Site and docs hygiene | `check:site-nav`, `check:doc-status`, `check:doc-paths`, `check:dir-names`, `check:local-paths`, `check:ci-workflow`, `lint`, `lint:functions-strict`, `check:types:functions` (the Pages Functions type-check by JSDoc and `checkJs`, `functions/tsconfig.check.json`: strict null checks, no implicit-any yet; runtime types in `functions/_lib/runtime.d.mts`) |
| Browser UI types (Browse, the apps, `assets/ui`) | `check:types:ui` (`tsconfig.ui.json`: JSDoc types and `checkJs`, nothing emitted; `tests/unit/ui-types.test.mjs` holds every UI script to the allowlist, which only grows, and forbids `@ts-ignore`/`@ts-nocheck`); `test:unit`: `tests/unit/ui-state-machines.test.mjs` (the Browse and PRONI Search state machines refuse every move their tables do not list; `assets/ui/state/machine.js` is a byte copy of `scripts/lib/state-machine.mjs`), `tests/unit/ui-module-tokens.test.mjs` (each page's import map versions every module its entry script imports at the file's hash); tier 2: `tests/browser/ui-state-machines.spec.js` drives those machines on the pages, and `test:browser:shell` also renders `/design-system/` at both widths and themes with axe |
| Browser UI strictness and the site theme (r2-ui) | `check:types:ui` also runs `tsconfig.ui-strict.json` (full `strict` over the state-machine modules and the gallery script; `tsconfig.ui.json` has every strict-family flag but strictNullChecks and noImplicitAny, and `tests/unit/ui-types.test.mjs` keeps both from loosening); `test:unit`: `tests/unit/ui-theme.test.mjs` runs the head theme bootstrap and `assets/site/site-chrome.js` against the theme table in `assets/ui/state/theme.js` for every stored value and system setting, and fails when site-chrome.js's copy of the table drifts; `tests/unit/ui-state-machines.test.mjs` walks the Words tooltip and PRONI copy toggles; tier 2: `tests/browser/words-explorer.spec.js` (tooltip by pointer and across a redraw) and `tests/browser/ui-state-machines.spec.js` (PRONI copy confirmation) |
| Code units | `test:unit`, `test:settle-outcome`, `test:scoped-writes`, `check:contributions`, `check:facts`, `test:facts` |
| Types (REFACTOR-PLAN.md item 2, JSDoc + `checkJs`) | `check:types:records` (`scripts/lib/typecheck.mjs tsconfig.records.json`: `scripts/lib/` and `scripts/records/` type-check clean; errors in the files they import from other folders are listed as notes, not failures; `tests/unit/typecheck.test.mjs` keeps the allowlist from shrinking and forbids `@ts-nocheck` and `@ts-ignore` there); `check:types:pipeline` (the same runner over `tsconfig.pipeline.json`: `scripts/publish/`, `scripts/i18n/`, `scripts/maps/` and `scripts/dev/`, strictNullChecks on), `check:types:mapapp` (`src/tsconfig.check.json`: the map app's pure modules under `src/` and the shared state-machine helper they import, type-checked clean, no strict null checks yet; `tests/unit/map-typecheck.test.mjs` keeps the allowlist from shrinking and forbids suppressions there) |
| Versioned API, config, storage, gallery (REFACTOR-PLAN.md) | `test:unit`: `tests/functions/api-v1.test.mjs` (every `/api/v1` route is its `/_api` handler and answers alike; every `/_api` route is in v1 or excluded with a reason), `tests/unit/config.test.mjs` (the config module equals `wrangler.toml`, `scripts/records/paths.mjs`, the shell and `_records.js`; every `env.X` a Function reads is known), `tests/unit/storage.test.mjs` (one contract over the D1 and SQLite stores), `tests/functions/design-system.test.mjs` (the gallery shows every component and is noindex), `tests/functions/api-v1-contracts.test.mjs` (every v1 variant's answer fits its JSON Schema in `functions/_lib/api/contracts/v1.js`, over the records build when present and over stubs and fixtures otherwise; no incompatible change against `tests/functions/api-v1-contracts.baseline.json`; `/api/v1/openapi.json` covers every route), `tests/functions/state-machines.test.mjs` (the Functions' state machines: the contribution statuses, the records answer ladder, the rebuild gate's slots, the dataset phases and the modes; every move a table does not list is refused), `tests/functions/named-queries.test.mjs` (no Function calls the D1 engine API outside `functions/_lib/storage/`; every named query in `packages/api/src/queries/` prepares on its database; the SQLite-only features they use are listed) |

## Outside the tiers

These run only when someone names them. They are not part of any gate.
- **Map app browser scripts named for `/test2`.** `test:performance:test2`,
  `test:performance:test2:cold`, `check:performance:test2:cold`, `test:visual:test2` and
  `audit:test2:parity` measure or compare the live map app; they keep their old names until
  the script renames (renames.csv).
- **Reports and curator tools.** `audit:test2:elections` (the blocking half is in
  `check:test2`), `catalogue:check`, `records:verify` (local),
  `monitor:test2:cdn` (network), `lint:strict`, `test:browser` (the whole Playwright
  directory) and `check:intake` (an alias of four tier 1 steps).

## Retired

Retired on 7 November 2026 with data phase 4 (the leftovers: data-architecture DESIGN.md phase 4):
- **`check:proni-roots`, `verify:proni-roots` and `build:proni-roots`, and their script
  build-proni-roots.mjs (deleted), with the committed `data/browse/proni-roots.json`.** The file
  answered 301 to `/_api/proni/node` since phase 3, which reads the PRONI database itself.
  `sitemaps/proni.xml` stays committed as it is (build-sitemap.mjs keeps a group whose source is
  absent).
- **The committed per-layer sidecars** `render/metadata/layer-details-test2/` and
  `duplicate-feature-ids/` (about 1,670 files). Production answers their URLs from D1 since
  phase 3; `npm run build` now writes them to `tmp/layer-metadata/` for the local test server.
- **The subtractive Pages output.** The output directory is `dist/` (wrangler.toml), built by
  `scripts/build/site.mjs` from an explicit allow-list; validate-pages-file-budget.mjs
  (which modelled the root output through `.cfignore`, a file the Git-integrated build never
  read) is deleted, `check:pages-assets` runs `site.mjs --check`, and `scripts/build/clean-for-pages.sh`
  only runs `site.mjs` until the dashboard's build command is `npm run build:site`.
- **Browse's data token** (`BROWSE_DATA_VERSION` in browse.js): `/data/browse/` and `/_api/`
  answer with an ETag of the dataset version.
- **The R2 reads of `/data/browse/` and `/data/graph/`.** Every old file kind is rebuilt from
  D1 (functions/data/browse, functions/data/graph; migration 0004 adds `graph_files`, the keys
  each old graph file held). **New:** `tests/records/legacy-files.test.mjs` (in `records:check`:
  a sample of every file kind deep-equal to the build's files; the 301s, 404s and HEAD) and
  `scripts/records/legacy-files-crawl.mjs` (the same comparison over HTTP, against
  `wrangler pages dev` or, after a publish, production).
- **The rebuild of `graph_files` on every build** (7 Nov 2026, owner). It is frozen as loaded at
  go-live: records:build carries it forward from the last-loaded snapshot, else the previous
  build (`scripts/records/graph-files-freeze.mjs`), and records the files whose keys have changed
  since in `tmp/records/graph-files-drift.json`, which the legacy-files test and crawl skip.
  **New:** `tests/records/graph-files-freeze.test.mjs` (a carried table gives a delta with no
  `graph_files` row) and `tests/records/legacy-burst.test.mjs` (the old file URLs under a burst:
  the long edge cache, the R2 copy before D1 for the heavy legacy kinds, the gate on concurrent
  rebuilds; cachedJson's `stable`, `edgeTtl`, `gate` and `r2Key` options).

Retired on 7 November 2026 with data phase 3 (the maps, layers and catalogue load into the
records database; PHASE3.md):
- **`check:catalogue-sql`, `build:catalogue-d1`, `verify:catalogue-d1` and `deploy:catalogue`,
  and their scripts build-catalogue-d1-import.mjs, validate-catalogue-d1-parity.mjs and
  deploy-catalogue-d1.mjs (deleted).** The catalogue is a table of the records load: the
  records build replaces the import SQL, `records:deploy` the load and `verify:records` the
  parity check. The `civgraph-catalogue` database is unbound and kept for the rollback window.
- **New in the same change:** `tests/records/maps-delta.test.mjs` (in `records:check`: the
  first load inserts the new tables whole, one new map changes one row) and
  `tests/functions/maps.test.mjs` (in `test:unit`: every phase-3 route against the real
  sources, the byte-identical documents, the 301s and the layer-id aliases).

Retired on 7 November 2026 with the legacy `/render/` and `/test2/` apps (site restructure F5):
- **The apps.** `render/index.html`, `render/build/`, `render/src/app.js` and the modules only it
  used, and `test2/index.html` are deleted. Their pages answer 301 to `/maps/` (`_redirects`,
  with `/test/` and `/maps/test/`); `/render/metadata/*` keeps answering. `render/sw.js` and
  `test2/sw.js` are now one kill switch (also served at `/test/sw.js` by a 200 rule) that
  unregisters the old worker, clears its caches and moves its open pages to `/maps/`; the map
  app asks the browser to check those workers (`src/map/app/retire-legacy-workers.mjs`).
- **Checks of the app.** `check:test` and `check:render-app` (validate-test-shell-parity.mjs,
  validate-test-security.mjs, validate-test-production-route.mjs, deleted), and `build:test`
  (build-test-app.mjs). validate-test-app.mjs keeps its layer-metadata checks, which guard the
  live app, and runs in `check:map-tiles`, which takes `check:test`'s place in `check`.
- **Browser scripts of the app.** `test:browser:test` (test-app.spec.js), `smoke:test:mobile`,
  `test:performance:test`, `test:visual:test` and scripts/test-static-server.mjs; also
  time-series-panel.spec.js (the `/render/` picker) and test2-redirect.spec.js (the client-side
  `/test2/` page, now a 301).
- **New:** `tests/unit/retired-service-worker.test.mjs` and
  `tests/unit/retire-legacy-workers.test.mjs` (in `test:unit`: the kill switch's pinned bytes,
  the addresses that serve it, the 301s matched as Pages matches them by
  `scripts/lib/pages-redirects.mjs`, and what it does in a fake worker scope), and
  `tests/browser/retired-service-worker.spec.js` (in `test:browser:maps`: Chromium installs each
  old worker and watches the kill switch retire it, for an open page and a returning visitor).

Retired on 7 November 2026 (checks and CI):
- **`check:elections-schema`, `build:elections-schema` and their script,
  validate-elections-schema.mjs (deleted).** They compared a gitignored schema dump with the
  live `civgraph-elections`, which no longer serves the site. The records schema is
  `migrations/`, and `verify:records` compares it with D1.
- **The browser specs elections-api-fallback.spec.js and elections-api-parity.spec.js
  (deleted).** The client has no static fallback any more (`app/src/election-manager.js`
  `loadBundle`), and both "paths" are now D1, so there is nothing left to compare.
- **The nightly `verify` job in `ci.yml`, and `verify:ci`.** CI no longer queries
  production; the same checks are in `verify:public`.
- **Duplicates.** `check:test:ci` and `check:test:ci-safe` (`check:test` plus the CDN probe,
  which is in `verify:public`), and `monitor:test:cdn` (the same script as
  `verify:test:pmtiles-cdn`).
- **Dead entries.** `test:browser:test2` (its spec file is gone) and `check:browse-index-sql`
  (no import SQL exists since the records loader).

Retired earlier: `check:elections-d1` and `deploy:elections-d1` (6 Nov), and
`data-readiness.yml`, `test-readiness.yml` and `pages-build.yml` (folded into `ci.yml`).

## Adding a check, and where data phase 3 plugs in

- **A rule about committed source files:** add a `check:<name>` script and append it to the
  `npm run check` chain in `package.json`. `check:fast`, `check:clean` and CI pick it up
  with no other change. Give it a negative control: break the input, see red, restore.
  Name it in this file too: `check:ci-workflow` fails while any check, test or verify script
  is missing from it.
- **A database constraint or assertion query:** add a test under `tests/records/`.
  `records:check` runs it in CI (through `BUILD_STEPS`) and in `check:full`. This is where
  the map, layer and catalogue constraints go. Data phase 3 loads the tracked sources as
  they are, so the "maps catalogue" row above still guards them; those checks go as phase 4
  (the per-map source split) removes each copy:
  - by construction: `check:catalogue-render-parity`, `check:catalogue-display-fields`,
    `check:render-time-series`, `check:test-index-parity`, `check:public-map-count`;
  - as constraints: `check:c1-coverage`, `check:provider-names`, `check:catalogue-file-urls`,
    `check:shared-file-attribution`, `check:composite-relations`, `check:polygon-labels`,
    `check:vector-promote-id`.
  Phase 3 already retired `check:catalogue-sql` (by construction) and `verify:catalogue-d1`
  (into `verify:records`).
- **A build the checks need:** add it to `BUILD_STEPS` in `scripts/check/clean.mjs` (CI and
  `check:clean` share it). If a change makes `tmp/records` much larger, re-measure against
  the runner: the check job's last step prints `df` and `du`.
- **A new `/_api` route:** decide whether it is public data. Add it to `ROUTES` in
  `functions/_lib/api/v1.js` (and it answers at `/api/v1/` too), or to `EXCLUDED` there with the
  reason; `tests/functions/api-v1.test.mjs` fails until one is done, and a new v1 route needs a
  contract in `functions/_lib/api/contracts/v1.js` (`tests/functions/api-v1-contracts.test.mjs`;
  additions go into the baseline with `API_CONTRACT_BASELINE=write`). A new binding or runtime
  variable goes into `functions/_lib/config.js` (`tests/unit/config.test.mjs`), and a new UI
  component stylesheet needs a specimen in the gallery (`functions/design-system/index.js`).
- **A check that needs the network:** it belongs in tier 4. Add it to `verify` (credentials)
  or `verify:public` (none), never to `check`.
