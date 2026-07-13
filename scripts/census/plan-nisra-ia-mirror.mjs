#!/usr/bin/env node
/**
 * Plan the full NISRA data-file mirror to the Internet Archive as chunked items,
 * each small enough to stay well under IA's per-item task-queue limit. Bins
 * publications (keeping each publication's files together) into items of at most
 * MAX_FILES_PER_ITEM. Emits a committed plan that a persistent runner feeds to
 * mirror-nisra-files-to-ia.mjs one item at a time.
 *
 * Usage: node scripts/census/plan-nisra-ia-mirror.mjs <fileManifest.json> <outPath> [maxPerItem]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const inPath = process.argv[2];
const OUT = process.argv[3] || 'data/census/source-inventory/nisra-ia-mirror-plan.json';
const MAX = Number(process.argv[4] || 400);
if (!inPath) { console.error('usage: plan-nisra-ia-mirror.mjs <fileManifest.json> <out> [maxPerItem]'); process.exit(1); }

const pubs = JSON.parse(readFileSync(inPath, 'utf8')).publications;
const items = [];
let cur = null;
let n = 0;
function newItem() {
  const id = `civgraph-nisra-statistics-${String(items.length + 1).padStart(3, '0')}`;
  cur = { itemId: id, itemUrl: `https://archive.org/details/${id}`, fileCount: 0, files: [] };
  items.push(cur);
}
newItem();
for (const p of pubs) {
  if (cur.fileCount + p.files.length > MAX && cur.fileCount > 0) newItem();
  for (const f of p.files) {
    cur.files.push({ slug: p.slug, url: f.url, ext: f.ext, remoteName: `${p.slug}/${decodeURIComponent(f.url.split('/').pop())}` });
    cur.fileCount += 1;
    n += 1;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const plan = {
  generatedFrom: inPath,
  strategy: `publications binned into items of <= ${MAX} files (publications never split across items); upload with --no-derive to avoid IA per-item task-queue throttle`,
  maxFilesPerItem: MAX,
  itemCount: items.length,
  fileTotal: n,
  items,
};
writeFileSync(OUT, JSON.stringify(plan, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${n} files across ${items.length} IA items (<= ${MAX} files each).`);
