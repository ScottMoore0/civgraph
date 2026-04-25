import { readFileSync } from 'fs';

const res = JSON.parse(readFileSync('data/external/opendatani-resources.json', 'utf8'));

const geophysPatterns = /tellus|geophys|magnetic|radiometric|electromagnetic|gravity|gamma[- ]ray|airborne survey|bouguer|seismic|resistivity|conductivity|bedrock|isotope/i;
function isGeophysics(r) {
    const org = (r.organization_title || '').toLowerCase();
    if (org.includes('geological survey')) return true;
    const hay = [r.package_title, r.package_notes, r.resource_name, r.resource_description].filter(Boolean).join(' ');
    return geophysPatterns.test(hay);
}

const osniPattern = /ordnance survey of northern ireland|land & property services.*ordnance|\bosni\b/i;
const rasterTitle = /raster|scan|aerial|ortho|street ?map|tileset|tiles|image|photogra/i;
const rasterFormats = new Set(['TIF','TIFF','PNG','JPEG','JPG']);
function isOsniRaster(r) {
    const org = (r.organization_title || '');
    if (!osniPattern.test(org) && !/OSNI|LPS/.test(org) && !(r.package_name||'').toLowerCase().startsWith('osni-')) return false;
    const hay = [r.package_title, r.package_notes, r.resource_name, r.resource_description].filter(Boolean).join(' ');
    if (/lidar|\bla[sz]\b|photogrammetry|point[- ]cloud|digital (terrain|surface)/i.test(hay)) return false;
    const fmt = (r.format || '').trim().toUpperCase();
    if (rasterFormats.has(fmt)) return true;
    if (rasterTitle.test(hay)) return true;
    if (fmt === 'ZIP' && /raster|ortho|street ?map|tif|tiff|scan|aerial|jpeg|jpg|png/i.test(hay)) return true;
    return false;
}

const fmtBytes = (n) => n == null ? '—' : (n >= 1e9 ? (n/1e9).toFixed(2)+' GB' : n >= 1e6 ? (n/1e6).toFixed(1)+' MB' : (n/1e3).toFixed(0)+' KB');

function summarize(filter) {
    const rows = res.filter(filter);
    const byPkg = new Map();
    for (const r of rows) {
        if (!byPkg.has(r.package_name)) byPkg.set(r.package_name, { title: r.package_title, org: r.organization_title, files: 0, bytes: 0, slug: r.package_name });
        const p = byPkg.get(r.package_name);
        p.files++;
        if (r.resolved_size != null) p.bytes += r.resolved_size;
    }
    return [...byPkg.values()].sort((a, b) => b.bytes - a.bytes);
}

const geophys = summarize(isGeophysics);
const osni = summarize(isOsniRaster);

console.log('=== GEOPHYSICS DATASETS (' + geophys.length + ') ===');
geophys.forEach((p, i) => {
    console.log(String(i+1).padStart(3) + '. ' + fmtBytes(p.bytes).padStart(10) + '  (' + p.files + ' file' + (p.files===1?'':'s') + ')  ' + p.title);
});

console.log('\n=== OSNI RASTER DATASETS (' + osni.length + ') ===');
osni.forEach((p, i) => {
    console.log(String(i+1).padStart(3) + '. ' + fmtBytes(p.bytes).padStart(10) + '  (' + p.files + ' file' + (p.files===1?'':'s') + ')  ' + p.title);
});
