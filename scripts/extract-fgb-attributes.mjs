import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import fs from 'fs';
import path from 'path';

const files = ['PC1970.fgb', 'PC1982.fgb', 'PC1995.fgb', 'PC2008.fgb', 'PC2023.fgb'];
const baseDir = 'data/maps/parliamentary';
const outDir = 'data/maps/parliamentary/attribute-tables';

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function extractAttributes(filename) {
    const fgbPath = path.join(baseDir, filename);
    const buf = fs.readFileSync(fgbPath);
    const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const features = [];
    for await (const feature of deserialize(uint8)) {
        features.push(feature);
    }

    if (features.length === 0) {
        console.log(filename + ': No features found');
        return;
    }

    // Get all unique property keys
    const allKeys = new Set();
    features.forEach(f => Object.keys(f.properties || {}).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);

    // Build CSV
    const csvLines = [];
    csvLines.push(keys.join(','));
    features.forEach(f => {
        const row = keys.map(k => {
            const val = f.properties?.[k];
            if (val === null || val === undefined) return '';
            const s = String(val);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        });
        csvLines.push(row.join(','));
    });

    const outPath = path.join(outDir, filename.replace('.fgb', '_attributes.csv'));
    fs.writeFileSync(outPath, csvLines.join('\n'), 'utf8');
    console.log(`${filename}: ${features.length} features, ${keys.length} columns => ${outPath}`);
    console.log(`  Columns: ${keys.join(', ')}`);
}

for (const f of files) {
    await extractAttributes(f);
}
