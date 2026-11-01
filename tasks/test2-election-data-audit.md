# Test2 Election Data Audit

Generated: 2026-11-01T11:55:51.667Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|1370|
|manifest loadable elections|557|
|manifest placeholders|584|
|Browse parent election entries|1370|
|Browse constituency/DEA sub-entries|12062|
|Browse overall sub-entries|1370|
|source detail records|1370|
|result bundles loaded|1370|
|result rows audited|12062|
|candidate rows audited|61259|
|rows with count detail|12019|
|rows with animation payload|12019|
|rows expected to have transfer/count data|4092|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|492|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|source-record-single-reference|armagh-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-county-council__1967-06-01|1 candidate rows have no party/label. Examples: Frank Hayes in Killyman.|
|warning|source-record-single-reference|armagh-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-rural-district-council__1967-06-01|2 candidate rows have no party/label. Examples: Ernest William Charles Weir in Killyman; Kenneth Kelly in Richhill.|
|warning|source-record-single-reference|newry-no-2-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-2-rural-district-council__1967-06-01|43 candidate rows have no party/label. Examples: Donald J. Mulligan in Ballybot; Gerald Mulholland in Ballybot; Harold Kinney in Ballybot; Patrick J. Luckie in Ballymoyer; Oliver B. Murphy in Belleek.|
|warning|source-record-single-reference|tandragee-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|tandragee-rural-district-council__1967-06-01|5 candidate rows have no party/label. Examples: Andrew Isaac Crothers in Ballyshiel; Robert Woolsey in Laurelvale; Norman Alexander Beattie in Mullabrack; John McIntyre in Mullahead; Robert John McClelland in Tandragee Rural.|
|warning|source-record-single-reference|belfast-county-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|keady-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|keady-urban-district-council__1967-05-17|9 candidate rows have no party/label. Examples: Malachy Gorman in Keady; Brian Hughes in Keady; Bernard Arthurs in Keady; Eugene Connolly in Keady; Patrick J. McParland in Keady.|
|warning|source-record-single-reference|lurgan-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|lurgan-borough-council__1967-05-17|No candidates found for Lurgan (aldermen).|
|warning|candidate-list-missing|lurgan-borough-council__1967-05-17|No candidates found for Lurgan (councillors).|
|warning|source-record-single-reference|portadown-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|portadown-borough-council__1967-05-17|No candidates found for Portadown (councillors).|
|warning|source-record-single-reference|tandragee-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-urban-district-council__1967|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|armagh-county-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-county-council__1964-06-04|20 candidate rows have no party/label. Examples: C. R. Morrow in Bessbrook; L. W. Abraham in Breagh; Malachy Trainor in Crossmaglen; Patrick Short in Crossmaglen; R. R. Murphy in Crossmore.|
|warning|source-record-single-reference|armagh-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-rural-district-council__1964-06-04|30 candidate rows have no party/label. Examples: Thomas S. Hoey in Aghory; David Oscar Redman in Annaghmore; William James Shilliday in Armaghbrague; Thomas Steele in Ballyards; J. J. Allen in Ballymartrim.|
|warning|source-record-single-reference|lurgan-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|lurgan-rural-district-council__1964-06-04|10 candidate rows have no party/label. Examples: William Stewart in Breagh; Patrick James Crilly in Brownlowsderry; Robert Jones in Carrowbrack; Thomas John McKavanagh in Cornakinnegar; Thomas J. Robinson in Drumcree.|
|warning|source-record-single-reference|newry-no-2-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-2-rural-district-council__1964-06-04|44 candidate rows have no party/label. Examples: Patrick Luckie in Ballymoyer; Patrick E. McKeown in Ballymoyer; Robert McGuinness in Belleek; James Andrews in Bessbrook North; Gerard Feighan in Bessbrook South.|
|warning|source-record-single-reference|tandragee-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|tandragee-rural-district-council__1964-06-04|5 candidate rows have no party/label. Examples: Andrew Isaac Crothers in Ballyshiel; Robert Woolsey in Laurelvale; Norman Alexander Beattie in Mullabrack; John McIntyre in Mullahead; Robert John McClelland in Tandragee Rural.|
|warning|source-record-single-reference|armagh-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-urban-district-council__1964-05-20|6 candidate rows have no party/label. Examples: B. McManus in North-West Ward; P. O'Connor in North-West Ward; P. Toner in North-West Ward; P. Duggan in South-West Ward; G. Mackie in South-West Ward.|
|warning|source-record-single-reference|belfast-county-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|lurgan-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|lurgan-borough-council__1964-05-20|No candidates found for Lurgan (councillors).|
|warning|source-record-single-reference|portadown-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|portadown-borough-council__1964-05-20|No candidates found for Portadown (aldermen).|
|warning|candidate-list-missing|portadown-borough-council__1964-05-20|No candidates found for Portadown (councillors).|
|warning|source-record-single-reference|strabane-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1964-05-20|3 candidate rows have no party/label. Examples: H G Porter in North Ward; Cecil H Russell in North Ward; William Kidd in North Ward.|
|warning|source-record-single-reference|tandragee-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|armagh-county-council__1961-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-county-council__1961-06-01|20 candidate rows have no party/label. Examples: Joseph Gray in Armagh; Henry Whiteside in Bessbrook; Malachy Trainor in Crossmaglen; Edward Richardson in Crossmaglen; Robert Murphy in Crossmore.|
|warning|source-record-single-reference|armagh-rural-district-council__1961-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-rural-district-council__1961-06-01|4 candidate rows have no party/label. Examples: Thomas Steel in Ballyards; William Foster in Crossmore; Robert C. Hyde in Milford; Samuel J. Elliott in Tullyroan.|
|warning|source-record-single-reference|lurgan-rural-district-council__1961-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|lurgan-rural-district-council__1961-06-01|10 candidate rows have no party/label. Examples: William Stewart in Breagh; Patrick James Crilly in Brownlowsderry; John William Jones in Carrowbrack; James McKavanagh in Cornakinnegar; Thomas J. Robinson in Drumcree.|
|warning|source-record-single-reference|newry-no-2-rural-district-council__1961-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-2-rural-district-council__1961-06-01|40 candidate rows have no party/label. Examples: M. J. Poucher in Ballybot; J. Lavelle in Ballymoyer; Bernard J. McVerry in Belleek; Thomas P. Reynolds in Belleek; James Andrews in Bessbrook North.|
|warning|source-record-single-reference|tandragee-rural-district-council__1961-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|tandragee-rural-district-council__1961-06-01|5 candidate rows have no party/label. Examples: Andrew Isaac Crothers in Ballyshiel; Robert Woolsey in Laurelvale; Norman Alexander Beattie in Mullabrack; John McIntyre in Mullahead; Robert John McClelland in Tandragee Rural.|
|warning|source-record-single-reference|armagh-urban-district-council__1961-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|keady-urban-district-council__1961-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|keady-urban-district-council__1961-05-17|12 candidate rows have no party/label. Examples: John Greene in Keady; Vincent Mone in Keady; Bernard Arthurs in Keady; James M'Parland in Keady; Eugene Connolly in Keady.|
|warning|source-record-single-reference|lurgan-borough-council__1961-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|lurgan-borough-council__1961-05-17|No candidates found for Lurgan (aldermen).|
|warning|candidate-list-missing|lurgan-borough-council__1961-05-17|No candidates found for Lurgan (councillors).|
|warning|source-record-single-reference|portadown-borough-council__1961-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|portadown-borough-council__1961-05-17|No candidates found for Portadown (councillors).|
|warning|source-record-single-reference|tandragee-urban-district-council__1961-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1961|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|belfast-county-borough-council__1961|6 candidate rows have no party/label. Examples: Joseph Foster Cairns in Clifton; Frederick Robert Armstrong Hynds in Clifton; Francis Willis Watson in Clifton; John Samuel Roiston Harcourt in St. Anne's; Margaret Laird in St. Anne's.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1961|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|belfast-county-borough-council-aldermen__1961|1 candidate rows have no party/label. Examples: William Geddis in Duncairn.|
|warning|source-record-single-reference|strabane-urban-district-council__1961|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-urban-district-council__1961|18 candidate rows have no party/label. Examples: James Maguire in East Ward; George Quinn in East Ward; Teague Boyle in East Ward; Thomas A Forbes in East Ward; Gerald Doran in East Ward.|
|warning|source-record-single-reference|armagh-county-council__1958-06-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|armagh-rural-district-council__1958-06-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-rural-district-council__1958-06-05|1 candidate rows have no party/label. Examples: J. J. Allen in Ballymartrim.|
|warning|source-record-single-reference|lurgan-rural-district-council__1958-06-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|lurgan-rural-district-council__1958-06-05|10 candidate rows have no party/label. Examples: William Stewart in Breagh; Patrick James Crilly in Brownlowsderry; John William Jones in Carrowbrack; James McKavanagh in Cornakinnegar; Thomas J. Robinson in Drumcree.|
|warning|source-record-single-reference|newry-no-2-rural-district-council__1958-06-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-2-rural-district-council__1958-06-05|1 candidate rows have no party/label. Examples: S. McCann in Moyra Castle.|
|warning|source-record-single-reference|tandragee-rural-district-council__1958-06-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|tandragee-rural-district-council__1958-06-05|5 candidate rows have no party/label. Examples: Andrew Isaac Crothers in Ballyshiel; John McClelland in Laurelvale; Norman A. Beattie in Mullabrack; John McIntyre in Mullahead; Robert John McClelland in Tandragee Rural.|
|warning|source-record-single-reference|armagh-urban-district-council__1958-05-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|keady-urban-district-council__1958-05-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|lurgan-borough-council__1958-05-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-list-missing|lurgan-borough-council__1958-05-21|No candidates found for Lurgan (councillors).|
|warning|source-record-single-reference|portadown-borough-council__1958-05-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|

_412 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|270|
|source records with multiple references|1100|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|2247|
|Browse sub-entries with multiple references|11185|

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
