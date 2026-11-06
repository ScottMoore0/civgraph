# Test2 Election Data Audit

Generated: 2026-11-06T02:48:57.213Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|1885|
|manifest loadable elections|594|
|manifest placeholders|569|
|Browse parent election entries|1885|
|Browse constituency/DEA sub-entries|13474|
|Browse overall sub-entries|1885|
|source detail records|1885|
|result bundles loaded|1885|
|result rows audited|13474|
|candidate rows audited|68425|
|rows with count detail|13454|
|rows with animation payload|13454|
|rows expected to have transfer/count data|4129|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|1352|

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
|warning|source-record-single-reference|ballycastle-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|ballyclare-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|ballyclare-urban-district-council__1967-05-17|12 candidate rows have no party/label. Examples: William J. Workman in Ballyclare; Sidney Cameron in Ballyclare; James Craig in Ballyclare; Alan Moore in Ballyclare; Robert Fleming in Ballyclare.|
|warning|source-record-single-reference|ballymena-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|banbridge-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|bangor-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|carrickfergus-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|coleraine-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|coleraine-borough-council__1967-05-17|15 candidate rows have no party/label. Examples: J. White in Coleraine; A. Kydd in Coleraine; R. Fulton in Coleraine; I. Wilson in Coleraine; J. Christie in Coleraine.|
|warning|source-record-single-reference|cookstown-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|cookstown-urban-district-council__1967-05-17|12 candidate rows have no party/label. Examples: Mrs. Alice M. Leeper in Cookstown; Norman Armstrong in Cookstown; Robert J. Donaghy in Cookstown; George Ferguson in Cookstown; William Graham in Cookstown.|
|warning|source-record-single-reference|donaghadee-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|donaghadee-urban-district-council__1967-05-17|8 candidate rows have no party/label. Examples: Dr. Elizabeth Long in North Ward; H. S. Cosbey in North Ward; F. E. V. Press in North Ward; Mrs. G. M. Stone in South Ward; T. J. Carmichael in South Ward.|
|warning|source-record-single-reference|downpatrick-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|dromore-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|dromore-urban-district-council__1967-05-17|10 candidate rows have no party/label. Examples: Mrs. Irene Ferguson in Dromore; William Wilkinson in Dromore; John M'Grehan in Dromore; T. Castles in Dromore; Douglas Gamble in Dromore.|
|warning|source-record-single-reference|dungannon-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|holywood-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|holywood-urban-district-council__1967-05-17|11 candidate rows have no party/label. Examples: A. M. Weaire in Holywood; Mrs. M. A. Smyth in Holywood; H. M'Court in Holywood; F. C. M'Keag in Holywood; Lieut.-Col. D. C. M'Cormack in Holywood.|
|warning|source-record-single-reference|keady-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|keady-urban-district-council__1967-05-17|9 candidate rows have no party/label. Examples: Malachy Gorman in Keady; Brian Hughes in Keady; Bernard Arthurs in Keady; Eugene Connolly in Keady; Patrick J. McParland in Keady.|
|warning|source-record-single-reference|larne-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|limavady-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|lisburn-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|lisburn-borough-council__1967-05-17|19 candidate rows have no party/label. Examples: Samuel George Weir in Central Ward; Robert John Allen in Central Ward; David Shanks in Central Ward; Norman Bicker in Central Ward; Adrain Whitby in Central Ward.|
|warning|source-record-single-reference|londonderry-county-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|lurgan-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|newcastle-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newcastle-urban-district-council__1967-05-17|8 candidate rows have no party/label. Examples: J. A. Keenan in Newcastle; A. T. Cairns in Newcastle; F. Dornan in Newcastle; Mrs. L. D. Purdy in Newcastle; Mrs. C. B. Creighton in Newcastle.|
|warning|source-record-single-reference|newry-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-urban-district-council__1967-05-17|35 candidate rows have no party/label. Examples: J. M'Parland in North Ward; P. Hand in North Ward; C. Hughes in North Ward; W. Hughes in North Ward; J. Pearse in North Ward.|
|warning|source-record-single-reference|newtownabbey-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|omagh-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|portadown-borough-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|portrush-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|portrush-urban-district-council__1967-05-17|25 candidate rows have no party/label. Examples: R. G. Macauley in Portrush; W. R. Knox in Portrush; R. Stewart in Portrush; D. D. Fleck in Portrush; M. E. Hamilton in Portrush.|
|warning|source-record-single-reference|tandragee-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|warrenpoint-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|whitehead-urban-district-council__1967-05-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|whitehead-urban-district-council__1967-05-17|8 candidate rows have no party/label. Examples: J. H. Johnston in Whitehead; R. Lorimer in Whitehead; W. McFarlane in Whitehead; W. J. Williamson in Whitehead; J. N. M. Gilford-Hack in Whitehead.|
|warning|source-record-single-reference|strabane-urban-district-council__1967|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|armagh-county-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-county-council__1964-06-04|18 candidate rows have no party/label. Examples: C. R. Morrow in Bessbrook; L. W. Abraham in Breagh; Patrick Short in Crossmaglen; R. R. Murphy in Crossmore; F. H. Hayes in Drumcree.|
|warning|source-record-single-reference|armagh-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|armagh-rural-district-council__1964-06-04|30 candidate rows have no party/label. Examples: Thomas S. Hoey in Aghory; David Oscar Redman in Annaghmore; William James Shilliday in Armaghbrague; Thomas Steele in Ballyards; J. J. Allen in Ballymartrim.|
|warning|source-record-single-reference|lurgan-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|lurgan-rural-district-council__1964-06-04|10 candidate rows have no party/label. Examples: William Stewart in Breagh; Patrick James Crilly in Brownlowsderry; Robert Jones in Carrowbrack; Thomas John McKavanagh in Cornakinnegar; Thomas J. Robinson in Drumcree.|
|warning|source-record-single-reference|newry-no-2-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|newry-no-2-rural-district-council__1964-06-04|43 candidate rows have no party/label. Examples: Patrick Luckie in Ballymoyer; Patrick E. McKeown in Ballymoyer; Robert McGuinness in Belleek; James Andrews in Bessbrook North; Gerard Feighan in Bessbrook South.|
|warning|source-record-single-reference|tandragee-rural-district-council__1964-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|tandragee-rural-district-council__1964-06-04|5 candidate rows have no party/label. Examples: Andrew Isaac Crothers in Ballyshiel; Robert Woolsey in Laurelvale; Norman Alexander Beattie in Mullabrack; John McIntyre in Mullahead; Robert John McClelland in Tandragee Rural.|
|warning|source-record-single-reference|armagh-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|ballycastle-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|ballyclare-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|ballyclare-urban-district-council__1964-05-20|10 candidate rows have no party/label. Examples: W. J. Workman in Ballyclare; James Craig in Ballyclare; Robert Fleming in Ballyclare; R. W. Todd in Ballyclare; Sidney Cameron in Ballyclare.|
|warning|source-record-single-reference|ballymena-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|ballymena-borough-council__1964-05-20|5 candidate rows have no party/label. Examples: Robert Luke in Harryville Ward; George Sloane in Harryville Ward; Robert M'Cosh in Harryville Ward; W. Alexander in Harryville Ward; T. H. Dowzer in Town Hall Ward.|
|warning|source-record-single-reference|banbridge-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|banbridge-urban-district-council__1964-05-20|11 candidate rows have no party/label. Examples: Benjamin Adair in East Ward; Charles Creighton, J.P. in West Ward; John Dobson, M.A. in West Ward; W. E. Holton, O.B.E. in West Ward; Norman B. Coburn in West Ward.|
|warning|source-record-single-reference|bangor-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|belfast-county-borough-council-aldermen__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|carrickfergus-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|coleraine-borough-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|coleraine-borough-council__1964-05-20|13 candidate rows have no party/label. Examples: S. J. Henry in Aldermen; S. J. Walker in Aldermen; Jack Doherty in Aldermen; Cyril Lee in Aldermen; Mrs. J. L. Stanleigh in Coleraine.|
|warning|source-record-single-reference|cookstown-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|cookstown-urban-district-council__1964-05-20|11 candidate rows have no party/label. Examples: W. Graham in Cookstown; Mrs. A. M. Leeper in Cookstown; A. McConnell in Cookstown; G. Ferguson in Cookstown; N. Watson in Cookstown.|
|warning|source-record-single-reference|downpatrick-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|dungannon-urban-district-council__1964-05-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|dungannon-urban-district-council__1964-05-20|7 candidate rows have no party/label. Examples: J. Patton in Central Ward; H. Ferguson in Central Ward; M. Johnston in Central Ward; R. N. Holmes in Central Ward; J. Dugal in Central Ward.|

_1272 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|781|
|source records with multiple references|1104|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|4132|
|Browse sub-entries with multiple references|11227|

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
