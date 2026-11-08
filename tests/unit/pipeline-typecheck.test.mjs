/**
 * The pipeline type check (tsconfig.pipeline.json, npm run check:types:pipeline) keeps
 * noImplicitAny on (the 8 Nov 2026 review, stream S3) over scripts/publish, scripts/i18n,
 * scripts/maps and scripts/dev, and those folders carry no type-check suppressions.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from '../../scripts/lib/typecheck.mjs';

const FOLDERS = ['scripts/publish', 'scripts/i18n', 'scripts/maps', 'scripts/dev'];
const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tsconfig.pipeline.json'), 'utf8'));

test('tsconfig.pipeline.json checks the pipeline folders with noImplicitAny on', () => {
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noImplicitAny, true);
  assert.equal(config.compilerOptions.strictNullChecks, true);
  for (const folder of FOLDERS) assert.ok(config.include.includes(`${folder}/**/*.mjs`), folder);
});

test('no type-check suppressions in the pipeline folders', () => {
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name) && /@ts-(nocheck|ignore|expect-error)/.test(readFileSync(p, 'utf8'))) found.push(path.relative(REPO_ROOT, p));
    }
  };
  for (const folder of FOLDERS) walk(path.join(REPO_ROOT, folder));
  assert.deepEqual(found, []);
});
