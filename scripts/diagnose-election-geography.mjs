#!/usr/bin/env node
/**
 * Work out which geography layer each election's results actually correspond to.
 *
 * resolveElectionGeography() in build-test2-election-manifest.mjs assigns a layer by
 * year. Two classes of bug follow from that, together accounting for all 851 unmatched
 * constituencies:
 *
 *   - 620 rows: 18 Dail elections from 1921-1969 get sourceMapId null, so nothing is
 *     assigned at all and the elections cannot be opened.
 *   - 231 rows: the wrong layer is assigned. Either the wrong kind -- pre-1992
 *     referendums fall through to roi-counties-2011, a COUNTY layer, while the results
 *     are reported by Dail constituency -- or the wrong revision, because the
 *     thresholds use the year a revision was named rather than the year it took
 *     effect. dail-2013 is assigned to the 2013 referendum, but the 2013 revision
 *     first applied at the 2016 general election.
 *
 * Rather than assert which revision applies where, this scores each election's
 * constituency names against the feature names of every candidate layer and reports
 * the best fits. The data picks the layer; a human still confirms it.
 *
 * Feature names come from whichever source exists, in order of cost: a tracked feature
 * index, the spatial index, or the source FGB.
 *
 * Usage:
 *   node scripts/diagnose-election-geography.mjs [--body "Dáil Éireann"] [--min 0.8]
 */
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ONLY_BODY = argVal('--body', null);
const MIN = Number(argVal('--min', 0.75));

/**
 * Two normalisations, because the corpus disagrees in two independent ways.
 *
 * `norm` folds case, accents, dash style, ampersands and County/Borough noise.
 * `tokens` additionally sorts the words, because word order is not stable: the 1961
 * election reports "Cork Mid" and "Donegal North East" where the layer has "Mid Cork"
 * and "Dún Laoghaire and Rathdown". Comparing on `norm` alone scored dail-1961 against
 * the 1961 election at 22/38 and made the correct layer look wrong.
 */
function norm(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/(county|borough|constituency|co\.?)/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function tokens(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !['county', 'borough', 'constituency', 'co', 'and', 'the'].includes(t))
    .sort()
    .join('');
}

const metadata = JSON.parse(readFileSync(path.join(ROOT, 'render/metadata/maps-test.json'), 'utf8'));
const layersById = new Map((metadata.layers || []).map((l) => [l.id, l]));

const nameCache = new Map();

/** Feature names for a layer id (without the -vector-test suffix), or null. */
async function featureNames(mapId) {
  if (nameCache.has(mapId)) return nameCache.get(mapId);
  let names = null;
  const layerId = `${mapId}-vector-test`;

  const idxPath = path.join(ROOT, 'render/metadata/feature-indexes', `${layerId}.json`);
  if (existsSync(idxPath)) {
    try {
      const doc = JSON.parse(readFileSync(idxPath, 'utf8'));
      const collected = new Set();
      JSON.stringify(doc).replace(/"name"\s*:\s*"([^"]{1,80})"/g, (_, v) => collected.add(v));
      if (collected.size) names = [collected];
    } catch { /* fall through */ }
  }

  if (!names) {
    const spatial = path.join(ROOT, 'data/database/spatial-index', `${mapId}.json`);
    if (existsSync(spatial)) {
      try {
        const doc = JSON.parse(readFileSync(spatial, 'utf8'));
        const rows = Array.isArray(doc) ? doc : Object.values(doc);
        const collected = new Set(rows.map((r) => r && r.name).filter(Boolean));
        if (collected.size) names = [collected];
      } catch { /* fall through */ }
    }
  }

  if (!names) {
    const layer = layersById.get(layerId);
    const candidates = [
      layer && layer.sourceFile ? path.resolve(ROOT, String(layer.sourceFile).replace(/^\//, '')) : null,
      path.join(ROOT, 'render/source-cache/vector-intake', `${mapId}.fgb`),
    ].filter(Boolean);
    for (const file of candidates) {
      if (!existsSync(file) || !file.endsWith('.fgb')) continue;
      try {
        // Collect every short string property, then pick the one that behaves like a
        // name: highest distinct-value count. Guessing the label field by name fails
        // across this corpus -- it is Name, NAME, CON_NAME, MAX_CON_NA and others.
        const perProp = new Map();
        let count = 0;
        for await (const feature of deserialize(new Uint8Array(readFileSync(file)))) {
          for (const [k, v] of Object.entries(feature.properties || {})) {
            if (typeof v !== 'string' || !v || v.length > 60) continue;
            if (!perProp.has(k)) perProp.set(k, new Set());
            perProp.get(k).add(v);
          }
          count += 1;
        }
        if (!count) continue;
        // Return EVERY string property's values, not the one with most distinct values.
        // That heuristic silently failed on dail-1961, which carries both CON_NAME and
        // CON_NAME_G -- 38 English and 38 Irish names. On a tie the wrong one could win,
        // scoring the correct layer at nearly zero and making it look as though no
        // geography existed for the 1961 election. Scoring each property and taking the
        // best overlap removes the guess.
        names = [...perProp.values()].filter((set) => set.size > 1);
        break;
      } catch (error) {
        console.warn(`  (could not read ${path.relative(ROOT, file)}: ${error.message})`);
      }
    }
  }

  nameCache.set(mapId, names);
  return names;
}

/** Every map id that could plausibly be an election geography. */
function candidateMapIds() {
  const ids = new Set();
  for (const layer of metadata.layers || []) {
    const id = String(layer.id || '').replace(/-vector-test$/, '');
    if (/^(dail|pc|assembly-areas|stormont|deas|roi-|ni-|forum|constitutional)/.test(id)) ids.add(id);
  }
  for (const f of existsSync(path.join(ROOT, 'render/source-cache/vector-intake'))
    ? readdirSync(path.join(ROOT, 'render/source-cache/vector-intake')) : []) {
    if (f.endsWith('.fgb')) ids.add(f.replace(/\.fgb$/, ''));
  }
  return [...ids];
}

const dir = path.join(ROOT, 'render/metadata/elections-test2');
const elections = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const targets = elections.filter((e) => {
  if (ONLY_BODY && e.body !== ONLY_BODY) return false;
  return !e.layerId || (e.unmatchedCount || 0) > 0;
});

console.log(`Elections needing a geography decision: ${targets.length}`);
const candidates = candidateMapIds();
console.log(`Candidate layers: ${candidates.length}\n`);

const report = [];
for (const election of targets.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
  const wanted = (election.results || []).map((r) => r.constituency).filter(Boolean);
  if (!wanted.length) continue;
  const scores = [];
  for (const mapId of candidates) {
    const nameSets = await featureNames(mapId);
    if (!nameSets || !nameSets.length) continue;
    let hit = 0;
    for (const set of nameSets) {
      const byNorm = new Set([...set].map(norm));
      const byToken = new Set([...set].map(tokens));
      const h = wanted.filter((w) => byNorm.has(norm(w)) || byToken.has(tokens(w))).length;
      if (h > hit) hit = h;
    }
    scores.push({ mapId, rate: hit / wanted.length, hit, of: wanted.length });
  }
  scores.sort((a, b) => b.rate - a.rate);
  const best = scores[0];
  const current = election.sourceMapId || null;
  report.push({ key: election.key, date: election.date, current, best, runnerUp: scores[1] });
  const flag = !best ? 'NO CANDIDATE' : best.rate >= 0.999 ? 'exact' : best.rate >= MIN ? 'good' : 'WEAK';
  console.log(`${election.date}  ${election.key.slice(0, 48).padEnd(48)}`);
  console.log(`   current: ${String(current).padEnd(24)} matched ${election.matchedCount}/${(election.matchedCount || 0) + (election.unmatchedCount || 0)}`);
  if (best) {
    console.log(`   best:    ${best.mapId.padEnd(24)} ${(100 * best.rate).toFixed(1)}% (${best.hit}/${best.of})  [${flag}]`);
    if (scores[1]) console.log(`   next:    ${scores[1].mapId.padEnd(24)} ${(100 * scores[1].rate).toFixed(1)}%`);
  } else {
    console.log('   best:    (no candidate layer had readable feature names)');
  }
}

const exact = report.filter((r) => r.best && r.best.rate >= 0.999).length;
const good = report.filter((r) => r.best && r.best.rate >= MIN && r.best.rate < 0.999).length;
const weak = report.length - exact - good;
console.log(`\nSummary: ${exact} exact, ${good} above ${MIN}, ${weak} weak or undetermined.`);
