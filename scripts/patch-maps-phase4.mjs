import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

// Re-use the existing geology-geophysics category. Tellus airborne is the
// same broad domain as the GSNI bedrock / Tellus stream-sediment cards.
const catId = 'geology-geophysics';

// Source-extent in Irish Grid (188212.5, 307562.5) → (369162.5, 453687.5)
// in WGS84 ≈ (53.99, -8.19) → (55.33, -5.32). All 10 layers share this bbox.
const TELLUS_BOUNDS = [[53.99, -8.19], [55.33, -5.32]];
const BASE = 'https://data.civgraph.net/data/maps/geology';

// Open Data NI CKAN package URLs for the source ESRI Grids
const PKG_MAG = 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-magnetic-grids';
const PKG_RAD = 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-radiometric-grids';
const PKG_EM  = 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-electromagnetic-grids';

const URL_MAG_GRID  = 'https://opendatani.blob.core.windows.net/gsnigeospatial/Tellus_Magnetics_ESRIGRID.zip';
const URL_RAD_GRID  = 'https://opendatani.blob.core.windows.net/gsnigeospatial/Tellus_Radiometrics_ESRIGRID.zip';
const URL_EM_GRID   = 'https://opendatani.blob.core.windows.net/gsnigeospatial/Tellus_Electromagnetics_ESRIGRID.zip';
const URL_MAG_ASCII = 'https://opendatani.blob.core.windows.net/gsnigeospatial/Tellus_Magnetics_ASCII.zip';
const URL_RAD_ASCII = 'https://opendatani.blob.core.windows.net/gsnigeospatial/Tellus_Radiometrics_ASCII.zip';
const URL_EM_ASCII  = 'https://opendatani.blob.core.windows.net/gsnigeospatial/Tellus_Electromagnetics_ASCII.zip';

const entries = [
    // ─── Magnetic (3) ─────────────────────────────────────────────────────
    {
        id: 'tellus-mag-tmi',
        name: 'Tellus Magnetic — Total Magnetic Intensity (residual)',
        slug: 'tellus-mag-tmi',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Residual total magnetic intensity (TMI) from the GSNI Tellus airborne survey — variations in the Earth\'s magnetic field caused by buried magnetic minerals (chiefly magnetite). High-magnetic anomalies trace mafic/ultramafic intrusions, basaltic flows, and iron-bearing sedimentary basins; magnetic lows mark sedimentary basins and demagnetised alteration zones. 35m grid spacing, ±3σ rainbow ramp.',
        files: { xyz: `${BASE}/tellus-mag-tmi/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'magnetic', 'tmi', 'total magnetic intensity', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Magnetic Grids', url: PKG_MAG, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 601 MB)', file: URL_MAG_GRID },
            { label: 'ASCII Grid (ZIP, 1078 MB)',          file: URL_MAG_ASCII }
        ]
    },
    {
        id: 'tellus-mag-rtp',
        name: 'Tellus Magnetic — Reduction-to-Pole (RTP)',
        slug: 'tellus-mag-rtp',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'TMI corrected by reduction-to-pole, which compensates for the dipolar shape of magnetic anomalies caused by NI\'s inclined magnetic field. RTP places the peak directly above the source body, simplifying interpretation. ±3σ rainbow ramp.',
        files: { xyz: `${BASE}/tellus-mag-rtp/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'magnetic', 'rtp', 'reduction to pole', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Magnetic Grids', url: PKG_MAG, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 601 MB)', file: URL_MAG_GRID }
        ]
    },
    {
        id: 'tellus-mag-rtp-tilt',
        name: 'Tellus Magnetic — RTP Tilt Derivative',
        slug: 'tellus-mag-rtp-tilt',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Tilt derivative of the RTP magnetic field — an edge-detection filter that highlights the boundaries of magnetic source bodies regardless of their amplitude. Excellent for tracing dykes, faults, and contacts. ±3σ rainbow ramp.',
        files: { xyz: `${BASE}/tellus-mag-rtp-tilt/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'magnetic', 'tilt', 'derivative', 'edge detection', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Magnetic Grids', url: PKG_MAG, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 601 MB)', file: URL_MAG_GRID }
        ]
    },
    // ─── Electromagnetic (2) ──────────────────────────────────────────────
    {
        id: 'tellus-em-3khz',
        name: 'Tellus Electromagnetic — 3 kHz Apparent Conductivity',
        slug: 'tellus-em-3khz',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Apparent ground conductivity at 3 kHz from the Tellus airborne EM survey — penetrates ~50–150 m, mapping conductive saline groundwater, clay-rich soils, mineralised zones, and pollution plumes. Viridis colormap (low = purple, high = yellow), -2σ to +4σ stretch.',
        files: { xyz: `${BASE}/tellus-em-3khz/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'electromagnetic', 'conductivity', '3khz', 'em', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Electromagnetic Grids', url: PKG_EM, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 225 MB)', file: URL_EM_GRID },
            { label: 'ASCII Grid (ZIP, 380 MB)',            file: URL_EM_ASCII }
        ]
    },
    {
        id: 'tellus-em-14khz',
        name: 'Tellus Electromagnetic — 14 kHz Apparent Conductivity',
        slug: 'tellus-em-14khz',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Apparent ground conductivity at 14 kHz — shallower depth (~10–30 m) than the 3 kHz channel, more sensitive to surface and near-surface conductors. Useful for soil moisture, near-surface alteration, and thin clay layers. Viridis colormap, -2σ to +4σ stretch.',
        files: { xyz: `${BASE}/tellus-em-14khz/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'electromagnetic', 'conductivity', '14khz', 'em', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Electromagnetic Grids', url: PKG_EM, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 225 MB)', file: URL_EM_GRID }
        ]
    },
    // ─── Radiometric (5) ──────────────────────────────────────────────────
    {
        id: 'tellus-rad-k',
        name: 'Tellus Radiometric — Potassium (K %)',
        slug: 'tellus-rad-k',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Surface potassium concentration from natural gamma-ray emissions. Highlights granites and other felsic intrusions (potassium-rich), alkaline volcanics, and certain sedimentary horizons. Inferno colormap (dark = low, bright = high), ±2-3σ stretch.',
        files: { xyz: `${BASE}/tellus-rad-k/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'radiometric', 'potassium', 'k', 'gamma', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Radiometric Grids', url: PKG_RAD, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 842 MB)', file: URL_RAD_GRID },
            { label: 'ASCII Grid (ZIP, 1503 MB)',           file: URL_RAD_ASCII }
        ]
    },
    {
        id: 'tellus-rad-u',
        name: 'Tellus Radiometric — Uranium-Equivalent (eU ppm)',
        slug: 'tellus-rad-u',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Uranium-equivalent concentration from the 1.76 MeV bismuth-214 daughter peak. Highlights uranium-bearing granites, organic-rich shales, phosphatic horizons, and mineralised zones. Viridis colormap, ±2-3σ stretch.',
        files: { xyz: `${BASE}/tellus-rad-u/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'radiometric', 'uranium', 'u', 'gamma', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Radiometric Grids', url: PKG_RAD, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 842 MB)', file: URL_RAD_GRID }
        ]
    },
    {
        id: 'tellus-rad-th',
        name: 'Tellus Radiometric — Thorium-Equivalent (eTh ppm)',
        slug: 'tellus-rad-th',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Thorium-equivalent concentration from the 2.61 MeV thallium-208 daughter peak. Often correlates with heavy minerals (monazite, zircon) in placer deposits and resistate sediments. Rainbow colormap, ±2-3σ stretch.',
        files: { xyz: `${BASE}/tellus-rad-th/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'radiometric', 'thorium', 'th', 'gamma', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Radiometric Grids', url: PKG_RAD, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 842 MB)', file: URL_RAD_GRID }
        ]
    },
    {
        id: 'tellus-rad-total',
        name: 'Tellus Radiometric — Total Counts (gamma)',
        slug: 'tellus-rad-total',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'Total gamma-ray count rate — a summed proxy for combined K, U, Th, and other radionuclide activity. Useful for identifying overall radiometric "hot" zones before decomposing into individual channels. Inferno colormap, ±2-3σ stretch.',
        files: { xyz: `${BASE}/tellus-rad-total/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.85, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'radiometric', 'total counts', 'gamma', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Radiometric Grids', url: PKG_RAD, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 842 MB)', file: URL_RAD_GRID }
        ]
    },
    {
        id: 'tellus-rad-ternary',
        name: 'Tellus Radiometric — K/Th/U Ternary RGB',
        slug: 'tellus-rad-ternary',
        category: catId,
        provider: ['GSNI', 'Tellus'],
        description: 'The iconic radiometric ternary composite — K mapped to red, Th to green, U to blue. Reds = potassic (granite, certain volcanics); greens = thorium-rich (resistate sediments, heavy minerals); blues = uranium-rich (organic shales, mineralisation); whites/pale = high in all three; blacks = low overall. The most interpretively powerful single radiometric view. Each band stretched independently to mean ± 2σ.',
        files: { xyz: `${BASE}/tellus-rad-ternary/{z}/{x}/{y}.png` },
        rasterStyle: { opacity: 0.9, minZoom: 5, maxZoom: 18, maxNativeZoom: 13 },
        bounds: TELLUS_BOUNDS,
        keywords: ['tellus', 'gsni', 'geophysics', 'radiometric', 'ternary', 'rgb', 'composite', 'k th u', 'airborne'],
        references: [{ label: 'OSNI Open Data — Tellus Radiometric Grids', url: PKG_RAD, note: '' }],
        sourceDownloads: [
            { label: 'ESRI File Geodatabase (ZIP, 842 MB)', file: URL_RAD_GRID }
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
