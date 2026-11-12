/**
 * The colours registry (data/registries/colours.json) and the parties registry's palettes part are
 * the only code-side home of colour literals outside the token files (docs/ARCHITECTURE-RULES.md R9,
 * check C8). These tests hold the registry to its schema and checks, its browser slice to a fresh
 * build, and the readers to the answers they gave before the colours moved out of them (12 Nov 2026):
 * the contrast picks, the fallbacks and the STV viewer's party table.
 *
 *   node --test tests/unit/registries-colours.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';
import { browserColours, checkColours } from '../../packages/registries/src/colours.mjs';
import { PALETTE_SLICES } from '../../packages/registries/src/browser/build.mjs';
import colours from '../../packages/registries/src/browser/colours.mjs';
import partyPalettes from '../../packages/registries/src/browser/party-palettes.mjs';
import { CENSUS_RAMPS, EXPORT_COLOURS, MAP_COLOURS, NUMERIC_SCALE, VIEWER_COLOURS } from '../../packages/map/src/colours.mjs';
import { inkOn as electionsInkOn } from '../../site/apps/elections/lib/format.js';
import { diverging, sequential } from '../../site/apps/elections/lib/scales.js';
import { inkOn as catalogueInkOn } from '../../src/catalogue/util.js';
import { NEUTRAL_PARTY_COLOUR, isPlaceholderPartyColour } from '../../packages/core/src/election-domain.mjs';
import { CANDIDATE_PALETTE } from '../../packages/core/src/area-results.mjs';
import { partyColour, safeCssColour } from '../../packages/map/src/election/palette.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('colours: the registry passes its schema and checks, and the checks catch a value that is not a colour', () => {
  const registry = loadRegistry('colours');
  assert.deepEqual(checkColours(registry), []);
  const broken = structuredClone(registry);
  broken.palettes.map.colours.layer = { value: 'blue' };
  assert.deepEqual(registryErrors('colours', broken), ['colours: map.layer holds "blue", which is not a colour']);
  broken.palettes.map.colours.layer = { value: '#3388ff', values: ['#3388ff'] };
  assert.equal(registryErrors('colours', broken).length, 1, 'an entry holds one kind of value');
});

test('colours: the browser slice is the registry by palette and role, and a palette slice C8 allows', () => {
  assert.deepEqual(colours, browserColours(loadRegistry('colours')));
  assert.ok(PALETTE_SLICES.includes('colours.json') && PALETTE_SLICES.includes('party-palettes.json'));
  assert.deepEqual(Object.keys(colours), ['map', 'mapExport', 'ramps', 'catalogue', 'electionsApp', 'browse', 'gallery', 'viewer', 'areaResults']);
});

test('colours: the map app reads its palettes through the registry slice, value for value', () => {
  assert.deepEqual({ ...MAP_COLOURS }, colours.map);
  assert.deepEqual({ ...EXPORT_COLOURS }, colours.mapExport);
  assert.deepEqual([...NUMERIC_SCALE], colours.ramps.electionNumeric);
  assert.deepEqual(CENSUS_RAMPS, colours.ramps.census);
  // Spot values, exactly as the code spelled them (case included).
  assert.equal(MAP_COLOURS.interactionFill, '#FDBA74');
  assert.equal(MAP_COLOURS.unmatchedFill, '#dfe4ec');
  assert.equal(EXPORT_COLOURS.fill, '#ffc8c8');
  assert.equal(CENSUS_RAMPS.viridis[0], '#440154');
});

test('colours: the contrast picks give the inks they gave before', () => {
  assert.equal(electionsInkOn('#ffffff'), '#000');
  assert.equal(electionsInkOn('#000000'), '#fff');
  assert.equal(electionsInkOn('not a colour'), '#000');
  assert.equal(catalogueInkOn('#ffffff'), '#1a202c');
  assert.equal(catalogueInkOn('#000000'), '#fff');
  assert.equal(catalogueInkOn(''), '#fff');
});

test('colours: the Elections app scales and the fallbacks are unchanged', () => {
  assert.equal(sequential(0, 0, 1), '#eef4fb');
  assert.equal(sequential(1, 0, 1), '#0d3b6e');
  assert.equal(diverging(0, 10), '#efefef');
  assert.equal(diverging(-10, 10), '#7a1f1f');
  assert.equal(diverging(10, 10), '#163f73');
  assert.equal(partyColour('no such party'), '#6b7280');
  assert.equal(safeCssColour('url(x)'), '#6b7280');
  assert.equal(NEUTRAL_PARTY_COLOUR, '#6b7280');
  for (const grey of ['#6b7280', '#888888', '#9ca3af', '#9e9e9e', '#a0a0a0', '#a9a9a9', '#808080']) assert.ok(isPlaceholderPartyColour(grey), grey);
  assert.equal(isPlaceholderPartyColour('#cc0000'), false);
  assert.deepEqual([...CANDIDATE_PALETTE].slice(0, 3), ['#1f77b4', '#d62728', '#2ca02c']);
  assert.equal(CANDIDATE_PALETTE.length, 12);
});

test('colours: the STV viewer draws each party in its old colour from the colours its host hands it', () => {
  const source = readFileSync(path.join(ROOT, 'site/app/election-viewer-package/js/stages2.js'), 'utf8');
  assert.equal(source, readFileSync(path.join(ROOT, 'data/elections-source/js/stages2.js'), 'utf8'), 'the two copies');
  assert.doesNotMatch(source, /PARTY_COLOUR_BASE|PARTY_COLOUR_OVERRIDES/);
  /** @type {Record<string, unknown>} */
  const sandbox = { console, civgraphViewerColours: VIEWER_COLOURS };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.$ = Object.assign(() => ({}), { fn: {} });
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const getPartyColour = /** @type {(label: string) => string} */ (sandbox.getPartyColour);
  assert.equal(getPartyColour('Alliance'), '#F6CB2F');
  assert.equal(getPartyColour('Aontú'), '#44532A');
  assert.equal(getPartyColour("Workers' Party of Ireland"), '#930C1A');
  assert.equal(getPartyColour('No such party'), '#c0c0c0');
  // Every row of the table: a label takes the colour of the last row that folds as it does.
  const normalise = /** @type {(label: string) => string} */ (sandbox.normalisePartyKey);
  /** @type {Map<string, string>} */
  const last = new Map();
  for (const [label, colour] of partyPalettes.viewer) last.set(normalise(label), colour);
  for (const [label] of partyPalettes.viewer) assert.equal(getPartyColour(label), last.get(normalise(label)), label);
  assert.equal(VIEWER_COLOURS.voteInk, '#FFFFFF');
  assert.equal(VIEWER_COLOURS.partyFallback, '#b0bec5');
});
