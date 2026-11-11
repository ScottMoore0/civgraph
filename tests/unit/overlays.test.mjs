import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RASTER_OVERLAYS, REMOVED_OVERLAY_IDS, overlayConfig } from '../../packages/map/src/renderer/overlays.mjs';

// The CARTO Voyager Labels and MERIT-Basins overlays were removed on 11 Nov 2026 (owner, batch 4).

test('the removed overlays are not in the registry, and naming one gives nothing', () => {
  assert.deepEqual([...REMOVED_OVERLAY_IDS].sort(), ['merit-catchments', 'merit-rivers', 'voyager-labels']);
  for (const id of REMOVED_OVERLAY_IDS) {
    assert.equal(Object.hasOwn(RASTER_OVERLAYS, id), false, id);
    assert.equal(overlayConfig(id), null, id);
  }
  for (const id of [undefined, null, '', 'toString', '__proto__', 'constructor']) assert.equal(overlayConfig(id), null, String(id));
  assert.ok(Object.isFrozen(RASTER_OVERLAYS));
});

test('no overlay loads from tiles.arcgis.com or CARTO, or credits MERIT or CARTO', () => {
  const text = JSON.stringify(RASTER_OVERLAYS);
  assert.doesNotMatch(text, /tiles\.arcgis\.com|cartocdn\.com|MERIT|CARTO/i);
});

test('neither map page offers the removed overlays, and the map app has no copy of their tiles', () => {
  for (const page of ['site/maps/index.html', 'site/maps/classic/index.html']) {
    const html = readFileSync(page, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(html, /id="overlay(Toggle|List|VoyagerLabels|MeritCatchments|MeritRivers)"/, page);
    assert.doesNotMatch(html, /Voyager Labels|MERIT-Basins/, page);
  }
  for (const file of ['packages/map/app/maplibre-main-adapter.js', 'packages/map/src/app/controls.js']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /tiles\.arcgis\.com|voyager_only_labels|MERIT_Ri/, file);
  }
});
