# R2 uploads for the NI dispensary districts and the Towns Improvement Act towns (9 map editions)

> **Status: point-in-time, generated 2026-11-06.** Batch status: committed.

Batch `batch-2026-11-05`, 2026-11-05. Generated from `batch.json` on 2026-11-06 by `node scripts/intake/intake.mjs report`; edit the manifest, not this file.

The upload and post-upload half of the dispensary-district and Towns Improvement Act town editions staged by ni-plu-dispensary-towns-2026-11-02 and committed in 2fc8ce45e1. Describes what the hand-written upload.ps1, UPLOAD.txt and post-upload.txt of D:\civgraph-intake\batch-2026-11-05 did.

Nothing in this batch is pushed, uploaded or published without the owner's approval in chat. Commit locally, then stop and ask.

## Sources

- **ni-plu-dispensary-towns**: Intake batch ni-plu-dispensary-towns-2026-11-02 (sources and method in its README.md). docs/intake-examples/ni-plu-dispensary-towns-2026-11-02/batch.json lists the primary sources.

## 1. Repository changes (`intake stage`)

Dry run first (`node scripts/intake/intake.mjs stage <batch>`), then `--write`. Idempotent: a second run reports no changes.

This batch has no repository operations.


## 2. R2 uploads (`intake upload`)

Run `node scripts/intake/intake.mjs upload <batch> --dry-run` first. Credentials come from `.env.local` through `node --env-file=.env.local`; listings are limited to each sub-prefix, never the whole `data/maps/`.

| R2 key | size |
|---|---|
| `data/maps/health/Dispensary_Districts_NI_1921-04-01.fgb` | 26.2 MB |
| `data/maps/health/Dispensary_Districts_NI_1924-04-01.fgb` | 26.2 MB |
| `data/maps/health/Dispensary_Districts_NI_1929-01-01.fgb` | 26.2 MB |
| `data/maps/local-government/Towns_Improvement_Act_Towns_NI_1921-05-03.fgb` | 23 KB |
| `data/maps/local-government/Towns_Improvement_Act_Towns_NI_1925-04-01.fgb` | 34 KB |
| `data/maps/local-government/Towns_Improvement_Act_Towns_NI_1927-04-01.fgb` | 14 KB |
| `data/maps/local-government/Towns_Improvement_Act_Towns_NI_1934-08-01.fgb` | 49 KB |
| `data/maps/local-government/Towns_Improvement_Act_Towns_NI_1937-04-01.fgb` | 14 KB |
| `data/maps/local-government/Towns_Improvement_Act_Towns_NI_1959-05-29.fgb` | 7 KB |
| `data/maps/health/Dispensary_Districts_NI_DED_Lookup.csv` | 85 KB |

| PMTiles key | size |
|---|---|
| `data/maps/test/pmtiles/generated/dispensary-districts-ni-1921-04-01-vector-test.pmtiles` | 3.4 MB |
| `data/maps/test/pmtiles/generated/dispensary-districts-ni-1924-04-01-vector-test.pmtiles` | 3.4 MB |
| `data/maps/test/pmtiles/generated/dispensary-districts-ni-1929-01-01-vector-test.pmtiles` | 3.4 MB |
| `data/maps/test/pmtiles/generated/tia-towns-ni-1921-05-03-vector-test.pmtiles` | 24 KB |
| `data/maps/test/pmtiles/generated/tia-towns-ni-1925-04-01-vector-test.pmtiles` | 26 KB |
| `data/maps/test/pmtiles/generated/tia-towns-ni-1927-04-01-vector-test.pmtiles` | 19 KB |
| `data/maps/test/pmtiles/generated/tia-towns-ni-1934-08-01-vector-test.pmtiles` | 30 KB |
| `data/maps/test/pmtiles/generated/tia-towns-ni-1937-04-01-vector-test.pmtiles` | 19 KB |
| `data/maps/test/pmtiles/generated/tia-towns-ni-1959-05-29-vector-test.pmtiles` | 7 KB |

- Cache-Control on `data/maps/health/` (fgb,gz,br)
- Cache-Control on `data/maps/local-government/` (fgb,gz,br)
- Cache-Control on `data/maps/health/` (csv)

Commands, in order:

```
node --env-file=.env.local scripts/publish/r2-upload-files.mjs data/maps/health/Dispensary_Districts_NI_1921-04-01.fgb=data/maps/health/Dispensary_Districts_NI_1921-04-01.fgb data/maps/health/Dispensary_Districts_NI_1924-04-01.fgb=data/maps/health/Dispensary_Districts_NI_1924-04-01.fgb data/maps/health/Dispensary_Districts_NI_1929-01-01.fgb=data/maps/health/Dispensary_Districts_NI_1929-01-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1921-05-03.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1921-05-03.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1925-04-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1925-04-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1927-04-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1927-04-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1934-08-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1934-08-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1937-04-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1937-04-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1959-05-29.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1959-05-29.fgb
node --env-file=.env.local scripts/publish/r2-upload-manifest.mjs --manifest <tmp>/upload-manifest-lookup-csv.json --prefix data/maps/health/ --force
node --env-file=.env.local scripts/publish/r2-upload-manifest.mjs --manifest <tmp>/upload-manifest-lookup-csv.json --prefix data/maps/health/ --verify-only
node --env-file=.env.local scripts/publish/r2-cache-control.mjs --prefix data/maps/health/ --apply
node --env-file=.env.local scripts/publish/r2-cache-control.mjs --prefix data/maps/local-government/ --apply
node --env-file=.env.local scripts/publish/r2-cache-control.mjs --prefix data/maps/health/ --ext csv --apply
node scripts/publish/r2-manifest.mjs
node --env-file=.env.local scripts/publish/r2-upload-pmtiles.mjs --ids dispensary-districts-ni-1921-04-01-vector-test,dispensary-districts-ni-1924-04-01-vector-test,dispensary-districts-ni-1929-01-01-vector-test,tia-towns-ni-1921-05-03-vector-test,tia-towns-ni-1925-04-01-vector-test,tia-towns-ni-1927-04-01-vector-test,tia-towns-ni-1934-08-01-vector-test,tia-towns-ni-1937-04-01-vector-test,tia-towns-ni-1959-05-29-vector-test
node --env-file=.env.local scripts/publish/verify-pmtiles-cdn.mjs --ids dispensary-districts-ni-1921-04-01-vector-test,dispensary-districts-ni-1924-04-01-vector-test,dispensary-districts-ni-1929-01-01-vector-test,tia-towns-ni-1921-05-03-vector-test,tia-towns-ni-1925-04-01-vector-test,tia-towns-ni-1927-04-01-vector-test,tia-towns-ni-1934-08-01-vector-test,tia-towns-ni-1937-04-01-vector-test,tia-towns-ni-1959-05-29-vector-test
node --env-file=.env.local scripts/stamp-map-cache-tokens.mjs --write
node --env-file=.env.local scripts/stamp-map-cache-tokens.mjs --check
```

## 3. After the upload (`intake post-upload`)

```
node scripts/publish/switch-pmtiles-to-cdn.mjs --ids dispensary-districts-ni-1921-04-01-vector-test,dispensary-districts-ni-1924-04-01-vector-test,dispensary-districts-ni-1929-01-01-vector-test,tia-towns-ni-1921-05-03-vector-test,tia-towns-ni-1925-04-01-vector-test,tia-towns-ni-1927-04-01-vector-test,tia-towns-ni-1934-08-01-vector-test,tia-towns-ni-1937-04-01-vector-test,tia-towns-ni-1959-05-29-vector-test
node scripts/publish/r2-manifest.mjs
npm run rebuild -- --plan
npm run build
python scripts/regen-thumbnails.py --download --ids dispensary-districts-ni-1921-04-01,dispensary-districts-ni-1924-04-01,dispensary-districts-ni-1929-01-01,tia-towns-ni-1921-05-03,tia-towns-ni-1925-04-01,tia-towns-ni-1927-04-01,tia-towns-ni-1934-08-01,tia-towns-ni-1937-04-01,tia-towns-ni-1959-05-29
node --env-file=.env.local scripts/publish/r2-upload-tree.mjs assets/thumbnails assets/thumbnails --concurrency=16 --changed-only
node scripts/validate-test-cdn-manifest.mjs
npm run check:fast
node --env-file=.env.local scripts/stamp-map-cache-tokens.mjs --check
```

- `switch-to-cdn`: Uses the cdn-range-report.json the upload's CDN check wrote; unverified layers are skipped. No alias layer points at any of the 9 (checked 2026-11-05). Do not run build-test-pmtiles.mjs --force for these layers afterwards: it resets tileUrl to the local path.
- `rebuild-plan`: Should list only the metadata changes from the switch and the ?v= tokens.
- `thumbnails`: Catalogue cards show broken images until these exist; regen --download reads the FGBs from R2.

## 4. Expected check results

### Before the upload

- `npm run check:fast`: expected to **fail**. 2 of 65 checks fail until the upload and switch are done; everything else passes (catalogue check, test:catalogue 49/49, the rebuild's browser subset 17/17, stamp-map-cache-tokens --check).
  - check:test (validate-test-cdn-manifest): for each of the 9 layers "missing tilePackage.byteRangeVerifiedAt" and "missing successful CDN range verification report row"; "CDN range report verified 873/882"
  - check:test2 (PMTiles/CDN validation): for each of the 9 layers "PMTiles tileUrl is not a promoted data.civgraph.net PMTiles URL"

### After the post-upload steps

- `node scripts/validate-test-cdn-manifest.mjs`: expected to **pass**
- `npm run check:fast`: expected to **pass**
- `node scripts/stamp-map-cache-tokens.mjs --check`: expected to **pass**

## Notes

- Commit what the post-upload steps change (render/metadata/maps-test.json, cdn-upload-manifest.json, cdn-range-report.json, the ?v= tokens in maps.json and the catalogue, the thumbnails manifest, rebuilt outputs), then ask the owner before bash .claude/publish/publish.sh.
- The batch folder also holds gazette-date-decisions.csv (the Belfast Gazette made/in-force date review, applied by hand and committed separately) and drafts/ for the publish verifier.

## Publishing

Only after the owner approves in chat: `bash .claude/publish/publish.sh`. The intake tool never runs it.
