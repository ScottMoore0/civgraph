#!/usr/bin/env node
/*
 * DFS-traversal benchmark for the PRONI detail scrape.
 *
 * Compares two ways of fetching the same set of leaf records under one subtree:
 *   BASELINE  - current behaviour: re-walk from the letter root for every branch.
 *   DFS       - descend once, keep a cached parent-listing stack, reach siblings
 *               by re-POSTing the cached parent viewstate (no root re-walk).
 *
 * The DFS run also TESTS the core hypothesis: does PRONI accept a re-POST against
 * a cached ancestor listing page after we have navigated away into a sibling?
 * If every expected record is fetched with a matching reference, it works.
 *
 * Single connection, hard request cap - deliberately tiny and polite.
 */

import { readFileSync } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import {
  Session,
  makeStats,
  parseArgs,
  openBranchPage,
  clickSelect,
  clickMore,
  parseGridRows,
} from "./proni-detail-quick-scan.mjs";

const RECORDS_FILE = process.argv[2];
const ROOT_BRANCH = process.argv[3] || "YESB";
const LETTER = process.argv[4] || ROOT_BRANCH[0];
const REQUEST_CAP = Number(process.argv[5] || 250);

if (!RECORDS_FILE) {
  console.error("usage: node scripts/proni-dfs-benchmark.mjs <records.jsonl> [rootBranch] [letter] [requestCap]");
  process.exit(1);
}

function buildOptions() {
  const o = parseArgs([]);
  o.httpClient = "https-agent";
  o.httpAgent = new HttpsAgent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 10000, scheduling: "lifo" });
  o.maxPagesPerBranch = 50;
  o.maxRetries = 3;
  o.timeoutMs = o.timeoutMs || 30000;
  o.backoffMs = o.backoffMs || 1000;
  o.maxCooldownMs = o.maxCooldownMs || 15000;
  o.errorWindowMs = o.errorWindowMs || 15000;
  o.errorBurstThreshold = o.errorBurstThreshold || 8;
  o.stopOnBlocked = true;
  return o;
}

const writers = { failures: { write: async () => {} }, mismatches: { write: async () => {} } };

// Load the records and group into branches (the index's view of the work).
const rows = readFileSync(RECORDS_FILE, "utf8").trim().split(/\n/).map((l) => JSON.parse(l));
const wantRefs = new Set(rows.map((r) => r.expectedRef));
const branchMap = new Map();
for (const r of rows) {
  if (!branchMap.has(r.branchKey)) {
    branchMap.set(r.branchKey, { letter: r.letter, path: r.path, page: Number(r.page || 1), branchKey: r.branchKey, refs: [] });
  }
  branchMap.get(r.branchKey).refs.push(r.expectedRef);
}
const branches = [...branchMap.values()];

function capCheck(stats) {
  if (stats.requests > REQUEST_CAP) throw new Error(`request cap ${REQUEST_CAP} exceeded`);
}

// BASELINE: open every branch from the letter root, then More each record.
async function runBaseline() {
  const stats = makeStats();
  const session = new Session("base", buildOptions(), writers, stats);
  const got = new Set();
  let mismatched = 0;
  for (const br of branches) {
    const html = await openBranchPage(session, br);
    capCheck(stats);
    const gridRows = parseGridRows(html);
    const byRef = new Map(gridRows.map((row) => [row.ResultsSelect?.value, row]));
    for (const ref of br.refs) {
      const gridRow = byRef.get(ref);
      if (!gridRow) { mismatched += 1; continue; }
      const detail = await clickMore(session, html, gridRow, ref);
      capCheck(stats);
      if (detail.matched) got.add(ref); else mismatched += 1;
    }
  }
  return { mode: "baseline", requests: stats.requests, records: got.size, mismatched, errors: stats.requestErrors };
}

// DFS: reach the root once, then walk with a cached parent-listing stack.
async function runDfs() {
  const stats = makeStats();
  const session = new Session("dfs", buildOptions(), writers, stats);
  const got = new Set();
  let mismatched = 0;

  const rootRec = rows.find((r) => (r.path || []).includes(ROOT_BRANCH)) || rows[0];
  const rp = rootRec.path || [];
  const rootPath = rp.slice(0, rp.indexOf(ROOT_BRANCH) + 1);
  const rootHtml = await openBranchPage(session, { letter: LETTER, path: rootPath, page: 1, branchKey: `${LETTER}|${rootPath.join(">")}` });
  capCheck(stats);

  async function walk(listingHtml, prefix) {
    const gridRows = parseGridRows(listingHtml);
    // (1) fetch any leaf records on this listing
    for (const row of gridRows) {
      const ref = row.ResultsSelect?.value;
      if (row.ResultsView && ref && wantRefs.has(ref) && !got.has(ref)) {
        const detail = await clickMore(session, listingHtml, row, ref);
        capCheck(stats);
        if (detail.matched) got.add(ref); else mismatched += 1;
      }
    }
    // (2) descend into selectable sub-branches within our subtree, reusing the cached listing for siblings
    for (const row of gridRows) {
      const childRef = row.ResultsSelect?.value;
      if (!row.ResultsSelect || row.ResultsSelect.disabled || !childRef) continue;
      if (!childRef.startsWith(`${prefix}/`)) continue;
      const childHtml = await clickSelect(session, listingHtml, row); // <-- re-POST against cached parent
      capCheck(stats);
      await walk(childHtml, childRef);
      // loop continues: next sibling is selected from the SAME cached listingHtml
    }
  }

  await walk(rootHtml, ROOT_BRANCH);
  return { mode: "dfs", requests: stats.requests, records: got.size, mismatched, errors: stats.requestErrors };
}

(async () => {
  console.log(`subtree root=${ROOT_BRANCH} letter=${LETTER} | expected records=${wantRefs.size} | branches=${branches.length}`);
  const base = await runBaseline();
  const dfs = await runDfs();
  const fmt = (r) => `${r.mode.padEnd(9)} requests=${String(r.requests).padStart(4)}  records=${r.records}/${wantRefs.size}  req/rec=${(r.requests / Math.max(1, r.records)).toFixed(2)}  mismatched=${r.mismatched}  errors=${r.errors}`;
  console.log(fmt(base));
  console.log(fmt(dfs));
  const ok = dfs.records === wantRefs.size && dfs.mismatched === 0;
  console.log(`HYPOTHESIS (cached-parent re-POST works): ${ok ? "CONFIRMED" : "FAILED"} — DFS fetched ${dfs.records}/${wantRefs.size} cleanly`);
  if (base.records === wantRefs.size && dfs.records === wantRefs.size) {
    const saving = (1 - dfs.requests / base.requests) * 100;
    console.log(`REQUEST SAVING: ${saving.toFixed(1)}%  (baseline ${(base.requests / base.records).toFixed(2)} -> dfs ${(dfs.requests / dfs.records).toFixed(2)} req/rec)`);
  }
})().catch((e) => { console.error("BENCH-ERROR:", e.message); process.exitCode = 1; });
