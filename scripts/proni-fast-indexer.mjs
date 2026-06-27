#!/usr/bin/env node
/*
 * Fast PRONI eCatalogue Browse indexer.
 *
 * This is a separate hot path from scripts/proni-browse-corpus-crawler.ps1.
 * It keeps record discovery/indexing separate from full detail capture and can
 * optionally snapshot pages first, then parse those snapshots locally.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const BASE = "https://apps.proni.gov.uk/eCatNI_IE/";
const DEFAULT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function parseArgs(argv) {
  const out = {
    mode: "index",
    outDir: "",
    letters: "",
    allLetters: false,
    branchPath: "",
    manifest: "",
    snapshots: false,
    stopOnBlocked: true,
    allowUnbounded: false,
    workers: 8,
    globalRps: 0,
    workerRps: 24,
    maxGlobalRps: 0,
    maxRecords: 0,
    maxBranches: 0,
    maxPagesPerBranch: 50,
    maxRetries: 2,
    timeoutMs: 12000,
    backoffMs: 1500,
    queueHighWater: 10000,
    detailSample: 0,
    partition: "in-session",
    adaptive: true,
    localParseGlob: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const take = () => {
      i += 1;
      return next;
    };
    switch (key) {
      case "mode": out.mode = take(); break;
      case "out-dir": out.outDir = take(); break;
      case "letters": out.letters = take(); break;
      case "all-letters": out.allLetters = true; break;
      case "branch-path": out.branchPath = take(); break;
      case "manifest": out.manifest = take(); break;
      case "snapshots": out.snapshots = true; break;
      case "no-snapshots": out.snapshots = false; break;
      case "stop-on-blocked": out.stopOnBlocked = true; break;
      case "no-stop-on-blocked": out.stopOnBlocked = false; break;
      case "allow-unbounded": out.allowUnbounded = true; break;
      case "workers": out.workers = Number(take()); break;
      case "global-rps": out.globalRps = Number(take()); break;
      case "worker-rps": out.workerRps = Number(take()); break;
      case "max-global-rps": out.maxGlobalRps = Number(take()); break;
      case "max-records": out.maxRecords = Number(take()); break;
      case "max-branches": out.maxBranches = Number(take()); break;
      case "max-pages-per-branch": out.maxPagesPerBranch = Number(take()); break;
      case "max-retries": out.maxRetries = Number(take()); break;
      case "timeout-ms": out.timeoutMs = Number(take()); break;
      case "backoff-ms": out.backoffMs = Number(take()); break;
      case "queue-high-water": out.queueHighWater = Number(take()); break;
      case "detail-sample": out.detailSample = Number(take()); break;
      case "partition": out.partition = take(); break;
      case "adaptive": out.adaptive = true; break;
      case "no-adaptive": out.adaptive = false; break;
      case "local-parse-glob": out.localParseGlob = take(); break;
      case "help": out.help = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function usage() {
  return `Usage:
  node scripts/proni-fast-indexer.mjs --mode index --all-letters --out-dir D:\\PRONI\\eCatalogue\\crawler-probes\\fast-index --max-records 1000
  node scripts/proni-fast-indexer.mjs --mode discover --letters A,B --snapshots --out-dir D:\\PRONI\\eCatalogue\\crawler-probes\\discover
  node scripts/proni-fast-indexer.mjs --mode local-index --manifest D:\\...\\discovery-pages.jsonl --out-dir D:\\...\\local-index
  node scripts/proni-fast-indexer.mjs --mode probe --letters A --out-dir D:\\...\\probe

Modes:
  index       Browse traversal and record row indexing.
  discover    Branch/page discovery without full detail capture.
  local-index Parse saved HTML snapshots from discovery-pages.jsonl.
  probe       Small endpoint/page-size/direct-link probe.

This tool is intentionally bounded by --max-records / --max-branches for live probes.
Use --allow-unbounded only for an intentional full Browse-tree run.
`;
}

function nowIso() {
  return new Date().toISOString();
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripHtml(html = "") {
  return decodeHtml(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getTagAttribute(tag, name) {
  const rx = new RegExp(`${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, "i");
  const m = String(tag).match(rx);
  return m ? decodeHtml(m[2]) : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeSafeName(value) {
  return String(value || "root")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

function branchKey(branch) {
  return `${branch.letter}|${branch.path.join(">")}`;
}

function parseBranchKey(key) {
  const [letter, rest = ""] = String(key).split("|", 2);
  const refs = rest ? rest.split(">").filter(Boolean) : [];
  return { letter, path: refs, depth: refs.length, ref: refs.at(-1) || `letter:${letter}` };
}

function parseInputs(html) {
  const params = new URLSearchParams();
  for (const m of String(html).matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = getTagAttribute(tag, "name");
    if (!name) continue;
    const type = getTagAttribute(tag, "type").toLowerCase();
    if (type === "submit" || type === "button" || type === "image") continue;
    params.set(name, getTagAttribute(tag, "value"));
  }
  for (const m of String(html).matchAll(/<textarea\b[^>]*name\s*=\s*(['"])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    params.set(decodeHtml(m[2]), stripHtml(m[3]));
  }
  return params;
}

function buildPostBody(html, extra = {}) {
  const body = parseInputs(html);
  for (const [key, value] of Object.entries(extra)) {
    body.set(key, value ?? "");
  }
  return body;
}

function parseGridRows(html) {
  const map = new Map();
  for (const m of String(html).matchAll(/<input\b[^>]*GridView1\$ctl(\d+)\$(ResultsSelect|ResultsView)[^>]*>/gi)) {
    const tag = m[0];
    const ctl = `ctl${m[1]}`;
    const kind = m[2];
    if (!map.has(ctl)) map.set(ctl, { ctl });
    map.get(ctl)[kind] = {
      name: getTagAttribute(tag, "name"),
      value: getTagAttribute(tag, "value"),
      disabled: /\bdisabled\b/i.test(tag),
    };
  }

  for (const tr of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = tr[0];
    const ctlMatch = rowHtml.match(/GridView1\$ctl(\d+)\$/i);
    if (!ctlMatch) continue;
    const ctl = `ctl${ctlMatch[1]}`;
    const row = map.get(ctl);
    if (!row) continue;
    row.text = stripHtml(rowHtml);
  }

  return [...map.values()].sort((a, b) => a.ctl.localeCompare(b.ctl, undefined, { numeric: true }));
}

function findNextButton(html) {
  for (const m of String(html).matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const type = getTagAttribute(tag, "type").toLowerCase();
    if (type !== "submit" || /\bdisabled\b/i.test(tag)) continue;
    const value = getTagAttribute(tag, "value");
    const title = getTagAttribute(tag, "title");
    const cls = getTagAttribute(tag, "class");
    if (!/^Next$/i.test(value) && !/^Next$/i.test(title) && !/\bNextBtn\b/i.test(cls)) continue;
    const name = getTagAttribute(tag, "name");
    if (name) return { name, value };
  }
  return null;
}

function isBlocked(status, text) {
  if (status !== 200) return true;
  return /Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl/i.test(String(text));
}

function blockedReason(status, text) {
  if (status !== 200) return `http ${status}`;
  if (/Request Rejected|support ID/i.test(text)) return "waf request rejected";
  if (/Access Denied/i.test(text)) return "access denied text";
  if (/Too Many Requests|rate limit|throttl/i.test(text)) return "rate-limit text";
  return "blocked response text";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class JsonlWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
  }

  write(value) {
    this.stream.write(`${JSON.stringify(value)}\n`);
  }

  async close() {
    await new Promise((resolve, reject) => {
      this.stream.end((err) => (err ? reject(err) : resolve()));
    });
  }
}

class TokenBucket {
  constructor(ratePerSecond) {
    this.interval = ratePerSecond > 0 ? 1000 / ratePerSecond : 0;
    this.nextAt = 0;
  }

  async wait() {
    if (!this.interval) return;
    const now = performance.now();
    if (this.nextAt > now) await sleep(this.nextAt - now);
    const after = performance.now();
    this.nextAt = Math.max(this.nextAt, after) + this.interval;
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  update(headers) {
    const setCookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookie(headers.get("set-cookie"));
    for (const raw of setCookies || []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}

function splitSetCookie(header) {
  if (!header) return [];
  return String(header).split(/,(?=\s*[^;,]+=[^;,]+)/g);
}

class Session {
  constructor(workerId, options, writers, globalBucket) {
    this.workerId = workerId;
    this.options = options;
    this.writers = writers;
    this.jar = new CookieJar();
    this.workerBucket = new TokenBucket(options.workerRps);
    this.globalBucket = globalBucket;
    this.requestCount = 0;
  }

  async request(method, url, body = null, context = "") {
    await this.workerBucket.wait();
    if (this.globalBucket) await this.globalBucket.wait();

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const start = performance.now();
      try {
        const headers = {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 CivgraphPRONIIndexer/1.0",
        };
        const cookie = this.jar.header();
        if (cookie) headers.cookie = cookie;
        if (body) headers["content-type"] = "application/x-www-form-urlencoded";
        const res = await fetch(url, {
          method,
          headers,
          body: body ? body.toString() : undefined,
          signal: controller.signal,
          redirect: "follow",
        });
        const text = await res.text();
        this.jar.update(res.headers);
        this.requestCount += 1;
        const ms = performance.now() - start;
        clearTimeout(timeout);

        if (isBlocked(res.status, text)) {
          const reason = blockedReason(res.status, text);
          this.writers.failures.write({ at: nowIso(), type: "request-blocked", workerId: this.workerId, context, status: res.status, ms: round(ms), reason });
          if (this.options.stopOnBlocked) throw new Error(`${context} failed: ${reason}`);
        }
        return { status: res.status, text, ms };
      } catch (error) {
        clearTimeout(timeout);
        attempt += 1;
        const message = error?.name === "AbortError" ? "timeout" : String(error?.message || error);
        this.writers.failures.write({ at: nowIso(), type: "request-error", workerId: this.workerId, context, attempt, error: message });
        if (attempt > this.options.maxRetries) throw error;
        await sleep(this.options.backoffMs * attempt);
      }
    }
  }

  get(url, context) {
    return this.request("GET", url, null, context);
  }

  post(url, html, extra, context) {
    return this.request("POST", url, buildPostBody(html, extra), context);
  }
}

function round(value, decimals = 3) {
  return Math.round(value * (10 ** decimals)) / (10 ** decimals);
}

async function startBrowseLetter(session, letter) {
  const search = await session.get(`${BASE}SearchPage.aspx`, "SearchPage");
  const browse = await session.post(`${BASE}SearchPage.aspx`, search.text, {
    "__EVENTTARGET": "ctl00$siteNav1$linkBtnBrowse",
    "__EVENTARGUMENT": "",
  }, "Browse nav");
  const letterHtml = await session.post(`${BASE}BrowseSearchPage.aspx`, browse.text, {
    [`ctl00$ContentPlaceHolder1$AZButton_${letter}`]: letter,
  }, `Letter ${letter}`);
  return letterHtml.text;
}

async function clickSelect(session, html, row) {
  if (!row.ResultsSelect || row.ResultsSelect.disabled) throw new Error(`Row is not selectable: ${row.text || ""}`);
  const res = await session.post(`${BASE}BrowseSearchResults.aspx`, html, {
    [row.ResultsSelect.name]: row.ResultsSelect.value,
  }, `Select ${row.ResultsSelect.value}`);
  return res.text;
}

async function clickMore(session, html, row) {
  if (!row.ResultsView) throw new Error(`Row has no More/View button: ${row.text || ""}`);
  const res = await session.post(`${BASE}BrowseSearchResults.aspx`, html, {
    [row.ResultsView.name]: row.ResultsView.value,
  }, `More ${row.ResultsSelect?.value || row.text || ""}`);
  return res.text;
}

async function clickNext(session, html, next) {
  const res = await session.post(`${BASE}BrowseSearchResults.aspx`, html, {
    [next.name]: next.value,
  }, "Next page");
  return res.text;
}

async function clickSelectByRef(session, html, ref, maxPagesPerBranch) {
  let pageHtml = html;
  for (let page = 1; page <= maxPagesPerBranch; page += 1) {
    const rows = parseGridRows(pageHtml);
    const row = rows.find((candidate) => candidate.ResultsSelect?.value === ref && !candidate.ResultsSelect.disabled);
    if (row) return clickSelect(session, pageHtml, row);
    const next = findNextButton(pageHtml);
    if (!next) break;
    pageHtml = await clickNext(session, pageHtml, next);
  }
  throw new Error(`Could not find selectable branch ${ref}`);
}

async function openBranch(session, branch) {
  let html = await startBrowseLetter(session, branch.letter);
  for (const ref of branch.path) {
    html = await clickSelectByRef(session, html, ref, session.options.maxPagesPerBranch);
  }
  return html;
}

async function ensureOutDir(options) {
  if (!options.outDir) {
    const stamp = nowIso().replace(/[:.]/g, "-");
    options.outDir = path.join("D:\\PRONI\\eCatalogue\\crawler-probes", `fast-index-${stamp}`);
  }
  await fsp.mkdir(options.outDir, { recursive: true });
  if (options.snapshots) await fsp.mkdir(path.join(options.outDir, "page-snapshots"), { recursive: true });
  return options.outDir;
}

function makeWriters(options) {
  return {
    events: new JsonlWriter(path.join(options.outDir, "events.jsonl")),
    failures: new JsonlWriter(path.join(options.outDir, "failures.jsonl")),
    discovery: new JsonlWriter(path.join(options.outDir, "branches-discovered.jsonl")),
    discoveryPages: new JsonlWriter(path.join(options.outDir, "discovery-pages.jsonl")),
    index: new JsonlWriter(path.join(options.outDir, "records-index.jsonl")),
    detailSample: new JsonlWriter(path.join(options.outDir, "detail-sample.jsonl")),
  };
}

async function closeWriters(writers) {
  await Promise.all(Object.values(writers).map((writer) => writer.close()));
}

function seedBranches(options) {
  if (options.branchPath) {
    const parts = options.branchPath.split(",").map((p) => p.trim()).filter(Boolean);
    const letter = (parts[0] || "A").slice(0, 1).toUpperCase();
    return [{ letter, path: parts, depth: parts.length, ref: parts.at(-1) || `letter:${letter}`, text: "" }];
  }
  const letters = options.allLetters
    ? DEFAULT_LETTERS
    : (options.letters ? options.letters.split(",").map((l) => l.trim().toUpperCase()).filter(Boolean) : ["A"]);
  return letters.map((letter) => ({ letter, path: [], depth: 0, ref: `letter:${letter}`, text: "" }));
}

class SharedQueue {
  constructor(initial = []) {
    this.items = [...initial];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  close() {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()(null);
  }

  async shift() {
    if (this.items.length) return this.items.shift();
    if (this.closed) return null;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  shiftNow() {
    if (this.items.length) return this.items.shift();
    return null;
  }

  get length() {
    return this.items.length;
  }
}

async function saveSnapshot(options, branch, pageNumber, html) {
  if (!options.snapshots) return null;
  const key = makeSafeName(`${branchKey(branch)}__p${pageNumber}`);
  const htmlPath = path.join(options.outDir, "page-snapshots", `${key}.html`);
  const metaPath = path.join(options.outDir, "page-snapshots", `${key}.json`);
  const pageHash = sha256(html);
  await fsp.writeFile(htmlPath, html, "utf8");
  await fsp.writeFile(metaPath, JSON.stringify({
    at: nowIso(),
    branchKey: branchKey(branch),
    letter: branch.letter,
    path: branch.path,
    page: pageNumber,
    pageHash,
    htmlPath,
  }, null, 2), "utf8");
  return { htmlPath, metadataPath: metaPath, pageHash };
}

function makeIndexRecord(options, branch, pageNumber, row, pageHash, snapshot, scanLevel) {
  const expected = row.ResultsSelect?.value || "";
  return {
    at: nowIso(),
    scanLevel,
    attributeCompleteness: "listing-only",
    validationStatus: "unvalidated-detail",
    branchKey: branchKey(branch),
    letter: branch.letter,
    path: branch.path,
    page: pageNumber,
    ctl: row.ctl,
    expectedRef: expected,
    proniReference: expected,
    rowText: row.text || "",
    pageHash,
    pageSnapshotPath: snapshot?.htmlPath || "",
    pageSnapshotMetadataPath: snapshot?.metadataPath || "",
    resultsViewName: row.ResultsView?.name || "",
    resultsViewValue: row.ResultsView?.value || "",
    resultsSelectName: row.ResultsSelect?.name || "",
    resultsSelectValue: row.ResultsSelect?.value || "",
  };
}

function shouldStop(stats, options) {
  if (stats.stopRequested) return true;
  if (options.maxRecords > 0 && stats.recordsIndexed >= options.maxRecords) return true;
  if (options.maxBranches > 0 && stats.branchesDiscovered >= options.maxBranches) return true;
  return false;
}

async function discoverBranch(session, branch, queue, state, scanLevel) {
  const options = session.options;
  const key = branchKey(branch);
  if (state.seen.has(key)) return;
  state.seen.add(key);

  const started = performance.now();
  session.writers.events.write({ at: nowIso(), type: "branch-start", workerId: session.workerId, branchKey: key, path: branch.path, letter: branch.letter });

  let html = await openBranch(session, branch);
  let pageNumber = 1;
  let leafRowCount = 0;
  const childBranches = [];

  while (pageNumber <= options.maxPagesPerBranch && !shouldStop(state.stats, options)) {
    const rows = parseGridRows(html);
    const selectable = rows.filter((row) => row.ResultsSelect && !row.ResultsSelect.disabled);
    const leafRows = rows.filter((row) => row.ResultsView && (!row.ResultsSelect || row.ResultsSelect.disabled));
    const pageHash = sha256(html);
    const snapshot = await saveSnapshot(options, branch, pageNumber, html);
    const next = findNextButton(html);

    for (const row of selectable) {
      if (!row.ResultsSelect?.value) continue;
      const childPath = [...branch.path, row.ResultsSelect.value];
      const child = {
        letter: branch.letter,
        path: childPath,
        depth: childPath.length,
        ref: row.ResultsSelect.value,
        parentKey: key,
        text: row.text || "",
      };
      childBranches.push(child);
      if (options.partition === "hybrid" && state.queueLength < options.queueHighWater) {
        state.queueLength += 1;
        queue.push(child);
      }
    }

    session.writers.discoveryPages.write({
      at: nowIso(),
      scanLevel: "branch-discovery-page",
      workerId: session.workerId,
      branchKey: key,
      letter: branch.letter,
      path: branch.path,
      page: pageNumber,
      pageHash,
      rowCount: rows.length,
      selectableBranchCount: selectable.length,
      leafRowCount: leafRows.length,
      hasNext: Boolean(next),
      pageSnapshotPath: snapshot?.htmlPath || "",
      pageSnapshotMetadataPath: snapshot?.metadataPath || "",
    });

    leafRowCount += leafRows.length;
    if (scanLevel === "discover-index" || scanLevel === "index") {
      for (const row of leafRows) {
        if (shouldStop(state.stats, options)) break;
        session.writers.index.write(makeIndexRecord(options, branch, pageNumber, row, pageHash, snapshot, scanLevel));
        state.stats.recordsIndexed += 1;
        if (options.detailSample > 0 && state.stats.detailSamples < options.detailSample) {
          await sampleDetail(session, html, branch, pageNumber, row, state);
        }
      }
    }

    if (!next || shouldStop(state.stats, options)) break;
    html = await clickNext(session, html, next);
    pageNumber += 1;
  }

  state.stats.branchesDiscovered += 1;
  session.writers.discovery.write({
    at: nowIso(),
    scanLevel: "branch-discovery",
    workerId: session.workerId,
    branchKey: key,
    letter: branch.letter,
    path: branch.path,
    depth: branch.path.length,
    pageCount: pageNumber,
    leafRowCount,
    childBranchCount: childBranches.length,
    childRefs: childBranches.map((child) => child.ref),
    elapsedMs: round(performance.now() - started),
  });

  session.writers.events.write({
    at: nowIso(),
    type: "branch-complete",
    workerId: session.workerId,
    branchKey: key,
    pages: pageNumber,
    leafRowCount,
    childBranchCount: childBranches.length,
    elapsedMs: round(performance.now() - started),
  });

  if (options.partition !== "hybrid") {
    for (const child of childBranches) {
      if (shouldStop(state.stats, options)) break;
      await discoverBranch(session, child, queue, state, scanLevel);
    }
  }
}

async function discoverBranchInSession(session, branch, html, state, scanLevel) {
  const options = session.options;
  const key = branchKey(branch);
  if (state.seen.has(key) || shouldStop(state.stats, options)) return;
  state.seen.add(key);

  const started = performance.now();
  session.writers.events.write({ at: nowIso(), type: "branch-start", workerId: session.workerId, branchKey: key, path: branch.path, letter: branch.letter, strategy: "in-session" });

  let pageHtml = html;
  let pageNumber = 1;
  let leafRowCount = 0;
  const childTasks = [];

  while (pageNumber <= options.maxPagesPerBranch && !shouldStop(state.stats, options)) {
    const rows = parseGridRows(pageHtml);
    const selectable = rows.filter((row) => row.ResultsSelect && !row.ResultsSelect.disabled);
    const leafRows = rows.filter((row) => row.ResultsView && (!row.ResultsSelect || row.ResultsSelect.disabled));
    const pageHash = sha256(pageHtml);
    const snapshot = await saveSnapshot(options, branch, pageNumber, pageHtml);
    const next = findNextButton(pageHtml);

    for (const row of selectable) {
      if (!row.ResultsSelect?.value) continue;
      const childPath = [...branch.path, row.ResultsSelect.value];
      childTasks.push({
        branch: {
          letter: branch.letter,
          path: childPath,
          depth: childPath.length,
          ref: row.ResultsSelect.value,
          parentKey: key,
          text: row.text || "",
        },
        row,
        parentHtml: pageHtml,
      });
    }

    session.writers.discoveryPages.write({
      at: nowIso(),
      scanLevel: "branch-discovery-page",
      workerId: session.workerId,
      branchKey: key,
      letter: branch.letter,
      path: branch.path,
      page: pageNumber,
      pageHash,
      rowCount: rows.length,
      selectableBranchCount: selectable.length,
      leafRowCount: leafRows.length,
      hasNext: Boolean(next),
      pageSnapshotPath: snapshot?.htmlPath || "",
      pageSnapshotMetadataPath: snapshot?.metadataPath || "",
    });

    leafRowCount += leafRows.length;
    if (scanLevel === "discover-index" || scanLevel === "index") {
      for (const row of leafRows) {
        if (shouldStop(state.stats, options)) break;
        session.writers.index.write(makeIndexRecord(options, branch, pageNumber, row, pageHash, snapshot, scanLevel));
        state.stats.recordsIndexed += 1;
        if (options.detailSample > 0 && state.stats.detailSamples < options.detailSample) {
          await sampleDetail(session, pageHtml, branch, pageNumber, row, state);
        }
      }
    }

    if (!next || shouldStop(state.stats, options)) break;
    pageHtml = await clickNext(session, pageHtml, next);
    pageNumber += 1;
  }

  state.stats.branchesDiscovered += 1;
  session.writers.discovery.write({
    at: nowIso(),
    scanLevel: "branch-discovery",
    workerId: session.workerId,
    branchKey: key,
    letter: branch.letter,
    path: branch.path,
    depth: branch.path.length,
    pageCount: pageNumber,
    leafRowCount,
    childBranchCount: childTasks.length,
    childRefs: childTasks.map((task) => task.branch.ref),
    elapsedMs: round(performance.now() - started),
    strategy: "in-session",
  });

  session.writers.events.write({
    at: nowIso(),
    type: "branch-complete",
    workerId: session.workerId,
    branchKey: key,
    pages: pageNumber,
    leafRowCount,
    childBranchCount: childTasks.length,
    elapsedMs: round(performance.now() - started),
    strategy: "in-session",
  });

  for (const task of childTasks) {
    if (shouldStop(state.stats, options)) break;
    const childKey = branchKey(task.branch);
    if (state.seen.has(childKey)) continue;
    try {
      const childHtml = await clickSelect(session, task.parentHtml, task.row);
      await discoverBranchInSession(session, task.branch, childHtml, state, scanLevel);
    } catch (error) {
      session.writers.failures.write({ at: nowIso(), type: "in-session-child-error", workerId: session.workerId, branchKey: childKey, error: String(error?.message || error) });
      if (options.stopOnBlocked) {
        state.stats.stopRequested = true;
        break;
      }
      const childHtml = await openBranch(session, task.branch);
      await discoverBranchInSession(session, task.branch, childHtml, state, scanLevel);
    }
  }
}

async function sampleDetail(session, html, branch, pageNumber, row, state) {
  try {
    const detailHtml = await clickMore(session, html, row);
    state.stats.detailSamples += 1;
    session.writers.detailSample.write({
      at: nowIso(),
      branchKey: branchKey(branch),
      page: pageNumber,
      expectedRef: row.ResultsSelect?.value || "",
      rowText: row.text || "",
      detailTitle: extractDetailValue(detailHtml, "Title"),
      detailProniReference: extractDetailValue(detailHtml, "PRONI Reference"),
      detailAttributeKeys: extractDetailKeys(detailHtml),
    });
  } catch (error) {
    session.writers.failures.write({ at: nowIso(), type: "detail-sample-error", workerId: session.workerId, branchKey: branchKey(branch), page: pageNumber, error: String(error?.message || error) });
  }
}

function extractDetailValue(html, label) {
  for (const tr of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = tr[0];
    const labelMatch = rowHtml.match(/<label\b[^>]*>([\s\S]*?)<\/label>/i);
    if (!labelMatch) continue;
    const key = stripHtml(labelMatch[1]).replace(/:$/, "").trim();
    if (key.toLowerCase() !== label.toLowerCase()) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripHtml(m[1])).filter(Boolean);
    return cells.length >= 2 ? cells.slice(1).join(" ").trim() : "";
  }
  return "";
}

function extractDetailKeys(html) {
  const keys = [];
  for (const tr of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const labelMatch = tr[0].match(/<label\b[^>]*>([\s\S]*?)<\/label>/i);
    if (labelMatch) keys.push(stripHtml(labelMatch[1]).replace(/:$/, "").trim());
  }
  return keys;
}

async function runLive(options, writers, scanLevel) {
  const roots = seedBranches(options);
  const queue = new SharedQueue(roots);
  const globalBucket = options.globalRps > 0 ? new TokenBucket(options.globalRps) : null;
  const state = {
    seen: new Set(),
    queueLength: roots.length,
    stats: {
      startedAt: nowIso(),
      startedMs: performance.now(),
      recordsIndexed: 0,
      branchesDiscovered: 0,
      detailSamples: 0,
      stopRequested: false,
    },
  };

  const progressTimer = setInterval(() => {
    const elapsed = Math.max(0.001, (performance.now() - state.stats.startedMs) / 1000);
    writers.events.write({
      at: nowIso(),
      type: "progress",
      recordsIndexed: state.stats.recordsIndexed,
      branchesDiscovered: state.stats.branchesDiscovered,
      queueLength: queue.length,
      rowsPerSecond: round(state.stats.recordsIndexed / elapsed, 2),
    });
  }, 10000);

  async function worker(workerId) {
    const session = new Session(workerId, options, writers, globalBucket);
    while (!shouldStop(state.stats, options)) {
      const branch = options.partition === "hybrid" ? await queue.shift() : queue.shiftNow();
      state.queueLength = Math.max(0, state.queueLength - 1);
      if (!branch) break;
      try {
        if (options.partition === "in-session") {
          const html = branch.path.length ? await openBranch(session, branch) : await startBrowseLetter(session, branch.letter);
          await discoverBranchInSession(session, branch, html, state, scanLevel);
        } else {
          await discoverBranch(session, branch, queue, state, scanLevel);
        }
      } catch (error) {
        writers.failures.write({ at: nowIso(), type: "branch-error", workerId, branchKey: branchKey(branch), error: String(error?.message || error) });
        if (options.stopOnBlocked) {
          state.stats.stopRequested = true;
          queue.close();
          break;
        }
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.max(1, options.workers); i += 1) workers.push(worker(i + 1));
  await Promise.all(workers);
  queue.close();
  clearInterval(progressTimer);

  const elapsedSeconds = Math.max(0.001, (performance.now() - state.stats.startedMs) / 1000);
  return {
    mode: options.mode,
    partition: options.partition,
    workers: options.workers,
    workerRps: options.workerRps,
    globalRps: options.globalRps,
    maxRecords: options.maxRecords,
    maxBranches: options.maxBranches,
    recordsIndexed: state.stats.recordsIndexed,
    branchesDiscovered: state.stats.branchesDiscovered,
    detailSamples: state.stats.detailSamples,
    elapsedSeconds: round(elapsedSeconds),
    rowsPerSecond: round(state.stats.recordsIndexed / elapsedSeconds, 2),
    branchesPerSecond: round(state.stats.branchesDiscovered / elapsedSeconds, 2),
    outputDir: options.outDir,
  };
}

async function runLocalIndex(options, writers) {
  if (!options.manifest) throw new Error("--manifest is required for --mode local-index");
  const started = performance.now();
  let pages = 0;
  let records = 0;
  const lines = (await fsp.readFile(options.manifest, "utf8")).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const page = JSON.parse(line);
    const htmlPath = page.pageSnapshotPath || page.htmlPath;
    if (!htmlPath) continue;
    let html = "";
    try {
      html = await fsp.readFile(htmlPath, "utf8");
    } catch (error) {
      writers.failures.write({ at: nowIso(), type: "local-snapshot-missing", htmlPath, error: String(error?.message || error) });
      continue;
    }
    const rows = parseGridRows(html);
    const leafRows = rows.filter((row) => row.ResultsView && (!row.ResultsSelect || row.ResultsSelect.disabled));
    const branch = { letter: page.letter, path: page.path || [], depth: (page.path || []).length, ref: (page.path || []).at(-1) || `letter:${page.letter}` };
    const snapshot = { htmlPath, metadataPath: page.pageSnapshotMetadataPath || "", pageHash: page.pageHash || sha256(html) };
    for (const row of leafRows) {
      writers.index.write(makeIndexRecord(options, branch, Number(page.page || 1), row, snapshot.pageHash, snapshot, "local-index"));
      records += 1;
      if (options.maxRecords > 0 && records >= options.maxRecords) break;
    }
    pages += 1;
    if (options.maxRecords > 0 && records >= options.maxRecords) break;
  }
  const elapsedSeconds = Math.max(0.001, (performance.now() - started) / 1000);
  return {
    mode: "local-index",
    pagesParsed: pages,
    recordsIndexed: records,
    elapsedSeconds: round(elapsedSeconds),
    rowsPerSecond: round(records / elapsedSeconds, 2),
    outputDir: options.outDir,
  };
}

async function runProbe(options, writers) {
  const session = new Session(1, options, writers, options.globalRps > 0 ? new TokenBucket(options.globalRps) : null);
  const letter = seedBranches(options)[0]?.letter || "A";
  const html = await startBrowseLetter(session, letter);
  const rows = parseGridRows(html);
  const controls = {
    hasNext: Boolean(findNextButton(html)),
    inputNames: [...parseInputs(html).keys()].filter((name) => /page|size|GridView|DropDown|ddl/i.test(name)).slice(0, 100),
    selectableRows: rows.filter((row) => row.ResultsSelect && !row.ResultsSelect.disabled).length,
    leafRows: rows.filter((row) => row.ResultsView && (!row.ResultsSelect || row.ResultsSelect.disabled)).length,
  };
  const pageSizeCandidates = controls.inputNames.filter((name) => /size|page/i.test(name));
  const report = {
    at: nowIso(),
    mode: "probe",
    letter,
    pageHash: sha256(html),
    rowCount: rows.length,
    controls,
    pageSizeCandidates,
    note: "If no page-size controls are listed, Browse grid page-size is likely fixed server-side.",
  };
  await fsp.writeFile(path.join(options.outDir, "endpoint-page-size-probe.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!["index", "discover", "local-index", "probe"].includes(options.mode)) throw new Error(`Unsupported mode: ${options.mode}`);
  if (options.mode !== "local-index" && options.maxRecords <= 0 && options.maxBranches <= 0 && !options.allowUnbounded) {
    throw new Error("Live modes require --max-records or --max-branches so probes stay bounded. Use --allow-unbounded only for an intentional full Browse-tree run.");
  }
  await ensureOutDir(options);
  await fsp.writeFile(path.join(options.outDir, "run-config.json"), JSON.stringify(options, null, 2), "utf8");
  const writers = makeWriters(options);
  let summary;
  try {
    if (options.mode === "local-index") summary = await runLocalIndex(options, writers);
    else if (options.mode === "probe") summary = await runProbe(options, writers);
    else summary = await runLive(options, writers, options.mode === "discover" ? "discover" : "discover-index");
  } finally {
    await closeWriters(writers);
  }
  await fsp.writeFile(path.join(options.outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
