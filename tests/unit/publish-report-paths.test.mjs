// The publish scripts print the files they write relative to the working folder. Three of them
// did it by cutting `${ROOT}\` off the front, a Windows separator, so on Linux (CI) they printed
// the whole path, and the s3-fake dry-run cases of r2-upload-pmtiles failed there and passed
// here (CI runs of 13-14 Nov 2026). path.relative is right on both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'scripts', 'publish');

test('no publish script strips a Windows separator to make a path relative', () => {
  const offenders = readdirSync(DIR).filter((f) => /\.m?js$/.test(f))
    .filter((f) => /\.replace\(`\$\{ROOT\}\\\\`/.test(readFileSync(path.join(DIR, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('path.relative gives the printed form on both separators', () => {
  for (const p of [path.win32, path.posix]) {
    const root = p === path.win32 ? 'C:\\work\\repo' : '/home/runner/work/repo';
    const file = p.resolve(root, 'render/metadata/cdn-upload-report.json');
    assert.equal(p.relative(root, file).replaceAll('\\', '/'), 'render/metadata/cdn-upload-report.json');
  }
});
