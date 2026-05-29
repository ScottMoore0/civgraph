# /test2 Production Readiness

`/test2` is the main-shell MapLibre migration route. It deliberately starts from the production shell and replaces only the interactive map engine boot path.

## Promotion Criteria

- `/test2` uses the production navbar, split panes, catalogue containers, support modal, and catalogue workflow.
- `/test2` does not load Leaflet, the production `build/app.bundle.js`, or register `/sw.js`.
- Every promoted map has MapLibre-compatible metadata and CDN-hosted PMTiles or MVT sources.
- Browser checks pass for shell boot, catalogue actions, URL restore, feature details, mobile menu, and one real vector layer render.
- Mobile performance smoke passes for representative heavy layers.

## Service Worker And Cache Scope

- Current `/test2` intentionally has no service-worker registration.
- Promotion to `/` must choose one production service worker scope and one cache version.
- Any promoted PMTiles or MVT metadata must be cache-busted by URL/version, not by relying on users clearing browser storage.
- Rollback must preserve the old service worker until the replacement is confirmed, then bump cache names so stale MapLibre style metadata is not reused.

## CDN/R2 Discipline

- PMTiles and generated MVT directories should live on R2/CDN, not in the Pages deployment.
- Cloudflare Pages should ship HTML, CSS, JS, metadata manifests, and small static assets only.
- PMTiles URLs need byte-range support: `Accept-Ranges`, `Content-Length`, and `206 Partial Content`.
- Regenerated tile archives must receive a new object key or explicit cache invalidation.

## Cutover Checklist

1. Run `npm run build:test2`.
2. Run `npm run check:test2`.
3. Run `npm run test:browser:test2`.
4. Run `npm run test:visual:test2`.
5. Run `npm run test:performance:test2`.
6. Confirm all promoted map entries have CDN URLs and no local-only PMTiles fallback.
7. Confirm production service-worker cache version and route scope.
8. Deploy to a preview route and test on a real phone.
9. Promote `/test2` routing to `/`.
10. Keep the previous Leaflet build available for rollback.

## Rollback

- Repoint `/` to the last Leaflet production build.
- Restore the previous service-worker registration and cache names if they changed.
- Invalidate or version any MapLibre metadata that was promoted during the failed cutover.
- Leave `/test2` available for debugging unless it is the direct source of the failure.
