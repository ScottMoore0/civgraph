#!/usr/bin/env node
/**
 * A composite layer must be assembled from the province archives its build spec names.
 *
 * WHY. Composite ED layers are stitched from four province archives, and which archive
 * belongs to which year is a research judgement recorded only in Phelim's build-spec
 * notes. Nothing in the geometry says a 1941 map should use the 1921 Ulster set, so a
 * wrong alias target is invisible: the layer renders, the tiles resolve, the alias
 * invariant holds, and the map is simply of the wrong year.
 *
 * On 2026-08-03 eleven of 56 alias records were pointing at the wrong province archive.
 * Ten Ulster aliases covering 1941-1957 served post-1963 boundaries while each layer's
 * own description told the reader they were 1921 ones. Nothing detected it for the month
 * the delivery sat unprocessed, and it was found only by reading the notes.
 *
 * Compares live alias targets against data/intake/*-ed-composition-specs.json, which is
 * produced by parse-phelim-ed-notes.mjs from the notes shipped with each delivery.
 *
 * A SECOND invariant, added 2026-08-05. A group in data/database/maps.json carries both
 * members[] and variants[]. app.loadMap() checks members[] FIRST and returns before it
 * ever reads variants[], so when the two disagree the members win silently. eds-roi-1931
 * and eds-roi-1936 both listed the 1941 members while their own variants[] were correct:
 * both entries rendered 1941 geometry under a correctly-labelled 1931/1936 heading. The
 * title came from the requested group, the map came from another one, and no existing
 * check compared the two arrays -- the alias check above reads a different file entirely.
 *
 * Usage: node scripts/validate-composite-composition.mjs [--index <path>] [--intake-dir <path>] [--maps <path>]
 *
 * The path arguments exist so tests can point at copies under a temporary directory. A
 * check that can only be exercised by editing a tracked file and reverting it afterwards
 * is a check nobody tests.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.cwd());

function readPathArg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : resolve(ROOT, fallback);
}

const INTAKE_DIR = readPathArg('--intake-dir', 'data/intake');
const INDEX = readPathArg('--index', 'render/metadata/maps-test-index.json');

if (!existsSync(INTAKE_DIR) || !existsSync(INDEX)) {
  console.log('validate-composite-composition: no intake specs or metadata index; nothing to check.');
  process.exit(0);
}

// --- Invariant 2: a group's members[] must name its own variants[] ---
const MAPS = readPathArg('--maps', join(ROOT, 'data/database/maps.json'));
const memberProblems = [];
let groupsChecked = 0;
if (existsSync(MAPS)) {
  const mapsDoc = JSON.parse(readFileSync(MAPS, 'utf8'));
  const entries = Array.isArray(mapsDoc) ? mapsDoc : (mapsDoc.maps || mapsDoc.layers || []);
  for (const group of entries) {
    if (!group || !group.isGroup) continue;
    if (!Array.isArray(group.members) || !group.members.length) continue;
    const variantIds = (group.variants || []).map((v) => v && v.id).filter(Boolean);
    if (!variantIds.length) continue;
    groupsChecked += 1;
    const stray = group.members.filter((m) => !variantIds.includes(m));
    if (stray.length) {
      memberProblems.push(
        `${group.id}: members[] names ${stray.join(', ')}, which are not among its own `
        + `variants[] (${variantIds.join(', ')}). loadMap() honours members[], so this `
        + `group renders another group's geometry.`
      );
    }
  }
}
console.log(`Group composition: ${groupsChecked} group(s) checked for members/variants agreement.`);
if (memberProblems.length) {
  console.error('');
  console.error(`${memberProblems.length} group(s) whose members[] disagree with variants[]:`);
  for (const p of memberProblems) console.error(`- ${p}`);
  console.error('');
  console.error('Fix: set members[] to the group own variant ids (the group id year).');
  process.exit(1);
}

const specFiles = readdirSync(INTAKE_DIR).filter((f) => f.endsWith('-ed-composition-specs.json')).sort();
if (!specFiles.length) {
  console.log('validate-composite-composition: no composition specs committed; nothing to check.');
  process.exit(0);
}

const index = JSON.parse(readFileSync(INDEX, 'utf8'));
const byId = new Map((index.layers || []).map((l) => [l.id, l]));

let checked = 0;
const problems = [];
for (const file of specFiles) {
  const doc = JSON.parse(readFileSync(join(INTAKE_DIR, file), 'utf8'));
  for (const spec of doc.specs || []) {
    for (const part of spec.composition || []) {
      if (!part.layerId) continue;
      const province = part.layerId.split('-')[1];
      const alias = byId.get(`eds-roi-${spec.year}-${province}-alias-test`);
      if (!alias) continue;
      checked += 1;
      const actual = String(alias.aliasTargetLayerId || '').replace(/-vector-test$/, '');
      if (actual && actual !== part.layerId) {
        problems.push(`${spec.year} ${province}: spec says ${part.layerId}, alias targets ${actual} (${spec.noteFile})`);
      }
    }
  }
}

console.log(`Composite composition: ${checked} alias part(s) checked against ${specFiles.length} spec file(s).`);
if (problems.length) {
  console.error(`\n${problems.length} composition mismatch(es):`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log('All composite compositions match their build specs.');
