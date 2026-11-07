// Retired vendor files answer with the same release on a CDN (_redirects).
//
// The Leaflet 1.9.4 files and the self-hosted Fuse.js 7.0.0 and pako 2.1.0 left the tree on
// 7 Nov 2026. Their old addresses 301 to the same versions on a CDN. These tests hold that: each
// such rule names an exact version, the file it replaces is gone (so the redirect is what
// answers), and no page or runtime script in the tree still asks for it.
//
//   node --test tests/unit/retired-vendor-redirects.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CDN = /^https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm)\//;

function vendorRules() {
  return readFileSync(path.join(ROOT, '_redirects'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter(([from, to]) => from.startsWith('/assets/') && CDN.test(to || ''))
    .map(([from, to, status]) => ({ from, to, status }));
}

test('the retired Fuse.js and pako files redirect to the same releases', () => {
  const rules = new Map(vendorRules().map((rule) => [rule.from, rule]));
  assert.equal(rules.get('/assets/js/fuse-7.0.0.min.js')?.to, 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js');
  assert.equal(rules.get('/assets/js/pako-2.1.0.min.js')?.to, 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');
  assert.equal(rules.get('/assets/js/leaflet-1.9.4.js')?.to, 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
});

test('every vendor redirect is permanent, pins an exact version and replaces a file that is gone', () => {
  const rules = vendorRules();
  assert.ok(rules.length >= 5);
  for (const { from, to, status } of rules) {
    assert.equal(status, '301', from);
    assert.match(to, /@\d+\.\d+\.\d+\//, `${from} must name an exact version`);
    if (!from.includes('*')) assert.ok(!existsSync(path.join(ROOT, from)), `${from} is still in the tree, so it answers instead of the redirect`);
  }
});

test('nothing in the tree still loads a retired vendor file', () => {
  const names = vendorRules().map(({ from }) => from.replace(/\/\*$/, '/')).filter((from) => !from.endsWith('/'));
  const pattern = names.map((name) => path.posix.basename(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  let hits = '';
  try {
    hits = execFileSync('git', ['grep', '-l', '-E', pattern, '--', '*.html', '*.js', '*.mjs', '*.css', ':!tests/**', ':!scripts/**', ':!data/**', ':!render/metadata/**', ':!tasks/**'], { cwd: ROOT, encoding: 'utf8' });
  } catch (error) {
    if (error.status !== 1) throw error; // 1: no match
  }
  assert.equal(hits.trim(), '', `still referenced by:\n${hits}`);
});
