import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const list = JSON.parse(readFileSync('_tmp_pc2023/manifest.json', 'utf8'));

const pc = db.maps.find(m => m.id === 'pc-2023');
if (!pc) { console.error('pc-2023 not found'); process.exit(1); }

pc.sourceDownloads = pc.sourceDownloads || [];
const existingLabels = new Set(pc.sourceDownloads.map(d => d.label));

let added = 0;
for (const c of list) {
    const label = `Print-ready raster — ${c.title} (PNG)`;
    if (existingLabels.has(label)) continue;
    pc.sourceDownloads.push({
        label,
        file: `https://data.civgraph.net/data/maps/parliamentary/pc-2023-rasters/${c.slug}.png`
    });
    added++;
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`+ ${added} per-constituency PNG download links added to pc-2023`);
console.log(`  total sourceDownloads on pc-2023: ${pc.sourceDownloads.length}`);
