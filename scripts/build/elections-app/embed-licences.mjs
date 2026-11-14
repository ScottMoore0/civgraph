#!/usr/bin/env node
/**
 * The licences the Elections widget names (el-context, 14 Nov 2026): a slice of the public source
 * ledger (data/database/source-ledger.json) for site/apps/elections/embed/licences.json, so an
 * embedded result can say which licence each of its sources is under. One entry for each ledger
 * source that names the hosts its links are on (`match.hosts`), with the licence's title and link
 * from the Licence page's own wording (scripts/build/build-licence-page.mjs RIGHTS), never a second
 * copy of it. Civgraph's own compilation is CC BY 4.0 (site/pages/licence.html).
 *
 *   node scripts/build/elections-app/embed-licences.mjs           write the slice
 *   node scripts/build/elections-app/embed-licences.mjs --check   fail if it is out of date
 *
 * unit test elections-app-embed.test.mjs also holds the committed slice to the ledger.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER, RIGHTS } from '../build-licence-page.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const OUT = 'site/apps/elections/embed/licences.json';

/**
 * The slice's text for a ledger.
 * @param {{ sources: Array<{ id: string, publisher: string, rights: string, match?: { hosts?: string[] } }> }} ledger
 * @returns {string}
 */
export function licenceSlice(ledger) {
  const sources = ledger.sources.filter((s) => (s.match?.hosts || []).length)
    .map((s) => {
      const w = RIGHTS[s.rights];
      if (!w) throw new Error(`source ledger rights with no wording: ${s.rights} (${s.id})`);
      return { id: s.id, publisher: s.publisher, rights: s.rights, title: w.title, ...(w.url ? { url: w.url } : {}), hosts: [...(s.match?.hosts || [])].sort() };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const own = RIGHTS['CC-BY-4.0'];
  return `${JSON.stringify({
    schemaVersion: 1,
    about: 'The licence of each source the Elections widget may cite, by the hosts its links are on: a slice of data/database/source-ledger.json written by scripts/build/elections-app/embed-licences.mjs.',
    own: { title: own.title, url: own.url },
    licencePage: '/pages/licence',
    sources,
  }, null, 1)}\n`;
}

function main() {
  const text = licenceSlice(JSON.parse(readFileSync(LEDGER, 'utf8')));
  const file = path.join(REPO, OUT);
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== text) {
      console.error(`FAIL: ${OUT} does not match the source ledger; run node scripts/build/elections-app/embed-licences.mjs`);
      process.exit(1);
    }
    console.log(`PASS: ${OUT} matches the source ledger.`);
    return;
  }
  writeFileSync(file, text);
  console.log(`wrote ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
