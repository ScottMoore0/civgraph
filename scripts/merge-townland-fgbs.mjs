/**
 * Merge all 32 county townland FGB files into a single all-Ireland FGB.
 * 
 * Two-phase approach to avoid memory exhaustion:
 *   Phase 1: Read each FGB, normalise properties, write features as newline-delimited GeoJSON
 *   Phase 2: Read the NDJSON back and serialize to a single FGB
 *
 * Usage:  node --max-old-space-size=4096 scripts/merge-townland-fgbs.mjs
 * Output: data/maps/townlands/Townlands_AllIreland.fgb
 */

import { deserialize, serialize } from 'flatgeobuf/lib/mjs/geojson.js';
import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const TOWNLANDS_DIR = 'data/maps/townlands';
const OUTPUT_FILE = path.join(TOWNLANDS_DIR, 'Townlands_AllIreland.fgb');
const TEMP_NDJSON = path.join(TOWNLANDS_DIR, '_merge_temp.ndjson');

const COUNTY_MAP = {
    'AntrimTownlands.fgb': 'Antrim',
    'ArmaghTownlands.fgb': 'Armagh',
    'DownTownlands.fgb': 'Down',
    'FermanaghTownlands.fgb': 'Fermanagh',
    'LondonderryTownlands.fgb': 'Londonderry',
    'TyroneTownlands.fgb': 'Tyrone',
    'Townlands_Carlow.fgb': 'Carlow',
    'Townlands_Cavan.fgb': 'Cavan',
    'Townlands_Clare.fgb': 'Clare',
    'Townlands_Cork.fgb': 'Cork',
    'Townlands_Donegal.fgb': 'Donegal',
    'Townlands_Dublin.fgb': 'Dublin',
    'Townlands_Galway.fgb': 'Galway',
    'Townlands_Kerry.fgb': 'Kerry',
    'Townlands_Kildare.fgb': 'Kildare',
    'Townlands_Kilkenny.fgb': 'Kilkenny',
    'Townlands_Laois.fgb': 'Laois',
    'Townlands_Leitrim.fgb': 'Leitrim',
    'Townlands_Limerick.fgb': 'Limerick',
    'Townlands_Longford.fgb': 'Longford',
    'Townlands_Louth.fgb': 'Louth',
    'Townlands_Mayo.fgb': 'Mayo',
    'Townlands_Meath.fgb': 'Meath',
    'Townlands_Monaghan.fgb': 'Monaghan',
    'Townlands_Offaly.fgb': 'Offaly',
    'Townlands_Roscommon.fgb': 'Roscommon',
    'Townlands_Sligo.fgb': 'Sligo',
    'Townlands_Tipperary.fgb': 'Tipperary',
    'Townlands_Waterford.fgb': 'Waterford',
    'Townlands_Westmeath.fgb': 'Westmeath',
    'Townlands_Wexford.fgb': 'Wexford',
    'Townlands_Wicklow.fgb': 'Wicklow',
};

const NI_FILES = new Set([
    'AntrimTownlands.fgb', 'ArmaghTownlands.fgb', 'DownTownlands.fgb',
    'FermanaghTownlands.fgb', 'LondonderryTownlands.fgb', 'TyroneTownlands.fgb'
]);

// ── Phase 1: Stream each FGB → NDJSON ──

async function phase1() {
    const ws = fs.createWriteStream(TEMP_NDJSON);
    let totalWritten = 0;

    for (const [filename, county] of Object.entries(COUNTY_MAP)) {
        const fgbPath = path.join(TOWNLANDS_DIR, filename);
        if (!fs.existsSync(fgbPath)) { console.warn(`⚠  Missing: ${fgbPath}`); continue; }

        const isNI = NI_FILES.has(filename);
        const buf = fs.readFileSync(fgbPath);
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);

        let count = 0;
        try {
            for await (const feature of deserialize(new Uint8Array(ab))) {
                const props = feature.properties || {};
                feature.properties = {
                    Name: isNI ? (props.TownlandName || '') : (props.ENG_NAME_VALUE || ''),
                    County: county,
                    IrishName: isNI ? '' : (props.GLE_NAME_VALUE || ''),
                };
                ws.write(JSON.stringify(feature) + '\n');
                count++;
            }
        } catch (err) {
            console.warn(`   ⚠  Partial read of ${filename} (got ${count}, error: ${err.message})`);
        }

        totalWritten += count;
        console.log(`✓  ${county}: ${count.toLocaleString()} (total: ${totalWritten.toLocaleString()})`);
    }

    // Wait for write stream to finish
    await new Promise((resolve, reject) => {
        ws.end(resolve);
        ws.on('error', reject);
    });

    console.log(`\nPhase 1 complete: ${totalWritten.toLocaleString()} features → ${TEMP_NDJSON}`);
    return totalWritten;
}

// ── Phase 2: Read NDJSON → serialize to FGB ──

async function phase2(expectedCount) {
    console.log('\nPhase 2: Reading NDJSON and serializing to FGB...');

    const features = [];
    const rl = createInterface({ input: createReadStream(TEMP_NDJSON), crlfDelay: Infinity });

    for await (const line of rl) {
        if (line.trim()) {
            features.push(JSON.parse(line));
        }
    }

    console.log(`Read ${features.length.toLocaleString()} features from NDJSON`);
    console.log('Serializing to FGB (this may take a moment)...');

    const fc = { type: 'FeatureCollection', features };
    const fgbBytes = serialize(fc);

    const outputBuffer = fgbBytes instanceof Uint8Array
        ? Buffer.from(fgbBytes.buffer, fgbBytes.byteOffset, fgbBytes.byteLength)
        : Buffer.from(fgbBytes);

    fs.writeFileSync(OUTPUT_FILE, outputBuffer);

    // Cleanup temp
    fs.unlinkSync(TEMP_NDJSON);

    const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`✓  Written ${OUTPUT_FILE} (${sizeMB} MB, ${features.length.toLocaleString()} features)`);
}

async function main() {
    const count = await phase1();
    await phase2(count);
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
