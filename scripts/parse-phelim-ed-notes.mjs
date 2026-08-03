#!/usr/bin/env node
/**
 * Turn Phelim's per-year ED build-spec notes into committed JSON.
 *
 * The notes are the only record of what a composite ED layer is supposed to contain.
 * Each composite is assembled from four province archives, and which archive belongs to
 * which year is a research judgement Phelim makes -- there is nothing in the geometry
 * that says so. Comparing the live alias targets against these specs on 2026-08-03 found
 * eleven layers built from the wrong province file, including ten showing post-1963
 * Ulster boundaries on maps dated from 1941.
 *
 * The notes arrive on removable media with each delivery, so parse them once and commit
 * the result; validate-composite-composition.mjs then runs offline against it.
 *
 * Usage: node scripts/parse-phelim-ed-notes.mjs <notes-dir> [--out <path>]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { writeArtefactJson } from './lib/safe-artefact-write.mjs';

const args = process.argv.slice(2);
const NOTES_DIR = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const OUT = resolve(outIdx >= 0 ? args[outIdx + 1] : 'data/intake/2026-07-26-ed-composition-specs.json');

if (!NOTES_DIR || !existsSync(NOTES_DIR)) {
  console.error('Usage: node scripts/parse-phelim-ed-notes.mjs <notes-dir> [--out <path>]');
  process.exit(1);
}

// Province archive filename -> catalogue layer id. Phelim names files by the year the
// boundary set was surveyed; the catalogue names layers by the year they are published
// under. DEDs_Connacht_1963 is the one place these disagree: he confirmed on 2026-08-03
// that the file is the 1957 set and the year in the filename is a slip carried over from
// the Ulster series, which genuinely does change in 1963.
const SOURCE_TO_LAYER = { DEDs_Connacht_1963: 'eds-connacht-1957', DEDs_Connacht_1957: 'eds-connacht-1957' };
const PROVINCES = ['Leinster', 'Munster', 'Connacht', 'Ulster'];
function resolveLayerId(sourceName) {
  if (SOURCE_TO_LAYER[sourceName]) return SOURCE_TO_LAYER[sourceName];
  const m = sourceName.match(/^(?:Wards_)?(?:DEDs|EDs)_([A-Za-z]+)_(\d{4})$/);
  if (m && PROVINCES.includes(m[1])) return `eds-${m[1].toLowerCase()}-${m[2]}`;
  return null;
}

const field = (text, label) => {
  const prefix = new RegExp(`^${label}\\s*-\\s*`);
  const line = text.split(/\r?\n/).find((l) => prefix.test(l));
  return line ? line.replace(prefix, '').trim() : null;
};

const specs = [];
const unresolved = [];
for (const file of readdirSync(NOTES_DIR).filter((f) => f.endsWith('.txt')).sort()) {
  const text = readFileSync(join(NOTES_DIR, file), 'utf8');
  const year = (file.match(/(\d{4})/) || [])[1];
  const filesToUse = (field(text, 'Files to use') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!year || !filesToUse.length) {
    unresolved.push({ file, reason: 'no year or no "Files to use" line' });
    continue;
  }
  const composition = filesToUse.map((sourceName) => {
    const layerId = resolveLayerId(sourceName);
    if (!layerId) unresolved.push({ file, reason: `unmapped source name: ${sourceName}` });
    return { sourceName, layerId };
  });
  specs.push({
    year,
    noteFile: file,
    name: field(text, 'Name'),
    provider: field(text, 'Provider'),
    date: field(text, 'Date'),
    categoryCard: field(text, 'Category card'),
    labelAttribute: field(text, 'Attribute to use for feature labels'),
    composition
  });
}

writeArtefactJson(
  OUT,
  {
    schemaVersion: 1,
    delivery: 'Civgraph-20260726T221903Z',
    source: 'Civgraph/EDs/*.txt build-spec notes by Phelim Birch',
    parsedAt: new Date().toISOString(),
    specCount: specs.length,
    unresolved,
    specs
  },
  { collection: 'specs', idKey: 'year', label: 'ED composition specs' }
);
console.log(`Parsed ${specs.length} composition spec(s) -> ${OUT}`);
if (unresolved.length) {
  console.log(`Unresolved: ${unresolved.length}`);
  for (const u of unresolved.slice(0, 10)) console.log(`  ${u.file}: ${u.reason}`);
}
