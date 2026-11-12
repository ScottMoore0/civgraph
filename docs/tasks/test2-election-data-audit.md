# Test2 Election Data Audit

Generated: 2026-11-11T23:19:32.226Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|2507|
|manifest loadable elections|721|
|manifest placeholders|569|
|Browse parent election entries|2569|
|Browse constituency/DEA sub-entries|21282|
|Browse overall sub-entries|2507|
|source detail records|2569|
|result bundles loaded|2507|
|result rows audited|21282|
|candidate rows audited|77557|
|rows with count detail|21262|
|rows with animation payload|21262|
|rows expected to have transfer/count data|4135|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|2352|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|browse-parent-count|data/browse/elections.json|Browse has 2569 parent elections, manifest has 2507.|
|warning|source-record-single-reference|fianna-fail-presidential-nomination__1997-09-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|fianna-fail-presidential-nomination__1997-09-17|2 candidate rows have no party/label. Examples: Mary McAleese in Fianna Fáil Parliamentary Party (first ballot); Mary McAleese in Fianna Fáil Parliamentary Party (second ballot).|
|warning|source-record-single-reference|uup-leadership__1995-09-08|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|uup-leadership__1995-03-18|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
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
|warning|candidate-party-missing|coleraine-rural-district-council__1967-06-01|4 candidate rows have no party/label. Examples: David Lennox in Kilrea; J. H. Knipe in Kilrea; C. R. Lee in Slaughtneil; W. W. Houston in Slaughtneil.|
|warning|source-record-single-reference|cookstown-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|cookstown-rural-district-council__1967-06-01|15 candidate rows have no party/label. Examples: William McIntyre in Ballyclog; Peter Conway in Beaghmore; James P. Duff in Coagh; William J. McCulla in Grange; Bernard Conway in Killeenan.|
|warning|source-record-single-reference|down-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|down-county-council__1967-06-01|19 candidate rows have no party/label. Examples: Richard John Dougherty in Ardglass; Edward McVeigh in Ballynahinch; William Smyth in Banbridge; Frederick Charles Tughan in Bangor; Felix McKenna in Castlewellan.|
|warning|source-record-single-reference|dungannon-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|dungannon-rural-district-council__1967-06-01|19 candidate rows have no party/label. Examples: P. J. Donnelly in Altmore; W. R. Knox in Anahoe; A. M. Reid in Benburb; R. Kempton in Bernagh; C. J. Burrowes in Bush.|
|warning|source-record-single-reference|east-down-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|east-down-rural-district-council__1967-06-01|6 candidate rows have no party/label. Examples: Robert Magee in Ardglass; George Joseph Connor in Ardglass; James Gerard Fitzpatrick in Castlewellan Urban; Felix McKenna in Castlewellan Urban; James Cleland in Downpatrick.|
|warning|source-record-single-reference|fermanagh-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|fermanagh-county-council__1967-06-01|41 candidate rows have no party/label. Examples: David Brien in Ballinamallard; Warren Loane in Ballinamallard; John Brooke in Brookeborough; Francis Ebbitt in Brookeborough; Albert J. Anderson in Clonelly.|
|warning|source-record-single-reference|hillsborough-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|hillsborough-rural-district-council__1967-06-01|15 candidate rows have no party/label. Examples: James Campbell in Annahilt; Nelson Magowan in Ballykeel; John Johnston in Ballymacbrennan; John W. Henderson in Ballyskeagh; Samuel J. Bell in Ballyworfy.|
|warning|source-record-single-reference|larne-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|larne-rural-district-council__1967-06-01|18 candidate rows have no party/label. Examples: Francis Joseph O'Neill in Ardclinis; Thomas Snoddy in Ballycorr; James Park in Ballynure; Robert John Moore in Cairncastle; Edward Albert Reid in Carrickfergus Rural.|
|warning|source-record-single-reference|limavady-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|lisburn-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|lisburn-rural-district-council__1967-06-01|11 candidate rows have no party/label. Examples: Thomas C. Wilson in Aghalee; Joseph Smyth in Andersonstown; William R. Yarr in Ballinderry; William R. Totten in Ballyscolly; John Maze in Islandkelly.|
|warning|source-record-single-reference|londonderry-county-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|londonderry-county-council__1967-06-01|18 candidate rows have no party/label. Examples: George Haslett in Bellarena; Thomas James Bradley in Castledawson; Hugh Alphonsus McGurk in Clady; Robert Cunningham Bond in Claudy; Daniel Jackson Christie in Coleraine.|
|warning|source-record-single-reference|londonderry-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|londonderry-rural-district-council__1967-06-01|12 candidate rows have no party/label. Examples: Thomas Montgomery Craig in Ardmore; Francis Joseph O'Kane in Ballymullins; John Conway in Banagher; Robert Cunningham Bond in Bond's Glen; William John Eakin in Claudy.|
|warning|source-record-single-reference|magherafelt-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|magherafelt-rural-district-council__1967-06-01|25 candidate rows have no party/label. Examples: Hugh M'Clelland in Aughagaskin; Patrick John Scullion in Ballynease; Wm. Lees in Ballyronan; John Mallon in Bancran; William J. Overend in Bellaghy.|
|warning|source-record-single-reference|moira-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|moira-rural-district-council__1967-06-01|6 candidate rows have no party/label. Examples: J. Wilson in Bleary; T. H. Creith in Clare; James Baird in Donacloney; T. Megarrell in Marlin; G. McCartney in Moira.|
|warning|source-record-single-reference|newry-no-1-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-1-rural-district-council__1967-06-01|18 candidate rows have no party/label. Examples: Thomas A. Shilliday in Ballycoshone; John McAteer in Ballyholland; Thomas David Maginnis in Ballyholland; Hugh Patrick Sands in Carrickcrossan; Thomas Edward Treanor in Clonallon.|
|warning|source-record-single-reference|newry-no-2-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-2-rural-district-council__1967-06-01|43 candidate rows have no party/label. Examples: Donald J. Mulligan in Ballybot; Gerald Mulholland in Ballybot; Harold Kinney in Ballybot; Patrick J. Luckie in Ballymoyer; Oliver B. Murphy in Belleek.|
|warning|source-record-single-reference|north-down-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|omagh-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|omagh-rural-district-council__1967-06-01|39 candidate rows have no party/label. Examples: Mrs. Mary Ellen McGurn in Aughafad; Fred Giboney in Bencran; William Kirk in Beragh; Vincent O'Brien in Camderry; Michael Donaghy in Carrickmore.|
|warning|source-record-single-reference|south-down-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|strabane-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|strabane-rural-district-council__1967-06-01|26 candidate rows have no party/label. Examples: J. Stewart in Ardstraw; Patrick Devine in Balix; William Mehaffy in Ballyfatton; Robert P. Cummings in Ballymagorry; Thomas Moore in Baronscourt.|
|warning|source-record-single-reference|tandragee-rural-district-council__1967-06-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|tandragee-rural-district-council__1967-06-01|5 candidate rows have no party/label. Examples: Andrew Isaac Crothers in Ballyshiel; Robert Woolsey in Laurelvale; Norman Alexander Beattie in Mullabrack; John McIntyre in Mullahead; Robert John McClelland in Tandragee Rural.|

_2272 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|1387|
|source records with multiple references|1120|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|12525|
|Browse sub-entries with multiple references|11264|

## Party Colour Audit

|metric|value|
|---|---:|
|saved Wikipedia colour audit present|no|
|high-confidence mismatch file present|no|
|review override file present|yes|
|sampled mismatches already reviewed|0|
|unique colour observations|0|
|colour matches|0|
|colour mismatches|0|
|high-confidence mismatches|0|
|entries with no explicit election colour|0|
|entries with no Wikipedia match|0|
|ambiguous Wikipedia matches|0|

### High-Confidence Colour Examples

_None found from the saved audit._

## Next Fix Queue

1. Resolve blocking issues first; these are structural and should fail CI when present.
2. Work through source/reference warnings by adding or normalising parent and sub-entry citations, preferring official/ARK/ElectionsIreland sources with Wikipedia as secondary corroboration.
3. Resolve high-confidence party-colour mismatches by updating the canonical party/label colour map or documenting an intentional Civgraph override.
4. For entries expected to have transfer/count data but missing it, decide whether the source lacks transfer stages or whether the generated bundle failed to carry available count data through to /test2.
5. Promote this audit into the normal /test2 check path so regenerated election data cannot silently change references, colours, or bundle shape.
