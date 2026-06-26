# PRONI Browse Corpus Crawler Implementation

Date: 2026-06-26

This implements the seven agreed PRONI Browse-crawler improvements as tooling. It does not run the full corpus crawl.

## Implemented Improvements

1. Branch-page batch reuse
   - The crawler opens a Browse branch page once, parses all visible rows, and can fetch every visible leaf/detail record by replaying the same branch-page snapshot.
   - It uses the original page snapshot for each `More` postback instead of navigating back and reopening the branch for every record.

2. Extracted-reference validation
   - Detail pages are parsed for `PRONI Reference`.
   - Where the index has an expected reference, the crawler records mismatches and can stop immediately with `-StopOnMismatch`.

3. Durable checkpointing
   - Append-only logs are written under the output directory:
     - `events.jsonl`
     - `records-index.jsonl`
     - `records-details.jsonl`
     - `failures.jsonl`
   - Compact state/summary files are also written:
     - `state.json`
     - `summary.json`
   - Output defaults to `tmp/proni-corpus-crawl`, which keeps crawl state out of the repo and Pages bundle.

4. Two-pass index/fetch mode
   - `-Mode Index` traverses Browse and writes an index.
   - `-Mode Fetch` reads the index and fetches detail records.
   - `-Mode Both` indexes and fetches visible leaf records during the same bounded run.

5. Dynamic parallel branch queue
   - Fetch mode groups indexed records by branch page path and writes `branch-queue.json`.
   - Multiple workers can claim pending branches through a file lock, mark them running/done/failed, and avoid duplicate branch fetches.

6. Conservative global rate limiting
   - Every request goes through a shared file-lock rate limiter.
   - `-GlobalRps` caps aggregate request rate across workers.
   - `-WorkerRps` caps per-worker request rate.
   - `-BackoffSeconds`, `-MaxRetries`, `-StopOnBlocked`, and `-StopOnMismatch` provide conservative failure behavior.

7. Client abstraction
   - `-Client PowerShell` uses the already-proven `Invoke-WebRequest` WebForms path.
   - `-Client HttpClient` provides a .NET `HttpClient` implementation behind the same request interface.
   - PowerShell remains the recommended production client until the HttpClient path has a larger live POST-flow pilot.

## Example Commands

Bounded index-and-fetch pilot:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proni-browse-corpus-crawler.ps1 `
  -Mode Both `
  -Letters A `
  -MaxBranches 4 `
  -MaxRecords 20 `
  -GlobalRps 1 `
  -WorkerRps 1 `
  -OutDir tmp\proni-corpus-crawl-test
```

Separate index and fetch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proni-browse-corpus-crawler.ps1 `
  -Mode Index `
  -Letters A `
  -MaxBranches 25 `
  -MaxRecords 250 `
  -OutDir tmp\proni-corpus-index

powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proni-browse-corpus-crawler.ps1 `
  -Mode Fetch `
  -IndexPath tmp\proni-corpus-index\records-index.jsonl `
  -Workers 2 `
  -GlobalRps 2 `
  -WorkerRps 1 `
  -OutDir tmp\proni-corpus-fetch
```

## Safety Position

The production full crawl should start with a low-rate pilot. Recommended initial settings:

- `-Workers 1`
- `-GlobalRps 1`
- `-WorkerRps 1`
- bounded `-MaxBranches` and `-MaxRecords`

Increase only after checking:

- zero reference mismatches,
- zero WAF/throttle text,
- stable latency,
- no stale worker processes,
- complete checkpoint files.

## Verification Completed

- PowerShell syntax check:
  - `[scriptblock]::Create((Get-Content 'scripts\proni-browse-corpus-crawler.ps1' -Raw)) | Out-Null`
- Branch-page batch reuse smoke:
  - Branch: `A > AA > AA/1 > AA/1/2`
  - Command shape: `-Mode Both -Client PowerShell -MaxBranches 1 -MaxRecords 8 -GlobalRps 1 -WorkerRps 1`
  - Result: 8 index rows, 8 detail rows, 0 mismatches, 0 failures, 0 blocked responses.
- Two-pass queued worker smoke:
  - Index pass produced 6 rows from the same branch.
  - Fetch pass used `-Workers 2`, a file-locked branch queue, and the saved index.
  - Result: 3 requested detail rows fetched, queue status `done`, 0 mismatches, 0 failures.
- HttpClient smoke:
  - Command shape: `-Mode Both -Client HttpClient -MaxBranches 1 -MaxRecords 1`
  - Result: 1 index row, 1 detail row, expected/extracted `AA/1/2/1`, 0 failures.

## Remaining Risks

- The Browse site is ASP.NET WebForms; row/control identity can drift if PRONI changes branch content during a crawl. The extracted-reference validation is the guardrail.
- The `HttpClient` path is implemented but not yet as well proven as the PowerShell path.
- Full-corpus indexing may still need branch-priority tuning once sparse/deep Browse branches are observed at scale.
- The script deliberately writes crawl outputs outside tracked files by default; the data outputs need a separate review/publication step.
