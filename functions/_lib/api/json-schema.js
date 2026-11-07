/**
 * A small JSON Schema checker for the API contracts (functions/_lib/api/contracts/).
 *
 * It covers the part of JSON Schema (2020-12) the contracts use, and no more: `type` (one or a
 * list; 'integer' is a whole number), `properties`, `required`, `additionalProperties`,
 * `items`, `enum`, `const`, `anyOf`, `minimum`, `pattern` and `minItems`. Anything else in a schema is an error, so a contract can never quietly rely on a
 * keyword this checker ignores. No dependency: it runs in a Function as well as in Node.
 *
 * A contract reuses a schema by sharing the JS object, not by `$ref`, so every contract is one
 * self-contained tree that incompatibilities() can compare.
 *
 * Properties not named in a schema are allowed unless `additionalProperties` says otherwise:
 * adding a field is a compatible change (functions/_lib/api/v1.js, THE CONTRACT).
 */

const KNOWN = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf',
  'minimum', 'pattern', 'minItems', 'title', 'description', 'examples',
]);

/** The JSON Schema type name of a value. */
export function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'number' ? 'number' : typeof value;
}

function typeMatches(type, value) {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
}

/**
 * The problems with `value` against `schema`, as `<path>: <what>` strings; [] when it conforms.
 * @param {any} schema
 * @param {unknown} value
 * @param {{ path?: string, limit?: number }} [options]
 * @returns {string[]}
 */
export function validate(schema, value, { path = '$', limit = 50 } = {}) {
  /** @type {string[]} */
  const errors = [];
  const walk = (/** @type {any} */ s, /** @type {any} */ v, /** @type {string} */ at) => {
    if (errors.length >= limit) return;
    if (s === true || s === undefined) return;
    if (s === false) { errors.push(`${at}: not allowed`); return; }
    for (const key of Object.keys(s)) if (!KNOWN.has(key)) throw new Error(`json-schema: unsupported keyword ${key} at ${at}`);
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(t, v))) {
        errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(v)}`);
        return;
      }
    }
    if (s.const !== undefined && v !== s.const) errors.push(`${at}: expected ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errors.push(`${at}: ${JSON.stringify(v)} is not one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    if (s.anyOf) {
      const fits = s.anyOf.some((/** @type {any} */ alt) => validate(alt, v, { path: at, limit: 1 }).length === 0);
      if (!fits) errors.push(`${at}: matches none of ${s.anyOf.length} alternatives`);
    }
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) errors.push(`${at}: ${v} is below ${s.minimum}`);
    if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${at}: does not match ${s.pattern}`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${at}: fewer than ${s.minItems} items`);
      if (s.items !== undefined) v.forEach((item, i) => walk(s.items, item, `${at}[${i}]`));
    } else if (v && typeof v === 'object') {
      const obj = /** @type {Record<string, unknown>} */ (v);
      for (const key of s.required || []) if (!Object.hasOwn(obj, key)) errors.push(`${at}: missing ${key}`);
      for (const [key, item] of Object.entries(obj)) {
        if (s.properties && Object.hasOwn(s.properties, key)) walk(s.properties[key], item, `${at}.${key}`);
        else if (s.additionalProperties !== undefined) walk(s.additionalProperties, item, `${at}.${key}`);
      }
    }
  };
  walk(schema, value, path);
  return errors;
}

/**
 * Whether every answer valid under `older` is still valid under `newer`'s guarantees, as far as
 * a client can tell: no required field dropped, no type widened, no enum value added to a
 * field a client switches on, no variant removed. Additions (new optional or required fields,
 * new variants) are compatible. Returns the incompatibilities; [] when compatible.
 * @param {any} older
 * @param {any} newer
 * @param {string} [at]
 * @returns {string[]}
 */
export function incompatibilities(older, newer, at = '$') {
  if (older === true || older === undefined) return [];
  if (newer === true || newer === undefined) return [`${at}: the schema no longer says anything`];
  /** @type {string[]} */
  const out = [];
  const types = (/** @type {any} */ s) => (s.type === undefined ? null : new Set(Array.isArray(s.type) ? s.type : [s.type]));
  const was = types(older);
  const now = types(newer);
  if (was && !now) out.push(`${at}: lost its type`);
  if (was && now) for (const t of now) if (!was.has(t) && !(t === 'integer' && was.has('number'))) out.push(`${at}: may now be ${t}`);
  if (older.const !== undefined && newer.const !== older.const) out.push(`${at}: const changed`);
  if (older.enum) {
    if (!newer.enum) out.push(`${at}: no longer an enum`);
    else for (const v of newer.enum) if (!older.enum.includes(v)) out.push(`${at}: new enum value ${JSON.stringify(v)}`);
  }
  for (const key of older.required || []) {
    if (!(newer.required || []).includes(key)) { out.push(`${at}.${key}: no longer required`); continue; }
    out.push(...incompatibilities(older.properties?.[key], newer.properties?.[key], `${at}.${key}`));
  }
  if (older.anyOf) {
    const alternatives = newer.anyOf || [newer];
    for (const alt of alternatives) {
      if (!older.anyOf.some((/** @type {any} */ o) => incompatibilities(o, alt).length === 0)) out.push(`${at}: an alternative no older one covers`);
    }
  }
  if (older.items !== undefined) out.push(...incompatibilities(older.items, newer.items, `${at}[]`));
  return out;
}
