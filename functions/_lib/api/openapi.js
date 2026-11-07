/**
 * The OpenAPI 3.1 document of a version, built from its route table (functions/_lib/api/v1.js)
 * and its contracts (functions/_lib/api/contracts/v1.js) at request time, so it cannot drift
 * from what the router serves. REFACTOR-PLAN.md item 5, slice API-3.
 *
 * Each route is one path; its variants are the 200 answer's `anyOf`, each titled with the
 * variant's name and the parameters that select it. OpenAPI 3.1 takes JSON Schema 2020-12 as
 * it is, so the contract schemas go in unchanged.
 */

/** @param {Record<string, string>} when */
function selector(when) {
  const parts = Object.entries(when).map(([k, v]) => {
    if (k === 'path') return v ? `/${v}` : '(no subpath)';
    if (v === '*') return `${k}=…`;
    if (v === '') return `no ${k}`;
    return `${k}=${v}`;
  });
  return parts.length ? parts.join(', ') : 'the default';
}

/**
 * @param {object} api
 * @param {string} api.version
 * @param {string} api.prefix
 * @param {Record<string, { legacy: string, summary: string, parameters: string[], catchAll?: boolean }>} api.routes
 * @param {Record<string, { errors: any, variants: Array<{ name: string, when: Record<string, string>, summary: string, schema?: any, contentType?: string }> }>} api.contracts
 * @param {{ name: string, origin: string }} site
 */
export function openApiDocument({ version, prefix, routes, contracts }, site) {
  /** @type {Record<string, any>} */
  const paths = {};
  for (const [key, route] of Object.entries(routes)) {
    const contract = contracts[key];
    /** @type {Array<Record<string, unknown>>} */
    const parameters = route.parameters.map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } }));
    if (route.catchAll) parameters.unshift({ name: 'path', in: 'path', required: true, schema: { type: 'string' }, description: 'segments after the route (may be empty)' });
    const json = contract.variants.filter((v) => v.schema);
    const other = contract.variants.filter((v) => v.contentType);
    /** @type {Record<string, any>} */
    const content = {};
    if (json.length) {
      content['application/json'] = {
        schema: { anyOf: json.map((v) => ({ title: `${v.name} (${selector(v.when)})`, description: v.summary, ...v.schema })) },
      };
    }
    for (const v of other) content[/** @type {string} */ (v.contentType)] = { schema: { type: 'string' }, description: v.summary };
    const errorContent = contract.errors ? { 'application/json': { schema: contract.errors } } : { 'text/plain': { schema: { type: 'string' } } };
    paths[`${prefix}/${key}${route.catchAll ? '/{path}' : ''}`] = {
      get: {
        operationId: key.replace(/[^a-z0-9]+(.)/gi, (_, c) => c.toUpperCase()),
        summary: route.summary,
        description: `The answer of ${route.legacy}, which stays as an alias. Variants: ${contract.variants.map((v) => `${v.name} (${selector(v.when)})`).join('; ')}.`,
        parameters,
        responses: {
          200: { description: 'OK', content },
          301: { description: 'A renamed record: Location gives its current address under this version' },
          304: { description: 'Not modified (If-None-Match matched the ETag)' },
          '4XX': { description: 'A bad or unknown request', content: errorContent },
          '5XX': { description: 'The data store is unavailable or failed', content: errorContent },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${site.name} API`,
      version,
      description: 'Read-only. Routes, parameters and answer shapes change only compatibly (additions) within a version; an incompatible change is a new version, and this one keeps answering. Fields not named in a schema may appear; ignore the ones you do not know.',
    },
    servers: [{ url: site.origin }],
    paths,
  };
}
