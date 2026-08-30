#!/usr/bin/env node
/**
 * Every provider credited in the catalogue must be in the provider registry.
 *
 * WHY
 *
 * `provider` in data/database/maps.json was free text. Nothing checked it, so the same
 * organisation accumulated several spellings and no new one was ever caught:
 *
 *     "Tailte Éireann" (68)  and  "Tailte Eireann" (4)
 *     "OSI" (16)             and  "OSi" (1)
 *     "DAERA" (43)           and  "Department of Agriculture, Environment and Rural Affairs (DAERA)"
 *     "NIEA" (38)            and  "Northern Ireland Environment Agency" (8)
 *     "CSO" (23)             and  "Central Statistics Office" (1)
 *     "BGS" (4)              and  "British Geological Survey" (3)
 *     ... and a Historic Environment Division spelled with an em dash
 *
 * That is not cosmetic. Attribution is a licence obligation for most of this material, and
 * the About page now publishes a grouped list of the bodies Civgraph draws on. Counted from
 * the raw strings that list would have said 75 organisations and shown DAERA, NIEA, the CSO
 * and the BGS twice each. The real figure is 58.
 *
 * WHAT THIS ENFORCES
 *
 * Every string in `provider` must match a registry `name`, or an `alias` of one. An alias is
 * a spelling that has already been merged away: finding one means it has come back, so it
 * fails with the canonical form to use.
 *
 * WHAT IT DELIBERATELY DOES NOT ENFORCE
 *
 * `pendingReview` entries are legitimate. They mark an unresolved question about how a body
 * should be credited -- whether Land & Property Services and OSNI are one credit or two,
 * whether to credit Ordnance Survey Ireland or Tailte Éireann for pre-2023 data -- and those
 * are attribution judgements, not typos. Failing on them would force a rushed decision about
 * whose name goes on someone else's work.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-provider-names.mjs
 *   node scripts/validate-provider-names.mjs --list      # every provider with its use count
 */
import { readFileSync, existsSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const REGISTRY = 'data/database/providers.json';
const LIST = process.argv.includes('--list');

if (!existsSync(REGISTRY)) {
  console.error(`FAIL: ${REGISTRY} is missing. The provider registry is the source of truth`);
  console.error('  for how organisations are credited; without it nothing can be checked.');
  process.exit(1);
}

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const providers = registry.providers || [];

const canonical = new Set(providers.map((p) => p.name));
const aliasTo = new Map();
for (const entry of providers) {
  for (const alias of entry.aliases || []) aliasTo.set(alias, entry.name);
}

const used = new Map();
const unknown = new Map();
const revived = new Map();

for (const map of catalogue.maps || []) {
  const list = Array.isArray(map.provider) ? map.provider : [];
  for (const name of list) {
    used.set(name, (used.get(name) || 0) + 1);
    if (canonical.has(name)) continue;
    if (aliasTo.has(name)) {
      if (!revived.has(name)) revived.set(name, []);
      revived.get(name).push(map.id);
      continue;
    }
    if (!unknown.has(name)) unknown.set(name, []);
    unknown.get(name).push(map.id);
  }
}

if (LIST) {
  const rows = [...used].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of rows) {
    const entry = providers.find((p) => p.name === name);
    const flags = [entry?.jurisdiction, entry?.pendingReview ? 'pendingReview' : null]
      .filter(Boolean).join(' ');
    console.log(`${String(count).padStart(4)}  ${name.padEnd(58)} ${flags}`);
  }
  console.log(`\n${rows.length} distinct provider(s) across ${(catalogue.maps || []).length} catalogue entries.`);
  process.exit(0);
}

const problems = [];

if (revived.size) {
  problems.push(`${revived.size} merged spelling(s) have come back:`);
  for (const [name, ids] of revived) {
    problems.push(`    "${name}" -> use "${aliasTo.get(name)}"  (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''})`);
  }
}

if (unknown.size) {
  problems.push(`${unknown.size} provider(s) are not in the registry:`);
  for (const [name, ids] of unknown) {
    problems.push(`    "${name}"  (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''})`);
  }
  problems.push('    Add it to data/database/providers.json, or correct the spelling. A new');
  problems.push('    provider is a real decision: it says whose work this is.');
}

const unused = providers.filter((p) => !used.has(p.name));

if (problems.length) {
  console.error('FAIL: provider names disagree with the registry.');
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

const pending = providers.filter((p) => p.pendingReview).length;
console.log(`PASS: ${used.size} distinct provider(s), all registered.`);
if (pending) {
  console.log(`  ${pending} entr(ies) marked pendingReview -- open questions about how a body`);
  console.log('  should be credited, recorded rather than resolved. Not a failure.');
}
if (unused.length) {
  console.log(`  ${unused.length} registry entr(ies) no longer used by any map: `
    + `${unused.slice(0, 5).map((p) => p.name).join(', ')}${unused.length > 5 ? ', …' : ''}`);
}
