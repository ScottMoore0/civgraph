#!/usr/bin/env node
/**
 * Rebuild and check only what the working tree's changes need.
 *
 * Every change used to go through the whole chain -- provenance, catalogue, the full site
 * build, the semantic graph, site stats, all 61 checks and the browser tests -- so a
 * one-line CSS fix cost as long as a data batch. This looks at what changed and picks:
 *
 *   app    only interface code changed (app/src, src/*.js|css, src/map, render/src, sw.js, site
 *          CSS/JS, the election viewer, tests, CI and the check harness): rebuild the app
 *          bundle and shell, run the app-facing checks and the election/timeline browser tests.
 *   data   anything else: the full chain. Election source or corrections also re-stamp
 *          person ids first (scripts/rebuild-person-ids.sh).
 *
 *   node scripts/rebuild-changed.mjs              changes against HEAD, untracked included
 *   node scripts/rebuild-changed.mjs --since REF  changes since a commit (e.g. origin/main)
 *   node scripts/rebuild-changed.mjs --full       the data path whatever changed
 *   node scripts/rebuild-changed.mjs --plan       print the plan and stop
 *   node scripts/rebuild-changed.mjs --no-browser skip the Playwright tests
 */
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const sinceIndex = args.indexOf('--since');
const since = sinceIndex >= 0 ? args[sinceIndex + 1] : null;
const planOnly = args.includes('--plan');
const forceFull = args.includes('--full');
const noBrowser = args.includes('--no-browser');

// Outputs the builds themselves write: a change here says nothing about what to rebuild.
const GENERATED = [
  /^app\/build\//, /^(maps\/(classic\/|test\/)?)?index\.html$/, /^test2\/index\.html$/,
  /^agent\//, /^data\/catalogue\//, /^data\/browse\//, /^data\/graph\//,
  /^data\/database\/(corpus-index|election-provenance|site-stats|status)\.json$/,
  /^data\/database\/[a-z-]+-d1-import\.sql$/, /^data\/database\/elections-schema\.sql$/,
  /^functions\/_api\/_public-prefixes\.js$/, /^render\/metadata\//, /^pages\/(about|status)\.html$/,
  /^app\/election-viewer-package\/(css|js)\//, /^app\/js\//, /^sitemap\.xml$/, /^sitemaps\//
];
const APP = [
  /^app\/src\//, /^src\/[^/]+\.(js|css)$/, /^src\/map\//, /^render\/src\//, /^sw\.js$/,
  /^assets\/(css|site|js)\//, /^tests\//, /^scripts\/run-checks\.mjs$/, /^scripts\/rebuild-changed\.mjs$/,
  // The check machinery itself (CHECKS.md): CI, the clean-export harness, the test server.
  /^\.github\/workflows\//, /^CHECKS\.md$/, /^scripts\/(validate-ci-workflow|check-clean)\.mjs$/, /^scripts\/test-server\.py$/
];
// data/elections/ni-local/ is the grouped-years snapshot (calendar, boundary features): no person ids.
const ELECTION_DATA = [/^data\/elections-source\//, /^data\/elections\/(?!ni-local\/)/];

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
const changed = [...new Set([
  ...git('diff', '--name-only', since || 'HEAD'),
  ...(since ? [] : git('ls-files', '--others', '--exclude-standard'))
])].filter((file) => !/^(review-for-phelim|review-ni-council-xref)\//.test(file));

const meaningful = changed.filter((file) => !GENERATED.some((re) => re.test(file)));
const appOnly = meaningful.length > 0 && meaningful.every((file) => APP.some((re) => re.test(file)));
const electionData = meaningful.some((file) => ELECTION_DATA.some((re) => re.test(file)));
const mode = forceFull ? 'data' : (meaningful.length === 0 ? 'none' : appOnly ? 'app' : 'data');

const BROWSER_TESTS = [
  'tests/browser/timeline-and-url-state.spec.js', 'tests/browser/app.spec.js', 'tests/browser/timeline-changes.spec.js',
  '-g', 'boundary changes on the timeline|runtime exposes|round-trips|clamps out-of-range|rapid timeline|FPTP Results|main DOM contract|candidate and count panes|Cork North-Central|Galway East|local-government aggregates|restores and persists|twist does not rotate|seat-circle overlays',
  '--timeout=180000'
];
const APP_CHECKS = 'check:root,check:asset-refs,check:app-shell-cache,check:pages-assets,check:site-partials,check:site-nav,check:test2,check:ci-workflow,check:doc-paths,check:doc-status,lint';

const plan = [];
if (mode === 'app') {
  plan.push(['node', ['scripts/build-shared-shell-assets.mjs']]);
  plan.push(['node', ['scripts/build-test2-app.mjs']]);
  plan.push(['node', ['scripts/promote-test2-root.mjs']]);
  plan.push(['node', ['scripts/run-checks.mjs', '--only', APP_CHECKS]]);
  // src/ holds the catalogue renderer too (ui-controller, data-service), so its tests run as well.
  if (meaningful.some((file) => file.startsWith('src/'))) plan.push(['npm', ['run', '-s', 'test:catalogue']]);
} else if (mode === 'data') {
  if (electionData || forceFull) plan.push(['bash', ['scripts/rebuild-person-ids.sh']]);
  // The records database and everything built with it (bundles, provenance, the Browse tree,
  // party profiles, office pages, the graph) into tmp/records; skipped inside when the inputs are
  // unchanged. The catalogue reads its people from it, the sitemaps and site figures its trees.
  plan.push(['npm', ['run', '-s', 'records:build']]);
  // Boundary changes between consecutive timeline editions. Incremental: only pairs whose
  // editions or source files changed are recomputed, so this is seconds when nothing did.
  plan.push(['python', ['scripts/build_timeline_changes.py']]);
  // The pre-1973 NI council rounds grouped by year, from the election catalogue (seconds).
  plan.push(['node', ['scripts/build-ni-local-grouped.mjs']]);
  plan.push(['node', ['scripts/catalogue/build-catalogue.mjs']]);
  plan.push(['node', ['scripts/catalogue/check-catalogue.mjs']]);
  plan.push(['npm', ['run', '-s', 'build']]);
  // Committed artefacts the Pages build no longer makes: sitemaps, Browse cache tokens, the
  // status page and site figures.
  plan.push(['npm', ['run', '-s', 'build:local-artefacts']]);
  // --apply takes one page; passing both stamped only the homepage and left About stale.
  plan.push(['node', ['scripts/build-site-stats.mjs', '--apply', 'index.html']]);
  plan.push(['node', ['scripts/build-site-stats.mjs', '--apply', 'pages/about.html']]);
  plan.push(['node', ['scripts/run-checks.mjs']]);
  plan.push(['npm', ['run', '-s', 'test:catalogue']]);
}
// Through node, not npx: on Windows npx needs a shell, and the shell reads the | in the -g
// pattern as a pipe.
if (mode !== 'none' && !noBrowser) plan.push(['node', ['node_modules/@playwright/test/cli.js', 'test', ...BROWSER_TESTS]]);

console.log(`changed: ${changed.length} file(s), ${meaningful.length} not build output -> ${mode}${electionData ? ' (election data: person ids re-stamped)' : ''}`);
for (const file of meaningful.slice(0, 12)) console.log(`  ${file}`);
if (meaningful.length > 12) console.log(`  ... and ${meaningful.length - 12} more`);
if (mode === 'none') { console.log('Nothing to rebuild.'); process.exit(0); }
for (const [cmd, cmdArgs] of plan) console.log(`  > ${cmd} ${cmdArgs.join(' ')}`);
if (planOnly) process.exit(0);

const started = Date.now();
for (const [cmd, cmdArgs] of plan) {
  const stepStart = Date.now();
  const exe = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx') ? `${cmd}.cmd` : (cmd === 'node' ? process.execPath : cmd);
  const result = spawnSync(exe, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' && exe.endsWith('.cmd'), maxBuffer: 256 * 1024 * 1024 });
  const seconds = ((Date.now() - stepStart) / 1000).toFixed(0);
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/);
  if (result.status !== 0) {
    console.log(`FAIL ${seconds.padStart(4)}s  ${cmd} ${cmdArgs.slice(0, 3).join(' ')}`);
    console.log(output.slice(-30).join('\n'));
    process.exit(result.status || 1);
  }
  const summary = output.filter((line) => /CHECKS OK|passed|failed|OK\b|PASS/.test(line)).slice(-1)[0] || '';
  console.log(`ok   ${seconds.padStart(4)}s  ${cmd} ${cmdArgs.slice(0, 3).join(' ')}${summary ? `  -- ${summary.trim().slice(0, 100)}` : ''}`);
}
console.log(`\nREBUILD OK (${mode}) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
