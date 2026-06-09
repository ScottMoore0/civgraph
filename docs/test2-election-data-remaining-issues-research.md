# Test2 Election Data Remaining Issues Research

Generated: 2026-06-09

## Scope

This report researches the current non-blocking `/test2` election-data audit warnings and recommends how to resolve them. It is based on:

- `tasks/test2-election-data-audit.json`
- `tasks/test2-election-data-audit.md`
- `scripts/audit-test2-election-data.mjs`
- `tasks/ireland_election_party_colour_wikipedia_audit.md`
- repository-local generated `/test2` election and Browse data
- external source-family checks for ARK Northern Ireland Elections, EONI election results, ElectionsIreland, Wikipedia election pages, and Wikipedia party-colour data

No election data is changed by this report.

## Current Audit Position

The current deterministic audit reports:

| Area | Value |
|---|---:|
| Parent elections | 268 |
| Loadable elections | 249 |
| Placeholders | 19 |
| Result rows audited | 4,684 |
| Candidate rows audited | 29,610 |
| Rows with count detail | 4,632 |
| Rows with animation payload | 4,632 |
| Rows expected to have transfer/count data | 2,384 |
| Expected transfer/count rows missing detail | 38 |
| Blocking issues | 0 |
| Warnings | 113 |

Warning categories:

| Category | Count | Priority |
|---|---:|---|
| `first-pref-sum` | 39 | High |
| `candidate-list-missing` | 30 | High |
| `source-record-missing` | 14 | Medium |
| `unmatched-list-count` | 11 | Medium |
| `party-colour-mismatch` | 10 sampled from a broader audit | Medium |
| `source-record-single-reference` | 9 | Low / medium |

The remaining work is therefore not a site-breaking blocker. It is data-quality cleanup, source documentation, and audit-rule refinement.

## Source Families To Use

Use these source families in this order:

1. Official election authorities where available.
   - EONI results and data for modern Northern Ireland elections: <https://www.eoni.org.uk/Elections/Election-results-and-statistics>
   - Oireachtas / official Irish sources where available for Irish elections.

2. Curated academic or archive election resources.
   - ARK Northern Ireland Elections: <https://www.ark.ac.uk/elections/>
   - ElectionsIreland for Irish elections: <https://electionsireland.org/>

3. Wikipedia as a broad, link-rich secondary source.
   - Useful for constituency pages, historical election summaries, candidate rows, and local result tables.
   - Should be corroborated for manual corrections where figures disagree with generated data.

4. Specialist printed or archival sources for hard early rows.
   - Michael Gallagher, `Irish Elections 1922-44`
   - Walker / parliamentary election references for older Westminster and Northern Ireland Parliament rows
   - Council PDFs or archived council pages for NI local-government edge cases

## Priority 1: Fix Or Reclassify `first-pref-sum` Warnings

### What The Warnings Mean

The audit checks whether candidate first-preference totals exceed `validPoll`. That is correct for STV and most single-vote contests. The current warnings fall into three distinct classes.

### Class A: Bad or malformed `validPoll` fields in NI local-government rows

Examples:

- `Ballyarnett` 2023: first-preference sum `9740`, valid poll `-179`
- `Magherafelt` 2023: first-preference sum `8257`, valid poll `-49`
- `Ballymena South` 1997: sum `5506`, valid poll `5.51`
- `Bannside` 1997: sum `5920`, valid poll `5.92`
- `Dungannon Town` 1985: sum `6044`, valid poll `6.04`
- `Fermanagh Area B` 1981: sum `5665`, valid poll `109`

These look like source/parse errors, not political edge cases. Several older local rows appear to have thousands separators, decimal punctuation, or compact table values parsed as actual decimal values.

Recommended fix:

- Add a source-backed correction sidecar for local-government result metadata, not ad hoc generated-file edits.
- Correct `validPoll` / `validVotes` only after comparing against ARK, EONI, Wikipedia DEA pages, or council PDFs.
- Add an audit guardrail:
  - negative valid polls are blocking unless explicitly marked unknown/not-applicable;
  - `validPoll < firstPreferenceSum * 0.5` is blocking for STV contests;
  - decimal valid polls below `100` in multi-seat local contests are suspect unless explicitly sourced.

### Class B: Two-member Westminster constituencies using block-vote style totals

Examples:

- 1945 `Antrim`: sum `132894`, valid poll `66447`
- 1945 `Down`: sum `115773`, valid poll `57887`
- 1922-1945 `Fermanagh and Tyrone`, `Antrim`, and `Down` rows often show sums almost exactly `2x` valid poll.

This is probably not a data error in the same sense. These older Westminster constituencies were multi-member constituencies where electors could cast votes for more than one seat/candidate, so candidate vote totals can exceed ballot/poll totals.

Recommended fix:

- Add election/result-level voting-system metadata such as `votingSystem: "block-vote"` or `votesPerElector: seatsTotal`.
- Change the audit rule for those rows to compare candidate vote totals against the appropriate maximum, or skip the STV-style first-preference invariant.
- Do not manually force candidate totals down to match valid poll.

### Class C: Likely row duplication or wrong valid-poll metadata

Examples:

- 1975 Constitutional Convention `Armagh`: sum `59388`, valid poll `28136`
- 1981 local `Armagh Area B`, `Craigavon Area B`, and similar rows where the difference is not a simple decimal/thousands issue.

Recommended fix:

- Compare each row to ARK and Wikipedia result tables.
- Check for duplicated candidate rows, wrong constituency grouping, and stale valid-poll metadata.
- Add a targeted correction only after one of those causes is confirmed.

## Priority 2: Fix `candidate-list-missing` Warnings

Current warnings: 30.

### False-positive or special contest class

- 2018 `North Antrim` recall petition has no candidates in the ordinary election-result sense.

Recommended fix:

- Add `candidateRowsExpected: false` or `contestType: "recall-petition"` metadata.
- Update the audit to skip candidate-list warnings for recall petitions and referendums.

### Legacy NI local-government gaps

Recurring examples:

- `Giant's Causeway` in 1985, 1989, 1993, 1997, 2001, 2005
- `Ballyholme & Groomsport` in 1993, 2001, 2005
- `Area-F`, `Area-G`, `Area-H`, and corrected variants in 1973, 1977, 1981

Recommended fix:

- Treat these as true data gaps unless a source confirms no contest.
- Resolve from ARK first, then Wikipedia local-election DEA pages, then council/EONI PDFs.
- Add candidate rows and count metadata only from explicit source tables.
- If only candidate names and first-preference totals exist, add results without transfer animation rather than fabricating count stages.

### Dáil candidate-list gaps

Examples:

- 1957 `Kerry South`
- 1938 `Kerry South`
- 1922 `Cork East & North East`, `Cork Mid, North, South, South East & West`, `Mayo North & West`, `Tipperary Mid, North & South`
- 1921 `Cork East & North East`, `Cork Mid, North, South, South East & West`, `Galway`
- 1918 `Dublin University (Trinity College)`

Recommended fix:

- Split into uncontested/no-transfer rows versus parser/source-name gaps.
- For uncontested rows, add explicit `candidateRowsExpected: false` or `noTransferReason: "uncontested"` only where corroborated.
- For genuine missing candidate tables, use ElectionsIreland, Gallagher, and Wikipedia constituency pages to add candidates.

## Priority 3: Resolve The 38 Expected Transfer/Count Missing Rows

The 38 rows are not a single problem:

- 18 rows are 1996 Northern Ireland Forum constituency rows.
- 1 row is the 1996 Northern Ireland regional list row.
- 19 rows overlap with local-government rows that also have missing candidate lists.

Recommended fix:

- For the 1996 Forum, add correct voting-system metadata. It should not be treated as an STV count-animation gap. The election used constituency party/list style results plus a regional top-up mechanism; a Dáil-style or Assembly-STV transfer animation should not be expected.
- For the legacy local-government rows, resolve candidates and counts from source tables if possible. If only final tallies exist, add a clear `noTransferReason` record and keep the result pane accurate without animation.
- Update `shouldExpectTransferData` so it is based on explicit voting-system metadata, not broad body-name regexes.

## Priority 4: Add Missing Parent Source Records

Current warnings: 14.

Missing source-detail records:

- NI local government: 1973, 1977, 1981, 1985, 1989, 1993, 1997, 2001, 2005, 2011, 2014, 2019, 2023
- Mid and East Antrim local-government by-election: 2018

Recommended fix:

- Generate or add `data/browse/details/sources/election-source-local-government-YYYY-MM-DD.json` for each.
- Each source record should include:
  - ARK result page or index reference for historical rows;
  - EONI result reference for modern rows where available;
  - Wikipedia overview/local-election page as a secondary reference;
  - council PDF/archive references where specific DEA-level details came from.
- Prefer a generator over 14 hand-written files so future local-government entries get records automatically.

## Priority 5: Strengthen Single-Reference European Parliament Source Records

Current warnings: 9, all European Parliament elections from 1979 to 2019.

Recommended fix:

- Add at least one corroborating reference per parent record.
- For Republic of Ireland European elections, use ElectionsIreland plus Wikipedia and, where possible, official/European Parliament sources.
- For Northern Ireland European elections, use ARK plus Wikipedia and EONI where available.
- Keep this warning non-blocking unless a result value changes.

## Priority 6: Fix `unmatched-list-count` Diagnostics

Current warnings: 11, all older Dáil elections from 1937 to 1969.

The invariant currently says `unmatchedConstituencies.length` must equal `unmatchedCount`. For these rows the list length is exactly `30`, while count is `34`, `38`, `40`, or `42`, which strongly suggests the list is capped as a diagnostic sample while the count is the real total.

Recommended fix:

- Decide whether `unmatchedConstituencies` is authoritative or a sample.
- If it is a sample, rename it to `unmatchedConstituencySample` and add `unmatchedConstituencySampleLimit`.
- If it is meant to be authoritative, remove the cap and regenerate the manifest.
- Keep the current warning until the manifest schema is clarified.

## Priority 7: Resolve Party-Colour Mismatches With Review Overrides

The warning table only samples 10 party-colour mismatches, but the saved colour audit has:

- 1,032 unique observations
- 135 mismatches with a Wikipedia match
- 85 high-confidence mismatches
- 777 rows with no explicit election colour
- 684 rows with no Wikipedia match in the machine comparison

This should not be fixed by blindly copying Wikipedia colours. Some current Civgraph colours are deliberate visual-history conventions, while some Wikipedia matches are ambiguous or modern-party aliases applied to older labels.

Recommended fix:

- Create a reviewed override file, for example `data/elections/party-colour-review-overrides.json`.
- Classify each high-confidence mismatch as:
  - `use-wikipedia-colour`
  - `intentional-civgraph-colour`
  - `historical-variant-colour`
  - `ambiguous-label`
  - `independent-or-local-label`
  - `needs-source-review`
- Exclude empty party labels and generic independents from high-confidence mismatch examples.
- Promote only reviewed `use-wikipedia-colour` rows into the canonical party/label colour map.
- Add an audit rule requiring every mismatch to have either a fix or an explicit review status.

## Recommended Work Order

1. Add explicit voting-system/contest-type metadata and update the audit expectations.
   - This will remove false warnings for recall petitions, 1996 Forum rows, referendums, uncontested rows, and multi-member block-vote Westminster rows.

2. Fix malformed NI local-government valid-poll fields.
   - Highest data-integrity risk because negative or decimal valid-poll values are visibly wrong and can affect percentages.

3. Fill or explicitly classify missing candidate-list rows.
   - Start with modern/higher-impact local-government gaps, then old Dáil/university rows.

4. Add local-government parent source records.
   - Medium effort, high documentation value, mostly mechanical once source family is agreed.

5. Clarify the older Dáil unmatched-geography manifest schema.
   - Likely a schema/diagnostic issue rather than incorrect results.

6. Add corroborating references to European Parliament parent source records.
   - Low risk, low complexity.

7. Work through party-colour mismatches with an explicit review file.
   - Do not bulk-apply Wikipedia colours without human review.

## Guardrails To Add

- `validPoll` sanity checks by voting system.
- Explicit `candidateRowsExpected` / `transferDataExpected` metadata rather than broad regex expectations.
- Source-detail generator coverage for parent election records.
- Party-colour review-status enforcement.
- A focused audit output listing the exact rows behind `rowsMissingExpectedTransferData`, not only the aggregate count.

## Bottom Line

There are no remaining blocking election-data issues in the current audit. The remaining issues are real but manageable. The most important fixes are not additional UI work; they are source-backed metadata corrections and audit-rule refinements so the system stops treating very different contest types as if they were all Dáil-style STV elections.
