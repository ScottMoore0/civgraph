#!/usr/bin/env node
/**
 * npm run build:licence-page -- write the per-source licence list on the Licence page from the
 * public source ledger.
 *
 * site/pages/licence.html carries a region
 *
 *   <!-- licence:sources -->
 *   ...generated...
 *   <!-- /licence:sources -->
 *
 * which this fills from data/database/source-ledger.json: one block per rights value (the
 * ledger's OPEN_RIGHTS enum), in the order of RIGHTS below, each naming the licence, what it
 * lets a reader do, how to credit it, and the ledger's sources under it. The ledger lists only
 * sources whose content Civgraph may make public, so everything it names may be listed here.
 *
 * Every rights value the ledger may use must have wording in RIGHTS: a new value fails the build
 * rather than appearing on the page unexplained (the licence-page unit test holds this).
 *
 *   node scripts/build/build-licence-page.mjs           rewrite the region
 *   node scripts/build/build-licence-page.mjs --check   fail if the page is out of date
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEDGER = path.join(ROOT, 'data', 'database', 'source-ledger.json');
export const PAGE = path.join(ROOT, 'site', 'pages', 'licence.html');
export const REGION = /(<!-- licence:sources -->)[\s\S]*?(<!-- \/licence:sources -->)/;

/**
 * Wording for each rights value, in page order. `credit` is the attribution line a reuser
 * gives; {publisher} is the source's publisher.
 * @type {Record<string, { title: string, url?: string, may: string, credit: string }>}
 */
export const RIGHTS = {
  'OGL-3.0': {
    title: 'Open Government Licence v3.0',
    url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    may: 'Copy, publish, adapt and use commercially, as long as you credit the source.',
    credit: 'Contains public sector information licensed under the Open Government Licence v3.0. Source: {publisher}.',
  },
  'OPL-3.0': {
    title: 'Open Parliament Licence v3.0',
    url: 'https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/',
    may: 'Copy, publish, adapt and use commercially, as long as you credit the source.',
    credit: 'Contains Parliamentary information licensed under the Open Parliament Licence v3.0. Source: {publisher}.',
  },
  'PSI-open': {
    title: 'Irish public sector information, open re-use terms',
    may: 'Re-use under the publisher\'s own terms, made under the Irish re-use of public sector information rules. Most are Creative Commons Attribution 4.0; the Houses of the Oireachtas use their own PSI licence. Check the publisher\'s terms before you reuse.',
    credit: 'Source: {publisher}, re-used under its public sector information terms.',
  },
  'CC-BY-4.0': {
    title: 'Creative Commons Attribution 4.0 (CC BY 4.0)',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    may: 'Copy, publish, adapt and use commercially, as long as you credit the source and say if you changed it.',
    credit: 'Source: {publisher}, licensed under CC BY 4.0.',
  },
  'CC-BY-SA': {
    title: 'Creative Commons Attribution-ShareAlike (CC BY-SA)',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    may: 'Copy, publish, adapt and use commercially, as long as you credit the source and release what you make from it under the same licence.',
    credit: 'Source: {publisher}, licensed under CC BY-SA.',
  },
  ODbL: {
    title: 'Open Database Licence (ODbL)',
    url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    may: 'Copy, publish, adapt and use commercially, as long as you credit the source and release any adapted database under the ODbL.',
    credit: 'Source: {publisher}, licensed under the ODbL.',
  },
  CC0: {
    title: 'CC0 (no rights reserved)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    may: 'Anything, with no conditions. A credit is still appreciated.',
    credit: 'Source: {publisher} (CC0).',
  },
  'public-domain': {
    title: 'Public domain',
    may: 'Anything, with no conditions.',
    credit: 'Source: {publisher} (public domain).',
  },
  'crown-copyright-expired': {
    title: 'Crown copyright, expired',
    may: 'Anything: the copyright has run out. Civgraph claims no copyright in its scans of these works.',
    credit: 'Source: {publisher}.',
  },
  'copyright-expired': {
    title: 'State copyright, expired',
    may: 'Anything: the copyright has run out. Civgraph claims no copyright in its scans of these works.',
    credit: 'Source: {publisher}.',
  },
  'open-other': {
    title: 'Other open licence (named by the publisher)',
    may: 'Free reuse under the publisher\'s own open licence, which usually asks for a credit in a set form. Follow the link to its terms.',
    credit: 'As the publisher\'s licence requires. Source: {publisher}.',
  },
  'own-work': {
    title: 'Civgraph\'s own work and contributed work',
    may: 'CC BY 4.0, unless the map or record names another licence: see "Civgraph\'s own work" and "Where a record says otherwise" above.',
    credit: 'Civgraph (civgraph.net) and its named contributors.',
  },
};

/** @param {unknown} s */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The generated region's inner HTML.
 * @param {{ asOf?: string, sources: Array<{ id: string, name: string, publisher: string, url?: string, rights: string }> }} ledger
 */
export function renderSources(ledger) {
  const unknown = [...new Set(ledger.sources.map((s) => s.rights))].filter((r) => !RIGHTS[r]);
  if (unknown.length) throw new Error(`source ledger rights with no wording in RIGHTS: ${unknown.join(', ')}`);
  const lines = [
    `<p class="manifest-status">Generated from the public source ledger (<code>data/database/source-ledger.json</code>), as of ${esc(ledger.asOf || '')}: ${ledger.sources.length} sources.</p>`,
  ];
  for (const [rights, w] of Object.entries(RIGHTS)) {
    const group = ledger.sources.filter((s) => s.rights === rights)
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    if (!group.length) continue;
    const title = w.url ? `<a href="${esc(w.url)}" rel="noopener noreferrer" target="_blank">${esc(w.title)}</a>` : esc(w.title);
    lines.push(`<h3 id="rights-${esc(rights.toLowerCase())}">${title}</h3>`);
    lines.push(`<p>${esc(w.may)} Credit: <em>${esc(w.credit.replace('{publisher}', 'the publisher named below'))}</em></p>`);
    lines.push('<ul class="sources-list">');
    for (const s of group) {
      const name = s.url ? `<a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">${esc(s.name)}</a>` : esc(s.name);
      lines.push(`<li><strong>${name}</strong><span>${esc(s.publisher)}</span></li>`);
    }
    lines.push('</ul>');
  }
  return lines.join('\n');
}

/**
 * The page with its region replaced.
 * @param {string} page
 * @param {Parameters<typeof renderSources>[0]} ledger
 */
export function stamp(page, ledger) {
  if (!REGION.test(page)) throw new Error('site/pages/licence.html has no <!-- licence:sources --> ... <!-- /licence:sources --> region');
  const eol = page.includes('\r\n') ? '\r\n' : '\n';
  return page.replace(REGION, (/** @type {string} */ _, /** @type {string} */ open, /** @type {string} */ close) => `${open}\n${renderSources(ledger)}\n${close}`.replace(/\n/g, eol));
}

function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(PAGE)) { console.error('FAIL: site/pages/licence.html does not exist'); process.exit(1); }
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const before = readFileSync(PAGE, 'utf8');
  let after;
  try { after = stamp(before, ledger); } catch (error) { console.error(`FAIL: ${/** @type {Error} */ (error).message}`); process.exit(1); }
  if (check) {
    if (after !== before) {
      console.error('FAIL: site/pages/licence.html does not match the source ledger; run npm run build:licence-page');
      process.exit(1);
    }
    console.log('PASS: the Licence page lists the source ledger as it stands.');
    return;
  }
  if (after !== before) writeFileSync(PAGE, after);
  console.log(after !== before ? 'Wrote site/pages/licence.html' : 'site/pages/licence.html already current.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
