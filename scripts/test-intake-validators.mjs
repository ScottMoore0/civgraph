#!/usr/bin/env node
/**
 * Prove the intake validators fail when they should, without touching a tracked file.
 *
 * A validator nobody has seen fail is a validator nobody knows works. The obvious way to
 * exercise one is to break something, run it, and put the file back -- which is how I
 * destroyed my own uncommitted work twice on 2026-08-03: the injected fault and unrelated
 * real edits shared a file, and `git checkout --` took both. Discarding uncommitted
 * changes is the one git operation with no undo.
 *
 * So each case copies the inputs into a temporary directory, corrupts the copy, and points
 * the validator at it with its --path arguments. Nothing under version control is written
 * at any point, and there is no revert step to get wrong.
 *
 * Usage: node scripts/test-intake-validators.mjs
 */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const node = process.execPath;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function run(script, args) {
  const result = spawnSync(node, [resolve(ROOT, 'scripts', script), ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
}

/** A workspace holding copies of everything the validators read. */
function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'civgraph-validator-test-'));
  mkdirSync(join(dir, 'intake'), { recursive: true });
  cpSync(resolve(ROOT, 'data/intake'), join(dir, 'intake'), { recursive: true });
  for (const name of ['maps-test.json', 'maps-test-index.json']) {
    const src = resolve(ROOT, 'render/metadata', name);
    if (existsSync(src)) cpSync(src, join(dir, name));
  }
  return dir;
}

const cases = [
  {
    name: 'composite-composition: alias pointing at the wrong province archive',
    corrupt(dir) {
      const p = join(dir, 'maps-test-index.json');
      const doc = readJson(p);
      const layer = (doc.layers || []).find((l) => l.id === 'eds-roi-1941-ulster-alias-test');
      if (!layer) return false;
      layer.aliasTargetLayerId = 'eds-ulster-1986-vector-test';
      writeJson(p, doc);
      return true;
    },
    run: (dir) => run('validate-composite-composition.mjs', ['--index', join(dir, 'maps-test-index.json'), '--intake-dir', join(dir, 'intake')]),
    expect: /1941 ulster/i
  },
  {
    name: 'source-paths: layer pointing at a superseded source cache',
    corrupt(dir) {
      const p = join(dir, 'maps-test.json');
      const doc = readJson(p);
      const layer = (doc.layers || []).find((l) => typeof l.sourceFile === 'string' && l.sourceFile.startsWith('render/source-cache/vector-intake/'));
      if (!layer) return false;
      layer.sourceFile = 'render/source-cache/idb-20260609/Irish Digitised Boundaries/EDs/Wards_DEDs_Munster_1955.fgb';
      writeJson(p, doc);
      return true;
    },
    run: (dir) => run('validate-source-paths.mjs', ['--metadata', join(dir, 'maps-test.json')]),
    expect: /idb-20260609/
  },
  {
    name: 'intake-delivery: delivered file neither ingested nor deferred',
    corrupt(dir) {
      const p = join(dir, 'intake', '2026-07-26-phelim-delivery.json');
      if (!existsSync(p)) return false;
      const doc = readJson(p);
      const before = (doc.renames || []).length;
      doc.renames = (doc.renames || []).filter((r) => !/Local Authorities\/1930\.fgb$/i.test(r.delivered));
      if (doc.renames.length === before) return false;
      writeJson(p, doc);
      return true;
    },
    run: (dir) => run('validate-intake-delivery.mjs', ['--intake-dir', join(dir, 'intake'), '--metadata', join(dir, 'maps-test.json')]),
    expect: /1930\.fgb.*not ingested/i
  }
];

let failures = 0;
let skipped = 0;

for (const testCase of cases) {
  const dir = makeWorkspace();
  try {
    // The unmodified copy must pass, or a later failure proves nothing.
    const clean = testCase.run(dir);
    if (clean.code !== 0) {
      console.error(`FAIL ${testCase.name}\n     clean copy did not pass (exit ${clean.code})\n${clean.out}`);
      failures += 1;
      continue;
    }
    if (!testCase.corrupt(dir)) {
      console.log(`SKIP ${testCase.name} — fixture not present in this checkout`);
      skipped += 1;
      continue;
    }
    const broken = testCase.run(dir);
    if (broken.code === 0) {
      console.error(`FAIL ${testCase.name}\n     validator passed a corrupted input`);
      failures += 1;
    } else if (!testCase.expect.test(broken.out)) {
      console.error(`FAIL ${testCase.name}\n     failed, but the message did not match ${testCase.expect}\n${broken.out}`);
      failures += 1;
    } else {
      console.log(`ok   ${testCase.name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ran = cases.length - skipped;
console.log(`\nIntake validator tests: ${ran - failures}/${ran} passed${skipped ? `, ${skipped} skipped` : ''}.`);
if (failures) process.exit(1);
