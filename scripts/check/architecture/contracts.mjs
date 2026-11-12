/**
 * C9 (rule R5): every API answer a page reads has a v1 contract.
 *
 * Read from the served code: every string or template literal naming /_api/<route> or
 * /api/v1/<route>, with the query it spells out, and every object literal passed to an API
 * client function (config `clientCalls`, such as the Elections app's getJson({ view, key }))
 * in a file that names exactly one route. Each request must name a route of
 * packages/api/src/v1/contracts/v1.js (CONTRACTS); a `view=` it gives must be a variant's view;
 * and a parameter it gives must appear in some variant's `when`, or be a modifier the config
 * lists for every route or for that route (limit, offset...). Routes that are not the records
 * API (sign-in, contributions, the RUM beacon) are listed in the config with their reason.
 * A variant whose fields are only `object` is reported as a note, not a finding.
 */
import { isString, lineOf, nameOf, walk } from './lib.mjs';

/** @typedef {import('./lib.mjs').Context} Context @typedef {import('./lib.mjs').Finding} Finding @typedef {import('./lib.mjs').AstNode} AstNode */
/** @typedef {{ variants: Array<{ name: string, when: Record<string, string>, schema?: { properties?: Record<string, { type?: unknown, properties?: unknown, items?: { type?: unknown, properties?: unknown } }> } }> }} Contract */

const HOLE = '\u0000';
const API_URL = /\/(?:_api|api\/v1)\/([^?#\s'"`]*)(?:\?([^#\s'"`]*))?/;

/**
 * The route and parameters a URL literal spells out (HOLE marks an interpolated value).
 * @param {string} text
 * @param {readonly string[]} routes  the CONTRACTS keys
 * @returns {{ route: string | null, path: string, params: Record<string, string> | null } | null}
 */
export function parseApiUrl(text, routes) {
  const m = text.match(API_URL);
  if (!m) return null;
  const path = m[1].replace(/\/+$/, '');
  if (!path || path.startsWith(HOLE)) return null;
  const route = [...routes].sort((a, b) => b.length - a.length).find((r) => path === r || path.startsWith(`${r}/`)) ?? null;
  /** @type {Record<string, string> | null} */
  let params = {};
  if (m[2] !== undefined) {
    for (const pair of m[2].split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      if (k.includes(HOLE)) { params = null; break; }
      params[k] = v.includes(HOLE) ? '*' : decodeURIComponent(v);
    }
  }
  return { route, path, params };
}

/**
 * What is wrong with one request against its route's contract (empty when it is covered).
 * @param {Contract} contract
 * @param {Record<string, string>} params
 * @param {readonly string[]} modifiers
 */
export function requestProblems(contract, params, modifiers) {
  const problems = [];
  const whenKeys = new Set(contract.variants.flatMap((v) => Object.keys(v.when)));
  const view = params.view;
  if (view !== undefined && view !== '*' && !contract.variants.some((v) => v.when.view === view)) problems.push(`view=${view} has no v1 variant`);
  for (const key of Object.keys(params)) {
    if (key === 'view' || whenKeys.has(key) || modifiers.includes(key)) continue;
    problems.push(`parameter ${key} is in no variant's when (and not a listed modifier)`);
  }
  return problems;
}

/**
 * The variant an answer comes from, as variantFor() picks it, but holding view= to its own variant.
 * @param {Contract} contract
 * @param {Record<string, string>} params
 */
function chosenVariant(contract, params) {
  return contract.variants.find((v) => Object.entries(v.when).every(([k, want]) => {
    if (k === 'path') return true;
    const got = params[k];
    if (want === '*') return got !== undefined && got !== '';
    if (want === '') return got === undefined || got === '';
    return got === want || got === '*';
  }) && (params.view === undefined || v.when.view === params.view || params.view === '*'));
}

/** @param {Contract['variants'][number] | undefined} variant */
function looseFields(variant) {
  const props = variant?.schema?.properties || {};
  return Object.entries(props).filter(([, s]) => (s.type === 'object' && !s.properties) || (s.type === 'array' && s.items?.type === 'object' && !s.items.properties)).map(([k]) => k);
}

export const C9 = {
  id: 'C9',
  rule: 'R5',
  title: 'every API answer a page reads has a v1 contract variant',
  /** @param {Context} ctx @returns {Promise<Finding[]>} */
  async run(ctx) {
    const cfg = /** @type {{ include: string[], exclude?: string[], clientCalls: string[], ignoreRoutes: Record<string, string>, modifiers: Record<string, string[]> }} */ (ctx.config.C9);
    const contracts = /** @type {Record<string, Contract>} */ (ctx.options.contracts || (await import('../../../packages/api/src/v1/contracts/v1.js')).CONTRACTS);
    const routes = Object.keys(contracts);
    const ignored = Object.keys(cfg.ignoreRoutes || {}).filter((k) => k !== '//');
    const modifiersOf = (/** @type {string} */ route) => [...(cfg.modifiers['*'] || []), ...(cfg.modifiers[route] || [])];
    /** @type {Finding[]} */
    const out = [];
    /** @type {string[]} */
    const notes = [];
    for (const file of ctx.select(cfg)) {
      const { ast } = ctx.parse(file);
      /** @type {Array<{ line: number, text: string }>} */
      const urls = [];
      /** @type {Array<{ line: number, params: Record<string, string> }>} */
      const clientCalls = [];
      walk(ast, (n) => {
        if (isString(n) && API_URL.test(n.value)) urls.push({ line: lineOf(n), text: n.value });
        if (n.type === 'TemplateLiteral') {
          const text = /** @type {AstNode[]} */ (n.quasis).map((q) => /** @type {{ cooked: string }} */ (q.value).cooked).join(HOLE);
          if (API_URL.test(text)) urls.push({ line: lineOf(n), text });
        }
        if (n.type === 'CallExpression' && cfg.clientCalls.includes(nameOf(/** @type {AstNode} */ (n.callee)) || '')) {
          const arg = /** @type {AstNode[]} */ (n.arguments)[0];
          if (arg && arg.type === 'ObjectExpression') {
            /** @type {Record<string, string>} */
            const params = {};
            for (const p of /** @type {AstNode[]} */ (arg.properties)) {
              if (p.type !== 'Property') continue;
              const key = nameOf(/** @type {AstNode} */ (p.key));
              const value = /** @type {AstNode} */ (p.value);
              if (key) params[key] = isString(value) ? value.value : '*';
            }
            clientCalls.push({ line: lineOf(n), params });
          }
        }
      });
      /** @type {Set<string>} */
      const fileRoutes = new Set();
      const check = (/** @type {string} */ route, /** @type {Record<string, string>} */ params, /** @type {number} */ line) => {
        for (const problem of requestProblems(contracts[route], params, modifiersOf(route))) out.push({ file, line, message: `/_api/${route}: ${problem}` });
        const loose = looseFields(chosenVariant(contracts[route], params));
        if (loose.length) notes.push(`${file}:${line} /_api/${route} reads fields typed only object: ${loose.join(', ')}`);
      };
      for (const { line, text } of urls) {
        const parsed = parseApiUrl(text, routes);
        if (!parsed) continue;
        const top = parsed.path.split('/').slice(0, 2);
        if (ignored.some((r) => parsed.path === r || parsed.path.startsWith(`${r}/`))) continue;
        if (!parsed.route) {
          out.push({ file, line, message: `/_api/${top.join('/')} has no v1 contract (packages/api/src/v1/contracts/v1.js)` });
          continue;
        }
        fileRoutes.add(parsed.route);
        if (parsed.params) check(parsed.route, parsed.params, line);
      }
      if (clientCalls.length && fileRoutes.size === 1) {
        const [route] = fileRoutes;
        for (const { line, params } of clientCalls) check(route, params, line);
      }
    }
    /** @type {Finding[] & { notes?: string[] }} */
    const result = out;
    result.notes = notes;
    return result;
  },
};
