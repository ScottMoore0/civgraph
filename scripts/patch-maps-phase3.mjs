import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const catId = 'osni-raster';
if (!db.categories.some(c => c.id === catId)) {
    db.categories.push({
        id: catId,
        name: 'OSNI Raster Maps',
        description: 'Pre-rendered raster overlays from the Ordnance Survey of Northern Ireland — small-scale thematic prints, the bilingual Éire Thuaidh, the 1:10,000 mid-scale topographic mosaic, and printed StreetMaps for towns across NI.'
    });
    console.log(`+ added category ${catId}`);
}

const BASE = 'https://data.civgraph.net/data/maps/osni-raster';

// All 1:1M source images cover roughly the same extent.
const ONE_MILLION_BOUNDS = [[54.00, -8.87], [55.45, -5.41]];

const entries = [
    {
        id: 'osni-eire-thuaidh',
        name: 'OSNI Éire Thuaidh — Irish-Translated Map',
        slug: 'osni-eire-thuaidh',
        category: catId,
        provider: ['OSNI'],
        description: 'Bilingual map of Northern Ireland with place-names rendered in Irish (Gaeilge) alongside their English forms. Cropped raster cartography in Irish Grid TM65, served as XYZ tiles at zoom 6–12.',
        files: { xyz: `${BASE}/eire-thuaidh/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 12 },
        bounds: [[53.97, -8.91], [55.46, -5.32]],
        keywords: ['osni', 'eire thuaidh', 'irish', 'gaeilge', 'bilingual', 'placenames', 'place names'],
        references: [
            { label: 'OSNI Open Data — Éire Thuaidh', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-eire-thuaidh-irish-translated-map', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced raster (TIF, ZIP)',    file: 'https://admin.opendatani.gov.uk/dataset/3ec0145e-911e-4a66-859a-3bab141270b9/resource/d2c0d511-3f14-4a88-825b-a112e29b85b5/download/osni_opendata_eirethuaidh.zip' },
            { label: 'Un-georeferenced raster (ZIP)',      file: 'https://admin.opendatani.gov.uk/dataset/3ec0145e-911e-4a66-859a-3bab141270b9/resource/f953185e-5f9b-4e42-8b54-56c5e85eb060/download/osni_opendata_eirethuaidh.zip' }
        ]
    },
    {
        id: 'osni-mid-scale-raster',
        name: 'OSNI Mid-Scale Raster — 1:10,000',
        slug: 'osni-mid-scale-raster',
        category: catId,
        provider: ['OSNI'],
        description: 'Topographic raster cartography at 1:10,000 scale across all of Northern Ireland — a 292-sheet mosaic of OSNI base-map tiles. Useful background context for site-level work; shows roads, settlements, contours and named features. Served as XYZ tiles at zoom 8–15.',
        files: { xyz: `${BASE}/mid-scale-raster/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 15 },
        bounds: [[53.95, -8.19], [55.33, -5.40]],
        keywords: ['osni', 'raster', 'topographic', '1:10000', '10k', 'mid scale', 'base map'],
        references: [
            { label: 'OSNI Open Data — Mid Scale Raster', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-1-10-000-raster-mid-scale-raster', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced sheets (TIF + TFW, ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/48376012-8061-4369-8cf5-24961f2f02c6/resource/27c90279-f13d-4216-9349-23b7dceb3082/download/osni_opendata_midscaleraster.zip' }
        ]
    },
    {
        id: 'osni-streetmaps',
        name: 'OSNI StreetMaps — Town Sheets',
        slug: 'osni-streetmaps',
        category: catId,
        provider: ['OSNI'],
        description: 'Detailed printed street-map sheets for 109 towns and villages across Northern Ireland — 0.85 m/pixel native resolution showing individual streets, building outlines, and town features. Coverage is sparse (only published towns are mapped); the rest of NI is blank in this layer. Served as XYZ tiles at zoom 8–16.',
        files: { xyz: `${BASE}/streetmaps/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.9, minZoom: 8, maxZoom: 19, maxNativeZoom: 16 },
        bounds: [[54.04, -7.68], [55.23, -5.45]],
        keywords: ['osni', 'streetmap', 'street map', 'town', 'village', 'urban', 'streets'],
        references: [
            { label: 'OSNI Open Data — StreetMaps', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-streetmaps', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced town sheets (TIF + TFW, ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/33f1a92f-8abf-4eed-b944-b816043c58a4/resource/fb6ea3cf-8ea0-4c3f-b3a7-a2bf74e8d47b/download/osni_opendata_streetmaps.zip' }
        ]
    },
    {
        id: 'osni-1m-county-boundaries',
        name: 'OSNI 1:1M Thematic — County Boundaries',
        slug: 'osni-1m-county-boundaries',
        category: catId,
        provider: ['OSNI'],
        description: 'Small-scale (1:1,000,000) printed thematic map of Northern Ireland showing the historic six-county boundaries against a base outline. Designed as a wall-poster reference — re-tiled here as an interactive overlay at zoom 6–11.',
        files: { xyz: `${BASE}/1m-county-boundaries/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.8, minZoom: 4, maxZoom: 14, maxNativeZoom: 11 },
        bounds: ONE_MILLION_BOUNDS,
        keywords: ['osni', '1:1m', '1 million', 'thematic', 'counties', 'county boundaries'],
        references: [
            { label: 'OSNI Open Data — 1:1M County Boundaries', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-1-1million-raster-parliamentary-boundaries', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced JPEG (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/702a7cbc-c90e-4f1c-b777-e7557fb66572/resource/ffa0548e-91d4-4a48-8add-4833482a57a2/download/osniopendata_1million_countyboundaries.zip' }
        ]
    },
    {
        id: 'osni-1m-infrastructure',
        name: 'OSNI 1:1M Thematic — Infrastructure',
        slug: 'osni-1m-infrastructure',
        category: catId,
        provider: ['OSNI'],
        description: 'Small-scale (1:1,000,000) thematic map showing major roads, railways, ports, airports, and other transport infrastructure across Northern Ireland. Re-tiled as an interactive overlay at zoom 6–11.',
        files: { xyz: `${BASE}/1m-infrastructure/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.8, minZoom: 4, maxZoom: 14, maxNativeZoom: 11 },
        bounds: ONE_MILLION_BOUNDS,
        keywords: ['osni', '1:1m', '1 million', 'thematic', 'infrastructure', 'transport', 'roads', 'railways', 'airports'],
        references: [
            { label: 'OSNI Open Data — 1:1M Infrastructure', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-1-1million-raster-infrastructure', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced JPEG (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/90ba805a-e9c8-417d-b360-7a4fb87c348c/resource/59cc270a-18bb-4808-bd6a-ce2d8d1525be/download/osniopendata_1million_infrastructure.zip' }
        ]
    },
    {
        id: 'osni-1m-locations',
        name: 'OSNI 1:1M Thematic — Locations',
        slug: 'osni-1m-locations',
        category: catId,
        provider: ['OSNI'],
        description: 'Small-scale (1:1,000,000) thematic map labelling major settlements and locations across Northern Ireland. Re-tiled as an interactive overlay at zoom 6–11.',
        files: { xyz: `${BASE}/1m-locations/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.8, minZoom: 4, maxZoom: 14, maxNativeZoom: 11 },
        bounds: ONE_MILLION_BOUNDS,
        keywords: ['osni', '1:1m', '1 million', 'thematic', 'locations', 'settlements', 'placenames'],
        references: [
            { label: 'OSNI Open Data — 1:1M Locations', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-1-1million-raster-location', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced JPEG (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/8a435c6c-fb4c-465b-aba1-4f71438d9eeb/resource/cc266db3-dcc9-4b6d-8458-ff954ce0f5b9/download/osniopendata_1million_locations.zip' }
        ]
    },
    {
        id: 'osni-1m-natural-environment',
        name: 'OSNI 1:1M Thematic — Natural Environment',
        slug: 'osni-1m-natural-environment',
        category: catId,
        provider: ['OSNI'],
        description: 'Small-scale (1:1,000,000) thematic map of Northern Ireland’s natural environment — drainage, lakes, mountains, and broad land cover. Re-tiled as an interactive overlay at zoom 6–11.',
        files: { xyz: `${BASE}/1m-natural-environment/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.8, minZoom: 4, maxZoom: 14, maxNativeZoom: 11 },
        bounds: ONE_MILLION_BOUNDS,
        keywords: ['osni', '1:1m', '1 million', 'thematic', 'natural environment', 'rivers', 'lakes', 'mountains'],
        references: [
            { label: 'OSNI Open Data — 1:1M Natural Environment', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-1-1million-raster-natural-environment', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced JPEG', file: 'https://admin.opendatani.gov.uk/dataset/c7aacf24-b53d-47bf-b394-7a1adabb4bdc/resource/d9b365af-506c-46c4-b2eb-72e8955fae63/download/osniopendata_1million_naturalenvironment.zip' }
        ]
    },
    {
        id: 'osni-1m-parliamentary',
        name: 'OSNI 1:1M Thematic — Parliamentary Boundaries',
        slug: 'osni-1m-parliamentary',
        category: catId,
        provider: ['OSNI'],
        description: 'Small-scale (1:1,000,000) thematic map showing Northern Ireland’s Westminster parliamentary constituency boundaries. Re-tiled as an interactive overlay at zoom 6–11.',
        files: { xyz: `${BASE}/1m-parliamentary/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.8, minZoom: 4, maxZoom: 14, maxNativeZoom: 11 },
        bounds: ONE_MILLION_BOUNDS,
        keywords: ['osni', '1:1m', '1 million', 'thematic', 'parliamentary', 'constituencies', 'westminster'],
        references: [
            { label: 'OSNI Open Data — 1:1M Parliamentary', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-1-1million-raster-parliamentary-boundaries', note: '' }
        ],
        sourceDownloads: [
            { label: 'Georeferenced JPEG (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/064c9b69-16d0-47d0-b418-ef065289f669/resource/ee78bcca-cd51-4a3e-ad73-9ebbc86c66bc/download/osniopendata_1million_parliamentary.zip' }
        ]
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
