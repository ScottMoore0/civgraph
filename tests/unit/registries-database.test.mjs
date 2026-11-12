/**
 * REG-6: the source and provider files of data/database/ meet their schemas
 * (packages/registries/schemas/database/) and rules (packages/registries/src/database.mjs), and
 * each rule refuses what it should.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATABASE_FILES, databaseFileErrors, databaseValueErrors } from '../../packages/registries/src/database.mjs';
import { REPO_ROOT } from '../../packages/registries/src/index.mjs';

/** @param {string} rel */
const read = (rel) => JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
/** @param {string} name @param {unknown} data */
const errorsOf = (name, data) => databaseValueErrors(name, data, { root: REPO_ROOT });

test('database files: every source and provider file meets its schema and rules', () => {
  for (const name of Object.keys(DATABASE_FILES)) {
    assert.deepEqual(databaseFileErrors(name, REPO_ROOT), [], name);
  }
  assert.equal(DATABASE_FILES['approved-publication-sources-shards'].files(REPO_ROOT).length, read('data/database/approved-publication-sources.json').shardCount);
});

test('database files: providers refuses repeats, unknown parents and undeclared jurisdictions', () => {
  const providers = read('data/database/providers.json');
  const twice = structuredClone(providers);
  twice.providers.push({ ...twice.providers[0] });
  assert.ok(errorsOf('providers', twice).some((e) => e.includes(`id ${providers.providers[0].id} is listed twice`)));
  const orphan = structuredClone(providers);
  orphan.providers[0].parent = 'no-such-body';
  assert.ok(errorsOf('providers', orphan).some((e) => e.includes('parent no-such-body is not a provider')));
  const elsewhere = structuredClone(providers);
  elsewhere.providers[0].jurisdiction = 'Mars';
  assert.ok(errorsOf('providers', elsewhere).some((e) => e.includes('jurisdiction Mars is not declared')));
  const unknownField = structuredClone(providers);
  unknownField.providers[0].website = 'https://example.org';
  assert.ok(errorsOf('providers', unknownField).length > 0, 'a field the schema does not name');
});

test('database files: an external source never carries a copy of the source text', () => {
  const external = read('data/database/external-sources.json');
  for (const field of ['fullText', 'articleText', 'rawHtml']) {
    const copy = structuredClone(external);
    copy.sources[0][field] = 'copied text';
    assert.ok(errorsOf('external-sources', copy).length > 0, field);
  }
  const noTitle = structuredClone(external);
  delete noTitle.sources[0].title;
  assert.ok(errorsOf('external-sources', noTitle).length > 0, 'title is required');
});

test('database files: a raw source keeps Source only, one item and no local path field', () => {
  const raw = read('data/database/raw-source-documents.json');
  const dPath = structuredClone(raw);
  dPath.sources[0].sourceItems[0].dPath = 'D:\\somewhere\\file.pdf';
  assert.ok(errorsOf('raw-source-documents', dPath).length > 0, 'dPath');
  const status = structuredClone(raw);
  status.sources[0].status = 'Published';
  assert.ok(errorsOf('raw-source-documents', status).length > 0, 'status');
  const chip = structuredClone(raw);
  chip.sources[0].statusChips = ['Preview available'];
  assert.ok(errorsOf('raw-source-documents', chip).some((e) => e.includes('needs the Source only status chip')));
});

test('database files: the approved-publication index matches its shards', () => {
  const index = read('data/database/approved-publication-sources.json');
  const wrongCount = structuredClone(index);
  wrongCount.shards[0].count += 1;
  assert.ok(errorsOf('approved-publication-sources', wrongCount).some((e) => e.includes('the index says')));
  const missing = structuredClone(index);
  missing.shards.pop();
  assert.ok(errorsOf('approved-publication-sources', missing).length > 0, 'a shard left out');
  const shard = read(index.shards[0].url);
  const badType = { items: [{ ...shard.items[0], type: 'approved-something-else' }] };
  assert.ok(errorsOf('approved-publication-sources-shards', badType).length > 0, 'type');
});
