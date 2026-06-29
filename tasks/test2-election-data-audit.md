# Test2 Election Data Audit

Generated: 2026-06-29T23:29:07.120Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|276|
|manifest loadable elections|257|
|manifest placeholders|19|
|Browse parent election entries|276|
|Browse constituency/DEA sub-entries|4686|
|Browse overall sub-entries|276|
|source detail records|276|
|result bundles loaded|276|
|result rows audited|4686|
|candidate rows audited|29867|
|rows with count detail|4663|
|rows with animation payload|4663|
|rows expected to have transfer/count data|2348|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|0|
|warnings|0|

## Blocking Structural Issues

_None._

## Warning Issues

_None._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|0|
|source records with no references|0|
|source records with one reference|0|
|source records with multiple references|276|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|0|
|Browse sub-entries with multiple references|4962|

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
