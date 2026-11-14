#!/usr/bin/env node
/**
 * Rebuild and check what changed since the last publish: the one pre-publish command
 * (npm run rebuild). It replaces the explicit chain the coordinator used to run by hand.
 *
 * What changed: every file that differs from the base, plus uncommitted and untracked files. The
 * base is the commit of the last publish that loaded D1 (.claude/publish/work/records-base.json,
 * checked against the last-loaded snapshot; else origin/main when that snapshot was built at it;
 * else origin/main), so a clean tree after commits still rebuilds what those commits need. Build
 * outputs (GENERATED) say nothing about what to rebuild and are left out. Each file then has a
 * class (packages/loader/src/publish-inputs.mjs) and the plan follows the strongest:
 *
 *   data   a file that feeds the records build, D1 or R2: the whole chain below, each step after
 *          the ones it reads. Election source changes re-stamp person ids first, ALWAYS with
 *          MANIFEST_ARGS=--withhold-unmappable (without it the re-stamp re-mints ids: 13 Nov 2026).
 *   app    only map-app and check code: the app bundle and shell, the app-facing checks.
 *   code   only other code (site pages, Functions, docs, tests): npm run build and the checks.
 *
 * The data chain, in dependency order (each step's `after` says what it reads):
 *   persons:rebuild (election data changed and not already re-stamped from these files),
 *   timeline changes, the NI council rounds, records:build (skipped when tmp/records was built from
 *   exactly these inputs), the graph-id and person-address ledgers, the catalogue and its check,
 *   npm run build, records:build again (only when the steps before changed its inputs: the ledgers,
 *   the catalogue and the maps index feed it), the local artefacts (sitemaps, Browse cache tokens,
 *   site figures, status, licence page) and the figures stamped into the home and About pages, the
 *   Elections app's extracts, then records:check, check:fast (test:unit included), the catalogue
 *   tests and the browser tests. At the end it says whether the publish will reuse the build.
 *
 * The votes: records:build reads CIVGRAPH_VOTES_DIR. When it is unset, the directory the publish
 * wrapper (.claude/publish/publish.sh) exports is used, so the build matches the publish's and the
 * publish can reuse it.
 *
 *   node scripts/build/rebuild-changed.mjs              changes since the last publish (see above)
 *   node scripts/build/rebuild-changed.mjs --since REF  changes since a commit (HEAD: uncommitted only)
 *   node scripts/build/rebuild-changed.mjs --full       the data chain whatever changed, every gate open
 *   node scripts/build/rebuild-changed.mjs --plan       print the plan and stop
 *   node scripts/build/rebuild-changed.mjs --no-browser skip the Playwright tests
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordPaths, REPO_ROOT } from '../../packages/config/src/node.mjs';
import { publishInputClass, staleReasons, workingTreeFiles } from '../../packages/loader/src/publish-inputs.mjs';
import { resolveBase } from '../publish/publish-path.mjs';

// Outputs the builds themselves write: a change here says nothing about what to rebuild.
export const GENERATED = [
  /^site\/app\/build\//, /^site\/(maps\/(classic\/)?)?index\.html$/,
  /^site\/agent\//, /^data\/catalogue\/(catalogue|places|people)\.json$/, /^data\/browse\//, /^data\/graph\//,
  /^data\/database\/(corpus-index|election-provenance|site-stats|status)\.json$/, /^data\/database\/election-provenance-parts\//,
  /^data\/database\/[a-z-]+-d1-import\.sql$/, /^data\/database\/elections-schema\.sql$/,
  /^data\/elections\/published-graph-ids\.json$/, /^data\/elections\/persons\/published-person-addresses\.json$/,
  /^data\/timeline-changes\//,
  /^functions\/_api\/_public-prefixes\.js$/, /^render\/metadata\/(elections-test2|election-provenance|ni-local)/,
  /^site\/pages\/(about|status|licence)\.html$/,
  /^site\/app\/election-viewer-package\/(css|js)\//, /^site\/app\/js\//, /^site\/sitemap\.xml$/, /^site\/sitemaps\//
];
export const APP = [
  /^packages\/map\/app\//, /^packages\/map\/src\//, /^render\/src\//, /^site\/sw\.js$/,
  /^site\/assets\/(css|site|js)\//, /^tests\//, /^scripts\/check\/run\.mjs$/, /^scripts\/build\/rebuild-changed\.mjs$/,
  // The check machinery itself (CHECKS.md): CI, the clean-export harness, the test server.
  /^\.github\/workflows\//, /^CHECKS\.md$/, /^scripts\/check\/(rules\/ci-workflow|clean)\.mjs$/, /^scripts\/dev\/test-server\.py$/
];
// Election source and the person registry: a change re-stamps person ids. data/elections/ni-local/
// is the grouped-years snapshot (calendar, boundary features), and the two ledgers are outputs.
export const ELECTION_DATA = [
  /^data\/elections-source\//,
  /^data\/elections\/(?!ni-local\/|published-graph-ids\.json$|persons\/published-person-addresses\.json$)/,
  /^scripts\/ingest\/persons\//,
];
// The coordinator's review folders, untracked in the main checkout.
const IGNORED = /^(review-for-phelim|review-ni-council-xref)\//;

/** The person-id step's own argument, always passed (see the header). */
export const WITHHOLD = '--withhold-unmappable';

/**
 * MANIFEST_ARGS with --withhold-unmappable in it, whatever the caller's environment held.
 * @param {string | undefined} current
 */
export function manifestArgsWithWithhold(current) {
  const parts = String(current || '').split(/\s+/).filter(Boolean);
  return [...new Set([...parts, WITHHOLD])].join(' ');
}

/**
 * The votes directory the publish wrapper exports (export CIVGRAPH_VOTES_DIR='...'), or ''.
 * @param {string} wrapperText
 */
export function votesDirFromWrapper(wrapperText) {
  const m = /^\s*export\s+CIVGRAPH_VOTES_DIR=(?:'([^']*)'|"([^"]*)"|(\S+))/m.exec(wrapperText);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

/** @typedef {'none' | 'app' | 'code' | 'data'} RebuildMode */
/** @typedef {{ path: string, tracked: boolean }} ChangedFile */
/**
 * @typedef {{ id: string, cmd: string, args: string[], after: string, env?: Record<string, string>,
 *   gate?: 'records-stale' | 'persons-stale' }} Step
 *   after: what the step reads (why it is where it is); gate: a run-time skip when already current
 */

/**
 * What the changes ask for.
 * @param {ChangedFile[]} changed
 * @param {{ full?: boolean }} [options]
 * @returns {{ meaningful: string[], mode: RebuildMode, persons: boolean }}
 */
export function classifyChanges(changed, { full = false } = {}) {
  const meaningful = changed
    .filter((f) => !IGNORED.test(f.path))
    .filter((f) => publishInputClass(f.path, { tracked: f.tracked }) !== 'outside')
    .map((f) => f.path)
    .filter((file) => !GENERATED.some((re) => re.test(file)));
  const records = meaningful.some((file) => publishInputClass(file) === 'records');
  const persons = full || meaningful.some((file) => ELECTION_DATA.some((re) => re.test(file)));
  /** @type {RebuildMode} */
  const mode = full || records ? 'data' : meaningful.length === 0 ? 'none' : meaningful.every((file) => APP.some((re) => re.test(file))) ? 'app' : 'code';
  return { meaningful, mode, persons };
}

const BROWSER_TESTS = [
  'tests/browser/timeline-and-url-state.spec.cjs', 'tests/browser/app.spec.cjs', 'tests/browser/timeline-changes.spec.cjs',
  '-g', 'boundary changes on the timeline|runtime exposes|round-trips|clamps out-of-range|rapid timeline|FPTP Results|main DOM contract|candidate and count panes|Cork North-Central|Galway East|local-government aggregates|restores and persists|twist does not rotate|seat-circle overlays',
  '--timeout=180000'
];
const APP_CHECKS = 'check:root,check:asset-refs,check:app-shell-cache,check:pages-assets,check:site-partials,check:site-nav,check:test2,check:ci-workflow,check:doc-paths,check:doc-status,lint';

/**
 * The steps for a mode, in order. Pure.
 * @param {{ mode: RebuildMode, persons: boolean, meaningful: string[], noBrowser?: boolean, votesDir?: string, manifestArgs?: string }} input
 * @returns {Step[]}
 */
export function planRebuild({ mode, persons, meaningful, noBrowser = false, votesDir = '', manifestArgs = '' }) {
  /** @type {Step[]} */
  const plan = [];
  const add = (/** @type {Step} */ step) => { plan.push(step); };
  const catalogueCode = meaningful.some((file) => file.startsWith('packages/map/src/'));
  if (mode === 'app') {
    add({ id: 'shell', cmd: 'node', args: ['scripts/build/shell-assets.mjs'], after: 'the app shell sources' });
    add({ id: 'bundle', cmd: 'node', args: ['scripts/build/app-bundle.mjs'], after: 'the map app sources' });
    add({ id: 'promote', cmd: 'node', args: ['scripts/build/promote-test2-root.mjs'], after: 'the bundle' });
    add({ id: 'app-checks', cmd: 'node', args: ['scripts/check/run.mjs', '--only', APP_CHECKS], after: 'the bundle' });
    // packages/map/src/ holds the catalogue renderer too (ui-controller, data-service, catalogue/), so its tests run as well.
    if (catalogueCode) add({ id: 'catalogue-tests', cmd: 'npm', args: ['run', '-s', 'test:catalogue'], after: 'the bundle' });
  } else if (mode === 'code') {
    add({ id: 'build', cmd: 'npm', args: ['run', '-s', 'build'], after: 'the site, app and Functions sources' });
    add({ id: 'check-fast', cmd: 'node', args: ['scripts/check/run.mjs'], after: 'the build (test:unit included)' });
    if (catalogueCode) add({ id: 'catalogue-tests', cmd: 'npm', args: ['run', '-s', 'test:catalogue'], after: 'the build' });
  } else if (mode === 'data') {
    const votes = votesDir ? { CIVGRAPH_VOTES_DIR: votesDir } : undefined;
    if (persons) {
      add({
        id: 'persons', cmd: 'bash', args: ['scripts/ingest/persons/rebuild-person-ids.sh'], gate: 'persons-stale',
        env: { MANIFEST_ARGS: manifestArgsWithWithhold(manifestArgs) },
        after: 'the election source and the person registry (rewrites committed files; never without --withhold-unmappable)',
      });
    }
    // Boundary changes between consecutive timeline editions; incremental (seconds when nothing changed).
    add({ id: 'timeline-changes', cmd: 'python', args: ['scripts/build/timeline-changes.py'], after: 'the timeline editions and their sources' });
    add({ id: 'ni-local', cmd: 'node', args: ['scripts/build/build-ni-local-grouped.mjs'], after: 'the NI council rounds and maps.json' });
    add({ id: 'records', cmd: 'npm', args: ['run', '-s', 'records:build'], gate: 'records-stale', env: votes, after: 'every records input (its transforms: the election manifest, summaries, person stamps, provenance, Browse, party profiles, office pages, the graph)' });
    add({ id: 'graph-ids', cmd: 'node', args: ['scripts/build/build-graph-id-ledger.mjs'], after: 'the records build' });
    add({ id: 'person-addresses', cmd: 'node', args: ['scripts/build/build-person-address-ledger.mjs'], after: 'the records build' });
    add({ id: 'catalogue', cmd: 'node', args: ['scripts/build/catalogue/build-catalogue.mjs'], after: 'the records build (its people) and the maps' });
    add({ id: 'catalogue-check', cmd: 'node', args: ['scripts/check/rules/catalogue.mjs'], after: 'the catalogue' });
    add({ id: 'build', cmd: 'npm', args: ['run', '-s', 'build'], after: 'the catalogue (display fields) and the maps; writes the maps index the load reads' });
    add({ id: 'records-again', cmd: 'npm', args: ['run', '-s', 'records:build'], gate: 'records-stale', env: votes, after: 'the ledgers, the catalogue and the maps index written above' });
    add({ id: 'local-artefacts', cmd: 'npm', args: ['run', '-s', 'build:local-artefacts'], after: 'the final records build (sitemaps, Browse cache tokens, site figures, status, licence)' });
    // --apply takes one page; passing both stamped only the homepage and left About stale.
    add({ id: 'stats-home', cmd: 'node', args: ['scripts/build/build-site-stats.mjs', '--apply', 'site/index.html'], after: 'the site figures' });
    add({ id: 'stats-about', cmd: 'node', args: ['scripts/build/build-site-stats.mjs', '--apply', 'site/pages/about.html'], after: 'the site figures' });
    add({ id: 'elections-app', cmd: 'npm', args: ['run', '-s', 'build:elections-app'], after: 'the final records build' });
    add({ id: 'records-check', cmd: 'npm', args: ['run', '-s', 'records:check'], after: 'the final records build and the ledgers' });
    add({ id: 'check-fast', cmd: 'node', args: ['scripts/check/run.mjs'], after: 'everything above (test:unit included)' });
    add({ id: 'catalogue-tests', cmd: 'npm', args: ['run', '-s', 'test:catalogue'], after: 'the catalogue and the bundle' });
  }
  // Through node, not npx: on Windows npx needs a shell, and the shell reads the | in the -g pattern as a pipe.
  if (mode !== 'none' && !noBrowser) add({ id: 'browser', cmd: 'node', args: ['node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright.config.cjs', ...BROWSER_TESTS], after: 'the bundle' });
  return plan;
}

// ------------------------------------------------------------------ the run

/** @param {string[]} gitArgs */
function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The commit to compare with, and where it came from.
 * @param {string | null} since
 * @returns {{ commit: string, from: string }}
 */
function baseFor(since) {
  if (since) return { commit: since, from: '--since' };
  const { base } = resolveBase(path.join(REPO_ROOT, '.claude', 'publish', 'work'));
  if (base) return base;
  try { return { commit: git('rev-parse', 'origin/main')[0] || 'HEAD', from: 'origin/main (no record of the last load)' }; } catch { return { commit: 'HEAD', from: 'HEAD (no origin/main)' }; }
}

const PERSONS_STAMP = path.join(REPO_ROOT, 'tmp', 'rebuild', 'persons-inputs.json');
/** A hash of the files a person-id re-stamp reads (ELECTION_DATA), as they are now. */
function personsInputsHash() {
  const h = createHash('sha256');
  for (const f of workingTreeFiles().filter((x) => ELECTION_DATA.some((re) => re.test(x.path))).sort((a, b) => (a.path < b.path ? -1 : 1))) h.update(`${f.path}\0${f.blob}\n`);
  return h.digest('hex').slice(0, 32);
}

/**
 * Why a gated step must run, or '' when it is current.
 * @param {Step} step @param {boolean} full
 */
function gateReason(step, full) {
  if (!step.gate) return 'always';
  if (full) return '--full';
  if (step.gate === 'records-stale') {
    const reasons = staleReasons({ env: { ...process.env, ...step.env }, dbFile: recordPaths().RECORDS_DB });
    return reasons.join('; ');
  }
  let prior = '';
  try { prior = JSON.parse(readFileSync(PERSONS_STAMP, 'utf8')).hash; } catch { prior = ''; }
  return prior === personsInputsHash() ? '' : (prior ? 'election data changed since the last re-stamp' : 'no record of a re-stamp from these files');
}

/** @param {string[]} args */
function main(args) {
  const sinceIndex = args.indexOf('--since');
  const since = sinceIndex >= 0 ? args[sinceIndex + 1] || null : null;
  const planOnly = args.includes('--plan');
  const full = args.includes('--full');
  const noBrowser = args.includes('--no-browser');

  const base = baseFor(since);
  const tracked = new Set([...git('diff', '--name-only', '--no-renames', base.commit), ...(base.commit === 'HEAD' ? [] : git('diff', '--name-only', '--no-renames', 'HEAD'))]);
  const untracked = git('ls-files', '--others', '--exclude-standard');
  /** @type {ChangedFile[]} */
  const changed = [...[...tracked].map((p) => ({ path: p, tracked: true })), ...untracked.filter((p) => !tracked.has(p)).map((p) => ({ path: p, tracked: false }))];
  const { meaningful, mode, persons } = classifyChanges(changed, { full });

  const wrapper = path.join(REPO_ROOT, '.claude', 'publish', 'publish.sh');
  let votesDir = process.env.CIVGRAPH_VOTES_DIR || '';
  let votesFrom = votesDir ? 'CIVGRAPH_VOTES_DIR' : '';
  if (!votesDir && existsSync(wrapper)) { votesDir = votesDirFromWrapper(readFileSync(wrapper, 'utf8')); votesFrom = votesDir ? 'the publish wrapper' : ''; }
  const plan = planRebuild({ mode, persons, meaningful, noBrowser, votesDir, manifestArgs: process.env.MANIFEST_ARGS });

  console.log(`base: ${base.commit.slice(0, 10)} (${base.from}), plus uncommitted and untracked files`);
  console.log(`changed: ${changed.length} file(s), ${meaningful.length} not build output -> ${mode}${mode === 'data' && persons ? ' (election data: person ids re-stamped with --withhold-unmappable)' : ''}`);
  for (const file of meaningful.slice(0, 12)) console.log(`  ${file}`);
  if (meaningful.length > 12) console.log(`  ... and ${meaningful.length - 12} more`);
  if (mode === 'none') { console.log('Nothing to rebuild.'); return 0; }
  if (mode === 'data') console.log(votesDir ? `votes: ${votesDir} (from ${votesFrom})` : 'WARNING: no votes directory (CIVGRAPH_VOTES_DIR unset, none in the publish wrapper): the votes are carried over and the publish will build again');
  for (const step of plan) {
    const env = step.env ? `${Object.entries(step.env).map(([k, v]) => `${k}=${v}`).join(' ')} ` : '';
    const gate = step.gate === 'records-stale' ? '   [skipped when tmp/records was built from exactly these inputs]' : step.gate === 'persons-stale' ? '   [skipped when already re-stamped from these files]' : '';
    console.log(`  > ${env}${step.cmd} ${step.args.slice(0, 4).join(' ')}${gate}`);
    console.log(`      after: ${step.after}`);
  }
  if (planOnly) return 0;

  const started = Date.now();
  /** @type {string[]} */
  const timings = [];
  for (const step of plan) {
    const why = gateReason(step, full);
    if (!why) { console.log(`skip       ${step.id}: current`); timings.push(`${step.id}=skip`); continue; }
    if (step.gate) console.log(`run        ${step.id}: ${why}`);
    const stepStart = Date.now();
    const exe = process.platform === 'win32' && (step.cmd === 'npm' || step.cmd === 'npx') ? `${step.cmd}.cmd` : (step.cmd === 'node' ? process.execPath : step.cmd);
    const result = spawnSync(exe, step.args, {
      cwd: REPO_ROOT, env: { ...process.env, ...step.env }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
      shell: process.platform === 'win32' && exe.endsWith('.cmd'), maxBuffer: 256 * 1024 * 1024,
    });
    const seconds = ((Date.now() - stepStart) / 1000).toFixed(0);
    timings.push(`${step.id}=${seconds}s`);
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/);
    if (result.status !== 0) {
      console.log(`FAIL ${seconds.padStart(4)}s  ${step.id}: ${step.cmd} ${step.args.slice(0, 3).join(' ')}`);
      console.log(output.slice(-30).join('\n'));
      if (step.id === 'persons' && result.status === 2) console.log('NEEDS RELATIVES HARVEST: stop and report; do not guess.');
      return result.status || 1;
    }
    if (step.gate === 'persons-stale') {
      mkdirSync(path.dirname(PERSONS_STAMP), { recursive: true });
      writeFileSync(PERSONS_STAMP, `${JSON.stringify({ hash: personsInputsHash(), at: new Date().toISOString() }, null, 2)}\n`);
    }
    const summary = output.filter((line) => /CHECKS OK|passed|failed|OK\b|PASS/.test(line)).slice(-1)[0] || '';
    console.log(`ok   ${seconds.padStart(4)}s  ${step.id}${summary ? `  -- ${summary.trim().slice(0, 100)}` : ''}`);
  }
  console.log(`\nREBUILD OK (${mode}) in ${((Date.now() - started) / 1000).toFixed(0)}s  [${timings.join(' ')}]`);
  if (mode === 'data') {
    const stale = staleReasons({ env: votesDir ? { ...process.env, CIVGRAPH_VOTES_DIR: votesDir } : process.env, dbFile: recordPaths().RECORDS_DB });
    console.log(stale.length ? `NOTE: the publish will build the records again: ${stale.join('; ')}` : 'The records build is current: commit, and the publish reuses it.');
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main(process.argv.slice(2));
