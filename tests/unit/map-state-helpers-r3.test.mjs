// Round 3 of the map app's light state (state-machine catalogue MA-L): the DOM `hidden` toggles
// go through setHidden in packages/map/src/state-helpers.mjs, and present() keeps a null that used to
// throw throwing at the same statement (the strictNullChecks fixes in the trend chart).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { present, setHidden } from '../../packages/map/src/state-helpers.mjs';

test('setHidden sets the hidden property from a boolean and returns it', () => {
  const node = { hidden: false };
  assert.equal(setHidden(node, true), true);
  assert.equal(node.hidden, true);
  assert.equal(setHidden(node, true), true, 'setting the value it has is allowed');
  assert.equal(setHidden(node, false), false);
  assert.equal(node.hidden, false);
});

test('setHidden refuses a value that is not a boolean, and a missing node throws as the assignment did', () => {
  const node = { hidden: false };
  for (const value of [1, 0, '', 'true', null, undefined, {}]) {
    assert.throws(() => setHidden(node, /** @type {any} */ (value)), TypeError);
  }
  assert.equal(node.hidden, false, 'a refused value leaves the node as it was');
  assert.throws(() => setHidden(/** @type {any} */ (null), true), TypeError);
});

test('present returns the value, or throws a TypeError for null and undefined', () => {
  const svg = { id: 'chart' };
  assert.equal(present(svg, 'the chart'), svg);
  assert.equal(present(0, 'zero'), 0, 'only null and undefined are missing');
  assert.equal(present('', 'empty'), '');
  assert.throws(() => present(null, 'the trend chart'), { name: 'TypeError', message: 'the trend chart is null' });
  assert.throws(() => present(undefined, 'the crosshair'), { name: 'TypeError', message: 'the crosshair is undefined' });
});

/** Every .js and .mjs file under a folder. */
function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.m?js$/.test(name) ? [file] : [];
  });
}

test('src/ and packages/map toggle hidden only through setHidden', () => {
  const helper = path.join('packages', 'map', 'src', 'state-helpers.mjs');
  const offenders = [];
  for (const file of [...sources('src'), ...sources(path.join('packages', 'map', 'src')), ...sources(path.join('packages', 'map', 'app'))]) {
    if (file === helper || file.includes(`${path.sep}libs${path.sep}`)) continue;
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      if (/(?<!dataset)\.hidden\s*=(?!=)/.test(line) || /(set|remove|toggle)Attribute\(\s*['"]hidden['"]/.test(line)) {
        offenders.push(`${file}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});
