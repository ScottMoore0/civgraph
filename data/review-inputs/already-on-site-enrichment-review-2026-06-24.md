# Already-On-Site Enrichment Review - 2026-06-24

## Scope

This is a research-only review of the 1112 tracked sanitized rows in `data/review-inputs/already-on-site-source-review-2026-06-24.csv`.

The goal is to identify what can be extracted from already-on-site or strong duplicate-match source rows without creating duplicate public records. No website catalogue/runtime records, R2/CDN assets, or Internet Archive uploads are changed by this script.

## Headline Findings

- Exact or very strong duplicate rows are useful for safe metadata enrichment: provenance, provider/source URLs, alternate download formats, hashes, dates, edition/scale labels, and source-file references.
- Family/context overlap rows are still useful, but mostly as review evidence. They should not be auto-applied because some matched evidence is fuzzy or points to a related family rather than the actual target record.
- The highest-value enrichment surfaces are existing map/source records for boundary datasets, census/statistical geographies, election geographies, environmental layers, and large raster/source-only items.
- The safest default is: enrich existing records, add source/download/variant references where confirmed, and avoid duplicate parent records.

## Safety Classes

| Safety Class | Rows |
| --- | --- |
| variant/source enrichment review | 873 |
| context-overlap review only | 143 |
| safe metadata enrichment candidate | 66 |
| high-confidence enrichment candidate | 25 |
| weak feature-family match | 5 |

## Possible Enrichment Types

| Enrichment Type | Rows |
| --- | --- |
| download/source-file metadata | 1112 |
| source/provenance metadata | 1112 |
| scale/generalisation/edition metadata | 1046 |
| alternate-format metadata | 928 |
| geospatial source-format metadata | 903 |
| schema/table/attribute metadata | 901 |
| raw-source viewport candidate metadata | 823 |
| geometry lineage and boundary-version metadata | 757 |
| date/version metadata | 397 |
| census/statistical provenance and concept context | 281 |
| election geography/source provenance | 100 |
| large raster/imagery preview or download metadata | 80 |

## ROI Groups

| ROI Group | Rows |
| --- | --- |
| 5. Local authority planning/property/open-data layers | 424 |
| 6. Environment, water, geology, protected sites, habitat and marine datasets | 362 |
| 3. Authoritative boundary variants from Tailte/OSI/Open Data NI/NISRA | 195 |
| 4. Open Data NI boundary and statistical-geography files | 56 |
| 1. CSO/NISRA census and statistical data | 29 |
| 2. Irish election source/enrichment data | 28 |
| 7. Transport, roads, infrastructure, public assets | 12 |
| 9. Large raster/imagery/LiDAR/point-cloud/3D-style content | 5 |
| 10. Bulk low-priority data.gov.ie/CSO tables | 1 |

## Providers

| Provider | Rows |
| --- | --- |
| data.gov.ie | 628 |
| Open Data NI | 259 |
| Tailte/OSI/data.gov.ie | 186 |
| Tellus airborne standalone | 23 |
| [local source path withheld] | 12 |
| EONI standalone | 2 |
| OSNI Fusion standalone | 2 |

## Stronger Candidates

| Safety | Provider | Title | Formats | Action | Target |
| --- | --- | --- | --- | --- | --- |
| high-confidence enrichment candidate | Open Data NI | NISRA Open Data Boundaries - Small Areas 2011 | GEOJSON\|MAPINFO\|PDF\|SHP\|XLSX | enrich matched source/map after target check; treat geometry as variant only if materially different | database-map:sa-2011 (Small Area 2011; 0.80) \| browse-source:map-source:sa-2011 (Small Area 2011 source files; 0.80) \| browse-map:sa-2011 (Small Area 2011; 0.80) |
| safe metadata enrichment candidate | data.gov.ie | Townland Boundaries DLR | DB_TABLE\|GEOJSON\|ZIP | enrich existing record only; do not create a new parent record | database-map:dlr-townland-boundaries (Townland Boundaries (DLR); 1.75) \| browse-map:dlr-townland-boundaries (Townland Boundaries (DLR); 1.75) \| browse-source:map-source:dlr-townland-boundaries (Townland Boundaries (DLR) source files; 0.75) |
| safe metadata enrichment candidate | data.gov.ie | Local Electoral Areas DLR | CSV\|GEOJSON\|ZIP | enrich existing record only; do not create a new parent record | database-map:dlr-local-electoral-areas (Local Electoral Areas (DLR); 1.78) \| browse-map:dlr-local-electoral-areas (Local Electoral Areas (DLR); 1.78) \| browse-source:map-source:dlr-local-electoral-areas (Local Electoral Areas (DLR) source files; 0.78) |
| safe metadata enrichment candidate | data.gov.ie | Administrative Area DLR | CSV\|GEOJSON\|ZIP | enrich existing record only; do not create a new parent record | database-map:dlr-administrative-area (Administrative Area (DLR); 1.75) \| browse-map:dlr-administrative-area (Administrative Area (DLR); 1.75) \| browse-source:map-source:dlr-administrative-area (Administrative Area (DLR) source files; 0.75) |
| high-confidence enrichment candidate | data.gov.ie | Flood Studies Update (FSU) Catchment Boundaries (gauged) 2025 | SHP | enrich matched source/map after target check; treat geometry as variant only if materially different | database-map:opw-fsu-catchments-gauged (FSU Catchment Boundaries ? Gauged 2025; 0.75) \| browse-source:map-source:opw-fsu-catchments-gauged (FSU Catchment Boundaries ? Gauged 2025 source files; 0.75) \| browse-map:opw-fsu-catchments-gauged (FSU Catchment Boundaries ? Gauged 2025; 0.75) |
| high-confidence enrichment candidate | EONI standalone | polling_stations | GEOJSON | enrich matched source/map after target check; treat geometry as variant only if materially different | database-map:eoni-polling-stations (EONI Polling Stations; 0.80) \| browse-source:map-source:eoni-polling-stations (EONI Polling Stations source files; 0.80) \| browse-map:eoni-polling-stations (EONI Polling Stations; 0.80) |
| high-confidence enrichment candidate | data.gov.ie | River & Bathing Water Sample Points DLR | CSV\|GEOJSON\|ZIP | enrich matched source/map after target check; treat geometry as variant only if materially different | database-map:dlr-dlr-river-and-bathing-water-sample-points (Dlr River And Bathing Water Sample Points (DLR); 0.83) \| browse-source:map-source:dlr-dlr-river-and-bathing-water-sample-points (Dlr River And Bathing Water Sample Points (DLR) source files; 0.83) \| browse-map:dlr-dlr-river-and-bathing-water-sample-points (Dlr River And Bathing Water Sample Points (DLR); 0.83) |
| high-confidence enrichment candidate | Open Data NI | Defence Heritage Sites Northern Ireland | GEOJSON\|ZIP | enrich matched source/map after target check; treat geometry as variant only if materially different | database-map:ni-defence-heritage (NI Defence Heritage; 0.80) \| database-map:hed-defence-heritage (Defence Heritage Sites (NI); 0.80) \| browse-source:map-source:ni-defence-heritage (NI Defence Heritage source files; 0.80) |
| safe metadata enrichment candidate | Open Data NI | Industrial Heritage Record | GEOJSON\|ZIP | enrich existing record only; do not create a new parent record | database-map:hed-industrial-heritage (Industrial Heritage Record; 1.80) \| browse-map:hed-industrial-heritage (Industrial Heritage Record; 1.80) \| database-map:ni-industrial-heritage (NI Industrial Heritage Record; 0.90) |
| safe metadata enrichment candidate | data.gov.ie | Electoral Divisions DCC | CSV\|GEOJSON\|WMS\|ZIP | enrich existing record only; do not create a new parent record | database-map:dcc-electoral-divisions (Electoral Divisions (DCC); 1.67) \| browse-map:dcc-electoral-divisions (Electoral Divisions (DCC); 1.67) \| browse-source:map-source:dcc-electoral-divisions (Electoral Divisions (DCC) source files; 0.67) |
| safe metadata enrichment candidate | Open Data NI | Border Crossings 2018 | GEOJSON\|ZIP | enrich existing record only; do not create a new parent record | database-map:roads-border-crossings-2018 (Border Crossings 2018; 1.75) \| browse-map:roads-border-crossings-2018 (Border Crossings 2018; 1.75) \| database-map:dfi-border-crossings-2018-lines (NI Border Crossings 2018 (Lines); 0.88) |
| safe metadata enrichment candidate | Open Data NI | Pedestrian Crossings | CSV\|GEOJSON\|XML | enrich existing record only; do not create a new parent record | database-map:roads-pedestrian-crossings (Pedestrian Crossings; 1.56) \| browse-map:roads-pedestrian-crossings (Pedestrian Crossings; 1.56) \| database-map:dfi-pedestrian-crossings (NI Pedestrian Crossings; 0.78) |
| safe metadata enrichment candidate | Open Data NI | Pothole Enquiries | CSV\|CSV.\|GEOJSON\|XML | enrich existing record only; do not create a new parent record | database-map:roads-pothole-enquiries (Pothole Enquiries; 1.71) \| browse-map:roads-pothole-enquiries (Pothole Enquiries; 1.71) \| database-map:dfi-pothole-enquiries-2021 (NI Pothole Enquiries 2021; 0.86) |
| safe metadata enrichment candidate | data.gov.ie | Access Points to Main Parks DLR | CSV\|GEOJSON\|ZIP | enrich existing record only; do not create a new parent record | database-map:dlr-access-points-to-main-parks (Access Points To Main Parks (DLR); 1.82) \| browse-map:dlr-access-points-to-main-parks (Access Points To Main Parks (DLR); 1.82) \| browse-source:map-source:dlr-access-points-to-main-parks (Access Points To Main Parks (DLR) source files; 0.82) |

## Review-Only Examples

| Safety | Provider | Title | Formats | Action | Target |
| --- | --- | --- | --- | --- | --- |
| variant/source enrichment review | [local source path withheld] | ConstituencyBoundariesUngeneralised_National_Electoral_Boundaries_2023_-2568859868331602633 | GEOJSON | compare provider/date/scale/schema with existing family before adding metadata | browse-feature:deas-2012 (District Electoral Areas 2012; 0.50) \| browse-map:wards-2022-final-recommendations (Wards - 2022 (Final Recommendations); 0.50) \| database-map:wards-2022-final-recommendations (2022 (Final Recommendations); 0.33) |
| variant/source enrichment review | Open Data NI | Boundary Commission for Northern Ireland - Provisional Proposals for Parliamentary Constituencies | GEOJSON\|SHP | compare provider/date/scale/schema with existing family before adding metadata | database-map:pc-2023 (Parliamentary Constituencies 2023; 0.62) \| browse-map:pc-2023 (Parliamentary Constituencies 2023; 0.50) \| database-map:osni-1m-parliamentary (OSNI 1:1M Thematic ? Parliamentary Boundaries; 0.38) |
| variant/source enrichment review | Open Data NI | Coastal Flood Boundary Extreme Sea Levels (2018) - NI Extract | SHP | compare provider/date/scale/schema with existing family before adding metadata | database-map:rivers-coastal-flood-2018 (Coastal Flood Boundary ? Extreme Sea Levels (2018); 0.64) \| browse-source:map-source:rivers-coastal-flood-2018 (Coastal Flood Boundary ? Extreme Sea Levels (2018) source files; 0.64) \| browse-map:rivers-coastal-flood-2018 (Coastal Flood Boundary ? Extreme Sea Levels (2018); 0.64) |
| variant/source enrichment review | Open Data NI | Department of Health trust boundaries | GEOJSON\|SHP | compare provider/date/scale/schema with existing family before adding metadata | browse-feature:hsct-2007 (Health and Social Care Trusts 2007; 0.60) \| database-map:habitat-grassland-grouped (Habitat Network ? Grassland Habitat Networks (grouped); 0.40) \| database-map:habitat-woodland-grouped (Habitat Network ? Woodland Habitat Networks (grouped); 0.40) |
| variant/source enrichment review | Open Data NI | Mid Ulster Council District Electoral Areas | CSV\|GEOJSON\|HTML\|JSON\|KML\|SHP | compare provider/date/scale/schema with existing family before adding metadata | browse-feature:deas-2012 (District Electoral Areas 2012; 0.62) \| browse-feature:ttwa-2007 (Travel To Work Areas 2007; 0.50) \| browse-source:map-source:eds-roi-1970 (District Electoral Divisions/Wards 1970 source files; 0.50) |
| variant/source enrichment review | Open Data NI | NISRA Open Data Boundaries - Census Output Areas 2001 | MAPINFO\|SHP\|XLSX | compare provider/date/scale/schema with existing family before adding metadata | database-map:oa-2001 (Output Area 2001; 0.73) \| database-map:sa-2011 (Small Area 2011; 0.73) \| database-map:soa-2011 (Super Output Area 2011; 0.73) |
| variant/source enrichment review | Open Data NI | OSNI Open Data - 50K Boundaries - District Electoral Areas (1993) | CSV\|GEOJSON\|KML\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:deas-1993 (District Electoral Areas 1993; 0.50) \| browse-source:map-source:wards-2022-final-recommendations (Wards - 2022 (Final Recommendations) source files; 0.50) \| browse-source:map-source:deas-1993 (District Electoral Areas - 1993 source files; 0.50) |
| variant/source enrichment review | Open Data NI | OSNI Open Data - 50K Boundaries - Local Government Districts (1993) | CSV\|GEOJSON\|KML\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:lgd-2022-final-recommendations (2022 (Final Recommendations); 0.50) \| browse-source:map-source:lgd-2022-final-recommendations (Local Government Districts - 2022 (Final Recommendations) source files; 0.50) \| browse-map:lgd-2022-final-recommendations (Local Government Districts - 2022 (Final Recommendations); 0.50) |
| variant/source enrichment review | Open Data NI | OSNI Open Data - 50K Boundaries - Parliamentary Constituencies | CSV\|GEOJSON\|KML\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:eoni-polling-stations (EONI Polling Stations; 0.40) \| database-map:wq-agricultural-critical-risk (Agricultural Critical Risk Areas (DAERA); 0.40) \| database-map:osni-sixinch-edition-2 (OSNI Historical Six-Inch Maps ? Edition 2 (1838?1862); 0.40) |
| variant/source enrichment review | Open Data NI | OSNI Open Data - 50K Boundaries - Townlands (2013) | CSV\|GEOJSON\|KML\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:eoni-polling-stations (EONI Polling Stations; 0.40) \| database-map:wq-agricultural-critical-risk (Agricultural Critical Risk Areas (DAERA); 0.40) \| database-map:osni-sixinch-edition-2 (OSNI Historical Six-Inch Maps ? Edition 2 (1838?1862); 0.40) |
| variant/source enrichment review | Open Data NI | OSNI Open Data - 50K Boundaries - Wards (1993) | CSV\|GEOJSON\|KML\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:wards-1993 (Wards 1993; 0.50) \| database-map:wards-2022-final-recommendations (2022 (Final Recommendations); 0.50) \| browse-source:map-source:wards-2022-final-recommendations (Wards - 2022 (Final Recommendations) source files; 0.50) |
| variant/source enrichment review | Open Data NI | OSNI Open Data - Largescale Boundaries - Local Government Districts (1993) | CSV\|GEOJSON\|KML\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:lgd-2022-final-recommendations (2022 (Final Recommendations); 0.50) \| browse-source:map-source:lgd-2022-final-recommendations (Local Government Districts - 2022 (Final Recommendations) source files; 0.50) \| browse-map:lgd-2022-final-recommendations (Local Government Districts - 2022 (Final Recommendations); 0.50) |
| variant/source enrichment review | Tailte/OSI/data.gov.ie | Administrative Areas - National Statutory Boundaries - 2019 | ARCGIS GEOSERVICES REST API\|CSV\|GDB\|GEOJSON\|GPKG\|HTML\|KML\|TXT\|XLSX\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:counties-ireland (Counties of Ireland; 0.71) \| browse-source:map-source:counties-ireland (Counties of Ireland source files; 0.71) \| browse-map:counties-ireland (Counties of Ireland; 0.71) |
| variant/source enrichment review | Tailte/OSI/data.gov.ie | Administrative Areas - National Statutory Boundaries - 2019 - Generalised 20m | ARCGIS GEOSERVICES REST API\|CSV\|GDB\|GEOJSON\|GPKG\|HTML\|KML\|TXT\|XLSX\|ZIP | compare provider/date/scale/schema with existing family before adding metadata | database-map:counties-ireland (Counties of Ireland; 0.56) \| browse-source:map-source:counties-ireland (Counties of Ireland source files; 0.56) \| browse-map:counties-ireland (Counties of Ireland; 0.56) |

## Recommended Use

1. Do not add these rows as new parent records just because the raw file exists locally.
2. For exact and high-confidence rows, enrich the existing Civgraph record with:
   - provider and organisation provenance,
   - original/local source path,
   - source URL or future Internet Archive mirror URL,
   - alternate source formats,
   - publication/version/date/scale labels,
   - source file hashes and sizes where available,
   - source-document or viewport links where appropriate.
3. For family matches, compare source geometry, date, scale, schema, and provider before deciding whether to add:
   - source-file metadata only,
   - a child/variant record,
   - a citation-only source record,
   - or nothing.
4. For context-overlap rows, keep them in review batches. Do not apply automatically.
5. For census/statistical rows, treat this pass as source/provenance and geography/context evidence only. Structured facts still need the census/statistical semantic model before publication.

## Outputs

- Row-level review: `data/review-inputs/already-on-site-enrichment-review-2026-06-24.csv`
- Machine-readable summary: `data/review-inputs/already-on-site-enrichment-summary-2026-06-24.json`
