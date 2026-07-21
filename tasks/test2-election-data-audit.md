# Test2 Election Data Audit

Generated: 2026-07-21T13:33:35.781Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|281|
|manifest loadable elections|262|
|manifest placeholders|19|
|Browse parent election entries|281|
|Browse constituency/DEA sub-entries|4715|
|Browse overall sub-entries|281|
|source detail records|281|
|result bundles loaded|281|
|result rows audited|4706|
|candidate rows audited|29693|
|rows with count detail|4683|
|rows with animation payload|4683|
|rows expected to have transfer/count data|2339|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|34|

## Blocking Structural Issues

_None._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|browse-constituency-count|local-government-local-government-districts__2011-05-05|Browse has 102 constituency/DEA sub-entries; manifest expects 101.|
|warning|first-pref-sum|local-government-local-government-districts__2011-05-05|Castle first-preference sum 10024 exceeds valid poll ceiling 2462.|
|warning|browse-constituency-count|local-government-local-government-districts__2005-05-05|Browse has 101 constituency/DEA sub-entries; manifest expects 100.|
|warning|first-pref-sum|local-government-local-government-districts__2005-05-05|Castle first-preference sum 10914 exceeds valid poll ceiling 3009.|
|warning|elected-count|local-government-local-government-districts__2005-05-05|Castle has 6 elected candidate rows but seatsWon is 5.|
|warning|elected-count|local-government-local-government-districts__2005-05-05|Coleraine East has 6 elected candidate rows but seatsWon is 5.|
|warning|first-pref-sum|local-government-local-government-districts__2005-05-05|Cusher first-preference sum 8261 exceeds valid poll ceiling 8061.|
|warning|browse-constituency-count|local-government-local-government-districts__2001-06-07|Browse has 103 constituency/DEA sub-entries; manifest expects 100.|
|warning|first-pref-sum|local-government-local-government-districts__2001-06-07|Castle first-preference sum 14132 exceeds valid poll ceiling 3583.|
|warning|browse-constituency-count|local-government-local-government-districts__1997-05-21|Browse has 102 constituency/DEA sub-entries; manifest expects 101.|
|warning|first-pref-sum|local-government-local-government-districts__1997-05-21|Castle first-preference sum 11952 exceeds valid poll ceiling 2758.|
|warning|elected-count|local-government-local-government-districts__1997-05-21|Castle has 6 elected candidate rows but seatsWon is 5.|
|warning|browse-constituency-count|local-government-local-government-districts__1993-05-19|Browse has 102 constituency/DEA sub-entries; manifest expects 101.|
|warning|first-pref-sum|local-government-local-government-districts__1993-05-19|Castle first-preference sum 11985 exceeds valid poll ceiling 3052.|
|warning|elected-count|local-government-local-government-districts__1993-05-19|Castle has 6 elected candidate rows but seatsWon is 5.|
|warning|browse-constituency-count|local-government-local-government-districts__1989-05-17|Browse has 99 constituency/DEA sub-entries; manifest expects 98.|
|warning|elected-count|local-government-local-government-districts__1989-05-17|Castle has 6 elected candidate rows but seatsWon is 5.|
|warning|browse-constituency-count|local-government-local-government-districts__1985-05-15|Browse has 99 constituency/DEA sub-entries; manifest expects 98.|
|warning|first-pref-sum|local-government-local-government-districts__1985-05-15|Castle first-preference sum 13013 exceeds valid poll ceiling 3359.|
|warning|elected-count|local-government-local-government-districts__1985-05-15|Castle has 6 elected candidate rows but seatsWon is 5.|
|warning|elected-count|local-government-local-government-districts__1981-05-20|Armagh Area D has 6 elected candidate rows but seatsWon is 5.|
|warning|elected-count|local-government-local-government-districts__1981-05-20|Ballymoney Area C has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1981-05-20|Fermanagh Area D has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1981-05-20|Omagh Area D has 7 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1977-05-18|Armagh Area D has 6 elected candidate rows but seatsWon is 5.|
|warning|elected-count|local-government-local-government-districts__1977-05-18|Ballymoney Area C has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1977-05-18|Fermanagh Area D has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1977-05-18|Moyle Area C has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1977-05-18|Omagh Area D has 7 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1973-05-30|Armagh Area D has 6 elected candidate rows but seatsWon is 5.|
|warning|elected-count|local-government-local-government-districts__1973-05-30|Ballymoney Area C has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1973-05-30|Moyle Area C has 5 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1973-05-30|Omagh Area C corrected has 7 elected candidate rows but seatsWon is 4.|
|warning|elected-count|local-government-local-government-districts__1973-05-30|Omagh Area D has 7 elected candidate rows but seatsWon is 4.|

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|0|
|source records with multiple references|281|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|0|
|Browse sub-entries with multiple references|4996|

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
