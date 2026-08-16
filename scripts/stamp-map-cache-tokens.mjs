#!/usr/bin/env node
/**
 * Stamp content-derived cache tokens onto catalogue FGB URLs.
 *
 * THE FAILURE THIS FIXES
 *
 * On 2026-08-16 five corrected Local Authority layers were uploaded to their
 * existing R2 keys. The bytes at the edge were verified sha256-identical to the
 * reviewed files, and the contributor still could not see the change.
 *
 * The reason is that data.civgraph.net sends NO Cache-Control header at all --
 * only ETag and Last-Modified. With no explicit freshness, browsers fall back to
 * heuristic caching (RFC 9111 4.2.2), which is commonly 10% of the document's
 * age. Those files had been stable since the 2026-05-09 ingest, so they were
 * ~99 days old, giving roughly TEN DAYS of freshness during which the browser
 * does not even revalidate. The correction was live and invisible.
 *
 * Note how badly that fails: the longer a layer has been stable, the longer a
 * correction to it takes to reach anyone who has already looked at it. The
 * cache behaves worst exactly where the data is most established.
 *
 * Cache-Control on the bucket would bound that, and should still be set. But it
 * cannot help the person already holding a stale entry, because their freshness
 * lifetime was computed when they stored it. Only a different URL reaches them,
 * which is what this does.
 *
 * WHY THE ETAG AND NOT A HAND-PICKED NUMBER
 *
 * Principle 3: derive values, do not maintain them. A hand-bumped `?v=2` is one
 * forgotten edit away from being a lie, and this project has already shipped
 * that exact bug -- browse/browse.js once went a whole day serving old code
 * behind a stale token. R2's ETag is the object's own content hash, so the token
 * cannot drift from the bytes it names: re-upload and it changes, leave the file
 * alone and it does not.
 *
 * A HEAD request is enough to read it, so this costs no body transfer.
 *
 * Usage:
 *   node scripts/stamp-map-cache-tokens.mjs --check          # gate: tokens match live objects
 *   node scripts/stamp-map-cache-tokens.mjs --write          # restamp every tokened URL
 *   node scripts/stamp-map-cache-tokens.mjs --write --id X   # add or refresh one entry
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const CDN_HOST = 'data.civgraph.net';
const TOKEN = 'v';

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const WRITE = argv.includes('--write');
const ids = argv.filter((a, i) => argv[i - 1] === '--id');

/** R2 quotes its ETags, and a quote is not legal in a query string. */
function normaliseEtag(raw) {
  return String(raw || '').replace(/^W\//, '').replace(/"/g, '').trim();
}

async function liveToken(url) {
  const bare = new URL(url);
  bare.searchParams.delete(TOKEN);
  const res = await fetch(bare.toString(), { method: 'HEAD' });
  if (!res.ok) return { error: `HEAD ${res.status}` };
  const etag = normaliseEtag(res.headers.get('ETag'));
  if (!etag) return { error: 'no ETag on the object' };
  return { token: etag };
}

/** Entries whose fgb is served from the CDN. Anything else is not ours to stamp. */
function targets(catalogue) {
  return catalogue.maps.filter((m) => {
    const fgb = m?.files?.fgb;
    if (typeof fgb !== 'string' || !fgb.includes(CDN_HOST)) return false;
    if (ids.length) return ids.includes(m.id);
    // Without --id, act only on entries that already carry a token. Adding one
    // to every layer in the catalogue is a much larger change than fixing the
    // ones that have been corrected, and it should be a deliberate decision
    // rather than a side effect of running this.
    return new URL(fgb).searchParams.has(TOKEN);
  });
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const selected = targets(catalogue);

if (!CHECK && !WRITE) {
  console.error('Nothing to do. Use --check or --write.');
  process.exit(1);
}

if (!selected.length) {
  console.log(CHECK ? 'PASS: no tokened map URLs to verify.' : 'No matching entries.');
  process.exit(0);
}

const stale = [];
let changed = 0;

for (const map of selected) {
  const url = new URL(map.files.fgb);
  const current = url.searchParams.get(TOKEN);
  const { token, error } = await liveToken(url.toString());

  if (error) {
    stale.push(`${map.id}: could not read the live object (${error})`);
    continue;
  }
  if (current === token) continue;

  if (CHECK) {
    stale.push(`${map.id}: token is "${current || '(none)'}" but the live object is "${token}"`);
    continue;
  }
  url.searchParams.set(TOKEN, token);
  map.files.fgb = url.toString();
  changed += 1;
  console.log(`  ${map.id}\n    -> ${url.toString()}`);
}

if (CHECK) {
  if (stale.length) {
    console.error(`FAIL: ${stale.length} map URL(s) do not match the object they point at:`);
    for (const line of stale) console.error(`  - ${line}`);
    console.error('');
    console.error('  A file was re-uploaded without restamping its token, so returning');
    console.error('  visitors will keep the old geometry until their cache expires.');
    console.error('  Fix with: node scripts/stamp-map-cache-tokens.mjs --write');
    process.exit(1);
  }
  console.log(`PASS: ${selected.length} tokened map URL(s) match the live objects.`);
  process.exit(0);
}

if (!changed) {
  console.log('All tokens already current; catalogue untouched.');
  process.exit(0);
}

writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`\nStamped ${changed} URL(s) in ${CATALOGUE}.`);
console.log('Remember: the client reads the catalogue from D1, so run');
console.log('  npm run build:catalogue-d1');
console.log('or the file will be right and the site will not.');
