// scripts/build/site.mjs: dist/, the Pages output, holds the site's files and nothing else
// (data phase 4). Every local file a page, the service worker or llms.txt names must be in it
// or be answered by a Function; repository files, tooling and the record trees must not be.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FILES, isSiteFile, siteFiles } from '../../scripts/build/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const routes = JSON.parse(read('_routes.json')).include;
const byFunction = (p) => routes.some((r) => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) : p === r));

test('the allow-list publishes the site and leaves out the repository', () => {
  for (const rel of ['index.html', '404.html', '_routes.json', '_headers', '_redirects', 'sw.js', 'robots.txt',
    'sitemap.xml', 'sitemaps/pages.xml', 'llms.txt', 'agent/guide.md', 'app/build/app.bundle.js', 'build/main.css',
    'app/src/overlay-worker.js', 'assets/ui/tokens.css', 'assets/thumbnails/manifest.json', 'browse/browse.js',
    'render/sw.js', 'render/metadata/feature-indexes/x.json', 'render/metadata/ni-local/1973.json',
    'data/database/spatial-index.json', 'data/timeline-changes/x.json', 'data/census/explorer-bundle.json', 'test2/sw.js']) {
    assert.equal(isSiteFile(rel), true, rel);
  }
  for (const rel of ['package.json', 'package-lock.json', 'wrangler.toml', 'README.md', 'CLAUDE.md', '.gitignore',
    'functions/_api/_records.js', 'tools/dev-site/server.mjs', 'migrations/0001_records.sql', 'scripts/build/site.mjs',
    'tests/unit/site-build.test.mjs', 'docs/x.md', 'partials/browse-shell.html', 'tmp/records/x.json',
    'data/browse/index.json', 'data/graph/manifest.json', 'data/elections/persons/x.json',
    'data/elections-source/data/elections/x.json', 'data/database/maps.json', 'data/database/r2-publication-allowlist.json',
    'data/census/other.csv', 'render/metadata/elections-test2/x.json', 'render/metadata/layer-details-test2/x.json',
    'render/tiles/generated/x.pbf', 'agent/maps-index.json', 'node_modules/x/index.js', 'dist/index.html',
    'data/registries/councils.json', 'data/registries/statuses.json']) {
    assert.equal(isSiteFile(rel), false, rel);
  }
});

test('the tracked site fits the 18,500-file guardrail and has no file over 25 MiB', () => {
  const { files, oversized } = siteFiles(ROOT);
  assert.ok(files.length > 1000 && files.length <= MAX_FILES, `${files.length} files`);
  assert.deepEqual(oversized, []);
  assert.ok(files.includes('index.html') && files.includes('_routes.json'));
});

test('every local file the pages, the service worker and llms.txt name is published or a Function route', () => {
  const pages = ['index.html', '404.html', 'offline.html', 'maps/index.html', 'browse/index.html', 'catalogue/index.html',
    'records/index.html', 'apps/proni-search/index.html'].filter((f) => existsSync(path.join(ROOT, f)));
  const refs = new Set();
  for (const page of pages) {
    for (const m of read(page).matchAll(/(?:src|href)="(\/[^"?#]+\.[a-z0-9]+)(?:[?#][^"]*)?"/gi)) refs.add(m[1]);
  }
  for (const m of read('sw.js').matchAll(/'(\/[^'?#]*\.(?:html|js|css|json))'/g)) refs.add(m[1]);
  for (const m of read('llms.txt').matchAll(/https:\/\/civgraph\.net(\/[^\s)"'>]+\.[a-z0-9]+)/gi)) refs.add(m[1]);
  assert.ok(refs.size > 20, `${refs.size} references`);
  const missing = [...refs].filter((url) => !byFunction(url) && !isSiteFile(decodeURIComponent(url.slice(1))));
  assert.deepEqual(missing, []);
});
