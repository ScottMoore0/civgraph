#!/usr/bin/env node
/**
 * Prove the split election provenance holds exactly what a single file held: reassemble the index
 * and its per-decade parts (packages/loader/src/election-provenance.mjs readProvenance) and compare
 * them with a single election-provenance.json, entry by entry, then as text.
 *
 *   node scripts/records/provenance-parity.mjs <single-file.json> [--file <index.json>] [--part-dir <dir>]
 *
 * --file and --part-dir default to the record build's locations (recordPaths). Compared: every head
 * field (generatedAt is reported, not compared: a rebuild stamps a new time), the number of contests,
 * each contest record at each position (JSON text, so key order counts too), and the text the single
 * file is written as (publishedText) with generatedAt aligned. Exits 1 on the first kind of
 * difference, listing up to 20 contests.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { publishedText, readProvenance } from '../../packages/loader/src/election-provenance.mjs';
import { recordPaths, rel } from '../../packages/loader/src/paths.mjs';

const args = process.argv.slice(2);
const option = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const single = args.find((a, i) => !a.startsWith('--') && !['--file', '--part-dir'].includes(args[i - 1] ?? ''));
if (!single) {
  console.error('usage: node scripts/records/provenance-parity.mjs <single-file.json> [--file <index.json>] [--part-dir <dir>]');
  process.exit(2);
}
const P = recordPaths();
const where = { file: path.resolve(option('--file') ?? P.PROVENANCE_FILE), partDir: path.resolve(option('--part-dir') ?? P.PROVENANCE_PART_DIR) };

const singleText = readFileSync(single, 'utf8').replace(/\r\n/g, '\n');
/** @type {import('../../packages/loader/src/election-provenance.mjs').ProvenanceDocument} */
const before = JSON.parse(singleText);
if (!Array.isArray(before.contests)) {
  console.error(`${single} is not a single provenance file (it has no contests array)`);
  process.exit(2);
}
const after = readProvenance(where);
if (!after) {
  console.error(`${rel(where.file)} does not exist`);
  process.exit(2);
}
const indexDoc = JSON.parse(readFileSync(where.file, 'utf8'));
console.log(`single file  ${single}: ${Buffer.byteLength(singleText)} bytes, ${before.contests.length} contests`);
console.log(`split form   ${rel(where.file)} + ${indexDoc.contestParts ? indexDoc.contestParts.parts.length : 0} parts in ${rel(where.partDir)}${indexDoc.contestParts ? '' : ' (this is a single file too)'}`);

/** @type {string[]} */
const problems = [];
const { contests: _b, generatedAt: beforeAt, ...beforeHead } = before;
const { contests: _a, generatedAt: afterAt, ...afterHead } = after;
if (JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(after))) problems.push(`top-level keys differ: ${Object.keys(before)} / ${Object.keys(after)}`);
for (const key of new Set([...Object.keys(beforeHead), ...Object.keys(afterHead)])) {
  if (JSON.stringify(beforeHead[key]) !== JSON.stringify(afterHead[key])) problems.push(`head field ${key} differs`);
}
if (before.contests.length !== after.contests.length) problems.push(`contests: ${before.contests.length} before, ${after.contests.length} after`);
let differing = 0;
const n = Math.min(before.contests.length, after.contests.length);
for (let i = 0; i < n; i += 1) {
  if (JSON.stringify(before.contests[i]) !== JSON.stringify(after.contests[i])) {
    differing += 1;
    if (differing <= 20) problems.push(`contest ${i} differs: ${before.contests[i].file} / ${after.contests[i].file}`);
  }
}
if (differing > 20) problems.push(`... ${differing} contests differ in all`);
const text = publishedText({ ...after, generatedAt: beforeAt });
if (text !== singleText) problems.push('the reassembled text (publishedText) is not byte-for-byte the single file');

console.log(`generatedAt  ${beforeAt} / ${afterAt}${beforeAt === afterAt ? '' : ' (not compared)'}`);
if (problems.length) {
  console.error(`\nNOT EQUAL:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nEQUAL: ${n} contests, entry by entry and in order; every head field; and the text, byte for byte (${Buffer.byteLength(text)} bytes).`);
