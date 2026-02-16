/**
 * Cross-reference election viewer constituency names against FGB map names.
 * Identifies mismatches for the election → FGB geography mapping.
 */
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import fs from 'fs';
import path from 'path';

// ── Geography mapping (from the election viewer integration plan) ──
const GEOGRAPHY_MAP = {
    // NI Assembly
    'northern-ireland-assembly/2022-05-05': 'PC2008.fgb',
    'northern-ireland-assembly/2017-03-02': 'PC2008.fgb',
    'northern-ireland-assembly/2016-05-05': 'PC2008.fgb',
    'northern-ireland-assembly/2011-05-05': 'PC1995.fgb',
    'northern-ireland-assembly/2007-03-07': 'PC1995.fgb',
    'northern-ireland-assembly/2003-11-26': 'PC1995.fgb',
    'northern-ireland-assembly/1998-06-25': 'PC1995.fgb',
    'northern-ireland-assembly/1982-10-20': 'PC1982.fgb',
    'northern-ireland-assembly/1973-06-28': 'PC1970.fgb',
    // By-elections
    'northern-ireland-assembly/1985-10-17': 'PC1982.fgb',
    'northern-ireland-assembly/1984-03-01': 'PC1982.fgb',
    'northern-ireland-assembly/1983-04-27': 'PC1982.fgb',
    'northern-ireland-assembly/1974-06-20': 'PC1970.fgb',
    // Westminster
    'house-of-commons-of-the-united-kingdom/2024-07-04': 'PC2023.fgb',
    'house-of-commons-of-the-united-kingdom/2019-12-12': 'PC2008.fgb',
    'house-of-commons-of-the-united-kingdom/2017-06-08': 'PC2008.fgb',
    'house-of-commons-of-the-united-kingdom/2015-05-07': 'PC2008.fgb',
    'house-of-commons-of-the-united-kingdom/2010-05-06': 'PC2008.fgb',
    'house-of-commons-of-the-united-kingdom/2005-05-05': 'PC2008.fgb',
    'house-of-commons-of-the-united-kingdom/2001-06-07': 'PC2008.fgb',
    'house-of-commons-of-the-united-kingdom/1997-05-01': 'PC1995.fgb',
    'house-of-commons-of-the-united-kingdom/1992-04-09': 'PC1982.fgb',
    'house-of-commons-of-the-united-kingdom/1987-06-11': 'PC1982.fgb',
    'house-of-commons-of-the-united-kingdom/1983-06-09': 'PC1982.fgb',
    'house-of-commons-of-the-united-kingdom/1979-05-03': 'PC1970.fgb',
    'house-of-commons-of-the-united-kingdom/1974-10-10': 'PC1970.fgb',
    'house-of-commons-of-the-united-kingdom/1974-02-28': 'PC1970.fgb',
    'house-of-commons-of-the-united-kingdom/1970-06-18': 'PC1970.fgb',
    // Constitutional Convention
    'northern-ireland-constitutional-convention/1975-05-01': 'PC1970.fgb',
    // Forum
    'northern-ireland-forum-for-political-dialogue/1996-05-30': 'PC1995.fgb',
    // European Parliament - single NI feature, skip
};

// ── Step 1: Load all FGB name sets ──
const fgbDir = 'data/maps/parliamentary';
const fgbNames = {};

async function loadFgbNames(filename) {
    const buf = fs.readFileSync(path.join(fgbDir, filename));
    const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const names = [];
    for await (const feature of deserialize(uint8)) {
        const p = feature.properties;
        const name = p.PC_NAME || p.Name || '';
        names.push(name);
    }
    return names;
}

// ── Step 2: Load election index ──
const index = JSON.parse(fs.readFileSync('election-viewer-package/data/elections_index.json', 'utf8'));

// ── Step 3: Cross-reference ──
async function analyze() {
    // Load all unique FGB files
    const uniqueFgbs = [...new Set(Object.values(GEOGRAPHY_MAP))];
    for (const fgb of uniqueFgbs) {
        fgbNames[fgb] = await loadFgbNames(fgb);
    }

    console.log('=== FGB Name Sets ===\n');
    for (const [fgb, names] of Object.entries(fgbNames)) {
        console.log(`${fgb} (${names.length} features):`);
        names.sort().forEach(n => console.log(`  ${n}`));
        console.log('');
    }

    console.log('\n=== Discrepancy Analysis ===\n');

    const allDiscrepancies = [];

    for (const body of index.bodies) {
        for (const dateEntry of body.dates) {
            const key = `${body.slug}/${dateEntry.date}`;
            const fgb = GEOGRAPHY_MAP[key];

            if (!fgb) {
                // European Parliament or unmapped
                if (body.slug !== 'european-parliament') {
                    console.log(`⚠ UNMAPPED: ${key}`);
                }
                continue;
            }

            const mapNames = fgbNames[fgb];
            if (!mapNames) {
                console.log(`❌ FGB NOT FOUND: ${fgb} for ${key}`);
                continue;
            }

            const mapNamesUpper = mapNames.map(n => n.toUpperCase());

            for (const electionName of dateEntry.constituencies) {
                const electionNameUpper = electionName.toUpperCase();

                if (!mapNamesUpper.includes(electionNameUpper)) {
                    // Try to find close matches
                    const close = mapNames.filter(m =>
                        m.toUpperCase().includes(electionNameUpper.split(' ')[0]) ||
                        electionNameUpper.includes(m.toUpperCase().split(' ')[0])
                    );

                    allDiscrepancies.push({
                        election: key,
                        electionName: electionName,
                        fgb: fgb,
                        closestFgbNames: close.length > 0 ? close.join('; ') : 'NONE'
                    });
                }
            }
        }
    }

    if (allDiscrepancies.length === 0) {
        console.log('✅ No discrepancies found! All election names match FGB names (case-insensitive).');
    } else {
        console.log(`Found ${allDiscrepancies.length} discrepancies:\n`);

        // Group by FGB + discrepancy
        const grouped = {};
        for (const d of allDiscrepancies) {
            const key = `${d.electionName} ↔ ${d.fgb}`;
            if (!grouped[key]) grouped[key] = { ...d, elections: [] };
            grouped[key].elections.push(d.election);
        }

        // CSV output
        const csvLines = ['election_name,fgb_file,closest_fgb_match,affected_elections'];
        for (const g of Object.values(grouped)) {
            csvLines.push(`"${g.electionName}","${g.fgb}","${g.closestFgbNames}","${g.elections.join('; ')}"`);
            console.log(`❌ Election name: "${g.electionName}"`);
            console.log(`   FGB file: ${g.fgb}`);
            console.log(`   Closest FGB match: ${g.closestFgbNames}`);
            console.log(`   Affected elections: ${g.elections.join(', ')}`);
            console.log('');
        }

        const outPath = 'data/maps/parliamentary/attribute-tables/name_discrepancies.csv';
        fs.writeFileSync(outPath, csvLines.join('\n'), 'utf8');
        console.log(`\nDiscrepancies saved to ${outPath}`);
    }
}

analyze();
