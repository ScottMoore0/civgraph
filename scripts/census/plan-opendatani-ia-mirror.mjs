#!/usr/bin/env node
/**
 * Plan a durability mirror of the Open Data NI resource files (linked from the
 * 902 approved catalogue records) to the Internet Archive, chunked into items
 * that stay well under IA's per-item task-queue limit. Keeps each dataset's files
 * together; bins datasets into items of at most MAX files. Non-file resources
 * (HTML landing pages) are skipped. Emits a committed plan the mirror runner (or a
 * droplet) feeds one item at a time; uploads use --no-derive and are resumable.
 *
 * Usage: node scripts/census/plan-opendatani-ia-mirror.mjs [approved.json] [out] [maxPerItem]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const IN = process.argv[2] || 'data/census/candidates/opendatani-catalogue.approved.json';
const OUT = process.argv[3] || 'data/census/candidates/opendatani-ia-mirror-plan.json';
const MAX = Number(process.argv[4] || 400);

const { sources } = JSON.parse(readFileSync(IN, 'utf8'));
const isFile = (t) => t && !['html'].includes(String(t).toLowerCase());

const items = [];
let cur = null;
function newItem() {
  const id = `civgraph-opendatani-data-${String(items.length + 1).padStart(3, '0')}`;
  cur = { itemId: id, itemUrl: `https://archive.org/details/${id}`, fileCount: 0, files: [] };
  items.push(cur);
}
newItem();
let total = 0, seen = new Set();
for (const s of sources) {
  const slug = String(s.id || '').replace('approved-publication:opendata-ni-', '') || 'dataset';
  const files = (s.downloads || []).filter((d) => isFile(d.type) && d.url);
  if (!files.length) continue;
  if (cur.fileCount + files.length > MAX && cur.fileCount > 0) newItem();
  for (const d of files) {
    const remoteName = `${slug}/${decodeURIComponent(d.url.split('/').pop() || 'file')}`.slice(0, 250);
    const dedupKey = `${cur.itemId}::${remoteName}`;
    if (seen.has(dedupKey)) continue; // avoid duplicate remote names within one item
    seen.add(dedupKey);
    cur.files.push({ slug, url: d.url, remoteName });
    cur.fileCount += 1;
    total += 1;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const plan = {
  generatedFrom: IN,
  strategy: `Open Data NI resource files binned into items of <= ${MAX} (datasets kept together); ia upload --no-derive; resumable via item metadata`,
  maxFilesPerItem: MAX,
  itemCount: items.length,
  fileTotal: total,
  items,
};
writeFileSync(OUT, JSON.stringify(plan, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${total} files across ${items.length} IA items (<= ${MAX} each).`);
