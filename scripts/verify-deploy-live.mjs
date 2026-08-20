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
 * WHAT IT COMPARES, AND WHY THAT AND NOT A COMMIT SHA
 *
 * The app-shell cache tokens. They are content hashes of the deployed bundles, they are
 * already in index.html because the browser needs them, and they change exactly when the
 * thing a visitor runs changes. A commit sha would be a weaker test: a deploy can carry
 * the right sha and the wrong assets. This asks the question that matters -- is the
 * JavaScript the public is executing the JavaScript in this checkout.
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
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const SITE = String(arg('--url', process.env.CIVGRAPH_SITE_URL || 'https://civgraph.net')).replace(/\/+$/, '');
const WAIT_SECONDS = Number(arg('--wait', 0)) || 0;
const POLL_SECONDS = 15;

/** Every versioned shell asset index.html references, as path -> token. */
function tokensOf(html) {
  const found = new Map();
  for (const m of html.matchAll(/["'(]([^"'()\s]*?\/build\/[^"'()\s?]+\.(?:js|css))\?v=([a-z0-9]+)/g)) {
    found.set(m[1].replace(/^\.?\//, '/'), m[2]);
  }
  return found;
}

const localTokens = tokensOf(readFileSync('index.html', 'utf8'));
if (!localTokens.size) {
  console.error('FAIL: no versioned /build/ assets found in the local index.html.');
  console.error('  Either the build did not stamp it, or the reference format changed and');
  console.error('  this check is now matching nothing -- which would make it pass forever.');
  process.exit(1);
}

async function fetchLive() {
  const response = await fetch(`${SITE}/?cachebust=${Number(process.hrtime.bigint() % 1000000n)}`, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' }
  });
  if (!response.ok) throw new Error(`${SITE} returned HTTP ${response.status}`);
  return tokensOf(await response.text());
}

function diff(live) {
  const rows = [];
  for (const [path, token] of localTokens) {
    const liveToken = live.get(path);
    rows.push({ path, token, liveToken: liveToken || null, ok: liveToken === token });
  }
  return rows;
}

const deadline = Date.now() + WAIT_SECONDS * 1000;
let rows = [];
let attempt = 0;

for (;;) {
  attempt += 1;
  try {
    rows = diff(await fetchLive());
  } catch (error) {
    console.error(`FAIL: could not read ${SITE}: ${error.message}`);
    process.exit(1);
  }
  if (rows.every((row) => row.ok)) break;
  if (Date.now() >= deadline) break;
  const behind = rows.filter((row) => !row.ok).length;
  console.log(`[${attempt}] ${behind} asset(s) still behind; waiting ${POLL_SECONDS}s`
    + ` (${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s left)`);
  await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
}

const stale = rows.filter((row) => !row.ok);
for (const row of rows) {
  console.log(`  ${row.ok ? 'ok  ' : 'BEHIND'} ${row.path}`);
  if (!row.ok) console.log(`         committed ${row.token}   live ${row.liveToken ?? '(absent)'}`);
}

if (!stale.length) {
  console.log(`\nPASS: ${SITE} is serving all ${rows.length} committed shell asset(s).`);
  process.exitCode = 0;
} else {
console.error(`\nFAIL: ${SITE} is serving ${stale.length} of ${rows.length} shell asset(s) from an older build.`);
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
