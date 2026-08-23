#!/usr/bin/env node
/**
 * Every published polygon layer must have a labelProperty, or be a known nameless one.
 *
 * WHAT THIS GUARDS
 *
 * labelProperty is what draws a feature's name. Without it a polygon shows nothing on
 * hover or selection, and nothing complains -- MapLibre renders no text for a missing
 * attribute exactly as silently as it renders none for an absent setting. So the failure
 * mode is a layer that looks anonymous rather than broken.
 *
 * A MEASUREMENT CORRECTION WORTH KEEPING. This was first reported as "82 published
 * polygon layers show no name", measured from data/database/maps.json. That was wrong by
 * about three times. The RENDERER reads render/metadata/maps-test.json, and 54 of those
 * 82 already carried a labelProperty there; the two files were out of sync in the
 * direction that costs nothing. The real user-visible gap was 28, of which 6 had a usable
 * name in their tiles and now use it.
 *
 * This validator therefore checks the RENDER record, because that is the file the
 * renderer reads.
 *
 * THE ALLOWLIST IS NOT A BACKLOG. The 22 layers in
 * data/database/nameless-polygon-layers.json were each checked against their own tiles:
 * flood extents, noise contours, elevation bands and water bodies carrying only OBJECTIDs
 * and GUIDs. There is no name to show, so no labelProperty is the honest state. They are
 * listed so a NEW unlabelled layer fails here instead of joining them unnoticed.
 *
 * To add a layer to the allowlist, first run
 * `node scripts/assign-missing-label-properties.mjs` and confirm it reports no name-like
 * attribute. Do not add one to silence this check.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-polygon-label-properties.mjs
 */
import { readFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const ALLOWLIST = 'data/database/nameless-polygon-layers.json';

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));
const allowed = new Set(JSON.parse(readFileSync(ALLOWLIST, 'utf8')).layers || []);

const layerByMapId = new Map();
for (const layer of render.layers || []) {
  const geometry = String(layer.geometryType || '').toLowerCase();
  if (layer.sourceType !== 'pmtiles') continue;
  if (geometry !== 'polygon' && geometry !== 'multipolygon') continue;
  if (!layerByMapId.has(layer.sourceMapId)) layerByMapId.set(layer.sourceMapId, layer);
}

const offenders = [];
let checked = 0;
for (const map of catalogue.maps || []) {
  if (map.hidden || map.placeholder) continue;
  const layer = layerByMapId.get(map.id);
  if (!layer) continue;
  checked += 1;
  if (layer.labelProperty) continue;
  if (allowed.has(map.id)) continue;
  offenders.push(map.id);
}

// A shrinking allowlist should shrink the FILE too, or it rots into a list of layers that
// were fixed years ago and nobody dares remove.
const stale = [...allowed].filter((id) => layerByMapId.get(id)?.labelProperty);

if (offenders.length || stale.length) {
  if (offenders.length) {
    console.error(`FAIL: ${offenders.length} published polygon layer(s) have no labelProperty.`);
    for (const id of offenders.slice(0, 20)) console.error(`  - ${id}`);
    if (offenders.length > 20) console.error(`  ... and ${offenders.length - 20} more`);
    console.error('');
    console.error('  Those layers show no name on hover or selection, and nothing reports it.');
    console.error('  Fix: node scripts/assign-missing-label-properties.mjs --write');
    console.error(`  If a layer genuinely has no name in its tiles, add it to ${ALLOWLIST}.`);
  }
  if (stale.length) {
    console.error(`FAIL: ${stale.length} allowlisted layer(s) now HAVE a labelProperty and should be removed from ${ALLOWLIST}:`);
    for (const id of stale) console.error(`  - ${id}`);
  }
  process.exit(1);
}

console.log(`PASS: ${checked} published polygon layer(s); ${checked - allowed.size} labelled, ${allowed.size} allowlisted as nameless.`);
