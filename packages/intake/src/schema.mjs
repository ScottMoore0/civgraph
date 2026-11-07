/**
 * A small JSON Schema checker for scripts/intake/batch.schema.json.
 *
 * The repository declares no schema library, and the batch schema uses a narrow
 * subset: $ref (local #/$defs only), type, const, enum, required, properties,
 * additionalProperties: false, items, minItems, minLength, minimum, pattern and
 * oneOf. oneOf may carry a `discriminator` naming a property whose `const` picks
 * the branch, which turns "matched none of 12 branches" into the error that
 * actually helps ("operations[3]: unknown property chunk").
 *
 * Anything outside that subset is ignored rather than guessed at, so a schema
 * edit that needs a new keyword needs it added here too (tests/intake covers it).
 */

/**
 * A schema node: JSON read from batch.schema.json, using only the keywords listed above.
 * @typedef {Record<string, any>} Schema
 */

/** @param {unknown} value */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

/** @param {string} expected @param {unknown} value */
function typeMatches(expected, value) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

/** @param {Schema} root @param {string} ref @returns {Schema} */
function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Only local $ref is supported: ${ref}`);
  return ref.slice(2).split('/').reduce((/** @type {Schema} */ node, key) => {
    if (!node || !(key in node)) throw new Error(`Unresolvable $ref ${ref}`);
    return node[key];
  }, root);
}

/**
 * @param {any} value   the JSON being checked
 * @param {Schema} schema
 * @param {Schema} [root]
 * @param {string} [at]
 * @returns {string[]}
 */
export function validateAgainstSchema(value, schema, root = schema, at = '$') {
  /** @type {string[]} */
  const errors = [];
  /** @param {unknown} v @param {Schema} s @param {string} p */
  const check = (v, s, p) => errors.push(...validateAgainstSchema(v, s, root, p));

  if (schema.$ref) return validateAgainstSchema(value, resolveRef(root, schema.$ref), root, at);

  if (schema.type && !typeMatches(schema.type, value)) {
    return [`${at}: expected ${schema.type}, got ${typeOf(value)}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) {
    errors.push(`${at}: must be >= ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((item, i) => check(item, schema.items, `${at}[${i}]`));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${at}: missing required property ${key}`);
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(value)) {
        if (schema.properties[key]) check(sub, schema.properties[key], `${at}.${key}`);
        else if (schema.additionalProperties === false) errors.push(`${at}: unknown property ${key}`);
      }
    }
  }
  if (schema.oneOf) {
    const branches = schema.oneOf.map((/** @type {Schema} */ b) => (b.$ref ? resolveRef(root, b.$ref) : b));
    const disc = schema.discriminator;
    if (disc && typeOf(value) === 'object' && disc in value) {
      const branch = branches.find((/** @type {Schema} */ b) => b.properties?.[disc]?.const === value[disc]);
      if (!branch) {
        const allowed = branches.map((/** @type {Schema} */ b) => b.properties?.[disc]?.const).filter(Boolean);
        errors.push(`${at}.${disc}: ${JSON.stringify(value[disc])} is not one of ${allowed.join(', ')}`);
      } else {
        check(value, branch, at);
      }
    } else {
      const matching = branches.filter((/** @type {Schema} */ b) => validateAgainstSchema(value, b, root, at).length === 0);
      if (matching.length !== 1) errors.push(`${at}: must match exactly one schema (matched ${matching.length})`);
    }
  }
  return errors;
}
