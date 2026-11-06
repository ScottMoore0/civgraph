// intake validate: schema, files, unique ids, publication gate, broad prefixes, secrets.
//
//   node --test tests/intake/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SCHEMA_PATH, loadBatch, validateBatch } from '../../scripts/intake/lib/batch.mjs';
import { validateAgainstSchema } from '../../scripts/intake/lib/schema.mjs';
import { main } from '../../scripts/intake/intake.mjs';
import { makeBatch, makeRepo, writeFile } from './helpers.mjs';

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

function validate(overrides, setup) {
  const repo = makeRepo();
  const { dir } = makeBatch(overrides);
  if (setup) setup({ repo, dir });
  return validateBatch(loadBatch(dir, { repo }));
}

test('a complete batch validates', () => {
  const { errors, warnings } = validate();
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('the CLI reports PASS and exit 0 for a valid batch', () => {
  const repo = makeRepo();
  const { dir } = makeBatch();
  const lines = [];
  assert.equal(main(['validate', dir, '--repo', repo], { log: (l) => lines.push(l) }), 0);
  assert.match(lines.at(-1), /^PASS: test-batch is valid/);
});

test('schema: missing fields, wrong types, unknown properties and unknown operation types', () => {
  const { manifest } = makeBatch();
  const bad = { ...manifest, status: 'done', date: '6 Nov 2026', extra: 1 };
  delete bad.title;
  bad.operations = [...manifest.operations, { id: 'x', type: 'teleport' }, { id: 'y', type: 'r2-fgb', pairs: [{ file: 'a.fgb', key: 'a.fgb', size: 1 }] }];
  const errors = validateAgainstSchema(bad, JSON.parse(JSON.stringify(SCHEMA)));
  const text = errors.join('\n');
  assert.match(text, /missing required property title/);
  assert.match(text, /\$\.status: must be one of/);
  assert.match(text, /\$\.date: .* does not match/);
  assert.match(text, /unknown property extra/);
  assert.match(text, /\$\.operations\[11\]\.type: "teleport" is not one of/);
  assert.match(text, /operations\[12\]\.pairs\[0\]: unknown property size/);
});

test('schema: repository paths may not climb out of the tree or be absolute', () => {
  const { errors } = validate(undefined, ({ dir }) => {
    const m = JSON.parse(JSON.stringify(makeBatch().manifest));
    m.operations[0].files[0].to = '../outside.fgb';
    m.operations[0].files[1].to = 'C:/Windows/x.csv';
    writeFile(dir, 'batch.json', m);
  });
  assert.equal(errors.filter((e) => /operations\[0\]\.files\[\d\]\.to/.test(e)).length, 2);
});

test('operation and source ids must be unique, and cited sources must exist', () => {
  const { manifest } = makeBatch();
  const ops = manifest.operations.map((o) => ({ ...o }));
  ops[1].id = 'copy';
  ops[0].sources = ['gazette', 'nowhere'];
  const { errors } = validate({ operations: ops, sources: [...manifest.sources, manifest.sources[0]] });
  assert.ok(errors.includes('operation id copy is used more than once'));
  assert.ok(errors.includes('source id gazette is used more than once'));
  assert.ok(errors.includes('copy: cites unknown source nowhere'));
});

test('files must exist, and a given sha256 must match', () => {
  const { manifest } = makeBatch();
  const ops = JSON.parse(JSON.stringify(manifest.operations));
  ops[0].files[0].from = 'layers/Missing.fgb';
  ops[0].files[1].sha256 = '0'.repeat(64);
  const { errors } = validate({ operations: ops });
  assert.ok(errors.includes('copy: layers/Missing.fgb does not exist in the batch'));
  assert.ok(errors.includes('copy: layers/Lookup.csv does not match its sha256'));
  // the FGB the upload would send is now neither in the repo nor copied in
  assert.ok(errors.some((e) => /^fgb: data\/maps\/health\/New_Layer\.fgb is neither in the repository nor copied in/.test(e)));
});

test('duplicate map ids, layer ids and R2 keys are refused', () => {
  const { manifest } = makeBatch();
  const ops = JSON.parse(JSON.stringify(manifest.operations));
  ops.find((o) => o.id === 'pmtiles').ids = ['a-vector-test', 'a-vector-test'];
  ops.find((o) => o.id === 'fgb').pairs.push({ file: 'data/maps/health/existing.fgb', key: 'data/maps/health/New_Layer.fgb' });
  const { errors } = validate({ operations: ops }, ({ dir }) => {
    writeFile(dir, 'proposed/entries.json', [{ id: 'dd-1921' }, { id: 'dd-1921' }]);
  });
  assert.ok(errors.includes('catalogue: map id dd-1921 appears twice in entries'));
  assert.ok(errors.includes('pmtiles: layer id a-vector-test is listed twice'));
  assert.ok(errors.includes('R2 key data/maps/health/New_Layer.fgb is written more than once'));
});

test('listing or rewriting the whole of data/maps/ is refused', () => {
  const { manifest } = makeBatch();
  const ops = JSON.parse(JSON.stringify(manifest.operations));
  ops.find((o) => o.id === 'cc').prefixes = ['data/maps/'];
  const { errors } = validate({ operations: ops });
  assert.ok(errors.includes('cc: prefix data/maps/ is too broad; use a sub-prefix'));
});

test('R2 keys outside the publication allowlist are refused', () => {
  const { manifest } = makeBatch();
  const ops = JSON.parse(JSON.stringify(manifest.operations));
  ops.find((o) => o.id === 'fgb').pairs[0].key = 'private/New_Layer.fgb';
  const { errors } = validate({ operations: ops });
  assert.ok(errors.includes('R2 key private/New_Layer.fgb is not covered by the publication allowlist'));
});

test('secrets: credential files and key assignments in the batch folder', () => {
  const { errors } = validate(undefined, ({ dir }) => {
    writeFile(dir, '.env.local', 'R2_ACCESS_KEY_ID=x\n');
    writeFile(dir, 'notes.txt', 'R2_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz0123456789\n');
  });
  assert.ok(errors.some((e) => /secret check: .*\.env\.local: a credentials file/.test(e)));
  assert.ok(errors.some((e) => /secret check: .*notes\.txt: looks like an R2 key assignment/.test(e)));
});

test('commands: only scripts under scripts/ or the batch, never .claude/publish, no emails', () => {
  const { manifest } = makeBatch();
  const ops = [
    ...manifest.operations,
    { id: 'pub', type: 'command', phase: 'post-upload', argv: ['bash', '.claude/publish/publish.sh'] },
    { id: 'curl', type: 'command', phase: 'post-upload', argv: ['node', 'scripts/upload-fgb-r2.mjs', '--ua', 'someone@example.com'] },
    { id: 'outside', type: 'command', phase: 'post-upload', argv: ['node', 'C:/elsewhere/x.mjs'] },
    { id: 'ok', type: 'command', phase: 'post-upload', argv: ['npm', 'run', 'check:fast'] },
  ];
  const { errors } = validate({ operations: ops });
  assert.ok(errors.some((e) => e.startsWith('pub: nothing under .claude/publish/')));
  assert.ok(errors.some((e) => e.startsWith('curl: argv carries what looks like an email address')));
  assert.ok(errors.some((e) => e.startsWith('outside: node must run a script under scripts/')));
  assert.ok(!errors.some((e) => e.startsWith('ok:')));
});

test('an empty id list is refused: --ids "" must never mean every layer', () => {
  const { manifest } = makeBatch();
  const ops = JSON.parse(JSON.stringify(manifest.operations));
  delete ops.find((o) => o.id === 'pmtiles').ids;
  ops.find((o) => o.id === 'pmtiles').idsFile = 'ids.txt';
  const { errors } = validate({ operations: ops }, ({ dir }) => writeFile(dir, 'ids.txt', '\n'));
  assert.ok(errors.includes('pmtiles: no layer ids (an empty --ids would mean every layer)'));
});
