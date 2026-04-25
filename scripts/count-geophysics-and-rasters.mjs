import { readFileSync } from 'fs';

const res = JSON.parse(readFileSync('data/external/opendatani-resources.json', 'utf8'));

// --- Geophysics maps ---
// Owned by "Geological Survey of Northern Ireland" OR title mentions geophysics/magnetic/radiometric/electromagnetic/gravity/tellus
const geophysPatterns = /tellus|geophys|magnetic|radiometric|electromagnetic|gravity|gamma[- ]ray|airborne survey|bouguer|seismic|resistivity|conductivity|bedrock|isotope/i;
function isGeophysics(r) {
    const org = (r.organization_title || '').toLowerCase();
    if (org.includes('geological survey')) return true;
    const hay = [r.package_title, r.package_notes, r.resource_name, r.resource_description].filter(Boolean).join(' ');
    return geophysPatterns.test(hay);
}

// --- OSNI raster maps ---
// Published by OSNI / LPS-OSNI, and clearly raster (image/tile/scan/historic/ortho/streetmap/raster in title OR format is TIF/TIFF/PNG/JPEG/WebP or ZIP containing raster)
const osniPattern = /ordnance survey of northern ireland|^OSNI$|land & property services.*ordnance|\bosni\b/i;
const rasterTitle = /raster|scan|aerial|ortho|street ?map|tileset|tiles|image|photogra/i;
const rasterFormats = new Set(['TIF','TIFF','PNG','JPEG','JPG']);
function isOsniRaster(r) {
    const org = (r.organization_title || '');
    if (!osniPattern.test(org) && !/OSNI|LPS/.test(org) && !(r.package_name||'').toLowerCase().startsWith('osni-')) return false;
    // Exclude LIDAR/DTM/DSM/photogrammetry since user already carved those out
    const hay = [r.package_title, r.package_notes, r.resource_name, r.resource_description].filter(Boolean).join(' ');
    if (/lidar|\bla[sz]\b|photogrammetry|point[- ]cloud|digital (terrain|surface)/i.test(hay)) return false;
    const fmt = (r.format || '').trim().toUpperCase();
    if (rasterFormats.has(fmt)) return true;
    if (rasterTitle.test(hay)) return true;
    // ZIPs that obviously contain rasters
    if (fmt === 'ZIP' && /raster|ortho|street ?map|tif|tiff|scan|aerial|jpeg|jpg|png/i.test(hay)) return true;
    return false;
}

const geophysRes = res.filter(isGeophysics);
const osniRasterRes = res.filter(isOsniRaster);

const fmtBytes = (n) => n == null ? '—' : (n >= 1e9 ? (n/1e9).toFixed(2)+' GB' : n >= 1e6 ? (n/1e6).toFixed(2)+' MB' : (n/1e3).toFixed(1)+' KB');

function report(label, rows) {
    const byPkg = new Map();
    let totalBytes = 0, sized = 0;
    const byFormat = {};
    for (const r of rows) {
        if (!byPkg.has(r.package_name)) byPkg.set(r.package_name, { title: r.package_title, files: 0, bytes: 0 });
        const p = byPkg.get(r.package_name);
        p.files++;
        if (r.resolved_size != null) { p.bytes += r.resolved_size; totalBytes += r.resolved_size; sized++; }
        const f = (r.format || '(none)').toUpperCase();
        byFormat[f] = (byFormat[f] || 0) + 1;
    }
    console.log('\n=== ' + label + ' ===');
    console.log(`  Distinct datasets:       ${byPkg.size}`);
    console.log(`  Individual resources:    ${rows.length}`);
    console.log(`  Resources with size:     ${sized} of ${rows.length}`);
    console.log(`  Combined known volume:   ${fmtBytes(totalBytes)}`);
    console.log(`  Format breakdown:`);
    Object.entries(byFormat).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${String(v).padStart(4)}  ${k}`));
    console.log('');
    console.log('  Datasets:');
    [...byPkg.values()].sort((a,b) => b.bytes - a.bytes).forEach(p => {
        console.log(`    • ${p.title}  —  ${p.files} file${p.files>1?'s':''}  (${fmtBytes(p.bytes)})`);
    });
}

report('GEOPHYSICS maps', geophysRes);
report('OSNI RASTER maps', osniRasterRes);
