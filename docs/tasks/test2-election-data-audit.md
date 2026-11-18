# Test2 Election Data Audit

Generated: 2026-11-18T22:09:49.407Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|2675|
|manifest loadable elections|767|
|manifest placeholders|658|
|Browse parent election entries|2737|
|Browse constituency/DEA sub-entries|22516|
|Browse overall sub-entries|2675|
|source detail records|2737|
|result bundles loaded|2675|
|result rows audited|22516|
|candidate rows audited|85292|
|rows with count detail|22495|
|rows with animation payload|22495|
|rows expected to have transfer/count data|4540|
|expected transfer/count rows missing detail|1|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|2424|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|browse-parent-count|data/browse/elections.json|Browse has 2737 parent elections, manifest has 2675.|
|warning|candidate-party-missing|local-government-newtownabbey__2002-06-19|2 candidate rows have no party/label. Examples: John Blair in Macedon; William Ball in Macedon.|
|warning|source-record-single-reference|fianna-fail-presidential-nomination__1997-09-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|fianna-fail-presidential-nomination__1997-09-17|2 candidate rows have no party/label. Examples: Mary McAleese in Fianna Fáil Parliamentary Party (first ballot); Mary McAleese in Fianna Fáil Parliamentary Party (second ballot).|
|warning|candidate-party-missing|local-government-ards__1995-09-20|2 candidate rows have no party/label. Examples: Bobby McBride in Ards West; Terence Williams in Ards West.|
|warning|source-record-single-reference|uup-leadership__1995-09-08|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-belfast__1995-05-31|1 candidate rows have no party/label. Examples: Niall Cusack in Balmoral.|
|warning|candidate-party-missing|local-government-north-down__1995-03-22|1 candidate rows have no party/label. Examples: Robert Mooney in Bangor West.|
|warning|source-record-single-reference|uup-leadership__1995-03-18|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-ballymena__1994-12-01|2 candidate rows have no party/label. Examples: Agnes McLeister in Ballymena South; Samuel Balmer in Ballymena South.|
|warning|candidate-party-missing|local-government-lisburn__1993-11-24|1 candidate rows have no party/label. Examples: Jonathan Craig in Downshire.|
|warning|candidate-party-missing|local-government-derry__1993-10-21|1 candidate rows have no party/label. Examples: P. Muldowney in Cityside.|
|warning|candidate-party-missing|local-government-moyle__1991-05-30|1 candidate rows have no party/label. Examples: Annie Mary Dobbin in Ballycastle.|
|warning|candidate-party-missing|local-government-north-down__1991-04-17|1 candidate rows have no party/label. Examples: Ivy Cooling in Ballyholme and Groomsport.|
|warning|candidate-party-missing|local-government-fermanagh__1990-05-09|5 candidate rows have no party/label. Examples: Ethel Gregg in Enniskillen; Joseph Dodds in Enniskillen; Jim Lynch in Enniskillen; John McManus in Enniskillen; Cathy Kettyles in Enniskillen.|
|warning|candidate-party-missing|local-government-cookstown__1990-03-29|3 candidate rows have no party/label. Examples: William John McCormick in Ballinderry; Francis Rocks in Ballinderry; Patrick McAleer in Ballinderry.|
|warning|candidate-party-missing|local-government-newtownabbey__1988-09-29|2 candidate rows have no party/label. Examples: Scott in Ballyclare; Christie in Ballyclare.|
|warning|candidate-party-missing|local-government-newtownabbey__1988-04-21|1 candidate rows have no party/label. Examples: Kirkham in Antrim Line.|
|warning|candidate-party-missing|local-government-north-down__1988-02-04|2 candidate rows have no party/label. Examples: Robert Lyle in Ballyholme and Groomsport; Enid Stringer in Ballyholme and Groomsport.|
|warning|candidate-party-missing|local-government-newtownabbey__1987-12-03|3 candidate rows have no party/label. Examples: William Ball in Shore Road; Patrick Joseph Sweeney in Shore Road; Patrick Lillis in Shore Road.|
|warning|candidate-party-missing|local-government-newtownabbey__1987-09-17|8 candidate rows have no party/label. Examples: Billy Snoddy in Doagh Road; David Hollis in Doagh Road; David Lowrie in Doagh Road; John Blair in Doagh Road; Edward Ronnie Hales in Doagh Road.|
|warning|candidate-party-missing|local-government-castlereagh__1987-03-19|1 candidate rows have no party/label. Examples: Timothy William Morrow in Castlereagh East.|
|warning|candidate-party-missing|local-government-moyle__1986-05-14|1 candidate rows have no party/label. Examples: McIlroy in Giant's Causeway.|
|warning|candidate-party-missing|local-government-newtownabbey__1986-05-01|1 candidate rows have no party/label. Examples: James Devlin in Antrim Line.|
|warning|candidate-party-missing|local-government-banbridge__1985-08-28|1 candidate rows have no party/label. Examples: McCullough in Knockiveagh.|
|warning|source-record-single-reference|fianna-fail-leadership__1979-12-07|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1972-05-10|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1972-03-23|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1972-03-08|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1972-02-02|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1972-01-25|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1972-01-24|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1971-12-23|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1971-09-24|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1971-04-07|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1970-10-07|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1970-02-05|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1970-02-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1970-01-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1969-05-07|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|uup-leadership__1969-05-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1969-02-12|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1968-10-16|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1968-02-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|antrim-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|antrim-county-council__1967-06-01|26 candidate rows have no party/label. Examples: William Robert Yarr in Aghalee; William Millar Cameron in Ahoghill; William Clark in Antrim; Alexander McConnell in Ballyclare; Allan Johnston in Ballymena.|
|warning|source-record-single-reference|antrim-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|antrim-rural-district-council__1967-06-01|2 candidate rows have no party/label. Examples: J. W. Craig in Antrim Urban; James Boyd in Craigarogan.|
|warning|source-record-single-reference|armagh-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-county-council__1967-06-01|1 candidate rows have no party/label. Examples: Frank Hayes in Killyman.|
|warning|source-record-single-reference|armagh-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-rural-district-council__1967-06-01|2 candidate rows have no party/label. Examples: Ernest William Charles Weir in Killyman; Kenneth Kelly in Richhill.|
|warning|source-record-single-reference|ballymena-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|ballymena-rural-district-council__1967-06-01|23 candidate rows have no party/label. Examples: Andrew Hugh Simpson in Ahoghill; William Hugh Simpson in Ballyclug; Robert Hamilton in Ballyconnolly; John McNeilly in Ballyscullion; William Houston in Broughshane.|
|warning|source-record-single-reference|ballymoney-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|ballymoney-rural-district-council__1967-06-01|4 candidate rows have no party/label. Examples: John P. Mulholland in Ballyhoe; John McCollam in Ballyhoe; Mrs. Mary Hunter in Seacon; D. Moore in Seacon.|
|warning|source-record-single-reference|banbridge-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|banbridge-rural-district-council__1967-06-01|19 candidate rows have no party/label. Examples: Robert A. Frazer in Annaclone; Eric Williamson in Ballooleymore; T. H. C. Murray in Ballybrick; J. S. Higginson in Ballyward; John Martin in Banbridge Rural.|
|warning|source-record-single-reference|castlederg-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|castlereagh-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|castlereagh-rural-district-council__1967-06-01|4 candidate rows have no party/label. Examples: F. J. R. Storey in Ballycultra; J. C. Marks in Ballyhackamore; Thomas Gray in Craigavad; Thomas H. Boyd in Holywood Rural.|
|warning|source-record-single-reference|clogher-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|coleraine-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|coleraine-rural-district-council__1967-06-01|4 candidate rows have no party/label. Examples: David Lennox in Kilrea; J. H. Knipe in Kilrea; C. R. Lee in Slaght; W. W. Houston in Slaght.|
|warning|source-record-single-reference|cookstown-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|cookstown-rural-district-council__1967-06-01|15 candidate rows have no party/label. Examples: William McIntyre in Ballyclog; Peter Conway in Beaghmore; James P. Duff in Coagh; William J. McCulla in Grange; Bernard Conway in Killeenan.|
|warning|source-record-single-reference|down-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|down-county-council__1967-06-01|19 candidate rows have no party/label. Examples: Richard John Dougherty in Ardglass; Edward McVeigh in Ballynahinch; William Smyth in Banbridge; Frederick Charles Tughan in Bangor; Felix McKenna in Castlewellan.|
|warning|source-record-single-reference|dungannon-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|dungannon-rural-district-council__1967-06-01|19 candidate rows have no party/label. Examples: W. R. Knox in Aghnahoe; P. J. Donnelly in Altmore; A. M. Reid in Benburb; R. Kempton in Bernagh; C. J. Burrowes in Bush.|
|warning|source-record-single-reference|east-down-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|east-down-rural-district-council__1967-06-01|6 candidate rows have no party/label. Examples: Robert Magee in Ardglass; George Joseph Connor in Ardglass; James Gerard Fitzpatrick in Castlewellan Urban; Felix McKenna in Castlewellan Urban; James Cleland in Downpatrick.|
|warning|source-record-single-reference|fermanagh-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|fermanagh-county-council__1967-06-01|41 candidate rows have no party/label. Examples: David Brien in Ballinamallard; Warren Loane in Ballinamallard; John Brooke in Brookeborough; Francis Ebbitt in Brookeborough; Albert J. Anderson in Clonelly.|
|warning|source-record-single-reference|hillsborough-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|hillsborough-rural-district-council__1967-06-01|15 candidate rows have no party/label. Examples: James Campbell in Annahilt; Nelson Magowan in Ballykeel; John Johnston in Ballymacbrennan; John W. Henderson in Ballyskeagh; Samuel J. Bell in Ballyworfy.|
|warning|source-record-single-reference|larne-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|larne-rural-district-council__1967-06-01|18 candidate rows have no party/label. Examples: Francis Joseph O'Neill in Ardclinis; Thomas Snoddy in Ballycorr; James Park in Ballynure; Robert John Moore in Cairncastle; Edward Albert Reid in Carrickfergus Rural.|
|warning|source-record-single-reference|limavady-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|limavady-rural-district-council__1967-06-01|1 candidate rows have no party/label. Examples: W. E. Conn in The Highlands.|

_2344 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|1416|
|source records with multiple references|1259|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|13153|
|Browse sub-entries with multiple references|12038|

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
