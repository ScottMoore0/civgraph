/**
 * Edit PC1995.fgb: rename "WEST BELFAST" → "BELFAST WEST"
 */
import { deserialize, serialize } from 'flatgeobuf/lib/mjs/geojson.js';
import fs from 'fs';

const fgbPath = 'data/maps/parliamentary/PC1995.fgb';
const buf = fs.readFileSync(fgbPath);
const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

const features = [];
for await (const feature of deserialize(uint8)) {
    features.push(feature);
}

// Find and rename
let changed = false;
for (const f of features) {
    if (f.properties.Name === 'WEST BELFAST') {
        console.log(`Renaming: "${f.properties.Name}" → "BELFAST WEST"`);
        f.properties.Name = 'BELFAST WEST';
        changed = true;
    }
}

if (!changed) {
    console.log('No "WEST BELFAST" found — nothing to change.');
    process.exit(0);
}

// Re-serialize
const fc = { type: 'FeatureCollection', features };
const outputUint8 = serialize(fc);
fs.writeFileSync(fgbPath, Buffer.from(outputUint8));
console.log(`Written updated ${fgbPath} (${features.length} features)`);

// Verify
const verifyBuf = fs.readFileSync(fgbPath);
const verifyUint8 = new Uint8Array(verifyBuf.buffer, verifyBuf.byteOffset, verifyBuf.byteLength);
const names = [];
for await (const f of deserialize(verifyUint8)) {
    names.push(f.properties.Name);
}
console.log('Verification — all names:', names.sort().join(', '));
