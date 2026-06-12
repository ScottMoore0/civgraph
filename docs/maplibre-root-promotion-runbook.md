# MapLibre Root Promotion Runbook

## Current Routing

- `/` is generated from the `/test2` MapLibre shell by `scripts/promote-test2-root.mjs`.
- `/test2/` remains available as a compatibility and comparison route.
- The old Leaflet root shell is archived at git tag `leaflet-main-before-maplibre-root-20260612`.

## Build And Validation

Run before promoting or after any root/test2 route change:

```bash
npm run build
npm run check
npm run check:test2
```

Expected guarantees:

- `index.html` loads `/test2/build/test2.bundle.js`, not `build/app.bundle.js`.
- `index.html` does not load Leaflet assets.
- `/test2/index.html` still loads the `/test2` runtime.
- `sw.js` is the root MapLibre service worker and does not intercept PMTiles byte-range requests.
- Cloudflare Pages deployable files stay under the 20,000 file limit.

## Cutover Check

After Cloudflare deploys the pushed commit:

1. Open `https://civgraph.net/`.
2. Confirm the root route shows the MapLibre map shell.
3. Confirm `https://civgraph.net/test2/` still loads.
4. Confirm the root page requests `/test2/build/test2.bundle.js`.
5. Confirm the service worker scope for root is `/` and its status version begins `root-maplibre-sw-`.
6. Load a PMTiles-backed layer and confirm byte-range requests return `206 Partial Content` from the CDN.
7. Load an election layer and confirm the election pane, seat circles, and timeline work.

## Rollback

The pre-promotion Leaflet root can be restored from:

```bash
git checkout leaflet-main-before-maplibre-root-20260612
```

For an emergency production rollback:

```bash
git revert <promotion-commit-range>
npm run build
npm run check
git push origin main
```

Prefer revert over history rewriting. Do not delete `/test2` assets during rollback unless a separate issue proves they are the cause.

## Notes

- Normal production builds use `scripts/build-shared-shell-assets.mjs` for the thumbnail manifest, shared CSS split, critical-CSS inlining, and `about.css`. They should not emit `build/app.bundle.js`.
- The archived Leaflet app can still be built manually with `npm run build:legacy-leaflet` for rollback research or debugging, but that command is intentionally outside the production build path.
- The old mixed-purpose `scripts/bundle.mjs` file is archived at `archive/legacy-scripts/bundle.mjs`; do not restore it to `scripts/` unless intentionally reverting the production build architecture.
- The root service worker deliberately keeps PMTiles and large election/result payloads out of Cache Storage. Those belong on R2/CDN with normal HTTP cache and byte-range behavior.
