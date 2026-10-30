# Test2 Election Data Audit

Generated: 2026-10-30T14:37:44.335Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|1135|
|manifest loadable elections|557|
|manifest placeholders|569|
|Browse parent election entries|1135|
|Browse constituency/DEA sub-entries|10257|
|Browse overall sub-entries|1135|
|source detail records|1135|
|result bundles loaded|1135|
|result rows audited|10257|
|candidate rows audited|57240|
|rows with count detail|10237|
|rows with animation payload|10237|
|rows expected to have transfer/count data|4059|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|69|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|source-record-single-reference|belfast-county-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1967|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1964-05-20|3 candidate rows have no party/label. Examples: H G Porter in North Ward; Cecil H Russell in North Ward; William Kidd in North Ward.|
|warning|source-record-single-reference|belfast-county-borough-council__1961|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1961|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1961|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1961|18 candidate rows have no party/label. Examples: James Maguire in East Ward; George Quinn in East Ward; Teague Boyle in East Ward; Thomas A Forbes in East Ward; Gerald Doran in East Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1958|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1958|13 candidate rows have no party/label. Examples: F Boyle in East Ward; J Campbell in East Ward; G Quinn in East Ward; J Maguire in East Ward; P White in East Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1955|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1955|17 candidate rows have no party/label. Examples: Teague Boyle in East Ward; George Quinn in East Ward; James Maguire in East Ward; Patrick White in East Ward; Walter A Elliott in North Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1952|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1952|14 candidate rows have no party/label. Examples: Teague Boyle in East Ward; James Maguire in East Ward; George Quinn in East Ward; Walter A Elliott in North Ward; Hubert Y. Fergusson in North Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1949|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1946|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1939|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1939|4 candidate rows have no party/label. Examples: T.A. Forbes in East Ward; W.J. McK Craig in North Ward; Thomas McGarrigle in South Ward; Thomas Maguire in South Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1936|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1936|11 candidate rows have no party/label. Examples: Arthur Thomas Forbes in East Ward; Bernard Mulhern in East Ward; John Kelly in East Ward; John Perry in North Ward; Cecil Russell in North Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1932|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1929|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1929|11 candidate rows have no party/label. Examples: John McDermott in East Ward; Thomas Stewart in East Ward; John Boyle in East Ward; John Kelly in East Ward; Michael Furey in South Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1926|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1926|9 candidate rows have no party/label. Examples: Thomas Stewart in East Ward; John Boyle in East Ward; William Forbes in East Ward; Michael McShane in South Ward; James McGraine in South Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1923-01-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1920|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1920|1 candidate rows have no party/label. Examples: Felix Quinn in South Area.|
|warning|source-record-single-reference|strabane-urban-district-council__1915|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1915|6 candidate rows have no party/label. Examples: Patrick McCollum in East Ward; John Browne in North Ward; Constantine Connolly in North Ward; Michael Bradley in South Ward; James Toorish in South Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1914|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1914|4 candidate rows have no party/label. Examples: Thomas K. Howie in East Ward; James White in North Ward; P Gallagher in South Ward; John McDermott in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1913|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1913|4 candidate rows have no party/label. Examples: John Kelly in East Ward; John Perry in North Ward; James McGarrigle in South Ward; Charles Browne in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1912|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1912|5 candidate rows have no party/label. Examples: P Bannigan in East Ward; John Browne in North Ward; James Toorish in South Ward; Ellis in South Ward; Eugene Conroy in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1911|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1911|5 candidate rows have no party/label. Examples: James Dillon in East Ward; John Quigley in East Ward; James White in North Ward; Edward Gallagher in South Ward; John McDermott in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1910|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1910|4 candidate rows have no party/label. Examples: John Kelly in East Ward; John Perry in North Ward; James Toorish in South Ward; Charles Browne in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1909|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1909|4 candidate rows have no party/label. Examples: James Elliott in East Ward; R. J. Blair in North Ward; Owen Canavan in South Ward; Eugene Conroy in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1908|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1908|4 candidate rows have no party/label. Examples: James Dillon in East Ward; James White in North Ward; James McIvor in South Ward; Edward Gallagher in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1907|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1907|8 candidate rows have no party/label. Examples: John Kelly in East Ward; James McCrossan in East Ward; John Perry in North Ward; William McCrorey in North Ward; James Tourish in South Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1906|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1906|6 candidate rows have no party/label. Examples: John Dillon in East Ward; Eugene Conroy in East Ward; William McDevitt in North Ward; J McCrossan in South Ward; Owen Canavan in South Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1905|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1905|5 candidate rows have no party/label. Examples: William Ellis in East Ward; John McColgan in East Ward; James White in North Ward; John McDermott in South Ward; James Toner in West Ward.|
|warning|source-record-single-reference|strabane-urban-district-council__1902|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1899|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1899|11 candidate rows have no party/label. Examples: Devine in Strabane; M'Colgan in Strabane; Dunn in Strabane; White in Strabane; Nelson in Strabane.|
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
|source records with one reference|34|
|source records with multiple references|1101|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|205|
|Browse sub-entries with multiple references|11187|

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
