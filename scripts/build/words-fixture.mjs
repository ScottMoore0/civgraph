#!/usr/bin/env node
/**
 * A small, self-consistent copy of the Words in parliament shards for the browser spec
 * (tests/browser/words-explorer.spec.cjs), cut from the full static tree that goes to R2.
 *
 * The full tree is 425 MB in about 15,000 files, so the spec cannot carry it. This keeps
 * a handful of terms, their bucket files holding only those terms, the speakers those
 * terms name (re-indexed, so `k` still points at the right rows), the speakers' distinctive
 * words, a short autocomplete list, and meta.json with its totals cut to the same years.
 * Every number that survives is the real one.
 *
 *   node scripts/build/words-fixture.mjs --static <counts/static> [--from 1960]
 *
 * Writes tests/browser/fixtures/words/ (replacing it).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const SRC = opt('--static', process.env.WORDS_STATIC_DIR);
const FROM = Number(opt('--from', '1960'));
const OUT = path.join('tests', 'browser', 'fixtures', 'words');
const TERMS = { en: ['housing', 'partition', 'border', 'home rule'], ga: ['gaeilge'] };

if (!SRC || !existsSync(path.join(SRC, 'meta.json'))) {
  console.error('Usage: node scripts/build/words-fixture.mjs --static <counts/static> [--from 1960]');
  process.exit(2);
}

const readGz = (rel) => JSON.parse(gunzipSync(readFileSync(path.join(SRC, rel))).toString('utf8'));
const writeGz = (rel, obj) => {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 }));
};
const bucket = (term, n) => parseInt(createHash('md5').update(term, 'utf8').digest('hex').slice(0, 8), 16) % n;

const meta = JSON.parse(readFileSync(path.join(SRC, 'meta.json'), 'utf8'));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const speakers = readGz('speakers.json.gz');
const keepSpk = new Map(); // old index -> new index
const files = new Map();   // rel -> {term: entry}
for (const [lang, terms] of Object.entries(TERMS)) {
  for (const term of terms) {
    const n = term.split(' ').length;
    const rel = `terms/${lang}/${n}/${bucket(term, meta.buckets[String(n)])}.json.gz`;
    const entry = readGz(rel)[term];
    if (!entry) { console.error(`not in the counts: ${lang} "${term}"`); process.exit(1); }
    const s = [];
    for (let i = 0; i < entry.s.length; i += 4) if (entry.s[i + 1] >= FROM) s.push(...entry.s.slice(i, i + 4));
    const k = [];
    for (let i = 0; i < entry.k.length; i += 2) {
      const old = entry.k[i];
      if (!keepSpk.has(old)) keepSpk.set(old, keepSpk.size);
      k.push(keepSpk.get(old), entry.k[i + 1]);
    }
    let c = 0;
    for (let i = 3; i < s.length; i += 4) c += s[i];
    if (!files.has(rel)) files.set(rel, {});
    files.get(rel)[term] = { c, s, k };
  }
}
for (const [rel, obj] of files) writeGz(rel, obj);

const newSpeakers = [];
for (const [old, idx] of keepSpk) newSpeakers[idx] = speakers[old];
writeGz('speakers.json.gz', newSpeakers);

// Distinctive words for the first three speakers kept (all re-indexed into bucket 0).
const st = {};
for (const [old, idx] of [...keepSpk].slice(0, 3)) {
  const rows = readGz(`speaker_terms/${Math.floor(old / 200)}.json.gz`)[String(old)];
  if (rows) st[String(idx)] = rows.slice(0, 12);
}
writeGz('speaker_terms/0.json.gz', st);

for (const [rel, prefixes] of [['suggest/en-1.json.gz', ['hous', 'part', 'bord']], ['suggest/en-2.json.gz', ['home r', 'housing ']], ['suggest/ga-1.json.gz', ['gae']], ['suggest/ga-2.json.gz', ['an ']]]) {
  const rows = readGz(rel);
  writeGz(rel, prefixes.flatMap((p) => rows.filter(([t]) => t.startsWith(p)).slice(0, 6)));
}

const out = { ...meta, totals: meta.totals.filter((r) => r[1] >= FROM), fixtureNote: `Cut by scripts/build/words-fixture.mjs: years >= ${FROM}, ${Object.values(TERMS).flat().length} terms.` };
writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(out));
console.log(`${OUT}: ${files.size} term files, ${newSpeakers.length} speakers, ${out.totals.length} totals rows.`);
