#!/usr/bin/env node
/**
 * `_routes.json` must cover every Pages Function, and nothing else.
 *
 * WHY THE FILE EXISTS
 *
 * Without `_routes.json`, Cloudflare Pages routes EVERY request through the Functions
 * runtime, including the ones that just want a static file. The site is overwhelmingly
 * static -- one HTML shell, a bundle, tiles and JSON -- so nearly every invocation was
 * doing nothing but handing the request back.
 *
 * WHY IT NEEDS A VALIDATOR, AND WHY THIS ONE FAILS BOTH WAYS
 *
 * Getting the include list wrong is silent and asymmetric:
 *
 *   too NARROW -> an API path stops reaching its Function and is served as a static
 *                 asset. The endpoint 404s, or worse, a SPA-style fallback answers with
 *                 HTML at HTTP 200, which every status-code check reads as healthy. This
 *                 project has already had two outages of exactly that shape.
 *   too WIDE   -> the file exists but saves nothing, which looks like it is working.
 *
 * So this derives the routes from the `functions/` tree and compares both directions. A
 * new Function with no matching include fails here rather than in production.
 *
 * Files beginning with `_` are helpers, not routes (`_auth.js`, `_error.js`,
 * `_method.js`, `_schema.js`, `_proni-shell.js`), and are excluded the way Pages excludes
 * them.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-routes-manifest.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = '_routes.json';
const FUNCTIONS = 'functions';

if (!existsSync(ROUTES)) {
  console.error(`FAIL: ${ROUTES} is missing. Without it every static request invokes a Function.`);
  process.exit(1);
}

/** Every route path the functions/ tree publishes. */
function collect(dir, prefix = '') {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Underscore DIRECTORIES are routed -- `functions/_api/elections/index.js` serves
      // /_api/elections, verified with a 200 against production. Only underscore FILES
      // are helpers in this tree. An earlier version of this validator skipped `_api`
      // and then reported the /_api/* include as unused, which would have argued for
      // deleting the entry that keeps the whole API reachable.
      routes.push(...collect(full, `${prefix}/${entry}`));
      continue;
    }
    if (!entry.endsWith('.js')) continue;
    if (entry.startsWith('_')) continue;     // helper modules are not routes
    const base = entry.replace(/\.js$/, '');
    if (base === 'index') routes.push(`${prefix}/`);
    else if (base.startsWith('[[') && base.endsWith(']]')) routes.push(`${prefix}/*`);
    else routes.push(`${prefix}/${base}`);
  }
  return routes;
}

const routes = collect(FUNCTIONS);
const manifest = JSON.parse(readFileSync(ROUTES, 'utf8'));
const include = manifest.include || [];

const covers = (pattern, route) => {
  if (pattern.endsWith('/*')) return route.startsWith(pattern.slice(0, -1));
  return pattern === route || `${pattern}/` === route;
};

const uncovered = routes.filter((route) => !include.some((pattern) => covers(pattern, route)));
const unused = include.filter((pattern) => !routes.some((route) => covers(pattern, route)));

if (uncovered.length || unused.length) {
  if (uncovered.length) {
    console.error(`FAIL: ${uncovered.length} Function route(s) are not covered by ${ROUTES}:`);
    for (const route of uncovered) console.error(`  - ${route}`);
    console.error('');
    console.error('  Those paths will be served as STATIC assets, so the endpoint disappears.');
    console.error('  Add a matching entry to "include".');
  }
  if (unused.length) {
    console.error(`FAIL: ${unused.length} include pattern(s) in ${ROUTES} match no Function:`);
    for (const pattern of unused) console.error(`  - ${pattern}`);
    console.error('  Every request under those paths pays for a Function invocation that does nothing.');
  }
  process.exit(1);
}

console.log(`PASS: ${ROUTES} covers all ${routes.length} Function route(s), with no unused patterns.`);
