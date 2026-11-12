// The map app's modules that were src/ files keep their served paths (rf9-mapapp, 12 Nov 2026).
// F2/F4 moved them into packages/map/src/; packages/served.json serves each at its old /src/ path,
// one key per file plus src/catalogue/, listed before src/map/ (the first key whose source holds a
// file gives its served path, so a reordering would quietly serve them under /src/map/).
//
//   node --test tests/unit/map-served-paths.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SERVED_FROM, servedOf, siteFiles, sourceOf } from '../../scripts/build/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every file the move took out of src/, by its served (old) path. Add to it; never take one out.
const MOVED = [
  'src/catalogue/custom-icons.js', 'src/catalogue/edit.js', 'src/catalogue/flag.js', 'src/catalogue/geocoder.js',
  'src/catalogue/icons.js', 'src/catalogue/index.js', 'src/catalogue/lang-reveal.js', 'src/catalogue/menu.js',
  'src/catalogue/route-state.mjs', 'src/catalogue/search.js', 'src/catalogue/slider.js', 'src/catalogue/split.js',
  'src/catalogue/styles.js', 'src/catalogue/util.js', 'src/catalogue/view-books.js', 'src/catalogue/view-elections.js',
  'src/catalogue/view-maps.js', 'src/cdn-url.js', 'src/census-overlay.mjs', 'src/data-service.js', 'src/debug-log.js',
  'src/election-main-pane-contract.mjs', 'src/election-renderer.mjs', 'src/election-trend-chart.mjs',
  'src/election-utils.js', 'src/entity-detail-data.mjs', 'src/feature-loader.js', 'src/fgb-worker.js',
  'src/jquery-shim.js', 'src/map-relations.mjs', 'src/ni-local-groups.mjs', 'src/printed-labels.mjs',
  'src/public-map.mjs', 'src/storage-keys.mjs', 'src/ui-controller.js', 'src/ui-state-machines.mjs',
];

test('every moved module is a packages/map/src file served at its old /src/ path', () => {
  for (const served of MOVED) {
    const source = `packages/map/${served}`;
    assert.ok(existsSync(path.join(ROOT, source)), `${source} is missing`);
    assert.ok(!existsSync(path.join(ROOT, served)), `${served} is back in src/: edit packages/map/src instead`);
    assert.equal(sourceOf(served), source, `${served} is not answered from ${source}`);
    assert.equal(servedOf(source), served, `${source} is served at ${servedOf(source)}, not ${served}`);
  }
});

test('the map modules that were src/map/ files keep /src/map/ (the moved keys did not capture them)', () => {
  for (const file of ['state-helpers.mjs', 'colours.mjs', 'app/helpers.mjs', 'election/palette.mjs', 'renderer/map-controller.js']) {
    assert.equal(servedOf(`packages/map/src/${file}`), `src/map/${file}`);
  }
});

test('the src/ keys come before src/map/, and src/ itself holds only vendored files', () => {
  const keys = Object.keys(SERVED_FROM);
  const mapKey = keys.indexOf('src/map/');
  for (const key of keys.filter((k) => k.startsWith('src/') && k !== 'src/map/')) {
    assert.ok(keys.indexOf(key) < mapKey, `${key} must come before src/map/ in packages/served.json`);
  }
  // An empty folder a checkout keeps after the move (git tracks files, not folders) does not count.
  const left = readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })
    .filter((e) => e.isFile() || readdirSync(path.join(ROOT, 'src', e.name)).length).map((e) => e.name).sort();
  assert.deepEqual(left, ['README.md', 'libs', 'sql.js-httpvfs']);
});

test('dist/ gets every moved module at its old path, and nothing under src/map/ for them', () => {
  const { files } = siteFiles(ROOT);
  const served = new Set(files);
  for (const file of MOVED) assert.ok(served.has(file), `${file} is not published`);
  for (const file of files) {
    if (!file.startsWith('src/map/')) continue;
    const rest = file.slice('src/map/'.length);
    assert.ok(!MOVED.includes(`src/${rest}`), `${file} doubles ${`src/${rest}`}`);
  }
});

test('the bundle copies the jQuery shim from its new place', () => {
  const bundle = readFileSync(path.join(ROOT, 'scripts/build/app-bundle.mjs'), 'utf8');
  assert.match(bundle, /\['packages\/map\/src\/jquery-shim\.js', 'site\/app\/js\/jquery-shim\.js'\]/);
});
