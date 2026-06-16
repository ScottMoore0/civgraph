# Test2 Election Data Audit

Generated: 2026-06-16T13:57:06.201Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|276|
|manifest loadable elections|257|
|manifest placeholders|19|
|Browse parent election entries|276|
|Browse constituency/DEA sub-entries|4696|
|Browse overall sub-entries|276|
|source detail records|276|
|result bundles loaded|276|
|result rows audited|4696|
|candidate rows audited|29731|
|rows with count detail|4644|
|rows with animation payload|4644|
|rows expected to have transfer/count data|2358|
|expected transfer/count rows missing detail|29|
|valid-poll review sidecar records|24|
|candidate-row review sidecar records|29|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|55|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|valid-poll-review|local-government-local-government-districts__2023-05-18|Ballyarnett valid poll -179 is recorded as invalid; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__2023-05-18|Magherafelt valid poll -49 is recorded as invalid; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__2011-05-05|Downshire first-preference sum 7919 exceeds valid poll ceiling 5367; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__2005-05-05|No candidates found for Giant's Causeway; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__2005-05-05|No candidates found for lg05-NoD-Ballyholme-&-Groomsport; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__2001-06-07|No candidates found for Giant's Causeway; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__2001-06-07|No candidates found for lg01-NoD-Ballyholme-&-Groomsport; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1997-05-21|Ballymena South first-preference sum 5506 exceeds valid poll ceiling 5.51; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1997-05-21|Bann Valley first-preference sum 3975 exceeds valid poll ceiling 80; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1997-05-21|Bannside first-preference sum 5920 exceeds valid poll ceiling 5.92; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1997-05-21|Braid first-preference sum 5324 exceeds valid poll ceiling 5.32; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1997-05-21|No candidates found for Giant's Causeway; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1993-05-19|Castlereagh West first-preference sum 4535 exceeds valid poll ceiling 4.54; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1993-05-19|No candidates found for Giant's Causeway; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1993-05-19|No candidates found for lg93-NoD-Ballyholme-&-Groomsport; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1993-05-19|Lower Falls first-preference sum 13003 exceeds valid poll ceiling 13; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1993-05-19|Lower Falls first-preference sum 13003 exceeds valid poll ceiling 13; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1993-05-19|Victoria first-preference sum 13527 exceeds valid poll ceiling 13.53; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1989-05-17|Bushvale first-preference sum 2715 exceeds valid poll ceiling 2.71; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1989-05-17|No candidates found for Giant's Causeway; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1989-05-17|Kells Water first-preference sum 4537 exceeds valid poll ceiling 4.54; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1989-05-17|Upper Falls first-preference sum 12409 exceeds valid poll ceiling 12.41; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1989-05-17|Upper Falls first-preference sum 12409 exceeds valid poll ceiling 12.41; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1985-05-15|Dungannon Town first-preference sum 6044 exceeds valid poll ceiling 6.04; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1985-05-15|Erne North first-preference sum 6349 exceeds valid poll ceiling 67; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1985-05-15|No candidates found for Giant's Causeway; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1981-05-20|No candidates found for Area-F; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1981-05-20|No candidates found for Area-G; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1981-05-20|No candidates found for Area-H-corrected; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1981-05-20|Armagh Area B first-preference sum 8620 exceeds valid poll ceiling 5620; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1981-05-20|Banbridge Area A first-preference sum 7876 exceeds valid poll ceiling 7576; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1981-05-20|Craigavon Area B first-preference sum 8118 exceeds valid poll ceiling 5115; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1981-05-20|Fermanagh Area B first-preference sum 5665 exceeds valid poll ceiling 109; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1977-05-18|No candidates found for Area-A-corrected; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1977-05-18|No candidates found for Area-F; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1977-05-18|No candidates found for Area-G; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1977-05-18|No candidates found for Area-H; review record status is source-review-required.|
|warning|valid-poll-review|northern-ireland-constitutional-convention__1975-05-01|Armagh first-preference sum 59388 exceeds valid poll ceiling 28136; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1973-05-30|No candidates found for Area-F; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1973-05-30|No candidates found for Area-G; review record status is source-review-required.|
|warning|candidate-list-review|local-government-local-government-districts__1973-05-30|No candidates found for Area-H; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1973-05-30|Armagh Area C first-preference sum 5439 exceeds valid poll ceiling 166; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1973-05-30|Belfast Area B first-preference sum 26403 exceeds valid poll ceiling 24814; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1973-05-30|Carrickfergus Area C first-preference sum 4156 exceeds valid poll ceiling 1456; review record status is source-review-required.|
|warning|valid-poll-review|local-government-local-government-districts__1973-05-30|Derry Area A first-preference sum 8262 exceeds valid poll ceiling 862; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1957-03-05|No candidates found for Kerry South; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1938-06-17|No candidates found for Kerry South; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1922-06-16|No candidates found for Cork East & North East; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1922-06-16|No candidates found for Cork Mid, North, South, South East & West; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1922-06-16|No candidates found for Mayo North & West; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1922-06-16|No candidates found for Tipperary Mid, North & South; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1921-05-24|No candidates found for Cork East & North East; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1921-05-24|No candidates found for Cork Mid, North, South, South East & West; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1921-05-24|No candidates found for Galway; review record status is source-review-required.|
|warning|candidate-list-review|dail-eireann__1918-12-14|No candidates found for Dublin University(Trinity College); review record status is source-review-required.|

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|0|
|source records with multiple references|276|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|0|
|Browse sub-entries with multiple references|4972|

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
