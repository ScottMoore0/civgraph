import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const catId = 'osni-reference';
if (!db.categories.some(c => c.id === catId)) {
    db.categories.push({
        id: catId,
        name: 'OSNI Reference Layers',
        description: 'Survey and reference utilities from the Ordnance Survey of Northern Ireland — map-sheet coverage grids and height benchmarks.'
    });
    console.log(`+ added category ${catId}`);
}

const BASE = 'https://data.civgraph.net/data/maps/osni-reference';

const entries = [
    {
        id: 'osni-coverage-grid-10k',
        name: 'OSNI Map Sheet Coverage Grid — 1:10,000',
        slug: 'osni-coverage-grid-10k',
        category: catId,
        provider: ['OSNI'],
        description: 'Polygonal overlay of Ordnance Survey of Northern Ireland 1:10,000-scale printed-map tile footprints, labelled by sheet name. Useful for locating which historic / current OSNI sheet covers a site.',
        files: { fgb: `${BASE}/coverage-grid-10k.fgb` },
        style: { color: '#888888', weight: 1, fillOpacity: 0 },
        labelProperty: 'NAME',
        keywords: ['osni', 'coverage', 'grid', 'sheet', 'index', '1:10000', '10k', 'tile'],
        useLOD: true,
        references: [
            { label: 'OSNI Open Data - Coverage Grid - 10K', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-coverage-grid-10k', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON',              file: 'https://admin.opendatani.gov.uk/dataset/18a0c1f3-0e2a-406f-9d5f-ce190a166895/resource/3400824a-ae20-483d-b633-a936d8f45f8b/download/osni_open_data_coverage_grid_10k.geojson' },
            { label: 'ESRI Shapefile (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/18a0c1f3-0e2a-406f-9d5f-ce190a166895/resource/6fdf1a41-1f4a-4905-88f5-57c06a7cd5fb/download/osni_open_data_coverage_grid_10k.zip' },
            { label: 'KML',                  file: 'https://admin.opendatani.gov.uk/dataset/18a0c1f3-0e2a-406f-9d5f-ce190a166895/resource/19fa57b5-5f62-4e0a-a40b-5f6fc3485f6f/download/osni_open_data_coverage_grid_10k.kml' },
            { label: 'CSV',                  file: 'https://admin.opendatani.gov.uk/dataset/18a0c1f3-0e2a-406f-9d5f-ce190a166895/resource/cdfe704d-8281-400c-a06d-d50f9fe43fc3/download/osni_open_data_coverage_grid_10k.csv' }
        ]
    },
    {
        id: 'osni-coverage-grid-50k',
        name: 'OSNI Map Sheet Coverage Grid — 1:50,000',
        slug: 'osni-coverage-grid-50k',
        category: catId,
        provider: ['OSNI'],
        description: 'Polygonal overlay of OSNI 1:50,000-scale printed-map tile footprints, labelled by tile identifier — the coarser complement to the 1:10K coverage grid.',
        files: { fgb: `${BASE}/coverage-grid-50k.fgb` },
        style: { color: '#555555', weight: 1.5, fillOpacity: 0 },
        labelProperty: 'TILE',
        keywords: ['osni', 'coverage', 'grid', 'sheet', 'index', '1:50000', '50k', 'tile'],
        useLOD: true,
        references: [
            { label: 'OSNI Open Data - Coverage Grid - 50K', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-coverage-grid-50k', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON',              file: 'https://admin.opendatani.gov.uk/dataset/672cefe4-1c1b-4789-822d-6a5bcb875f45/resource/f55e4028-f24b-454f-807e-073b284396f6/download/osni_open_data_coverage_grid_50k.geojson' },
            { label: 'ESRI Shapefile (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/672cefe4-1c1b-4789-822d-6a5bcb875f45/resource/c9ed17bd-02cb-4b48-954e-1196908bced0/download/osni_open_data_coverage_grid_50k.zip' },
            { label: 'KML',                  file: 'https://admin.opendatani.gov.uk/dataset/672cefe4-1c1b-4789-822d-6a5bcb875f45/resource/793ad260-7414-4925-80aa-00a3affb1531/download/osni_open_data_coverage_grid_50k.kml' },
            { label: 'CSV',                  file: 'https://admin.opendatani.gov.uk/dataset/672cefe4-1c1b-4789-822d-6a5bcb875f45/resource/dec2d495-4119-460a-9795-dd02ee6a3b2a/download/osni_open_data_coverage_grid_50k.csv' }
        ]
    },
    {
        id: 'osni-benchmarks',
        name: 'OSNI Benchmarks (Height Reference Points)',
        slug: 'osni-benchmarks',
        category: catId,
        provider: ['OSNI'],
        description: 'Historic OSNI benchmarks — small brass plates or chiselled grooves set into permanent features (bridges, walls, milestones) whose heights above Ordnance Datum were precisely determined by levelling surveys. Used by surveyors as known reference points before GPS. ~10,000 points across Northern Ireland, each attributed with its height in metres.',
        files: { fgb: `${BASE}/benchmarks.fgb` },
        style: { color: '#b87333', weight: 1, radius: 3, fillOpacity: 0.8 },
        labelProperty: 'BM_Height',
        keywords: ['osni', 'benchmark', 'bench mark', 'height', 'datum', 'levelling', 'survey', 'trigonometric'],
        useLOD: false,
        references: [
            { label: 'OSNI Open Data - BenchMarks - Height', url: 'https://admin.opendatani.gov.uk/dataset/osni-open-data-benchmarks-height', note: '' }
        ],
        sourceDownloads: [
            { label: 'GeoJSON',              file: 'https://admin.opendatani.gov.uk/dataset/d2353369-da97-473d-9a10-9ecb7b598f40/resource/3c5df17a-e28d-439b-9164-c2e6e0830b31/download/osni_open_data_benchmarks_height.geojson' },
            { label: 'ESRI Shapefile (ZIP)', file: 'https://admin.opendatani.gov.uk/dataset/d2353369-da97-473d-9a10-9ecb7b598f40/resource/4214da40-17a5-4af7-8f22-3d84706f774a/download/osni_open_data_benchmarks_height.zip' },
            { label: 'KML',                  file: 'https://admin.opendatani.gov.uk/dataset/d2353369-da97-473d-9a10-9ecb7b598f40/resource/1f593808-f938-43dc-8f82-f6391905a79f/download/osni_open_data_benchmarks_height.kml' },
            { label: 'CSV',                  file: 'https://admin.opendatani.gov.uk/dataset/d2353369-da97-473d-9a10-9ecb7b598f40/resource/5f6a8d59-cef0-4d48-9f5a-79c8dfc000f5/download/osni_open_data_benchmarks_height.csv' }
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
