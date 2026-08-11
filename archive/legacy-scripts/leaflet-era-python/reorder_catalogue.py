"""Apply the catalogue reorder agreed in docs/catalogue-ordering-review.md.

Reads js/ui-controller.js, extracts each card object literal from c1Cards,
reorders them per the desired sequence (Historic Geographies →
Topography → Local Government → ... → Local Authority Open Data), and
rewrites tocGroups + tocMerges.

Card definitions themselves are NOT modified — only the order, the
heading membership, and the merge.inHeading on Settlements.
"""
from __future__ import annotations
import re, sys
from pathlib import Path

SRC = Path('js/ui-controller.js')
text = SRC.read_text(encoding='utf-8')

# ── 1. Locate and extract the c1Cards array literal block. ─────────────
m_c1 = re.search(r'(\n        const c1Cards = \[\n)(.*?)(\n        \];\n)', text, re.DOTALL)
if not m_c1:
    sys.exit('c1Cards block not found')
c1_prefix, c1_body, c1_suffix = m_c1.group(1), m_c1.group(2), m_c1.group(3)

# ── 2. Walk the c1Cards body and split into per-card chunks. ───────────
# Each card object literal starts at a line whose first non-whitespace
# token is '{' and ends at a line whose last non-whitespace token before
# the trailing comma is '}'. Some cards span 1 line; others span many
# (e.g. mapIds: [...] across multiple lines).
lines = c1_body.split('\n')
cards = []  # list of (id, lines_chunk)
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    # Skip blank + comment-only lines (but capture them with the next card
    # to preserve adjacent comments)
    if not stripped or stripped.startswith('//'):
        i += 1
        continue
    # Card start: line containing '{' as the start of the object literal.
    if '{' in stripped and not stripped.startswith('//'):
        start = i
        # Walk forward, balancing braces, to find the end of the card.
        depth = 0
        end = i
        for j in range(i, len(lines)):
            for ch in lines[j]:
                if ch == '{': depth += 1
                elif ch == '}': depth -= 1
            if depth == 0:
                end = j
                break
        chunk = '\n'.join(lines[start:end + 1])
        # Extract the id field
        m_id = re.search(r"id:\s*'([^']+)'|\"id\"\s*:\s*\"([^\"]+)\"", chunk)
        cid = (m_id.group(1) or m_id.group(2)) if m_id else None
        if not cid:
            sys.exit(f'card without id at lines {start}-{end}: {chunk[:80]!r}')
        cards.append((cid, chunk))
        i = end + 1
    else:
        i += 1

print(f'extracted {len(cards)} cards')

# ── 3. Desired order of cards by heading. ──────────────────────────────
# (heading_label, [card_ids_in_order]). card_ids that aren't in c1Cards
# trigger an explicit error so we don't silently drop anything.
ORDER = [
    ('Historic Geographies', [
        'flat-townlands', 'flat-civil-parishes', 'flat-baronies',
        'flat-counties-1915', 'flat-admin-counties', 'flat-provinces',
        'flat-polities',
    ]),
    ('Topography', [
        'flat-place-names', 'flat-seas', 'flat-islands', 'flat-rivers',
    ]),
    ('Local Government', [
        'flat-lgds', 'flat-roi-local-authorities', 'flat-admin-areas',
        'flat-elb', 'flat-hsct',
        'flat-roi-garda-areas', 'flat-roi-gaeltacht',
    ]),
    ('District-level Electoral Units', [
        'flat-roi-lea', 'flat-deas', 'flat-county-eds',
        'flat-dublin-electoral-counties',
    ]),
    ('Wards & Electoral Divisions', [
        'flat-wards', 'flat-deds', 'flat-eds-pre-partition',
        'flat-roi-deds', 'flat-nra',
    ]),
    ('Settlements & Built-Up Areas', [
        # Settlements merge: NI + ROI + Legal Towns
        'flat-settlements', 'flat-settlements-roi', 'flat-roi-legal-towns',
        'flat-tailte-builtup', 'flat-cso-urban',
    ]),
    ('Census Geographies', [
        'flat-cso-eds',
        # Small Census Units merge: NI + ROI
        'flat-small-census', 'flat-roi-small-census',
        'flat-super-census', 'flat-ttwa', 'flat-census-grid',
        'flat-nuts2', 'flat-nuts3',
    ]),
    ('Constituencies', [
        'flat-eu-parliament', 'flat-uk-parliament', 'flat-dail',
        # NI Constituencies merge
        'flat-ni-parliament', 'flat-assembly-areas', 'flat-assembly-1982',
        'flat-con-conv', 'flat-assembly-1973', 'flat-forum',
        'flat-referendum',
    ]),
    ('Census 2021 Data (Northern Ireland)', [
        'flat-data-2021-population', 'flat-data-2021-population-density',
        'flat-data-2021-households', 'flat-data-2021-household-size',
        'flat-data-2021-female-share', 'flat-data-2021-born-in-ni',
        'flat-data-2021-irish-knowledge', 'flat-data-2021-ulster-scots-knowledge',
        'flat-data-2021-religion-catholic', 'flat-data-2021-catholic-background',
        'flat-data-2021-limiting-condition', 'flat-data-2021-unpaid-care',
        'flat-data-2021-no-car', 'flat-data-2021-owner-occupied',
        'flat-data-2021-social-rented', 'flat-data-2021-private-rented',
        'flat-data-2021-no-quals', 'flat-data-2021-level-4-plus',
        'flat-data-2021-unemployed', 'flat-data-2021-work-from-home',
    ]),
    ('Heritage & Built Environment', [
        'flat-historic-sites', 'flat-catholic-parishes', 'flat-catholic-dioceses',
        'flat-hed-heritage', 'flat-glpr', 'flat-peacelines',
    ]),
    ('Environment, Water & Geology', [
        'flat-designated-sites', 'flat-habitat-networks',
        'flat-niea-extra', 'flat-ni-mineral', 'flat-ni-livestock',
        'flat-water-quality', 'flat-rwq-parameters',
        'flat-rbd', 'flat-river-basins', 'flat-opw-flood',
        'flat-gsi', 'flat-gsni-bedrock',
        'flat-tellus-geochem', 'flat-tellus-airborne',
        'flat-tellus-raw', 'flat-tellus-flightlines',
        'flat-noise', 'flat-copernicus-dem', 'flat-secondary',
    ]),
    ('Roads, Transport & Public Safety', [
        'flat-railways', 'flat-transport-lines',
        'flat-dfi-pothole', 'flat-dfi-surface', 'flat-transport-defects',
        'flat-dfi-borders-crossings', 'flat-belfast-cycle',
        'flat-translink', 'flat-tii', 'flat-psni-collisions',
    ]),
    ('Surveys & Reference Maps', [
        'flat-osni-coverage', 'flat-osni-rasters', 'flat-osni-sixinch',
    ]),
    ('Planning & Polling Stations', [
        'flat-roi-planning', 'flat-eoni-polling',
    ]),
    ('Local Authority Open Data', [
        'flat-dcc', 'flat-dlr', 'flat-sdcc', 'flat-fingal',
    ]),
]

# ── 4. Sanity-check: every card present, no extras, no duplicates. ────
existing = {cid: chunk for cid, chunk in cards}
desired_ids = []
for _, ids in ORDER:
    desired_ids.extend(ids)
if len(desired_ids) != len(set(desired_ids)):
    dup = [x for x in desired_ids if desired_ids.count(x) > 1]
    sys.exit(f'duplicate card IDs in ORDER: {set(dup)}')
missing_in_existing = [cid for cid in desired_ids if cid not in existing]
extras_in_existing = [cid for cid in existing if cid not in desired_ids]
if missing_in_existing:
    sys.exit(f'desired-but-not-in-c1Cards: {missing_in_existing}')
if extras_in_existing:
    sys.exit(f'in-c1Cards-but-not-in-ORDER: {extras_in_existing}')

# ── 5. Build the new c1Cards body, grouped + commented per heading. ──
new_chunks = []
for heading_label, ids in ORDER:
    new_chunks.append(f'            // ── {heading_label} ──')
    for cid in ids:
        new_chunks.append(existing[cid])
new_c1_body = '\n'.join(new_chunks)

# ── 6. Build the new tocGroups + tocMerges. ────────────────────────────
NEW_TOC_MERGES = """        const tocMerges = [
            {
                canonicalName: 'Settlements',
                mergedIds: ['flat-settlements', 'flat-settlements-roi', 'flat-roi-legal-towns'],
                years: '2005-2015',
                extent: 'Ireland',
                inHeading: 'Settlements & Built-Up Areas'
            },
            {
                canonicalName: 'Small Census Units',
                mergedIds: ['flat-small-census', 'flat-roi-small-census'],
                years: '2001-2022',
                extent: 'Ireland',
                inHeading: 'Census Geographies'
            },
            {
                canonicalName: 'Northern Ireland Constituencies',
                mergedIds: [
                    'flat-ni-parliament',
                    'flat-assembly-areas',
                    'flat-assembly-1982',
                    'flat-con-conv',
                    'flat-assembly-1973',
                    'flat-forum'
                ],
                years: '1920-2023',
                extent: 'Northern Ireland',
                inHeading: 'Constituencies'
            }
        ];"""

NEW_TOC_GROUPS = """        const tocGroups = [
            {
                heading: 'Historic Geographies',
                members: [
                    'Townlands', 'Civil Parishes', 'Baronies',
                    'Counties', 'Administrative Counties',
                    'Provinces', 'Polities'
                ]
            },
            {
                heading: 'Topography',
                members: ['Place Names', 'Seas', 'Islands', 'Rivers']
            },
            {
                heading: 'Local Government',
                members: [
                    'Local Government Districts', 'Local Authorities',
                    'Administrative Areas',
                    'Education and Library Boards',
                    'Health and Social Care Trusts',
                    'An Garda Síochána Areas', 'Gaeltacht Areas'
                ]
            },
            {
                heading: 'District-level Electoral Units',
                members: [
                    'Local Electoral Areas', 'District Electoral Areas',
                    'County Electoral Divisions', 'Dublin Electoral Counties'
                ]
            },
            {
                heading: 'Wards & Electoral Divisions',
                members: [
                    'Wards', 'District Electoral Divisions',
                    'Electoral Divisions', 'Neighbourhood Renewal Areas'
                ]
            },
            {
                heading: 'Settlements & Built-Up Areas',
                members: [
                    'Settlements', 'Tailte Built-Up Areas', 'CSO Urban Areas'
                ]
            },
            {
                heading: 'Census Geographies',
                members: [
                    'CSO Electoral Divisions', 'Small Census Units',
                    'Super Census Units', 'Travel To Work Areas',
                    'Census Grid', 'NUTS 2 Regions', 'NUTS 3 Regions'
                ]
            },
            {
                heading: 'Constituencies',
                members: [
                    'European Parliament Constituencies',
                    'UK Parliamentary Constituencies',
                    'Dáil Eireann Constituencies',
                    'Northern Ireland Constituencies',
                    'Referendum Counting Areas'
                ]
            },
            {
                heading: 'Census 2021 Data (Northern Ireland)',
                members: [
                    'Data — Census 2021: Usual resident population',
                    'Data — Census 2021: Population density',
                    'Data — Census 2021: Total households',
                    'Data — Census 2021: Average household size',
                    'Data — Census 2021: Female population share',
                    'Data — Census 2021: Born in Northern Ireland',
                    'Data — Census 2021: Some ability in Irish',
                    'Data — Census 2021: Some ability in Ulster-Scots',
                    'Data — Census 2021: Religion (% Catholic)',
                    'Data — Census 2021: Catholic community background',
                    'Data — Census 2021: Day-to-day activities limited',
                    'Data — Census 2021: Provides unpaid care',
                    'Data — Census 2021: Households with no car or van',
                    'Data — Census 2021: Owner-occupied households',
                    'Data — Census 2021: Social-rented households',
                    'Data — Census 2021: Private-rented households',
                    'Data — Census 2021: No qualifications',
                    'Data — Census 2021: Level 4+ qualifications',
                    'Data — Census 2021: Unemployed',
                    'Data — Census 2021: Work mainly at or from home'
                ]
            },
            {
                heading: 'Heritage & Built Environment',
                members: [
                    'Historic Sites', 'Catholic Parishes', 'Catholic Dioceses',
                    'NI Historic Environment Division — Heritage Sites',
                    'NI Government Land & Property Register',
                    'Peacelines'
                ]
            },
            {
                heading: 'Environment, Water & Geology',
                members: [
                    'Designated & Protected Sites', 'Habitat Networks',
                    'NIEA Catchments, Waste & Water Bodies',
                    'NI Mineral & Mining Licences', 'NI Livestock Density',
                    'Water Quality and Hydrology',
                    'River Water Quality 1990–2018 — by parameter',
                    'River Basin Districts', 'River Basins',
                    'OPW Flood Extents',
                    'Geological Survey Ireland — Bedrock & Karst',
                    'GSNI Bedrock and Surface Geology',
                    'Tellus Stream Sediments and Soils',
                    'Tellus Airborne Geophysics',
                    'Tellus Airborne — raw flight-line data',
                    'Tellus Airborne Survey — Flight Lines',
                    'Environmental Noise',
                    'Copernicus 30m DEM',
                    'Secondary maps'
                ]
            },
            {
                heading: 'Roads, Transport & Public Safety',
                members: [
                    'Railways', 'Transport Lines',
                    'NI DfI Pothole Enquiries', 'NI DfI Road Surface Defects',
                    'Carriageway and Footway Surface Defects',
                    'NI Border Crossings & Pedestrian Crossings',
                    'Belfast Cycle Network', 'Translink',
                    'TII Transport Infrastructure', 'PSNI Collisions'
                ]
            },
            {
                heading: 'Surveys & Reference Maps',
                members: [
                    'OSNI Map Sheet Coverage Grids and Benchmarks',
                    'OSNI Printed Raster Maps',
                    'OSNI Historical Six-Inch Maps'
                ]
            },
            {
                heading: 'Planning & Polling Stations',
                members: [
                    'ROI National Planning Applications', 'EONI Polling Stations'
                ]
            },
            {
                heading: 'Local Authority Open Data',
                members: [
                    'Dublin City Council — Open Data',
                    'Dún Laoghaire-Rathdown — Open Data',
                    'South Dublin County Council — Open Data',
                    'Fingal — Open Data'
                ]
            }
        ];"""

# ── 7. Splice the new content into js/ui-controller.js. ────────────────
new_text = text[:m_c1.start()] + c1_prefix + new_c1_body + c1_suffix + text[m_c1.end():]

# Replace tocMerges block
m_merges = re.search(r'        const tocMerges = \[\n.*?        \];', new_text, re.DOTALL)
if not m_merges:
    sys.exit('tocMerges block not found')
new_text = new_text[:m_merges.start()] + NEW_TOC_MERGES + new_text[m_merges.end():]

# Replace tocGroups block
m_groups = re.search(r'        const tocGroups = \[\n.*?        \];', new_text, re.DOTALL)
if not m_groups:
    sys.exit('tocGroups block not found')
new_text = new_text[:m_groups.start()] + NEW_TOC_GROUPS + new_text[m_groups.end():]

SRC.write_text(new_text, encoding='utf-8')
print(f'rewrote {SRC}')
print(f'  c1Cards: {len(cards)} cards reordered into {len(ORDER)} headings')
