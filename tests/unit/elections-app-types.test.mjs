/**
 * The Elections app's types (11 Nov 2026 arch audit P0/P5): it checks under full `strict`
 * (config/tsconfig.ui-strict.json), its API answer types are generated from the v1 contracts,
 * not written by hand, and it has no explicit `any` (the last, the handles of DuckDB-WASM in
 * lib/duck.js and MapLibre GL in lib/maplibre.js, were typed on 12 Nov 2026, stream rf8-types).
 *
 *   node --test tests/unit/elections-app-types.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = 'site/apps/elections';

// Explicit `any` per file; a file not listed has none. Lower a count when you remove one.
/** @type {Record<string, number>} */
const ANY_BUDGET = {};
const ANY = /\{any\}|\{any\[\]\}|<any>|any\[\]|: any\b|, any\b|Record<string, any>/g;

function scripts(dir, out = []) {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'extracts' || name === 'notional') continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) scripts(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('every app script checks under strict', () => {
  const strict = JSON.parse(readFileSync(path.join(ROOT, 'config/tsconfig.ui-strict.json'), 'utf8')).include.map((p) => p.replace(/^\.\.\//, ''));
  const covered = (rel) => strict.some((p) => new RegExp(`^${p.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(rel));
  for (const rel of scripts(APP)) assert.ok(covered(rel), `${rel} is not in tsconfig.ui-strict.json`);
});

test('explicit any only falls', () => {
  const found = {};
  for (const rel of scripts(APP)) {
    const n = (readFileSync(path.join(ROOT, rel), 'utf8').match(ANY) || []).length;
    if (n) found[rel] = n;
  }
  for (const [rel, n] of Object.entries(found)) assert.ok(n <= (ANY_BUDGET[rel] || 0), `${rel}: ${n} explicit any (budget ${ANY_BUDGET[rel] || 0})`);
  for (const [rel, n] of Object.entries(ANY_BUDGET)) assert.equal(found[rel] || 0, n, `${rel} has fewer any now: lower its budget to ${found[rel] || 0}`);
});

test('the API answer types come from the v1 contracts, not from hand-written shapes', () => {
  const api = readFileSync(path.join(ROOT, APP, 'lib/api.js'), 'utf8');
  for (const name of ['IndexAnswer', 'IndexOfBodyAnswer', 'DetailAnswer', 'SummaryAnswer', 'ContestsAnswer', 'ContestAnswer', 'CitationsAnswer']) {
    assert.match(api, new RegExp(`ApiV1\\.Elections[A-Za-z]+Answer\\} ${name}\\b`), `${name} is an ApiV1 type`);
  }
  assert.doesNotMatch(api, /@typedef \{\{ key: string/, 'no hand-written answer shape');
  const generated = readFileSync(path.join(ROOT, 'packages/types/generated/api-v1.d.ts'), 'utf8');
  for (const name of ['ElectionsCitationsContestAnswer', 'ElectionsIndexOfBodyAnswer', 'ElectionsDetailAnswer']) assert.match(generated, new RegExp(`export interface ${name} `));
});
