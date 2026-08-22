# /test Production Observability

The MapLibre rewrite records lightweight runtime telemetry without blocking map
loading.

## Signals

- PMTiles failures and fallback attempts.
- Layer load timings.
- Recent PMTiles resource timings where browser APIs expose them.
- Browser memory information where `performance.memory` is available.
- Service-worker cache status for the scoped `/test` worker.
- CDN byte-range health from scheduled `monitor:test:cdn` runs.

## Privacy and Safety

Telemetry is same-origin only and sanitized to short primitive fields. It must
not include feature properties, addresses, cookies, authorization headers, or
signed URLs.

## Promotion Requirement

Before promoting `/test` to `/`, verify that diagnostics show no runtime CDN
failure count, no unexpected fallback count, and no service-worker cache pressure
warning on a fresh production session.
