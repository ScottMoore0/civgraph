import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

// Categorical (colorMap)
const categorical = {
    'gsni-bedrock-geology-polygons-250k': {
        property: ['MAX_PERIOD', 'MAX_ERA', 'MAX_EON'],
        palette: 'iugs',
        default: '#bdbdbd'
    },
    'gsni-superficial-geology-polygons-250k': {
        property: 'LEX_D',
        palette: 'superficial',
        default: '#bdbdbd'
    },
    'wq-surface-water-bodies-2015': {
        property: 'Stat_2015',
        palette: 'wfd',
        default: '#9e9e9e'
    }
};

for (const [id, cfg] of Object.entries(categorical)) {
    const m = db.maps.find(x => x.id === id);
    if (!m) { console.log(`! missing: ${id}`); continue; }
    m.colorMap = cfg;
    console.log(`+ colorMap on ${id}: ${cfg.palette} (${Array.isArray(cfg.property) ? cfg.property.join('->') : cfg.property})`);
}

// Continuous (colorScale) — Tellus chemistry, one flagship element per card.
// Domains use ~p2-p98 percentile range from the actual data, log-scaled where
// the distribution is heavily skewed (most chemistry is log-normal).
const continuous = {
    'gsni-tellus-stream-sediments-xrf': {
        property: 'AS', ramp: 'inferno', domain: [1, 100], logarithmic: true
    },
    'gsni-tellus-stream-sediments-xrf-set2': {
        property: 'CO', ramp: 'viridis', domain: [3, 80], logarithmic: false
    },
    'gsni-tellus-stream-sediments-au-pge': {
        property: 'Au', ramp: 'inferno', domain: [0.5, 50], logarithmic: true
    },
    'gsni-tellus-stream-sediments-boron': {
        property: 'B', ramp: 'plasma', domain: [3, 100], logarithmic: false
    },
    'gsni-tellus-stream-waters-icp': {
        property: 'AS_', ramp: 'inferno', domain: [0.05, 5], logarithmic: true
    },
    'gsni-tellus-rural-soil-a-xrf': {
        property: 'As', ramp: 'inferno', domain: [3, 30], logarithmic: false
    },
    'gsni-tellus-rural-soil-a-aqua-regia': {
        property: 'As', ramp: 'inferno', domain: [1, 20], logarithmic: false
    },
    'gsni-tellus-rural-soil-s-aqua-regia': {
        property: 'Pb', ramp: 'magma', domain: [5, 80], logarithmic: false
    },
    'gsni-tellus-rural-soil-s-near-total': {
        property: 'Pb', ramp: 'magma', domain: [5, 80], logarithmic: false
    },
    'gsni-tellus-rural-soil-s-fire-assay': {
        property: 'Auppb', ramp: 'inferno', domain: [0.1, 10], logarithmic: true
    }
};

for (const [id, cfg] of Object.entries(continuous)) {
    const m = db.maps.find(x => x.id === id);
    if (!m) { console.log(`! missing: ${id}`); continue; }
    m.colorScale = cfg;
    // Make point fillOpacity higher so the colour shows through clearly
    if (m.style && (m.style.fillOpacity == null || m.style.fillOpacity < 0.85)) {
        m.style.fillOpacity = 0.85;
    }
    console.log(`+ colorScale on ${id}: ${cfg.ramp}(${cfg.property}, ${cfg.domain[0]}..${cfg.domain[1]}${cfg.logarithmic ? ' log' : ''})`);
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\nDone. Total maps: ${db.maps.length}`);
