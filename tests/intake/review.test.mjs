// The review guards taken from the intake framework spec: rights, personal data, identifiers,
// the SHA256SUMS lock, the upload approval, state records, init and status.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadBatch, validateBatch } from '@civgraph/intake/batch.mjs';
import { checkLock, scanAddressFields, writeLock } from '@civgraph/intake/review.mjs';
import { main } from '../../scripts/intake/intake.mjs';
import { makeBatch, makeRepo, tempDir, writeFile } from './helpers.mjs';

function load(overrides) {
  const repo = makeRepo();
  const { dir } = makeBatch(overrides);
  return { repo, dir, batch: loadBatch(dir, { repo }) };
}

const quiet = () => {
  const out = [];
  return { out, io: { log: (l) => out.push(l), err: (l) => out.push(l), spawn: () => ({ status: 0 }) } };
};

test('personalData is required by the schema', () => {
  const { batch } = load();
  delete batch.manifest.personalData;
  assert.match(validateBatch(batch).errors.join('\n'), /missing required property personalData/);
});

test('a source with unknown rights fails; one with neither rights nor licence warns', () => {
  const { batch } = load({ sources: [{ id: 'gazette', title: 'Gazette', rights: 'unknown' }, { id: 'other', title: 'Other' }] });
  const { errors, warnings } = validateBatch(batch);
  assert.match(errors.join('\n'), /source gazette: rights unknown/);
  assert.match(warnings.join('\n'), /source other: no rights or licence/);
});

test('personal data must say how it is handled, and preparedBy is never an email', () => {
  const { batch } = load({ personalData: { contains: true }, preparedBy: 'agent of someone@example.com' });
  const errors = validateBatch(batch).errors.join('\n');
  assert.match(errors, /personalData.handling must say how/);
  assert.match(errors, /preparedBy holds an email address/);
});

test('address-like fields fail when the batch holds personal data and warn otherwise', () => {
  const extra = (dir) => writeFile(dir, 'elections/council/1923-01-15/ward-b.json', { candidates: [{ name: 'A Candidate', agent_address: '1 Main Street' }] });
  const repo = makeRepo();
  const withPd = makeBatch({ personalData: { contains: true, handling: 'names-only' } });
  extra(withPd.dir);
  assert.match(validateBatch(loadBatch(withPd.dir, { repo })).errors.join('\n'), /ward-b.json has an address-like field "agent_address": raw addresses never go into the repository/);
  const without = makeBatch();
  extra(without.dir);
  const res = validateBatch(loadBatch(without.dir, { repo }));
  assert.equal(res.errors.length, 0, res.errors.join('\n'));
  assert.match(res.warnings.join('\n'), /if these are people's addresses/);
});

test('scanAddressFields reads CSV headers and JSON keys at any depth', () => {
  const dir = tempDir('scan');
  const csv = writeFile(dir, 'a.csv', 'name,Postcode\nx,BT1\n');
  const json = writeFile(dir, 'b.json', { a: { b: [{ street: 'x' }] } });
  const other = writeFile(dir, 'c.fgb', 'address');
  assert.deepEqual(scanAddressFields([csv, json, other]).map((h) => h.field), ['Postcode', 'street']);
});

test('the lock: validate --lock records the inputs and a later change stops every command', () => {
  const { repo, dir } = load();
  const { out, io } = quiet();
  assert.equal(main(['validate', dir, '--repo', repo, '--lock'], io), 0);
  assert.ok(existsSync(path.join(dir, 'state', 'SHA256SUMS')));
  assert.match(out.join('\n'), /Locked \d+ file\(s\)/);
  assert.equal(main(['plan', dir, '--repo', repo], quiet().io), 0);
  writeFile(dir, 'proposed/entries.json', [{ id: 'dd-1921', name: 'Changed after review' }]);
  const after = quiet();
  assert.equal(main(['plan', dir, '--repo', repo], after.io), 1);
  assert.match(after.out.join('\n'), /proposed\/entries.json changed after review/);
  assert.equal(main(['validate', dir, '--repo', repo], quiet().io), 1);
  assert.equal(main(['validate', dir, '--repo', repo, '--lock'], quiet().io), 0, 're-locking after review clears it');
});

test('checkLock reports added and removed inputs', () => {
  const { batch, dir } = load();
  writeLock(batch);
  writeFile(dir, 'elections/council/1923-01-15/ward-new.json', { area: 'New' });
  assert.match(checkLock(batch).join('\n'), /ward-new.json was added after review/);
});

test('a real upload needs the owner\'s recorded approval as well as a committed status', () => {
  const { repo, dir } = load({ status: 'committed' });
  writeFile(repo, '.env.local', 'placeholder');
  const refused = quiet();
  assert.equal(main(['upload', dir, '--repo', repo, '--yes'], refused.io), 1);
  assert.match(refused.out.join('\n'), /no approvals entry for upload/);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  manifest.approvals = [{ step: 'upload', date: '2026-11-06', note: 'Owner: go ahead with the upload.' }];
  writeFileSync(path.join(dir, 'batch.json'), JSON.stringify(manifest));
  const calls = [];
  assert.equal(main(['upload', dir, '--repo', repo, '--yes'], { log: () => {}, err: () => {}, spawn: (a) => { calls.push(a); return { status: 0 }; } }), 0);
  assert.ok(calls.length > 0);
  const state = JSON.parse(readFileSync(path.join(dir, 'state', 'upload.json'), 'utf8'));
  assert.equal(state.command, 'upload');
  assert.equal(state.exitCode, 0);
});

test('init scaffolds a draft manifest once; status reports what ran', () => {
  const parent = tempDir('init');
  const dir = path.join(parent, '2026-11-06-test-batch');
  const { out, io } = quiet();
  assert.equal(main(['init', dir, '--title', 'A test batch', '--repo', parent], io), 0);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  assert.equal(manifest.id, '2026-11-06-test-batch');
  assert.equal(manifest.status, 'draft');
  assert.deepEqual(manifest.personalData, { contains: false, handling: 'none' });
  assert.equal(main(['init', dir, '--title', 'Again'], quiet().io), 1, 'refuses to overwrite');
  assert.equal(main(['init', path.join(parent, 'other')], quiet().io), 2, 'needs --title');
  const { repo, dir: batchDir } = load();
  writeFile(repo, '.env.local', 'placeholder');
  assert.equal(main(['upload', batchDir, '--repo', repo, '--dry-run'], quiet().io), 0);
  const status = quiet();
  assert.equal(main(['status', batchDir, '--repo', repo], status.io), 0);
  assert.match(status.out.join('\n'), /test-batch: status draft/);
  assert.match(status.out.join('\n'), /ran upload-dry-run at /);
  assert.match(status.out.join('\n'), /approvals: none recorded/);
  assert.ok(out.length);
});
