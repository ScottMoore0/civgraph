# Test2 Election Data Audit

Generated: 2026-09-13T19:06:09.050Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|291|
|manifest loadable elections|276|
|manifest placeholders|12|
|Browse parent election entries|291|
|Browse constituency/DEA sub-entries|5746|
|Browse overall sub-entries|291|
|source detail records|291|
|result bundles loaded|291|
|result rows audited|5746|
|candidate rows audited|41344|
|rows with count detail|5710|
|rows with animation payload|5710|
|rows expected to have transfer/count data|3376|
|expected transfer/count rows missing detail|13|
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
|warning|candidate-list-missing|ireland-local__2024-06-07|No candidates found for Athlone (Roscommon).|
|warning|candidate-list-missing|ireland-local__2019-05-24|No candidates found for Athlone (Roscommon).|
|warning|candidate-list-missing|ireland-local__2014-05-23|No candidates found for Athlone (Roscommon).|
|warning|candidate-list-missing|ireland-local__2014-05-23|No candidates found for Athlone (Westmeath).|
|warning|elected-count|ireland-local__2014-05-23|Cobh has 7 elected candidate rows but seatsWon is 6.|
|warning|elected-count|ireland-local__2014-05-23|Dundalk South has 7 elected candidate rows but seatsWon is 5.|
|warning|first-pref-sum|local-government-local-government-districts__2011-05-05|Castle first-preference sum 10024 exceeds valid poll ceiling 2462.|
|warning|candidate-list-missing|ireland-local__2009-06-05|No candidates found for Athlone (Roscommon).|
|warning|candidate-list-missing|ireland-local__2009-06-05|No candidates found for Athlone (Westmeath).|
|warning|first-pref-sum|local-government-local-government-districts__2005-05-05|Cusher first-preference sum 8261 exceeds valid poll ceiling 8061.|
|warning|candidate-list-missing|ireland-local__2004-06-11|No candidates found for Athlone (Roscommon).|
|warning|candidate-list-missing|ireland-local__2004-06-11|No candidates found for Athlone (Westmeath).|
|warning|first-pref-sum|local-government-local-government-districts__2001-06-07|Castle first-preference sum 14132 exceeds valid poll ceiling 3583.|
|warning|candidate-list-missing|ireland-local__1999-06-10|No candidates found for Athlone (Roscommon).|
|warning|candidate-list-missing|ireland-local__1999-06-10|No candidates found for Athlone (Westmeath).|
|warning|candidate-list-missing|dail-eireann__1997-06-06|No candidates found for Dún Laoghaire.|
|warning|candidate-name-missing|dail-eireann__1997-06-06|Candidate row without a name in Mayo.|
|warning|candidate-list-missing|dail-eireann__1992-11-25|No candidates found for Dún Laoghaire.|
|warning|candidate-list-missing|ireland-local__1991-06-27|No candidates found for Athlone* (Roscommon).|

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|0|
|source records with multiple references|291|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|0|
|Browse sub-entries with multiple references|6037|

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
