# Handoff Scripts

These scripts are handoff-local helpers for the first automated, non-browser verification layer.

They are intentionally kept inside the handoff package so a later agent can:

- run them immediately
- refine them without affecting production tooling
- promote them into the repo-level `scripts/` directory later if they prove useful

## Included scripts

- `report-bundle-sizes.mjs`
- `report-startup-imports.mjs`
- `report-first-load-assets.mjs`
- `report-font-usage.mjs`
- `report-map-performance-metadata.mjs`
- `report-dependency-usage.mjs`

## Usage

Run from the repo root:

```powershell
node docs/performance-improvement-handoff/scripts/report-bundle-sizes.mjs
node docs/performance-improvement-handoff/scripts/report-startup-imports.mjs
node docs/performance-improvement-handoff/scripts/report-first-load-assets.mjs
node docs/performance-improvement-handoff/scripts/report-font-usage.mjs
node docs/performance-improvement-handoff/scripts/report-map-performance-metadata.mjs
node docs/performance-improvement-handoff/scripts/report-dependency-usage.mjs
```

## Notes

- These scripts are read-only reporters.
- They do not depend on browser automation.
- They default to human-readable text output.
- A later agent can add JSON output modes if needed.

