# NI Poor Law Unions, dispensary districts and Towns Improvement Act towns, 1921-1962

> **Status: point-in-time, generated 2026-11-06.** Batch status: committed.

Batch `ni-plu-dispensary-towns-2026-11-02`, 2026-11-02. Generated from `batch.json` on 2026-11-06 by `node scripts/intake/intake.mjs report`; edit the manifest, not this file.

Three dispensary-district editions (1 Apr 1921, 1 Apr 1924, 1 Jan 1929) built on the pre-1923 electoral divisions, six Towns Improvement Act town editions (1921-1959), and the Poor Law Unions' end refined to the abolition of the boards on 30 Sep 1948. Describes what the hand-written apply.py and UPLOAD.txt of D:\civgraph-intake\ni-plu-dispensary-towns-2026-11-02 did; applied in 2fc8ce45e1.

Nothing in this batch is pushed, uploaded or published without the owner's approval in chat. Commit locally, then stop and ask.

## Sources

- **census-1926**: Census of Population of Northern Ireland 1926: Topographical Index, county volumes (Table 4) and General Report; HMSO Belfast. Index 9 gives every townland's dispensary district; Table 4 the county-part areas checked against.
- **census-1911**: Census of Ireland 1911: county volumes, Table VI; HMSO. Dispensary-district order of the electoral divisions; used only as a cross-check.
- **census-1937**: Census of Population of Northern Ireland 1937: General Report and county volumes; HMSO Belfast
- **belfast-gazette**: The Belfast Gazette, issues 105, 155, 196, 229, 677, 809, 1979 and 2128; The Gazette; licence: OGL v3.0 <https://www.thegazette.co.uk/Belfast>. Issue 229 (13 Nov 1925): dispensary districts stay on the pre-1923 divisions.
- **sro-1948**: S.R. & O. (NI) 1948 Nos. 175, 187 and 281; legislation.gov.uk; licence: OGL v3.0 <https://www.legislation.gov.uk/nisro/1948/281/contents/made>. No. 281 abolished every board of guardians on 30 Sep 1948.
- **osni-townlands**: OSNI Largescale Townlands; Land & Property Services (OSNI); licence: OGL v3.0. Lines for the ten pre-1923 divisions split between districts.

## 1. Repository changes (`intake stage`)

Dry run first (`node scripts/intake/intake.mjs stage <batch>`), then `--write`. Idempotent: a second run reports no changes.

24 change(s) against maps.json as of 7d9a2ad556 (the commit before the batch); 0 already in place; 0 conflict(s).

- `copy-dispensary-layers` (copy-files): add, 4. The three dispensary-district editions and their DED lookup. Gitignored in the repository: they live on R2.
- `copy-town-layers` (copy-files): add, 6. The six Towns Improvement Act town editions.
- `catalogue` (maps-json-patch): edit in `data/database/maps.json`, 14. Nine map entries after plu-ni-1921-04-01, the two catalogue series, and the PLU end-date text and 1948 reference on plu-ni-1924-04-01.

Edits:

- `data/database/maps.json`: insert maps entry dispensary-districts-ni-1929-01-01 after plu-ni-1921-04-01
- `data/database/maps.json`: insert maps entry dispensary-districts-ni-1924-04-01 after dispensary-districts-ni-1929-01-01
- `data/database/maps.json`: insert maps entry dispensary-districts-ni-1921-04-01 after dispensary-districts-ni-1924-04-01
- `data/database/maps.json`: insert maps entry tia-towns-ni-1921-05-03 after dispensary-districts-ni-1921-04-01
- `data/database/maps.json`: insert maps entry tia-towns-ni-1925-04-01 after tia-towns-ni-1921-05-03
- `data/database/maps.json`: insert maps entry tia-towns-ni-1927-04-01 after tia-towns-ni-1925-04-01
- `data/database/maps.json`: insert maps entry tia-towns-ni-1934-08-01 after tia-towns-ni-1927-04-01
- `data/database/maps.json`: insert maps entry tia-towns-ni-1937-04-01 after tia-towns-ni-1934-08-01
- `data/database/maps.json`: insert maps entry tia-towns-ni-1959-05-29 after tia-towns-ni-1937-04-01
- `data/database/maps.json`: insert class ni-dispensary-districts after ni-poor-law-unions
- `data/database/maps.json`: insert class ni-towns-improvement-act-towns after ni-dispensary-districts
- `data/database/maps.json`: edit plu-ni-1924-04-01.description
- `data/database/maps.json`: edit plu-ni-1924-04-01.description
- `data/database/maps.json`: add reference to plu-ni-1924-04-01: Public Health and Local Government (Abolition of Boards of Guardians) 

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

Commands, in order:

```
node --env-file=.env.local scripts/publish/r2-upload-files.mjs data/maps/health/Dispensary_Districts_NI_1921-04-01.fgb=data/maps/health/Dispensary_Districts_NI_1921-04-01.fgb data/maps/health/Dispensary_Districts_NI_1924-04-01.fgb=data/maps/health/Dispensary_Districts_NI_1924-04-01.fgb data/maps/health/Dispensary_Districts_NI_1929-01-01.fgb=data/maps/health/Dispensary_Districts_NI_1929-01-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1921-05-03.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1921-05-03.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1925-04-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1925-04-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1927-04-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1927-04-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1934-08-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1934-08-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1937-04-01.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1937-04-01.fgb data/maps/local-government/Towns_Improvement_Act_Towns_NI_1959-05-29.fgb=data/maps/local-government/Towns_Improvement_Act_Towns_NI_1959-05-29.fgb
node --env-file=.env.local scripts/publish/r2-upload-manifest.mjs --manifest <tmp>/upload-manifest-lookup-csv.json --prefix data/maps/health/ --force
node --env-file=.env.local scripts/publish/r2-upload-manifest.mjs --manifest <tmp>/upload-manifest-lookup-csv.json --prefix data/maps/health/ --verify-only
```

## 3. After the upload (`intake post-upload`)

```
python scripts/build/thumbnails/regen-thumbnails.py --download --ids dispensary-districts-ni-1921-04-01,dispensary-districts-ni-1924-04-01,dispensary-districts-ni-1929-01-01,tia-towns-ni-1921-05-03,tia-towns-ni-1925-04-01,tia-towns-ni-1927-04-01,tia-towns-ni-1934-08-01,tia-towns-ni-1937-04-01,tia-towns-ni-1959-05-29
node --env-file=.env.local scripts/publish/r2-upload-tree.mjs assets/thumbnails assets/thumbnails --concurrency=16 --changed-only
npm run rebuild
npm run check:fast
```

- `thumbnails`: UPLOAD.txt step 4: regen --download reads the FGBs from R2, so upload them first.
- `rebuild`: UPLOAD.txt step 3: build what changed.

## Notes

- The PMTiles for the nine editions, their Cache-Control and the CDN switch were scripted by batch-2026-11-05 (docs/intake-examples/batch-2026-11-05/batch.json).
- Crossmaglen Union (ordered 1921, never formed) and the Hillsborough/Dungannon slip in S.R. & O. 1948 No. 281 are PRONI items (proni-needed.csv).

## Publishing

Only after the owner approves in chat: `bash .claude/publish/publish.sh`. The intake tool never runs it.
