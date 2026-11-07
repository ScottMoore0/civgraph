# Checks

> **Status: current, 7 November 2026.** Area 4 of the site restructure (checks and CI).
> Every check, test and verify script is in exactly one tier below.

## The four tiers

| Tier | Command | Reaches the network? | Runs |
|---|---|---|---|
| 1. Fast local | `npm run check:fast` | no | after a change, by you; `npm run rebuild` runs it (or the app subset) for what changed |
| 2. Full local | `npm run check:full`, and `npm run check:clean` | see note | before you hand a branch over |
| 3. CI | `.github/workflows/ci.yml` (`npm run check:ci`, `npm run test:browser:maps`) | no | every push to main and every pull request |
| 4. Opt-in remote | `npm run verify`, `npm run verify:public` | yes, bounded | by hand, after a publish; never by default, never in CI |

**1. Fast local.** `check:fast` (`scripts/run-checks.mjs`) runs every step of `npm run check`
in parallel and prints only the failures. It is offline: nothing in it reads a remote
database, R2 or the deployed site. Many steps read build output (the app build, the
catalogue import, `tmp/records`), so run `npm run rebuild` first, which builds what the
changed files need and then runs the checks.

**2. Full local.**
- `check:full` is tier 1, then `records:check` (the records database tests in
  `tests/records/`), `test:browser:maps` (the map app at `/maps/`), `test:catalogue` and
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
- `check:clean` (`scripts/check-clean.mjs`) exports exactly what a commit would contain into
  a temporary directory, links `node_modules`, runs the CI builds and the tier 1 checks
  there, and unlinks `node_modules` before deleting the export. A check that needs a
  gitignored file fails here as it would in CI. It needs about 11 GB of free space for the
  records build.

**3. CI.** One workflow, `.github/workflows/ci.yml`, with no path filters: a validator
whose inputs fell outside a filter never ran (the `docs/**` gap, closed 2026-09-20).
- Job `check`: free disk (the records build writes about 10.8 GB; a runner guarantees
  14 GB), `npm ci`, then `npm run check:ci`, which is `check:clean`'s build-and-check run in
  place. The builds are `npm run build`, `records:build` and `records:check` (`BUILD_STEPS` in
  `scripts/check-clean.mjs`); since data phase 3 the records build also loads the maps,
  layers and catalogue, so there is no separate catalogue import. Then the browser specs of
  the map app (`test:browser:maps`), in the same job because they read the records build's
  election documents: `scripts/test-server.py` serves those URLs from `tmp/records`, as
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
- Job `pages-build`: the Pages build exactly as Cloudflare runs it, the 18,500-file and
  25 MiB-per-file budget (`scripts/validate-pages-file-budget.mjs`), and the 20,000-file
  hard limit on disk after `scripts/clean-for-pages.sh`.
- No secrets, no remote D1 or R2, no request to the deployed site, no schedule.
  `npm run check:ci-workflow` (`scripts/validate-ci-workflow.mjs`, in tier 1) fails if any
  of that changes.
- Do not push a branch to test CI: a pushed branch is a public Pages preview. Use
  `npm run check:clean`.

**4. Opt-in remote.** Run these by hand after a publish.
- `verify` needs wrangler signed in. It runs `verify:proxies`, `verify:map-tokens`,
  `verify:proni-roots`, `verify:deploy`, `verify:source-cache`, `verify:records` and
  `check:r2-parity`. `verify:records` is bounded: one statement per wrangler call, 50 keys
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
| Pages deploy limits and routing | `check:pages-assets` (18,500 files, 25 MiB each), `check:routes-manifest`, `check:method-guards`, `check:asset-refs`, `check:root`, `check:test2`, `check:test` (the legacy `/render/` app, until F5) |
| Election records | `check:provenance` (provenance budget and freshness), `check:candidate-name-party`, `check:graph`, `check:browse-contract`, `test:elections-unit`, `test:browse-pages` |
| Maps catalogue (the tracked sources data phase 3 loads into D1; phase 4 replaces most) | `check:c1-coverage`, `check:catalogue-render-parity`, `check:catalogue-display-fields`, `check:render-time-series`, `check:test-index-parity`, `check:public-map-count`, `check:browse-hidden`, `check:catalogue-file-urls`, `check:provider-names`, `check:shared-file-attribution`, `check:composite-relations`, `check:polygon-labels`, `check:vector-promote-id`, `check:chunked-bounds`, `check:tile-freshness`, `check:tile-content` |
| Map-layer intake | `check:intake-delivery`, `check:source-paths`, `check:composite-composition`, `test:intake-validators`, `test:intake` |
| Committed generated files | `check:site-figures`, `check:status`, `check:sitemap`, `check:proni-roots`, `check:corpus-index`, `check:notices`, `check:og-preview`, `check:site-partials`, `check:i18n`, `check:viewer-parity`, `check:browse-cache`, `check:app-shell-cache` |
| Site and docs hygiene | `check:site-nav`, `check:doc-status`, `check:doc-paths`, `check:dir-names`, `check:local-paths`, `check:ci-workflow`, `lint`, `lint:functions-strict` |
| Code units | `test:unit`, `test:settle-outcome`, `test:scoped-writes`, `check:contributions`, `check:facts`, `test:facts` |

## Outside the tiers

These run only when someone names them. They are not part of any gate.
- **Legacy `/render/` and `/test2` browser scripts.** They retire with the `/render/` app
  (F5): `smoke:test:mobile`, `test:performance:test`, `test:performance:test2`,
  `test:performance:test2:cold`, `check:performance:test2:cold`, `test:visual:test`,
  `test:visual:test2`, `test:browser:test`, `audit:test2:parity`. The same goes for the
  sub-chains `check:map-tiles` and `check:render-app` (both are inside `check:test`).
- **Reports and curator tools.** `audit:test2:elections` (the blocking half is in
  `check:test2`), `catalogue:check`, `records:verify` (local),
  `monitor:test2:cdn` (network), `lint:strict`, `test:browser` (the whole Playwright
  directory) and `check:intake` (an alias of four tier 1 steps).

## Retired

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
- **A build the checks need:** add it to `BUILD_STEPS` in `scripts/check-clean.mjs` (CI and
  `check:clean` share it). If a change makes `tmp/records` much larger, re-measure against
  the runner: the check job's last step prints `df` and `du`.
- **A check that needs the network:** it belongs in tier 4. Add it to `verify` (credentials)
  or `verify:public` (none), never to `check`.
