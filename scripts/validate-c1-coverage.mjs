#!/usr/bin/env node
/**
 * Every renderable layer in the catalogue must be reachable from a catalogue card.
 *
 * WHY. The catalogue pane a user actually browses is not built from data/database/maps.json.
 * It is built from `const c1Cards = [...]`, a hand-maintained array of ~127 card definitions
 * inside js/ui-controller.js, each naming its rows explicitly via mapIds[] or classIds[].
 * Nothing connects that array to the catalogue, so adding a map to maps.json -- correctly
 * categorised, tiled, served from the CDN, passing every other check -- puts it nowhere a
 * user can click. It is present, healthy, and invisible.
 *
 * That is exactly what happened to the Ward/DED composites for 1941, 1942, 1943 and 1985.
 * They sat in the catalogue with four members each, all four provinces converted and
 * indexed, bounds declared, hidden:false -- and the `flat-roi-deds` card listed
 * eds-roi-1936 then jumped straight to eds-roi-1944. Four days of "the new maps still
 * aren't showing" were spent on caches, service workers, bounds, class membership and
 * tile URLs, because every one of those was a plausible cause and all of them were fine.
 * The one thing never checked was whether anything rendered a row for them at all.
 *
 * A layer is RENDERABLE when the app could draw it, mirroring validate-layer-resolution:
 *   group    members[] is non-empty and every member is in the tile index
 *   direct   the layer id or sourceMapId appears in the tile index
 *   chunked  the layer loads a <id>-chunks.json index rather than tiles
 *
 * Stubs -- catalogue entries for material not yet digitised -- are deliberately exempt.
 * They cannot render, so a missing card row costs nothing, and failing on them would bury
 * the real gaps.
 *
 * A RATCHET, NOT A CLIFF. 180 renderable layers were already uncovered when this check was
 * written; failing on all of them would make it useless on day one and it would be
 * disabled within the hour. The baseline records those known gaps. New gaps fail; closing
 * an old one is reported and the baseline can be re-pinned with --update-baseline. The
 * count only goes down.
 *
 * ALSO CHECKED: placeholder:true on a layer that is renderable. The card draws those rows
 * as inert "To Be Added" text with no link, so a stale flag hides a working layer just as
 * effectively as a missing row -- which is what eds-roi-1944 did, sitting in the card the
 * whole time and looking undigitised.
 *
 * Usage: node scripts/validate-c1-coverage.mjs [--update-baseline] [--json]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const UI = resolve(ROOT, 'js/ui-controller.js');
const CATALOGUE = resolve(ROOT, 'data/database/maps.json');
const INDEX = resolve(ROOT, 'test/metadata/maps-test-index.json');
const BASELINE = resolve(ROOT, 'data/database/c1-coverage-baseline.json');

const UPDATE = process.argv.includes('--update-baseline');
const AS_JSON = process.argv.includes('--json');

for (const p of [UI, CATALOGUE, INDEX]) {
  if (!existsSync(p)) {
    console.error(`FAIL: missing required file ${p}`);
    process.exit(1);
  }
}

// Extract the card array by bracket balance rather than a line range, so the check does not
// silently start reading the wrong block the next time something is inserted above it. The
// array is pure data -- object literals of strings and string arrays -- so evaluating it is
// how we read it without duplicating the definitions here and letting the copy drift.
function readC1Cards(source) {
  const marker = /const\s+c1Cards\s*=\s*\[/.exec(source);
  if (!marker) throw new Error('Could not find `const c1Cards = [` in js/ui-controller.js');
  const open = source.indexOf('[', marker.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-eval
        return eval(source.slice(open, i + 1));
      }
    }
  }
  throw new Error('Unbalanced brackets while reading the c1Cards array');
}

const uiSource = readFileSync(UI, 'utf8');
const cards = readC1Cards(uiSource);

// The catalogue appends a generated card per category for any layer with data that no
// explicit card claims, which is what makes full coverage structural rather than a list
// somebody has to remember to update. If that block is ever removed, coverage silently
// reverts to explicit-only and 180 layers disappear again -- so its presence is itself
// part of the invariant, and is asserted rather than assumed.
const hasGeneratedFallback = uiSource.includes('flat-uncarded-');
const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const indexLayers = JSON.parse(readFileSync(INDEX, 'utf8')).layers || [];

const indexed = new Set();
for (const layer of indexLayers) {
  if (layer?.id) indexed.add(layer.id);
  if (layer?.sourceMapId) indexed.add(layer.sourceMapId);
}

const classById = new Map((catalogue.classes || []).map((c) => [c.id, c]));

const covered = new Set();
for (const card of cards) {
  for (const id of card.mapIds || []) covered.add(id);
  for (const classId of card.classIds || []) {
    const cls = classById.get(classId);
    if (cls) for (const id of cls.maps || []) covered.add(id);
  }
}

// Variants are addressed through their parent's row, never given one of their own, so a
// variant with no card of its own is correct rather than a gap.
const variantIds = new Set();
for (const m of catalogue.maps || []) {
  for (const v of m.variants || []) if (v.id) variantIds.add(v.id);
}

const isRenderable = (m) => {
  const members = m.members || [];
  if (members.length) return members.every((id) => indexed.has(id));
  return indexed.has(m.id) || Boolean(m.chunked);
};

const visible = (catalogue.maps || []).filter((m) => !m.hidden);

// Mirrors the generated-card rule in ui-controller.js exactly: a visible, non-variant
// layer that owns data gets a category card. Renderable implies it owns data, so with the
// fallback in place nothing renderable can be unreachable -- which is the point.
const claimedByFallback = (m) => hasGeneratedFallback
  && !variantIds.has(m.id)
  && Boolean(Object.keys(m.files || {}).length
    || (m.variants || []).length
    || (m.members || []).length
    || m.chunked);

const uncovered = visible
  .filter((m) => !covered.has(m.id) && !variantIds.has(m.id) && isRenderable(m) && !claimedByFallback(m))
  .map((m) => m.id)
  .sort();

// Not a failure -- these render, and a user can reach them. It is a curation backlog: a
// generated card groups by raw category and cannot know that the 1918 constituencies
// belong beside the 1885 ones, so a growing number here means the explicit cards are
// falling behind, not that anything is broken.
const relyingOnFallback = visible
  .filter((m) => !covered.has(m.id) && !variantIds.has(m.id) && isRenderable(m) && claimedByFallback(m))
  .map((m) => m.id)
  .sort();

const stalePlaceholders = visible
  .filter((m) => m.placeholder && isRenderable(m))
  .map((m) => m.id)
  .sort();

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).uncovered || [])
  : new Set();

const newGaps = uncovered.filter((id) => !baseline.has(id));
const closed = [...baseline].filter((id) => !uncovered.includes(id)).sort();

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({
    note: 'Renderable layers with no catalogue card row. Ratchet baseline for validate-c1-coverage.mjs; this list may shrink, never grow.',
    uncovered
  }, null, 2)}\n`);
  console.log(`Baseline re-pinned: ${uncovered.length} known-uncovered renderable layer(s).`);
  process.exit(0);
}

const failures = newGaps.length + stalePlaceholders.length;

if (AS_JSON) {
  console.log(JSON.stringify({
    cards: cards.length, covered: covered.size, visible: visible.length,
    uncovered, newGaps, closed, stalePlaceholders
  }, null, 2));
} else {
  console.log(`Catalogue card coverage: ${cards.length} explicit cards name ${covered.size} layer ids; ${visible.length} visible catalogue layers.`);
  console.log(`  generated per-category fallback present: ${hasGeneratedFallback ? 'yes' : 'NO'}`);
  console.log(`  renderable layers reachable only via the fallback: ${relyingOnFallback.length} (curation backlog, not a failure)`);
  console.log(`  renderable layers with no card row at all: ${uncovered.length} (${baseline.size} baselined)`);

  if (!hasGeneratedFallback) {
    console.error('\nThe generated per-category card block is gone from js/ui-controller.js.');
    console.error('  Without it, only explicitly listed layers appear in the catalogue.');
  }

  if (newGaps.length) {
    console.error(`\nFAIL: ${newGaps.length} renderable layer(s) are in the catalogue but no card shows them, so no user can reach them.`);
    for (const id of newGaps.slice(0, 25)) console.error(`    ${id}`);
    if (newGaps.length > 25) console.error(`    ... and ${newGaps.length - 25} more`);
    console.error('  Add each to a card\'s mapIds[] in the c1Cards array in js/ui-controller.js,');
    console.error('  or to a class already named by a card\'s classIds[].');
  }

  if (stalePlaceholders.length) {
    console.error(`\nFAIL: ${stalePlaceholders.length} layer(s) are flagged placeholder but actually render.`);
    console.error('  The card draws these as inert "To Be Added" text with no link.');
    for (const id of stalePlaceholders) console.error(`    ${id}`);
    console.error('  Remove the placeholder flag from these records in data/database/maps.json.');
  }

  if (closed.length) {
    console.log(`\n${closed.length} baselined gap(s) now covered. Re-pin with --update-baseline:`);
    for (const id of closed.slice(0, 15)) console.log(`    ${id}`);
  }

  if (!failures) console.log('\nPASS: no new coverage gaps, and no renderable layer is masked by a placeholder flag.');
}

process.exit(failures ? 1 : 0);
