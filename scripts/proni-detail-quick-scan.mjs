#!/usr/bin/env node
/*
 * PRONI eCatalogue detail quick scanner.
 *
 * Input: a listing index from scripts/proni-fast-indexer.mjs.
 * Output: validated record-detail JSONL under D:\PRONI\...
 *
 * Correctness rule: rows are processed sequentially within a listing page/session.
 * The probe results showed concurrent More posts from the same listing page can
 * return HTTP 200 with the wrong detail record.
 */

import { createReadStream, createWriteStream } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline";

const BASE = "https://apps.proni.gov.uk/eCatNI_IE/";
const USER_AGENT = "Mozilla/5.0 CivgraphPRONIDetailQuickScan/1.0";

function parseArgs(argv) {
  const out = {
    index: "D:\\PRONI\\eCatalogue\\full-index\\proni-full-index-stable-20260627-220029\\records-index.jsonl",
    outDir: "",
    maxRecords: 1000,
    maxGroups: 0,
    initialWorkers: 24,
    maxWorkers: 64,
    rampWorkers: 8,
    rampEveryMs: 8000,
    maxPagesPerBranch: 250000,
    maxRetries: 2,
    maxGroupRetries: 3,
    retryMismatches: 2,
    timeoutMs: 30000,
    backoffMs: 750,
    stopOnBlocked: true,
    adaptive: true,
    progressEveryMs: 5000,
    writerFlushRows: 100,
    writerFlushMs: 1000,
    maxCooldownMs: 15000,
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
      case "index": out.index = take(); break;
      case "out-dir": out.outDir = take(); break;
      case "max-records": out.maxRecords = Number(take()); break;
      case "max-groups": out.maxGroups = Number(take()); break;
      case "initial-workers": out.initialWorkers = Number(take()); break;
      case "max-workers": out.maxWorkers = Number(take()); break;
      case "ramp-workers": out.rampWorkers = Number(take()); break;
      case "ramp-every-ms": out.rampEveryMs = Number(take()); break;
      case "max-pages-per-branch": out.maxPagesPerBranch = Number(take()); break;
      case "max-retries": out.maxRetries = Number(take()); break;
      case "max-group-retries": out.maxGroupRetries = Number(take()); break;
      case "retry-mismatches": out.retryMismatches = Number(take()); break;
      case "timeout-ms": out.timeoutMs = Number(take()); break;
      case "backoff-ms": out.backoffMs = Number(take()); break;
      case "stop-on-blocked": out.stopOnBlocked = true; break;
      case "no-stop-on-blocked": out.stopOnBlocked = false; break;
      case "adaptive": out.adaptive = true; break;
      case "no-adaptive": out.adaptive = false; break;
      case "progress-every-ms": out.progressEveryMs = Number(take()); break;
      case "writer-flush-rows": out.writerFlushRows = Number(take()); break;
      case "writer-flush-ms": out.writerFlushMs = Number(take()); break;
      case "max-cooldown-ms": out.maxCooldownMs = Number(take()); break;
      case "help": out.help = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function usage() {
  return `Usage:
  node scripts/proni-detail-quick-scan.mjs --index D:\\...\\records-index.jsonl --out-dir D:\\PRONI\\eCatalogue\\detail-scans\\run --max-records 2000

Key options:
  --initial-workers 24       Starting listing-page/session workers.
  --max-workers 64           Maximum workers after adaptive ramp.
  --max-records 1000         Bounded records; use 0 for a full run.
  --max-groups 0             Optional group cap for testing.
  --max-group-retries 3      Requeue transient listing-page failures.
  --max-cooldown-ms 15000    Shared backoff ceiling after network errors.
  --no-adaptive              Disable worker ramp.
`;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getTagAttribute(tag, name) {
  const m = String(tag).match(new RegExp(`${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, "i"));
  return m ? decodeHtml(m[2]) : "";
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
  for (const [key, value] of Object.entries(extra)) body.set(key, value ?? "");
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

function extractDetailFields(html) {
  const rawAttributes = {};
  for (const rowMatch of String(html).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const labelMatch = rowHtml.match(/<label\b[^>]*>([\s\S]*?)<\/label>/i);
    if (!labelMatch) continue;
    const key = stripHtml(labelMatch[1]).replace(/:$/, "").trim();
    if (!key) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => stripHtml(cell[1]))
      .filter(Boolean);
    const value = cells.length >= 2 ? cells.slice(1).join(" ").trim() : "";
    if (rawAttributes[key] === undefined) rawAttributes[key] = value;
    else if (Array.isArray(rawAttributes[key])) rawAttributes[key].push(value);
    else rawAttributes[key] = [rawAttributes[key], value];
  }
  return {
    repository: rawAttributes.Repository || "",
    proniReference: rawAttributes["PRONI Reference"] || "",
    level: rawAttributes.Level || "",
    access: rawAttributes.Access || "",
    title: rawAttributes.Title || "",
    dates: rawAttributes.Dates || "",
    description: rawAttributes.Description || "",
    digitalRecord: /^\[?\d+\s*-/.test(rawAttributes["Digital Record"] || "") ? "" : (rawAttributes["Digital Record"] || ""),
    rawAttributeCount: Object.keys(rawAttributes).length,
    attributeKeys: Object.keys(rawAttributes).sort(),
    rawAttributes,
  };
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

function splitSetCookie(header) {
  if (!header) return [];
  return String(header).split(/,(?=\s*[^;,]+=[^;,]+)/g);
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

class BufferedJsonlWriter {
  constructor(filePath, options) {
    this.filePath = filePath;
    this.flushRows = options.writerFlushRows;
    this.buffer = [];
    this.stream = createWriteStream(filePath, { flags: "w", encoding: "utf8" });
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, Math.max(250, options.writerFlushMs));
  }
  write(value) {
    this.buffer.push(`${JSON.stringify(value)}\n`);
    if (this.buffer.length >= this.flushRows) return this.flush();
    return Promise.resolve();
  }
  async flush() {
    if (!this.buffer.length) return;
    const text = this.buffer.join("");
    this.buffer = [];
    if (!this.stream.write(text)) {
      await new Promise((resolve) => this.stream.once("drain", resolve));
    }
  }
  async close() {
    clearInterval(this.timer);
    await this.flush();
    await new Promise((resolve, reject) => {
      this.stream.end((err) => (err ? reject(err) : resolve()));
    });
  }
}

class Session {
  constructor(workerId, options, writers, stats) {
    this.workerId = workerId;
    this.options = options;
    this.writers = writers;
    this.stats = stats;
    this.jar = new CookieJar();
  }
  async request(method, url, body = null, context = "") {
    let attempt = 0;
    while (true) {
      const cooldownMs = Math.max(0, (this.stats.cooldownUntilMs || 0) - performance.now());
      if (cooldownMs > 0) await sleep(cooldownMs);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const started = performance.now();
      try {
        const headers = {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": USER_AGENT,
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
        clearTimeout(timeout);
        const ms = performance.now() - started;
        this.stats.requests += 1;
        this.stats.requestMs.push(ms);
        if (this.stats.requestMs.length > 5000) this.stats.requestMs.splice(0, this.stats.requestMs.length - 5000);
        if (isBlocked(res.status, text)) {
          const reason = blockedReason(res.status, text);
          this.stats.blocked += 1;
          await this.writers.failures.write({
            at: nowIso(),
            type: "request-blocked",
            workerId: this.workerId,
            context,
            status: res.status,
            ms: round(ms),
            reason,
          });
          if (this.options.stopOnBlocked) throw new Error(`${context}: ${reason}`);
          return { ok: false, status: res.status, text, ms, reason };
        }
        return { ok: true, status: res.status, text, ms };
      } catch (error) {
        clearTimeout(timeout);
        attempt += 1;
        const cause = error?.cause?.code || error?.cause?.name || "";
        const message = error?.name === "AbortError" ? "timeout" : [String(error?.message || error), cause].filter(Boolean).join(" / ");
        this.stats.requestErrors += 1;
        const cooldown = Math.min(this.options.maxCooldownMs, Math.max(this.options.backoffMs, this.options.backoffMs * attempt * 3));
        this.stats.cooldownUntilMs = Math.max(this.stats.cooldownUntilMs || 0, performance.now() + cooldown);
        await this.writers.failures.write({
          at: nowIso(),
          type: "request-error",
          workerId: this.workerId,
          context,
          attempt,
          error: message,
        });
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

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return round(sorted[index], 1);
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

async function clickNext(session, html, next) {
  const res = await session.post(`${BASE}BrowseSearchResults.aspx`, html, {
    [next.name]: next.value,
  }, "Next page");
  return res.text;
}

async function clickSelectByRef(session, html, ref, maxPagesPerBranch) {
  let pageHtml = html;
  for (let page = 1; page <= maxPagesPerBranch; page += 1) {
    const row = parseGridRows(pageHtml).find((candidate) => candidate.ResultsSelect?.value === ref && !candidate.ResultsSelect.disabled);
    if (row) return clickSelect(session, pageHtml, row);
    const next = findNextButton(pageHtml);
    if (!next) break;
    pageHtml = await clickNext(session, pageHtml, next);
  }
  throw new Error(`Could not find selectable branch ${ref}`);
}

async function openBranchPage(session, firstRow) {
  let html = await startBrowseLetter(session, firstRow.letter);
  for (const ref of firstRow.path || []) {
    html = await clickSelectByRef(session, html, ref, session.options.maxPagesPerBranch);
  }
  for (let page = 1; page < Number(firstRow.page || 1); page += 1) {
    const next = findNextButton(html);
    if (!next) throw new Error(`Branch ${firstRow.branchKey} has no page ${firstRow.page}`);
    html = await clickNext(session, html, next);
  }
  return html;
}

async function clickMore(session, listingHtml, gridRow, expectedRef) {
  if (!gridRow.ResultsView) throw new Error(`Row has no More button: ${expectedRef}`);
  const response = await session.post(`${BASE}BrowseSearchResults.aspx`, listingHtml, {
    [gridRow.ResultsView.name]: gridRow.ResultsView.value,
  }, `More ${expectedRef}`);
  const fields = extractDetailFields(response.text);
  return {
    expectedRef,
    extractedRef: String(fields.proniReference || ""),
    matched: String(fields.proniReference || "") === String(expectedRef || ""),
    requestMs: response.ms,
    fields,
  };
}

async function readIndexGroups(indexPath, options) {
  const groups = new Map();
  let readRows = 0;
  const rl = readline.createInterface({
    input: createReadStream(indexPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const key = `${row.branchKey}::${row.page}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      branchKey: row.branchKey,
      letter: row.letter,
      path: row.path || [],
      page: Number(row.page || 1),
      ctl: row.ctl,
      expectedRef: row.expectedRef || row.proniReference,
      proniReference: row.proniReference,
    });
    readRows += 1;
    if (options.maxRecords > 0 && readRows >= options.maxRecords) break;
  }

  const groupList = [...groups.values()]
    .map((rows) => rows.sort((a, b) => String(a.ctl).localeCompare(String(b.ctl), undefined, { numeric: true })))
    .sort((a, b) => b.length - a.length);
  return options.maxGroups > 0 ? groupList.slice(0, options.maxGroups) : groupList;
}

function makeStats() {
  return {
    startedAt: nowIso(),
    startedMs: performance.now(),
    groupsLoaded: 0,
    groupsCompleted: 0,
    recordsPlanned: 0,
    detailsFetched: 0,
    mismatches: 0,
    failures: 0,
    retries: 0,
    blocked: 0,
    requestErrors: 0,
    requests: 0,
    requestMs: [],
    activeWorkers: 0,
    desiredWorkers: 0,
    spawnedWorkers: 0,
    cooldownUntilMs: 0,
    completedRefs: new Set(),
    stopped: false,
    stopReason: "",
  };
}

async function processRowWithRetries(groupRows, row, writers, options, stats, workerId) {
  let attempt = 0;
  while (attempt <= options.retryMismatches) {
    const session = new Session(`${workerId}.${attempt + 1}`, options, writers, stats);
    const listingHtml = await openBranchPage(session, groupRows[0]);
    const gridRows = parseGridRows(listingHtml);
    const gridRow = gridRows.find((candidate) => candidate.ResultsSelect?.value === row.expectedRef);
    if (!gridRow) throw new Error(`Could not find row ${row.expectedRef} on ${row.branchKey} page ${row.page}`);
    const detail = await clickMore(session, listingHtml, gridRow, row.expectedRef);
    if (detail.matched) return detail;
    stats.retries += 1;
    await writers.mismatches.write({
      at: nowIso(),
      type: "mismatch-retry",
      workerId,
      attempt: attempt + 1,
      branchKey: row.branchKey,
      page: row.page,
      expectedRef: row.expectedRef,
      extractedRef: detail.extractedRef,
    });
    attempt += 1;
  }
  return null;
}

async function processGroup(groupRows, writers, options, stats, workerId) {
  const session = new Session(workerId, options, writers, stats);
  const listingHtml = await openBranchPage(session, groupRows[0]);
  const gridRows = parseGridRows(listingHtml);
  const byRef = new Map(gridRows.map((row) => [row.ResultsSelect?.value, row]));

  for (const indexRow of groupRows) {
    if (stats.completedRefs.has(indexRow.expectedRef)) continue;
    const gridRow = byRef.get(indexRow.expectedRef);
    if (!gridRow) {
      stats.failures += 1;
      await writers.failures.write({
        at: nowIso(),
        type: "missing-listing-row",
        workerId,
        branchKey: indexRow.branchKey,
        page: indexRow.page,
        expectedRef: indexRow.expectedRef,
      });
      continue;
    }

    let detail = await clickMore(session, listingHtml, gridRow, indexRow.expectedRef);
    if (!detail.matched && options.retryMismatches > 0) {
      const retried = await processRowWithRetries(groupRows, indexRow, writers, options, stats, workerId);
      if (retried) detail = retried;
    }

    if (!detail.matched) {
      stats.mismatches += 1;
      await writers.mismatches.write({
        at: nowIso(),
        type: "final-mismatch",
        workerId,
        branchKey: indexRow.branchKey,
        page: indexRow.page,
        expectedRef: indexRow.expectedRef,
        extractedRef: detail.extractedRef,
      });
      continue;
    }

    if (stats.completedRefs.has(indexRow.expectedRef)) continue;
    stats.completedRefs.add(indexRow.expectedRef);
    await writers.details.write({
      at: nowIso(),
      workerId,
      branchKey: indexRow.branchKey,
      letter: indexRow.letter,
      path: indexRow.path,
      page: indexRow.page,
      ctl: indexRow.ctl,
      expectedRef: indexRow.expectedRef,
      extractedRef: detail.extractedRef,
      repository: detail.fields.repository,
      proniReference: detail.fields.proniReference,
      level: detail.fields.level,
      access: detail.fields.access,
      title: detail.fields.title,
      dates: detail.fields.dates,
      description: detail.fields.description,
      digitalRecord: detail.fields.digitalRecord,
      rawAttributeCount: detail.fields.rawAttributeCount,
      attributeKeys: detail.fields.attributeKeys,
      rawAttributes: detail.fields.rawAttributes,
      requestMs: round(detail.requestMs),
      sourceRuntime: "raw-http-branch-page-row-sequential",
    });
    stats.detailsFetched += 1;
  }
  stats.groupsCompleted += 1;
}

function currentSummary(options, stats) {
  const elapsedSeconds = (performance.now() - stats.startedMs) / 1000;
  return {
    at: nowIso(),
    elapsedSeconds: round(elapsedSeconds),
    recordsPerSecond: round(stats.detailsFetched / Math.max(0.001, elapsedSeconds), 3),
    requestsPerSecond: round(stats.requests / Math.max(0.001, elapsedSeconds), 3),
    detailsFetched: stats.detailsFetched,
    recordsPlanned: stats.recordsPlanned,
    groupsCompleted: stats.groupsCompleted,
    groupsLoaded: stats.groupsLoaded,
    failures: stats.failures,
    mismatches: stats.mismatches,
    retries: stats.retries,
    blocked: stats.blocked,
    requestErrors: stats.requestErrors,
    requests: stats.requests,
    activeWorkers: stats.activeWorkers,
    desiredWorkers: stats.desiredWorkers,
    spawnedWorkers: stats.spawnedWorkers,
    cooldownMs: Math.max(0, round((stats.cooldownUntilMs - performance.now()) || 0)),
    medianRequestMs: percentile(stats.requestMs, 0.5),
    p95RequestMs: percentile(stats.requestMs, 0.95),
    adaptive: options.adaptive,
    stopped: stats.stopped,
    stopReason: stats.stopReason,
  };
}

async function runWorker(workerId, groups, groupQueue, writers, options, stats) {
  stats.activeWorkers += 1;
  try {
    while (!stats.stopped) {
      const item = groupQueue.next();
      if (!item) break;
      const { index, attempt } = item;
      try {
        await processGroup(groups[index], writers, options, stats, workerId);
      } catch (error) {
        const message = String(error?.message || error);
        const blocking = /waf request rejected|access denied|too many requests|rate-limit|request-blocked/i.test(message);
        if (blocking && options.stopOnBlocked) {
          stats.failures += 1;
          await writers.failures.write({
            at: nowIso(),
            type: "group-failed",
            workerId,
            branchKey: groups[index]?.[0]?.branchKey || "",
            page: groups[index]?.[0]?.page || "",
            rows: groups[index]?.length || 0,
            attempt,
            blocking,
            error: String(error?.stack || error),
          });
          stats.stopped = true;
          stats.stopReason = stats.stopReason || message;
          throw error;
        }
        const retryItem = groupQueue.retry(index);
        if (retryItem) {
          stats.retries += 1;
          await writers.failures.write({
            at: nowIso(),
            type: "group-retry",
            workerId,
            branchKey: groups[index]?.[0]?.branchKey || "",
            page: groups[index]?.[0]?.page || "",
            rows: groups[index]?.length || 0,
            attempt,
            nextAttempt: retryItem.attempt,
            blocking,
            error: String(error?.message || error),
          });
        } else {
          stats.failures += 1;
          await writers.failures.write({
            at: nowIso(),
            type: "group-failed",
            workerId,
            branchKey: groups[index]?.[0]?.branchKey || "",
            page: groups[index]?.[0]?.page || "",
            rows: groups[index]?.length || 0,
            attempt,
            blocking,
            error: String(error?.stack || error),
          });
        }
        await sleep(Math.min(5000, options.backoffMs * Math.max(1, attempt)));
      }
    }
  } catch (error) {
    stats.failures += 1;
    stats.stopped = options.stopOnBlocked;
    stats.stopReason = stats.stopReason || String(error?.message || error);
    await writers.failures.write({
      at: nowIso(),
      type: "worker-failed",
      workerId,
      error: String(error?.stack || error),
    });
    if (options.stopOnBlocked) throw error;
  } finally {
    stats.activeWorkers -= 1;
  }
}

function makeGroupQueue(groups, maxAttempts) {
  const queue = groups.map((_, index) => ({ index, attempt: 1 }));
  const attempts = new Map(queue.map((item) => [item.index, item.attempt]));
  return {
    next() {
      return queue.shift() || null;
    },
    retry(index) {
      const nextAttempt = (attempts.get(index) || 1) + 1;
      attempts.set(index, nextAttempt);
      if (nextAttempt > maxAttempts) return null;
      const item = { index, attempt: nextAttempt };
      queue.push(item);
      return item;
    },
  };
}

async function runScan(options) {
  if (!options.outDir) {
    options.outDir = path.join("D:\\PRONI\\eCatalogue\\detail-scans", `quick-scan-${nowIso().replace(/[:.]/g, "-")}`);
  }
  await fsp.mkdir(options.outDir, { recursive: true });
  const writers = {
    details: new BufferedJsonlWriter(path.join(options.outDir, "records-details.jsonl"), options),
    failures: new BufferedJsonlWriter(path.join(options.outDir, "failures.jsonl"), options),
    mismatches: new BufferedJsonlWriter(path.join(options.outDir, "mismatches.jsonl"), options),
    progress: new BufferedJsonlWriter(path.join(options.outDir, "progress.jsonl"), options),
  };
  const stats = makeStats();
  const groups = await readIndexGroups(options.index, options);
  stats.groupsLoaded = groups.length;
  stats.recordsPlanned = groups.reduce((sum, group) => sum + group.length, 0);
  stats.desiredWorkers = Math.min(options.initialWorkers, options.maxWorkers, groups.length || 1);

  const groupQueue = makeGroupQueue(groups, options.maxGroupRetries);
  const workerPromises = [];
  const workerErrors = [];
  const spawnWorker = () => {
    const workerId = stats.spawnedWorkers + 1;
    stats.spawnedWorkers = workerId;
    const promise = runWorker(workerId, groups, groupQueue, writers, options, stats).catch((error) => {
      workerErrors.push(error);
      if (options.stopOnBlocked) stats.stopped = true;
    });
    workerPromises.push(promise);
  };

  for (let i = 0; i < stats.desiredWorkers; i += 1) spawnWorker();

  const progressTimer = setInterval(() => {
    writers.progress.write(currentSummary(options, stats)).catch(() => {});
  }, Math.max(1000, options.progressEveryMs));

  const rampTimer = options.adaptive
    ? setInterval(() => {
      if (stats.stopped) return;
      if (stats.failures || stats.mismatches || stats.blocked || stats.requestErrors > options.maxRetries) return;
      if (stats.desiredWorkers >= options.maxWorkers) return;
      const p95 = percentile(stats.requestMs, 0.95) || 0;
      if (p95 > 2500) return;
      const nextDesired = Math.min(options.maxWorkers, stats.desiredWorkers + options.rampWorkers, groups.length);
      const toSpawn = nextDesired - stats.spawnedWorkers;
      stats.desiredWorkers = nextDesired;
      for (let i = 0; i < toSpawn; i += 1) spawnWorker();
    }, Math.max(2000, options.rampEveryMs))
    : null;

  try {
    await Promise.all(workerPromises);
    // If adaptive spawned extra workers after Promise.all captured the first
    // batch, wait until no active workers remain.
    while (stats.activeWorkers > 0) await sleep(250);
    await Promise.all(workerPromises);
  } finally {
    clearInterval(progressTimer);
    if (rampTimer) clearInterval(rampTimer);
  }

  if (workerErrors.length && options.stopOnBlocked) {
    const partialSummary = {
      ...currentSummary(options, stats),
      startedAt: stats.startedAt,
      finishedAt: nowIso(),
      index: path.resolve(options.index),
      outDir: path.resolve(options.outDir),
      fatalError: String(workerErrors[0]?.message || workerErrors[0]),
      options: {
        maxRecords: options.maxRecords,
        maxGroups: options.maxGroups,
        initialWorkers: options.initialWorkers,
        maxWorkers: options.maxWorkers,
        rampWorkers: options.rampWorkers,
        adaptive: options.adaptive,
        maxGroupRetries: options.maxGroupRetries,
        maxCooldownMs: options.maxCooldownMs,
        retryMismatches: options.retryMismatches,
      },
    };
    await writers.progress.write(partialSummary);
    for (const writer of Object.values(writers)) await writer.close();
    await fsp.writeFile(path.join(options.outDir, "summary.json"), `${JSON.stringify(partialSummary, null, 2)}\n`, "utf8");
    throw workerErrors[0];
  }

  const summary = {
    ...currentSummary(options, stats),
    startedAt: stats.startedAt,
    finishedAt: nowIso(),
    index: path.resolve(options.index),
    outDir: path.resolve(options.outDir),
    options: {
      maxRecords: options.maxRecords,
      maxGroups: options.maxGroups,
      initialWorkers: options.initialWorkers,
      maxWorkers: options.maxWorkers,
      rampWorkers: options.rampWorkers,
      adaptive: options.adaptive,
      maxGroupRetries: options.maxGroupRetries,
      maxCooldownMs: options.maxCooldownMs,
      retryMismatches: options.retryMismatches,
    },
  };

  await writers.progress.write(summary);
  for (const writer of Object.values(writers)) await writer.close();
  await fsp.writeFile(path.join(options.outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

runScan(options)
  .then((summary) => {
    console.log(`PRONI_DETAIL_QUICK_SCAN_SUMMARY ${path.join(summary.outDir, "summary.json")}`);
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
