#!/usr/bin/env node
/**
 * One field says "these layers are part of me", and every group has children.
 *
 * WHAT WAS WRONG
 *
 * The catalogue expressed one relation four ways -- `variants`, `members`,
 * `compositeSources`, and `parentId` from the child's end. Measured 2026-08-25 across
 * 1,031 entries the duplication was EXACT: all 27 maps carrying both `members` and
 * `variants` had identical lists, and the single `compositeSources` user matched its
 * `variants` too. So two field names carried no information at all.
 *
 * They still cost something. app.js expanded a composite via `variants`, while
 * maplibre-main-adapter.js expanded it via `members` -- so which code path ran depended
 * on which field a map happened to carry, and the two had different call signatures.
 *
 * `variants` survived: widest use, and the only shape that can carry a per-child label
 * and style. The other two were removed from the catalogue on 2026-08-26 and every
 * reader now goes through compositeChildIds() in src/map-relations.mjs.
 *
 * WHAT THIS CHECKS
 *
 *   1. no catalogue entry reintroduces `members` or `compositeSources`
 *   2. no `isGroup` map has zero children -- a group that expands to nothing renders a
 *      blank map and reports no error, which is how this class of defect hides
 *   3. every child a composite names is RESOLVABLE, by any of the three legitimate
 *      routes: a catalogue entry of its own (eds-1926's members), an inline variant
 *      carrying its own `files` (ni-townlands-1844's 32 county variants), or a render
 *      layer (all-ireland-townlands -> ni-townlands, which exists only in the render
 *      metadata). A child reachable by none of the three draws nothing and says nothing,
 *      which is the failure worth catching.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-composite-relations.mjs
 */
import { readFileSync } from 'node:fs';
import { compositeChildIds } from '../src/map-relations.mjs';

const RENDER = 'render/metadata/maps-test.json';

const CATALOGUE = 'data/database/maps.json';
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const maps = catalogue.maps || [];
const byId = new Set(maps.map((map) => map.id));
// A composite child may exist only in the render metadata -- the renderer is what
// actually draws it, so that is a real way to resolve, not a loophole.
const renderLayerIds = new Set(
  (JSON.parse(readFileSync(RENDER, 'utf8')).layers || [])
    .flatMap((layer) => [layer.sourceMapId, layer.id])
    .filter(Boolean));

const revived = [];
const emptyGroups = [];
const danglingChildren = [];

for (const map of maps) {
  for (const field of ['members', 'compositeSources']) {
    if (Array.isArray(map[field]) && map[field].length) revived.push(`${map.id} carries ${field}`);
  }
  const children = compositeChildIds(map);
  if (map.isGroup && !children.length) emptyGroups.push(map.id);
  // An inline variant defines itself; only a child that is neither a catalogue entry
  // nor self-defining is dangling.
  const inlineWithData = new Set((map.variants || [])
    .filter((variant) => variant && typeof variant === 'object' && (variant.files || variant.cloneOf))
    .map((variant) => variant.id));
  for (const childId of children) {
    if (byId.has(childId) || inlineWithData.has(childId) || renderLayerIds.has(childId)) continue;
    danglingChildren.push(`${map.id} -> ${childId}`);
  }
}

const problems = [];
if (revived.length) {
  problems.push(`${revived.length} entr(ies) reintroduce a removed relation field:`);
  problems.push(...revived.slice(0, 10).map((line) => `    ${line}`));
  problems.push('    Use `variants`. It is the only shape that carries a per-child label and style,');
  problems.push('    and a second spelling means two code paths for one relation again.');
}
if (emptyGroups.length) {
  problems.push(`${emptyGroups.length} isGroup map(s) expand to NO children:`);
  problems.push(...emptyGroups.slice(0, 10).map((id) => `    ${id}`));
  problems.push('    A group with no children renders a blank map and reports nothing.');
}
if (danglingChildren.length) {
  problems.push(`${danglingChildren.length} composite(s) name a child that does not exist:`);
  problems.push(...danglingChildren.slice(0, 10).map((line) => `    ${line}`));
}

if (problems.length) {
  console.error('FAIL: composite relation problems.');
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

const composites = maps.filter((map) => compositeChildIds(map).length);
console.log(`PASS: ${composites.length} composite(s) resolve through one field; `
  + `${maps.filter((m) => m.isGroup).length} group(s), none empty, no dangling children.`);
