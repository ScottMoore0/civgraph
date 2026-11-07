# `functions/` — Cloudflare Pages Functions

> **Status: current — this is the site's entire server side.**

File-based routing: the path under `functions/` is the URL. `_api/persons/index.js`
serves `/_api/persons`. Files prefixed `_` are shared modules, not routes.

## The API

| Route | Backed by | Notes |
|---|---|---|
| `_api/elections/` | D1 `civgraph-records` | The default election transport in production. Schema: `migrations/` (the records loader, `scripts/records/`). |
| `_api/persons/`, `_api/sources/`, `_api/register-interests/` | D1 | All three are thin wrappers over `_api/_browse-index.js`. |
| `_api/catalogue/` | D1 `civgraph-catalogue` | |
| `_api/proni/` | D1 `proni-catalogue` | Powers the `/proni` app. |
| `_api/contributions/` | KV `CIVGRAPH_CONTRIBUTION_QUEUE` | Map submissions. |
| `data/browse/[[path]].js`, `data/graph/[[path]].js` | D1 `civgraph-records` | The old Browse and graph file URLs (90 days from 6 Nov 2026), each file rebuilt in its shape from the records tables (`graph_files`, frozen as loaded at go-live, holds which keys each graph file held); older layouts answer 301. Cached at the edge for 30 days (the graph's without the dataset version); the heavy rebuilds go through a per-isolate gate (`cachedJson` options in `_api/_records.js`); the heavy graph kinds and the Browse files no page reads any more answer from their R2 copy first, the graph's bulk dumps from R2 then 301 to the downloads. |
| `browse/<type>/[[path]].js` | D1 `civgraph-records`, R2 | Path-style Browse record pages (`/browse/persons/<slug>`): the Browse shell with the record's title, description and canonical link, for search engines. Shared code in `_browse-page.js`; listed in `sitemap.xml`. |
| `404.js` | static `404.html` | Serves `/404` with a 404 status rather than 200. |

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

## Linting

These are linted more strictly than the rest of the repository
(`npm run lint:functions-strict`) because they run on every request and there is
no browser console to notice a mistake in.
