// Fill in Phase 1 gaps: 7 additional spatial Tellus layers + backfill
// sourceDownloads on existing Phase-1 cards with their missing CSVs,
// PDFs, and alternate-format ZIPs.
import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));
const catId = 'geology-geophysics';
const BASE = 'https://data.civgraph.net/data/maps/geology';

// --- 1. New catalogue entries for previously-omitted spatial layers ---

const newEntries = [
    {
        id: 'gsni-tellus-stream-sediments-xrf-set2',
        name: 'Tellus Stream Sediments (Regional XRF — Set 2)',
        slug: 'gsni-tellus-stream-sediments-xrf-set2',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Second set of regional stream-sediment samples (Tellus survey), analysed by XRF for an additional suite of major and trace elements beyond the Set 1 panel. ~5,870 points.',
        files: { fgb: `${BASE}/tellus-stream-sediments-xrf-set2.fgb` },
        style: { color: '#6e4fa8', weight: 1, radius: 4, fillOpacity: 0.7 },
        labelProperty: 'SAMPLE_NO',
        keywords: ['tellus', 'geochemistry', 'stream', 'sediment', 'xrf', 'set2', 'gsni'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Regional Stream Sediments — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-stream-sediments', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — XRF Set 2', file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/acf0cf00-85c0-41fd-b974-67e7f67c03ad/download/regionalsedimentsxrfset2.geojson' },
            { label: 'CSV — XRF Set 2',      file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/de28b76a-42cf-4b0c-b302-225ade45edf0/download/regionalsedimentsxrfset2.csv' }
        ]
    },
    {
        id: 'gsni-tellus-stream-sediments-au-pge',
        name: 'Tellus Stream Sediments (Gold and Platinum Group Elements)',
        slug: 'gsni-tellus-stream-sediments-au-pge',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Tellus stream-sediment samples assayed specifically for gold (Au) and platinum group elements (PGE — Pt, Pd, Rh, Ru, Os, Ir). ~5,690 sample points.',
        files: { fgb: `${BASE}/tellus-stream-sediments-au-pge.fgb` },
        style: { color: '#daa520', weight: 1, radius: 4, fillOpacity: 0.75 },
        labelProperty: 'SAMPLE_NO',
        keywords: ['tellus', 'gold', 'platinum', 'pge', 'stream', 'sediment', 'gsni', 'prospecting'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Regional Stream Sediments — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-stream-sediments', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — Au and PGE', file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/aefd285a-143e-42a5-80e5-b8c0f0a5c7d0/download/regionalsedimentsxrfauandpge.geojson' },
            { label: 'CSV — Au and PGE',      file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/bc7a7099-8c3c-42ab-af49-6f9f55485e19/download/regionalsedimentsxrfauandpge.csv' }
        ]
    },
    {
        id: 'gsni-tellus-stream-sediments-boron',
        name: 'Tellus Stream Sediments (Boron)',
        slug: 'gsni-tellus-stream-sediments-boron',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Tellus stream-sediment samples specifically analysed for boron, which requires a separate analytical method from the main XRF panel. ~5,840 points.',
        files: { fgb: `${BASE}/tellus-stream-sediments-boron.fgb` },
        style: { color: '#48a148', weight: 1, radius: 4, fillOpacity: 0.75 },
        labelProperty: 'SAMPLE_NO',
        keywords: ['tellus', 'boron', 'stream', 'sediment', 'gsni', 'geochemistry'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Regional Stream Sediments — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-stream-sediments', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — Boron', file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/2a93e611-0888-415c-ad1f-02d0ae2eb669/download/regionalsedimentsxrfboron.geojson' },
            { label: 'CSV — Boron',      file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/f0f51e58-0544-43fd-a2fb-ac58b7f3781f/download/regionalsedimentsxrfboron.csv' }
        ]
    },
    {
        id: 'gsni-tellus-rural-soil-a-aqua-regia',
        name: 'Tellus Rural Soil (A Horizon — Aqua Regia Digest)',
        slug: 'gsni-tellus-rural-soil-a-aqua-regia',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'A-horizon (topsoil) samples from the Tellus rural soil survey digested with aqua regia and analysed for the trace/heavy metal elements that resist XRF. Complements the A-horizon XRF layer. ~6,870 points.',
        files: { fgb: `${BASE}/tellus-rural-soil-a-aqua-regia.fgb` },
        style: { color: '#c9723a', weight: 1, radius: 4, fillOpacity: 0.75 },
        labelProperty: 'Sample',
        keywords: ['tellus', 'soil', 'a horizon', 'topsoil', 'aqua regia', 'digest', 'gsni', 'agriculture'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Rural Soil Survey — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/rural-soil-survey', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — A Soils Aqua Regia', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/28fa598c-18c2-4c39-b077-bf884953d00b/download/regional-soils-a-aquaregia-hdl.geojson' },
            { label: 'CSV — A Soils Aqua Regia',      file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/8ce52d8f-9b4f-4df6-b276-27e724164549/download/regionalsoilsaaquaregiahdl.csv' }
        ]
    },
    {
        id: 'gsni-tellus-rural-soil-s-aqua-regia',
        name: 'Tellus Rural Soil (S Horizon — Aqua Regia Digest)',
        slug: 'gsni-tellus-rural-soil-s-aqua-regia',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'S-horizon (subsoil) samples from the Tellus rural soil survey, aqua regia digest. The deeper soil samples — useful for distinguishing surface anthropogenic contamination from underlying geology. ~6,870 points.',
        files: { fgb: `${BASE}/tellus-rural-soil-s-aqua-regia.fgb` },
        style: { color: '#a55e2e', weight: 1, radius: 4, fillOpacity: 0.75 },
        labelProperty: 'Sample',
        keywords: ['tellus', 'soil', 's horizon', 'subsoil', 'aqua regia', 'digest', 'gsni'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Rural Soil Survey — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/rural-soil-survey', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — S Soils Aqua Regia', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/e7b13c9c-a159-4d26-b529-6ff3c5611fd7/download/regional-soils-s-aquaregia-hdl.geojson' },
            { label: 'CSV — S Soils Aqua Regia',      file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/00961fff-d94d-452a-8654-9ddb998b717d/download/regionalsoilssaquaregiahdl.csv' }
        ]
    },
    {
        id: 'gsni-tellus-rural-soil-s-near-total',
        name: 'Tellus Rural Soil (S Horizon — Near-Total Digest)',
        slug: 'gsni-tellus-rural-soil-s-near-total',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'S-horizon (subsoil) samples digested with HF-HClO4-HNO3 ("near total") and analysed by ICP-MS — a more aggressive extraction than aqua regia, recovering more of the silicate-bound element pool. ~6,870 points.',
        files: { fgb: `${BASE}/tellus-rural-soil-s-near-total.fgb` },
        style: { color: '#7e4720', weight: 1, radius: 4, fillOpacity: 0.75 },
        labelProperty: 'Sample',
        keywords: ['tellus', 'soil', 's horizon', 'subsoil', 'near total', 'digest', 'icp-ms', 'gsni'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Rural Soil Survey — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/rural-soil-survey', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — S Soils Near-Total Digest', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/7bf16f02-1855-410a-8277-edaabd8c5e40/download/regional-soils-s-neartotal-hdl.geojson' },
            { label: 'CSV — S Soils Near-Total Digest',      file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/577d757b-c953-469f-b3b3-0ea44bd3bb6b/download/regional_-neartotal_s_hdl.csv' }
        ]
    },
    {
        id: 'gsni-tellus-rural-soil-s-fire-assay',
        name: 'Tellus Rural Soil (S Horizon — Fire Assay for Au and PGE)',
        slug: 'gsni-tellus-rural-soil-s-fire-assay',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'S-horizon subsoil samples subjected to fire assay specifically to recover gold (Au) and platinum group elements. The classical mineral-prospecting technique applied across the Tellus survey grid. ~6,850 points.',
        files: { fgb: `${BASE}/tellus-rural-soil-s-fire-assay.fgb` },
        style: { color: '#bfa028', weight: 1, radius: 4, fillOpacity: 0.75 },
        labelProperty: 'Sample',
        keywords: ['tellus', 'soil', 'fire assay', 'gold', 'platinum', 'pge', 'prospecting', 'gsni'],
        useLOD: true,
        references: [{ label: 'GSNI Tellus Rural Soil Survey — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/rural-soil-survey', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON — S Soils Fire Assay', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/a868ea07-643a-4481-b473-32a48f56ead0/download/regional-soils-s-fireassay-au-pge.geojson' },
            { label: 'CSV — S Soils Fire Assay',      file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/e9a4568a-677d-419a-a2ce-31940900bbe9/download/regionalsoilssfireassayaupge.csv' }
        ]
    }
];

// --- 2. Backfill sourceDownloads on existing Phase-1 cards ---

const backfill = {
    'gsni-mineral-resources': [
        { label: 'ESRI Shapefile (ZIP, 20 MB)', file: 'https://admin.opendatani.gov.uk/dataset/a47e1630-086f-4b92-9416-1197cc8c633a/resource/87be45a3-52b7-4724-8d62-859a5d4946e4/download/mineralresources.shp.zip' },
        { label: 'JSON per-mineral (ZIP, 22 MB)', file: 'https://admin.opendatani.gov.uk/dataset/a47e1630-086f-4b92-9416-1197cc8c633a/resource/d9e9d0ba-3072-4efc-ba4c-6ff26fad1c22/download/mineralresourcesjson.zip' }
    ],
    'gsni-tellus-stream-sediments-xrf': [
        { label: 'CSV — XRF Set 1', file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/9f4e090e-4afe-44f0-8bb5-1a70926920bd/download/regionalsedimentsxrfset1.csv' },
        { label: 'Methodology and Detection Limits (PDF)', file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/46916fde-077a-4043-a6fb-09820aab675a/download/tellusmethodologyanddetectionlimits.pdf' }
    ],
    'gsni-tellus-stream-waters-icp': [
        { label: 'CSV — ICP', file: 'https://admin.opendatani.gov.uk/dataset/c4c559be-77db-4d3b-9b6a-ecc24feb3e21/resource/96ec94aa-0257-4fd4-b5f5-20b86a7d5a69/download/regionalwatersicp.csv' },
        { label: 'Methodology and Detection Limits (PDF)', file: 'https://admin.opendatani.gov.uk/dataset/c4c559be-77db-4d3b-9b6a-ecc24feb3e21/resource/96871e7f-3f5b-4f27-8d8e-192fe0f6919f/download/tellusmethodologyanddetectionlimits.pdf' }
    ],
    'gsni-tellus-rural-soil-a-xrf': [
        { label: 'CSV — A Soils XRF', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/1c35fb41-1c4e-4c33-956e-3b2e7850ee93/download/regionalsoilsaxrf.csv' },
        { label: 'Methodology and Detection Limits (PDF)', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/330e2a8f-db4e-42ec-9a66-145a5eb07c93/download/tellusmethodologyanddetectionlimits.pdf' }
    ],
    'gsni-core-cuttings-register': [
        { label: 'References (TXT)', file: 'https://admin.opendatani.gov.uk/dataset/06884c94-fcb1-4d7d-a258-bbde98388ff1/resource/622208ff-bac7-4fc0-a288-82039c5b6fa5/download/references.txt' }
    ]
};

// Also add BGS PDF maps reference to Mineral Resources
const addReference = {
    'gsni-mineral-resources': [
        { label: 'PDF versions of NI Mineral Maps (British Geological Survey)', url: 'https://www.bgs.ac.uk/mineralsuk/planning/resource.html#NI', note: 'External BGS index page listing PDF mineral resource maps for Northern Ireland.' }
    ]
};

// --- Apply ---
const existingIds = new Set(db.maps.map(m => m.id));
let addedNew = 0;
for (const e of newEntries) {
    if (existingIds.has(e.id)) { console.log(`  (skip) ${e.id}`); continue; }
    db.maps.push(e); addedNew++;
    console.log(`+ added ${e.id}`);
}

let backfilled = 0;
for (const [id, extras] of Object.entries(backfill)) {
    const m = db.maps.find(mm => mm.id === id);
    if (!m) { console.log(`  (miss) backfill target ${id} not found`); continue; }
    m.sourceDownloads ||= [];
    const existing = new Set(m.sourceDownloads.map(s => s.file));
    for (const s of extras) {
        if (!existing.has(s.file)) { m.sourceDownloads.push(s); backfilled++; }
    }
    console.log(`  ↳ backfilled ${extras.length} downloads into ${id}`);
}

for (const [id, refs] of Object.entries(addReference)) {
    const m = db.maps.find(mm => mm.id === id);
    if (!m) continue;
    m.references ||= [];
    const existing = new Set(m.references.map(r => r.url));
    for (const r of refs) {
        if (!existing.has(r.url)) m.references.push(r);
    }
    console.log(`  ↳ added ${refs.length} reference(s) to ${id}`);
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\n${addedNew} new maps, ${backfilled} new download links. Total maps: ${db.maps.length}`);
