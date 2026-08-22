# Contributing to Civgraph

Thanks for looking. This file covers what you need to run the site, make a
change, and have it accepted.

The code is MIT licensed. **The data is not** — see [NOTICE](NOTICE) before
reusing any map layer. That distinction matters more here than in most projects
and is the first thing to understand.

---

## Running it locally

Requires Node (developed on 24.x; no `engines` floor is declared) and Python for
the static server.

```bash
npm install
npm run build            # builds the MapLibre bundle and shared shell assets
python -m http.server 5050
# open http://localhost:5050
```

The static server is enough for the map itself. It is **not** enough for
anything under `/_api/*` — those are Cloudflare Pages Functions and need
`wrangler pages dev` plus bindings you will not have. Expect API calls to fail
locally; that is normal and not a bug you need to fix.

---

## Before you open a PR

```bash
npm run check     # 26 validators; must exit 0
npm run lint      # eslint
```

`npm run check` is the gate that matters. It is slow because it is thorough —
it verifies the catalogue against the tile store, every asset reference against
the built output, and every referenced R2 object against the bucket. A few of
its steps need R2 credentials in `.env.local` and will skip loudly without them;
that is expected for outside contributors and those steps run in CI.

CI runs `npm run check` and `npm run lint` on every push
(`.github/workflows/data-readiness.yml`).

---

## How the project is laid out

**The canonical layout table now lives in [README.md](README.md#project-structure)**,
because that is the file a newcomer actually opens first — and for months it
described a `js/` directory that no longer exists while this accurate table sat
here unread. One copy, in the more-read file, checked by
`npm run check` (`check:doc-paths` asserts every path either file cites resolves).

The names are historical and will mislead you if nobody says so. Read that table
before anything else. `src/README.md` covers the single most misleading one.

What matters specifically for contributing:

`scripts/` not being deployed matters: `src/` **is** served as unbundled ES
modules, so a browser-imported module cannot be moved into `scripts/` without
breaking at runtime.

`app/build/` is committed. If you change anything under `render/src/`, rebuild and
commit the build output with it.

### The catalogue is three stores

This is the single most confusing thing about the codebase, and getting it wrong
has repeatedly produced convincing but false "this layer is broken" diagnoses.

| Store | Owns |
|---|---|
| `data/database/maps.json` | provenance — licence, attribution, downloads |
| `render/metadata/maps-test.json` | rendering — tiles, zoom, styling, labels |
| `c1Cards` in `src/ui-controller.js` | navigation — what a user can click |

They are joined by a bare string id, with a `-vector-test` suffix on the render
side. `render/metadata/maps-test-index.json` is **generated** from
`maps-test.json` — edit the source, then run
`node scripts/build-test2-metadata-shards.mjs`.

All three edges are guarded by validators in `npm run check`. If you add a layer
and it does not appear, the answer is almost always that no card lists it —
`scripts/validate-c1-coverage.mjs` explains this at length and is worth reading.

---

## Map data

`data/maps/*` is served from R2, **not** from the repository. A Pages Function
(`functions/data/maps/[[path]].js`) owns that whole prefix and the bucket wins
over any repo copy. Adding a file to the repo under that path will not serve it.

Anything written to that bucket is public. Uploads go through
`scripts/lib/r2-publication-gate.mjs`, which enforces a tracked allowlist and
fails closed. Do not bypass it.

If you contribute a dataset, record its licence and attribution in the catalogue
entry. Most sources here are Open Government Licence or Creative Commons
Attribution, and those conditions travel with the data. Attribution to Civgraph
alone does not satisfy a source that requires its own credit.

---

## Deployment

Hosted on Cloudflare Pages (project `civgraph`, serving `civgraph.net` and
`boundaries-website.pages.dev`), connected to this repository — pushes to `main`
deploy.

Bindings are declared in [`wrangler.toml`](wrangler.toml), which Pages treats as
authoritative — a binding missing from that file is missing in production, and
its Functions answer `503 … binding not configured`. Add bindings there, not in
the dashboard. Preview is deliberately narrower than production.

Environment variables are the exception and stay in the dashboard:
`CIVGRAPH_ADMINS` and `CIVGRAPH_CONTRIBUTORS` are email addresses and must not
be committed. `docs/cloudflare-inventory.md` records what each binding is for
and what is still unwired.

---

## House style

- Match the surrounding code — comment density, naming, idiom.
- Validators are preferred over documentation for anything that can be checked
  mechanically. Several exist because a specific bug shipped; their header
  comments record what and why. Follow that pattern: when you fix a class of
  bug, add the check that would have caught it, and negative-test it.
- Verify against the thing itself, not a report of it. Repeatedly in this
  project a success signal has been wrong — a green build over a broken index, a
  404 served as HTTP 200, an upload that exited 0 having uploaded nothing. Ask
  the filesystem, the bucket, or the endpoint.
- Baselines ratchet. Files like `data/database/*-baseline.json` may shrink,
  never grow. Do not re-pin one to make a check pass.

## Reporting problems

Open an issue with the layer id and the URL you were on. If a layer looks
broken, say which of the three catalogue stores you were reading — that alone
resolves a surprising number of reports.
