/**
 * The registry framework: the schema checker (registries/validate.mjs) and the loader
 * (registries/index.mjs). Each registry has its own registries-<name>.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgainstSchema } from '../../packages/registries/src/validate.mjs';
import { REGISTRY_NAMES, loadRegistry, registryErrors } from '../../packages/registries/src/index.mjs';

test('registries validate: types, enums, patterns, required, unknown properties', () => {
  const schema = {
    type: 'object',
    required: ['id', 'n'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', pattern: '^[a-z]+$' },
      n: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
      kind: { enum: ['a', 'b'] },
      tags: { type: 'array', uniqueItems: true, minItems: 1, items: { type: 'string', minLength: 1 } },
      ref: { $ref: '#/$defs/x' }
    },
    $defs: { x: { const: 'x' } }
  };
  assert.deepEqual(validateAgainstSchema({ id: 'ok', n: null }, schema), []);
  assert.deepEqual(validateAgainstSchema({ id: 'ok', n: 2, kind: 'a', tags: ['t'], ref: 'x' }, schema), []);
  const errors = validateAgainstSchema({ id: 'NO', n: 4, kind: 'c', tags: ['t', 't', ''], ref: 'y', extra: 1 }, schema);
  for (const want of [/\$\.id: "NO" does not match/, /\$\.n: must be <= 3/, /\$\.kind: "c" is not one of/, /duplicate item/,
    /\$\.tags\[2\]: shorter than 1/, /\$\.ref: must be "x"/, /unknown property extra/]) {
    assert.ok(errors.some((e) => want.test(e)), `${want} in ${errors.join(' | ')}`);
  }
  assert.deepEqual(validateAgainstSchema({}, schema).sort(), ['$: missing required property id', '$: missing required property n']);
  assert.match(validateAgainstSchema(1, { type: 'string' })[0], /expected string, got integer/);
});

test('registries validate: oneOf, anyOf, propertyNames, additionalProperties as a schema', () => {
  const schema = {
    type: 'object',
    propertyNames: { pattern: '^[a-z]+$' },
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'integer' }] }
  };
  assert.deepEqual(validateAgainstSchema({ a: 'x', b: 1 }, schema), []);
  assert.ok(validateAgainstSchema({ A: 'x' }, schema).some((e) => /does not match/.test(e)));
  assert.ok(validateAgainstSchema({ a: true }, schema).some((e) => /exactly one/.test(e)));
  assert.ok(validateAgainstSchema(true, { anyOf: [{ type: 'string' }, { type: 'null' }] }).some((e) => /at least one/.test(e)));
});

test('registries validate: an unsupported keyword is an error, not ignored', () => {
  assert.ok(validateAgainstSchema('x', { type: 'string', format: 'date' }).some((e) => /keyword format is not supported/.test(e)));
});

test('registries: every registry loads and is valid; unknown names are refused', () => {
  assert.ok(REGISTRY_NAMES.includes('councils'));
  for (const name of REGISTRY_NAMES) {
    const data = loadRegistry(name);
    assert.deepEqual(registryErrors(name, data), [], name);
  }
  assert.throws(() => loadRegistry('nope'), /Unknown registry nope/);
});

test('registries validate: $ref into another schema file, allOf, if/then/else', () => {
  const schemas = { 'other.schema.json': { $defs: { day: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' } }, type: 'integer' } };
  const schema = {
    type: 'object',
    properties: { d: { $ref: 'other.schema.json#/$defs/day' }, n: { $ref: 'other.schema.json' } },
    allOf: [{ required: ['d'] }],
    if: { properties: { kind: { const: 'x' } }, required: ['kind'] },
    then: { required: ['n'] },
    else: { properties: { n: { const: 0 } } }
  };
  const run = (v) => validateAgainstSchema(v, schema, schema, '$', { schemas });
  assert.deepEqual(run({ d: '2020-01-01', kind: 'x', n: 3 }), []);
  assert.ok(run({ d: '2020-1-1', kind: 'x', n: 3 }).some((e) => /\$\.d: .* does not match/.test(e)));
  assert.ok(run({ d: '2020-01-01', kind: 'x' }).some((e) => /missing required property n/.test(e)));
  assert.ok(run({ d: '2020-01-01', n: 2 }).some((e) => /\$\.n: must be 0/.test(e)));
  assert.ok(run({ kind: 'y', n: 0 }).some((e) => /missing required property d/.test(e)));
  assert.throws(() => validateAgainstSchema(1, { $ref: 'missing.schema.json' }), /Unresolvable \$ref/);
});
