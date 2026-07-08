#!/usr/bin/env node
/**
 * Validates the election source-provenance enrichment sidecar
 * (data/database/election-source-enrichments.json): open-data election datasets
 * attached as references to election browse records. Pins counts, checks every
 * election key resolves to a real election, licences are open, URLs are public,
 * and each dataset actually materialised as a reference on its election record.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SIDE = path.join(ROOT, 'data', 'database', 'election-source-enrichments.json');
const BROWSE_ELECTIONS = path.join(ROOT, 'data', 'browse', 'elections.json');
const OPEN_LICENCES = new Set(['CC BY-SA 4.0', 'CC BY 4.0']);
const LOCAL = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/)/i;

main();

function main() {
  const doc = readJson(SIDE);
  assert(doc.schemaVersion === 1, 'election-source-enrichments must be schemaVersion 1');
  const enrichments = Array.isArray(doc.enrichments) ? doc.enrichments : [];
  const datasetCount = enrichments.reduce((s, e) => s + (Array.isArray(e.datasets) ? e.datasets.length : 0), 0);
  // Count pins — bump deliberately when the tranche grows.
  // 2026-07-08: 11 Dail general elections / 27 datasets + 6 presidential elections /
  // 10 datasets (correctly matched to ireland-president entities) = 17 / 37.
  assert(enrichments.length === 17, `Expected 17 enriched elections, found ${enrichments.length}.`);
  assert(datasetCount === 37, `Expected 37 election source datasets, found ${datasetCount}.`);
  assert(doc.counts?.elections === enrichments.length && doc.counts?.datasets === datasetCount, 'sidecar counts must match contents');
  assert(!LOCAL.test(JSON.stringify(doc)), 'sidecar must not expose local filesystem paths');

  const elections = readJson(BROWSE_ELECTIONS).items || [];
  const byKey = new Map(elections.map((e) => [e.key || e.id, e]));

  let materialised = 0;
  for (const e of enrichments) {
    const election = byKey.get(e.electionKey);
    assert(election, `election key not found in browse elections: ${e.electionKey}`);
    for (const d of e.datasets) {
      assert(d.title, `dataset missing title under ${e.electionKey}`);
      assert(/^https:\/\//i.test(d.providerUrl || ''), `dataset providerUrl not https under ${e.electionKey}: ${d.providerUrl}`);
      assert(OPEN_LICENCES.has(d.license), `dataset licence not open (${d.license}) under ${e.electionKey}`);
      const refs = Array.isArray(election.references) ? election.references : [];
      const hit = refs.some((r) => (r.url || '').replace(/\/+$/, '') === d.providerUrl.replace(/\/+$/, ''));
      assert(hit, `dataset not materialised as a reference on ${e.electionKey}: ${d.providerUrl}`);
      materialised += 1;
    }
  }
  console.log(`Election source-enrichment validation passed: ${enrichments.length} elections, ${datasetCount} datasets, ${materialised} references materialised.`);
}

function readJson(p) { assert(existsSync(p), `missing required file: ${path.relative(ROOT, p)}`); return JSON.parse(readFileSync(p, 'utf8')); }
function assert(c, m) { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } }
