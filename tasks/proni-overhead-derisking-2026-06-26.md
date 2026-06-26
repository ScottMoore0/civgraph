# PRONI Browse Traversal Overhead Derisking

Date: 2026-06-26

Scope: reduce PRONI Browse-only crawl overhead while preserving the constraint that records are discovered through Browse navigation rather than search-box queries.

## Live Evidence

The probe script `scripts/proni-overhead-research.ps1` tested the Browse branch:

`SearchPage > Browse > A > AA > AA/1 > AA/1/2`

Results from the corrected probe:

- Opening the branch snapshot took `1257.720 ms`.
- Reusing that same branch page to fetch 12 visible detail records succeeded.
- Those 12 detail records produced 12 distinct PRONI references:
  - `AA/1/2/1` through `AA/1/2/12`.
- Average detail fetch from the reused branch snapshot: `107.280 ms`.
- Maximum detail fetch from the reused branch snapshot: `144.581 ms`.
- Reopening the branch later and fetching indexed row controls reproduced 5/5 expected records.
- Average indexed branch reopen: `804.926 ms`.
- Average indexed detail fetch after reopen: `108.208 ms`.
- Browser-like PowerShell `Invoke-WebRequest` passed all Browse operations.
- Node `fetch` with browser-like headers successfully loaded `SearchPage.aspx` in this small probe, but full Browse POST behaviour is not yet proven.

Implication: most avoidable overhead comes from reopening Browse branches too often. A branch/page snapshot can safely be reused for multiple detail fetches, at least for the tested branch page.

## 1. Per-Branch Session Reuse

Feasibility: high.

Main disadvantage before testing:

- ASP.NET WebForms state might become invalid after a detail POST, causing subsequent records from the same branch page to fail or return the wrong record.

Derisking result:

- Reusing the same branch HTML and session for 12 detail records worked.
- Each detail response returned the expected distinct sequential PRONI reference.
- This strongly supports batching all visible records from a branch page before reopening or navigating further.

Recommended implementation:

- Treat each Browse results page as an immutable snapshot.
- Parse all visible leaf rows from that snapshot.
- POST each row's `ResultsView` control using the same snapshot HTML, not the mutated detail page HTML.
- Only use the current branch page snapshot for detail requests from that page.
- After all visible rows are complete, use the original branch page snapshot to click `Next`, if present.
- If any detail result's extracted `PRONI Reference` does not match the indexed expectation, discard that branch-page snapshot and reopen the branch path.

Remaining risk:

- The probe covered one branch page. Other branches and paginated branch pages should be validated during a longer pilot.

Guardrails:

- Extract and compare `PRONI Reference` on every detail page.
- Store branch path, page number, row control id, expected reference, and extracted reference.
- Stop a worker if mismatches exceed 0 in a page.

## 2. Browse Index First

Feasibility: high, with a specific design.

Main disadvantage before testing:

- Indexed "More" controls may not be globally stable outside the session/viewstate that produced them.

Derisking result:

- Reopening the same branch and matching by row/control id reproduced 5/5 indexed records.
- This means an index can store branch path plus row/page identity, but it should not store only the literal `More` button value.

Recommended implementation:

- First pass builds a Browse index containing:
  - top-level Browse letter,
  - branch path,
  - page number,
  - grid control id, e.g. `ctl02`,
  - visible/displayed reference where parseable,
  - later extracted PRONI reference after first detail fetch,
  - row title snippet where available,
  - snapshot hash for diagnostics.
- Second pass reopens a branch/page and fetches all indexed records for that page in batch.
- The index should be append-only and checkpointed.

Design constraint:

- Do not treat the `ResultsView` value as an identifier. In the PRONI table it is often just `More`.
- Do not store raw ASP.NET `__VIEWSTATE` as a long-term canonical target. It is useful only for immediate same-session/page replay.

Remaining risk:

- If a branch's row order changes during a crawl, row/control identity could drift.

Guardrails:

- On detail fetch, extracted `PRONI Reference` must equal the expected indexed reference when available.
- If no expected reference is known, write the extracted reference back to the index.
- If the row cannot be found after reopening, rescan that branch page before declaring it missing.

## 3. Parallel Workers By Top-Level Branch

Feasibility: high.

Main disadvantage before testing:

- Parallelism could create avoidable load or session cross-contamination.

Derisking result:

- Independent workers with separate sessions have already completed multi-letter Browse phases without throttle/WAF/non-200 failures.
- Clean phases included:
  - 4 target rps: 100 records, 0 failures.
  - 8 target rps: 200 records, 0 failures.
  - 16 target rps: 180 records, 0 failures.
  - 24 target rps: 300 records, 0 failures.
  - 40 target rps over Q-Z: 266 records, 0 failures, limited by sparse letters/traversal overhead.

Recommended implementation:

- Partition work by Browse prefix/branch, not random records.
- Give each worker its own WebRequest session and checkpoint file.
- Use a coordinator-level token bucket so aggregate request rate is capped.
- Start with 2-4 workers at 1-2 records/sec each.
- Increase only after a longer pilot confirms no errors.

Remaining risk:

- Some Browse letters are sparse or empty, so naive letter partitioning causes imbalance.

Guardrails:

- Build a branch queue from the Browse index and assign branches dynamically.
- Avoid reassigning the same branch concurrently.
- Record per-worker latency and failure rate.
- Stop all workers on WAF text, non-200 responses, repeated record mismatches, or p95 latency collapse.

## 4. Replace PowerShell With Node/.NET Browser-Like HTTP

Feasibility: medium.

Main disadvantage before testing:

- Earlier Node/native fetch behaviour was suspected to trigger PRONI WAF rejection.

Derisking result:

- The latest Node `fetch` GET to `SearchPage.aspx` with browser-like headers returned HTTP 200 and was not blocked.
- PowerShell `Invoke-WebRequest` remains the only client proven through full Browse GET/POST navigation.

Recommended implementation:

- Keep PowerShell as the known-good client for the next production-safe crawler.
- If speed/maintainability becomes a problem, port to .NET `HttpClient` first because it can closely mirror the working PowerShell behaviour.
- Use Node only after proving the full Browse POST path:
  - SearchPage GET,
  - Browse nav postback,
  - letter postback,
  - branch select postback,
  - detail `More` postback.

Remaining risk:

- A client may pass the first GET but fail WebForms POSTs or receive different session handling.

Guardrails:

- Any new client must pass the same single-record and branch-reuse tests before being used at scale.
- Record exact headers, cookies, status codes, and title/body rejection checks.
- Keep Playwright as a last-resort fallback for problematic branches, not the main crawler path.

## 5. Checkpointed Branch Queues

Feasibility: very high.

Main disadvantage before testing:

- Checkpointing adds implementation complexity and can produce messy partial state.

Derisking result:

- The existing probes already write JSON summaries and record logs. Extending this to durable branch/page checkpoints is straightforward.
- Branch reuse and indexed reopen both work, so checkpoint units can be stable branch-page batches rather than individual navigation attempts.

Recommended implementation:

- Use three checkpoint tables/files:
  - `branches`: branch path, discovered pages, status, last scanned time.
  - `records`: PRONI reference, branch path, page, row/control id, extraction status, hash.
  - `failures`: branch/record, error type, retry count, last error, next retry time.
- Use append-only JSONL during crawl, then compact to SQLite/Parquet/CSV after each run.
- Make the crawler idempotent:
  - skip completed records,
  - retry transient failures,
  - rescan stale branches only when requested.

Remaining risk:

- Checkpoint corruption or inconsistent partial writes during interruption.

Guardrails:

- Write append-only event logs first.
- Periodically compact to a derived state file.
- Include content hashes and extracted PRONI reference checks.
- Never delete raw crawl logs until a run is validated.

## Recommended Next Implementation Order

1. Add branch-page batch reuse to `scripts/proni-browse-crawl-throttle.ps1`.
2. Add extracted-reference validation to every detail fetch.
3. Add durable branch/page/record checkpoint files.
4. Add a two-pass mode:
   - index Browse tree,
   - then fetch detail records in branch-page batches.
5. Improve the parallel coordinator to consume a shared branch queue instead of static letters.
6. Only after that, consider a .NET client port if PowerShell remains too slow.

## Expected Performance Impact

The tested branch page cost roughly:

- `~1.26s` to open the branch.
- `~0.107s` per detail record from a reused branch snapshot.

The current conservative traversal pays branch-opening costs too often. Batching visible records from branch pages should reduce navigation overhead materially while preserving safety. The likely practical crawl rate should improve more from better batching and checkpointing than from simply adding more parallel workers.
