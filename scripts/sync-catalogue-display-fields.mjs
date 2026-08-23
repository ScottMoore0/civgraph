#!/usr/bin/env node
/**
 * Propagate catalogue-owned display fields into the render record.
 *
 * WHY 234 OF 371 BASELINED PARITY FINDINGS ARE ONE BUG
 *
 * The catalogue/render parity check carries 371 pinned findings. Classified in full on
 * 2026-08-22 they are not 371 problems but a handful of causes, and the two largest are
 * the same shape:
 *
 *   164  render record dropped a keyword the catalogue records (search terms lost)
 *    70  render record dropped a style property the catalogue sets
 *
 * The render records were assembled once, by promote-test-converted-layers.mjs, which
 * merged the catalogue's keywords at that moment. Nothing re-synced them afterwards. So
 * every keyword added to the catalogue since — every search term, every jurisdiction tag
 * — exists in maps.json and not in the record the renderer actually reads. Measured
 * before this script: 166 layers losing keywords, 66 losing style properties.
 *
 * It is a live defect, not bookkeeping. Those keywords are search terms, so a layer
 * tagged "connacht" or "civil parish" in the catalogue is not findable by them in the
 * app.
 *
 * MERGE, DO NOT REPLACE, in both directions:
 *
 *   keywords  UNION. The render record legitimately adds its own ("maplibre",
 *             "vector tiles", the category and group names). Replacing with the
 *             catalogue's set would delete those.
 *   style     FILL MISSING KEYS ONLY. A render record may deliberately override a
 *             colour for the vector renderer; the finding is that it DROPPED a property,
 *             not that it changed one. Overwriting would trade 70 findings for however
 *             many deliberate overrides exist.
 *
 * Runs inside `npm run build`, so it cannot drift again. --check fails instead of
 * writing, which is what the gate uses.
 *
 *   node scripts/sync-catalogue-display-fields.mjs
 *   node scripts/sync-catalogue-display-fields.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const CHECK = process.argv.includes('--check');

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));

const catalogueById = new Map((catalogue.maps || []).map((m) => [m.id, m]));

let keywordLayers = 0;
let keywordsAdded = 0;
let styleLayers = 0;
let providerLayers = 0;
let providersAdded = 0;
let stylePropsAdded = 0;

for (const layer of render.layers || []) {
  const mapId = layer.sourceMapId || String(layer.id || '').replace(/-vector-test$/, '');
  const map = catalogueById.get(mapId);
  if (!map) continue;

  const wanted = (map.keywords || []).filter(Boolean);
  if (wanted.length) {
    const have = new Set(layer.keywords || []);
    const missing = wanted.filter((k) => !have.has(k));
    if (missing.length) {
      keywordLayers += 1;
      keywordsAdded += missing.length;
      if (!CHECK) layer.keywords = [...(layer.keywords || []), ...missing];
    }
  }

  // provider is ATTRIBUTION, and unlike keywords it is REPLACED, not unioned.
  //
  // It was unioned at first, by analogy with keywords. That is wrong, and the flaw only
  // showed when a credit had to be CORRECTED rather than added: admin-areas-1966-07-04
  // was changed from ["OSNI"] to ["XrysD"] on 2026-08-23, and the union left the render
  // record claiming ["OSNI","XrysD"] -- asserting a joint provenance that does not exist
  // and that nobody wrote. A union can only ever add, so a wrong credit is permanent.
  //
  // The catalogue is the reviewed source of truth for attribution, so the render record
  // mirrors it exactly. Keywords stay a union because the render record legitimately adds
  // its own ("maplibre", "vector tiles", the category name); no such case exists for
  // provider -- a renderer has no credits of its own to contribute.
  const wantedProvider = Array.isArray(map.provider) ? map.provider.filter(Boolean) : [];
  if (wantedProvider.length) {
    const current = Array.isArray(layer.provider) ? layer.provider : (layer.provider ? [layer.provider] : []);
    if (JSON.stringify(current) !== JSON.stringify(wantedProvider)) {
      providerLayers += 1;
      providersAdded += Math.abs(wantedProvider.length - current.length) || wantedProvider.length;
      if (!CHECK) layer.provider = [...wantedProvider];
    }
  }

  if (map.style && typeof map.style === 'object') {
    const target = layer.style && typeof layer.style === 'object' ? layer.style : null;
    const missingProps = Object.keys(map.style).filter((k) => !target || !(k in target));
    if (missingProps.length) {
      styleLayers += 1;
      stylePropsAdded += missingProps.length;
      if (!CHECK) {
        layer.style = { ...(target || {}) };
        for (const key of missingProps) layer.style[key] = map.style[key];
      }
    }
  }
}

if (CHECK) {
  if (keywordLayers || styleLayers || providerLayers) {
    console.error('FAIL: the render record is missing catalogue display fields.');
    console.error(`  - ${keywordLayers} layer(s) missing ${keywordsAdded} keyword(s)`);
    console.error(`  - ${styleLayers} layer(s) missing ${stylePropsAdded} style propert(ies)`);
    console.error(`  - ${providerLayers} layer(s) missing ${providersAdded} provider credit(s)`);
    console.error('');
    console.error('  Keywords are search terms: a layer tagged in the catalogue and not in the');
    console.error('  render record cannot be found by that term in the app.');
    console.error('  Fix: node scripts/sync-catalogue-display-fields.mjs');
    process.exit(1);
  }
  console.log('PASS: the render record carries every catalogue keyword and style property.');
  process.exit(0);
}

writeFileSync(RENDER, `${JSON.stringify(render, null, 2)}\n`);
console.log(`Synced ${keywordsAdded} keyword(s) into ${keywordLayers} layer(s), `
  + `${stylePropsAdded} style propert(ies) into ${styleLayers} layer(s), `
  + `and ${providersAdded} provider credit(s) into ${providerLayers} layer(s).`);
