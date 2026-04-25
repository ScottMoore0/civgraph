// Patch data/database/maps.json to add Phase 1 GSNI geology/geophysics entries.
// Idempotent — re-running only adds entries not already present (by id).
import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

// --- 1. Add new category if missing ---
const catId = 'geology-geophysics';
if (!db.categories.some(c => c.id === catId)) {
    db.categories.push({
        id: catId,
        name: 'Geology and Geophysics',
        description: 'Bedrock and superficial geology, mineral resources, and airborne geophysics surveys of Northern Ireland.'
    });
    console.log(`+ added category ${catId}`);
}

const BASE = 'https://data.civgraph.net/data/maps/geology';

const entries = [
    {
        id: 'gsni-bedrock-geology-polygons-250k',
        name: 'Bedrock Geology 1:250,000 (Polygons)',
        slug: 'gsni-bedrock-geology-polygons-250k',
        category: catId,
        provider: ['GSNI', 'British Geological Survey'],
        description: 'Solid bedrock geology of Northern Ireland at 1:250,000 scale — polygon fills coloured by rock classification (LEX/RCS).',
        files: { fgb: `${BASE}/bedrock-geology-polygons.fgb` },
        style: { color: '#8B4513', weight: 1, fillOpacity: 0.35 },
        labelProperty: 'LEX_D',
        keywords: ['geology', 'bedrock', 'rock', 'gsni', 'tellus', 'formation', 'lithology'],
        useLOD: true,
        references: [
            { label: 'GSNI 250K Geology — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON (original)',  file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/d85d4090-77b1-4807-a551-b2849aeb2eaf/download/ni250kbedrockgeologypolygons.geojson' },
            { label: 'GeoPackage',           file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/07b32481-a218-4591-b245-bea5543a060f/download/ni_250k_bedrock_geology_polygons.gpkg' },
            { label: 'ESRI Shapefile (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/3a545feb-6a56-495b-8aa9-8117200e8c81/download/ni250kbedrockgeologypolygons.zip' },
            { label: 'QGIS / ArcGIS style files (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/bb4577fc-f554-42af-8d21-f0592ab7c38f/download/qgis-arcgisstyles.zip' }
        ]
    },
    {
        id: 'gsni-bedrock-geology-lines-250k',
        name: 'Bedrock Geology 1:250,000 (Lines)',
        slug: 'gsni-bedrock-geology-lines-250k',
        category: catId,
        provider: ['GSNI', 'British Geological Survey'],
        description: 'Faults, bedrock boundaries, fold axial traces, dykes and bedrock lineaments across Northern Ireland at 1:250,000 scale.',
        files: { fgb: `${BASE}/bedrock-geology-lines.fgb` },
        style: { color: '#5a2d0c', weight: 1, fillOpacity: 0 },
        labelProperty: 'FEATURE_D',
        keywords: ['geology', 'fault', 'fracture', 'fold', 'bedrock', 'dyke', 'gsni', 'lineament'],
        useLOD: true,
        references: [
            { label: 'GSNI 250K Geology — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON (original)',  file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/a1ea4f61-bfff-4ef1-98f7-84552f7c1911/download/ni250kbedrockgeologylines.geojson' },
            { label: 'GeoPackage',           file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/9380def2-3529-4d09-9eec-2d1f57241aa9/download/ni_250k_bedrock_geology_lines.gpkg' },
            { label: 'ESRI Shapefile (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/fa614ca9-4833-4381-988e-92103b0b3ce5/download/ni250kbedrockgeologylines.zip' }
        ]
    },
    {
        id: 'gsni-superficial-geology-polygons-250k',
        name: 'Superficial Geology 1:250,000',
        slug: 'gsni-superficial-geology-polygons-250k',
        category: catId,
        provider: ['GSNI', 'British Geological Survey'],
        description: 'Superficial (Quaternary) deposits — glacial till, alluvium, peat, raised beach and other surface materials — mapped at 1:250,000 scale.',
        files: { fgb: `${BASE}/superficial-geology-polygons.fgb` },
        style: { color: '#6b8e23', weight: 1, fillOpacity: 0.35 },
        labelProperty: 'LEX_D',
        keywords: ['geology', 'superficial', 'quaternary', 'till', 'alluvium', 'peat', 'drift', 'gsni'],
        useLOD: true,
        references: [
            { label: 'GSNI 250K Geology — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON (original)',  file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/19b4e12e-0e00-4091-8419-0c744d72cb96/download/ni250ksuperficialgeologypolygons.geojson' },
            { label: 'GeoPackage',           file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/e490914d-9e13-4cc9-915b-3cac75643a95/download/ni_250k_superficial_geology_polygons.gpkg' },
            { label: 'ESRI Shapefile (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/7c00c1f5-6cd3-405d-b79e-61c19c4990b9/resource/32306dee-1748-4d68-b465-acfd1e5ae344/download/ni250ksuperficialgeologypolygons.zip' }
        ]
    },
    {
        id: 'gsni-mineral-resources',
        name: 'Mineral Resources (Northern Ireland)',
        slug: 'gsni-mineral-resources',
        category: catId,
        provider: ['GSNI'],
        description: 'Mapped surface extent of commercially significant mineral resources — coal, lignite, sand and gravel, limestone, sandstone, peat, clay, igneous rock and others — merged into one layer attributed by mineral_type.',
        files: { fgb: `${BASE}/gsni-mineral-resources.fgb` },
        style: { color: '#b8860b', weight: 1, fillOpacity: 0.4 },
        labelProperty: 'mineral_type',
        keywords: ['mineral', 'coal', 'lignite', 'limestone', 'sand', 'gravel', 'peat', 'resource', 'gsni', 'extraction', 'quarry'],
        useLOD: true,
        references: [
            { label: 'GSNI Northern Ireland Mineral Resources — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/gsni-northern-ireland-mineral-resources', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoPackage (ZIP, 21 MB)', file: 'https://admin.opendatani.gov.uk/dataset/a47e1630-086f-4b92-9416-1197cc8c633a/resource/fcc4d397-b585-4659-82af-3e484040d294/download/mineralresourcesgeopackage.zip' }
        ]
    },
    {
        id: 'gsni-tellus-stream-sediments-xrf',
        name: 'Tellus Stream Sediments (Regional XRF)',
        slug: 'gsni-tellus-stream-sediments-xrf',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Regional stream-sediment samples collected under the Tellus survey, analysed by XRF for major and trace elements. Approximately 5,800 sample points across Northern Ireland.',
        files: { fgb: `${BASE}/tellus-stream-sediments-xrf-set1.fgb` },
        style: { color: '#8860c6', weight: 1, radius: 4, fillOpacity: 0.7 },
        labelProperty: 'SAMPLE_NO',
        keywords: ['tellus', 'geochemistry', 'stream', 'sediment', 'xrf', 'sampling', 'gsni'],
        useLOD: true,
        references: [
            { label: 'GSNI Tellus Regional Stream Sediments — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-stream-sediments', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON — XRF Set 1 (original)', file: 'https://admin.opendatani.gov.uk/dataset/b278a287-0165-4b0d-ac06-f5356590355e/resource/2a789ce2-45e6-4dff-a739-c3e7763a6ad7/download/regionalsedimentsxrfset1.geojson' }
        ]
    },
    {
        id: 'gsni-tellus-stream-waters-icp',
        name: 'Tellus Stream Waters (Regional ICP)',
        slug: 'gsni-tellus-stream-waters-icp',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Regional stream-water samples collected under the Tellus survey, analysed by ICP-MS for dissolved elements. Approximately 5,900 sample points.',
        files: { fgb: `${BASE}/tellus-stream-waters-icp.fgb` },
        style: { color: '#2a8ec6', weight: 1, radius: 4, fillOpacity: 0.7 },
        labelProperty: 'SAMPLENO',
        keywords: ['tellus', 'geochemistry', 'stream', 'water', 'icp', 'dissolved', 'gsni'],
        useLOD: true,
        references: [
            { label: 'GSNI Tellus Regional Stream Waters — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-stream-waters-icp', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON — ICP (original)', file: 'https://admin.opendatani.gov.uk/dataset/c4c559be-77db-4d3b-9b6a-ecc24feb3e21/resource/648a10b6-fd24-43d1-b2de-e659af7d7a9b/download/regionalwatersicp.geojson' }
        ]
    },
    {
        id: 'gsni-tellus-rural-soil-a-xrf',
        name: 'Tellus Rural Soil Survey (A Soils, XRF)',
        slug: 'gsni-tellus-rural-soil-a-xrf',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Topsoil ("A horizon") samples collected on a 2 km grid across rural Northern Ireland under the Tellus survey and analysed by XRF. Approximately 6,860 points.',
        files: { fgb: `${BASE}/tellus-rural-soil-a-xrf.fgb` },
        style: { color: '#b8783a', weight: 1, radius: 4, fillOpacity: 0.7 },
        labelProperty: 'Sample',
        keywords: ['tellus', 'soil', 'xrf', 'topsoil', 'agriculture', 'geochemistry', 'gsni'],
        useLOD: true,
        references: [
            { label: 'GSNI Tellus Rural Soil Survey — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/rural-soil-survey', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON — A Soils XRF (original)', file: 'https://admin.opendatani.gov.uk/dataset/dc01f414-21e2-409c-8a8b-d34a67187ddd/resource/0865438f-7191-4932-8b00-3bbd5d58a819/download/regional-soils-a-xrf.geojson' }
        ]
    },
    {
        id: 'gsni-core-cuttings-register',
        name: 'GSNI Core and Cuttings Register',
        slug: 'gsni-core-cuttings-register',
        category: catId,
        provider: ['GSNI'],
        description: 'Registered borehole cores and cuttings held by the Geological Survey of Northern Ireland. Only records with geographic coordinates are shown on the map (~140 of ~345).',
        files: { fgb: `${BASE}/gsni-core-cuttings.fgb` },
        style: { color: '#4a4a4a', weight: 1, radius: 4, fillOpacity: 0.8 },
        labelProperty: 'Borehole or Locality Name',
        keywords: ['borehole', 'core', 'cuttings', 'gsni', 'drilling', 'stratigraphy'],
        useLOD: false,
        references: [
            { label: 'Spreadsheet of Core and Cuttings held by GSNI — Open Data NI', url: 'https://admin.opendatani.gov.uk/dataset/spreadsheet-of-core-and-cuttings-held-by-gsni', note: '' }
        ],
        sourceDownloads: [
            { label: 'CSV (original, November 2018)', file: 'https://admin.opendatani.gov.uk/dataset/06884c94-fcb1-4d7d-a258-bbde98388ff1/resource/2160c85d-adee-482e-89fd-703bcf450779/download/november-2018-gsni-core-and-cuttings.csv' }
        ]
    }
];

// --- 2. Append missing entries ---
const existingIds = new Set(db.maps.map(m => m.id));
let added = 0;
for (const e of entries) {
    if (existingIds.has(e.id)) {
        console.log(`  (skip) ${e.id} — already present`);
        continue;
    }
    db.maps.push(e);
    added++;
    console.log(`+ added ${e.id}`);
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\n${added} entries appended. Total maps: ${db.maps.length}`);
