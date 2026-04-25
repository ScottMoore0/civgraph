/**
 * Rank Open Data NI spatial datasets that are NOT yet on Civgraph,
 * by total package size (descending). Output a ranked digest of the
 * largest remaining ingestion targets.
 */
import { readFileSync } from 'fs';

const res = JSON.parse(readFileSync('data/external/opendatani-resources.json', 'utf8'));
const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));

const SPATIAL_FORMATS = new Set([
    'GEOJSON','SHP','KML','KMZ','GDB','GPKG','GEOPACKAGE','GML','MAPINFO',
    'TIF','TIFF','ESRI GRID','ESRI MAP','ASCII GRID','GEOSOFT GRID'
]);

const isSpatial = r => {
    const f = (r.format || '').trim().toUpperCase();
    if (SPATIAL_FORMATS.has(f)) return true;
    if (f === 'ZIP') {
        const hay = [r.resource_name, r.resource_description, r.package_title, r.package_notes].filter(Boolean).join(' ').toLowerCase();
        return /shapefile|geodatabase|\bgdb\b|gpkg|geopackage|geojson|\.shp|mapinfo|\.tif|\.tiff|raster|tile|lidar|dtm|dsm|ortho/.test(hay);
    }
    return false;
};

const spatialRes = res.filter(isSpatial);

// ── pkg → metadata ────────────────────────────────────────────────────────
const pkgs = new Map();
for (const r of spatialRes) {
    if (!pkgs.has(r.package_name)) {
        pkgs.set(r.package_name, {
            slug: r.package_name,
            title: r.package_title,
            org: r.organization_title,
            files: 0,
            size: 0,
            formats: new Set(),
            urls: new Set(),
            notes: (r.package_notes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
        });
    }
    const p = pkgs.get(r.package_name);
    p.files++;
    p.size += r.resolved_size || 0;
    if (r.format) p.formats.add(r.format);
    if (r.url) p.urls.add(r.url.toLowerCase());
}

// ── matching against current maps.json (slug, URL, fuzzy) ────────────────
const mapsText = JSON.stringify(maps).toLowerCase();
const matched = new Set();
for (const slug of pkgs.keys()) {
    if (mapsText.includes('admin.opendatani.gov.uk/dataset/' + slug.toLowerCase())) matched.add(slug);
}
for (const [slug, p] of pkgs) {
    if (matched.has(slug)) continue;
    for (const u of p.urls) if (mapsText.includes(u)) { matched.add(slug); break; }
}

const STOP = new Set('the and for with open data northern ireland osni lps daera nisra largescale boundaries dataset maps map'.split(' '));
const distinctive = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(w => w.length >= 4 && !STOP.has(w));
const civWords = (maps.maps || []).map(m => new Set(distinctive(m.name)));
for (const [slug, p] of pkgs) {
    if (matched.has(slug)) continue;
    const w = distinctive(p.title);
    if (w.length < 3) continue;
    for (const cw of civWords) {
        if (cw.size < 3) continue;
        let n = 0;
        for (const x of w) if (cw.has(x)) n++;
        if (n >= 3) { matched.add(slug); break; }
    }
}

// ── exclusion: 3D / lidar / point-cloud (different ingestion track) ──────
const isExcluded = p => {
    const t = p.title.toLowerCase() + ' ' + p.notes.toLowerCase();
    return /\blidar\b|\bdtm\b|\bdsm\b|point.cloud|photogramm|orthophoto/.test(t);
};

// ── compose ranked list of unmatched ──────────────────────────────────────
const unmatched = [...pkgs.values()].filter(p => !matched.has(p.slug)).filter(p => !isExcluded(p));
const lidarish = [...pkgs.values()].filter(p => !matched.has(p.slug)).filter(isExcluded);

unmatched.sort((a,b) => b.size - a.size);
lidarish.sort((a,b) => b.size - a.size);

console.log(`Unmatched, non-3D spatial packages: ${unmatched.length} (excluded ${lidarish.length} 3D/LIDAR)`);
console.log('=== Top 30 by total size ===');
for (const p of unmatched.slice(0, 30)) {
    const sz = p.size > 0 ? (p.size/1024/1024).toFixed(1) + ' MB' : '?';
    console.log(`  ${sz.padStart(10)}  ${[...p.formats].join(',').padEnd(15)}  ${p.title}`);
}
console.log('\n=== 3D / LIDAR / Photogrammetry (separate ingestion track) — top 8 ===');
for (const p of lidarish.slice(0, 8)) {
    const sz = p.size > 0 ? (p.size/1024/1024).toFixed(1) + ' MB' : '?';
    console.log(`  ${sz.padStart(10)}  ${[...p.formats].join(',').padEnd(15)}  ${p.title}`);
}
