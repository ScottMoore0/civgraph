# /test Rollback Runbook

Use this when a MapLibre `/test` deployment or promotion causes broken map loading, cache poisoning, service-worker trouble, or unexpected mobile regressions.

## Immediate Containment

1. Revert the Pages deployment to the last known good commit in Cloudflare Pages.
2. If the issue is cache-related, publish a version bump for `TEST_ASSET_VERSION` and `TEST_CACHE_VERSION` before redeploying.
3. If PMTiles responses are failing, switch affected layer metadata back to known-good CDN URLs or temporarily mark the layer unconverted in `maps-test.json`.
4. If a service worker is implicated, deploy a no-cache service worker under `/test/sw.js` that deletes `civgraph-test-*` and `civgraph-test-v*` caches, then unregister it in a follow-up once clients have updated.

## Verification

1. Run `npm run check:test`.
2. Run `npm run test:browser:test`.
3. Run `npm run smoke:test:mobile`.
4. Confirm `/test/` loads in a clean browser profile.
5. Confirm diagnostics shows service-worker cache status and no PMTiles fallback warnings for the promoted layer set.

## Communication

Record the failed deployment commit, rollback commit, root cause, affected browsers/devices, and whether CDN cache invalidation was required.
