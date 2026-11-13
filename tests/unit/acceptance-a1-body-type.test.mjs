/**
 * Acceptance test A1 (REFACTOR-PLAN.md section 4; the owner's "a new body type needs only config"),
 * made executable.
 *
 * A fictitious elected body, the Example Regional Assembly (tests/fixtures/a1-body-type/body.json),
 * is added ONLY as config: a copy of data/registries/election-bodies.json with the body appended,
 * and the browser slices generated from it, in a temporary folder. The site's own code, unchanged,
 * is then run over it (tests/fixtures/a1-body-type/overlay.mjs makes a process read those files
 * where it would read the committed ones), and the body flows through:
 *
 *   manifest building  scripts/build/build-test2-election-manifest.mjs over a one-election fixture
 *                      (its title, voting system, kind and map come from the body's entry)
 *   catalogue          its shelf, row label and search words (packages/map/src/catalogue/)
 *   display            the party profiles' chart, the map app's election type and history group,
 *                      the Elections app's home group
 *
 * and no code file names it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, registryErrors } from '../../packages/registries/src/index.mjs';

const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/a1-body-type');
const OVERLAY = path.join(FIXTURE, 'overlay.mjs');
const BODY = JSON.parse(readFileSync(path.join(FIXTURE, 'body.json'), 'utf8'));
const SLICES = path.join(REPO_ROOT, 'packages/registries/src/browser');

/**
 * Runs node with the overlay preloaded.
 * @param {string[]} args
 * @param {{ cwd?: string, files: Record<string, string>, modules?: Record<string, string>, env?: Record<string, string> }} options
 */
function runOverlaid(args, { cwd = REPO_ROOT, files, modules = {}, env = {} }) {
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(OVERLAY).href, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env, A1_FILES: JSON.stringify(files), A1_MODULES: JSON.stringify(modules) },
  });
  assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

test('A1: a new body type needs only config', { timeout: 120000 }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'civgraph-a1-'));
  try {
    // ---- the config: the registry with the body appended, and the slices generated from it
    const registryFile = path.join(REPO_ROOT, 'data/registries/election-bodies.json');
    const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
    registry.bodies.push(BODY);
    assert.deepEqual(registryErrors('election-bodies', registry), [], 'the fixture body is a valid registry entry');
    const fixtureRegistry = path.join(dir, 'election-bodies.json');
    writeFileSync(fixtureRegistry, `${JSON.stringify(registry, null, 1)}\n`);
    const files = { [registryFile]: fixtureRegistry };
    const slicesDir = path.join(dir, 'slices');
    mkdirSync(slicesDir);
    const written = JSON.parse(runOverlaid([path.join(FIXTURE, 'write-slices.mjs'), slicesDir], { files }));
    /** @type {Record<string, string>} */
    const modules = Object.fromEntries(written.map((/** @type {string} */ file) => {
      const name = file.replace(/\.json$/, '.data.mjs');
      return [path.join(SLICES, name), path.join(slicesDir, name)];
    }));

    // ---- manifest building: the real builder, over a one-election fixture
    const work = path.join(dir, 'work');
    cpSync(path.join(FIXTURE, 'elections-source'), path.join(work, 'data/elections-source'), { recursive: true });
    mkdirSync(path.join(work, 'render/metadata'), { recursive: true });
    writeFileSync(path.join(work, 'render/metadata/maps-test.json'), '{"layers":[]}\n');
    const out = path.join(dir, 'build');
    runOverlaid([path.join(REPO_ROOT, 'scripts/build/build-test2-election-manifest.mjs')], { cwd: work, files, env: { CIVGRAPH_BUILD_DIR: out } });
    const manifest = JSON.parse(readFileSync(path.join(out, 'elections-test2.json'), 'utf8'));
    assert.equal(manifest.elections.length, 1);
    const [election] = manifest.elections;
    assert.equal(election.key, `${BODY.id}__2031-05-01`);
    assert.equal(election.bodySlug, BODY.id);
    assert.equal(election.displayTitle, '2031 Example Regional Assembly election', 'title from the body\'s title template');
    assert.equal(election.votingSystem, BODY.votingSystem, 'voting system from the body');
    assert.equal(election.kind, 'general');
    assert.equal(election.isByElection, false, 'wholeArea: never a by-election');
    assert.equal(election.sourceMapId, 'example-areas-2030', 'drawn on the map its geography names');
    assert.equal(election.transferDataExpected, true, 'an STV election expects transfers');

    // ---- catalogue and display: the site's modules, over the fixture's slices
    const seen = JSON.parse(runOverlaid([path.join(FIXTURE, 'probe.mjs'), BODY.id], { files, modules }));
    assert.equal(seen.registered, true);
    assert.equal(seen.title, '2031 Example Regional Assembly election');
    assert.equal(seen.byElection, false);
    assert.deepEqual(seen.partyChart, { id: BODY.partyGroup.id, label: BODY.partyGroup.label, match: { bodies: [BODY.id] } }, 'a chart of its own in party profiles');
    assert.equal(seen.shelf, 'ni-devolved', 'on the shelf the config names');
    assert.ok(seen.shelfBodies.includes(BODY.id));
    assert.equal(seen.rowLabel, 'Example RA', 'its catalogue row label');
    assert.match(seen.searchWords, /example regional assembly RA fixture/, 'found by its search words');
    assert.equal(seen.electionType, 'Regional Assembly', 'the map app names its elections by its typeLabel');
    assert.equal(seen.historyGroup, 'Devolved', 'grouped with the devolved bodies in a history');
    assert.equal(seen.homeGroup, 'Parliaments, assemblies and offices', 'listed on the Elections home page');

    // ---- the control: without the config, the same code knows nothing of the body
    const unknown = JSON.parse(runOverlaid([path.join(FIXTURE, 'probe.mjs'), BODY.id], { files: {} }));
    assert.equal(unknown.registered, false);
    assert.equal(unknown.partyChart, null);
    assert.equal(unknown.shelf, '');
    assert.notEqual(unknown.rowLabel, 'Example RA');
    assert.notEqual(unknown.electionType, 'Regional Assembly');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A1: no code file names the fixture body', () => {
  /** @param {string} rel @returns {string[]} */
  const walk = (rel) => readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true }).flatMap((entry) => {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'build' ? [] : walk(child);
    return /\.(m?js|cjs|json|py)$/.test(entry.name) ? [child] : [];
  });
  const code = ['packages', 'scripts', 'functions', 'site/apps', 'site/browse', 'data/registries'].flatMap(walk);
  assert.ok(code.length > 500, `read ${code.length} files`);
  for (const file of code) assert.ok(!readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(BODY.id), `${file} names ${BODY.id}`);
});
