// The central config's own JSON Schema (packages/config/schemas/config.schema.json; refactor item 7,
// acceptance P7; stream w20-refactor2, 20 Nov 2026). The declarative tables of @civgraph/config, as
// JSON, validate against it, and the schema rejects the shapes it is there to stop. Nothing reads
// the schema at run time.
//
//   node --test this file (the config-schema unit test)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { API, BINDINGS, CACHE, RUNTIME_VARS, SITE } from '@civgraph/config';
import { BUILD_VARS, REPO_PATHS } from '@civgraph/config/node';
import { validateAgainstSchema } from '@civgraph/registries/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'packages', 'config', 'schemas', 'config.schema.json'), 'utf8'));

/** The config as the schema sees it: the modules' tables, through JSON (API.prefix is a function). */
const configJson = () => JSON.parse(JSON.stringify({
  site: SITE,
  api: { current: API.current, versions: API.versions, legacyPrefix: API.legacyPrefix },
  bindings: BINDINGS,
  runtimeVars: RUNTIME_VARS,
  cache: CACHE,
  buildVars: BUILD_VARS,
  repoPaths: REPO_PATHS,
}));

/** @param {(c: any) => void} change */
const errorsAfter = (change) => {
  const c = configJson();
  change(c);
  return validateAgainstSchema(c, SCHEMA);
};

test('the config validates against its schema', () => {
  assert.deepEqual(validateAgainstSchema(configJson(), SCHEMA), []);
  // every table the modules export is covered, and the JSON projection lost nothing but API.prefix
  assert.deepEqual(Object.keys(SCHEMA.properties).sort(), ['api', 'bindings', 'buildVars', 'cache', 'repoPaths', 'runtimeVars', 'site']);
  assert.deepEqual(Object.keys(API).filter((k) => typeof API[/** @type {keyof typeof API} */ (k)] === 'function'), ['prefix']);
});

test('the schema rejects what it is there to stop', () => {
  const bad = {
    'an origin with a trailing slash': (c) => { c.site.origin = 'https://civgraph.net/'; },
    'an http origin': (c) => { c.site.dataOrigin = 'http://data.civgraph.net'; },
    'an unknown binding kind': (c) => { c.bindings.MAPS_BUCKET.kind = 's3'; },
    'a binding with an unknown field': (c) => { c.bindings.ASSETS.secret = true; },
    'a binding in an unknown environment': (c) => { c.bindings.PRONI_KV.environments = ['staging']; },
    'a runtime variable both secret and flag': (c) => { c.runtimeVars.CIVGRAPH_ADMINS.flag = true; },
    'a runtime variable neither secret nor flag': (c) => { delete c.runtimeVars.CIVGRAPH_SSR_PREVIEW.flag; },
    'a runtime variable outside CIVGRAPH_*': (c) => { c.runtimeVars.SECRET_X = { secret: true, purpose: 'x' }; },
    'a secret build variable with a default (its value would be printed)': (c) => { c.buildVars.R2_SECRET_ACCESS_KEY.default = ''; },
    'a build variable with no purpose': (c) => { delete c.buildVars.WALKER_DIR.purpose; },
    'a cache policy that is not a Cache-Control value': (c) => { c.cache.records = 'max-age=300'; },
    'a missing cache policy': (c) => { delete c.cache.error; },
    'an absolute repository path': (c) => { c.repoPaths.tmp = '/tmp'; },
    'a repository path that climbs out': (c) => { c.repoPaths.tmp = '../tmp'; },
    'a repository path with backslashes': (c) => { c.repoPaths.tmp = 'site\\app'; },
    'an API version that is not vN': (c) => { c.api.current = '1'; },
  };
  for (const [what, change] of Object.entries(bad)) assert.notDeepEqual(errorsAfter(/** @type {(c: any) => void} */ (change)), [], what);
});
