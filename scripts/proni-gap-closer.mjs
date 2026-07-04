#!/usr/bin/env node
/*
 * Gap-closer for the description re-scrape: fetches records that exist in the
 * catalogue but were not reached by the fold DFS run (mostly leaf items the
 * discovery index missed). Groups the uncaptured refs by parent, navigates to
 * each parent's children listing once, pages through it, and clickMores every
 * uncaptured child (matched by ResultsSelect.value == ref) — so navigation is
 * amortised across siblings. Descriptions come through with line breaks (same
 * extractDetailFields path as the main scan). Resumable: refs already in the
 * output are skipped.
 *
 * usage: node scripts/proni-gap-closer.mjs <uncaptured.txt> <out.jsonl> [workers]
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import {
  parseArgs, makeStats, Session, openBranchPage, clickMore,
  parseGridRows, findNextButton, clickNext,
} from "./proni-detail-quick-scan.mjs";

const UNCAPTURED = process.argv[2];
const OUT = process.argv[3];
const WORKERS = Number(process.argv[4] || 5);

function buildOptions() {
  const o = parseArgs([]);
  o.httpClient = "https-agent";
  o.httpAgent = new HttpsAgent({ keepAlive: true, maxSockets: WORKERS + 2, keepAliveMsecs: 10000, scheduling: "lifo" });
  o.maxPagesPerBranch = 100000;
  o.maxRetries = 3;
  o.timeoutMs = 30000;
  o.backoffMs = 1000;
  o.maxCooldownMs = 15000;
  o.errorWindowMs = 15000;
  o.errorBurstThreshold = 8;
  o.stopOnBlocked = true;
  return o;
}
const writers = { failures: { write: async () => {} }, mismatches: { write: async () => {} } };

const inclusivePath = (parent) => {
  if (!parent || parent === "(top)") return [];
  const parts = parent.split("/");
  const out = [];
  for (let i = 1; i <= parts.length; i += 1) out.push(parts.slice(0, i).join("/"));
  return out;
};
const letterOf = (ref) => (String(ref).match(/[A-Za-z]/)?.[0] || String(ref)[0] || "").toUpperCase();

// Resume: skip refs already captured in a prior run.
const seen = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { seen.add(JSON.parse(t).ref); } catch { /* ignore */ }
  }
}

const groups = new Map();
let total = 0;
for (const line of readFileSync(UNCAPTURED, "utf8").split(/\n/)) {
  const ref = line.trim();
  if (!ref || seen.has(ref)) continue;
  const parent = ref.split("/").slice(0, -1).join("/") || "(top)";
  if (!groups.has(parent)) groups.set(parent, []);
  groups.get(parent).push(ref);
  total += 1;
}
const queue = [...groups.entries()];
console.error(`gap-closer: ${total} refs (skipped ${seen.size} already done) in ${queue.length} parent groups, ${WORKERS} workers`);

let qi = 0, doneParents = 0, captured = 0, notfound = 0, errors = 0;
const writeRec = (rec) => appendFileSync(OUT, JSON.stringify(rec) + "\n");

async function worker(id) {
  const stats = makeStats();
  const session = new Session(`gap${id}`, buildOptions(), writers, stats);
  while (qi < queue.length) {
    const [parent, want] = queue[qi++];
    const remaining = new Set(want);
    try {
      let html = await openBranchPage(session, { letter: letterOf(want[0]), path: inclusivePath(parent), page: 1, branchKey: parent });
      for (let page = 1; page <= session.options.maxPagesPerBranch && remaining.size; page += 1) {
        const byRef = new Map(parseGridRows(html).map((r) => [r.ResultsSelect?.value, r]));
        for (const ref of [...remaining]) {
          const gr = byRef.get(ref);
          if (!gr || !gr.ResultsView) continue;
          try {
            const d = await clickMore(session, html, gr, ref);
            if (d.matched) {
              writeRec({
                ref, description: d.fields.description || "", access: d.fields.access || "",
                digitalRecord: d.fields.digitalRecord || "", level: d.fields.level || "",
                title: d.fields.title || "", dates: d.fields.dates || "",
              });
              captured += 1;
            } else notfound += 1;
          } catch { errors += 1; }
          remaining.delete(ref);
        }
        if (!remaining.size) break;
        const next = findNextButton(html);
        if (!next) break;
        html = await clickNext(session, html, next);
      }
    } catch { errors += remaining.size; }
    notfound += remaining.size;
    doneParents += 1;
    if (doneParents % 200 === 0) console.error(`  ${doneParents}/${queue.length} parents | captured=${captured} notfound=${notfound} errors=${errors} req=${stats.requests}`);
  }
}

await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
console.error(`DONE: parents=${doneParents} captured=${captured} notfound=${notfound} errors=${errors}`);
