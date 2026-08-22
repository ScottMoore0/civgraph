# Renaming `render/`, `test2/` and `tests/` — runbook

> **Status: EXECUTED for `test/` on 2026-08-22.** `test/` is now `render/`, deployed
> and verified: `/render/` returns 200, `/test/` 301s to it, and the published tile
> prefix `data/maps/test` was deliberately left alone. 45,232 references were rewritten
> by `scripts/migrate-test-to-render.mjs`, plus 14 bare path segments that no string
> search could find and six escaped-regex forms the gate caught.
>
> **`test2/` will NOT be renamed or folded away, and that is now a decision rather than
> a deferral.** It was re-proposed on 2026-08-22 as "fold test2/ into app/" by someone
> (me) who had not looked inside it. It holds two files: a redirect that preserves
> search and hash, and a service worker that UNREGISTERS the legacy `/test2/` worker and
> clears its caches. A `_redirects` rule can do the first and cannot do the second — a
> redirect never runs, so it can never unregister anything. Any visitor who loaded
> `/test2/` before June still has that worker installed. Leave it.
>
> **`tests/` stays too.** It is the Playwright suite; the name is accurate. The
> ambiguity that motivated this runbook was `test/` sitting beside it, and that is gone.
>
> The reference count remains ratcheted by `npm run check:dir-names`.

Written 2026-08-11 as preparation, while the evidence was fresh. Executed 2026-08-22 for
`test/` only. What follows is the original plan; the outcome is recorded above and in the
commit that carried it out.

## Why this is treated as dangerous

Earlier the same day, archiving the Leaflet stack renamed `js/` to `src/`.
`git mv` moved the files. It could not move the four `../js/…` strings inside
build scripts, because to git a string is not a reference.

The consequences, in order:

- `npm run build` aborted at step 2 with `ERR_MODULE_NOT_FOUND`
- every Cloudflare Pages deployment failed — **18 consecutive commits**
- nothing alerted, because Pages keeps serving the last successful deployment,
  so the site looked healthy while being frozen a day behind
- `npm run check` stayed green throughout: it runs 26 validators and never runs
  `npm run build`
- CI never fired either, because `data-readiness.yml` is path-filtered and the
  breaking commit matched no filter

`render/` is the same operation on a much larger surface. It is also badly named:
it holds 2,087 **deployed** metadata files and `render/src`, the shared renderer —
nothing to do with testing. `tests/` is the Playwright suite. `test2/` is a
compatibility redirect.

## What now exists to make it safe

| Guard | Added | What it catches |
|---|---|---|
| `pages-build.yml` | today | the exact Pages build, clean checkout, every commit, no path filter |
| `pages-deploy-watch.yml` | today | a deploy that fails after CI passes |
| `validate-directory-name-references.mjs` | today | the reference surface, classified by blast radius |
| `validate-asset-references.mjs` | earlier | every `src`/`href` path exists post-build |
| `validate-r2-serving-parity.mjs` | earlier | every referenced R2 object exists |

The first is the one that would have caught the `js/` breakage on the first
push. **Let it prove itself over a few commits before starting this.**

## The surface, as measured

`node scripts/validate-directory-name-references.mjs`

    total references : 461      (render/ 410, tests/ 32, test2/ 19)

      RUNTIME    19 refs in  9 files   404s in production if missed
      CONFIG     28 refs in  6 files   fails SILENTLY if missed
      BUILD     367 refs in 64 files   fails the build, loudly
      TEST        2 refs in  2 files   fails the suite
      DOC        45 refs in 13 files   misleads a human

The count is pinned in `data/database/directory-name-references-baseline.json`
and `npm run check` fails if it grows — so the job cannot get bigger while it
waits.

### RUNTIME — 19 references, the dangerous class

    app/src/app.js                      2
    app/src/election-manager.js         2
    app/src/maplibre-main-adapter.js    5
    src/data-service.js                 1
    render/index.html                     3
    render/src/config.js                  2
    render/src/diagnostics.js             2
    render/src/map-controller.js          1
    render/src/source-panel.js            1

These resolve at request time. A miss is a 404 — and on Pages a missing asset
can return `index.html` at **HTTP 200**, which every status-code check reads as
healthy. That exact failure hid a broken FlatGeobuf runtime earlier in this
project.

### CONFIG — 28 references, the silent class

    _headers                           11
    .gitignore                          9
    .cfignore                           3
    package.json                        2
    .claude/settings.local.json         2
    package-lock.json                   1

Worst of these is `_headers`: it carries the `immutable` cache policy for
`render/metadata/maps-test-index.json`. If the path stops matching after a rename,
the rule silently stops applying — no error, nothing red, just a policy that no
longer exists. `.cfignore` is the same shape: a stale exclusion means files get
deployed that were meant to be left out, quietly enlarging the upload.

## Suggested order

1. **`tests/` first.** Nothing serves it, 2 references outside itself. It is the
   rehearsal: if this goes wrong, only the suite breaks.
2. **`render/` second, in one commit**, updating every RUNTIME and CONFIG
   reference in the same change. Run the inventory before and after; the count
   must drop by exactly what was moved.
3. **Leave `test2/` alone.** It is a compatibility redirect that costs nothing
   and removing it breaks any external link that used it.

## Verification that actually proves it

- `npm run build` locally **and** in CI. Local success is not enough: the
  `*-chunks.json` failure earlier today passed locally and failed on Pages,
  because untracked files still existed on the developer's disk.
- Then a **real browser in a foreground tab**. Not static analysis — static
  analysis is what cleared `js/`. Not headless-in-the-background either:
  `boot.js` starts inside a double `requestAnimationFrame`, which Chrome does
  not fire in a hidden tab, so a backgrounded run shows a convincing dead site.
  See `docs/src-orphan-runtime-check.md`.
- Confirm the deploy **succeeded**, not merely that the commit pushed. Check
  `wrangler pages deployment list` or the deploy-watch workflow.
- Re-fetch a `_headers`-governed URL and confirm the header still applies.

## The one-line rollback

`git revert` the rename commit and redeploy. That works only if the rename is a
single commit — which is the main argument for doing `render/` in one change
rather than incrementally.
