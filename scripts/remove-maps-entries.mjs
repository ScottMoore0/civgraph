#!/usr/bin/env node
/**
 * Remove map entries by id from data/database/maps.json in place, with a
 * minimal diff (brace-matched text splice, no full reserialize).
 * Usage: node scripts/remove-maps-entries.mjs id1 id2 ...
 */
import { readFileSync, writeFileSync } from 'fs';
const MAPS = 'data/database/maps.json';
const ids = process.argv.slice(2);
if (!ids.length) { console.error('no ids given'); process.exit(1); }

let text = readFileSync(MAPS, 'utf8');
const before = JSON.parse(text).maps.length;

for (const id of ids) {
  const needle = `"id": "${id}"`;
  const at = text.indexOf(needle);
  if (at < 0) { console.error(`  ${id}: not found`); continue; }
  // walk back to the entry's opening brace at 4-space indent
  let start = text.lastIndexOf('\n    {', at);
  // walk forward brace-matching from that {
  let i = text.indexOf('{', start);
  let depth = 0, end = -1;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) { console.error(`  ${id}: brace match failed`); continue; }
  // remove the block plus one adjacent comma (prefer the preceding ",\n")
  let cutStart = start, cutEnd = end;
  const pre = text.slice(0, start).match(/,\s*$/);
  if (pre) cutStart = start - pre[0].length;      // eat preceding comma
  else { const post = text.slice(end).match(/^\s*,/); if (post) cutEnd = end + post[0].length; } // else trailing comma
  text = text.slice(0, cutStart) + text.slice(cutEnd);
  console.log(`  removed ${id}`);
}

const parsed = JSON.parse(text); // throws if we broke the JSON
writeFileSync(MAPS, text);
console.log(`maps ${before} -> ${parsed.maps.length}`);
