// An allowlist prefix marked "unlisted": true (data/database/r2-publication-allowlist.json) may be
// uploaded to but is kept out of the public data index (/_api/data-index): the generator of
// packages/api/src/handlers/_public-prefixes.js leaves it out, so the index neither lists its files
// nor names it. Added 11 Nov 2026 for the Elections app's R2 files, uploaded with the owner's
// approval while the app itself is not public.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PREFIXES, isListablePrefix, isPublicPrefix } from '../../packages/api/src/handlers/_public-prefixes.js';
import { isPublishable, listedPrefixes, loadAllowlist } from '../../scripts/lib/r2-publication-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('listedPrefixes leaves out unlisted entries and keeps the rest, sorted', () => {
  const allowlist = {
    prefixes: [
      { prefix: 'data/maps/' },
      { prefix: 'data/elections-app/', unlisted: true },
      { prefix: 'assets/thumbnails/', unlisted: false },
      { prefix: '' },
    ],
  };
  assert.deepEqual(listedPrefixes(allowlist), ['assets/thumbnails/', 'data/maps/']);
  // Unlisted is about the index only: the upload gate still approves the prefix.
  assert.equal(isPublishable('data/elections-app/v1/extracts/index.json', allowlist), true);
});

test('the committed allowlist: data/elections-app/ is approved for upload but not in the public index', () => {
  const allowlist = loadAllowlist(path.join(ROOT, 'data/database/r2-publication-allowlist.json'));
  assert.equal(isPublishable('data/elections-app/v1/extracts/index.json', allowlist), true);
  assert.ok(!PUBLIC_PREFIXES.includes('data/elections-app/'));
  assert.equal(isPublicPrefix('data/elections-app/v1/extracts/index.json'), false);
  assert.equal(isListablePrefix('data/elections-app/'), false);
  assert.equal(isListablePrefix('data/elections-app/v1/'), false);
  // Every other allowlist prefix is in the index, as before.
  const listed = allowlist.prefixes.filter((e) => e.unlisted !== true).map((e) => e.prefix).sort();
  assert.deepEqual([...PUBLIC_PREFIXES].sort(), listed);
});

test('the compiled public prefixes are current with the allowlist', () => {
  const out = execFileSync(process.execPath, ['scripts/build/public-prefixes.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /PASS/);
});
