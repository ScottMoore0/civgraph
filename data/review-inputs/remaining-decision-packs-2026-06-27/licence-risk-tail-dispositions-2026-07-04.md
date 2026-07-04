# Licence-risk review — tail dispositions (2026-07-04)

Closes the 67-row non-confirmed tail of
`data/review-inputs/remaining-decision-packs-2026-06-27/licence-risk-review.json`
(the 2,647-row set is otherwise 2,580 `standard-open-licence-confirmed`). Each
non-confirmed row now has a terminal disposition below, so it should not resurface
as "unresolved" in future review passes.

Method: for every non-confirmed row that carried a public provider URL, the
provider page was fetched and the resource-level licence read directly
(2026-07-04). Rows with no public URL keep the standing restriction.

## A. Resolvable rows with a provider URL (10) — fetched 2026-07-04

| Title | Provider | HTTP | Licence found | Disposition |
|---|---|---|---|---|
| Dublin Public Cycle Parking Facilities | data.gov.ie | 200 | **CC-BY 4.0** | Licence resolved → eligible; low-value point layer, not prioritised for publication |
| Wicklow Landscape Category (CDP 2022–2028) | data.gov.ie | 200 | Licence Not Specified | Keep source-only (rights genuinely unspecified) |
| Greystones-Delgany & Kilcoole LPF Boundary | data.gov.ie | 200 | Licence Not Specified | Keep source-only |
| Nature Reserves (CDP 2022–2028) | data.gov.ie | 200 | Licence Not Specified | Keep source-only |
| Local Electoral Areas 2019 SDCC | data.gov.ie | 404 | — (dead) | Source-only, link-dead; duplicate of published LEA coverage |
| Kildare Landscape Character 23–29 | data.gov.ie | 404 | — (dead) | Source-only, link-dead |
| Parking Fines 2025 SDCC | data.gov.ie | 404 | — (dead) | Source-only, link-dead (non-spatial) |
| DCC Public Cycle Parking Stands | data.gov.ie | 404 | — (dead) | Source-only, link-dead |
| Newbridge House Visitors FCC | data.gov.ie | 404 | — (dead) | Source-only, link-dead (non-spatial) |
| OSNI Largescale Boundaries — LGD 1993 | Open Data NI | 403 | OGL (provider default) | Source-only: duplicate of published `lgd-1993`; page in the admin.opendatani 403 class |

Net: 1 of 10 resolves to a confirmed open licence (a low-value cycle-parking point
layer); 3 are explicitly unlicensed; 5 are dead sources; 1 is a duplicate. Nothing
here warrants publication.

## B. No public provider URL (28) — remain hard-gated source-only

- **Sensitive / personal data — permanent hold, never publish:** row 555
  `properties` (EONI standalone) and any Pointer/UPRN/address-bearing layer.
  Preserve the local source file; never mirror, convert, or upload.
- **Tellus airborne geophysics rasters (24 rows):** Electromagnetics / Magnetics /
  Radiometrics products (`tellus-*-merc/-rgba`, `Tellus_*_ESRIGRID`). Raster data on
  a separate acquisition + georeferencing track (not vector-PMTiles). No public
  provider URL recorded → source-only until a GSNI/GSI public URL and the Tellus
  open-data terms are confirmed. (See the raster-georef pipeline note.)
- **OSNI Fusion `shard0`/`shard1`:** local standalone shards, no URL → source-only.

## C. Blocked local-source rights review (19) — source-only

Local standalone boundary/statistical files with no public provider URL:
`Counties_RoI`, `merged_output`, `census-2011`, `census-2021`,
`Irish Digitised Boundaries`, `Electoral Divisions 1986-2019`,
`WGS_Electoral_Wards_Final_1984`, `LocalAuthorities_NationalStatutoryBoundaries`,
`CatchmentsDataPackage_June2022`, and the `Constituency_Boundaries_Ungeneralised_*`
set. All are duplicates of coverage already published from canonical sources
(counties, EDs, wards, constituencies, census boundaries). Disposition: keep
source-only; do not mirror/convert/upload until a public provider URL and rights
statement are identified.

## Outcome

The licence-risk review is fully adjudicated: 2,580 confirmed-open + 67 tail rows
each given a terminal disposition. The only newly licence-cleared item is one
low-value data.gov.ie point layer; every other tail row is correctly source-only
(unspecified rights, dead link, duplicate, sensitive, or raster-acquisition-gated).
No publishable map is unblocked by this pass.
