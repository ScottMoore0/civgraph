# Test2 Election Data Audit

Generated: 2026-10-10T12:12:06.066Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|1025|
|manifest loadable elections|456|
|manifest placeholders|566|
|Browse parent election entries|1025|
|Browse constituency/DEA sub-entries|8694|
|Browse overall sub-entries|1025|
|source detail records|1025|
|result bundles loaded|1025|
|result rows audited|8694|
|candidate rows audited|46807|
|rows with count detail|8674|
|rows with animation payload|8674|
|rows expected to have transfer/count data|3378|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|19|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|elected-count|ireland-local__2014-05-23|Cobh has 7 elected candidate rows but seatsWon is 6.|
|warning|elected-count|ireland-local__2014-05-23|Dundalk South has 7 elected candidate rows but seatsWon is 5.|
|warning|first-pref-sum|local-government-local-government-districts__2011-05-05|Castle first-preference sum 10024 exceeds valid poll ceiling 2462.|
|warning|first-pref-sum|local-government-local-government-districts__2005-05-05|Cusher first-preference sum 8261 exceeds valid poll ceiling 8061.|
|warning|first-pref-sum|local-government-local-government-districts__2001-06-07|Castle first-preference sum 14132 exceeds valid poll ceiling 3583.|
|warning|candidate-name-missing|dail-eireann__1997-06-06|Candidate row without a name in Mayo.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1880-03-31|Clonmel has 2 elected candidate rows but seatsWon is 1.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1872-04-26|Wexford has 2 elected candidate rows but seatsWon is 1.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1847-07-29|Clare has 3 elected candidate rows but seatsWon is 2.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1837-07-24|County Limerick has 3 elected candidate rows but seatsWon is 2.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1837-07-24|Queen's County has 3 elected candidate rows but seatsWon is 2.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1836-05-06|Mayo has 2 elected candidate rows but seatsWon is 1.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1835-01-06|Clare has 3 elected candidate rows but seatsWon is 2.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1835-01-06|Mayo has 3 elected candidate rows but seatsWon is 2.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1832-12-08|Belfast has 3 elected candidate rows but seatsWon is 2.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1832-12-08|Sligo has 2 elected candidate rows but seatsWon is 1.|
|warning|candidate-party-missing|house-of-commons-of-the-united-kingdom__1832-08-08|1 candidate rows have no party/label. Examples: Robert Otway Cave in County Tipperary.|
|warning|candidate-party-missing|house-of-commons-of-the-united-kingdom__1832-02-28|1 candidate rows have no party/label. Examples: Sir Augustine Fitzgerald in Ennis.|
|warning|elected-count|house-of-commons-of-the-united-kingdom__1831-08-18|Dublin has 2 elected candidate rows but seatsWon is 1.|

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|0|
|source records with multiple references|1025|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|0|
|Browse sub-entries with multiple references|9719|

## Party Colour Audit

|metric|value|
|---|---:|
|saved Wikipedia colour audit present|yes|
|high-confidence mismatch file present|yes|
|review override file present|yes|
|sampled mismatches already reviewed|10|
|unique colour observations|1032|
|colour matches|73|
|colour mismatches|135|
|high-confidence mismatches|85|
|entries with no explicit election colour|777|
|entries with no Wikipedia match|684|
|ambiguous Wikipedia matches|31|

### High-Confidence Colour Examples

|party/label|election colour|Wikipedia match|Wikipedia colour|observations|review|
|---|---|---|---|---:|---|
|100% Redress|#C0C0C0|100% Redress|#F90606|1|needs-canonical-colour-decision|
|An Rabharta Glas – Green Left|#C0C0C0|Rabharta|#488A89|4|needs-canonical-colour-decision|
|Anti-Austerity Alliance|#E3170D|Anti-Austerity Alliance|#FFFF00|46|needs-canonical-colour-decision|
|Anti-Treaty Sinn Féin|#C0C0C0|Sinn Féin (Anti-Treaty)|#326760|57|needs-canonical-colour-decision|
|Aontú|#C62828|Aontú|#44532A|126|needs-canonical-colour-decision|
|Clann na Poblachta|#C0C0C0|Clann na Poblachta|#BBE549|111|needs-canonical-colour-decision|
|Clann na Talmhan|#C0C0C0|Clann na Talmhan|#BDB76B|50|needs-canonical-colour-decision|
|Commonwealth Labour Party|#FF6666|Commonwealth Labour Party|#B22222|6|needs-canonical-colour-decision|
|Communist Party of Ireland|#FF3300|Communist Party of Ireland|#E3170D|6|needs-canonical-colour-decision|
|Communist Party of Ireland (Marxist-Leninist)|#E3170D|Communist Party of Ireland (Marxist–Leninist)|#660000|3|needs-canonical-colour-decision|
|Conservative|#0E7C42|Conservative and Unionist Party (UK)|#0087DC|61||
|Conservative|#1F4E8C|Conservative and Unionist Party (UK)|#0087DC|11||
|Conservative|#888888|Conservative and Unionist Party (UK)|#0087DC|13||
|Conservative|#9E9E9E|Conservative and Unionist Party (UK)|#0087DC|254||
|Cumann na nGaedheal|#C0C0C0|Cumann na nGaedheal|#87CEFA|360||
|Democracy First|#000000|Democracy First|#FF8C00|2||
|Democratic Left|#DC241F|Democratic Left (Ireland)|#C700C7|21||
|Democratic Partnership|#FF9800|Democratic Partnership|#F0E68C|10||
|Direct Democracy Ireland|#FFFF00|Direct Democracy Ireland|#87CEFA|41||
|Éirígí|#C0C0C0|Éirígí|#00A550|6||

## Next Fix Queue

1. Resolve blocking issues first; these are structural and should fail CI when present.
2. Work through source/reference warnings by adding or normalising parent and sub-entry citations, preferring official/ARK/ElectionsIreland sources with Wikipedia as secondary corroboration.
3. Resolve high-confidence party-colour mismatches by updating the canonical party/label colour map or documenting an intentional Civgraph override.
4. For entries expected to have transfer/count data but missing it, decide whether the source lacks transfer stages or whether the generated bundle failed to carry available count data through to /test2.
5. Promote this audit into the normal /test2 check path so regenerated election data cannot silently change references, colours, or bundle shape.
