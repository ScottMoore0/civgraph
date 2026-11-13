/**
 * The source-kinds registry (data/registries/source-kinds.json) against the literal it replaced
 * (Browse's CITATION_KIND_LABELS in site/browse/browse.js), the "directory" kind the Belfast and
 * Ulster Directory fills carry, and the provenance build's refusal of an unregistered kind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';
import { browserSourceKinds, sourceKindIds, unregisteredSourceKinds } from '../../packages/registries/src/source-kinds.mjs';
import { sourceKindLabels } from '../../site/pkg/registries/src/browser/source-kind-labels.mjs';

const registry = loadRegistry('source-kinds');

// Browse's labels as they were written before the registry (browse.js, 12 Nov 2026).
const BEFORE = {
  news: 'newspaper', newspaper: 'newspaper', official: 'official return or notice', academic: 'academic compilation',
  book: 'book', 'book-or-print': 'book', 'results-compilation': 'results compilation', web: 'website', other: '',
};

// The contests filed from the Belfast and Ulster Directory (wave 11, 12 Nov 2026).
const DIRECTORY_FILES = [
  'aughnacloy-town-commissioners/1949-05-18/aughnacloy.json',
  'ballymoney-urban-district-council/1949-05-18/ballymoney.json',
  'belfast-rural-district-council/1949-06-02/ballyduff.json',
  'belfast-rural-district-council/1949-06-02/ballygolan.json',
  'belfast-rural-district-council/1949-06-02/ballygomartin.json',
  'belfast-rural-district-council/1949-06-02/carnmoney.json',
  'belfast-rural-district-council/1949-06-02/jordanstown.json',
  'belfast-rural-district-council/1949-06-02/monkstown.json',
  'belfast-rural-district-council/1949-06-02/whiteabbey.json',
  'belfast-rural-district-council/1949-06-02/whitehouse.json',
  'donaghadee-urban-district-council/1949-05-18/north-ward.json',
  'gilford-town-commissioners/1949-05-18/gilford.json',
  'holywood-urban-district-council/1949-05-18/holywood.json',
  'holywood-urban-district-council/1961-05-17/holywood.json',
  'kilkeel-urban-district-council/1961-05-17/kilkeel.json',
];

test('source kinds: every label Browse showed is unchanged, and a directory shows as one', () => {
  const labels = browserSourceKinds(registry).labels;
  for (const [kind, label] of Object.entries(BEFORE)) assert.equal(labels[kind], label, kind);
  assert.equal(labels.directory, 'directory');
  // The one kind the literal lacked still shows no kind, as before.
  assert.equal(labels['official-count-sheets'], '');
  assert.deepEqual(Object.keys(labels).sort(), [...Object.keys(BEFORE), 'directory', 'official-count-sheets'].sort());
  // Browse reads the generated slice, which matches the registry.
  assert.deepEqual({ ...sourceKindLabels }, labels);
  const browse = readFileSync(path.join(REPO_ROOT, 'site/browse/browse.js'), 'utf8');
  assert.ok(browse.includes('const CITATION_KIND_LABELS = sourceKindLabels;'));
});

test('source kinds: the Belfast and Ulster Directory contests are cited as a directory', () => {
  const ids = new Set(sourceKindIds(registry));
  for (const file of DIRECTORY_FILES) {
    const doc = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/elections-source/data/elections', file), 'utf8'));
    assert.equal(doc.source.kind, 'directory', file);
    assert.match(doc.source.title, /^Belfast and Ulster Directory \d{4}, pp?\. \d+/, file);
    assert.ok(ids.has(doc.source.kind));
  }
});

test('source kinds: unregistered kinds are listed with their counts; null kinds are not kinds', () => {
  const citations = [{ kind: 'news' }, { kind: null }, {}, { kind: 'gazeteer' }, { kind: 'directory' }, { kind: 'gazeteer' }, { kind: 'almanac' }];
  assert.deepEqual(unregisteredSourceKinds(registry, citations), [['almanac', 1], ['gazeteer', 2]]);
  assert.deepEqual(unregisteredSourceKinds(registry, [{ kind: 'directory' }]), []);
});

test('source kinds: the registry refuses a kind given twice, and the schema a kind without a label', () => {
  const twice = structuredClone(registry);
  twice.kinds.push({ ...twice.kinds[0] });
  assert.ok(registryErrors('source-kinds', twice).some((e) => e.includes('id news is given twice')));
  const unlabelled = structuredClone(registry);
  delete (/** @type {Record<string, unknown>} */ (unlabelled.kinds[0])).label;
  assert.ok(registryErrors('source-kinds', unlabelled).length > 0);
  assert.deepEqual(registryErrors('source-kinds', registry), []);
});
