// The election-bodies registry (data/registries/election-bodies.json) and its views
// (packages/registries/src/election-bodies.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, registryErrors, REPO_ROOT } from '../../packages/registries/src/index.mjs';
import { byElectionTitleOf, checkElectionBodies, electionBody, fillYear, geographyRuleFor, votingSystemOf } from '../../packages/registries/src/election-bodies.mjs';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';

const registry = loadRegistry('election-bodies');
const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/elections-source/data/elections_index.json'), 'utf8'));
const maps = JSON.parse(readFileSync(path.join(REPO_ROOT, 'render/metadata/maps-test.json'), 'utf8'));

test('the registry passes its schema and checks', () => {
  assert.deepEqual(registryErrors('election-bodies', registry), []);
});

test('each body names the elections index body of the same slug', () => {
  for (const body of registry.bodies) {
    const indexed = index.bodies.find((b) => b.slug === body.id);
    assert.ok(indexed, `${body.id} is in elections_index.json`);
    assert.equal(indexed.name, body.name, `${body.id} name`);
  }
});

test('every map a body draws on is a published layer', () => {
  const ids = new Set(maps.layers.map((layer) => layer.sourceMapId));
  for (const body of registry.bodies) {
    for (const rule of body.geography || []) assert.ok(ids.has(rule.sourceMapId), `${body.id}: ${rule.sourceMapId}`);
  }
});

test('an area-results folder exists for each body that has one', () => {
  for (const body of registry.bodies) {
    if (body.areaResults) assert.ok(existsSync(path.join(REPO_ROOT, body.areaResults.dir)), body.areaResults.dir);
  }
});

test('geographyRuleFor takes the latest rule on or before the date', () => {
  const body = { id: 'x', name: 'X', jurisdiction: 'ireland', sources: ['s'], geography: [
    { from: '2000-01-01', sourceMapId: 'a' }, { from: '2010-01-01', sourceMapId: 'b' }] };
  assert.equal(geographyRuleFor(body, '1999-12-31'), null);
  assert.equal(geographyRuleFor(body, '2000-01-01')?.sourceMapId, 'a');
  assert.equal(geographyRuleFor(body, '2024-06-07-something')?.sourceMapId, 'b');
  assert.equal(geographyRuleFor(null, '2024-06-07'), null);
});

test('fillYear fills {year}, and only for a dated election', () => {
  assert.equal(fillYear('{year} Limerick mayoral election', '2024-06-07'), '2024 Limerick mayoral election');
  assert.equal(fillYear('{year} x', ''), null);
  assert.equal(fillYear(undefined, '2024-06-07'), null);
});

test('checkElectionBodies finds a repeated id and a repeated rule date', () => {
  const body = { id: 'x', name: 'X', jurisdiction: 'ireland', sources: ['s'], geography: [
    { from: '2000-01-01', sourceMapId: 'a' }, { from: '2000-01-01', sourceMapId: 'b' }] };
  const errors = checkElectionBodies({ schemaVersion: 1, description: 'd', bodies: [body, { ...body, geography: undefined }], groups: registry.groups });
  assert.equal(errors.length, 2);
  assert.equal(electionBody(registry, 'limerick-mayor')?.typeLabel, 'Mayoral');
  assert.equal(electionBody(registry, 'no-such-body'), null);
});

test('votingSystemOf: a contest rule before the registered system, none without a registered body', () => {
  const seanad = electionBody(registry, 'seanad-eireann');
  assert.equal(votingSystemOf(seanad, 'Labour Panel'), 'stv-gregory', 'the panels: papers valued at 1,000, fractions transferred');
  assert.equal(votingSystemOf(seanad, 'National University of Ireland'), 'stv-hare');
  assert.equal(votingSystemOf(seanad, 'Dublin University'), 'stv-hare');
  assert.equal(votingSystemOf(seanad, ''), 'stv-gregory', 'the election as a whole takes the registered system');
  assert.equal(votingSystemOf(electionBody(registry, 'limerick-mayor'), 'Limerick City and County'), 'stv-hare');
  assert.equal(votingSystemOf(null, 'Clare'), null);
});

test('byElectionTitleOf and the Seanad titles: general elections by year, by-elections by contest', () => {
  const seanad = electionBody(registry, 'seanad-eireann');
  assert.equal(byElectionTitleOf(seanad, '2026-11-05', ['Cultural and Educational Panel']), '2026 Seanad by-election (Cultural and Educational Panel)');
  assert.equal(byElectionTitleOf(seanad, '1950-05-01', ['Labour Panel', 'Agricultural Panel']), '1950 Seanad by-elections');
  assert.equal(byElectionTitleOf(electionBody(registry, 'limerick-mayor'), '2024-06-07', ['Limerick City and County']), null);
  const panels = ['Administrative Panel', 'Agricultural Panel', 'Cultural and Educational Panel', 'Industrial and Commercial Panel', 'Labour Panel', 'National University of Ireland', 'Dublin University'];
  assert.equal(canonicalElectionTitle({ body: 'Seanad Éireann', bodySlug: 'seanad-eireann', date: '2020-03-30', constituencies: panels }), '2020 Seanad election');
  assert.equal(canonicalElectionTitle({ body: 'Seanad Éireann', bodySlug: 'seanad-eireann', date: '2026-11-05', constituencies: ['Cultural and Educational Panel'] }), '2026 Seanad by-election (Cultural and Educational Panel)');
  // A body with a title and no by-election template is unchanged: the mayoralty is never a by-election.
  assert.equal(canonicalElectionTitle({ body: 'Mayor of Limerick', bodySlug: 'limerick-mayor', date: '2024-06-07', constituencies: ['Limerick City and County'] }), '2024 Limerick mayoral election');
});
