// Build a single inert MultiLineString FGB of all Tellus flight lines from
// the raw radiometric CSV (sample-time rows with LAT/LONG/Line). One feature,
// no attributes, all flight tracks combined; mirrors the townland-backstop
// pattern.
import { createReadStream, writeFileSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';

mkdirSync('_tmp_flight/out', { recursive: true });

const rl = createInterface({ input: createReadStream('_tmp_flight/downloads/Radiometrics.csv') });
let header = null;
let idxLine = -1, idxLat = -1, idxLng = -1;
const lines = new Map();   // line label → [{lng, lat}, ...]

let n = 0;
for await (const row of rl) {
    if (!header) {
        header = row.split(',');
        idxLine = header.indexOf('Line');
        idxLat = header.indexOf('LAT');
        idxLng = header.indexOf('LONG');
        if (idxLine < 0 || idxLat < 0 || idxLng < 0) {
            console.error('header missing columns:', header.join(','));
            process.exit(1);
        }
        continue;
    }
    const c = row.split(',');
    const lbl = c[idxLine];
    const lat = parseFloat(c[idxLat]);
    const lng = parseFloat(c[idxLng]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    if (!lines.has(lbl)) lines.set(lbl, []);
    lines.get(lbl).push([lng, lat]);
    n++;
    if ((n & 0xFFFFF) === 0) process.stdout.write(`\r  ${(n/1e6).toFixed(1)} M rows, ${lines.size} lines`);
}
console.log(`\n  total: ${n} samples → ${lines.size} flight lines`);

// Decimate each line to drop redundant samples (every ~5th point retains
// the track shape; the survey samples every ~7m which is overkill at any
// useful zoom). Always keep first + last point per line.
function decimate(coords, stride = 5) {
    if (coords.length <= 2) return coords;
    const out = [];
    for (let i = 0; i < coords.length; i += stride) out.push(coords[i]);
    if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]);
    return out;
}

const multiLine = [...lines.values()].map(c => decimate(c, 5));
const totalVerts = multiLine.reduce((s, l) => s + l.length, 0);
console.log(`  decimated 5x → ${totalVerts} vertices total`);

const geojson = {
    type: 'FeatureCollection',
    features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: multiLine }
    }]
};
writeFileSync('_tmp_flight/out/tellus-flight-tracks.geojson', JSON.stringify(geojson));
console.log(`  wrote _tmp_flight/out/tellus-flight-tracks.geojson`);
