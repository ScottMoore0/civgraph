#!/usr/bin/env node
/**
 * For each non-census NISRA publication (from crawl-nisra-publications.mjs),
 * fetch its page and extract the downloadable data-file URLs
 * (/system/files/statistics/… .xlsx/.xls/.csv/.ods/.zip/.pdf). Outputs a
 * manifest { slug, title, files:[{url,ext}] } used to (a) enrich the catalogue
 * records with direct download links and (b) drive the Internet Archive mirror.
 *
 * Usage: node scripts/census/crawl-nisra-publication-files.mjs <publications.json> <outPath>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const inPath = process.argv[2];
const OUT = process.argv[3] || 'data/census/candidates/nisra-publication-files.json';
if (!inPath) { console.error('usage: crawl-nisra-publication-files.mjs <publications.json> <out>'); process.exit(1); }

const isCensus = (slug) => /^census[-0-9]|-census-|census-20\d\d/.test(slug);
const HOST = 'https://www.nisra.gov.uk';
const fileRe = /href="([^"]+\.(?:xlsx|xls|csv|ods|zip|pdf))"/gi;

function fetchPage(slug) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return execFileSync('curl', ['-sL', '--max-time', '40', `${HOST}/publications/${slug}`], { maxBuffer: 64 * 1024 * 1024 }).toString(); }
    catch (e) { if (attempt === 3) return ''; }
  }
  return '';
}

const pubs = JSON.parse(readFileSync(inPath, 'utf8')).publications.filter((p) => !isCensus(p.slug));
const out = [];
let fileTotal = 0;
for (let i = 0; i < pubs.length; i += 1) {
  const p = pubs[i];
  const html = fetchPage(p.slug);
  const seen = new Set();
  const files = [];
  let m;
  while ((m = fileRe.exec(html))) {
    let u = m[1];
    if (u.startsWith('/')) u = HOST + u;
    if (!/^https?:\/\//i.test(u)) continue;
    if (!/nisra\.gov\.uk/i.test(u)) continue; // only NISRA-hosted files
    if (seen.has(u)) continue;
    seen.add(u);
    files.push({ url: u, ext: (u.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase() });
  }
  if (files.length) { out.push({ slug: p.slug, title: p.title, files }); fileTotal += files.length; }
  if (i % 50 === 0) process.stderr.write(`\r${i}/${pubs.length} pubs, ${fileTotal} files`);
}
process.stderr.write(`\r${pubs.length}/${pubs.length} pubs, ${fileTotal} files\n`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedFrom: 'nisra.gov.uk publication pages', publicationsWithFiles: out.length, fileTotal, publications: out }, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${out.length} publications with files, ${fileTotal} files total`);
