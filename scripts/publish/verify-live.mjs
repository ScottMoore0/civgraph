#!/usr/bin/env node
/**
 * Is the commit in your working tree the one the public site is serving?
 *
 * WHY THIS EXISTS
 *
 * Cloudflare Pages keeps serving the last SUCCESSFUL deployment when a build fails. The
 * site stays up, every URL returns 200, and nothing anywhere says the content is frozen.
 * On 2026-08-11 that state persisted across 18 consecutive failed deployments over a
 * full day and was found by accident. Three more deploys this week went unverified for
 * the same reason: there is no signal, so checking is something a person has to remember
 * to do.
 *
 * .github/workflows/pages-deploy-watch.yml would alert on this, but it is dormant --
 * it needs a Cloudflare API token, and the documented decision was to use the dashboard
 * notification instead. Both of those are things only the account owner can turn on.
 * This needs neither: it compares what is committed against what the edge returns, over
 * plain HTTP, with no credentials.
 *
 * WHAT IT COMPARES, AND WHY NOT THE CACHE TOKENS
 *
 * It fetches each shell asset and compares its CONTENT against the local file.
 *
 * The first version of this compared the ?v= cache tokens in index.html instead, and
 * that was wrong -- it reported the site two builds behind for a day while the site was
 * serving current code. Pages runs its OWN build on deploy, which regenerates
 * build/main.css and re-stamps index.html, so the deployed token is computed on the
 * runner and never has to equal the one committed from a developer's machine. Any
 * difference in a salt input produces a different token over identical content. The
 * check was measuring which machine did the build.
 *
 * A commit sha would be weaker still: a deploy can carry the right sha and the wrong
 * assets. Content is the question that matters -- is the JavaScript the public is
 * executing the JavaScript in this checkout.
 *
 * Line endings are normalised before hashing. This repository stores CRLF locally and
 * Pages checks out LF, so the same source produces byte-different builds on the two
 * machines. Without normalising, this check would fail permanently and for a reason
 * that has nothing to do with deployment.
 *
 * A MISMATCH IS NOT AUTOMATICALLY A FAILURE. A deploy in flight looks identical to a
 * deploy that failed. Distinguishing them takes time, not cleverness, so --wait polls.
 *
 * Network-dependent: `verify:`, never `check:`.
 *
 *   npm run verify:deploy
 *   npm run verify:deploy -- --wait 300     # poll for up to 5 minutes
 *   npm run verify:deploy -- --url https://staging.example
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const SITE = String(arg('--url', process.env.CIVGRAPH_SITE_URL || 'https://civgraph.net')).replace(/\/+$/, '');
const WAIT_SECONDS = Number(arg('--wait', 0)) || 0;
const POLL_SECONDS = 15;

/** Shell asset paths referenced by an index.html, tokens discarded. */
function assetPaths(html) {
  const found = new Set();
  for (const m of html.matchAll(/["'(]([^"'()\s]*?\/build\/[^"'()\s?]+\.(?:js|css))(?:\?v=[a-z0-9]+)?/g)) {
    found.add(m[1].replace(/^\.?\//, '/'));
  }
  return [...found];
}

/** Content hash, with line endings normalised -- see the header. */
function normalisedHash(text) {
  const lf = String(text).split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  return createHash('sha256').update(lf).digest('hex').slice(0, 16);
}

let LOCAL_COMMIT = '';
try {
  LOCAL_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch { LOCAL_COMMIT = ''; }

const localPaths = assetPaths(readFileSync('index.html', 'utf8'));
if (!localPaths.length) {
  console.error('FAIL: no versioned /build/ assets found in the local index.html.');
  console.error('  Either the build did not stamp it, or the reference format changed and');
  console.error('  this check is now matching nothing -- which would make it pass forever.');
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.text();
}

async function compareAll() {
  const rows = [];

  // THE STAMP IS THE REAL CHECK. build/deploy-stamp.json carries the commit sha the
  // build was made from -- an input to the build, identical on every machine, unlike
  // anything the build produces.
  try {
    const stamp = JSON.parse(await fetchText(`${SITE}/build/deploy-stamp.json`));
    rows.push({
      path: 'deployed commit',
      ok: Boolean(LOCAL_COMMIT) && stamp.commit === LOCAL_COMMIT,
      localHash: (LOCAL_COMMIT || '(unknown)').slice(0, 12),
      liveHash: `${(stamp.commit || '(unknown)').slice(0, 12)} (built by ${stamp.builtBy || '?'})`
    });
  } catch (error) {
    rows.push({
      path: 'deployed commit',
      ok: false,
      why: `/build/deploy-stamp.json unavailable: ${error.message}`
        + ' -- expected until the first deploy that includes it'
    });
  }

  // Content comparison on the shell assets, kept as a secondary signal and reported
  // rather than failed on: Pages rebuilds these, and CRLF-vs-LF alone makes the bytes
  // differ for the same commit. A mismatch here is worth seeing and is not proof.
  for (const path of localPaths) {
    const localFile = path.replace(/^\//, '');
    if (!existsSync(localFile)) continue;
    let live;
    try { live = await fetchText(`${SITE}${path}`); } catch { continue; }
    const localHash = normalisedHash(readFileSync(localFile, 'utf8'));
    const liveHash = normalisedHash(live);
    rows.push({ path, ok: true, advisory: localHash === liveHash ? 'identical' : 'differs (expected across build machines)' });
  }
  return rows;
}


const deadline = Date.now() + WAIT_SECONDS * 1000;
let rows = [];
let attempt = 0;

for (;;) {
  attempt += 1;
  rows = await compareAll();
  if (rows.every((row) => row.ok)) break;
  if (Date.now() >= deadline) break;
  const behind = rows.filter((row) => !row.ok).length;
  console.log(`[${attempt}] ${behind} asset(s) still behind; waiting ${POLL_SECONDS}s`
    + ` (${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s left)`);
  await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
}

const stale = rows.filter((row) => !row.ok);
for (const row of rows) {
  const note = row.advisory ? `  (${row.advisory})` : '';
  console.log(`  ${row.ok ? 'ok    ' : 'BEHIND'} ${row.path}${note}`);
  if (!row.ok) {
    console.log(row.why
      ? `         ${row.why}`
      : `         local ${row.localHash}   live ${row.liveHash}`);
  }
}

if (!stale.length) {
  console.log(`
PASS: ${SITE} is serving all ${rows.length} shell asset(s) as built here.`);
  process.exitCode = 0;
} else {
  console.error(`
FAIL: ${SITE} is serving ${stale.length} of ${rows.length} shell asset(s) from an older build.`);
  console.error('');
  console.error('  Pages keeps serving the last SUCCESSFUL deployment when a build fails, so');
  console.error('  the site looks healthy while being frozen. Check the deployment list before');
  console.error('  assuming this is propagation delay:');
  console.error('    https://dash.cloudflare.com/?to=/:account/pages/view/civgraph');
  console.error('  If a deploy is genuinely still running, re-run with --wait 300.');
  // exitCode rather than exit(): node 24 on Windows trips a libuv assertion if the
  // process is torn down while undici still holds a keep-alive socket, and it exits
  // 127 instead of 1 -- which CI would read as "command not found", not "stale".
  process.exitCode = 1;
}
