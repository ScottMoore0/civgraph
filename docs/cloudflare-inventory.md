# Cloudflare inventory

> **Status: current reference — maintain as Cloudflare changes.** The authority
> for bindings is `wrangler.toml`; this file records what is NOT in the repo,
> including dashboard-only state. Verify serving behaviour with
> `npm run verify:proxies`.

What civgraph.net runs on, and what every Pages Function expects to be bound.

Written 2026-08-10; corrected 2026-08-16.

**Bindings now DO live in the repository.** `wrangler.toml` was activated on
2026-08-11 and is authoritative — dashboard bindings are ignored while it
exists. What still does not live in the repo: the Pages build command (a project
setting), Cloudflare Access configuration, and DNS. There is still no
`_routes.json`, deliberately; see the note at the end of this file.

This file's remaining job is to record what the repository cannot show you.

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
| `CIVGRAPH_CONTRIBUTION_QUEUE` | KV (`fca3f869…`) | `_api/contributions/{submit,list,decide}.js` | live, created 2026-08-13 |
| `CIVGRAPH_SUBMISSIONS` | R2 (`.put`) | `_api/contributions/submit.js` fallback | not bound (KV is used) |
| `CIVGRAPH_QUARANTINE` | R2 | `_api/contributions/intake.js` | **not bound — file intake returns 503 by design** |
| `CIVGRAPH_ADMINS` / `CIVGRAPH_CONTRIBUTORS` | Pages secrets (email lists) | `_api/_auth.js` | live: 1 admin, 2 contributors |
| `CIVGRAPH_DEV_AUTH_EMAIL` | var | `_api/_auth.js` | **must stay unset in production** |

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
(9 prefixes as of 2026-08-16), and every upload script calls
`assertPublishable()` before sending a byte. Uploads outside the allowlist fail
closed.

The gate governs PREFIXES, not individual files, so an approved prefix
authorises everything on disk beneath it. `upload-tile-pyramid-s3.mjs`
therefore takes `--tracked-only`, which filters to `git ls-files`: without it,
publishing `data/timeline-transitions` would have pushed 133 gitignored QA
sidecars (5.4 GB) into a public bucket alongside the 6 intended files.

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

    D1   proni-catalogue              a66d0846-6186-460d-a7b2-e88918a6b341
    D1   civgraph-elections           cd88f241-35aa-4cbb-bcb3-c80a471b8afa
    D1   civgraph-catalogue           d7ed9845-ba30-4925-956c-d6bde885cb30
    KV   PRONI_KV                     ef19e1065f854619a19e2cbd62b28f82
    KV   SPATIAL_INDEX                c88a99b42d6d4ce7aba6ba94dce47e5a
    KV   CIVGRAPH_CONTRIBUTION_QUEUE  fca3f869f723456a9ca494155b586383
    R2   boundaries-data

Three D1 databases, three KV namespaces, one bucket, as of 2026-08-16. The
earlier version of this list said two and two and called itself complete; the
catalogue D1 and the contribution queue have been added since. Re-enumerate with
`wrangler` rather than trusting this table.

## Cloudflare Access, added 2026-08-16

Not in the repository and not reachable by wrangler — Zero Trust dashboard only.

    Team domain   icy-mouse-ce2a.cloudflareaccess.com
    IdP           GitHub (OAuth app "civgraph Access", client id Ov23liNwzKM9sksThoB4)
    Application   self-hosted, path `_api/contributions` on BOTH
                  civgraph.net and boundaries-website.pages.dev
    Policy        Allow, Include -> Emails (3 addresses)

Two things about it are load-bearing:

- **The path is `_api/contributions`, not `_api`.** `/_api/auth/status` must stay
  public or the Browse page breaks for every anonymous visitor.
- **Both hostnames are covered.** Protecting only the custom domain would leave
  the pages.dev origin as an unprotected route to the same Functions.

Access injects identity only INSIDE the application, so `/_api/auth/status`
cannot see who is signed in; `/_api/contributions/whoami` exists for that.

## Static assets vs Functions: the routing order, and how to verify it

Measured 2026-08-12. This is the single most misleading part of the setup, and
two outages and a day of wasted debugging came out of not knowing it.

**Cloudflare Pages serves a matching static asset in preference to a Function.**
Not a race, not a cache — the routing order. `functions/data/maps/[[path]].js`
only ever worked because `data/maps` is not deployed. When
`functions/data/graph/[[path]].js` was added while its 4,604 files were still
committed, the Function was invoked **zero times** for a full day while every
probe returned a healthy 200 with correct bytes.

So excluding a prefix from the deploy is not tidy-up after a migration. It is
the step that switches the migration on.

### `.cfignore` honours directory patterns, not globs

Measured against `boundaries-website.pages.dev`, which is the deployment origin
and therefore bypasses both the edge cache and the custom domain:

| Pattern in `.cfignore` | Result on the origin |
|---|---|
| `data/census/`, `data/timeline-transitions/` (directory) | 404 — honoured |
| `assets/thumbnails/*.webp` (glob) | **200 — not honoured** |

All six sampled thumbnails were live on the origin while `git ls-files -i -X
.cfignore` counted all 1,196 of them as excluded. `validate-pages-file-budget.mjs`
now distrusts glob patterns for this reason, which moved the reported deployable
count from 2,910 to 4,701 — still far under budget, but the earlier figure was
fiction. If a glob exclusion is ever genuinely needed, restructure so a directory
pattern can express it (for the thumbnails: move `manifest.json` out of
`assets/thumbnails/`) rather than trusting the glob.

### Three different things answer 200

When checking whether a migration worked, a status code proves nothing. All
three of these return 200 with the correct bytes:

1. the Function reading R2 — the only correct answer;
2. a committed static copy shadowing it;
3. Cloudflare's edge cache still holding the object after a correct deploy.

Number 3 is worth spelling out, because it looks exactly like a failed deploy:
`data/documents` kept serving from `civgraph.net` for hours after being properly
removed, with `cf-cache-status: REVALIDATED`, which reads like proof of a live
origin. The deployment origin returned 404 for the same key the whole time. It
resolved on its own when the 4-hour TTL lapsed. **There is no zone rule routing
`civgraph.net` to R2** — that hypothesis was tested and disproved: R2 objects
under prefixes with no Function (`data/sources/oireachtas-fulltext/`) return 404
from `civgraph.net`.

The only discriminator is the response **headers**, because each Function sets a
cache policy nothing else produces:

| Prefix | Function's `Cache-Control` |
|---|---|
| `data/maps` | `public, max-age=86400, stale-while-revalidate=604800` |
| `data/graph` | `public, max-age=86400, stale-while-revalidate=604800` |
| `data/browse` | `public, max-age=0, must-revalidate` (+ ETag, answers 304) |

`npm run verify:proxies` asserts exactly this, on both the public domain and the
origin, and checks that a missing key 404s rather than returning `index.html` at
200. It is network-dependent, so it is deliberately not in `npm run check`. **Run
it after any deploy that moves data to R2.**

### The custom domain, `data.civgraph.net` — added 2026-08-16

The table above is the **Pages Function** path. Most map data is not fetched that
way: the catalogue points at `data.civgraph.net` directly, which is the R2 custom
domain and never touches a Function. Its cache behaviour is not uniform, and the
split is the important part.

**MEASURE THIS WITH `GET`, NEVER `HEAD`.** Cloudflare does not apply its cache
layer to `HEAD`, so `curl -I` shows a *different and misleading* set of headers.
The first diagnosis of the 2026-08-16 incident was made this way and had to be
redone twice. Use `curl -s -o /dev/null -D - <url>`.

Measured 2026-08-16 with `GET`:

| Extension | Cloudflare treats as cacheable | `Cache-Control` seen | `cf-cache-status` |
|---|---|---|---|
| `.png` (raster tiles) | yes | `max-age=14400` — injected by the zone | `HIT` |
| `.gz` | yes | `max-age=14400` — injected by the zone | `HIT` |
| `.fgb` | **no** | **none at all** before 2026-08-16 | `DYNAMIC` |
| `.geojson` | **no** | **none at all**, still | `DYNAMIC` |

There is a zone-level **Browser Cache TTL of 4 hours** that is not in the
repository and was not previously recorded anywhere. It only reaches responses
Cloudflare already considers cacheable by extension. Everything else gets no
`Cache-Control` whatsoever and is never edge-cached.

Absent is the worst value available. It does not mean "do not cache" — it hands
the decision to the browser's heuristic, commonly 10% of the document's age.
`.fgb` objects carried `Last-Modified` dates in early April, ~133 days back,
buying roughly **thirteen days** of freshness with no revalidation. That is how
five corrected Local Authority layers went live on 2026-08-16, verified
byte-correct, and stayed invisible to the contributor who supplied them.
Staleness scaled with how long the file had been stable, so the cache failed
worst exactly where a correction mattered most.

    Now set on data/maps/*.{fgb,gz,br}   public, max-age=3600, stale-while-revalidate=86400
    Objects updated                      10,917
    Objects deliberately NOT updated     1,210,103   (1,207,367 of them .png tiles)

`scripts/set-r2-cache-control.mjs` did this and can redo it.

**The PNG tiles do NOT need this treatment**, and an earlier version of this
section wrongly said they did. They are already on the cacheable-extension path:
4 hours of browser freshness and a genuine edge `HIT`, so every tile request does
*not* reach R2. Rewriting metadata on 1.2M objects would cost ~2.4M API calls to
change nothing that matters, and a Cache Rule to "fix" them would be solving a
problem they do not have.

**What is still exposed** is the rest of the non-cacheable-extension set —
`.geojson` (193 objects, confirmed still bare), and probably `.json` (44) and
`.pbf` (999), unverified. About 1,200 objects, minutes of work, worth doing when
convenient. Anything Cloudflare will not cache by extension needs its
`Cache-Control` set on the object, because nothing else will supply one.

A second defence sits in the catalogue: `scripts/stamp-map-cache-tokens.mjs`
appends `?v=<R2 ETag>` to corrected layer URLs, so a changed file gets a changed
URL and no cache anywhere can serve the old bytes. `npm run verify:map-tokens`
fails if a file is re-uploaded without restamping. Header policy bounds how long
a mistake lasts; the token removes the wait entirely. Measured 2026-08-16: R2
preserved every ETag across the 10,917 metadata rewrites, so the tokens stayed
valid. A query string does not affect any of this — the same object is `DYNAMIC`
with and without one, because `.fgb` is not a cacheable extension either way.

## What is still undocumented

- ~~No `wrangler.toml`.~~ **Activated 2026-08-11.** `wrangler.toml` at the repo
  root is live and authoritative; dashboard bindings are now ignored. It
  reproduces what the API reported, including preview being deliberately
  narrower than production (`PRONI_DB` and `PRONI_KV` only). Roll back by
  deleting the file and redeploying — the dashboard configuration is unchanged
  underneath and resumes.
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
- **Whether anything routes `civgraph.net` to R2 is now answered: no.** Tested
  2026-08-12 — R2 objects under prefixes with no Function return 404 from the
  custom domain. There is no `_redirects` file and no evidence of an origin rule.
  The earlier suspicion came from edge-cached responses and was wrong.
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
