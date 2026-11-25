# Test2 Election Data Audit

Generated: 2026-11-25T15:14:08.757Z

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
|candidate rows audited|85294|
|rows with count detail|22495|
|rows with animation payload|22495|
|rows expected to have transfer/count data|4540|
|expected transfer/count rows missing detail|1|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|2551|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|browse-parent-count|data/browse/elections.json|Browse has 2737 parent elections, manifest has 2675.|
|warning|source-record-single-reference|seanad-eireann__2026-11-06|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2024-04-08|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2022-04-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2021-04-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2019-11-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2018-04-27|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2015-11-13|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2014-10-10|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2011-05-25|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2010-01-19|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2009-12-14|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2009-11-25|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2002-09-12|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-newtownabbey__2002-06-19|2 candidate rows have no party/label. Examples: John Blair in Macedon; William Ball in Macedon.|
|warning|source-record-single-reference|seanad-eireann__2001-12-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__2000-06-02|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1998-06-23|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-no-references|fianna-fail-presidential-nomination__1997-09-17|Election source detail record has no references.|
|warning|candidate-party-missing|fianna-fail-presidential-nomination__1997-09-17|2 candidate rows have no party/label. Examples: Mary McAleese in Fianna Fáil Parliamentary Party (first ballot); Mary McAleese in Fianna Fáil Parliamentary Party (second ballot).|
|warning|source-record-single-reference|seanad-eireann__1997-09-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1997-01-28|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1996-02-23|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-ards__1995-09-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-ards__1995-09-20|2 candidate rows have no party/label. Examples: Bobby McBride in Ards West; Terence Williams in Ards West.|
|warning|source-record-single-reference|uup-leadership__1995-09-08|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-coleraine__1995-09-06|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-belfast__1995-05-31|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-belfast__1995-05-31|1 candidate rows have no party/label. Examples: Niall Cusack in Balmoral.|
|warning|source-record-single-reference|local-government-north-down__1995-03-22|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-north-down__1995-03-22|1 candidate rows have no party/label. Examples: Robert Mooney in Bangor West.|
|warning|source-record-single-reference|uup-leadership__1995-03-18|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-newtownabbey__1995-02-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-ballymena__1994-12-01|2 candidate rows have no party/label. Examples: Agnes McLeister in Ballymena South; Samuel Balmer in Ballymena South.|
|warning|source-record-single-reference|local-government-lisburn__1993-11-24|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-lisburn__1993-11-24|1 candidate rows have no party/label. Examples: Jonathan Craig in Downshire.|
|warning|source-record-single-reference|local-government-derry__1993-10-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-derry__1993-10-21|1 candidate rows have no party/label. Examples: P. Muldowney in Cityside.|
|warning|source-record-single-reference|local-government-north-down__1993-10-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1993-02-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-ballymena__1992-05-27|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-dungannon__1992-04-02|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-magherafelt__1991-12-11|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-belfast__1991-08-28|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-moyle__1991-05-30|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-moyle__1991-05-30|1 candidate rows have no party/label. Examples: Annie Mary Dobbin in Ballycastle.|
|warning|source-record-single-reference|local-government-carrickfergus__1991-05-15|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-north-down__1991-04-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-north-down__1991-04-17|1 candidate rows have no party/label. Examples: Ivy Cooling in Ballyholme and Groomsport.|
|warning|source-record-single-reference|local-government-newtownabbey__1991-03-20|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-dungannon__1990-11-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-fermanagh__1990-05-09|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-fermanagh__1990-05-09|5 candidate rows have no party/label. Examples: Ethel Gregg in Enniskillen; Joseph Dodds in Enniskillen; Jim Lynch in Enniskillen; John McManus in Enniskillen; Cathy Kettyles in Enniskillen.|
|warning|source-record-single-reference|local-government-newry-and-mourne__1990-03-30|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-cookstown__1990-03-29|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-cookstown__1990-03-29|3 candidate rows have no party/label. Examples: William John McCormick in Ballinderry; Francis Rocks in Ballinderry; Patrick McAleer in Ballinderry.|
|warning|source-record-single-reference|local-government-castlereagh__1989-11-15|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1989-10-01|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1988-12-19|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-newtownabbey__1988-09-29|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-newtownabbey__1988-09-29|2 candidate rows have no party/label. Examples: Scott in Ballyclare; Christie in Ballyclare.|
|warning|source-record-single-reference|local-government-newry-and-mourne__1988-09-07|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-newtownabbey__1988-04-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-newtownabbey__1988-04-21|1 candidate rows have no party/label. Examples: Kirkham in Antrim Line.|
|warning|source-record-single-reference|local-government-ballymoney__1988-04-15|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-north-down__1988-02-04|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-north-down__1988-02-04|2 candidate rows have no party/label. Examples: Robert Lyle in Ballyholme and Groomsport; Enid Stringer in Ballyholme and Groomsport.|
|warning|source-record-single-reference|local-government-newtownabbey__1987-12-03|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-newtownabbey__1987-12-03|3 candidate rows have no party/label. Examples: William Ball in Shore Road; Patrick Joseph Sweeney in Shore Road; Patrick Lillis in Shore Road.|
|warning|source-record-single-reference|local-government-belfast__1987-10-22|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-newtownabbey__1987-09-17|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-newtownabbey__1987-09-17|8 candidate rows have no party/label. Examples: Billy Snoddy in Doagh Road; David Hollis in Doagh Road; David Lowrie in Doagh Road; John Blair in Doagh Road; Edward Ronnie Hales in Doagh Road.|
|warning|source-record-single-reference|local-government-antrim__1987-06-30|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|seanad-eireann__1987-04-25|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-castlereagh__1987-03-19|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|candidate-party-missing|local-government-castlereagh__1987-03-19|1 candidate rows have no party/label. Examples: Timothy William Morrow in Castlereagh East.|
|warning|source-record-single-reference|local-government-belfast__1987-01-08|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-strabane__1986-10-23|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-local-government-districts__1986-05-21|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|
|warning|source-record-single-reference|local-government-moyle__1986-05-14|Election source detail record has only one reference; multiple corroborating sources are preferred where available.|

_2471 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|1410|
|source records with one reference|130|
|source records with multiple references|1135|
|Browse sub-entries with no references|13103|
|Browse sub-entries with one reference|165|
|Browse sub-entries with multiple references|11923|

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
