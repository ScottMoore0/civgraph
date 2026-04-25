import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

// Use existing 'historic' category (Built Environment group) — these are the
// classic 19th-century OSI/OSNI Six-Inch maps, the foundational topographic
// archive of Ireland.
const catId = 'historic';
const SIXINCH_BOUNDS = [[53.95, -8.30], [55.33, -5.30]];
const BASE = 'https://data.civgraph.net/data/maps/historic';

const ed1Counties = ['antrim', 'armagh', 'derry-londonderry', 'down', 'fermanagh', 'tyrone'];
const ed2Counties = ['antrim', 'armagh', 'derry-londonderry', 'down', 'fermanagh', 'tyrone'];
const pkgUrl = (ed, county) =>
    `https://admin.opendatani.gov.uk/dataset/osni-open-data-historical-six-inch-to-one-mile-county-series-edition-${ed}-${ed === 1 ? '1829-1835' : '1838-1862'}-${county}`;

const entries = [
    {
        id: 'osni-sixinch-edition-1',
        name: 'OSNI Historical Six-Inch Maps — Edition 1 (1829–1835)',
        slug: 'osni-sixinch-edition-1',
        category: catId,
        provider: ['OSNI', 'Ordnance Survey'],
        description: 'The original Six-Inch-to-One-Mile County Series — the first complete topographic survey of Ireland, produced 1829–1835 by the Ordnance Survey. 308 historical map sheets covering all six Northern Ireland counties (Antrim, Armagh, Derry/Londonderry, Down, Fermanagh, Tyrone), engraved at a scale where every individual building, road, field boundary, and town feature is shown. Mosaicked and re-tiled here at 4 m/pixel for interactive viewing on the catalogue map. For pixel-level detail, download the original sheet TIFs from the per-county packages linked below.',
        files: { xyz: `${BASE}/sixinch-edition-1/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.9, minZoom: 5, maxZoom: 18, maxNativeZoom: 14 },
        bounds: SIXINCH_BOUNDS,
        keywords: ['osni', 'six inch', '6 inch', 'historical', '1829', '1835', 'edition 1', 'first edition', 'topographic', 'ordnance survey'],
        date: 1832,
        dateEffective: '1832-01-01',
        references: ed1Counties.map(c => ({
            label: `OSNI Open Data — Six-Inch Edition 1 (1829–1835) — ${c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())}`,
            url: pkgUrl(1, c),
            note: ''
        })),
        sourceDownloads: ed1Counties.map(c => ({
            label: `${c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())} sheets (full-res JPEG/TIF, ZIP)`,
            file: pkgUrl(1, c)
        }))
    },
    {
        id: 'osni-sixinch-edition-2',
        name: 'OSNI Historical Six-Inch Maps — Edition 2 (1838–1862)',
        slug: 'osni-sixinch-edition-2',
        category: catId,
        provider: ['OSNI', 'Ordnance Survey'],
        description: 'Second edition of the Six-Inch-to-One-Mile County Series, surveyed 1838–1862, providing the first comprehensive update to the original 1830s survey. 261 historical sheets covering all six Northern Ireland counties. Captures the rapid changes in Irish landscape, settlement patterns, and infrastructure during the mid-19th century — including the period before, during, and immediately after the Great Famine (1845–1852). Mosaicked and re-tiled here at 4 m/pixel.',
        files: { xyz: `${BASE}/sixinch-edition-2/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.9, minZoom: 5, maxZoom: 18, maxNativeZoom: 14 },
        bounds: SIXINCH_BOUNDS,
        keywords: ['osni', 'six inch', '6 inch', 'historical', '1838', '1862', 'edition 2', 'second edition', 'topographic', 'ordnance survey', 'famine'],
        date: 1850,
        dateEffective: '1850-01-01',
        references: ed2Counties.map(c => ({
            label: `OSNI Open Data — Six-Inch Edition 2 (1838–1862) — ${c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())}`,
            url: pkgUrl(2, c),
            note: ''
        })),
        sourceDownloads: ed2Counties.map(c => ({
            label: `${c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())} sheets (full-res JPEG/TIF, ZIP)`,
            file: pkgUrl(2, c)
        }))
    }
];

const existingIds = new Set(db.maps.map(m => m.id));
let added = 0;
for (const e of entries) {
    if (existingIds.has(e.id)) { console.log(`  (skip) ${e.id}`); continue; }
    db.maps.push(e);
    added++;
    console.log(`+ added ${e.id}`);
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\n${added} entries appended. Total maps: ${db.maps.length}`);
