# `functions/` — Cloudflare Pages Functions

> **Status: current — this is the site's entire server side.**

File-based routing: the path under `functions/` is the URL. `_api/persons/index.js`
serves `/_api/persons`. Files prefixed `_` are shared modules, not routes.
Since PKG-8 (8 Nov 2026) every route file under `_api/` and `api/` is a one-line re-export of
its handler in `packages/api/src/handlers/` (the same tree) or `packages/api/src/v1/`; edit the
handler there. The `_` helpers there are re-exports kept until 8 Dec 2026.

## The API

| Route | Backed by | Notes |
|---|---|---|
| `_api/elections/` | D1 `civgraph-records` | The default election transport in production. Schema: `migrations/` (the records loader, `scripts/records/`). |
| `_api/persons/`, `_api/sources/`, `_api/register-interests/` | D1 | All three are thin wrappers over `_api/_browse-index.js`. |
| `_api/catalogue/`, `_api/layers/` | D1 `civgraph-records` | The map catalogue and the layer metadata (data phase 3). |
| `_api/proni/` | D1 `proni-catalogue` | Powers the `/proni` app. |
| `_api/contributions/` | KV `CIVGRAPH_CONTRIBUTION_QUEUE` | Map submissions. |
| `data/browse/[[path]].js` | D1 `civgraph-records` | The Browse files browse.js still reads (index, persons, sources, register-interests and their shards, parties, offices, maps, features, elections.json, details), each rebuilt in its shape from the records tables; older layouts answer 301 (map-features/ to data.civgraph.net). Every other path answers 410 Gone since 8 Nov 2026 (owner ended the 90-day window early). |
| `data/graph/[[path]].js` | R2 | The old graph file URLs answer 410 Gone since 8 Nov 2026, except the bulk dumps (statement-shards/, exports/): the R2 copy while it is there, then 301 to https://data.civgraph.net/downloads/. |
| `browse/<type>/[[path]].js` | D1 `civgraph-records`, R2 | Path-style Browse record pages (`/browse/persons/<slug>`): the Browse shell with the record's title, description and canonical link, for search engines. Shared code in `_browse-page.js`; listed in `sitemap.xml`. |
| `id/[[path]].js` | D1 `civgraph-records` | The graph's linked-data identifiers, `https://civgraph.net/id/<kind>:<slug>` (the JSON-LD export's `cg:` prefix): a 303 See Other to the record's page, or to Browse's entity page for an entity with none; a retired id to the entity it became; 404 for an id the graph does not hold. Handler in `packages/api/src/pages/id.js`. |
| `404.js` | static `404.html` | Serves `/404` with a 404 status rather than 200. |

## The versioned API: `/api/v1/*`

`/api/v1/<route>` is the public, versioned address of each `/_api/<route>` above
(`api/[[path]].js` over `packages/api/src/v1/`; the route file re-exports `packages/api/src/v1/route.js`). It hands the request to the very same handler
(`packages/api/src/v1/delegate.js`), so the two answer byte for byte alike; `/_api/*` stays, for good, as
the alias the site's own pages call. `/api/` lists the versions, `/api/v1/` the routes, and
`/api/v1/openapi.json` is the OpenAPI 3.1 document, built at request time from the route table
(`packages/api/src/v1/v1.js`) and the contracts (`packages/api/src/v1/contracts/v1.js`). Read-only: anything but GET
and HEAD is 405.

### Versioning policy

- **Within a version, changes are additions only.** A new route, a new parameter, a new view or
  variant, a new field, a new optional behaviour: all compatible. Clients must ignore fields
  they do not know.
- **Anything else is a new version**: removing or renaming a route, parameter or field;
  changing a field's type or meaning (a number becoming a string, a field becoming nullable);
  adding a value to a field clients switch on; changing an error envelope or a status code.
- **A new version is a new table beside the old one**: `packages/api/src/v1/v2.js` with its own routes and
  `packages/api/src/v1/contracts/v2.js`, registered in `api/[[path]].js`'s `VERSIONS`. Its routes may
  delegate to new handlers or to the v1 ones. v1 keeps answering.
- **When v2 exists**, set `successor` in `V1` (`packages/api/src/v1/v1.js`) to v2's
  `{ version, prefix, routes }`: every v1 answer for a route v2 also serves then carries
  `Link: </api/v2/...>; rel="successor-version"` (`lifecycleHeaders()` in `delegate.js`).
  `sunset` (an HTTP date, sent as the `Sunset` header) is set **only by the owner's decision**;
  none is planned.
- **`/_api/*` is not versioned.** It follows the current version's handlers; the site's pages
  move with it in the same commit.

### Contracts: what holds the policy

`packages/api/src/v1/contracts/v1.js` is a JSON Schema per route and variant (which parameters select it,
what the answer promises) and per route for its errors. A schema promises the fields it lists
in `required`, with their types; deep record bodies are promised at their top level only.
`tests/functions/api-v1-contracts.test.mjs` (in `test:unit`):

- validates real answers of every variant: over the records build when one exists (copy it to
  `tmp/records/` or set `CIVGRAPH_RECORDS_DB`), search and spatial over a KV stub, data-index
  over an R2 stub, the PRONI routes over an in-memory FTS5 fixture, and every route's errors;
- compares the contracts with `tests/functions/api-v1-contracts.baseline.json` and fails on any
  incompatible change (`incompatibilities()` in `packages/api/src/v1/json-schema.js`). Additions pass; take
  them into the baseline with `API_CONTRACT_BASELINE=write node --test tests/functions/api-v1-contracts.test.mjs`
  and commit the file with the change.

A new `/_api` route fails `tests/functions/api-v1.test.mjs` until it is in `ROUTES` or
`EXCLUDED` (`packages/api/src/v1/v1.js`); a new v1 route fails the contracts test until it has a contract.

### v2 candidates (recorded, not changed: v1 keeps them)

Inconsistencies a v2 would settle. None is a bug a v1 client should see fixed under it.

| What | Where in v1 |
|---|---|
| Two error envelopes: `{ error }` and `{ ok: false, error }` | `{ ok: false }` from `catalogue`, `data-index` and the router's own 404/405; `{ error }` everywhere else (each contract's `errors`) |
| `Content-Type` with and without `; charset=utf-8` | without: `elections`, `search`, `spatial`, the PRONI routes |
| CORS on some routes only | `data-index` sends no `Access-Control-Allow-Origin`; every other route sends `*` |
| `limit` caps and defaults differ by route | Browse lists 200; `elections?view=list` 1000 (default all); `graph` 2000 (`q`: 200); `search` 100 (default 25); `proni/search` 60; `data-index` 1000 |
| `search?limit=` that is not a number gives no results (`Math.min(NaN, 100)`) | `search` |
| `proni/search` returns up to `limit + 1` results (the extra one says there is a next page) | `proni/search` |
| Booleans as 0/1 | `elections` index items' `candidateRowsExpected` and `transferDataExpected` (booleans in the bundle and the manifest) |
| One record under two keys | `persons?slug=` (`person` and `record`), `sources?slug=` (`source`, `record`), `register-interests?slug=` (`register-interest`, `record`) |
| `version` a string in `stats`, a number in `layers` | `stats`, `layers` |
| No ETag, so no 304 | `search`, `spatial`, `data-index`, the PRONI routes |
| Not-found texts differ in case and wording | `Not found`, `not found`, `no profile`, `constituency not found` |

## `_browse-index.js` is the one to read first

Three routes share it. It handles slug lookup (matching `key_norm`, `slug` or
`id`), `search_norm LIKE` searching, validated sort columns, faceting and
pagination. A new browsable entity should almost certainly be another thin route
over this rather than new query code.

## Bindings

D1, KV and R2 bindings live in `wrangler.toml`. Two recurring traps:

- **Exported R2 credentials break wrangler's D1 and KV commands** with a bare
  `Authentication error [code: 10000]`. The upload scripts require those
  variables; the D1 scripts clear them. If a D1 command fails that way, that is
  why.
- **Wrangler is transiently flaky.** A failed command that has not obviously
  changed anything is usually worth one retry before investigating.

## Linting and types

These are linted more strictly than the rest of the repository
(`npm run lint:functions-strict`) because they run on every request and there is
no browser console to notice a mistake in.

They are also type-checked (`npm run check:types:functions`, in `npm run check`): TypeScript
reads the JSDoc of every file here with `checkJs` and strict null checks
(`tsconfig.check.json`, so named that the Pages bundler never reads it). The runtime's types
(`caches.default`, D1, KV, R2, the Pages context) are in `_lib/runtime.d.mts`, written by hand
for what the Functions use; a `.d.mts` is never built into a route.
