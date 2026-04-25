import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

// ─── Helpers ──────────────────────────────────────────────────────────────
function ensureCategory(id, name, group, description) {
    if (db.categories.some(c => c.id === id)) return;
    db.categories.push({ id, name, group, description });
    console.log(`+ category ${id} (${group})`);
}

function addEntry(e) {
    if (db.maps.some(m => m.id === e.id)) {
        console.log(`  (skip) ${e.id}`);
        return;
    }
    db.maps.push(e);
    console.log(`+ ${e.id}`);
}

// ─── Categories ───────────────────────────────────────────────────────────
ensureCategory('environment', 'Environment', 'Physical Geography',
    'Environmental indicators — air, noise, agricultural pollution risk, and similar overlay datasets.');
ensureCategory('transport', 'Transport', 'Built Environment',
    'Roads, rail, ports, transport-related infrastructure datasets.');

// ─── Item 4: Agricultural Critical Risk Areas ─────────────────────────────
addEntry({
    id: 'wq-agricultural-critical-risk',
    name: 'Agricultural Critical Risk Areas (DAERA)',
    slug: 'wq-agricultural-critical-risk',
    category: 'water-quality',
    provider: ['DAERA', 'NIEA'],
    description: 'DAERA classification of land parcels by their relative risk of contributing diffuse agricultural pollution to receiving waters. Each parcel is scored 0–1 (`riskscore2`) by combining slope, hydrological connectivity, soil characteristics, rainfall, river-buffer proximity and land-use rules. Companion to the Network Contribution datasets — the polygon equivalent of the per-river-basin SciMAP score.',
    files: { fgb: 'https://data.civgraph.net/data/maps/water-quality/agricultural-critical-risk-areas.fgb' },
    style: { color: '#888888', weight: 0.2, fillOpacity: 0.6 },
    colorScale: { property: 'riskscore2', ramp: 'inferno', domain: [0, 1], logarithmic: false },
    keywords: ['agriculture','farming','pollution','risk','daera','nutrient','runoff','diffuse'],
    useLOD: true,
    references: [{ label: 'OSNI Open Data — Agricultural Critical Risk Areas', url: 'https://admin.opendatani.gov.uk/dataset/agricultural-critical-risk-areas', note: '' }]
});

// ─── Item 1: Network Contribution umbrella (download-only) ────────────────
const ncCatchments = [
    ['ballinderry',           '4ec3a64a-cc25-4d3e-b91f-fe9d92c50e1a'],   // approximate slug
    ['belfast-lough',         null],
    ['braid-and-main',        null],
    ['burn-dennet-and-foyle', null],
    ['bush',                  null],
    ['carlingford-and-newry', null],
    ['derg-and-mourne',       null],
    ['faughan',               null],
    ['glens-rathlin',         null],
    ['lagan',                 null],
    ['larne-lough',           null],
    ['lough-melvin-and-arney',null],
    ['lough-neagh',           null],
    ['lower-bann',            null],
    ['lower-lough-erne',      null],
    ['moyola',                null],
    ['owenkillew',            null],
    ['quoile',                null],
    ['river-blackwater',      null],
    ['roe',                   null],
    ['six-mile-water',        null],
    ['south-down',            null],
    ['strangford',            null],
    ['strule',                null],
    ['upper-bann',            null],
    ['upper-lough-erne',      null]
];
addEntry({
    id: 'wq-network-contribution',
    name: 'DAERA Network Contribution — SciMAP modelled pollution scores by river basin (26 catchments)',
    slug: 'wq-network-contribution',
    category: 'water-quality',
    provider: ['DAERA', 'NIEA'],
    description: 'Per-river-basin pollution-contribution scores from the **SciMAP** hydrological model (CEH Land Cover 2007 + Met Office rainfall + 5 m DTM). Each river segment is scored for how much sediment/nutrient pollution its upstream catchment is contributing. Published as 26 separate per-catchment shapefiles. Each catchment is millions of fine-grained polygons — too dense to render as a single interactive layer in a browser; instead linked here as download-only datasets per catchment. Companion to the Agricultural Critical Risk Areas layer (the parcel-level equivalent already loadable on the map).',
    keywords: ['scimap','pollution','river','catchment','daera','niea','network contribution','runoff','diffuse'],
    references: [{
        label: 'DAERA Open Data Hub — Network Contribution datasets',
        url: 'https://opendata-daerani.hub.arcgis.com/search?q=network%20contribution',
        note: ''
    }],
    sourceDownloads: ncCatchments.map(([slug]) => ({
        label: `${slug.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())} Network Contribution`,
        file: `https://opendata-daerani.hub.arcgis.com/datasets/${slug}-network-contribution`
    }))
});

// ─── Item 3: Carriageway and Footway Surface Defects ──────────────────────
addEntry({
    id: 'transport-carriageway-defects-2021',
    name: 'Carriageway and Footway Surface Defects 2021',
    slug: 'transport-carriageway-defects-2021',
    category: 'transport',
    provider: ['DfI', 'Roads NI'],
    description: 'Every recorded surface defect (potholes, cracks, ruts, surface damage) on Northern Ireland\'s public roads and footways during 2021, with division/section/response-time attributes. ~124 K point records — DfI\'s authoritative road-condition survey for that year.',
    files: { fgb: 'https://data.civgraph.net/data/maps/transport/carriageway-footway-defects-2021.fgb' },
    style: { color: '#cf4e00', radius: 2, weight: 0.5, fillOpacity: 0.85 },
    keywords: ['roads','defects','potholes','dfi','road condition','footway','carriageway'],
    useLOD: true,
    references: [{ label: 'OSNI Open Data — Carriageway and Footway Surface Defects', url: 'https://admin.opendatani.gov.uk/dataset/carriageway-and-footway-surface-defects', note: '' }]
});

// ─── Item 5: Environmental Noise Directive — Round 3 (2017) ───────────────
const noiseRefs = [{
    label: 'OSNI Open Data — Environmental Noise Directive (Round 3)',
    url: 'https://admin.opendatani.gov.uk/dataset/environmental-noise-directive-noise-mapping',
    note: ''
}];
const noiseStyle = { weight: 0.2, fillOpacity: 0.55 };
const noiseColorMap = { property: 'gridcode', palette: 'noise_lden', default: '#cccccc' };

addEntry({
    id: 'env-noise-agglomeration-lden',
    name: 'Environmental Noise — Belfast Agglomeration Lden (Round 3)',
    slug: 'env-noise-agglomeration-lden',
    category: 'environment',
    provider: ['DAERA'],
    description: 'Strategic noise mapping for the Belfast Metropolitan Urban Area agglomeration: combined noise from all sources (road, rail, industry, airports, ports) over 24 hours weighted by time of day (Lden). Round 3 (2017) under the EU Environmental Noise Directive 2002/49/EC. Polygons are the standard 5 dB Lden bands, coloured to the END convention.',
    files: { fgb: 'https://data.civgraph.net/data/maps/environment/noise-agglomeration-lden-r3.fgb' },
    style: noiseStyle,
    colorMap: noiseColorMap,
    keywords: ['noise','environmental noise','lden','belfast','agglomeration','daera','round 3','end'],
    useLOD: true,
    references: noiseRefs
});
addEntry({
    id: 'env-noise-major-roads-lden',
    name: 'Environmental Noise — Major Roads Lden (Round 3)',
    slug: 'env-noise-major-roads-lden',
    category: 'environment',
    provider: ['DAERA'],
    description: 'Lden noise contours along Northern Ireland\'s major road network (>3 million vehicle passages per year), Round 3 (2017) of the EU Environmental Noise Directive. Bands rendered in the standard END Lden palette.',
    files: { fgb: 'https://data.civgraph.net/data/maps/environment/noise-major-roads-lden-r3.fgb' },
    style: noiseStyle,
    colorMap: noiseColorMap,
    keywords: ['noise','environmental noise','lden','major roads','traffic','daera','round 3','end'],
    useLOD: true,
    references: noiseRefs
});
addEntry({
    id: 'env-noise-major-rail-lden',
    name: 'Environmental Noise — Major Rail Lden (Round 3)',
    slug: 'env-noise-major-rail-lden',
    category: 'environment',
    provider: ['DAERA'],
    description: 'Lden noise contours along major Translink rail routes (>30 000 train passages per year), Round 3 (2017) of the EU Environmental Noise Directive.',
    files: { fgb: 'https://data.civgraph.net/data/maps/environment/noise-major-rail-lden-r3.fgb' },
    style: noiseStyle,
    colorMap: noiseColorMap,
    keywords: ['noise','environmental noise','lden','rail','translink','daera','round 3','end'],
    useLOD: true,
    references: noiseRefs
});

// ─── Item 6: River Water Quality 1990–2018 — 13 parameter spatial layers ──
const rwqParams = [
    ['ph',                         'pH',                                      'pH (median 2010–18)',                                  'plasma',  [5, 9],         false],
    ['dissolved-oxygen',           'Dissolved oxygen',                        'Dissolved oxygen mg/L (mean 2010–18)',                 'viridis', [5, 15],        false],
    ['biochemical-oxygen-demand',  'Biochemical oxygen demand (BOD)',         'BOD mg/L O₂ (mean 2010–18)',                           'inferno', [1, 8],         true],
    ['ammonia',                    'Total ammonia (as N)',                    'Total ammonia mg/L (mean 2010–18)',                    'inferno', [0.05, 5],      true],
    ['nitrate',                    'Nitrate (as N)',                          'Nitrate mg/L (mean 2010–18)',                          'inferno', [0.5, 15],      false],
    ['nitrite',                    'Nitrite (as N)',                          'Nitrite mg/L (mean 2010–18)',                          'inferno', [0.005, 0.5],   true],
    ['dissolved-iron',             'Dissolved iron',                          'Dissolved iron µg/L (mean 2010–18)',                   'inferno', [10, 2000],     true],
    ['dissolved-copper',           'Dissolved copper',                        'Dissolved copper µg/L (mean 2010–18)',                 'inferno', [0.5, 20],      true],
    ['dissolved-zinc',             'Dissolved zinc',                          'Dissolved zinc µg/L (mean 2010–18)',                   'inferno', [1, 80],        true],
    ['suspended-solids',           'Suspended solids',                        'Suspended solids mg/L (mean 2010–18)',                 'inferno', [2, 80],        true],
    ['conductivity',               'Conductivity',                            'Conductivity µS/cm (mean 2010–18)',                    'viridis', [100, 800],     false],
    ['alkalinity',                 'Alkalinity',                              'Alkalinity mg/L CaCO₃ (mean 2010–18)',                 'viridis', [10, 300],      false],
    ['soluble-phosphorus',         'Soluble reactive phosphorus',             'Soluble reactive phosphorus mg/L (mean 2010–18)',      'inferno', [0.01, 1],      true]
];
for (const [slug, param, hover, ramp, domain, log] of rwqParams) {
    addEntry({
        id: `wq-rwq-${slug}`,
        name: `River Water Quality 1990–2018 — ${param}`,
        slug: `wq-rwq-${slug}`,
        category: 'water-quality',
        provider: ['DAERA', 'NIEA'],
        description: `Per-monitoring-site mean ${param.toLowerCase()} for the 2010–2018 period, derived from DAERA's River Water Quality Monitoring 1990–2018 dataset (~141 K sample-time records aggregated to ${slug === 'dissolved-copper' ? 377 : slug === 'dissolved-iron' || slug === 'dissolved-zinc' ? 559 : slug === 'suspended-solids' ? 540 : slug === 'alkalinity' ? 633 : 572} active sites). Site points are coloured by mean value over the period; click any site for its full statistics including min, max, and most recent measurement. Older or full-time-series data is available as the per-parameter umbrella card linked from the catalogue.`,
        files: { fgb: `https://data.civgraph.net/data/maps/water-quality/rwq-${slug}.fgb` },
        style: { color: '#888888', radius: 5, weight: 0.5, fillOpacity: 0.9 },
        colorScale: { property: 'mean_value', ramp, domain, logarithmic: log },
        keywords: ['water quality','river','monitoring','daera','niea',param.toLowerCase(),slug],
        labelProperty: 'Station_Name',
        useLOD: false,
        references: [{
            label: `OSNI Open Data — River Water Quality Monitoring 1990 to 2018 (${param})`,
            url: `https://admin.opendatani.gov.uk/dataset/river-water-quality-monitoring-1990-to-2018-${slug}1`,
            note: ''
        }]
    });
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\nDone. Total maps: ${db.maps.length}`);
