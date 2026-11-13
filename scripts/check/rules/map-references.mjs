#!/usr/bin/env node
/**
 * One format for every map layer's references (owner, 11 Nov 2026):
 *
 *   references: [{ label, url?, note? }, ...]
 *
 * The maps database (data/database/maps.json), the renderer's layer records
 * (render/metadata/maps-test.json) and the census statistics (data/database/data-entries.json)
 * all cite their sources this way, and the map's sources panel and Browse show them as written.
 *
 * Fails when, in any of the three files:
 *   - `references` is not an array of objects, or an entry has a key other than label/url/note;
 *   - a label is missing or empty, or has stray spaces (leading, trailing or doubled);
 *   - a url is not one http(s) address without spaces, or a note is present but empty;
 *   - two entries of one layer cite the same label and url (an exact duplicate);
 *   - a label names its own web address at the end, "Title (host)" or "Title — host", instead
 *     of the one form "host — Title" (the address first, as "data.gov.ie — Planning Register");
 *   - a download is labelled "X - GeoJSON download" with a hyphen instead of "X — GeoJSON download";
 *   - a map still carries the retired free-text `sourceNotes` field (its address is now a
 *     reference labelled "Source notes").
 * Every one of these is mechanical, so `--write` fixes them in place (normaliseReferences below)
 * and the check then passes.
 *
 *   node scripts/check/rules/map-references.mjs           check
 *   node scripts/check/rules/map-references.mjs --write   normalise the three files
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const KEYS = ['label', 'url', 'note'];
export const SOURCE_NOTES_LABEL = 'Source notes';

/**
 * A reference as it may be written before normalising: the one format's keys, or the older
 * url/file, title/name and description spellings, with values as the JSON has them.
 * @typedef {{ label?: unknown, url?: unknown, note?: unknown, file?: unknown, title?: unknown, name?: unknown, description?: unknown }} RawReference
 */
/** @typedef {{ label: string, url?: string, note?: string }} CleanReference a reference in the one format */
/**
 * A record of one of the three files (a map, a layer or a data entry), as far as this reads it.
 * @typedef {{ id?: string, sourceMapId?: string, references?: unknown, sourceNotes?: unknown, [field: string]: unknown }} ReferencingRecord
 */

/** @param {unknown} s */
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
/**
 * A web address's host without "www.", lower-cased; '' when it is not one.
 * @param {unknown} url
 */
export function hostOf(url) {
  // new URL stringifies what it is given, and throws (giving '') when that is not an address
  try { return new URL(/** @type {string} */ (url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
/**
 * @param {string} text
 * @param {string} host
 */
const sameHost = (text, host) => Boolean(host) && squash(text).toLowerCase().replace(/^www\./, '') === host;
/**
 * An address with its spaces encoded (a few R2 file names have them).
 * @param {string} url
 */
export const encodeUrl = (url) => squash(url).replace(/ /g, '%20');

/**
 * The label's canonical form: its own host first ("data.gov.ie — Planning Register"), never
 * trailing in brackets or after a dash; a download's format after an em dash.
 * @param {string} label
 * @param {unknown} [url]  a reference's url as written (anything that is not an address has no host)
 */
export function canonicalLabel(label, url = '') {
  let l = squash(label);
  const host = hostOf(url);
  // Take the host off the end as often as it is there ("Counties - 2019 - data.gov.ie (data.gov.ie)").
  for (let again = true; again && host;) {
    again = false;
    const brackets = /^(.*\S)\s*\(([^()]+)\)$/.exec(l);
    const dash = /^(.*\S)\s+[—–-]\s+(\S+)$/.exec(l);
    if (brackets && sameHost(brackets[2], host)) { l = brackets[1]; again = true; } else if (dash && sameHost(dash[2], host)) { l = dash[1]; again = true; }
    if (again && !l.toLowerCase().startsWith(`${host} — `)) l = `${host} — ${l}`;
    if (again) l = l.replace(new RegExp(`^(${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — )+`, 'i'), `${host} — `);
  }
  l = l.replace(/\s+-\s+((?:[\w.]+(?:\s*\([^)]*\))?\s+){0,4}download)$/, ' — $1');
  return l;
}

/**
 * The problems with one list of references, as sentences; [] when it is in the one format.
 * @param {unknown} refs
 * @returns {string[]}
 */
export function referenceProblems(refs) {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) return ['references is not a list'];
  /** @type {string[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  // an entry of the parsed list: an object (keyed by strings) or something else, reported below
  refs.forEach(/** @param {Record<string, unknown> | null} r @param {number} i */ (r, i) => {
    const at = `reference ${i + 1}`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { out.push(`${at} is not an object`); return; }
    for (const k of Object.keys(r)) if (!KEYS.includes(k)) out.push(`${at} has the key "${k}" (only label, url, note)`);
    if (typeof r.label !== 'string' || !r.label.trim()) out.push(`${at} has no label`);
    else if (r.label !== squash(r.label)) out.push(`${at}'s label has stray spaces`);
    if (r.url !== undefined && !(typeof r.url === 'string' && /^https?:\/\/\S+$/.test(r.url))) out.push(`${at}'s url is not an http(s) address without spaces`);
    if (r.note !== undefined && !(typeof r.note === 'string' && r.note.trim())) out.push(`${at}'s note is empty`);
    else if (typeof r.note === 'string' && r.note !== r.note.trim()) out.push(`${at}'s note has stray spaces`);
    if (typeof r.label === 'string' && r.label.trim() && canonicalLabel(r.label, r.url) !== r.label) out.push(`${at}'s label "${r.label}" should read "${canonicalLabel(r.label, r.url)}"`);
    const key = `${squash(r.label || '').toLowerCase()}|${r.url || ''}`;
    if (seen.has(key)) out.push(`${at} repeats an earlier reference (${r.label})`);
    seen.add(key);
  });
  return out;
}

/**
 * One list in the one format: trimmed, empty notes dropped, spaces in addresses encoded, labels
 * canonical, exact duplicates merged (a duplicate's note fills an empty one). Order is kept.
 * @param {unknown} refs
 * @param {{ sourceNotes?: unknown }} [extra]  a map's retired sourceNotes address, cited too
 * @returns {CleanReference[]}
 */
export function normaliseReferences(refs, { sourceNotes } = {}) {
  /** @type {CleanReference[]} */
  const list = [];
  /** @type {Map<string, CleanReference>} */
  const byKey = new Map();
  /** @param {RawReference} r */
  const push = (r) => {
    // its label is set below before anything reads it (and it is dropped when there is none)
    const out = /** @type {CleanReference} */ ({});
    const url = r.url ?? r.file;
    const label = squash(r.label ?? r.title ?? r.name ?? (url ? hostOf(url) : ''));
    if (!label) return;
    const cleanUrl = typeof url === 'string' && url.trim() ? encodeUrl(url) : '';
    out.label = canonicalLabel(label, cleanUrl);
    if (cleanUrl) out.url = cleanUrl;
    // the typeof test has just seen a string
    const note = typeof (r.note ?? r.description) === 'string' ? /** @type {string} */ (r.note ?? r.description).trim() : '';
    if (note) out.note = note;
    const key = `${out.label.toLowerCase()}|${out.url || ''}`;
    const prev = byKey.get(key);
    if (prev) { if (!prev.note && out.note) prev.note = out.note; return; }
    byKey.set(key, out);
    list.push(out);
  };
  for (const r of Array.isArray(refs) ? refs : []) {
    if (typeof r === 'string') push(/^https?:\/\//.test(r.trim()) ? { url: r } : { label: r });
    else if (r && typeof r === 'object') push(r);
  }
  // The retired sourceNotes field held either the address of a notes file or the notes themselves.
  if (typeof sourceNotes === 'string' && sourceNotes.trim()) {
    if (/^https?:\/\/[^\s]+(\s[^\s]+)*$/.test(sourceNotes.trim()) && !/\s{2,}|\.\s/.test(sourceNotes.trim())) {
      const url = encodeUrl(sourceNotes);
      if (!list.some((r) => r.url === url)) push({ label: SOURCE_NOTES_LABEL, url });
    } else push({ label: SOURCE_NOTES_LABEL, note: squash(sourceNotes) });
  }
  return list;
}

// ---- the three files
/** @type {{ rel: string, list: (d: Record<string, ReferencingRecord[] | undefined>) => ReferencingRecord[] | undefined, write: (d: unknown, raw: string) => string }[]} */
const FILES = [
  { rel: 'data/database/maps.json', list: (d) => d.maps, write: (d) => `${JSON.stringify(d, null, 2)}\n` },
  { rel: 'render/metadata/maps-test.json', list: (d) => d.layers, write: (d) => `${JSON.stringify(d, null, 2)}\n` },
  { rel: 'data/database/data-entries.json', list: (d) => d.dataEntries, write: (d, raw) => JSON.stringify(d) + (raw.endsWith('\n') ? '\n' : '') },
];

/**
 * Normalise one record in place; true when it changed.
 * @param {ReferencingRecord} rec
 */
export function normaliseRecord(rec) {
  const before = JSON.stringify([rec.references, rec.sourceNotes]);
  const hadRefs = rec.references !== undefined;
  const refs = normaliseReferences(rec.references, { sourceNotes: rec.sourceNotes });
  if (hadRefs || refs.length) rec.references = refs;
  delete rec.sourceNotes;
  return JSON.stringify([rec.references, rec.sourceNotes]) !== before;
}

function main() {
  const write = process.argv.includes('--write');
  /** @type {string[]} */
  const problems = [];
  let changed = 0;
  for (const f of FILES) {
    const file = path.join(ROOT, f.rel);
    const raw = readFileSync(file, 'utf8');
    const doc = JSON.parse(raw);
    for (const rec of f.list(doc) || []) {
      if (write) { if (normaliseRecord(rec)) changed += 1; continue; }
      const id = rec.id || rec.sourceMapId || '?';
      for (const p of referenceProblems(rec.references)) problems.push(`${f.rel} ${id}: ${p}`);
      if (rec.sourceNotes !== undefined) problems.push(`${f.rel} ${id}: sourceNotes is retired; cite it as a reference labelled "${SOURCE_NOTES_LABEL}"`);
    }
    if (write) {
      const text = f.write(doc, raw);
      if (text !== raw) writeFileSync(file, text);
    }
  }
  if (write) { console.log(`map-references: normalised ${changed} records`); return; }
  if (problems.length) {
    console.error(`map-references: ${problems.length} problem${problems.length === 1 ? '' : 's'} (node scripts/check/rules/map-references.mjs --write fixes them):`);
    for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
    if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
    process.exit(1);
  }
  console.log('map-references: OK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
