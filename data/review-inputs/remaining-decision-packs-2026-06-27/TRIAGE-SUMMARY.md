# Decision-pack triage summary — 2026-06-27 packs

Mechanical triage complete. Every step below is deterministic (field-driven);
the only remaining work needs human judgment: the duplicate-vs-new dedupe
adjudication in `dedupe-queue-ranked.csv`.

## Inputs

| File | Records |
|---|---|
| `licence-risk-review.json` | 2,647 |
| `already-on-site-review-rankings.json` | 1,022 |

## Deliverables & counts

| File | Rows | Meaning |
|---|---|---|
| `licence-drop-ncnd.csv` | **27** | CC-BY-NC-ND 4.0 — non-republishable. **Definitive DROP.** |
| `licence-flags-to-resolve.csv` | **67** | Flagged: no-provider-url, fetch-failed (403/404), licence-unspecified, local-source. Need per-row resolution. |
| `licence-clear-publishable.csv` | **2,553** | `standard-open-licence-confirmed` minus NC-ND. **Rights-cleared.** |
| `dedupe-queue-ranked.csv` | **1,022** | All already-on-site rows, sorted by `bestMatchScore` desc. Ordered dedupe worklist. |

Licence reconciliation: 27 + 67 + 2,553 = **2,647** ✓ (matches input total).
Dedupe reconciliation: **1,022** rows, all retained ✓.

### Flag breakdown (`licence-flags-to-resolve.csv`, 67 rows)

Derived from `rightsStatus` / `fetchStatus`:

- `manual-review-no-provider-url` — 28
- `blocked-local-source-rights-review` (local standalone source, no derivable provider URL) — 19
- `manual-review-fetch-failed` (http-403 ×5, http-404 ×6) — 11
- `manual-review-licence-unspecified` — 9

Each row carries a `flagReason` and a `suggestedNextStep`.

## Dedupe queue — auto-clear column

`autoClearCandidate` = `true` where `bestMatchScore < 0.15` → **6 rows** (all
in bucket `hold-context-overlap`; scores 0.09–0.14). Nothing is dropped; the
human still decides.

Note on threshold rationale: none of the five decision buckets denotes
"clearly-new" — the closest-sounding bucket, `hold-weak-match` (5 rows),
actually carries the *highest* scores (0.38–0.67) and is **not** auto-cleared.
The only principled auto-clear signal in this data is therefore the
lowest-confidence score tail (`< 0.15`), which is what the column flags. All
1,022 rows remain in the queue for adjudication.

Score/bucket distribution (context for the human pass):

| decisionBucket | rows | riskLevel |
|---|---|---|
| safe-related-source-enrichment-review | 59 | medium |
| probable-variant-or-source-enrichment | 305 | medium-high |
| hold-low-confidence-variant-review | 510 | high |
| hold-context-overlap | 143 | high |
| hold-weak-match | 5 | high |

`bestMatchCandidateId` / `bestMatchCandidateTitle` were parsed from each row's
`targetIds` (first id) and `evidenceSummary` (first segment); all 1,022 parsed
cleanly and their embedded score equals `bestMatchScore`.

## What remains (the only human gate)

**Duplicate-vs-new adjudication** of the 1,022 rows in
`dedupe-queue-ranked.csv`. Work top-down (highest `bestMatchScore` = most
likely duplicate first). For each: confirm whether the candidate
(`bestMatchCandidateId`) is the same dataset (→ merge/skip) or a genuine new
record / variant (→ publish, per `recommendedAction`). No licence work remains
for these — see cross-pack note below.

## Records appearing in BOTH packs (status made unambiguous)

All 1,022 dedupe rows also exist in the licence pack under scope
`already-on-site-review`. Their licence status:

| Licence status | In dedupe queue |
|---|---|
| licence-clear (publishable) | **952** |
| CC-BY-NC-ND (DROP) | **27** |
| flagged (resolve) | **43** |

Implications for the human pass:

- **952** dedupe rows are already rights-cleared — dedupe is the *only*
  remaining gate for them.
- **27** dedupe rows are also on the **NC-ND DROP list**. Their dedupe outcome
  is moot: they cannot be published regardless. Do not spend adjudication time
  on them unless the goal is merging into an existing record.
- **43** dedupe rows are also **flagged** (rights unresolved). Resolve the
  licence flag first; a dedupe "publish" decision cannot take effect until
  rights are cleared.

Join key: licence `rowId` == dedupe `rowNumber` (1,022/1,022 exact match,
titles identical). CSV `id` columns use `already-on-site-review:<rowNumber>`
for both packs so rows line up directly.
