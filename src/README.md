# `src/` — shared browser modules, served unbundled

> **Status: current — this directory is live and load-bearing.**

## If you have been told this is the dead Leaflet stack, it is not

That belief was widespread inside this repository until 2026-08-17, and it was
wrong in a way that cost real money in attention:

- `docs/review/TECH-DEBT-AUDIT.md` item 4 asserted it, and scored a remediation
  plan on it. Corrected.
- `eslint.config.mjs` excluded this directory **on that basis**, so 36,028 lines
  of live code had no linter at all until the exclusion was lifted. When it was,
  the result was 32 warnings and **zero errors** — this is not neglected code.
- `README.md` documented the pre-rename layout for months, which is where the
  belief came from.

The confusion has a specific cause. `js/` **was** the Leaflet stack, and it was
*renamed* to `src/` in `fb5d246cad` ("Archive the Leaflet stack and rename js/ to
src/"). Only the genuinely dead parts moved to `archive/leaflet/`. Everything that
stayed is in use. Counted across this directory, Leaflet references: **two**, both
in `feature-loader.js`.

## What imports it

`app/src/app.js` — the entry point of the public homepage — imports from here on
lines 1–3 and drives `ui-controller` throughout: `init()`, feature-info display,
split-pane state, catalogue rendering, and the whole election wiring block.

```js
import dataService, { resolveMapDownloadUrl } from '../../src/data-service.js';
import featureLoader from '../../src/feature-loader.js';
import uiController from '../../src/ui-controller.js';
```

## Served unbundled — which constrains where these files may live

These are fetched by the browser as ES modules, **not** compiled into
`app/build/`. So a module here cannot be moved into `scripts/` (which is not
deployed at all) without breaking at runtime. That is the practical difference
between the two directories, and it is easy to get wrong because both look like
"source".

## What is in here

| File | Lines | Role |
|---|---|---|
| `ui-controller.js` | 11,620 | catalogue, split-pane, search, feature info. Largest hand-written file in the repository, and holds `c1Cards` — one of the catalogue's three stores. |
| `data-service.js` | 751 | catalogue and book metadata; fetches `/_api/catalogue` with the tracked file as fallback |
| `election-domain.mjs` | 1,240 | election data model |
| `jquery-shim.js` | 556 | jQuery emulation kept so older DOM code in `app/src/election-manager.js` need not be rewritten. Real debt; see the audit. |
| `feature-loader.js` | 460 | viewport-aware feature loading |
| `election-renderer.mjs` | 501 | results rendering |
| `election-view-model.mjs` | 217 | view model for the above |
| `election-main-pane-contract.mjs` | 154 | contract between panes |
| `fgb-worker.js` | 110 | FlatGeobuf decode, off the main thread |
| `election-utils.js`, `cdn-url.js` | 57, 32 | shared helpers |
| `libs/`, `sql.js-httpvfs/` | — | vendored third-party. Excluded from linting; not ours to fix. |

## The name is still wrong

`src/` at the repository root reads as *the source of the site*, and it is not —
the site builds from `app/src/`. Renaming is planned (`docs/directory-rename-runbook.md`)
but invalidates clones, so it is scheduled rather than done. Until then this file
is the mitigation.
