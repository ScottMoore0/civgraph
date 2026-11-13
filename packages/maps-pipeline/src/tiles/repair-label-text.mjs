#!/usr/bin/env node
/**
 * Repair label and name text in the local source FlatGeobufs, from data/database/label-text-repairs.json.
 *
 * WHY. Two kinds of damage reached the map through the source files:
 *   - U+FFFD where a fada was (a wrong-encoding decode): 249 Irish names each in cork-townlands
 *     (GLE_NAME_VALUE) and townlands-cities-and-islands (IrishName), the Paddy Matthews records;
 *     "Dún Laoghaire-Rathdown" in local-authorities-1994/2002/2008 (COUNTYNAME);
 *   - text stored decomposed ("u" + U+0301 for "ú") in eds-ulster-1912..1916, 1921-nine-county and
 *     ded-1921-05-03, so it searched and rendered differently from the same name precomposed.
 * The repairs file holds each restored reading with its evidence; this applies it. A keyed
 * reading is applied only when its confidence is in the file's apply.confidence (the owner
 * accepted the high-confidence Irish names on 12 Nov 2026); medium and open readings are held
 * back, and their sources keep the damaged text until the owner settles them.
 *
 * HOW. Each source is copied to a GeoPackage (lossless), the repairs are applied there with
 * SQL UPDATEs (SQLite, through the storage adapter), and it is written back to FlatGeobuf. Nothing else may change: the
 * script compares the result with the original feature by feature (count, order, geometry
 * bounds, every attribute except the repaired ones) and refuses to replace a file that differs.
 * Feature order matters: build-test-pmtiles injects civ_fid as the row number, and
 * townlands-cities-and-islands is keyed on it.
 *
 *   node packages/maps-pipeline/src/tiles/repair-label-text.mjs                  report only
 *   node packages/maps-pipeline/src/tiles/repair-label-text.mjs --write          repaired copies in tmp/label-text-repairs/
 *   node packages/maps-pipeline/src/tiles/repair-label-text.mjs --write --in-place   replace the sources (keeps <file>.before-label-repair)
 *   --root <dir>   where the source paths resolve (default: the current directory)
 *   --layers a,b   only these layers
 *   --repairs <file>   another repairs file (tests)
 *   --out <dir>    where --write puts the repaired copies (default tmp/label-text-repairs)
 *
 * After --in-place, rebuild the layers' PMTiles and upload them (owner approval): see LANDING.md.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openSqliteHandle } from '../../../storage/src/sqlite.mjs';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { repairApplies } from '../label-data.mjs';

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ROOT = resolve(argValue('--root') || process.cwd());
const WRITE = args.includes('--write');
const IN_PLACE = args.includes('--in-place');
const ONLY = new Set(String(argValue('--layers') || '').split(',').map((s) => s.trim()).filter(Boolean));
const REPAIRS = JSON.parse(readFileSync(resolve(process.cwd(), argValue('--repairs') || 'data/database/label-text-repairs.json'), 'utf8'));
const OUT_DIR = resolve(process.cwd(), argValue('--out') || 'tmp/label-text-repairs');

/** @typedef {{ field: string, key?: string, byKey?: Map<string, { damaged: string, value: string }>, byValue?: Record<string, string>, nfc?: boolean }} Plan */

/** @type {Map<string, { sources: string[], plans: Plan[] }>} */
const layers = new Map();
const plan = (layer, sources, p) => {
  if (ONLY.size && !ONLY.has(layer)) return;
  const entry = layers.get(layer) || { sources, plans: [] };
  entry.plans.push(p);
  layers.set(layer, entry);
};
/** @type {readonly string[] | undefined} */
const ACCEPTED = REPAIRS.apply?.confidence;
for (const [layer, spec] of Object.entries(REPAIRS.keyed || {})) {
  /** @type {Array<{ id: string | number, damaged: string, value: string, confidence?: string }>} */
  const records = spec.records;
  const applied = records.filter((r) => repairApplies(r, ACCEPTED));
  const held = records.length - applied.length;
  if (held && (!ONLY.size || ONLY.has(layer))) console.log(`${layer}: ${held} reading(s) held back (confidence not in apply.confidence: ${ACCEPTED?.join(', ')}); their sources keep the damaged text`);
  plan(layer, spec.sources, { field: spec.field, key: spec.key, byKey: new Map(applied.map((r) => [String(r.id), { damaged: r.damaged, value: r.value }])) });
}
for (const [layer, spec] of Object.entries(REPAIRS.byValue || {})) plan(layer, spec.sources, { field: spec.field, byValue: spec.values });
for (const [layer, sources] of Object.entries(REPAIRS.nfc?.layers || {})) plan(layer, sources, { field: '*', nfc: true });

let failures = 0;
for (const [layer, { sources, plans }] of layers) {
  for (const source of sources) {
    const path = resolve(ROOT, source);
    if (!existsSync(path)) { console.log(`${layer}: ${source} not on this machine; skipped`); continue; }
    try {
      const outcome = await repairFile(path, plans);
      console.log(`${layer}: ${source}: ${outcome}`);
    } catch (error) {
      failures += 1;
      console.error(`${layer}: ${source}: FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }
}
process.exit(failures ? 1 : 0);

/**
 * @param {string} path
 * @param {Plan[]} plans
 */
async function repairFile(path, plans) {
  const original = await readFeatures(path);
  const changes = planChanges(original.features, plans);
  if (!changes.size) return 'nothing to repair';
  const summary = `${changes.size} feature(s) to repair`;
  if (!WRITE) return `${summary} (report only; --write to apply)`;

  mkdirSync(OUT_DIR, { recursive: true });
  const stem = basename(path).replace(/\.fgb$/i, '');
  const gpkg = resolve(OUT_DIR, `${stem}.gpkg`);
  const out = resolve(OUT_DIR, `${stem}.fgb`);
  rmSync(gpkg, { force: true });
  rmSync(out, { force: true });
  // No R-tree: its triggers call SpatiaLite functions plain SQLite does not have.
  run('ogr2ogr', ['-f', 'GPKG', gpkg, path, '-nln', 'features', '-lco', 'SPATIAL_INDEX=NO']);

  const db = openSqliteHandle(gpkg);
  const pk = db.prepare("SELECT name FROM pragma_table_info('features') WHERE pk = 1").get()?.name || 'fid';
  db.exec('BEGIN');
  let updated = 0;
  for (const [index, fields] of changes) {
    for (const [field, value] of Object.entries(fields)) {
      // GeoPackage fids are 1-based and follow the source order.
      const result = db.prepare(`UPDATE features SET "${field.replace(/"/g, '""')}" = ? WHERE "${pk}" = ?`).run(value, index + 1);
      updated += Number(result.changes);
    }
  }
  db.exec('COMMIT');
  db.close();

  const layerName = original.layerName || stem;
  const spatialIndex = original.indexed ? 'YES' : 'NO';
  run('ogr2ogr', ['-f', 'FlatGeobuf', out, gpkg, 'features', '-nln', layerName, '-lco', `SPATIAL_INDEX=${spatialIndex}`]);
  let repaired = await readFeatures(out);
  let problem = compare(original.features, repaired.features, changes);
  if (problem && spatialIndex === 'YES') {
    // The packed index re-sorts features; if that moved any, keep the source order instead.
    rmSync(out, { force: true });
    run('ogr2ogr', ['-f', 'FlatGeobuf', out, gpkg, 'features', '-nln', layerName, '-lco', 'SPATIAL_INDEX=NO']);
    repaired = await readFeatures(out);
    problem = compare(original.features, repaired.features, changes);
  }
  rmSync(gpkg, { force: true });
  if (problem) throw new Error(`the rewritten file differs beyond the repairs (${problem}); left at ${out}, source untouched`);
  if (!IN_PLACE) return `${summary}; ${updated} value(s) written to ${out}`;
  const backup = `${path}.before-label-repair`;
  if (!existsSync(backup)) copyFileSync(path, backup);
  renameSync(out, path);
  return `${summary}; ${updated} value(s) repaired in place (original kept as ${basename(backup)})`;
}

/**
 * Which features change, and to what: Map<feature index, { field: new value }>.
 * @param {Array<{ properties: Record<string, unknown> }>} features
 * @param {Plan[]} plans
 */
function planChanges(features, plans) {
  /** @type {Map<number, Record<string, string>>} */
  const changes = new Map();
  const set = (index, field, value) => { changes.set(index, { ...(changes.get(index) || {}), [field]: value }); };
  const seenKeys = new Set();
  features.forEach((feature, index) => {
    const props = feature.properties || {};
    for (const p of plans) {
      if (p.nfc) {
        for (const [field, value] of Object.entries(props)) {
          if (typeof value === 'string' && value !== value.normalize('NFC')) set(index, field, value.normalize('NFC'));
        }
        continue;
      }
      const current = props[p.field];
      if (p.byKey && p.key) {
        const repair = p.byKey.get(String(props[p.key]));
        if (!repair) continue;
        seenKeys.add(String(props[p.key]));
        if (current === repair.value) continue; // already repaired
        if (current !== repair.damaged) throw new Error(`${p.key} ${props[p.key]}: ${p.field} is ${JSON.stringify(current)}, not the damaged ${JSON.stringify(repair.damaged)} the repair expects`);
        set(index, p.field, repair.value);
      } else if (p.byValue && typeof current === 'string' && Object.hasOwn(p.byValue, current)) {
        set(index, p.field, p.byValue[current]);
      }
    }
  });
  for (const p of plans) {
    if (!p.byKey) continue;
    const missing = [...p.byKey.keys()].filter((key) => !seenKeys.has(key));
    if (missing.length) throw new Error(`${missing.length} repair key(s) not in the file, e.g. ${p.key} ${missing[0]}`);
  }
  return changes;
}

/**
 * @param {string} path
 * @returns {Promise<{ features: Array<{ properties: Record<string, unknown>, bbox: number[] | null }>, layerName: string | null, indexed: boolean }>}
 */
async function readFeatures(path) {
  /** @type {{ name?: string | null, indexNodeSize?: number } | null} */
  let header = null;
  const features = [];
  for await (const feature of deserialize(new Uint8Array(readFileSync(path)), undefined, (h) => { header = h; })) {
    features.push({ properties: feature.properties || {}, bbox: bboxOf(feature.geometry) });
  }
  return { features, layerName: header?.name || null, indexed: Number(header?.indexNodeSize || 0) > 0 };
}

/** @param {{ coordinates?: unknown[] } | null | undefined} geometry */
function bboxOf(geometry) {
  if (!geometry) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  /** @param {unknown[]} c  a position, or an array of nested positions */
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      const x = c[0]; const y = Number(c[1]);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      return;
    }
    for (const part of c) walk(/** @type {unknown[]} */ (part));
  };
  walk(geometry.coordinates || []);
  return [minX, minY, maxX, maxY].map((n) => Math.round(n * 1e7) / 1e7);
}

/**
 * Null when `after` is `before` with exactly the planned changes; otherwise what differs.
 * @param {Array<{ properties: Record<string, unknown>, bbox: number[] | null }>} before
 * @param {Array<{ properties: Record<string, unknown>, bbox: number[] | null }>} after
 * @param {Map<number, Record<string, string>>} changes
 */
function compare(before, after, changes) {
  if (before.length !== after.length) return `${before.length} features became ${after.length}`;
  for (let i = 0; i < before.length; i += 1) {
    if (JSON.stringify(before[i].bbox) !== JSON.stringify(after[i].bbox)) return `feature ${i} moved or changed shape`;
    const expected = { ...before[i].properties, ...(changes.get(i) || {}) };
    for (const [key, value] of Object.entries(expected)) {
      const got = after[i].properties[key];
      if (!sameValue(value, got)) return `feature ${i} ${key}: ${JSON.stringify(value)} became ${JSON.stringify(got)}`;
    }
  }
  return null;
}

/** @param {unknown} a @param {unknown} b */
function sameValue(a, b) {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a));
  return String(a) === String(b);
}

/** @param {string} command @param {string[]} commandArgs */
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}

