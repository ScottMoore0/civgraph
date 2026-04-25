import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));
const BASE = 'https://data.civgraph.net/data/maps/townlands/backstops';

const cfg = {
    'ni-townlands': [
        { level: 'z7',  fgb: `${BASE}/ni-townlands-backstop-z7.fgb`,  maxZoom: 8  },
        { level: 'z10', fgb: `${BASE}/ni-townlands-backstop-z10.fgb`, maxZoom: 11 }
    ],
    'roi-townlands': [
        { level: 'z7',  fgb: `${BASE}/roi-townlands-backstop-z7.fgb`,  maxZoom: 8  },
        { level: 'z10', fgb: `${BASE}/roi-townlands-backstop-z10.fgb`, maxZoom: 11 }
    ],
    'all-ireland-townlands': [
        { level: 'z7',  fgb: `${BASE}/all-ireland-townlands-backstop-z7.fgb`,  maxZoom: 8  },
        { level: 'z10', fgb: `${BASE}/all-ireland-townlands-backstop-z10.fgb`, maxZoom: 11 }
    ]
};

let updated = 0;
function setBackstop(node, key) {
    if (!cfg[key]) return;
    node.lodVectorBackstops = cfg[key];
    console.log(`+ lodVectorBackstops on ${key} (${cfg[key].length} levels)`);
    updated++;
}

for (const m of db.maps) {
    if (cfg[m.id]) setBackstop(m, m.id);
    if (Array.isArray(m.variants)) {
        for (const v of m.variants) {
            if (cfg[v.id]) setBackstop(v, v.id);
        }
    }
}
writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\nDone. ${updated} entries updated.`);
