#!/usr/bin/env node
/**
 * Enumerate the NISRA publications catalogue (nisra.gov.uk/publications, a
 * paginated Drupal listing — no data API is reachable). Emits a compact
 * inventory of { slug, title } for every publication, which feeds
 * emit-nisra-publication-records.mjs. Non-census filtering happens at emit time.
 *
 * Usage: node scripts/census/crawl-nisra-publications.mjs <outPath> [maxPage]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2] || 'data/census/candidates/nisra-publications.json';
const MAX_PAGE = Number(process.argv[3] || 200);
const BASE = 'https://www.nisra.gov.uk/publications';

function fetchPage(page) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return execFileSync('curl', ['-sL', '--max-time', '40', `${BASE}?page=${page}`], { maxBuffer: 64 * 1024 * 1024 }).toString();
    } catch (e) { if (attempt === 4) return ''; }
  }
  return '';
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const cardRe = /href="\/publications\/([a-z0-9-]+)">\s*<h3 class="card__title"><span>([^<]+)</g;

const byslug = new Map();
let emptyStreak = 0;
for (let page = 0; page <= MAX_PAGE; page += 1) {
  const html = fetchPage(page);
  let m, found = 0;
  while ((m = cardRe.exec(html))) {
    found += 1;
    if (!byslug.has(m[1])) byslug.set(m[1], decode(m[2]));
  }
  process.stderr.write(`\rpage ${page}: +${found} (total ${byslug.size})`);
  if (found === 0) { emptyStreak += 1; if (emptyStreak >= 2) break; } else emptyStreak = 0;
}
process.stderr.write('\n');

const publications = [...byslug].map(([slug, title]) => ({ slug, title }));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedFrom: 'nisra.gov.uk/publications', count: publications.length, publications }, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${publications.length} publications`);
