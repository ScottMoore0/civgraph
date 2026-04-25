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
        if (/shapefile|geodatabase|\bgdb\b|gpkg|geopackage|geojson|\.shp|mapinfo|\.tif|\.tiff|raster|tile|lidar|dtm|dsm|ortho/.test(hay)) return true;
    }
    return false;
}

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

// A) direct slug cite
const slugMatches = new Set();
for (const slug of spatialPkgs.keys()) {
    if (mapsText.includes('admin.opendatani.gov.uk/dataset/' + slug.toLowerCase())) {
        slugMatches.add(slug);
    }
}

// B) resource URL match
const urlMatches = new Set();
for (const [slug, urls] of pkgResourceUrls) {
    for (const u of urls) {
        if (mapsText.includes(u)) { urlMatches.add(slug); break; }
    }
}

// C) tight distinctive-word overlap
const STOP = new Set([
    'the','and','for','with','open','data','northern','ireland','osni','lps','daera',
    'nisra','largescale','boundaries','dataset','maps','map','from','into','over',
    'series','edition','historical','historic','historic','current','original',
    '2017','2018','2019','2020','2021','2022','2023','2024','2025','2026'
]);
const normalize = (s) => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const distinctive = (s) => normalize(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));

const civgraphMaps = (maps.maps || []).map(m => ({
    id: m.id, name: m.name, words: new Set(distinctive(m.name))
}));

const fuzzyMatches = new Map();
for (const [slug, title] of spatialPkgs) {
    if (slugMatches.has(slug) || urlMatches.has(slug)) continue;
    const odniWords = distinctive(title);
    if (odniWords.length < 3) continue;
    for (const cg of civgraphMaps) {
        if (cg.words.size < 3) continue;
        let overlap = 0;
        for (const w of odniWords) if (cg.words.has(w)) overlap++;
        if (overlap >= 3) {
            fuzzyMatches.set(slug, { title, civgraphName: cg.name });
            break;
        }
    }
}

const allMatched = new Set([...slugMatches, ...urlMatches, ...fuzzyMatches.keys()]);
const filesCovered = spatialRes.filter(r => allMatched.has(r.package_name)).length;

console.log('Open Data NI spatial datasets: ' + spatialPkgs.size);
console.log('Open Data NI spatial files:    ' + spatialRes.length);
console.log('');
console.log('Match breakdown:');
console.log('  Direct citation by ODNI slug:    ' + slugMatches.size);
console.log('  Match by resource URL:           ' + urlMatches.size);
console.log('  Distinctive-word match (3+):     ' + fuzzyMatches.size);
console.log('  --- total matched datasets:      ' + allMatched.size + '  (' + (allMatched.size*100/spatialPkgs.size).toFixed(1) + '%)');
console.log('  --- individual files covered:    ' + filesCovered + ' of ' + spatialRes.length + '  (' + (filesCovered*100/spatialRes.length).toFixed(1) + '%)');

console.log('\n=== Directly cited (' + slugMatches.size + ') ===');
[...slugMatches].sort().forEach(s => console.log('  ✓ ' + spatialPkgs.get(s)));

if (fuzzyMatches.size) {
    console.log('\n=== Fuzzy-matched — likely on Civgraph but cited differently (' + fuzzyMatches.size + ') ===');
    [...fuzzyMatches].forEach(([slug, info]) => {
        console.log('  ~ ' + info.title);
        console.log('      → Civgraph map: ' + info.civgraphName);
    });
}
