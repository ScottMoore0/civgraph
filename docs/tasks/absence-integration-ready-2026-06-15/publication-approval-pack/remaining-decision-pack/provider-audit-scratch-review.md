# Provider Audit Scratch Review

Status: scratch-present

## Recommendation

- Immediate: Do not commit the JSON inventories. Add an ignore rule or move them to a local scratch directory if they keep cluttering git status.
- Preservation: Keep the audit script locally for now; commit it only after replacing hard-coded local roots with configurable provider root arguments.
- Deletion: Do not delete the scratch until you confirm the audit has been superseded or archived locally.

## Script

- Path: `scripts/audit-provider-mirrors.mjs`
- Exists: true
- Hard-coded local drive roots: true
- Recommendation: generalize then commit, or keep ignored until generalized
- Rationale: The script is useful and repeatable, but currently has local drive roots as defaults. Best next step is parameterize roots via environment/options before committing it.

## Generated Scratch Files

- `data/provider-mirror-audit/cso_historical-file-inventory.json` (444929 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
- `data/provider-mirror-audit/cso_pxstat-file-inventory.json` (4059603 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
- `data/provider-mirror-audit/datagovie-file-inventory.json` (9112466 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
- `data/provider-mirror-audit/nisra-file-inventory.json` (312396 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
- `data/provider-mirror-audit/opendatani-file-inventory.json` (1534892 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
- `data/provider-mirror-audit/provider-mirror-audit.json` (734820 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
- `data/provider-mirror-audit/provider-mirror-audit.md` (10953 bytes): commit sanitized summary only if needed. The markdown summary is useful, but should be regenerated from a parameterized script and checked for local paths before committing.
- `data/provider-mirror-audit/tailte-file-inventory.json` (9112466 bytes): ignore or move to local scratch. JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.
