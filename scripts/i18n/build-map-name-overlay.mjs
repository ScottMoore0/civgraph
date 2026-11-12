#!/usr/bin/env node
/**
 * Irish names for the site's maps, as an OVERLAY: data/i18n/map-names.overlay.json, keyed by
 * map id. data/database/maps.json is not edited (other work edits it on main); the runtime
 * reads the overlay's names through assets/i18n/names.ga.json (scripts/i18n/build-i18n.mjs).
 *
 * HOW A NAME IS TRANSLATED
 *
 * By composition from a reviewed phrase glossary (data/i18n/map-name-glossary.txt), the county
 * and district names in data/i18n/strings/general.txt and the series names in
 * data/i18n/strings/catalogue-names.txt, longest phrase first. Dates take Irish month names
 * (Intl / CLDR, as the runtime does); years, numbers and acronyms (OSNI, PSNI) pass through. A
 * name is translated only when every word is covered; anything else stays English and is listed
 * with the words that were missing, so the glossary can grow. A leading place name followed by a
 * series ("Larne Wards 1985") becomes "<series> – <place> ..." ("Bardaí – Latharna 1985"),
 * which avoids guessing the genitive of the place name: a reviewer may prefer the genitive form.
 *
 * Official Irish names that the data already holds are used as they are: the Dáil
 * constituency names in data/database/dail-constituency-names-bilingual.json (from the
 * Oireachtas / Electoral Commission bilingual list).
 *
 * Descriptions are NOT translated (they are long, specific prose); every map with a description
 * is marked descriptionUntranslated so the review list shows it.
 *
 *   node scripts/i18n/build-map-name-overlay.mjs          write the overlay
 *   node scripts/i18n/build-map-name-overlay.mjs --check  fail if it is out of date
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const OUT = 'data/i18n/map-names.overlay.json';
const SEP = '¦';

/**
 * One overlay entry: a map's (or an extra name's) English name and its draft translation.
 * @typedef {object} MapNameRecord
 * @property {string} en
 * @property {string} [ga]
 * @property {string} [sco]
 * @property {string[]} [missing]                 words no glossary entry covers (the name stays English)
 * @property {boolean} [descriptionUntranslated]  the map has a description, which stays English
 * @property {string} [source]                    where an official name came from
 */
/**
 * data/i18n/map-names.overlay.json (read by build-i18n.mjs).
 * @typedef {object} MapNameOverlay
 * @property {string} _status
 * @property {string} _note
 * @property {Record<string, number | string[]>} summary
 * @property {Record<string, MapNameRecord>} maps        keyed by map id
 * @property {Record<string, MapNameRecord>} extraNames  keyed by `layer:<id>` or `dail:<English name>`
 */

/**
 * @param {string} file
 * @returns {Array<[string, string]>}
 */
function readPairs(file, { skipPatterns = true } = {}) {
  if (!existsSync(file)) return [];
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (const raw of readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.replace(/^@[A-Za-z0-9_.-]+\s+/, '');
    const cols = body.split(SEP).map((c) => c.trim());
    if (cols.length < 2 || !cols[0] || !cols[1]) continue;
    if (skipPatterns && /\{[a-z]/i.test(cols[0])) continue;
    pairs.push([cols[0], cols[1]]);
  }
  return pairs;
}

const glossary = new Map();
const add = (/** @type {string} */ en, /** @type {string} */ ga, overwrite = false) => { if (overwrite || !glossary.has(en)) glossary.set(en, ga); };
for (const [en, ga] of readPairs('data/i18n/map-name-glossary.txt')) add(en, ga, true);
for (const [en, ga] of readPairs('data/i18n/strings/catalogue-names.txt')) add(en, ga);
for (const [en, ga] of readPairs('data/i18n/strings/general.txt')) add(en, ga);
// Provinces inside a name read as the province ("Leinster District Electoral Divisions").
const PLACES = new Map(readPairs('data/i18n/strings/general.txt').filter(([en]) => !/^(January|February|March|April|May|June|July|August|September|October|November|December)$/.test(en)));
// arch-ok R6: place names with their Irish forms (the overlay's translation glossary), not council bodies
for (const extra of [['Belfast', 'Béal Feirste'], ['Derry', 'Doire'], ['Newry & Mourne', 'An tIúr agus Múrna'], ['Leinster', 'Cúige Laighean'], ['Munster', 'Cúige Mumhan'], ['Connacht', 'Cúige Chonnacht'], ['Ulster', 'Cúige Uladh']]) PLACES.set(extra[0], extra[1]);
const phrases = [...glossary.keys()].sort((a, b) => b.length - a.length);
const placeNames = [...PLACES.keys()].sort((a, b) => b.length - a.length);

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const gaShort = SHORT.map((_, i) => new Intl.DateTimeFormat('ga', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 15))).replace(/\.$/, ''));

/**
 * @param {string} s
 * @param {string} phrase
 */
function startsWithWord(s, phrase) {
  if (!s.startsWith(phrase)) return false;
  const next = s.charAt(phrase.length);
  return !next || /[\s(),:;/–—~-]/.test(next) || !/[A-Za-z]/.test(phrase.slice(-1));
}

/**
 * Translate the whole string or return {missing}.
 * @param {string} text
 */
function compose(text) {
  let s = text;
  let out = '';
  const missing = [];
  while (s.length) {
    let m;
    if ((m = /^\s+/.exec(s))) { out += ' '; s = s.slice(m[0].length); continue; }
    if ((m = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/.exec(s))) {
      out += `${m[1]} ${gaShort[SHORT.indexOf(m[2])]} ${m[3]}`; s = s.slice(m[0].length); continue;
    }
    if ((m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/.exec(s))) {
      out += `${gaShort[SHORT.indexOf(m[1])]} ${m[2]}`; s = s.slice(m[0].length); continue;
    }
    if ((m = /^\d[\d,.:]*(?:\s*[–-]\s*\d[\d,.]*)?[a-z]?\b/.exec(s))) { out += m[0]; s = s.slice(m[0].length); continue; }
    if ((m = /^[()[\],.:;/–—~+'"·-]/.exec(s))) { out += m[0]; s = s.slice(1); continue; }
    const phrase = phrases.find((p) => startsWithWord(s, p));
    if (phrase) { out += glossary.get(phrase); s = s.slice(phrase.length); continue; }
    const lower = s.toLowerCase();
    const ci = phrases.find((p) => startsWithWord(lower, p.toLowerCase()));
    if (ci) { out += glossary.get(ci); s = s.slice(ci.length); continue; }
    if ((m = /^[A-Z][A-Z0-9]{1,6}\b/.exec(s))) { out += m[0]; s = s.slice(m[0].length); continue; } // acronym
    m = /^[^\s()[\],.:;/–—~-]+/.exec(s);
    missing.push(m ? m[0] : s.charAt(0));
    s = s.slice(m ? m[0].length : 1);
  }
  return missing.length ? { missing } : { text: out.replace(/\s+/g, ' ').trim() };
}

/**
 * @param {string} name
 */
function translateName(name) {
  const text = String(name || '').trim();
  if (!text) return { missing: ['(empty)'] };
  // "NI Road Surface Defects": the jurisdiction follows the noun in Irish.
  const lead = /^(NI|ROI) (.+)$/.exec(text);
  if (lead && !glossary.has(text)) {
    const inner = compose(lead[2]);
    if (inner.text) return { text: `${inner.text} ${lead[1] === 'NI' ? 'TÉ' : 'PÉ'}` };
  }
  // "<Place> <series> <rest>" -> "<series> – <place> <rest>"
  for (const place of placeNames) {
    if (!startsWithWord(text, place)) continue;
    const rest = text.slice(place.length).trim();
    const series = phrases.find((p) => startsWithWord(rest, p) && !PLACES.has(p) && /[a-z]/.test(p));
    if (!series || rest === '') break;
    const tail = compose(rest.slice(series.length).trim());
    if (tail.missing) return tail;
    return { text: `${glossary.get(series)} – ${PLACES.get(place)}${tail.text ? ` ${tail.text}` : ''}` };
  }
  return compose(text);
}

/** @returns {MapNameOverlay} */
function build() {
  /** @type {import('../../packages/types/index.js').MapEntry[]} */
  const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps || [];
  /** @type {Array<{ id: string, name?: string }>} */
  const index = JSON.parse(readFileSync('render/metadata/maps-test-index.json', 'utf8')).layers || [];
  /** @type {Record<string, MapNameRecord>} */
  const result = {};
  let translated = 0;
  let withDescription = 0;
  for (const map of maps) {
    const r = translateName(map.name);
    /** @type {MapNameRecord} */
    const rec = { en: map.name };
    if (r.text && r.text !== map.name) { rec.ga = r.text; translated += 1; } else if (r.missing) rec.missing = [...new Set(r.missing)].slice(0, 6);
    if (map.description && String(map.description).trim()) { rec.descriptionUntranslated = true; withDescription += 1; }
    result[map.id] = rec;
  }
  /** @type {Record<string, MapNameRecord>} */
  const extraNames = {};
  let layerTranslated = 0;
  for (const layer of index) {
    if (!layer.name) continue;
    const r = translateName(layer.name);
    if (r.text && r.text !== layer.name) { extraNames[`layer:${layer.id}`] = { en: layer.name, ga: r.text }; layerTranslated += 1; }
  }
  // Official bilingual Dáil constituency names.
  /** @type {{ byYear?: Record<string, { constituencies?: Array<{ english?: string, gaeilge?: string }> }> }} */
  const dail = JSON.parse(readFileSync('data/database/dail-constituency-names-bilingual.json', 'utf8'));
  let dailNames = 0;
  for (const [year, regime] of Object.entries(dail.byYear || {})) {
    for (const c of regime.constituencies || []) {
      if (!c.english || !c.gaeilge) continue;
      const variants = new Set([c.english, c.english.replace(/-/g, ' '), c.english.replace(/–/g, '-')]);
      for (const en of variants) {
        const key = `dail:${en}`;
        if (!extraNames[key]) { extraNames[key] = { en, ga: c.gaeilge, source: `dail-constituency-names-bilingual.json (${year})` }; dailNames += 1; }
      }
    }
  }
  /** @type {Record<string, number>} */
  const missingWords = {};
  for (const rec of Object.values(result)) for (const w of rec.missing || []) missingWords[w] = (missingWords[w] || 0) + 1;
  const summary = {
    maps: maps.length,
    mapNamesTranslatedGa: translated,
    mapNamesUntranslated: maps.length - translated,
    descriptionsUntranslated: withDescription,
    layerNamesTranslatedGa: layerTranslated,
    layers: index.length,
    dailConstituencyNames: dailNames,
    mapNamesSco: 0,
    topMissingWords: Object.entries(missingWords).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, n]) => `${w} (${n})`)
  };
  return {
    _status: 'draft',
    _note: 'Translation overlay for map names; data/database/maps.json is not edited. Generated by scripts/i18n/build-map-name-overlay.mjs. DRAFT, machine-composed from a phrase glossary: needs review by a fluent speaker. Ulster-Scots: no map names (no official forms).',
    summary,
    maps: result,
    extraNames
  };
}

const json = `${JSON.stringify(build(), null, 1)}\n`;
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : null;
if (current !== json) {
  if (CHECK) {
    console.error(`FAIL: ${OUT} is out of date (run node scripts/i18n/build-map-name-overlay.mjs)`);
    process.exit(1);
  }
  writeFileSync(OUT, json);
}
const { summary } = JSON.parse(json);
console.log(`Map names: ${summary.mapNamesTranslatedGa}/${summary.maps} in Irish; layer names ${summary.layerNamesTranslatedGa}/${summary.layers}; Dáil constituency names ${summary.dailConstituencyNames}.`);
console.log(`Most frequent missing words: ${summary.topMissingWords.slice(0, 25).join(', ')}`);
