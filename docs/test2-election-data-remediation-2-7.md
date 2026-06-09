# Test2 Election Data Remediation Research For Items 2-7

Generated: 2026-06-09

## Scope

This is the specific follow-up research pass for recommendations 2-7 from the remaining `/test2` election-data audit work:

2. malformed NI local valid-poll fields
3. missing candidate-list rows
4. missing parent source records
5. old Dail unmatched-geography diagnostics
6. party-colour review
7. tests and guardrails

This report is based on the current local audit output in `tasks/test2-election-data-audit.json`, the existing broad report in `docs/test2-election-data-remaining-issues-research.md`, local party-colour audit files, and the relevant source families:

- EONI election results and statistics: <https://www.eoni.org.uk/Elections/Election-results-and-statistics>
- ARK Northern Ireland Elections: <https://www.ark.ac.uk/elections/>
- ElectionsIreland: <https://electionsireland.org/>
- European Parliament election results: <https://results.elections.europa.eu/>
- Wikipedia election pages and party-colour modules, used as secondary/corroborating sources where appropriate.

No election result data is changed by this report. It specifies what should be fixed, how to fix it, and what should be treated as a false positive or explicit source gap.

## Current Audit Inventory

The current audit has 113 warning-level issues and no blocking issues.

| Warning class | Count | Recommendation |
|---|---:|---|
| `first-pref-sum` | 39 | Correct malformed valid-poll values, then reclassify expected block-vote cases. |
| `candidate-list-missing` | 30 | Split false positives from true missing candidate tables; add explicit expectation metadata. |
| `source-record-missing` | 14 | Generate parent source records for NI local-government elections and one by-election. |
| `unmatched-list-count` | 11 | Fix diagnostic schema for capped unmatched samples and keep geography matching as a separate data gap. |
| `party-colour-mismatch` | 10 sampled | Use a reviewed override workflow, not blind Wikipedia colour replacement. |
| `source-record-single-reference` | 9 | Add corroborating references for European Parliament parent source records. |

## 2. Malformed NI Local Valid-Poll Fields

### What Is A True Error

For STV local-government rows, the sum of candidate first preferences should not exceed the valid poll. The warnings below are therefore real data-quality problems unless they are explicitly reclassified as a different voting system.

High-confidence malformed rows:

| Election | Row | Audit symptom | Likely cause | Action |
|---|---|---|---|---|
| 2023 NI local | Ballyarnett | sum `9740` > valid poll `-179` | Bad parsed or mapped valid poll | Correct from EONI/ARK; block negative valid polls. |
| 2023 NI local | Magherafelt | sum `8257` > valid poll `-49` | Bad parsed or mapped valid poll | Correct from EONI/ARK; block negative valid polls. |
| 2011 NI local | Downshire | sum `7919` > valid poll `5367` | Wrong valid-poll row or duplicated/misjoined candidate rows | Reconcile against EONI/ARK table before correction. |
| 1997 NI local | Ballymena South | sum `5506` > valid poll `5.51` | Decimal/thousands parse error | Correct valid poll from source, likely thousands value. |
| 1997 NI local | Bannside | sum `5920` > valid poll `5.92` | Decimal/thousands parse error | Correct valid poll from source, likely thousands value. |
| 1997 NI local | Braid | sum `5324` > valid poll `5.32` | Decimal/thousands parse error | Correct valid poll from source, likely thousands value. |
| 1997 NI local | Bann Valley | sum `3975` > valid poll `80` | Bad cell or lost digits | Source-check manually. |
| 1993 NI local | Castlereagh West | sum `4535` > valid poll `4.54` | Decimal/thousands parse error | Correct from source. |
| 1993 NI local | Lower Falls | sum `13003` > valid poll `13` | Decimal/thousands parse error or truncated field | Correct from source. |
| 1993 NI local | Victoria | sum `13527` > valid poll `13.53` | Decimal/thousands parse error | Correct from source. |
| 1989 NI local | Bushvale | sum `2715` > valid poll `2.71` | Decimal/thousands parse error | Correct from source. |
| 1989 NI local | Kells Water | sum `4537` > valid poll `4.54` | Decimal/thousands parse error | Correct from source. |
| 1989 NI local | Upper Falls | sum `12409` > valid poll `12.41` | Decimal/thousands parse error | Correct from source. |
| 1985 NI local | Dungannon Town | sum `6044` > valid poll `6.04` | Decimal/thousands parse error | Correct from source. |
| 1985 NI local | Erne North | sum `6349` > valid poll `67` | Bad cell or lost digits | Source-check manually. |
| 1981 NI local | Armagh Area B | sum `8620` > valid poll `5620` | Wrong valid poll or duplicated/misjoined row | Source-check manually. |
| 1981 NI local | Banbridge Area A | sum `7876` > valid poll `7576` | Small but real mismatch | Source-check manually. |
| 1981 NI local | Craigavon Area B | sum `8118` > valid poll `5115` | Wrong valid poll or duplicated/misjoined row | Source-check manually. |
| 1981 NI local | Fermanagh Area B | sum `5665` > valid poll `109` | Bad cell or lost digits | Source-check manually. |
| 1973 NI local | Armagh Area C | sum `5439` > valid poll `166` | Bad cell or lost digits | Source-check manually. |
| 1973 NI local | Belfast Area B | sum `26403` > valid poll `24814` | Wrong valid poll or candidate grouping | Source-check manually. |
| 1973 NI local | Carrickfergus Area C | sum `4156` > valid poll `1456` | Bad cell or lost digits | Source-check manually. |
| 1973 NI local | Derry Area A | sum `8262` > valid poll `862` | Bad cell or lost digits | Source-check manually. |

The 1975 Constitutional Convention `Armagh` warning is similar in audit shape, but it is not an NI local-government row. It should be handled in the same correction sidecar because the likely issue is still wrong valid-poll metadata or row duplication.

### What Is Probably Not An Error

The old Westminster two-member rows are a different class. Rows such as 1922-1945 `Antrim`, `Down`, and `Fermanagh and Tyrone` often have candidate vote totals very close to exactly two times the valid poll. These should be reclassified as block-vote or multi-member plurality rows rather than "fixed" by reducing candidate totals.

Specific action:

- Add `votingSystem: "block-vote"` for old two-seat Westminster rows.
- Add `votesPerElector: seatsTotal` or an equivalent audit field.
- Update `first-pref-sum` audit logic so block-vote rows are compared against the correct maximum instead of STV valid-poll rules.

### Recommended Implementation

1. Add `data/elections/corrections/valid-polls.json`.
2. Store corrections as source-backed records:

```json
{
  "electionId": "local-government-local-government-districts__2023-05-18",
  "area": "Ballyarnett",
  "field": "validPoll",
  "oldValue": -179,
  "newValue": null,
  "status": "source-review-required",
  "references": []
}
```

3. Add a generator step that applies only reviewed corrections.
4. Add a validation rule:
   - negative valid polls are blocking unless `validPollStatus` is `not-applicable` or `unknown`;
   - STV `sum(firstPref) > validPoll` is blocking unless the row has an explicit source exception;
   - old multi-seat block-vote rows use `validPoll * votesPerElector`.

## 3. Missing Candidate-List Rows

### False Positive

| Election | Row | Action |
|---|---|---|
| 2018 North Antrim recall petition | North Antrim | Set `contestType: "recall-petition"` and `candidateRowsExpected: false`. Do not create fake candidate rows. |

### True NI Local-Government Gaps

These rows should be treated as true source gaps unless a source confirms no contest:

- 2005: `Giant's Causeway`; `lg05-NoD-Ballyholme-&-Groomsport`
- 2001: `Giant's Causeway`; `lg01-NoD-Ballyholme-&-Groomsport`
- 1997: `Giant's Causeway`
- 1993: `Giant's Causeway`; `lg93-NoD-Ballyholme-&-Groomsport`
- 1989: `Giant's Causeway`
- 1985: `Giant's Causeway`
- 1981: `Area-F`; `Area-G`; `Area-H-corrected`
- 1977: `Area-A-corrected`; `Area-F`; `Area-G`; `Area-H`
- 1973: `Area-F`; `Area-G`; `Area-H`

Recommended source order:

1. ARK election result pages.
2. EONI historical results or PDFs where available.
3. Wikipedia local-election pages and referenced tables.
4. Council PDFs or archived council pages.

Recommended data action:

- If full candidates and first preferences are available, add result rows.
- If count stages are available, add transfer/count records.
- If only final candidate totals are available, add result rows plus `noTransferReason: "source-does-not-publish-count-stages"`.
- If the row was uncontested, set `contestStatus: "uncontested"` and do not warn on missing candidates.

### Dail / Older Irish Gaps

Rows still reported as candidate-list missing:

- 1957: `Kerry South`
- 1938: `Kerry South`
- 1922: `Cork East & North East`; `Cork Mid, North, South, South East & West`; `Mayo North & West`; `Tipperary Mid, North & South`
- 1921: `Cork East & North East`; `Cork Mid, North, South East & West`; `Galway`
- 1918: `Dublin University (Trinity College)`

Recommended handling:

- 1918 `Dublin University` is not a Dail STV candidate-list case. It should be modelled as Westminster/FPTP-era data, with candidate expectations determined by that election source.
- 1921 and 1922 rows need explicit contested/uncontested classification. Do not infer candidates from neighbouring constituencies.
- For 1938 and 1957 `Kerry South`, check ElectionsIreland, Wikipedia constituency/election pages, and Gallagher before adding or suppressing candidate rows.

Add fields:

- `candidateRowsExpected`
- `candidateDataStatus`
- `candidateDataReason`
- `contestStatus`

These fields should be consumed by the audit so that genuine no-poll/uncontested rows are not reported as missing data.

## 4. Missing Parent Source Records

The audit reports 14 missing parent source records:

- NI local government: 1973, 1977, 1981, 1985, 1989, 1993, 1997, 2001, 2005, 2011, 2014, 2019, 2023
- Mid and East Antrim local-government by-election: 2018

Recommended fix:

- Generate `data/browse/details/sources/election-source-local-government-YYYY-MM-DD.json` records programmatically.
- Include at least:
  - title
  - election id
  - source families used
  - references array
  - coverage notes
  - data-quality notes
  - accessed date

Suggested source template:

```json
{
  "id": "election-source-local-government-2023-05-18",
  "title": "2023 Northern Ireland local election source record",
  "type": "election-source",
  "references": [
    {
      "label": "EONI election results and statistics",
      "url": "https://www.eoni.org.uk/Elections/Election-results-and-statistics",
      "role": "official-results"
    },
    {
      "label": "ARK Northern Ireland Elections",
      "url": "https://www.ark.ac.uk/elections/",
      "role": "corroborating-archive"
    }
  ],
  "notes": "Parent record for local-government election results. DEA-level rows may carry more specific references."
}
```

For the 9 European Parliament records with only one reference, add corroborating references rather than changing result data:

- ROI European elections: ElectionsIreland, Wikipedia, and European Parliament results.
- NI European elections: ARK, Wikipedia, EONI where available, and European Parliament results.

## 5. Old Dail Unmatched-Geography Diagnostics

The 11 warnings are:

- 1969: `unmatchedConstituencies.length` is 30, `unmatchedCount` is 42.
- 1965: 30 vs 38.
- 1961: 30 vs 38.
- 1957: 30 vs 40.
- 1954: 30 vs 40.
- 1951: 30 vs 40.
- 1948: 30 vs 40.
- 1944: 30 vs 34.
- 1943: 30 vs 34.
- 1938: 30 vs 34.
- 1937: 30 vs 34.

The repeated length of exactly `30` strongly indicates a capped diagnostic sample, not a data fact. The result bundles say every constituency is currently unmatched for these older Dail layers, while the diagnostic list only exposes the first 30 names.

Recommended fix:

1. Rename `unmatchedConstituencies` to `unmatchedConstituencySample` where the array is capped.
2. Add `unmatchedConstituencySampleLimit: 30`.
3. Keep `unmatchedCount` as the authoritative count.
4. Add route validation:
   - if a full list is emitted, list length must equal count;
   - if a sample is emitted, sample length must be <= sample limit and count must be >= sample length.
5. Track the old Dail geography crosswalk separately as a data coverage issue. It should not be mixed with result-data validation.

This is mostly a manifest/schema fix. It does not require changing election results.

## 6. Party-Colour Review

The audit samples 10 mismatches, but the stored colour audit has a larger review queue. The key problem is that Wikipedia party colours are useful, but they are not automatically authoritative for every Civgraph label. Some labels are local, historical, ambiguous, merged, split, or deliberately styled differently for visual continuity.

High-priority modern/frequent labels to review first:

| Label | Current audit symptom | Recommendation |
|---|---|---|
| 100% Redress | grey vs Wikipedia red | Likely use Wikipedia colour if the label is specific and current. |
| Rabharta | grey vs Wikipedia teal | Likely use Wikipedia colour if source match is unambiguous. |
| Aontu | red vs Wikipedia olive/green | Review because this affects modern Browse/election panes visibly. |
| Anti-Austerity Alliance | red vs Wikipedia yellow | Review historical alliance colour; may need year-scoped override. |
| Sinn Fein (Anti-Treaty) | grey vs Wikipedia green | Treat as historical variant, not necessarily current Sinn Fein green. |
| Clann na Poblachta | grey vs Wikipedia light green | Likely add historical colour with source status. |
| Clann na Talmhan | grey vs Wikipedia khaki | Likely add historical colour with source status. |
| Commonwealth Labour Party | light red vs dark red | Review historical source. |
| Communist Party of Ireland | red variants differ | Low-risk, but should be explicit. |
| CPI (Marxist-Leninist) | red variants differ | Low-risk, but should be explicit. |

Recommended implementation:

1. Add `data/elections/party-colour-review-overrides.json`.
2. For each mismatch, record:

```json
{
  "label": "Aontu",
  "currentColour": "#C62828",
  "referenceColour": "#44532A",
  "referenceSource": "wikipedia-political-party-colours",
  "decision": "needs-source-review",
  "scope": "all-years",
  "notes": ""
}
```

3. Allow decisions:
   - `use-reference-colour`
   - `intentional-civgraph-colour`
   - `historical-variant-colour`
   - `year-scoped-colour`
   - `ambiguous-label`
   - `independent-or-local-label`
   - `needs-source-review`
4. Only promote `use-reference-colour` and reviewed `year-scoped-colour` decisions to the canonical palette.
5. Add a guardrail that fails only on unreviewed high-confidence mismatches after the review file exists.

Do not bulk replace all colours from Wikipedia. That would create new historical and local-label errors.

## 7. Tests And Guardrails

Add these guardrails in descending order of value:

1. Election metadata schema validation.
   - Enforce `votingSystem`, `contestType`, `kind`, and `contestStatus` enums.
   - Valid `votingSystem`: `fptp`, `block-vote`, `stv-gregory`, `stv-hare`, `party-list-dhondt`, `ordinal`.
   - Valid `contestType`: `election`, `recall-petition`, `referendum`.
   - Valid `kind`: `general`, `by-election`.
   - Valid `contestStatus`: `contested`, `uncontested`.

2. Vote-total invariant by voting system.
   - STV rows: first-preference sum must not exceed valid poll.
   - Block-vote rows: candidate vote total may exceed valid poll up to the configured vote-per-elector limit.
   - Referendums/recall petitions: do not require candidate rows.

3. Source-record coverage validation.
   - Every parent election must have a source detail file.
   - Every parent source detail file should have at least two references unless explicitly marked as single-source-only.
   - Every correction row must cite a source or be marked `source-review-required`.

4. Candidate expectation validation.
   - Missing candidates are blocking only when `candidateRowsExpected !== false` and `contestStatus !== "uncontested"`.
   - Recall petitions and referendums do not trigger candidate-list warnings.

5. Transfer expectation validation.
   - STV-Hare and STV-Gregory contests can expect transfer/count records where source tables are available.
   - FPTP, block-vote, party-list D'Hondt, ordinal, recall-petition, and referendum entries should not be forced into STV transfer-animation expectations.

6. Unmatched diagnostic schema validation.
   - Capped samples must be named as samples.
   - Full lists must equal the count.

7. Party-colour override validation.
   - High-confidence mismatches must have a review decision.
   - Palette generation should only consume reviewed decisions.

8. Browser smoke fixtures for known edge cases.
   - 2024 Irish general election overall.
   - One 2024 Dail constituency with transfer data.
   - 1996 NI Forum constituency and Regional List with no STV transfer expectation.
   - 2018 North Antrim recall petition.
   - One old two-seat Westminster block-vote row.
   - One old Dail unmatched geography row.

## Specific Work Order

1. Add explicit election metadata fields and audit enum validation.
2. Reclassify false-positive warning classes:
   - North Antrim 2018 recall petition.
   - 1996 NI Forum constituency/regional-list rows.
   - old two-seat Westminster block-vote rows.
3. Add generated parent source records for NI local-government elections.
4. Add European Parliament corroborating references.
5. Add valid-poll correction sidecar and fill it with source-reviewed NI local rows.
6. Add candidate expectation metadata and then fill true candidate gaps source-by-source.
7. Fix old Dail unmatched diagnostic naming.
8. Add party-colour review override file and classify the high-confidence queue.
9. Add validation tests for each warning class so regressions fail before deployment.

## Bottom Line

The current warnings are not all the same kind of problem. The correct path is:

- fix genuinely malformed numeric fields from sources;
- explicitly model contest type and voting system so audits stop misclassifying recalls, referendums, Forum rows, and block-vote rows;
- add source records and references mechanically;
- treat old Dail geography matching and party colours as separate reviewed workflows.

That will eliminate the noisy false positives while preserving the real warnings that still require source-backed election data work.
