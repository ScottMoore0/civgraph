#!/usr/bin/env node
/**
 * The layer-id flip of the site-restructure renames (renames.csv, area 5; data design PHASE3.md
 * section 5): <map>-vector-test -> <map>-vector, -raster-test -> -raster, -alias-test -> -alias,
 * in the tracked sources, the code that builds ids, and the files named by id.
 *
 *   node scripts/maps/rename-layer-ids.mjs            dry run: what would change, per area
 *   node scripts/maps/rename-layer-ids.mjs --write    rewrite the files and rename the id-named ones
 *   node scripts/maps/rename-layer-ids.mjs --check    exit 1 while any old-suffix id is left in scope
 *
 * WHEN: the last wave, once the streams editing maps-test.json have landed (it touches about 1,700
 * files) and after the R2 copy of the tile archives (scripts/publish/r2-copy-keys.mjs, owner
 * approval). Idempotent: a second --write changes nothing, so on a conflict, take the other side
 * and run it again. Both spellings work before and after it (layer_aliases, the client's suffix
 * rule), so it needs no coordinated deploy beyond the records rebuild that follows it.
 *
 * NOT TOUCHED:
 *   - tile archive keys and tile URLs (a token containing /generated/, /tiles/, pmtiles or
 *     .pmtiles): the old R2 keys stay for 12 months (owner decision); tileUrl moves to the new
 *     keys in its own step after the copy is verified;
 *   - the rename tooling and its tests, which name both spellings on purpose (SKIP_FILES);
 *   - history: docs/, tasks/, the render/metadata reports, CHANGELOG-like Markdown.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where ids live: sources, the code that builds or reads them, and the files named by id. */
export const SCOPE = [
  /^render\/metadata\/(maps-test\.json|maps-test-index\.json|layer-details-test2\/|duplicate-feature-ids\/|feature-indexes\/|election-anchors-test2\/|ni-local\/|ni-local-coverage\.json)/,
  /^data\/(database|catalogue|elections|i18n|timeline-[a-z-]+)\/.*\.(json|csv)$/,
  /^assets\/i18n\/.*\.json$/,
  /^agent\/.*\.json$/,
  /^(scripts|tests|src|app\/src|render\/src|functions|browse|apps)\/.*\.(mjs|js|cjs|py|json|sh)$/,
];
export const SKIP_FILES = new Set([
  'scripts/maps/rename-layer-ids.mjs',
  'tests/unit/rename-layer-ids.test.mjs',
  'scripts/lib/layer-renames.mjs',
  'scripts/publish/r2-copy-keys.mjs',
  'tests/unit/r2-copy-keys.test.mjs',
  'src/map/app/url-compat.mjs',
  'tests/unit/url-compat.test.mjs',
  'tests/functions/maps.test.mjs',
  'scripts/records/ingest-maps.mjs',
]);

const OLD = /-(vector|raster|alias)-test(?![A-Za-z0-9_-])/g;
const DELIM = /["'`\s(),=<>[\]{}|]/;
const TILE_TOKEN = /\/generated\/|\/tiles\/|pmtiles|\{z\}/i;

/** The text with every old suffix renamed, except inside tile keys and URLs; and the count. */
export function renameInText(text) {
  let count = 0;
  const out = text.replace(OLD, (match, kind, at) => {
    let a = at;
    while (a > 0 && !DELIM.test(text[a - 1])) a -= 1;
    let b = at + match.length;
    while (b < text.length && !DELIM.test(text[b])) b += 1;
    if (TILE_TOKEN.test(text.slice(a, b))) return match;
    count += 1;
    return `-${kind}`;
  });
  return { text: out, count };
}

/** A tracked path's new name, or null (only the file name is renamed, never a tile path). */
export function renamedPath(rel) {
  const base = path.posix.basename(rel);
  const { text, count } = renameInText(base);
  return count ? path.posix.join(path.posix.dirname(rel), text) : null;
}

export const inScope = (rel) => !SKIP_FILES.has(rel) && SCOPE.some((re) => re.test(rel));

export function plan(root = ROOT) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const edits = [];
  const moves = [];
  for (const rel of files) {
    if (!inScope(rel)) continue;
    const file = path.join(root, rel);
    if (!existsSync(file)) continue;
    const before = readFileSync(file, 'utf8');
    const { text, count } = renameInText(before);
    if (count) edits.push({ rel, count, text });
    const to = renamedPath(rel);
    if (to) moves.push({ from: rel, to });
  }
  return { edits, moves };
}

function main() {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  const { edits, moves } = plan();
  const areas = new Map();
  for (const e of edits) {
    const area = e.rel.split('/').slice(0, e.rel.startsWith('render/metadata/') ? 3 : 2).join('/');
    const a = areas.get(area) || { files: 0, ids: 0 };
    a.files += 1;
    a.ids += e.count;
    areas.set(area, a);
  }
  for (const [area, a] of [...areas].sort((x, y) => y[1].ids - x[1].ids)) console.log(`  ${area.padEnd(48)} ${String(a.files).padStart(5)} files ${String(a.ids).padStart(7)} ids`);
  console.log(`${edits.length} file(s) with ${edits.reduce((n, e) => n + e.count, 0)} old-suffix id(s); ${moves.length} file(s) named by an old id`);
  if (check) process.exit(edits.length || moves.length ? 1 : 0);
  if (!write) { console.log('dry run: nothing written (--write to apply)'); return; }
  for (const e of edits) writeFileSync(path.join(ROOT, e.rel), e.text);
  for (const m of moves) {
    const to = path.join(ROOT, m.to);
    if (existsSync(to)) throw new Error(`${m.to} exists: both spellings are files; resolve by hand`);
    mkdirSync(path.dirname(to), { recursive: true });
    execFileSync('git', ['mv', m.from, m.to], { cwd: ROOT });
  }
  console.log('written. Next: npm run build:test2:metadata, npm run catalogue:build, npm run i18n:build, npm run records:build; check:fast');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
