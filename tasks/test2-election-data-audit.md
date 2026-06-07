# Test2 Election Data Audit

Generated: 2026-06-07T22:10:26.670Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|268|
|manifest loadable elections|249|
|manifest placeholders|19|
|Browse parent election entries|268|
|Browse constituency/DEA sub-entries|4684|
|Browse overall sub-entries|268|
|source detail records|268|
|result bundles loaded|268|
|result rows audited|4684|
|candidate rows audited|28309|
|rows with count detail|4500|
|rows with animation payload|4500|
|rows expected to have transfer/count data|1851|
|expected transfer/count rows missing detail|39|
|blocking issues|0|
|warnings|255|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|source-record-missing|local-government-local-government-districts__2023-05-18|No election source detail record found at data/browse/details/sources/election-source-local-government-2023-05-18.json.|
|warning|first-pref-sum|local-government-local-government-districts__2023-05-18|Ballyarnett first-preference sum 9740 exceeds valid poll -179.|
|warning|first-pref-sum|local-government-local-government-districts__2023-05-18|Magherafelt first-preference sum 8257 exceeds valid poll -49.|
|warning|source-record-single-reference|european-parliament__2019-05-23|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__2019-05-02|No election source detail record found at data/browse/details/sources/election-source-local-government-2019-05-02.json.|
|warning|source-record-missing|local-government-mid-and-east-antrim__2018-10-18|No election source detail record found at data/browse/details/sources/election-source-local-government-2018-10-18.json.|
|warning|candidate-list-missing|house-of-commons-of-the-united-kingdom__2018-08-29|No candidates found for North Antrim.|
|warning|source-record-single-reference|european-parliament__2014-05-22|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__2014-05-22|No election source detail record found at data/browse/details/sources/election-source-local-government-2014-05-22.json.|
|warning|source-record-missing|local-government-local-government-districts__2011-05-05|No election source detail record found at data/browse/details/sources/election-source-local-government-2011-05-05.json.|
|warning|first-pref-sum|local-government-local-government-districts__2011-05-05|Downshire first-preference sum 7919 exceeds valid poll 5367.|
|warning|candidate-party-missing|local-government-local-government-districts__2011-05-05|1002 candidate rows have no party/label. Examples: Blair John in Antrim Line; Bradley Paula in Antrim Line; McClelland Noreen in Antrim Line; MacKessy Marie in Antrim Line; Ball Audrey in Antrim Line.|
|warning|source-record-single-reference|european-parliament__2009-06-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__2005-05-05|No election source detail record found at data/browse/details/sources/election-source-local-government-2005-05-05.json.|
|warning|candidate-list-missing|local-government-local-government-districts__2005-05-05|No candidates found for Giant's Causeway.|
|warning|candidate-list-missing|local-government-local-government-districts__2005-05-05|No candidates found for lg05-NoD-Ballyholme-&-Groomsport.|
|warning|candidate-list-missing|local-government-local-government-districts__2005-05-05|No candidates found for Skerries.|
|warning|candidate-party-missing|local-government-local-government-districts__2005-05-05|881 candidate rows have no party/label. Examples: Nigel Hamilton in Antrim Line; Noreen Patricia McClelland in Antrim Line; Janet Crilly in Antrim Line; Tom Campbell in Antrim Line; Paula Jane Bradley in Antrim Line.|
|warning|source-record-single-reference|european-parliament__2004-06-10|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__2001-06-07|No election source detail record found at data/browse/details/sources/election-source-local-government-2001-06-07.json.|
|warning|candidate-list-missing|local-government-local-government-districts__2001-06-07|No candidates found for Giant's Causeway.|
|warning|candidate-list-missing|local-government-local-government-districts__2001-06-07|No candidates found for lg01-NoD-Ballyholme-&-Groomsport.|
|warning|candidate-party-missing|local-government-local-government-districts__2001-06-07|989 candidate rows have no party/label. Examples: Janet Crilly in Antrim Line; Nigel Peter Hamilton in Antrim Line; Thomas Patrick McTeague in Antrim Line; Noreen Patricia McClelland in Antrim Line; Briege Meehan in Antrim Line.|
|warning|source-record-single-reference|european-parliament__1999-06-10|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__1997-05-21|No election source detail record found at data/browse/details/sources/election-source-local-government-1997-05-21.json.|
|warning|first-pref-sum|local-government-local-government-districts__1997-05-21|Ballymena South first-preference sum 5506 exceeds valid poll 5.51.|
|warning|first-pref-sum|local-government-local-government-districts__1997-05-21|Bann Valley first-preference sum 3975 exceeds valid poll 80.|
|warning|first-pref-sum|local-government-local-government-districts__1997-05-21|Bannside first-preference sum 5920 exceeds valid poll 5.92.|
|warning|first-pref-sum|local-government-local-government-districts__1997-05-21|Braid first-preference sum 5324 exceeds valid poll 5.32.|
|warning|candidate-list-missing|local-government-local-government-districts__1997-05-21|No candidates found for Giant's Causeway.|
|warning|candidate-party-missing|local-government-local-government-districts__1997-05-21|969 candidate rows have no party/label. Examples: Tommy McTeague in Antrim Line; Edward Joshua Crilly in Antrim Line; Joseph Arthur Kell in Antrim Line; Elizabeth Snoddy in Antrim Line; Ivan Hunter in Antrim Line.|
|warning|source-record-single-reference|european-parliament__1994-06-09|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__1993-05-19|No election source detail record found at data/browse/details/sources/election-source-local-government-1993-05-19.json.|
|warning|first-pref-sum|local-government-local-government-districts__1993-05-19|Castlereagh West first-preference sum 4535 exceeds valid poll 4.54.|
|warning|candidate-list-missing|local-government-local-government-districts__1993-05-19|No candidates found for Giant's Causeway.|
|warning|candidate-list-missing|local-government-local-government-districts__1993-05-19|No candidates found for lg93-NoD-Ballyholme-&-Groomsport.|
|warning|first-pref-sum|local-government-local-government-districts__1993-05-19|Lower Falls first-preference sum 13003 exceeds valid poll 13.|
|warning|first-pref-sum|local-government-local-government-districts__1993-05-19|Lower Falls first-preference sum 13003 exceeds valid poll 13.|
|warning|first-pref-sum|local-government-local-government-districts__1993-05-19|Victoria first-preference sum 13527 exceeds valid poll 13.53.|
|warning|candidate-party-missing|local-government-local-government-districts__1993-05-19|920 candidate rows have no party/label. Examples: Thomas Patrick McTeague in Antrim Line; Arthur McGladdery Templeton in Antrim Line; Edward Joshua Crilly in Antrim Line; Billy Blair in Antrim Line; James Joseph Rooney in Antrim Line.|
|warning|source-record-single-reference|european-parliament__1989-06-15|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__1989-05-17|No election source detail record found at data/browse/details/sources/election-source-local-government-1989-05-17.json.|
|warning|first-pref-sum|local-government-local-government-districts__1989-05-17|Bushvale first-preference sum 2715 exceeds valid poll 2.71.|
|warning|candidate-list-missing|local-government-local-government-districts__1989-05-17|No candidates found for Giant's Causeway.|
|warning|first-pref-sum|local-government-local-government-districts__1989-05-17|Kells Water first-preference sum 4537 exceeds valid poll 4.54.|
|warning|first-pref-sum|local-government-local-government-districts__1989-05-17|Upper Falls first-preference sum 12409 exceeds valid poll 12.41.|
|warning|first-pref-sum|local-government-local-government-districts__1989-05-17|Upper Falls first-preference sum 12409 exceeds valid poll 12.41.|
|warning|candidate-party-missing|local-government-local-government-districts__1989-05-17|902 candidate rows have no party/label. Examples: James Joseph Rooney in Antrim Line; Thomas George Kirkham in Antrim Line; James Smith in Antrim Line; William Green in Antrim Line; Thomas Patrick McTeague in Antrim Line.|
|warning|source-record-missing|local-government-local-government-districts__1985-05-15|No election source detail record found at data/browse/details/sources/election-source-local-government-1985-05-15.json.|
|warning|first-pref-sum|local-government-local-government-districts__1985-05-15|Dungannon Town first-preference sum 6044 exceeds valid poll 6.04.|
|warning|first-pref-sum|local-government-local-government-districts__1985-05-15|Erne North first-preference sum 6349 exceeds valid poll 67.|
|warning|candidate-list-missing|local-government-local-government-districts__1985-05-15|No candidates found for Giant's Causeway.|
|warning|candidate-party-missing|local-government-local-government-districts__1985-05-15|1013 candidate rows have no party/label. Examples: James Graham in Antrim North West; Samuel Wilson Clyde in Antrim North West; Robert J. Loughran in Antrim North West; Henry John Cushinan in Antrim North West; Janes Gerard Laverty in Antrim North West.|
|warning|source-record-single-reference|european-parliament__1984-06-14|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__1981-05-20|No election source detail record found at data/browse/details/sources/election-source-local-government-1981-05-20.json.|
|warning|candidate-list-missing|local-government-local-government-districts__1981-05-20|No candidates found for Area-F.|
|warning|candidate-list-missing|local-government-local-government-districts__1981-05-20|No candidates found for Area-G.|
|warning|candidate-list-missing|local-government-local-government-districts__1981-05-20|No candidates found for Area-H-corrected.|
|warning|first-pref-sum|local-government-local-government-districts__1981-05-20|Armagh Area B first-preference sum 8620 exceeds valid poll 5620.|
|warning|first-pref-sum|local-government-local-government-districts__1981-05-20|Banbridge Area A first-preference sum 7876 exceeds valid poll 7576.|
|warning|first-pref-sum|local-government-local-government-districts__1981-05-20|Craigavon Area B first-preference sum 8118 exceeds valid poll 5115.|
|warning|first-pref-sum|local-government-local-government-districts__1981-05-20|Fermanagh Area B first-preference sum 5665 exceeds valid poll 109.|
|warning|candidate-party-missing|local-government-local-government-districts__1981-05-20|1020 candidate rows have no party/label. Examples: James Graham in Antrim Area A; Robert Loughren in Antrim Area A; John Heffron in Antrim Area A; Willson Clyde in Antrim Area A; Gerard Carolen in Antrim Area A.|
|warning|source-record-single-reference|european-parliament__1979-06-07|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-missing|local-government-local-government-districts__1977-05-18|No election source detail record found at data/browse/details/sources/election-source-local-government-1977-05-18.json.|
|warning|candidate-list-missing|local-government-local-government-districts__1977-05-18|No candidates found for Area-A-corrected.|
|warning|candidate-list-missing|local-government-local-government-districts__1977-05-18|No candidates found for Area-F.|
|warning|candidate-list-missing|local-government-local-government-districts__1977-05-18|No candidates found for Area-G.|
|warning|candidate-list-missing|local-government-local-government-districts__1977-05-18|No candidates found for Area-H.|
|warning|candidate-party-missing|local-government-local-government-districts__1977-05-18|981 candidate rows have no party/label. Examples: James Graham in Antrim Area A; John Heffron in Antrim Area A; Gerard Berry in Antrim Area A; Stewart J Dunlop in Antrim Area A; James Marrion in Antrim Area A.|
|warning|first-pref-sum|northern-ireland-constitutional-convention__1975-05-01|Armagh first-preference sum 59388 exceeds valid poll 28136.|
|warning|source-record-missing|local-government-local-government-districts__1973-05-30|No election source detail record found at data/browse/details/sources/election-source-local-government-1973-05-30.json.|
|warning|candidate-list-missing|local-government-local-government-districts__1973-05-30|No candidates found for Area-F.|
|warning|candidate-list-missing|local-government-local-government-districts__1973-05-30|No candidates found for Area-G.|
|warning|candidate-list-missing|local-government-local-government-districts__1973-05-30|No candidates found for Area-H.|
|warning|first-pref-sum|local-government-local-government-districts__1973-05-30|Armagh Area C first-preference sum 5439 exceeds valid poll 166.|
|warning|first-pref-sum|local-government-local-government-districts__1973-05-30|Belfast Area B first-preference sum 26403 exceeds valid poll 24814.|
|warning|first-pref-sum|local-government-local-government-districts__1973-05-30|Carrickfergus Area C first-preference sum 4156 exceeds valid poll 1456.|
|warning|first-pref-sum|local-government-local-government-districts__1973-05-30|Derry Area A first-preference sum 8262 exceeds valid poll 862.|
|warning|candidate-party-missing|local-government-local-government-districts__1973-05-30|1202 candidate rows have no party/label. Examples: Dunlop in Antrim Area A; O'Donnell in Antrim Area A; Minford in Antrim Area A; Heffron in Antrim Area A; Graham in Antrim Area A.|

_175 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|14|
|source records with no references|0|
|source records with one reference|9|
|source records with multiple references|245|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|18|
|Browse sub-entries with multiple references|4934|

## Party Colour Audit

|metric|value|
|---|---:|
|saved Wikipedia colour audit present|yes|
|high-confidence mismatch file present|yes|
|unique colour observations|1032|
|colour matches|73|
|colour mismatches|135|
|high-confidence mismatches|85|
|entries with no explicit election colour|777|
|entries with no Wikipedia match|684|
|ambiguous Wikipedia matches|31|

### High-Confidence Colour Examples

|party/label|election colour|Wikipedia match|Wikipedia colour|observations|
|---|---|---|---|---:|
||#C0C0C0|100% Redress|#F90606|1|
||#C0C0C0|Rabharta|#488A89|4|
||#E3170D|Anti-Austerity Alliance|#FFFF00|46|
||#C0C0C0|Sinn Féin (Anti-Treaty)|#326760|57|
||#C62828|Aontú|#44532A|126|
||#C0C0C0|Clann na Poblachta|#BBE549|111|
||#C0C0C0|Clann na Talmhan|#BDB76B|50|
||#FF6666|Commonwealth Labour Party|#B22222|6|
||#FF3300|Communist Party of Ireland|#E3170D|6|
||#E3170D|Communist Party of Ireland (Marxist–Leninist)|#660000|3|
||#0E7C42|Conservative and Unionist Party (UK)|#0087DC|61|
||#1F4E8C|Conservative and Unionist Party (UK)|#0087DC|11|
||#888888|Conservative and Unionist Party (UK)|#0087DC|13|
||#9E9E9E|Conservative and Unionist Party (UK)|#0087DC|254|
||#C0C0C0|Cumann na nGaedheal|#87CEFA|360|
||#000000|Democracy First|#FF8C00|2|
||#DC241F|Democratic Left (Ireland)|#C700C7|21|
||#FF9800|Democratic Partnership|#F0E68C|10|
||#FFFF00|Direct Democracy Ireland|#87CEFA|41|
||#C0C0C0|Éirígí|#00A550|6|

## Next Fix Queue

1. Resolve blocking issues first; these are structural and should fail CI when present.
2. Work through source/reference warnings by adding or normalising parent and sub-entry citations, preferring official/ARK/ElectionsIreland sources with Wikipedia as secondary corroboration.
3. Resolve high-confidence party-colour mismatches by updating the canonical party/label colour map or documenting an intentional Civgraph override.
4. For entries expected to have transfer/count data but missing it, decide whether the source lacks transfer stages or whether the generated bundle failed to carry available count data through to /test2.
5. Promote this audit into the normal /test2 check path so regenerated election data cannot silently change references, colours, or bundle shape.
