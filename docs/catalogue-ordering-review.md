# Catalogue ordering — current state and proposal

Reference for resolving collaborator review item #12 ("The sections in
the list of maps are quite out of sync with how they're supposed to be
ordered"). This doc lists what users currently see, then proposes a
reorder, then states the diff.

The catalogue order is set by `c1Cards` (the master ordered list of map
cards) and `tocGroups` (the list of subheadings, each with an ordered
`members` array) in `js/ui-controller.js`. The render rule: walking
`c1Cards` top to bottom, the first time we hit a card whose stripped name
appears in any `tocGroups[*].members`, we emit that subheading and all of
its members in `members[]` order; subsequent already-rendered cards are
skipped. Cards not in any heading render standalone in their `c1Cards`
position.

---

## Current visible order

The user sees this top-to-bottom in the catalogue's table of contents.
Bold = subheading; indented = members of the subheading above; flat = standalone.

1.  Townlands
2.  Settlements *(merged: NI + ROI + Legal Towns and Cities)*
3.  Place Names (Northern Ireland)
4.  Civil Parishes
5.  Baronies
6.  Counties (1915)
7.  Provinces

8.  **Small Electoral Units**
    - Wards
    - District Electoral Divisions (Northern Ireland) (1920-1973)
    - Electoral Divisions (Ireland, pre-partition)
    - Electoral Divisions *(ROI 1921–2019)*

9.  **Large Electoral Units**
    - Local Electoral Areas (Republic of Ireland)
    - District Electoral Areas (1973–)
    - County Electoral Divisions (Northern Ireland)
    - Dublin Electoral Counties (1985)

10. **Local Authorities**
    - Local Government Districts (Northern Ireland) (1973–)
    - Local Authorities (Republic of Ireland)
    - Administrative Areas (Northern Ireland) (1920-1973)

11. **Census Geographies**
    - CSO Electoral Divisions (Republic of Ireland) (2006-)
    - Small Census Units *(merged: NI + ROI)*
    - Super Census Units (Northern Ireland)
    - Travel To Work Areas (Northern Ireland)
    - Census Grid (2021) (Northern Ireland)

12. An Garda Síochána Areas (Republic of Ireland)
13. Gaeltacht Areas (Republic of Ireland)

14. **Regional Authorities**
    - Education and Library Boards (Northern Ireland)
    - Health and Social Care Trusts (Northern Ireland)
    - Administrative Counties (Northern Ireland) (1915)

15. **Constituencies**
    - European Parliament Constituencies (1979–)
    - UK Parliamentary Constituencies (1884–)
    - Dáil Eireann Constituencies (1923–)
    - Northern Ireland Constituencies *(merged: Stormont + Assembly + Forum + Convention + Assembly 1982/1973)*
    - Referendum Counting Areas (1975–)

16. Polities
17. Neighbourhood Renewal Areas (Northern Ireland)
18. NUTS 2 Regions (Ireland)
19. NUTS 3 Regions (2003) (Northern Ireland)
20. Seas (2023)
21. Rivers (2016) (Northern Ireland)
22. Islands
23. River Basin Districts (2016) (Northern Ireland)
24. River Basins (2016) (Northern Ireland)
25. Peacelines (Northern Ireland)
26. Historic Sites
27. Catholic Parishes
28. Catholic Dioceses
29. Railways
30. Transport Lines (Roads and Railways)
31. Copernicus 30m DEM (Ireland)
32. Secondary maps
33. GSNI Bedrock and Surface Geology
34. Tellus Stream Sediments and Soils
35. Tellus Airborne Geophysics
36. OSNI Map Sheet Coverage Grids and Benchmarks
37. OSNI Printed Raster Maps
38. OSNI Historical Six-Inch Maps
39. Water Quality and Hydrology
40. River Water Quality 1990–2018 — by parameter
41. Environmental Noise (END 2017)
42. Carriageway and Footway Surface Defects
43. Tellus Airborne — raw flight-line data
44. Designated & Protected Sites (NIEA)
45. Habitat Networks (Ulster Wildlife)
46–65. **Census 2021 Data cards** *(20 standalone "Data — Census 2021: …" rows: population, density, households, age, born-in-NI, Irish, Ulster-Scots, religion, etc.)*
66. Tailte Built-Up Areas (Ireland)
67. CSO Urban Areas (2022)

68. **Planning & Polling Stations**
    - ROI National Planning Applications
    - EONI Polling Stations
    - Polling Station Data *(currently empty — only Fingal entry was removed)*

69. **Heritage & Built Environment**
    - NI Historic Environment Division — Heritage Sites
    - NI Government Land & Property Register

70. **Environment, Water & Geology**
    - NIEA Catchments, Waste & Water Bodies
    - NI Mineral & Mining Licences
    - NI Livestock Density
    - Geological Survey Ireland — Bedrock & Karst
    - OPW Flood Extents
    - Tellus Airborne Survey — Flight Lines

71. **Roads, Transport & Public Safety**
    - NI DfI Pothole Enquiries
    - NI DfI Road Surface Defects
    - NI Border Crossings & Pedestrian Crossings
    - Belfast Cycle Network
    - Translink
    - TII Transport Infrastructure
    - PSNI Collisions

72. **Local Authority Open Data**
    - Dublin City Council — Open Data
    - Dún Laoghaire-Rathdown — Open Data
    - South Dublin County Council — Open Data
    - Fingal — Open Data

---

## Critique of the current order

What works:
- The five "small/large/local authority/census/regional" admin headings
  are clustered (positions 8–14) and roughly in size order.
- Constituencies are gathered into one heading (position 15).

What doesn't:
1. **Standalone cards mix with grouped cards inconsistently.** Townlands /
   Settlements / Civil Parishes / Baronies / Counties / Provinces are
   standalones at positions 1–7, then we hit grouped admin headings, then
   more standalones (Garda, Gaeltacht), then more headings. There's no
   single rule.
2. **Spatial hierarchy is broken.** Counties appears before Provinces
   (provinces contain counties, so should come first in a top-down list).
   Townlands (smallest unit) appears at position 1, before everything
   bigger. The order is neither clearly top-down nor bottom-up.
3. **Geological / OSNI / sectoral cards are ungrouped** (positions
   33–45). They form a long flat list of unrelated topics with no
   subheadings, then suddenly **Heritage & Built Environment** appears
   *after* the 20-row Census 2021 Data block, even though some of those
   ungrouped sectoral cards (Designated Sites, Habitat Networks)
   logically belong under Environment.
4. **Census 2021 Data block (20 rows) is uncategorised** — at positions
   46–65 the user scrolls through 20 thematic data layers (population,
   religion, qualifications, work-from-home, etc.) with no subheading
   structure.
5. **Polities** sits orphaned at position 16 between Constituencies and
   Neighbourhood Renewal Areas — neither in a heading nor near other
   territorial entities (it should sit alongside Provinces / Counties).
6. **Heritage & Environment headings appear after Census Data, after
   Tailte/CSO Urban** — the heading positions 68–72 look like an
   afterthought because the standalone rows ahead of them weren't placed
   under their natural heading.
7. **Some headings duplicate semantic territory.** "Regional
   Authorities" (ELBs, HSCTs, Administrative Counties) sits separately
   from "Local Authorities" — but the difference between *regional* and
   *local* is fuzzy enough that one heading "Administrative Areas" might
   be cleaner.

---

## Proposed reorder

**Principles:**
- Every top-level catalogue item is under a subheading. No standalones
  mixed with grouped cards.
- Top-level subheading ordering is **thematic** (Historic Geographies →
  Topography → Local Government → Electoral units → Settlements →
  Census → Constituencies → Census 2021 Data → Heritage → Environment
  → Roads/Transport → Surveys → Planning → Local Authority Open Data).
- Within each subheading, ordering is **hierarchical** where the cards
  form a hierarchy. Historic Geographies runs bottom-up (Townlands →
  Polities) so the catalogue opens at the most familiar / granular
  layer. Other subheadings run from largest to smallest where it
  applies.
- Sectoral / domain data (geology, transport, environment, heritage)
  comes after admin geography, each as a clearly-labelled subheading.
- Per-jurisdiction Open Data sources at the very end (least common
  reason to visit the catalogue).

**Proposed top-to-bottom structure:**

1. **Historic Geographies** *(bottom-up: smallest → largest)*
   - Townlands
   - Civil Parishes
   - Baronies
   - Counties (1915) *(re-titled "Counties (1899–1977)" or just "Counties")*
   - Administrative Counties (Northern Ireland) (1915)
   - Provinces
   - Polities (NI 1921 / RoI 1921)

2. **Topography**
   - Place Names (Northern Ireland)
   - Seas (2023)
   - Islands
   - Rivers (2016) (Northern Ireland)

3. **Local Government** *(replacing the current "Local Authorities" + "Regional Authorities" pair)*
   - Local Government Districts (Northern Ireland) (1973–)
   - Local Authorities (Republic of Ireland)
   - Administrative Areas (Northern Ireland) (1920–1973)
   - Education and Library Boards (Northern Ireland)
   - Health and Social Care Trusts (Northern Ireland)
   - An Garda Síochána Areas (Republic of Ireland)
   - Gaeltacht Areas (Republic of Ireland)

4. **District-level Electoral Units**
   - Local Electoral Areas (Republic of Ireland)
   - District Electoral Areas (Northern Ireland) (1973–)
   - County Electoral Divisions (Northern Ireland)
   - Dublin Electoral Counties (1985)

5. **Wards & Electoral Divisions** *(combining Small Electoral Units)*
   - Wards (Northern Ireland) (1973–)
   - District Electoral Divisions (Northern Ireland) (1920–1973)
   - Electoral Divisions (Ireland, pre-partition)
   - Electoral Divisions (ROI, 1921–2019)
   - Neighbourhood Renewal Areas (Northern Ireland)

6. **Settlements & Built-Up Areas**
   - Settlements *(merged NI + ROI + Legal Towns)*
   - Tailte Built-Up Areas (Ireland)
   - CSO Urban Areas (2022)

7. **Census Geographies**
   - CSO Electoral Divisions (RoI) (2006–)
   - Small Census Units *(merged NI + ROI)*
   - Super Census Units (Northern Ireland)
   - Travel To Work Areas (Northern Ireland)
   - Census Grid (2021) (Northern Ireland)
   - NUTS 2 Regions (Ireland)
   - NUTS 3 Regions (Northern Ireland)

8. **Constituencies** *(unchanged)*
   - European Parliament Constituencies (1979–)
   - UK Parliamentary Constituencies (1884–)
   - Dáil Éireann Constituencies (1923–)
   - Northern Ireland Constituencies *(merged Stormont/Assembly/Forum/Convention)*
   - Referendum Counting Areas (1975–)

9. **Census 2021 Data (Northern Ireland)** *(new heading absorbing all 20 standalone Data cards)*
   - Population, density, household size, age structure, religion,
     identity, language, qualifications, employment, housing tenure,
     transport mode, etc. (20 rows in the existing order)

10. **Heritage & Built Environment**
    - Historic Sites
    - Catholic Parishes
    - Catholic Dioceses
    - NI Historic Environment Division — Heritage Sites
    - NI Government Land & Property Register
    - Peacelines (Northern Ireland)

11. **Environment, Water & Geology**
    - Designated & Protected Sites (NIEA)
    - Habitat Networks (Ulster Wildlife)
    - NIEA Catchments, Waste & Water Bodies
    - NI Mineral & Mining Licences
    - NI Livestock Density
    - Water Quality and Hydrology
    - River Water Quality 1990–2018 — by parameter
    - River Basin Districts (2016)
    - River Basins (2016)
    - OPW Flood Extents
    - Geological Survey Ireland — Bedrock & Karst
    - GSNI Bedrock and Surface Geology
    - Tellus Stream Sediments and Soils
    - Tellus Airborne Geophysics
    - Tellus Airborne — raw flight-line data
    - Tellus Airborne Survey — Flight Lines
    - Environmental Noise (END 2017)
    - Copernicus 30m DEM (Ireland)
    - Secondary maps *(highlands/uplands derived layers)*

12. **Roads, Transport & Public Safety**
    - Railways
    - Transport Lines (Roads and Railways)
    - NI DfI Pothole Enquiries
    - NI DfI Road Surface Defects
    - Carriageway and Footway Surface Defects
    - NI Border Crossings & Pedestrian Crossings
    - Belfast Cycle Network
    - Translink
    - TII Transport Infrastructure
    - PSNI Collisions

13. **Surveys & Reference Maps**
    - OSNI Map Sheet Coverage Grids and Benchmarks
    - OSNI Printed Raster Maps
    - OSNI Historical Six-Inch Maps

14. **Planning & Polling Stations**
    - ROI National Planning Applications
    - EONI Polling Stations

15. **Local Authority Open Data**
    - Dublin City Council
    - Dún Laoghaire-Rathdown
    - South Dublin County Council
    - Fingal

---

## Differences between current and proposed

| Concern | Current | Proposed |
|---|---|---|
| **Spatial hierarchy** | Townlands first, then mixed; Counties before Provinces | §1 bottom-up: Townlands → Civil Parishes → Baronies → Counties → Admin Counties (NI) → Provinces → Polities |
| **Polities** | Orphan standalone at position 16 | Last card in §1 Historic Geographies (above Provinces, below Counties) |
| **Provinces** | Position 7, after Counties (out of order) | Inside §1, after Counties + Admin Counties so the bottom-up read still escalates correctly |
| **Place Names / Seas / Islands / Rivers** | Four standalones scattered (positions 3, 20, 21, 22) | Folded into new §2 Topography |
| **Wards / DEDs / EDs** | Subheading "Small Electoral Units" at position 8 | Subheading "Wards & Electoral Divisions" §5 |
| **NRA (Neighbourhood Renewal Areas)** | Standalone at position 17 | Folded into §5 alongside other small electoral / community-level units |
| **Settlements** | Standalone at position 2 | Subheading "Settlements & Built-Up Areas" §6 (with Tailte + CSO Urban) |
| **Tailte Built-Up + CSO Urban** | Two standalone rows late in the catalogue | Folded into §6 |
| **Peacelines** | Standalone at position 25 | Folded into §10 Heritage & Built Environment |
| **Garda + Gaeltacht** | Two standalone rows between admin headings | Folded into §3 Local Government |
| **Regional Authorities** (ELBs, HSCTs, Admin Counties) | Separate heading at position 14 | ELBs + HSCTs merged into §3 Local Government; Admin Counties (1915) moved to §1 alongside Counties |
| **NUTS 2 / NUTS 3** | Two standalones at positions 18–19 | Folded into §7 Census Geographies |
| **Census 2021 Data (20 rows)** | 20 standalone "Data — Census 2021: …" rows | Single subheading §9 with all 20 rows under it |
| **Historic Sites / Catholic Parishes / Dioceses** | Three standalones at 26–28 | Folded into §10 Heritage & Built Environment |
| **Designated Sites + Habitat Networks** | Two standalones at 44–45 | Folded into §11 Environment, Water & Geology |
| **Water/Geology/Tellus** | Many standalones interspersed (positions 33–45) | All consolidated into §11 |
| **River Basin Districts / River Basins** | Two standalones at 23–24 | Folded into §11 |
| **Railways + Transport Lines + Carriageway Defects** | Three standalones at 29–30, 42 | Folded into §12 Roads, Transport & Public Safety |
| **OSNI maps** | Three standalones at 36–38, in middle of list | Subheading §13 Surveys & Reference Maps near the end |
| **Heritage / Environment / Roads / LA Open Data headings** | All appear at positions 69–72 (after standalones that should be in them) | Headings absorb their natural members earlier in the list, so each heading is actually populated where it appears |

### Counts

- Current: **11 subheadings**, with ~66 standalone cards alongside (≈ 41 individual standalones + the 20 Census 2021 Data rows + 5 minor leaders) — about ~85 visible TOC entries total
- Proposed: **16 subheadings, every card under a subheading** (no standalones at top level)

### Rendering implications

The reorder is a `c1Cards` re-sequencing + `tocGroups` membership update
in `js/ui-controller.js`. No data changes, no FGB regeneration. Once
the proposed order is signed off:

- Renumber the entries in `c1Cards` to match the proposed sequence.
- Rewrite `tocGroups` so each subheading's `members[]` lists the cards
  in its intended order.
- Keep the existing `tocMerges` (Settlements, Small Census Units,
  Northern Ireland Constituencies) — only the `inHeading` field may
  need a tweak if the heading name changes (e.g. "Census Units" →
  "Census Geographies" already done, "Constituencies" unchanged).

Estimated effort: ~30 min once the order is signed off.

---

## Reviewer answers (resolved)

1. Hierarchy is bottom-up *within* each subheading; top-level grouping
   stays thematic. Tension is contained at scope-boundaries, not across
   the whole list.
2. Regional Authorities (ELBs, HSCTs) folded into §3 Local Government.
   Administrative Counties (1915) moved to §1 Historic Geographies
   alongside Counties.
3. Census 2021 Data — single heading §9, all 20 rows under it.
4. Townlands first (bottom-up) confirmed; §1 reads
   Townlands → Civil Parishes → Baronies → Counties → Provinces →
   Polities.
5. No further sub-splits — the 16 subheadings cover every card. Religious
   Geography (Catholic Parishes/Dioceses), Public Safety (PSNI
   Collisions), and Tellus would each only have 1–4 cards if split out,
   not enough to warrant their own heading.
