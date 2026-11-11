// /.well-known/security.txt (RFC 9116; owner, 11 Nov 2026): the file's fields, that the Pages build
// publishes it, that _headers serves it as plain text, and that no redirect or Function takes the
// address first. When the Expires test fails, the file has expired: renew it (RFC 9116 2.5.5
// recommends less than a year ahead) rather than loosening the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSiteFile, siteFiles, sourceOf } from '../../scripts/build/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVED = '.well-known/security.txt';
const URL_PATH = `/${SERVED}`;
const read = (rel) => readFileSync(path.join(ROOT, sourceOf(rel)), 'utf8');

function fields(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^([A-Za-z][A-Za-z0-9-]*): (.+)$/.exec(line);
    assert.ok(match, `not a field line: ${JSON.stringify(line)}`);
    const name = match[1].toLowerCase();
    out.set(name, [...(out.get(name) || []), match[2]]);
  }
  return out;
}

test('security.txt has the RFC 9116 fields the owner set', () => {
  const raw = readFileSync(path.join(ROOT, sourceOf(SERVED)));
  assert.notEqual(raw[0], 0xef, 'no byte-order mark');
  const text = raw.toString('utf8');
  assert.ok(!text.includes('\r'), 'LF line endings');
  assert.ok(text.endsWith('\n'));
  const f = fields(text);
  assert.deepEqual(f.get('contact'), ['mailto:Scott@civgraph.net']);
  assert.deepEqual(f.get('preferred-languages'), ['en']);
  assert.deepEqual(f.get('canonical'), ['https://civgraph.net/.well-known/security.txt']);
  // Expires: exactly once (2.5.5), an RFC 3339 date-time.
  assert.deepEqual(f.get('expires'), ['2027-11-11T00:00:00Z']);
  assert.match(f.get('expires')[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
});

test('security.txt has not expired', () => {
  const expires = Date.parse(fields(read(SERVED)).get('expires')[0]);
  assert.ok(expires > Date.now(), `security.txt expired on ${new Date(expires).toISOString()}: renew it`);
});

test('the Pages build publishes it at /.well-known/security.txt', () => {
  assert.equal(sourceOf(SERVED), 'site/.well-known/security.txt');
  assert.equal(isSiteFile(SERVED), true);
  assert.ok(siteFiles(ROOT).files.includes(SERVED));
});

test('_headers serves it as text/plain in UTF-8', () => {
  const rules = new Map();
  let current = null;
  for (const line of read('_headers').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = line.trim(); rules.set(current, rules.get(current) || []); continue; }
    rules.get(current)?.push(line.trim());
  }
  assert.ok(rules.get(URL_PATH)?.some((h) => /^Content-Type:\s*text\/plain;\s*charset=utf-8$/i.test(h)), JSON.stringify(rules.get(URL_PATH)));
});

// Cloudflare Pages _redirects: `*` is a splat (anything), `:name` one path segment.
function redirectMatches(source, url) {
  const pattern = source.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+')).join('.*');
  return new RegExp(`^${pattern}$`).test(url);
}

test('no redirect, rewrite or Function answers /.well-known/security.txt', () => {
  const sources = read('_redirects').split('\n').map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).map((line) => line.split(/\s+/)[0]);
  assert.ok(sources.length > 100, 'read the redirects');
  assert.ok(redirectMatches('/elections/*', '/elections/x') && redirectMatches('/a/:id', '/a/b'), 'the matcher works');
  assert.deepEqual(sources.filter((source) => redirectMatches(source, URL_PATH)), []);
  const routes = JSON.parse(read('_routes.json'));
  const byFunction = (p) => routes.include.some((r) => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) : p === r || r === '/*'));
  assert.equal(byFunction(URL_PATH), false);
  assert.equal(existsSync(path.join(ROOT, 'functions', '.well-known')), false);
});
