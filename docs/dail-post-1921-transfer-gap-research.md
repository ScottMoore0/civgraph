# Post-1921 Dail Transfer Gap Research

Date: 2026-06-08

## Implementation Result

Implemented on 2026-06-08:

- Added importer aliases/title normalisation for the recurring post-1921 Dail gaps.
- Regenerated 29 new Wikipedia count-table sidecars.
- Added 24 explicit non-animated records in `data/elections/dail-wikipedia-counts/_no-transfer.json`.
- Regenerated `/test2` election metadata so the new sidecars are embedded in Dail bundles.
- Added a route validation guardrail: `scripts/validate-test2-route.mjs` now fails if any post-1921 Dail row remains silently unresolved in `_report.json`.

Current audit state: `data/elections/dail-wikipedia-counts/_report.json` represents 842 of 973 Dail targets. The remaining 131 are pre-1922 rows. There are now zero unresolved post-1921 rows in the importer report.

## Scope

`data/elections/dail-wikipedia-counts/_report.json` currently identifies 53 post-1921 Dail constituency/election rows that do not have a usable local Wikipedia count-table sidecar. This note classifies those rows by the correct handling path.

The main conclusion is that these are not one kind of gap. Most are recoverable by improving importer title aliases and older-table parsing. A smaller group should be represented explicitly as uncontested/no-transfer results. The hard remainder needs corroboration from Gallagher, ElectionsIreland, or official/archival sources before sidecars should be generated.

## Highest-ROI Handling

1. Fix importer aliases and old title normalisation.
2. Add parser fallback for older STV table variants and rendered wikitables.
3. Regenerate sidecars for the rows listed as importable.
4. Add explicit no-transfer/uncontested records where the historical result did not have transferable count stages.
5. Queue the remaining university and 1922 combined-constituency rows for source-backed manual reconciliation.

## Importable With Alias/Parser Fixes

These rows should be importable from current Wikipedia-style constituency pages once title aliases and older-table parsing are made more robust.

| Date | Report row | Likely source title/action |
| --- | --- | --- |
| 1922-06-16 | *Tipperary Mid, North & South | Strip leading punctuation; use `Tipperary Mid, North and South`. |
| 1922-06-16 | Cork East & North East | Use `Cork East and North East`. |
| 1922-06-16 | Cork Mid, North, South, South East & West | Use `Cork Mid, North, South, South East and West`. |
| 1922-06-16 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1923-08-27 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1927-06-09 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1927-09-15 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1932-02-16 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1933-01-24 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1937-07-01 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1938-06-17 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1943-06-22 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1944-05-30 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1948-02-04 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1951-05-30 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1954-05-18 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1957-03-05 | Leix Offaly | Use `Laois-Offaly` / old-section `Leix-Offaly`. |
| 1948-02-04 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1951-05-30 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1954-05-18 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1957-03-05 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1961-10-04 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1965-04-07 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1969-06-18 | Dun Laoghaire Rathdown | Use `Dun Laoghaire and Rathdown` / page title with Irish accent. |
| 1944-05-30 | Monaghan | Use Dail constituency page and older count-table parser fallback. |
| 1957-03-05 | Kerry South | Use Dail constituency page and older count-table parser fallback. |
| 1969-06-18 | Clare Galway South | Use `Clare-South Galway`. |
| 1969-06-18 | Cork City North | Use `Cork City North-West`. |
| 1969-06-18 | Cork City South | Use `Cork City South-East`. |

Implementation notes:

- Add title aliases in `scripts/import-dail-wikipedia-counts.mjs`.
- Strip leading punctuation from report/source names before title matching.
- Prefer constituency/Dail pages over generic county or place pages.
- Add fallback parsing for `STV Election box begin2`, rendered `wikitable` count columns, and pages that do not use the current exact `STV Election box candidate` template shape.

## Source-Backed No-Transfer Or Uncontested Handling

These rows should not get fabricated transfer animations. If corroborated as uncontested or lacking transferable count stages, create explicit no-transfer records so they stop appearing as unresolved animation gaps.

| Date | Report row | Recommended handling |
| --- | --- | --- |
| 1922-06-16 | Clare | Corroborate uncontested/no-count status, then write no-transfer record. |
| 1922-06-16 | Donegal | Corroborate uncontested/no-count status, then write no-transfer record. |
| 1922-06-16 | Dublin University | Corroborate uncontested/no-count status, then write no-transfer record if appropriate. |
| 1922-06-16 | Limerick City and East | Corroborate uncontested/no-count status, then write no-transfer record. |
| 1922-06-16 | Mayo North & West | Corroborate uncontested/no-count status, then write no-transfer record. |
| 1938-06-17 | Donegal West | Treat as no-transfer/uncontested if source review confirms no count table exists. |
| 1938-06-17 | Kerry South | Treat as no-transfer/uncontested if source review confirms no count table exists. |
| 1944-05-30 | Donegal West | Treat as no-transfer/uncontested if source review confirms no count table exists. |

Implementation notes:

- A no-transfer sidecar should be explicit, source-referenced, and should not create fake count deltas.
- The UI should distinguish "no transferable count stages existed/found" from "data missing".

## Needs Non-Wikipedia Corroboration Before Import

These rows are historically plausible, but should not be auto-filled until checked against Gallagher, ElectionsIreland, Walker, or official/archival sources. Some may become importable through aliases; others may require hand-authored sidecars or no-transfer records.

| Date | Report row | Recommended handling |
| --- | --- | --- |
| 1922-06-16 | Kerry Limerick West | Check Gallagher/ElectionsIreland; import or no-transfer depending on source. |
| 1922-06-16 | Leitrim Roscommon North | Check Gallagher/ElectionsIreland; import or no-transfer depending on source. |
| 1922-06-16 | Mayo South Roscommon South | Check Gallagher/ElectionsIreland; import or no-transfer depending on source. |
| 1922-06-16 | National University | Check Gallagher/ElectionsIreland/official university constituency records. |
| 1922-06-16 | Sligo Mayo East | Check Gallagher/ElectionsIreland; import or no-transfer depending on source. |
| 1922-06-16 | Waterford Tipperary East | Check Gallagher/ElectionsIreland; import or no-transfer depending on source. |
| 1923-08-27 | Dublin University | Check university constituency records; do not fabricate transfers. |
| 1923-08-27 | National Univeristy | Correct spelling to `National University`; check university constituency records. |
| 1927-06-09 | Dublin University | Check university constituency records; do not fabricate transfers. |
| 1927-06-09 | National Univeristy | Correct spelling to `National University`; check university constituency records. |
| 1927-09-15 | Dublin University | Check university constituency records; do not fabricate transfers. |
| 1927-09-15 | National Univeristy | Correct spelling to `National University`; check university constituency records. |
| 1932-02-16 | Dublin University | Check university constituency records; do not fabricate transfers. |
| 1932-02-16 | National Univeristy | Correct spelling to `National University`; check university constituency records. |
| 1933-01-24 | Dublin University | Check university constituency records; do not fabricate transfers. |
| 1933-01-24 | National Univeristy | Correct spelling to `National University`; check university constituency records. |

Implementation notes:

- Preserve the misspelled local key only as an input alias; generated titles and metadata should use `National University`.
- For university rows, prefer explicit archival/source records over fuzzy Wikipedia page matching.

## Verification Performed

- Local inventory of `data/elections/dail-wikipedia-counts/_report.json` confirmed exactly 53 post-1921 missing sidecar rows.
- Read-only source probes confirmed likely current pages or source-title candidates for the recurring groups:
  - `Laois-Offaly`
  - `Dun Laoghaire and Rathdown`
  - `Cork East and North East`
  - `Cork Mid, North, South, South East and West`
  - `Tipperary Mid, North and South`
  - `Waterford-Tipperary East`
  - `Leitrim-Roscommon North`
  - `Mayo South-Roscommon South`
  - `Dublin University`
  - `National University of Ireland`
  - `Monaghan`
  - `Kerry South`
  - `Donegal West`
  - `Clare-South Galway`
  - `Cork City North-West`
  - `Cork City South-East`

## Reference Links

- https://en.wikipedia.org/wiki/Laois%E2%80%93Offaly
- https://en.wikipedia.org/wiki/D%C3%BAn_Laoghaire_and_Rathdown_(D%C3%A1il_constituency)
- https://en.wikipedia.org/wiki/Cork_East_and_North_East
- https://en.wikipedia.org/wiki/Cork_Mid,_North,_South,_South_East_and_West
- https://en.wikipedia.org/wiki/Tipperary_Mid,_North_and_South
- https://en.wikipedia.org/wiki/Dublin_University_(constituency)
- https://en.wikipedia.org/wiki/National_University_of_Ireland_(constituency)
- https://en.wikipedia.org/wiki/Kerry_South_(D%C3%A1il_constituency)
- https://en.wikipedia.org/wiki/Donegal_West_(D%C3%A1il_constituency)
- https://www.tcd.ie/Political_Science/about/people/michael_gallagher/IrishElections1922-44.pdf
