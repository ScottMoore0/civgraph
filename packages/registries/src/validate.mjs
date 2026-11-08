/**
 * A small JSON Schema checker for the registries (registries/schemas/*.schema.json).
 *
 * The repository declares no schema library. This covers the subset the registry schemas use:
 * $ref (local "#/$defs/...", or "<name>.schema.json[#/...]" when `schemas` names that file),
 * type (a name or a list of names), const, enum, required, properties, additionalProperties
 * (false or a schema), propertyNames, items, minItems, uniqueItems, minLength, pattern, minimum,
 * maximum, oneOf, anyOf, allOf and if/then/else. A keyword outside the
 * subset is reported as an error, not ignored, so a schema cannot ask for a rule that silently
 * does not run (tests/unit/registries.test.mjs covers it).
 *
 * Pure: no I/O, so the same checker runs in Node, a Worker or a browser.
 */

/**
 * A schema node: JSON read from a *.schema.json file, in the subset above. Any other keyword is
 * reported (KNOWN), so the index signature keeps one readable.
 * @typedef {{
 *   [keyword: string]: unknown,
 *   $ref?: string,
 *   $defs?: { [name: string]: Schema },
 *   type?: string | string[],
 *   const?: unknown,
 *   enum?: unknown[],
 *   required?: string[],
 *   properties?: { [name: string]: Schema },
 *   additionalProperties?: boolean | Schema,
 *   propertyNames?: Schema,
 *   items?: Schema,
 *   minItems?: number,
 *   uniqueItems?: boolean,
 *   minLength?: number,
 *   pattern?: string,
 *   minimum?: number,
 *   maximum?: number,
 *   oneOf?: Schema[],
 *   anyOf?: Schema[],
 *   allOf?: Schema[],
 *   if?: Schema,
 *   then?: Schema,
 *   else?: Schema
 * }} Schema
 */

const KNOWN = new Set([
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description', 'examples', 'default',
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'propertyNames',
  'items', 'minItems', 'uniqueItems', 'minLength', 'pattern', 'minimum', 'maximum', 'oneOf', 'anyOf',
  'allOf', 'if', 'then', 'else'
]);

/**
 * The JSON Schema type name of a value ('integer' for whole numbers).
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/**
 * @param {string | string[]} expected
 * @param {unknown} value
 * @returns {boolean}
 */
function typeMatches(expected, value) {
  const actual = typeOf(value);
  return /** @type {string[]} */ ([]).concat(expected).some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

/**
 * [the schema a $ref names, the root its own $refs resolve against].
 * @param {Schema} root
 * @param {string} ref
 * @param {Record<string, Schema> | undefined} schemas
 * @returns {[Schema, Schema]}
 */
function resolveRef(root, ref, schemas) {
  const [file, fragment = ''] = ref.split('#');
  /** @type {Schema | undefined} */
  let base = root;
  if (file) {
    base = schemas?.[file];
    if (!base) throw new Error(`Unresolvable $ref ${ref}: pass the file in options.schemas`);
  }
  if (fragment && !fragment.startsWith('/')) throw new Error(`Only JSON-pointer fragments are supported: ${ref}`);
  const node = fragment.slice(1).split('/').filter(Boolean).reduce((/** @type {Schema} */ n, key) => {
    if (!n || !(key in n)) throw new Error(`Unresolvable $ref ${ref}`);
    return /** @type {Schema} */ (n[key]);
  }, base);
  return [node, base];
}

/** @type {Map<string, RegExp>} */
const patternCache = new Map();
/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function regex(pattern) {
  if (!patternCache.has(pattern)) patternCache.set(pattern, new RegExp(pattern, 'u'));
  return /** @type {RegExp} */ (patternCache.get(pattern));
}

/**
 * Errors of `value` against `schema`, as "path: message" strings; empty when it conforms.
 * @param {unknown} value
 * @param {Schema} schema
 * @param {Schema} [root] the schema $ref resolves against (defaults to `schema`)
 * @param {string} [at] the path printed in messages
 * @param {{ schemas?: Record<string, Schema> }} [options] other schema files, by the name a $ref uses
 * @returns {string[]}
 */
export function validateAgainstSchema(value, schema, root = schema, at = '$', options = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {(v: unknown, s: Schema, p: string) => number} */
  const check = (v, s, p) => errors.push(...validateAgainstSchema(v, s, root, p, options));
  /** @type {(v: unknown, s: Schema) => boolean} */
  const passes = (v, s) => validateAgainstSchema(v, s, root, at, options).length === 0;
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) errors.push(`${at}: schema keyword ${key} is not supported by registries/validate.mjs`);
  }
  if (schema.$ref) {
    const [target, base] = resolveRef(root, schema.$ref, options.schemas);
    return [...errors, ...validateAgainstSchema(value, target, base, at, options)];
  }

  if (schema.type && !typeMatches(schema.type, value)) {
    return [...errors, `${at}: expected ${/** @type {string[]} */ ([]).concat(schema.type).join(' or ')}, got ${typeOf(value)}`];
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.pattern && !regex(schema.pattern).test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems) {
      /** @type {Set<string>} */
      const seen = new Set();
      value.forEach((item, i) => {
        const k = JSON.stringify(item);
        if (seen.has(k)) errors.push(`${at}[${i}]: duplicate item ${k}`);
        seen.add(k);
      });
    }
    if (schema.items) value.forEach((item, i) => check(item, /** @type {Schema} */ (schema.items), `${at}[${i}]`));
  }
  if (typeOf(value) === 'object') {
    const object = /** @type {Record<string, unknown>} */ (value);
    for (const key of schema.required || []) {
      if (!(key in object)) errors.push(`${at}: missing required property ${key}`);
    }
    for (const [key, sub] of Object.entries(object)) {
      if (schema.propertyNames) check(key, schema.propertyNames, `${at}{${key}}`);
      if (schema.properties && key in schema.properties) check(sub, schema.properties[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown property ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(sub, schema.additionalProperties, `${at}.${key}`);
    }
  }
  for (const sub of schema.allOf || []) check(value, sub, at);
  if (schema.if) {
    if (passes(value, schema.if)) { if (schema.then) check(value, schema.then, at); } else if (schema.else) check(value, schema.else, at);
  }
  for (const kw of /** @type {const} */ (['oneOf', 'anyOf'])) {
    const branches = schema[kw];
    if (!branches) continue;
    const matching = branches.filter((b) => passes(value, b)).length;
    if (kw === 'oneOf' && matching !== 1) errors.push(`${at}: must match exactly one schema of oneOf (matched ${matching})`);
    if (kw === 'anyOf' && matching === 0) errors.push(`${at}: must match at least one schema of anyOf`);
  }
  return errors;
}
