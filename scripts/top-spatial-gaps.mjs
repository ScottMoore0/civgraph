import { readFileSync } from 'fs';

const res = JSON.parse(readFileSync('data/external/opendatani-resources.json', 'utf8'));
const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));

const spatialFormats = new Set([
    'GEOJSON','SHP','KML','KMZ','GDB','GPKG','GEOPACKAGE','GML','MAPINFO',
    'TIF','TIFF','ESRI GRID','ESRI MAP','ASCII GRID','GEOSOFT GRID'
]);
function isSpatial(r) {
    const f = (r.format || '').trim().toUpperCase();
    if (spatialFormats.has(f)) return true;
    if (f === 'ZIP') {
        const hay = [r.resource_name, r.resource_description, r.package_title, r.package_notes]
            .filter(Boolean).join(' ').toLowerCase();
        if (/shapefile|geodatabase|\bgdb\b|gpkg|geopackage|geojson|\.shp|mapinfo|\.tif|\.tiff|raster|tile|dtm|dsm|ortho/.test(hay)) return true;
    }
    return false;
}

// 3D exclusion — LIDAR / photogrammetry / point-cloud
const threeD = /lidar|\bla[sz]\b|photogrammetry|point[- ]cloud|\.laz|\.las|dtm|dsm|digital (terrain|surface) model|hillshade|orthophoto/i;
function is3D(r) {
    const f = (r.format || '').trim().toUpperCase();
    if (f === 'LAZ' || f === 'LAS') return true;
    const hay = [r.format, r.resource_name, r.resource_description, r.package_title, r.package_notes]
        .filter(Boolean).join(' | ');
    return threeD.test(hay);
}

// Build match table (same logic as match-opendatani-civgraph.mjs)
const spatialRes = res.filter(isSpatial);
const spatialPkgs = new Map();
const pkgResourceUrls = new Map();
for (const r of spatialRes) {
    if (!spatialPkgs.has(r.package_name)) {
        spatialPkgs.set(r.package_name, r.package_title);
        pkgResourceUrls.set(r.package_name, new Set());
    }
    if (r.url) pkgResourceUrls.get(r.package_name).add(r.url.toLowerCase());
}
const mapsText = JSON.stringify(maps).toLowerCase();

const slugMatches = new Set();
for (const slug of spatialPkgs.keys()) {
    if (mapsText.includes('admin.opendatani.gov.uk/dataset/' + slug.toLowerCase())) slugMatches.add(slug);
}
const urlMatches = new Set();
for (const [slug, urls] of pkgResourceUrls) {
    for (const u of urls) {
        if (mapsText.includes(u)) { urlMatches.add(slug); break; }
    }
}
const STOP = new Set([
    'the','and','for','with','open','data','northern','ireland','osni','lps','daera',
    'nisra','largescale','boundaries','dataset','maps','map','from','into','over',
    'series','edition','historical','historic','current','original',
    '2017','2018','2019','2020','2021','2022','2023','2024','2025','2026'
]);
const normalize = (s) => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const distinctive = (s) => normalize(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
const civgraphMaps = (maps.maps || []).map(m => ({
    id: m.id, name: m.name, words: new Set(distinctive(m.name))
}));
const fuzzyMatches = new Set();
for (const [slug, title] of spatialPkgs) {
    if (slugMatches.has(slug) || urlMatches.has(slug)) continue;
    const odniWords = distinctive(title);
    if (odniWords.length < 3) continue;
    for (const cg of civgraphMaps) {
        if (cg.words.size < 3) continue;
        let overlap = 0;
        for (const w of odniWords) if (cg.words.has(w)) overlap++;
        if (overlap >= 3) { fuzzyMatches.add(slug); break; }
    }
}
const matched = new Set([...slugMatches, ...urlMatches, ...fuzzyMatches]);

// Filter: spatial, sized, non-3D, not on Civgraph
const candidates = spatialRes.filter(r =>
    !matched.has(r.package_name) &&
    !is3D(r) &&
    r.resolved_size != null
).sort((a, b) => b.resolved_size - a.resolved_size);

const fmtBytes = (n) => n >= 1e9 ? (n/1e9).toFixed(2)+' GB' : n >= 1e6 ? (n/1e6).toFixed(2)+' MB' : (n/1e3).toFixed(1)+' KB';

console.log('Spatial files not on Civgraph (excl. 3D): ' + candidates.length);
console.log('');
console.log('Top 10:');
candidates.slice(0, 10).forEach((r, i) => {
    console.log(`${i+1}. ${fmtBytes(r.resolved_size).padEnd(10)}  ${(r.format||'?').padEnd(10)}  ${r.package_title || r.package_name}`);
    console.log(`      ${(r.resource_name || '(unnamed)').slice(0,90)}`);
    console.log(`      org: ${(r.organization_title || '').slice(0,70)}`);
    console.log(`      url: ${(r.url || '').slice(0,110)}`);
    console.log('');
});
