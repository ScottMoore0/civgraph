/**
 * Strip the lodRasterFallbacks arrays from the townland map entries —
 * these are pre-rendered PNG underlays that fill in the gaps where the
 * vector LOD chunks drop features at low zoom. Removing them turns the
 * townland layers back into pure vector renderings.
 *
 * The image files on R2 / git are left in place so the change is fully
 * reversible by re-instating the lodRasterFallbacks blocks.
 */
import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

let removedFromMaps = 0, removedFromVariants = 0;

function strip(obj, label) {
    if (Array.isArray(obj.lodRasterFallbacks) && obj.lodRasterFallbacks.length > 0) {
        const n = obj.lodRasterFallbacks.length;
        delete obj.lodRasterFallbacks;
        console.log(`- removed ${n} lodRasterFallbacks from ${label}`);
        return n;
    }
    return 0;
}

for (const m of db.maps) {
    // Only target townland entries to be safe — the field is currently
    // only used by townlands but this guards against hitting any future
    // user of the field with the same patch.
    const isTownland = /townland/i.test(m.id) || /townland/i.test(m.name || '');
    if (!isTownland) continue;
    if (strip(m, m.id)) removedFromMaps++;
    if (Array.isArray(m.variants)) {
        for (const v of m.variants) {
            const isVTownland = /townland/i.test(v.id || '') || /townland/i.test(v.label || '');
            if (!isVTownland) continue;
            if (strip(v, `${m.id} → variant ${v.id}`)) removedFromVariants++;
        }
    }
}

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\nDone. Stripped fallbacks from ${removedFromMaps} top-level + ${removedFromVariants} variant entries.`);
