// The map app's typed `this` (rf9-mapapp, 12 Nov 2026). packages/map/src/app/map-app.d.ts declares
// what the app's method modules may use of the app; it is hand-written, so this test holds it to the
// code: every member it declares is really there, and every method of a method module in the type
// check types its `this`. The legend's markup (legend-view.mjs) is checked with sample data too.
//
//   node --test tests/unit/map-app-host.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const HOST = read('packages/map/src/app/map-app.d.ts');
const APP = read('packages/map/app/app.js');
const METHOD_DIR = 'packages/map/src/app';
const methodModules = () => {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js') && /export class \w+Methods\b/.test(read(child))) out.push(child);
    }
  };
  walk(METHOD_DIR);
  return out;
};

/** The members an interface of map-app.d.ts declares: { name, method }. */
function members(name) {
  const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(HOST)?.[1];
  assert.ok(body, `map-app.d.ts has no interface ${name}`);
  return [...body.matchAll(/^ {2}(\w+)(\?)?(\(|:)/gm)].map((m) => ({ name: m[1], method: m[3] === '(' }));
}

const defines = (source, name) => new RegExp(`^ {2}(?:async )?${name}\\(`, 'm').test(source);
const assigns = (source, name) => new RegExp(`this\\.${name} = `).test(source);

test('every MapApp field is set in the app, and every method is the app\'s or a method module\'s', () => {
  const modules = methodModules().map(read);
  const constructorBody = /constructor\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(APP)?.[1] || '';
  for (const { name, method } of members('MapApp')) {
    if (method) assert.ok(defines(APP, name) || modules.some((source) => defines(source, name)), `MapApp.${name}() is defined nowhere`);
    else assert.ok(assigns(constructorBody, name), `MapApp.${name} is not set in Test2App's constructor`);
  }
});

test('the controller and election views name members those classes have', () => {
  const adapter = read('packages/map/app/maplibre-main-adapter.js');
  const manager = read('packages/map/app/election-manager.js');
  // The optional members of MapControllerView are the dashboard's defensive reads (see map-app.d.ts).
  for (const { name, method } of members('MapControllerView')) {
    if (['layers', 'metrics', 'runtimeProfile', 'getMetrics'].includes(name)) continue;
    assert.ok(method ? defines(adapter, name) : assigns(adapter, name), `MapControllerView.${name} is not on the adapter`);
  }
  for (const { name, method } of members('ElectionsView')) {
    assert.ok(method ? defines(manager, name) : assigns(manager, name), `ElectionsView.${name} is not on the election manager`);
  }
});

test('a method module in the type check types `this` on every method', () => {
  const config = JSON.parse(read('packages/map/tsconfig.check.json'));
  const checked = methodModules().filter((file) => config.include.includes(file.replace('packages/map/', '')));
  assert.ok(checked.length >= 3, 'legend.js, performance.js and site-chrome.js are checked');
  for (const file of checked) {
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      if (!/^ {2}(?:async )?(?:get |set )?[A-Za-z_$][\w$]*\([^)]*\) \{$/.test(line)) return;
      const doc = lines.slice(Math.max(0, i - 30), i).join('\n');
      const block = doc.slice(doc.lastIndexOf('/**'));
      assert.match(block, /@this \{\w+\}/, `${file}:${i + 1} ${line.trim()} has no @this`);
    });
  }
});

test('legend-view renders an election key, a statistic and the other maps', async () => {
  const { legendBodyHtml, legendSummaryText, legendShellHtml, legendInk } = await import('../../packages/map/src/app/legend-view.mjs');
  const { LEGEND_SAMPLE } = await import('../../packages/map/src/specimens.mjs');
  const html = legendBodyHtml(LEGEND_SAMPLE);
  assert.match(html, /^<p class="test2-map-legend__heading">Constituencies coloured by winner<\/p>/);
  assert.match(html, /<span class="test2-map-legend__abbr">\(FF\)<\/span><\/span><span class="test2-map-legend__count">12<\/span>/);
  assert.match(html, /<p class="test2-map-legend__note">and 1 more<\/p>/, 'fourteen rows at most');
  assert.match(html, /data-census-legend="census-1911-population"/);
  assert.match(html, /<p class="test2-map-legend__heading">Other maps<\/p>/);
  assert.match(html, /\(older edition, grey dashed\)/);
  assert.match(html, /data-approximate-legend/);
  assert.match(html, /data-map-image-export="election-dil-ireann-2024-11-29"/);
  assert.equal(legendSummaryText(LEGEND_SAMPLE.election, LEGEND_SAMPLE.statistics), 'Legend: Winner');
  assert.equal(legendSummaryText(null, LEGEND_SAMPLE.statistics.slice(0, 1)), 'Legend: Population, 1911');
  assert.equal(legendShellHtml(false).includes(' open'), false);
  assert.equal(legendInk('#ffffff'), legendInk('#fefefe'));
  assert.notEqual(legendInk('#000000'), legendInk('#ffffff'));
  // Nothing on the map: nothing to say.
  assert.equal(legendBodyHtml({ election: null, statistics: [], layers: [], showLayers: false, approximate: [], electionMapId: null }), '');
});
