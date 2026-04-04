# Metrics And Thresholds

These are the baseline categories to capture before and after every atom.

## Core objective metrics

- startup JS bytes
- total built JS bytes
- startup CSS bytes
- number of initial render-blocking assets
- count of generated chunks
- size of newly generated chunks/artifacts
- pure-function benchmark timing for the affected logic
- runtime instrumentation timing for the affected path
- memory growth for the affected isolated task, when measurable

## Core subjective/manual categories

- initial page feels faster, same, or slower
- first-open of deferred feature feels acceptable or not
- map panning/zooming feels smoother, same, or worse
- table/list scrolling feels smoother, same, or worse
- fidelity looks unchanged, acceptable, or degraded
- UI flashes, jitter, or delay observed or not observed

## Default accept thresholds

- startup JS bytes:
  - accept: decreases or stays within `+1%`
  - reject: rises by more than `1%` without explicit justification
- total built JS bytes:
  - accept: decreases or stays within `+2%`
  - reject: rises by more than `2%` without explicit justification
- new artifact size:
  - accept: increase is intentional and runtime cost falls materially
  - reject: size rises with no measured runtime benefit
- pure benchmark timing:
  - accept: faster or within noise band
  - reject: slower by more than `5%` on the measured path
- isolated memory growth:
  - accept: stable or intentionally traded for larger win
  - reject: unexplained large increase

## Item-specific thresholds

- code-splitting:
  - startup bundle should fall
  - first-open deferred feature delay must be acceptable to the user
- web workers:
  - result parity must be exact unless a tolerance is explicitly defined
- payload reduction:
  - first-load asset count and bytes should fall
- precomputed artifacts:
  - artifact-backed result must match dynamic result for the tested scope
- adaptive LOD:
  - source selection must match config and zoom thresholds exactly
- virtualization:
  - rendered visible rows/cards must remain correct and stable
- caching:
  - versioned assets must be uniquely addressable
- containment:
  - sticky or measured layouts must not break
- interaction batching:
  - stale update races must not appear
- dependency trimming:
  - functionality must remain unchanged
- images:
  - visual quality must remain acceptable
- budgets:
  - checks must be stable enough not to create noisy false failures

## Suggested automated artifacts to save

- build manifest or build-size report
- benchmark output
- artifact validation output
- request/asset inventory report
- config diff summary

