import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const catId = 'water-quality';
if (!db.categories.some(c => c.id === catId)) {
    db.categories.push({
        id: catId,
        name: 'Water Quality',
        group: 'Physical Geography',
        description: 'Water-quality datasets from Open Data NI — surface and groundwater bodies, drinking-water protection zones, WFD monitoring sites, river-quality long-term chemistry, AquaTROLL real-time sensor sites, and NI Water tap-supply records.'
    });
    console.log(`+ added category ${catId}`);
}

const BASE = 'https://data.civgraph.net/data/maps/water-quality';

const entries = [
    // ─── Spatial layers (FGB) ─────────────────────────────────────────────
    {
        id: 'wq-surface-water-bodies-2015',
        name: 'WFD Surface Water Bodies — Status 2015',
        slug: 'wq-surface-water-bodies-2015',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Polygons of every Water Framework Directive surface water body (rivers, lakes, transitional, coastal) across Northern Ireland with their 2015 ecological-status classification — high, good, moderate, poor or bad.',
        files: { fgb: `${BASE}/surface-water-bodies-status-20151.fgb` },
        style: { color: '#1f78b4', weight: 1, fillOpacity: 0.35 },
        keywords: ['wfd', 'water framework', 'surface water', 'water body', 'status', '2015', 'ecological'],
        useLOD: true,
        references: [{ label: 'OSNI Open Data — Surface Water Bodies Status 2015', url: 'https://admin.opendatani.gov.uk/dataset/surface-water-bodies-status-20151', note: '' }],
        sourceDownloads: [
            { label: 'GeoJSON', file: 'https://admin.opendatani.gov.uk/dataset/d4e5b8a1-5c01-4d4f-9b67-d6e7d4b04b5a' }
        ]
    },
    {
        id: 'wq-wfd-river-water-bodies',
        name: 'WFD River Water Bodies — 2nd Cycle',
        slug: 'wq-wfd-river-water-bodies',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'River-segment polygons for each WFD river water body (2nd-cycle classification). Each segment is a single management unit under the EU Water Framework Directive.',
        files: { fgb: `${BASE}/wfd-river-water-bodies-2nd-cycle1.fgb` },
        style: { color: '#33a02c', weight: 1.5 },
        keywords: ['wfd', 'rivers', 'water body', '2nd cycle', 'management'],
        useLOD: true,
        references: [{ label: 'OSNI Open Data — WFD River Water Bodies 2nd Cycle', url: 'https://admin.opendatani.gov.uk/dataset/wfd-river-water-bodies-2nd-cycle1', note: '' }]
    },
    {
        id: 'wq-wfd-monitoring-sites',
        name: 'WFD River & Lake Monitoring Sites — 2nd Cycle',
        slug: 'wq-wfd-monitoring-sites',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Point locations of the WFD 2nd-cycle river and lake monitoring sites where water quality is sampled.',
        files: { fgb: `${BASE}/wfd-river-and-lake-monitoring-sites-2nd-cycle1.fgb` },
        style: { color: '#e31a1c', radius: 4, weight: 1, fillOpacity: 0.85 },
        keywords: ['wfd', 'monitoring', 'sites', 'sampling', 'rivers', 'lakes', 'points'],
        useLOD: false,
        references: [{ label: 'OSNI Open Data — WFD River and Lake Monitoring Sites 2nd Cycle', url: 'https://admin.opendatani.gov.uk/dataset/wfd-river-and-lake-monitoring-sites-2nd-cycle1', note: '' }]
    },
    {
        id: 'wq-lake-water-bodies',
        name: 'Lake Water Bodies',
        slug: 'wq-lake-water-bodies',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Polygons of lakes and standing waters classified as WFD water bodies in Northern Ireland.',
        files: { fgb: `${BASE}/lake-water-bodies1.fgb` },
        style: { color: '#1f78b4', weight: 1, fillOpacity: 0.5 },
        keywords: ['lake', 'lough', 'water body', 'wfd', 'standing water'],
        useLOD: true,
        references: [{ label: 'OSNI Open Data — Lake Water Bodies', url: 'https://admin.opendatani.gov.uk/dataset/lake-water-bodies1', note: '' }]
    },
    {
        id: 'wq-groundwater-bodies',
        name: 'Northern Ireland Groundwater Bodies',
        slug: 'wq-groundwater-bodies',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Polygons of groundwater bodies — the underground aquifer-based units used for WFD groundwater status assessment.',
        files: { fgb: `${BASE}/northern-ireland-groundwater-bodies2.fgb` },
        style: { color: '#6a3d9a', weight: 1, fillOpacity: 0.3 },
        keywords: ['groundwater', 'aquifer', 'water body', 'wfd', 'subsurface'],
        useLOD: true,
        references: [{ label: 'OSNI Open Data — Northern Ireland Groundwater Bodies', url: 'https://admin.opendatani.gov.uk/dataset/northern-ireland-groundwater-bodies2', note: '' }]
    },
    {
        id: 'wq-groundwater-dwpa',
        name: 'Groundwater Drinking-Water Protected Areas (DWPAs)',
        slug: 'wq-groundwater-dwpa',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Designated protection zones where groundwater is abstracted for drinking-water supply, subject to elevated water-quality safeguards.',
        files: { fgb: `${BASE}/groundwater-drinking-water-protected-areas-dwpas1.fgb` },
        style: { color: '#fdbf6f', weight: 1, fillOpacity: 0.4 },
        keywords: ['drinking water', 'protected area', 'dwpa', 'groundwater', 'abstraction'],
        useLOD: true,
        references: [{ label: 'OSNI Open Data — Groundwater Drinking Water Protected Areas (DWPAs)', url: 'https://admin.opendatani.gov.uk/dataset/groundwater-drinking-water-protected-areas-dwpas1', note: '' }]
    },
    {
        id: 'wq-surface-dwpa',
        name: 'Surface Drinking-Water Protected Areas',
        slug: 'wq-surface-dwpa',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Designated protection zones where surface water is abstracted for drinking-water supply, subject to elevated water-quality safeguards.',
        files: { fgb: `${BASE}/surface-drinking-water-protected-areas1.fgb` },
        style: { color: '#ff7f00', weight: 1, fillOpacity: 0.4 },
        keywords: ['drinking water', 'protected area', 'dwpa', 'surface water', 'abstraction'],
        useLOD: true,
        references: [{ label: 'OSNI Open Data — Surface Drinking Water Protected Areas', url: 'https://admin.opendatani.gov.uk/dataset/surface-drinking-water-protected-areas1', note: '' }]
    },

    // ─── Umbrella catalogue cards (download-only, no spatial layer) ───────
    {
        id: 'wq-river-quality-1990-2018',
        name: 'River Water Quality Monitoring 1990–2018 (14 chemistry parameters)',
        slug: 'wq-river-quality-1990-2018',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Long-term chemistry time-series from NI rivers, 1990–2018, broken down by 14 individual parameters (pH, dissolved oxygen, BOD, ammonia, nitrate, nitrite, dissolved iron, suspended solids, plus extended set: alkalinity, conductivity, dissolved copper, dissolved zinc, soluble phosphorus). The "umbrella" package contains the spatial monitoring sites + summary; per-parameter packages contain the full time-series CSVs. No interactive map layer — use the WFD Monitoring Sites layer to see where samples are taken.',
        keywords: ['river', 'water quality', 'monitoring', 'chemistry', 'time series', 'long term', '1990', '2018', 'pH', 'dissolved oxygen', 'ammonia', 'nitrate'],
        references: [{ label: 'OSNI Open Data — River Water Quality Monitoring 1990 to 2018 (umbrella)', url: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-20181', note: '' }],
        sourceDownloads: [
            { label: 'Combined sites (GeoJSON)', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-20181' },
            { label: 'pH (per-parameter dataset)', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-ph1' },
            { label: 'Dissolved oxygen', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-dissolved-oxygen1' },
            { label: 'Biochemical oxygen demand (BOD)', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-biochemical-oxygen-demand1' },
            { label: 'Ammonia', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-ammonia1' },
            { label: 'Nitrate', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-nitrate1' },
            { label: 'Nitrite', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-nitrite1' },
            { label: 'Dissolved iron', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-dissolved-iron1' },
            { label: 'Dissolved copper', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-dissolved-copper1' },
            { label: 'Dissolved zinc', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-dissolved-zinc1' },
            { label: 'Suspended solids', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-suspended-solids1' },
            { label: 'Conductivity', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-conductivity1' },
            { label: 'Alkalinity', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-alkalinity1' },
            { label: 'Soluble phosphorus', file: 'https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-soluble-phosphorus1' }
        ]
    },
    {
        id: 'wq-aquatroll-realtime',
        name: 'AquaTROLL Real-Time Water Quality Sensors',
        slug: 'wq-aquatroll-realtime',
        category: catId,
        provider: ['DAERA', 'NIEA'],
        description: 'Live AquaTROLL multi-parameter sensor monitoring sites publishing real-time water-quality metrics (pH, conductivity, dissolved oxygen, temperature, turbidity, etc.) at three locations in Northern Ireland.',
        keywords: ['aquatroll', 'real time', 'sensor', 'monitoring', 'live', 'multi parameter'],
        references: [
            { label: 'Rea’s Wood AquaTROLL Metrics View', url: 'https://admin.opendatani.gov.uk/dataset/reas-wood-aquatroll-metrics-view', note: '' },
            { label: 'Toome AquaTROLL Metrics View', url: 'https://admin.opendatani.gov.uk/dataset/toome-aquatroll-metrics-view', note: '' },
            { label: 'Washing Bay AquaTROLL Metrics View', url: 'https://admin.opendatani.gov.uk/dataset/washing-bay-aquatroll-metrics-view', note: '' }
        ]
    },
    {
        id: 'wq-ni-water-drinking',
        name: 'NI Water — Drinking-Water Quality Public Registers',
        slug: 'wq-ni-water-drinking',
        category: catId,
        provider: ['NI Water'],
        description: 'NI Water’s Drinking-Water Quality Public Registers — Individual Customer Tap & Authorised Supply Point Results, plus annual reports. Per-tap test results (CSV) and per-year summary PDFs.',
        keywords: ['ni water', 'drinking water', 'tap', 'supply point', 'public register', 'annual report'],
        references: [{ label: 'OSNI Open Data — NI Water Drinking Water Quality Public Registers', url: 'https://admin.opendatani.gov.uk/dataset/ni-water-customer-tap-authorised-supply-point-results', note: '' }]
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
