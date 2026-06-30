#!/usr/bin/env node
/*
 * Offline req/rec estimator for the DFS detail scrape (no network).
 *
 * Reconstructs the subtree partition (scripts/proni-detail-quick-scan.mjs
 * buildSubtreeUnits) from an index and reports the theoretical requests-per-record
 * at a range of --max-subtree-records caps, so the cap can be tuned without
 * touching PRONI. The model counts, per emitted unit:
 *   root-walk  = 3 (SearchPage + Browse + Letter) + rootDepth selects
 *   descends   = one select per branch below the unit root
 *   detail     = one More per record (the irreducible 1.0)
 * It ignores within-branch pagination and retries (roughly cap-independent, so the
 * RELATIVE comparison between caps is reliable).
 *
 * Usage: node scripts/proni-dfs-estimate.mjs <records-index.jsonl> [cap1,cap2,...]
 */

import { createReadStream } from "node:fs";
import readline from "node:readline";

const IDX = process.argv[2];
const CAPS = (process.argv[3] || "500,1500,3000,6000,12000,50000").split(",").map(Number);
if (!IDX) { console.error("usage: node scripts/proni-dfs-estimate.mjs <records-index.jsonl> [caps]"); process.exit(1); }

const nodes = new Map();
const keyOf = (letter, p) => `${letter}|${p.join(">")}`;
function ensure(letter, p) {
  const k = keyOf(letter, p);
  if (!nodes.has(k)) nodes.set(k, { depth: p.length, direct: 0, parent: p.length > 1 ? keyOf(letter, p.slice(0, -1)) : null, children: new Set(), subRecs: 0, subNodes: 0 });
  return nodes.get(k);
}

const rl = readline.createInterface({ input: createReadStream(IDX, { encoding: "utf8" }), crlfDelay: Infinity });
let total = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const p = r.path || [];
  if (!p.length) continue;
  for (let i = 1; i <= p.length; i += 1) {
    ensure(r.letter, p.slice(0, i));
    if (i > 1) nodes.get(keyOf(r.letter, p.slice(0, i - 1))).children.add(keyOf(r.letter, p.slice(0, i)));
  }
  ensure(r.letter, p).direct += 1;
  total += 1;
}

function compute(k) {
  const n = nodes.get(k);
  let recs = n.direct, cnt = 1;
  for (const c of n.children) { const [cr, cc] = compute(c); recs += cr; cnt += cc; }
  n.subRecs = recs; n.subNodes = cnt;
  return [recs, cnt];
}
const roots = [...nodes.keys()].filter((k) => nodes.get(k).parent === null);
for (const r of roots) compute(r);

for (const CAP of CAPS) {
  let units = 0, navReq = 0, mores = 0, maxUnit = 0;
  const emit = (k, includeDesc) => {
    const n = nodes.get(k);
    const recs = includeDesc ? n.subRecs : n.direct;
    const innerNodes = includeDesc ? n.subNodes : 1;
    navReq += (3 + n.depth) + (innerNodes - 1);
    mores += recs; units += 1; maxUnit = Math.max(maxUnit, recs);
  };
  const part = (k) => {
    const n = nodes.get(k);
    if (n.subRecs <= CAP) { if (n.subRecs > 0) emit(k, true); return; }
    if (n.direct > 0) emit(k, false);
    for (const c of n.children) part(c);
  };
  for (const r of roots) part(r);
  console.log(`cap=${String(CAP).padStart(6)} units=${String(units).padStart(6)} req/rec=${((navReq + mores) / mores).toFixed(4)} navOverhead=${(navReq / mores).toFixed(4)} maxUnitRecs=${maxUnit}`);
}
console.log(`total records=${total} branches=${nodes.size} (irreducible floor ~= 1 + branches/records = ${(1 + nodes.size / total).toFixed(4)})`);
