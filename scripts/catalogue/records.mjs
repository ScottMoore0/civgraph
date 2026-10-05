/**
 * What exists: every map the site can load, from the three places the site defines them.
 *
 *   data/database/maps.json          the maps database (most maps; hidden ones are parts of others)
 *   render/metadata/maps-test.json   layers defined only for the map renderer (3D terrain, LiDAR,
 *                                    point clouds), and their children (variantOf)
 *   data/database/data-entries.json  census statistics drawn on a boundary map
 *
 * Shared by migrate-, build- and check-catalogue.mjs so they agree on what must be placed.
 * A record's `partOf` names the map it is a part of (a county's sheet, a river basin's tile);
 * parts are reached through their parent and are not placed in the arrangement themselves.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

export function loadRecords(root = process.cwd()) {
  const maps = read(root, 'data/database/maps.json').maps;
  const layers = read(root, 'render/metadata/maps-test.json').layers || [];
  const dataEntries = Object.values(read(root, 'data/database/data-entries.json').dataEntries || {});

  const records = new Map();
  for (const m of maps) records.set(m.id, { ...m, origin: 'maps' });
  for (const l of layers) {
    const id = l.sourceMapId || l.id;
    if (records.has(id)) continue;
    records.set(id, { ...l, id, origin: 'layer', partOf: l.variantOf || undefined });
  }
  for (const e of dataEntries) if (!records.has(e.id)) records.set(e.id, { ...e, origin: 'data' });

  // Parts named by their parent (maps.json `variants`) are parts whatever their own record says.
  for (const m of maps) {
    for (const v of m.variants || []) {
      const id = typeof v === 'string' ? v : v.id;
      if (!id || id === m.id) continue;
      const rec = records.get(id);
      if (rec) rec.partOf = rec.partOf || m.id;
      else records.set(id, { id, name: v.label || v.name || id, origin: 'part', partOf: m.id });
    }
  }
  // Children of each map, in the order their parent lists them, then the renderer's children.
  const parts = new Map();
  for (const m of maps) {
    const list = (m.variants || []).map((v) => (typeof v === 'string' ? { id: v } : v)).filter((v) => v.id && v.id !== m.id);
    if (list.length) parts.set(m.id, list.map((v) => ({ id: v.id, label: v.label || v.name || records.get(v.id)?.name || v.id })));
  }
  for (const r of records.values()) {
    if (r.origin !== 'layer' || !r.partOf) continue;
    if (!parts.has(r.partOf)) parts.set(r.partOf, []);
    if (!parts.get(r.partOf).some((p) => p.id === r.id)) parts.get(r.partOf).push({ id: r.id, label: r.name });
  }
  return { records, parts };
}

/** Maps that must be placed in the arrangement: not parts, not hidden. */
export function placeable(records) {
  return [...records.values()].filter((r) => !r.partOf && !r.hidden);
}
