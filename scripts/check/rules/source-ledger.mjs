#!/usr/bin/env node
/**
 * Validate data/database/source-ledger.json, the public ledger of Civgraph's sources: what is
 * mirrored, what is extracted and what remains.
 *
 * The ledger is published (scripts/build/site.mjs copies data/database/ into dist/), so it may
 * list ONLY sources whose content Civgraph has the right to make public: open licences (OGL,
 * OPL, Creative Commons, CC0, ODbL, Irish PSI open terms), Crown or state copyright that has
 * expired, the public domain, and the owner's own or contributed work (owner, 9 Nov 2026).
 * Sources held under any other terms (copyright books used for facts only, subscription or
 * permission-based archives, restricted, personal or unclear-rights material) are tracked in the
 * private holdings register and must not appear here, not even by name.
 *
 * Fails when:
 *   - the shape or an enum is wrong (category, rights, access, mirrored/extracted status, where);
 *   - an entry's rights are not in the open list;
 *   - an entry's id matches a source that is tracked privately only;
 *   - any text in the ledger or docs/source-ledger.md holds a local/Windows path or a word from
 *     the private-material list;
 *   - docs/source-ledger.md is not the table this script generates from the ledger.
 * Warns (never fails) when election-provenance cites a web host often (>= WARN_MIN citations)
 * that no ledger entry covers and that is not tracked privately. The provenance file is a
 * gitignored build output (npm run records:build or scripts/build/build-election-provenance.mjs);
 * when it is absent the warning step is skipped.
 *
 *   node scripts/check/rules/source-ledger.mjs           check
 *   node scripts/check/rules/source-ledger.mjs --write   refresh provenance citation counts in
 *                                                        the ledger and regenerate the docs table
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProvenance } from '../../../packages/loader/src/election-provenance.mjs';
import { PROVENANCE_FILE, rel } from '../../../packages/loader/src/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const LEDGER = path.join(ROOT, 'data', 'database', 'source-ledger.json');
export const LEDGER_MD = path.join(ROOT, 'docs', 'source-ledger.md');
const WARN_MIN = 100;

export const CATEGORIES = ['elections', 'parliaments', 'gazettes', 'newspapers', 'census-statistics',
  'boundaries-maps', 'archives', 'open-data', 'geodata', 'books-catalogues', 'place-names', 'reference'];
/** The only rights a public entry may carry. */
export const OPEN_RIGHTS = ['OGL-3.0', 'OPL-3.0', 'CC-BY-4.0', 'CC-BY-SA', 'CC0', 'ODbL', 'PSI-open',
  'crown-copyright-expired', 'copyright-expired', 'public-domain', 'own-work', 'open-other'];
export const ACCESS = ['open', 'subscription-with-permission', 'login', 'physical-visit', 'lending-only'];
export const MIRRORED = ['none', 'partial', 'complete', 'not-permitted'];
export const WHERE = ['r2', 'internet-archive', 'd1', 'local'];
export const EXTRACTED = ['not-started', 'partial', 'complete', 'reference-only', 'blocked'];

/**
 * Id tokens of sources tracked only in the private register. An entry whose id contains one of
 * these as a whole hyphen-separated token (or the multi-token phrases) fails.
 */
export const PRIVATE_ID_TOKENS = ['walker', 'gallagher', 'elliott', 'flackes', 'boylan', 'dib', 'hop',
  'electionsireland', 'irelandelection', 'ark', 'bna', 'ina', 'inlibrary', 'lending', 'borrow', 'rhi',
  'placenamesni', 'fusion', 'pointer', 'lps', 'ukds', 'nies', 'lucidtalk', 'polling', 'iphone',
  'whatsapp', 'qub', 'linen', 'chichester', 'newspapers', 'subscription', 'personal', 'private'];
export const PRIVATE_ID_PHRASES = ['how-ireland-voted', 'history-of-parliament', 'irish-times',
  'ireland-subset', 'libraries-ni', 'proni-viewer', 'minute-books', 'electoral-calculus',
  'british-newspaper', 'irish-newspaper', 'dictionary-of-irish-biography'];

/** Text that must never appear anywhere in the public ledger or its docs table. */
export const FORBIDDEN_TEXT = [
  [/(^|[^A-Za-z])[A-Za-z]:[\\/]/, 'a drive-letter path'],
  [/\\Users\\|\/Users\/|\/c\/Users|\/home\//i, 'a user-folder path'],
  [/OneDrive|My Drive|scratchpad|civgraph-intake|civgraph-sources|holdings-register/i, 'a local folder name'],
  [/(^|[\\/ ])Downloads[\\/]/, 'a local folder name'],
  [/\bpointer\b/i, 'Pointer'], [/\blps\b/i, 'LPS'], [/iphone|whatsapp|icloud/i, 'personal capture'],
  [/\bfusion\b/i, 'Fusion basemap'], [/uk data service|\bukds\b/i, 'UK Data Service'],
  [/lucidtalk|\bpolling\b/i, 'polling'], [/\bnies\b/i, 'NIES'], [/passport|tenancy/i, 'personal document'],
  [/cookie|storage_state|session[_ -]?(file|state)/i, 'session file'],
  [/walker|gallagher|how ireland voted|elliott|flackes|boylan|dictionary of irish biography|dib\.ie/i, 'a facts-only book'],
  [/history of parliament|historyofparliament|electionsireland|irelandelection|ark\.ac\.uk/i, 'a facts-only website'],
  [/british newspaper archive|irish newspaper archives|newspapers\.com|irish times|inlibrary|borrowable|linen hall/i, 'a permission-based or private source'],
];

/**
 * Election-provenance citation hosts tracked privately (copyright compilations, news sites,
 * subscription archives, unclear rights). Citations to them are not expected in the ledger.
 * Printed works with no URL are likewise private unless a ledger entry's titles match them.
 */
export const PRIVATE_CITATION_HOSTS = ['electionsireland.org', 'irelandelection.com', 'ark.ac.uk',
  'historyofparliamentonline.org', 'britishnewspaperarchive.co.uk', 'britishnewspaperarchive.com',
  'irishnewsarchive.com', 'newspapers.com', 'electoralcalculus.co.uk', 'tcd.ie', 'politicsresources.net',
  'irishelectionliterature.wordpress.com', 'irishelectionliterature.com', 'psr.keele.ac.uk',
  'irishtimes.com', 'bbc.co.uk', 'bbc.com', 'rte.ie', 'belfasttelegraph.co.uk', 'independent.ie',
  'theguardian.com', 'telegraph.co.uk', 'belfastlive.co.uk', 'irishexaminer.com', 'u.tv',
  'books.google.com', 'jstor.org', 'dib.ie', 'citizensinformation.ie', 'dublincity.ie', 'corkcoco.ie', 'archive.org'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const hostIn = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** @returns {string|null} the private id token/phrase an id matches, or null */
export function privateIdMatch(id) {
  const tokens = String(id).toLowerCase().split('-');
  const tok = PRIVATE_ID_TOKENS.find((t) => tokens.includes(t));
  if (tok) return tok;
  return PRIVATE_ID_PHRASES.find((p) => `-${id.toLowerCase()}-`.includes(`-${p}-`)) ?? null;
}

/** @returns {string[]} problems in text (forbidden paths/words) */
export function forbiddenIn(text) {
  return FORBIDDEN_TEXT.filter(([re]) => re.test(text)).map(([, what]) => what);
}

/** Validate a parsed ledger. @returns {string[]} errors */
export function validateLedger(ledger) {
  const errors = [];
  if (!isObj(ledger)) return ['ledger is not an object'];
  if (ledger.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(ledger.sources) || ledger.sources.length === 0) return [...errors, 'sources must be a non-empty array'];
  const seen = new Set();
  for (const [i, s] of ledger.sources.entries()) {
    const at = `sources[${i}]${s?.id ? ` (${s.id})` : ''}`;
    if (!isObj(s)) { errors.push(`${at}: not an object`); continue; }
    if (typeof s.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) errors.push(`${at}: id must be kebab-case`);
    else if (seen.has(s.id)) errors.push(`${at}: duplicate id`);
    else seen.add(s.id);
    if (typeof s.id === 'string') {
      const hit = privateIdMatch(s.id);
      if (hit) errors.push(`${at}: id matches a privately tracked source (${hit}); keep it in the private register only`);
    }
    for (const k of ['name', 'publisher', 'remaining', 'nextStep', 'lastChecked']) {
      if (typeof s[k] !== 'string' || !s[k].trim()) errors.push(`${at}: ${k} must be a non-empty string`);
    }
    if (s.url !== null && (typeof s.url !== 'string' || !/^https:\/\//.test(s.url))) errors.push(`${at}: url must be https:// or null`);
    if (!CATEGORIES.includes(s.category)) errors.push(`${at}: category "${s.category}" not in ${CATEGORIES.join('|')}`);
    if (!OPEN_RIGHTS.includes(s.rights)) errors.push(`${at}: rights "${s.rights}" is not an open-rights value (${OPEN_RIGHTS.join('|')}); non-open sources belong in the private register`);
    if (!ACCESS.includes(s.access)) errors.push(`${at}: access "${s.access}" not in ${ACCESS.join('|')}`);
    if (typeof s.lastChecked === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(s.lastChecked)) errors.push(`${at}: lastChecked must be YYYY-MM-DD`);
    const m = s.mirrored;
    if (!isObj(m)) errors.push(`${at}: mirrored must be an object`);
    else {
      if (!MIRRORED.includes(m.status)) errors.push(`${at}: mirrored.status "${m.status}" not in ${MIRRORED.join('|')}`);
      if (!Array.isArray(m.where) || m.where.some((w) => !WHERE.includes(w))) errors.push(`${at}: mirrored.where must be a subset of ${WHERE.join('|')}`);
      else if (m.status !== 'none' && m.status !== 'not-permitted' && m.where.length === 0) errors.push(`${at}: mirrored.where is empty but status is ${m.status}`);
      if (m.approxSize !== null && typeof m.approxSize !== 'string') errors.push(`${at}: mirrored.approxSize must be a string or null`);
      if (m.asOf !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(m.asOf))) errors.push(`${at}: mirrored.asOf must be YYYY-MM-DD or null`);
    }
    const x = s.extracted;
    if (!isObj(x)) errors.push(`${at}: extracted must be an object`);
    else {
      if (!EXTRACTED.includes(x.status)) errors.push(`${at}: extracted.status "${x.status}" not in ${EXTRACTED.join('|')}`);
      if (typeof x.what !== 'string') errors.push(`${at}: extracted.what must be a string`);
      if (!isObj(x.counts)) errors.push(`${at}: extracted.counts must be an object`);
      else for (const [k, v] of Object.entries(x.counts)) if (!Number.isInteger(v) || v < 0) errors.push(`${at}: extracted.counts.${k} must be a non-negative integer`);
      if (!Array.isArray(x.targets) || x.targets.some((t) => typeof t !== 'string')) errors.push(`${at}: extracted.targets must be an array of strings`);
    }
    if (s.match !== undefined) {
      if (!isObj(s.match)) errors.push(`${at}: match must be an object`);
      else {
        for (const k of ['hosts', 'titles']) if (s.match[k] !== undefined && (!Array.isArray(s.match[k]) || s.match[k].some((v) => typeof v !== 'string'))) errors.push(`${at}: match.${k} must be an array of strings`);
        for (const t of s.match.titles ?? []) { try { new RegExp(t, 'i'); } catch { errors.push(`${at}: match.titles has a bad pattern ${t}`); } }
      }
    }
    for (const what of forbiddenIn(JSON.stringify(s))) errors.push(`${at}: contains ${what}`);
  }
  for (const k of ['description', 'policy']) {
    if (typeof ledger[k] === 'string') for (const what of forbiddenIn(ledger[k])) errors.push(`${k}: contains ${what}`);
  }
  for (const what of forbiddenIn(JSON.stringify(ledger.liveStores ?? {}))) errors.push(`liveStores: contains ${what}`);
  return errors;
}

/** The key a citation is counted under: its host, or the printed title. */
function citationKey(src) {
  const host = normHost(src.host || (src.url ? safeHost(src.url) : ''));
  return host ? { host } : { title: `${src.publisher ?? ''} | ${src.title ?? ''}` };
}
function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }

/** Ledger entry id covering a citation, or null. */
export function coveringEntry(ledger, src) {
  const key = citationKey(src);
  for (const s of ledger.sources) {
    const hosts = (s.match?.hosts ?? []).map(normHost);
    if (key.host && hostIn(key.host, hosts)) return s.id;
    const text = `${src.publisher ?? ''} | ${src.title ?? ''}`;
    if ((s.match?.titles ?? []).some((t) => new RegExp(t, 'i').test(text))) return s.id;
  }
  return null;
}

/** Count provenance citations per ledger entry and the uncovered public-host tail. */
export function tallyProvenance(ledger, provenance) {
  const perEntry = new Map();
  const uncovered = new Map();
  for (const contest of provenance.contests ?? []) {
    for (const src of contest.sources ?? []) {
      const id = coveringEntry(ledger, src);
      if (id) { perEntry.set(id, (perEntry.get(id) ?? 0) + 1); continue; }
      const key = citationKey(src);
      if (!key.host) continue; // printed works: copyright unless a ledger title matches; tracked privately
      if (hostIn(key.host, PRIVATE_CITATION_HOSTS)) continue;
      uncovered.set(key.host, (uncovered.get(key.host) ?? 0) + 1);
    }
  }
  return { perEntry, uncovered };
}

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The docs table, generated from the ledger. */
export function renderMarkdown(ledger) {
  const lines = [
    '# Civgraph source ledger',
    '',
    `> **Status:** generated from \`data/database/source-ledger.json\` by \`node scripts/check/rules/source-ledger.mjs --write\` (ledger as of ${ledger.asOf}). Do not edit by hand.`,
    '',
    ledger.policy,
    '',
  ];
  const count = (f) => ledger.sources.reduce((acc, s) => { const v = f(s); acc[v] = (acc[v] ?? 0) + 1; return acc; }, {});
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  lines.push(`${ledger.sources.length} sources. Mirrored: ${fmt(count((s) => s.mirrored.status))}. Extracted: ${fmt(count((s) => s.extracted.status))}.`, '');
  for (const cat of CATEGORIES) {
    const rows = ledger.sources.filter((s) => s.category === cat);
    if (!rows.length) continue;
    lines.push(`## ${cat}`, '', '| Source | Rights | Mirrored | Extracted | Remaining |', '|---|---|---|---|---|');
    for (const s of rows) {
      const mirrored = `${s.mirrored.status}${s.mirrored.where.length ? ` (${s.mirrored.where.join(', ')}${s.mirrored.approxSize ? `, ${s.mirrored.approxSize}` : ''})` : ''}`;
      const counts = Object.entries(s.extracted.counts).map(([k, v]) => `${k} ${v.toLocaleString('en-GB')}`).join(', ');
      const name = s.url ? `[${esc(s.name)}](${s.url})` : esc(s.name);
      lines.push(`| ${name} | ${esc(s.rights)} | ${esc(mirrored)} | ${esc(s.extracted.status)}${counts ? ` (${esc(counts)})` : ''} | ${esc(s.remaining)} |`);
    }
    lines.push('');
  }
  if (ledger.liveStores) {
    lines.push('## Live stores', '', `Measured ${ledger.liveStores.measuredAt}.`, '');
    for (const [store, v] of Object.entries(ledger.liveStores)) {
      if (!isObj(v)) continue;
      lines.push(`- **${store}**: ${Object.entries(v).map(([k, n]) => `${k} ${typeof n === 'number' ? n.toLocaleString('en-GB') : n}`).join('; ')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

const norm = (t) => t.replace(/\r\n/g, '\n').trimEnd();

function main() {
  const write = process.argv.includes('--write');
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const errors = validateLedger(ledger);
  const provenance = readProvenance();
  if (write && errors.length === 0) {
    if (provenance) {
      const { perEntry } = tallyProvenance(ledger, provenance);
      for (const s of ledger.sources) {
        if (s.match) s.extracted.counts.provenanceCitations = perEntry.get(s.id) ?? 0;
      }
      writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 1)}\n`);
    }
    writeFileSync(LEDGER_MD, `${renderMarkdown(ledger)}\n`);
    console.log(`wrote ${path.relative(ROOT, LEDGER_MD)}${provenance ? ' and provenance counts' : ''}`);
  }
  if (existsSync(LEDGER_MD)) {
    const md = readFileSync(LEDGER_MD, 'utf8');
    if (norm(md) !== norm(renderMarkdown(ledger))) errors.push('docs/source-ledger.md is stale: run node scripts/check/rules/source-ledger.mjs --write');
    for (const what of forbiddenIn(md)) errors.push(`docs/source-ledger.md contains ${what}`);
  } else errors.push('docs/source-ledger.md is missing: run node scripts/check/rules/source-ledger.mjs --write');
  if (provenance) {
    const { uncovered } = tallyProvenance(ledger, provenance);
    const loud = [...uncovered].filter(([, n]) => n >= WARN_MIN).sort((a, b) => b[1] - a[1]);
    for (const [host, n] of loud) console.warn(`WARN: ${n} election-provenance citations to ${host} have no ledger entry (add one, or list the host as private in this script)`);
  } else console.log(`note: ${rel(PROVENANCE_FILE)} not built; provenance coverage warning skipped`);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exit(1);
  }
  console.log(`source-ledger OK: ${ledger.sources.length} public sources`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
