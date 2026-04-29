// Static smoke test for PR1 of ROI Dáil integration.
// Verifies: master index has Dáil; date dirs exist; every constituency in the
// index resolves to a JSON file via slugify; FGB-name-to-index reconciliation
// works for the 2007 alias map.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MASTER = path.join(ROOT, 'election-viewer-package/data/elections_index.json');
const DAIL_DIR = path.join(ROOT, 'election-viewer-package/data/elections/dail-eireann');

const slugify = (text) => String(text)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');

const master = JSON.parse(fs.readFileSync(MASTER, 'utf-8'));
const dail = master.bodies.find(b => b.name === 'Dáil Éireann');
if (!dail) { console.error('FAIL: no Dáil body in master index'); process.exit(1); }
console.log(`OK master index has Dáil: ${dail.dates.length} dates, slug=${dail.slug}`);

let errors = 0;
let checked = 0;
for (const dateData of dail.dates) {
    const dir = path.join(DAIL_DIR, dateData.date);
    if (!fs.existsSync(dir)) {
        console.error(`FAIL: date dir missing: ${dateData.date}`);
        errors++;
        continue;
    }
    for (const cons of dateData.constituencies) {
        const slug = slugify(cons);
        const file = path.join(dir, `${slug}.json`);
        checked++;
        if (!fs.existsSync(file)) {
            console.error(`FAIL: ${dateData.date}/${cons} -> ${slug}.json not found`);
            errors++;
        }
    }
}
console.log(`Checked ${checked} constituency files; ${errors} missing.`);

// Test the alias-aware match path the engine uses for FGB feature names.
// Replicates _aliasVariants + nameAliases lookup from election-controller.js.
const aliasVariants = (name) => {
    const base = String(name || '').trim();
    const variants = new Set();
    const push = (v) => {
        if (!v) return;
        variants.add(String(v).trim());
        // Mimic _normaliseElectionName accent strip + slugify.
        const norm = String(v).normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/&/g, ' and ').replace(/['']/g, '').replace(/\([^)]*\)/g, ' ')
            .replace(/[–—]/g, '-').replace(/[^\w\s-]/g, ' ')
            .replace(/\s+/g, ' ').trim().toLowerCase();
        variants.add(norm);
        variants.add(slugify(v));
    };
    push(base);
    const stripped = base.replace(/\s*\(\d+\)\s*$/, '').trim();
    if (stripped !== base) push(stripped);
    if (/-/.test(stripped)) push(stripped.replace(/-/g, ' '));
    const compassMap = { N: 'North', S: 'South', E: 'East', W: 'West', NE: 'North East', NW: 'North West', SE: 'South East', SW: 'South West' };
    const compass = stripped.replace(/\b(NE|NW|SE|SW|N|S|E|W)\b/g, (m) => compassMap[m]);
    if (compass !== stripped) push(compass);
    return [...variants].filter(Boolean);
};

const buildAliasMap = (cons) => {
    const map = new Map();
    cons.forEach((c) => aliasVariants(c).forEach((v) => map.set(v, c)));
    return map;
};

const matchOne = (fgbName, aliasMap, geoAliases) => {
    const candidates = geoAliases?.[fgbName]
        ? [geoAliases[fgbName], fgbName]
        : [fgbName];
    for (const cand of candidates) {
        for (const v of aliasVariants(cand)) {
            const hit = aliasMap.get(v);
            if (hit) return hit;
        }
    }
    return null;
};

// 2007 sample: FGB has CON_NAME values with typos + word-order swaps.
const _2007 = dail.dates.find(d => d.date === '2007-05-24');
const map2007 = buildAliasMap(_2007.constituencies);
const aliases2007 = {
    'Cork North-Centrla': 'Cork North Central',
    'Laois-Offaly': 'Laoighis Offaly',
    'Roscommon-South Leitrim': 'Roscommon Leitrim South',
    'Sligo-North Leitrim': 'Sligo Leitrim North'
};
const fgb2007 = ['Carlow-Kilkenny', 'Cork North-Centrla', 'Laois-Offaly', 'Roscommon-South Leitrim', 'Sligo-North Leitrim', 'Dún Laoghaire'];
console.log('\n2007 FGB->index reconciliation:');
fgb2007.forEach(f => {
    const m = matchOne(f, map2007, aliases2007);
    console.log(`  ${f.padEnd(28)} -> ${m || '(NO MATCH)'}`);
    if (!m) errors++;
});

// 2020 sample: FGB has "Dublin Bay North (5)" with seat counts.
const _2020 = dail.dates.find(d => d.date === '2020-02-08');
const map2020 = buildAliasMap(_2020.constituencies);
const fgb2020 = ['Carlow-Kilkenny (5)', 'Dublin Bay North (5)', 'Dún Laoghaire (4)', 'Roscommon-Galway (3)', 'Tipperary (5)'];
console.log('\n2020 FGB->index reconciliation:');
fgb2020.forEach(f => {
    const m = matchOne(f, map2020, null);
    console.log(`  ${f.padEnd(28)} -> ${m || '(NO MATCH)'}`);
    if (!m) errors++;
});

// 2024 sample: FGB has new constituencies + ENG_NAME_VALUE attr.
const _2024 = dail.dates.find(d => d.date === '2024-11-29');
const map2024 = buildAliasMap(_2024.constituencies);
const fgb2024 = ['Wicklow-Wexford (3)', 'Tipperary North (3)', 'Tipperary South (3)', 'Dublin Fingal East (3)', 'Wexford (4)'];
console.log('\n2024 FGB->index reconciliation:');
fgb2024.forEach(f => {
    const m = matchOne(f, map2024, null);
    console.log(`  ${f.padEnd(28)} -> ${m || '(NO MATCH)'}`);
    if (!m) errors++;
});

// 1918 — every FGB feature in PC_1918_Ireland.fgb must reconcile to a 1918 scraper entry.
const _1918 = dail.dates.find(d => d.date === '1918-12-14');
const map1918 = buildAliasMap(_1918.constituencies);
const aliases1918 = {
    'Connemara': 'Galway Connemara',
    'Pembroke': 'Dublin Pembroke',
    'Rathmines': 'Dublin Rathmines',
    'Dublin County N': 'Dublin North',
    'Dublin County S': 'Dublin South',
    "Dublin St Stephen's Green": "Dublin St Stephen's",
    'Cork City': 'Cork',
    'LimerickCity': 'Limerick',
    'Londonderry City': 'Londonderry',
    'Waterford City': 'Waterford',
    'Waterford': 'Waterford County',
    'Waterford E': 'Waterford County',
    'Leitrim S': 'Leitrim',
    'Longford S': 'Longford',
    'Louth S': 'Louth',
    'Westmeath S': 'Westmeath',
    'Birr': "King's County",
    'Leix': "Queen's County"
};
const fgb1918 = fs.readFileSync(path.join(ROOT, 'fgb_1918_names.txt'), 'utf-8').trim().split('\n');
console.log(`\n1918 FGB->index reconciliation (${fgb1918.length} features):`);
let unmatched1918 = [];
fgb1918.forEach(f => {
    const m = matchOne(f, map1918, aliases1918);
    if (!m) unmatched1918.push(f);
});
if (unmatched1918.length) {
    console.log(`  ${unmatched1918.length} unmatched: ${unmatched1918.join(', ')}`);
    errors += unmatched1918.length;
} else {
    console.log(`  All ${fgb1918.length} FGB features matched.`);
}

// New national-fill bodies (Pres + EU(IE) + Ref): every (date, "Ireland") tuple
// must resolve to an ireland.json file.
for (const slug of ['ireland-president', 'ireland-european', 'ireland-referendum']) {
    const body = master.bodies.find(b => b.slug === slug);
    if (!body) { console.error(`FAIL: no body with slug ${slug}`); errors++; continue; }
    let missing = 0;
    for (const dateData of body.dates) {
        for (const cons of dateData.constituencies) {
            const file = path.join(ROOT, `election-viewer-package/data/elections/${slug}/${dateData.date}/${slugify(cons)}.json`);
            if (!fs.existsSync(file)) { missing++; }
        }
    }
    console.log(`${body.name}: ${body.dates.length} dates, ${missing} missing files`);
    errors += missing;
}

if (errors) {
    console.error(`\n${errors} failure(s).`);
    process.exit(1);
}
console.log('\nAll checks passed.');
