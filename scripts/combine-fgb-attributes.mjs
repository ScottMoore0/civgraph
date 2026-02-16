import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import fs from 'fs';
import path from 'path';

const files = ['PC1970.fgb', 'PC1982.fgb', 'PC1995.fgb', 'PC2008.fgb', 'PC2023.fgb'];
const baseDir = 'data/maps/parliamentary';

async function extractAll() {
    const allRows = [];

    for (const filename of files) {
        const fgbPath = path.join(baseDir, filename);
        const buf = fs.readFileSync(fgbPath);
        const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

        for await (const feature of deserialize(uint8)) {
            const p = feature.properties || {};
            // Normalise name column
            const name = p.PC_NAME || p.Name || '';
            const code = p.PC_Code || p.PC_ID || '';
            allRows.push({
                source_fgb: filename,
                name,
                code,
                objectid: p.OBJECTID ?? p.id ?? '',
                area_sqkm: p.Area_sqkm ?? '',
                shape_length: p.Shape_Length ?? '',
                shape_area: p.Shape_Area ?? '',
                minElev_m: p.minElev_m ?? '',
                maxElev_m: p.maxElev_m ?? '',
                minElev_ft: p.minElev_ft ?? '',
                maxElev_ft: p.maxElev_ft ?? '',
            });
        }
    }

    const cols = ['source_fgb', 'name', 'code', 'objectid', 'area_sqkm', 'shape_length', 'shape_area', 'minElev_m', 'maxElev_m', 'minElev_ft', 'maxElev_ft'];
    const lines = [cols.join(',')];
    for (const row of allRows) {
        lines.push(cols.map(c => {
            const v = String(row[c] ?? '');
            return v.includes(',') ? `"${v}"` : v;
        }).join(','));
    }

    const outPath = path.join(baseDir, 'attribute-tables', 'all_election_maps.csv');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`Written ${allRows.length} rows to ${outPath}`);
}

extractAll();
