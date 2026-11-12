/**
 * The served package modules at /pkg/ (packages/served.json; owner-approved 11 Nov 2026, Elections
 * arch audit P3): a served, unbundled page imports these instead of copying package code.
 *
 * Held here:
 *   - exactly these files are served under /pkg/, each at /pkg/<its path under packages/>;
 *   - each is pure browser code: no node: built-in, no npm package, no Node-only package
 *     (storage, loader, schema, intake, api, the build half of config), no JSON;
 *   - the set is closed: every relative import of a served module is served too;
 *   - dist/ (scripts/build/site.mjs) gets exactly these under pkg/, and nothing else of packages/;
 *   - the dev servers answer the same paths, and only those;
 *   - site/pkg/ holds one re-export per module a page imports, so Node and tsc resolve the page's
 *     import to the package (and nothing else);
 *   - _headers serves them as JavaScript, revalidated, not indexed.
 *
 *   node --test tests/unit/served-pkg.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { specifiers } from '../../scripts/check/boundaries.mjs';
import { SERVED_FROM, SERVED_PKG, isSiteFile, siteFiles, sourceOf } from '../../scripts/build/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// THE LIST. Adding a module here and in packages/served.json is a decision: say why in the
// commit, and check it against the rules below (pure, closed, nothing private).
const SERVED = [
  'pkg/config/src/config.js',
  'pkg/core/src/date-format.mjs',
  'pkg/core/src/election-domain.mjs',
  'pkg/core/src/format.js',
  'pkg/core/src/html.js',
  'pkg/core/src/unopposed.mjs',
  'pkg/registries/src/browser/colour-palettes.mjs',
  'pkg/registries/src/browser/colours.data.mjs',
  'pkg/registries/src/browser/colours.mjs',
  'pkg/registries/src/browser/election-type-names.mjs',
  'pkg/registries/src/browser/election-types.data.mjs',
  'pkg/registries/src/browser/election-types.mjs',
  'pkg/registries/src/browser/party-palettes.data.mjs',
  'pkg/registries/src/browser/party-palettes.mjs',
  'pkg/registries/src/browser/statuses.data.mjs',
  'pkg/registries/src/browser/statuses.mjs',
  'pkg/ui/src/templates/components/index.js',
];

// Packages that are never served: they run in Node or in Functions only, or hold private paths.
const NEVER = /^packages\/(storage|loader|schema|intake|api|maps-pipeline|types)\/|^packages\/config\/src\/node\.mjs$|\.json$/;

test('exactly the listed modules are served under /pkg/, each at its path under packages/', () => {
  assert.deepEqual(SERVED_PKG, SERVED);
  for (const served of SERVED) {
    assert.ok(!served.endsWith('/'), `${served}: /pkg/ entries are single files, never a directory`);
    const source = SERVED_FROM[served];
    assert.equal(source, `packages/${served.slice('pkg/'.length)}`, `${served} mirrors the package layout`);
    assert.ok(existsSync(path.join(ROOT, source)), `${source} exists`);
    assert.match(served, /\.m?js$/, `${served} is a JavaScript module`);
    assert.doesNotMatch(source, NEVER, `${source} must not be served`);
  }
});

test('every served module is pure browser code, and the set is closed under its imports', () => {
  for (const served of SERVED) {
    const source = SERVED_FROM[served];
    const text = readFileSync(path.join(ROOT, source), 'utf8');
    for (const spec of specifiers(text)) {
      assert.ok(spec.startsWith('.'), `${source} imports ${spec}: a served module may import only other served modules, by relative path`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(served), spec));
      assert.ok(SERVED.includes(target), `${source} imports ${spec} (/${target}), which is not served: add it to the list or drop the import`);
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    assert.ok(!/\bprocess\.env\b|\brequire\(|\bimport\.meta\.(url|dirname|filename)\b|\bBuffer\./.test(code), `${source} uses a Node-only API`);
  }
});

test('dist/ gets exactly these under pkg/, from the packages, and nothing else of packages/', () => {
  const { files } = siteFiles(ROOT);
  assert.deepEqual(files.filter((f) => f.startsWith('pkg/')), SERVED);
  assert.deepEqual(files.filter((f) => f.startsWith('packages/')), []);
  for (const served of SERVED) assert.equal(sourceOf(served), SERVED_FROM[served]);
  // Neighbours of a served module, and look-alike paths, are not served.
  for (const rel of ['pkg/core/src/layer-index.js', 'pkg/config/src/node.mjs', 'pkg/core/src/html.json', 'pkg/core/src/', 'pkg/core/', 'pkg/storage/src/sqlite.mjs', 'pkg/api/src/v1/v1.js']) {
    assert.equal(isSiteFile(rel), false, rel);
    assert.notEqual(sourceOf(rel), SERVED_FROM[rel.replace(/\.json$/, '.js')] || 'never', rel);
  }
});

test('the dev and test servers answer the same /pkg/ paths from the packages', () => {
  // tools/dev-site/server.mjs and scripts/dev/dev-server.mjs map paths with sourceOf() (above);
  // scripts/dev/test-server.py with its own reading of served.json: a file key matches exactly.
  const py = readFileSync(path.join(ROOT, 'scripts/dev/test-server.py'), 'utf8');
  assert.match(py, /startswith\('\/' \+ served\) if served\.endswith\('\/'\) else unquote\(bare\) == '\/' \+ served/);
  for (const file of ['tools/dev-site/server.mjs', 'scripts/dev/dev-server.mjs']) {
    assert.match(readFileSync(path.join(ROOT, file), 'utf8'), /sourceOf\(/, `${file} maps served paths through sourceOf`);
  }
});

test('site/pkg/ holds a re-export of each module a page imports, and nothing else', () => {
  const shims = [];
  const walk = (dir) => {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
      else shims.push(rel);
    }
  };
  walk('site/pkg');
  assert.ok(shims.length > 0);
  for (const rel of shims) {
    const served = rel.slice('site/'.length);
    assert.ok(SERVED.includes(served), `${rel} re-exports a module that is not served`);
    const up = '../'.repeat(rel.split('/').length - 1);
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    const code = text.split('\n').filter((line) => line && !line.startsWith('//'));
    assert.deepEqual(code, [`export * from '${up}${SERVED_FROM[served]}';`], `${rel} is exactly one re-export of ${SERVED_FROM[served]}`);
    assert.doesNotMatch(readFileSync(path.join(ROOT, SERVED_FROM[served]), 'utf8'), /export default/, `${rel}: export * drops a default export`);
  }
});

test('_headers serves /pkg/ as JavaScript, revalidated and not indexed', () => {
  const headers = readFileSync(path.join(ROOT, sourceOf('_headers')), 'utf8');
  const block = headers.split(/\n(?=\S)/).find((b) => b.startsWith('/pkg/*\n'));
  assert.ok(block, 'a /pkg/* block');
  assert.match(block, /^ {2}Content-Type: text\/javascript; charset=utf-8$/m);
  assert.match(block, /^ {2}Cache-Control: no-cache, must-revalidate$/m);
  assert.match(block, /^ {2}X-Robots-Tag: noindex, nofollow$/m);
  const routes = JSON.parse(readFileSync(path.join(ROOT, sourceOf('_routes.json')), 'utf8')).include;
  assert.ok(!routes.some((r) => r.startsWith('/pkg')), '/pkg/ is static, never a Function');
});
