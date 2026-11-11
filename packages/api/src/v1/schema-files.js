/**
 * The committed JSON Schema documents of /api/v1 (REFACTOR-PLAN.md item 5, API-2/API-3): one
 * file per route under packages/api/schemas/v1/ (`proni/node` -> proni/node.schema.json), plus
 * the OpenAPI 3.1 document openapi.json beside them, built from the route table (v1.js) and the
 * contracts (contracts/v1.js). Pure: scripts/build/api-v1-documents.mjs writes them, and
 * tests/functions/api-v1-contracts.test.mjs fails when a file differs from what this builds and
 * validates every real answer against the committed file.
 *
 * Each route file is a JSON Schema 2020-12 document: the 200 answer is `anyOf` the JSON variants
 * (each a `$defs` entry named as the variant), `$defs.error` is the JSON error answer (absent
 * when the route's errors are text), and `x-civgraph-variants` lists every variant in selection
 * order with the parameters that pick it (contracts/v1.js explains `when`). Keywords starting
 * `x-` are annotations; a validator ignores them.
 *
 * The files are not served. /api/v1/openapi.json (built at request time by openapi.js) answers
 * the same document as openapi.json here; publishing the files elsewhere is the owner's call.
 */

export const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** The repository path of a route's schema file, relative to packages/api/schemas/v1/. */
export const schemaFileName = (/** @type {string} */ route) => `${route}.schema.json`;

/**
 * One route's schema document.
 * @param {string} route
 * @param {{ legacy: string, summary: string, parameters: string[], catchAll?: boolean }} info
 * @param {import('./contracts/v1.js').Contract} contract
 * @param {string} prefix
 */
export function routeSchema(route, info, contract, prefix) {
  /** @type {Record<string, unknown>} */
  const defs = {};
  for (const v of contract.variants) {
    if (v.name === 'error') throw new Error(`${route}: a variant may not be named "error"`);
    if (v.schema) defs[v.name] = { description: v.summary, ...v.schema };
  }
  if (contract.errors) defs.error = { description: 'The JSON error answer (4xx, 5xx)', ...contract.errors };
  const json = contract.variants.filter((v) => v.schema);
  return {
    $schema: SCHEMA_DIALECT,
    $id: `urn:civgraph:api:${prefix.split('/').pop()}:${route.replace(/\//g, ':')}`,
    title: `${prefix}/${route}${info.catchAll ? '/{path}' : ''}`,
    description: `${info.summary}. The answer of ${info.legacy}, which stays as an alias.`,
    'x-civgraph-route': { legacy: info.legacy, parameters: info.parameters, ...(info.catchAll ? { subpaths: true } : {}) },
    'x-civgraph-variants': contract.variants.map((v) => ({
      name: v.name, when: v.when, summary: v.summary, ...(v.contentType ? { contentType: v.contentType } : {}),
    })),
    ...(json.length ? { anyOf: json.map((v) => ({ $ref: `#/$defs/${v.name}` })) } : { type: 'string' }),
    $defs: defs,
  };
}

/**
 * Every file of a version: { '<relative path>': document }.
 * @param {{ prefix: string, routes: Record<string, { legacy: string, summary: string, parameters: string[], catchAll?: boolean }>, contracts: Record<string, import('./contracts/v1.js').Contract>, openApi: () => unknown }} api
 * @returns {Record<string, unknown>}
 */
export function schemaFiles({ prefix, routes, contracts, openApi }) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [route, info] of Object.entries(routes)) {
    const contract = contracts[route];
    if (!contract) throw new Error(`${route}: no contract`);
    out[schemaFileName(route)] = routeSchema(route, info, contract, prefix);
  }
  out['openapi.json'] = openApi();
  return out;
}

/** A document as its file holds it: two-space JSON and a final newline. */
export const fileText = (/** @type {unknown} */ doc) => `${JSON.stringify(doc, null, 2)}\n`;
