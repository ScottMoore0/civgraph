#!/usr/bin/env node
/*
 * Gap-closer (DFS) for the description re-scrape: fetches catalogue records the
 * fold DFS run did not reach (mostly leaf items the discovery index missed).
 *
 * Efficient traversal: group uncaptured refs by LETTER, and for each letter walk
 * its browse tree ONCE — descending only into branches that are ancestors of a
 * wanted ref, and clickMoring any wanted ref (item or container) found on a
 * listing (matched by ResultsSelect.value). Every listing early-exits once all
 * its expected in-scope children have been seen, so we never page a listing
 * further than needed. This pays the (expensive) letter-listing navigation once
 * per letter instead of once per parent — ~70x fewer requests than a per-parent
 * re-walk, so the record rate is bounded by clickMores, not navigation.
 *
 * Resumable: refs already in the output are skipped.
 * usage: node scripts/proni-gap-closer.mjs <uncaptured.txt> <out.jsonl> [workers]
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import {
  parseArgs, makeStats, Session, startBrowseLetter, clickSelect,
  clickNext, parseGridRows, findNextButton, clickMore,
} from "./proni-detail-quick-scan.mjs";

const UNCAPTURED = process.argv[2];
const OUT = process.argv[3];
const WORKERS = Number(process.argv[4] || 6);

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
const letterOf = (ref) => (String(ref).match(/[A-Za-z]/)?.[0] || String(ref)[0] || "").toUpperCase();
const parentOf = (ref) => { const p = ref.split("/"); return p.length > 1 ? p.slice(0, -1).join("/") : ""; };

// Resume
const seen = new Set();
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, "utf8").split(/\n/)) {
    const t = l.trim();
    if (t) try { seen.add(JSON.parse(t).ref); } catch { /* ignore */ }
  }
}

// Group by TOP-LEVEL FOND (unit of parallel work): wanted (to capture) + descend
// (ancestor branches to walk through). Per-fond units spread a big letter's work
// across workers, and there are far fewer fonds than parents so the letter-listing
// navigation to reach each fond is paid few times, not 6,050 times.
const byFond = new Map();
let total = 0;
for (const line of readFileSync(UNCAPTURED, "utf8").split(/\n/)) {
  const ref = line.trim();
  if (!ref || seen.has(ref)) continue;
  const fond = ref.split("/")[0];
  if (!byFond.has(fond)) byFond.set(fond, { letter: letterOf(ref), wanted: new Set(), descend: new Set() });
  const g = byFond.get(fond);
  g.wanted.add(ref);
  const parts = ref.split("/");
  for (let i = 1; i < parts.length; i += 1) g.descend.add(parts.slice(0, i).join("/"));
  total += 1;
}
// Bigger fonds first so the long poles start early
const queue = [...byFond.entries()].sort((a, b) => b[1].wanted.size - a[1].wanted.size);
console.error(`gap-closer-dfs: ${total} refs (skipped ${seen.size}) across ${queue.length} fonds, ${WORKERS} workers`);

let captured = 0, notfound = 0, errors = 0, qi = 0;
const writeRec = (r) => appendFileSync(OUT, JSON.stringify(r) + "\n");

async function walk(session, listingHtml, branchRef, g, childrenByParent, capset, MAXP) {
  const expected = childrenByParent.get(branchRef) || new Set();
  const found = new Set();
  const toDescend = [];
  let cur = listingHtml;
  for (let page = 1; page <= MAXP; page += 1) {
    for (const row of parseGridRows(cur)) {
      const ref = row.ResultsSelect?.value;
      if (!ref || !expected.has(ref) || found.has(ref)) continue;
      found.add(ref);
      if (g.wanted.has(ref) && !capset.has(ref) && row.ResultsView && !row.ResultsView.disabled) {
        try {
          const d = await clickMore(session, cur, row, ref);
          if (d.matched) {
            writeRec({ ref, description: d.fields.description || "", access: d.fields.access || "", digitalRecord: d.fields.digitalRecord || "", level: d.fields.level || "", title: d.fields.title || "", dates: d.fields.dates || "" });
            captured += 1;
          } else notfound += 1;
          capset.add(ref);
        } catch { errors += 1; capset.add(ref); }
      }
      if (g.descend.has(ref) && row.ResultsSelect && !row.ResultsSelect.disabled) toDescend.push({ row, pageHtml: cur });
    }
    if (found.size >= expected.size) break;          // all in-scope children on this listing seen
    const next = findNextButton(cur);
    if (!next) break;
    try { cur = await clickNext(session, cur, next); } catch { break; }
  }
  for (const { row, pageHtml } of toDescend) {
    try {
      const childHtml = await clickSelect(session, pageHtml, row);
      await walk(session, childHtml, row.ResultsSelect.value, g, childrenByParent, capset, MAXP);
    } catch { errors += 1; }
  }
}

async function worker(id) {
  const stats = makeStats();
  const session = new Session(`gap${id}`, buildOptions(), writers, stats);
  const MAXP = session.options.maxPagesPerBranch;
  while (qi < queue.length) {
    const [fond, g] = queue[qi++];
    // childrenByParent (over wanted ∪ descend): '' = this fond on the letter listing
    const childrenByParent = new Map();
    for (const r of new Set([...g.wanted, ...g.descend])) {
      const p = parentOf(r);
      if (!childrenByParent.has(p)) childrenByParent.set(p, new Set());
      childrenByParent.get(p).add(r);
    }
    const capset = new Set();
    try {
      const html = await startBrowseLetter(session, g.letter);
      await walk(session, html, "", g, childrenByParent, capset, MAXP);
    } catch { errors += g.wanted.size; }
    if (qi % 25 === 0 || g.wanted.size > 300) console.error(`  ${qi}/${queue.length} fonds | last ${fond} (wanted=${g.wanted.size}) | captured=${captured} notfound=${notfound} errors=${errors} req=${stats.requests}`);
  }
}

await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
console.error(`DONE: captured=${captured} notfound=${notfound} errors=${errors}`);
