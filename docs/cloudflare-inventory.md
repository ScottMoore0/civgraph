# Cloudflare inventory

What civgraph.net runs on, and what every Pages Function expects to be bound.

Written 2026-08-10. **None of this configuration lives in the repository** —
there is no `wrangler.toml`, no `_routes.json` and no deploy workflow. The Pages
project, its build command and every binding below are configured in the
Cloudflare dashboard. That is the single biggest obstacle to an outside
developer understanding the deployment, and this file exists to close the gap
until the configuration itself is version-controlled.

Every binding was verified against production, not read off a config file. Each
Function degrades with an explicit `503 … binding not configured`, which makes
the live state observable by calling the endpoint.

---

## Bindings

| Binding | Type | Used by | Production |
|---|---|---|---|
| `PRONI_DB` | D1 (`proni-catalogue`) | `_api/proni/{search,count,node,export,_query}.js` | live |
| `PRONI_KV` | KV | `_api/proni/search.js` | optional cache |
| `ELECTIONS_DB` | D1 | `_api/elections/index.js` | live |
| `SPATIAL_INDEX` | KV | `_api/search.js`, `_api/spatial.js` | live |
| `MAPS_BUCKET` | R2 (`boundaries-data`) | `data/maps/[[path]].js` | live |
| `CIVGRAPH_SUBMISSIONS` | R2 (`.put`) | `_api/contributions/submit.js` | **no matching resource** |
| `CIVGRAPH_CONTRIBUTION_QUEUE` | KV (`.put`) | `_api/contributions/submit.js` | **no matching resource** |
| `CIVGRAPH_ADMINS` / `CIVGRAPH_CONTRIBUTORS` | vars (email lists) | `_api/_auth.js` | live |
| `CIVGRAPH_DEV_AUTH_EMAIL` | var | `_api/_auth.js` | dev only |

`_api/_auth.js` and `_api/contributions/submit.js` each read their binding under
three names — `CIVGRAPH_*`, `CONTRIBUTOR_*`/`CONTRIBUTION_*`, and `BROWSE_*`.
That is legacy tolerance from renames, not three separate bindings. Configure
the `CIVGRAPH_*` form; the others are fallbacks.

### Verified live

    /_api/proni/search?q=belfast   200, real results   -> PRONI_DB bound
    /_api/elections/?limit=1       200, real elections -> ELECTIONS_DB bound
    /_api/spatial?mapId=…          200, real features  -> SPATIAL_INDEX bound
    /_api/search?q=down            200, real results   -> SPATIAL_INDEX bound
    /_api/auth/status              200, unauthenticated
    /_api/rum                      405 to GET by design (POST only)

`ELECTIONS_DB` being live corrects an earlier project note recording the binding
as still pending. It is bound and serving.

---

## D1 databases

### `proni-catalogue` → `PRONI_DB`

SQLite with an external-content FTS5 index. Tables queried by the Functions:

    proni          the catalogue records
    proni_fts      FTS5 index over them

Build and import are documented in `proni-search-deploy.md`. The constraints
that runbook records are worth repeating because they are not obvious:

- D1 rejects a single SQL statement over ~100 KB (`SQLITE_TOOBIG`), so the
  import is emitted as parts of ≤100 rows per statement, ~60k rows per file.
- `wrangler d1 import` does not exist. The load path is
  `wrangler d1 execute --file`.
- Inserts are `INSERT OR IGNORE` so a retried part is safe, and an
  `AFTER INSERT` trigger builds the FTS index incrementally rather than in one
  heavy rebuild.
- The free tier caps D1 at 100k row-writes/day and the import is ~1.5M rows, so
  the import needs the Workers Paid plan. Search itself is read-only and fits
  the free tier, so the plan can be dropped afterwards if the data is static.

### Elections → `ELECTIONS_DB`

Tables queried by `_api/elections/index.js`:

    constituencies          per-election constituency records
    counts                  count-by-count vote totals
    constituency_features   layer/feature matches per constituency
    constituency_animation  per-constituency animation payloads

Keyed by `election_key` (e.g. `dail-eireann__1918-12-14`) and
`constituency_seq`. **No schema DDL for this database exists in the repository**
— the shape above is inferred from the queries. That is a gap worth closing.

---

## R2

Bucket `boundaries-data`, bound as `MAPS_BUCKET`, also served publicly at
`data.civgraph.net`.

`functions/data/maps/[[path]].js` owns the whole `data/maps/*` prefix, and this
is the most important thing to understand about the deployment:

**The Function wins over any repo copy.** Proven by fetching a file present in
both — production returned the 4,300,570-byte R2 object where the repo held
3,422,232 bytes. `data/maps` is therefore no longer tracked in git; the bucket
is authoritative. A file added to the repo under that prefix will *not* be
served.

Content encoding is handled deliberately: pre-compressed `.br`/`.gz` keys are
served directly with the matching `Content-Encoding` for binary FGB streams,
while JSON is served uncompressed from the base key, because the Pages Function
path does not reliably decode a manually-set `Content-Encoding` for
`fetch().json()` and Cloudflare's edge compresses it on the wire anyway.

Credentials for direct S3-API access live in `.env.local` (gitignored):
`R2_S3_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

### Publication gate

Anything written to this bucket is public. `scripts/lib/r2-publication-gate.mjs`
enforces a tracked allowlist at `data/database/r2-publication-allowlist.json`
(10 prefixes), and every upload script calls `assertPublishable()` before
sending a byte. Uploads outside the allowlist fail closed.

`scripts/validate-r2-serving-parity.mjs` (in `npm run check`) asserts the
converse: everything the catalogue references under an R2-served prefix must
exist in the bucket. It exists because two production outages had the same
shape — a file present in the repo, absent from the bucket, and a request that
looked healthy from outside.

---

## Pages

- Static assets plus Functions under `functions/`.
- `_headers` (6 KB) sets cache policy. There is no `_redirects` and no
  `_routes.json`.
- `404.html` is present and returns a genuine 404 for missing paths — confirmed
  for `/missing.js`, `/missing.css` and `/app/build/missing.js`.
- `.cfignore` excludes archival and local-only material from the deploy,
  including `scripts/`, `data/census/`, `data/timeline-transitions/` and
  `test/tiles/`.

**`scripts/` is not deployed.** That matters more than it sounds: `src/` *is*
served as unbundled ES modules, so a browser-imported module cannot be moved
into `scripts/` without breaking at runtime.

---

## Account resources, enumerated 2026-08-11

Read off the account with `wrangler`, so this is what exists rather than what is
believed to exist.

    Pages project  civgraph  ->  civgraph.net, boundaries-website.pages.dev
                              git-connected; pushes to main deploy

    D1   proni-catalogue      a66d0846-6186-460d-a7b2-e88918a6b341
    D1   civgraph-elections   cd88f241-35aa-4cbb-bcb3-c80a471b8afa
    KV   PRONI_KV             ef19e1065f854619a19e2cbd62b28f82
    KV   SPATIAL_INDEX        c88a99b42d6d4ce7aba6ba94dce47e5a
    R2   boundaries-data

**That is the complete list** — two D1 databases, two KV namespaces, one bucket.

## What is still undocumented

- **No `wrangler.toml`.** `wrangler.toml.example` at the repo root now carries
  the verified bindings and the activation procedure, but it is deliberately not
  live: Pages treats a committed `wrangler.toml` as authoritative and ignores
  dashboard bindings, so activating it while any binding is unaccounted for would
  drop that binding into a `503`.
- **No DDL for the elections D1.** Its schema is inferred from queries.
- **`CIVGRAPH_SUBMISSIONS` and `CIVGRAPH_CONTRIBUTION_QUEUE` match no resource on
  the account.** The enumeration above is exhaustive and neither name appears in
  it, so unless an existing namespace or bucket is bound under a second name,
  the contribution submission path is not wired up. `submit.js` tries
  `CIVGRAPH_CONTRIBUTION_QUEUE` (KV), then `CONTRIBUTION_QUEUE` (KV), then
  `CIVGRAPH_SUBMISSIONS` (R2), and returns `503` if none is present. A `GET`
  returns `405`, which proves only that the Function routes; the `POST` path was
  not exercised because that would write a real submission. **Worth resolving
  before anyone is invited to contribute through the UI.**
- **The Pages build command is unknown** from the repo. `npm run build` chains
  ~7 steps and `npm run check` runs 26 validators, but whether Pages runs either,
  runs something else, or deploys the tree as committed cannot be determined from
  what is checked in.
- **No `_routes.json`**, and adding one is not a documentation exercise. Its
  absence means Pages' default routing, which currently works. An explicit file
  changes which requests invoke Functions, and `functions/data/maps/[[path]].js`
  owns the prefix every map layer loads from — a mistake there takes out map
  serving site-wide. It should be introduced with a preview deploy, not written
  from inference.
