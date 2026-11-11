// The election-bodies registry (data/registries/election-bodies.json) and its views
// (packages/registries/src/election-bodies.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, registryErrors, REPO_ROOT } from '../../packages/registries/src/index.mjs';
import { checkElectionBodies, electionBody, fillYear, geographyRuleFor } from '../../packages/registries/src/election-bodies.mjs';

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
  const errors = checkElectionBodies({ schemaVersion: 1, description: 'd', bodies: [body, { ...body, geography: undefined }] });
  assert.equal(errors.length, 2);
  assert.equal(electionBody(registry, 'limerick-mayor')?.typeLabel, 'Mayoral');
  assert.equal(electionBody(registry, 'no-such-body'), null);
});
