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
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
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
    groupMode: "branch",
    snapshotMode: "prefer",
    httpClient: "https-agent",
    httpConnections: 32,
    httpPipelining: 0,
    keepAliveMsecs: 10000,
    retryDelayMs: 2500,
    retryDelayMultiplier: 2,
    maxRetryDelayMs: 30000,
    errorWindowMs: 15000,
    errorBurstThreshold: 8,
    timeoutMs: 30000,
    backoffMs: 750,
    stopOnBlocked: true,
    adaptive: true,
    resume: false,
    traversal: "branch",
    maxSubtreeRecords: 1500,
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
      case "group-mode": out.groupMode = take(); break;
      case "snapshot-mode": out.snapshotMode = take(); break;
      case "http-client": out.httpClient = take(); break;
      case "http-connections": out.httpConnections = Number(take()); break;
      case "http-pipelining": out.httpPipelining = Number(take()); break;
      case "keep-alive-msecs": out.keepAliveMsecs = Number(take()); break;
      case "retry-delay-ms": out.retryDelayMs = Number(take()); break;
      case "retry-delay-multiplier": out.retryDelayMultiplier = Number(take()); break;
      case "max-retry-delay-ms": out.maxRetryDelayMs = Number(take()); break;
      case "error-window-ms": out.errorWindowMs = Number(take()); break;
      case "error-burst-threshold": out.errorBurstThreshold = Number(take()); break;
      case "timeout-ms": out.timeoutMs = Number(take()); break;
      case "backoff-ms": out.backoffMs = Number(take()); break;
      case "stop-on-blocked": out.stopOnBlocked = true; break;
      case "no-stop-on-blocked": out.stopOnBlocked = false; break;
      case "adaptive": out.adaptive = true; break;
      case "no-adaptive": out.adaptive = false; break;
      case "resume": out.resume = true; break;
      case "no-resume": out.resume = false; break;
      case "traversal": out.traversal = take(); break;
      case "max-subtree-records": out.maxSubtreeRecords = Number(take()); break;
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
  --group-mode branch        Work-unit mode: branch or page.
  --snapshot-mode prefer     Snapshot mode for page units: off, prefer, or only.
  --http-client https-agent  HTTP backend: https-agent or fetch.
  --http-connections 32      Keep-alive max sockets for https-agent mode.
  --max-group-retries 3      Requeue transient listing-page failures.
  --max-cooldown-ms 15000    Shared backoff ceiling after network errors.
  --no-adaptive              Disable worker ramp.
  --resume                   Skip records already present in --out-dir/records-details.jsonl
                             and append new ones (point --out-dir at the prior run's folder).
  --traversal branch         Traversal mode: branch (re-walk from root per branch) or
                             dfs (walk subtrees with a cached parent-listing stack;
                             far fewer requests per record on deep branches).
  --max-subtree-records 1500 DFS only: split subtrees larger than this for load balancing.
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

function makeHeadersAdapter(headers) {
  return {
    get(name) {
      const value = headers[String(name).toLowerCase()];
      if (Array.isArray(value)) return value.join(", ");
      return value ?? null;
    },
    getSetCookie() {
      const value = headers["set-cookie"];
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    },
  };
}

async function requestTextWithHttpsAgent(options, method, urlString, headers, body, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = httpsRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      agent: options.httpAgent,
      timeout: options.timeoutMs,
    }, (response) => {
      const chunks = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", async () => {
        const text = chunks.join("");
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if (location && status >= 300 && status < 400 && redirects < 5) {
          try {
            resolve(await requestTextWithHttpsAgent(
              options,
              "GET",
              new URL(location, urlString).toString(),
              headers,
              null,
              redirects + 1,
            ));
          } catch (error) {
            reject(error);
          }
          return;
        }
        resolve({
          status,
          text,
          headers: makeHeadersAdapter(response.headers),
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    if (body) request.write(body.toString());
    request.end();
  });
}

function recordRequestError(stats, options, attempt) {
  const now = performance.now();
  stats.errorEvents.push(now);
  const cutoff = now - options.errorWindowMs;
  while (stats.errorEvents.length && stats.errorEvents[0] < cutoff) stats.errorEvents.shift();
  const burst = stats.errorEvents.length >= options.errorBurstThreshold;
  const baseCooldown = Math.max(options.backoffMs, options.backoffMs * attempt * 3);
  const cooldown = burst ? options.maxCooldownMs : Math.min(options.maxCooldownMs, baseCooldown);
  if (burst) stats.errorBursts += 1;
  stats.cooldownUntilMs = Math.max(stats.cooldownUntilMs || 0, now + cooldown);
  return { cooldown, burst, recentErrorCount: stats.errorEvents.length };
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
  constructor(filePath, options, append = false) {
    this.filePath = filePath;
    this.flushRows = options.writerFlushRows;
    this.buffer = [];
    this.stream = createWriteStream(filePath, { flags: append ? "a" : "w", encoding: "utf8" });
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
      let timeout = null;
      const started = performance.now();
      try {
        const headers = {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": USER_AGENT,
        };
        const cookie = this.jar.header();
        if (cookie) headers.cookie = cookie;
        if (body) headers["content-type"] = "application/x-www-form-urlencoded";
        let response;
        if (this.options.httpClient === "https-agent") {
          response = await requestTextWithHttpsAgent(this.options, method, url, headers, body);
        } else {
          const controller = new AbortController();
          timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
          const res = await fetch(url, {
            method,
            headers,
            body: body ? body.toString() : undefined,
            signal: controller.signal,
            redirect: "follow",
          });
          response = {
            status: res.status,
            text: await res.text(),
            headers: res.headers,
          };
        }
        const text = response.text;
        this.jar.update(response.headers);
        if (timeout) clearTimeout(timeout);
        const ms = performance.now() - started;
        this.stats.requests += 1;
        this.stats.requestMs.push(ms);
        if (this.stats.requestMs.length > 5000) this.stats.requestMs.splice(0, this.stats.requestMs.length - 5000);
        if (isBlocked(response.status, text)) {
          const reason = blockedReason(response.status, text);
          this.stats.blocked += 1;
          await this.writers.failures.write({
            at: nowIso(),
            type: "request-blocked",
            workerId: this.workerId,
            context,
            status: response.status,
            ms: round(ms),
            reason,
          });
          if (this.options.stopOnBlocked) throw new Error(`${context}: ${reason}`);
          return { ok: false, status: response.status, text, ms, reason };
        }
        return { ok: true, status: response.status, text, ms };
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        attempt += 1;
        const cause = error?.cause?.code || error?.cause?.name || "";
        const message = error?.name === "AbortError" ? "timeout" : [String(error?.message || error), cause].filter(Boolean).join(" / ");
        this.stats.requestErrors += 1;
        const cooldown = recordRequestError(this.stats, this.options, attempt);
        await this.writers.failures.write({
          at: nowIso(),
          type: "request-error",
          workerId: this.workerId,
          context,
          attempt,
          error: message,
          cooldownMs: cooldown.cooldown,
          errorBurst: cooldown.burst,
          recentErrorCount: cooldown.recentErrorCount,
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

async function readSnapshotHtml(row, options) {
  if (options.snapshotMode === "off") return null;
  if (!row.pageSnapshotPath) return null;
  try {
    return await fsp.readFile(path.resolve(row.pageSnapshotPath), "utf8");
  } catch (error) {
    if (options.snapshotMode === "only") throw error;
    return null;
  }
}

function makeIndexRow(row) {
  return {
    branchKey: row.branchKey,
    letter: row.letter,
    path: row.path || [],
    page: Number(row.page || 1),
    ctl: row.ctl,
    expectedRef: row.expectedRef || row.proniReference,
    proniReference: row.proniReference,
    resultsViewName: row.resultsViewName || "",
    resultsViewValue: row.resultsViewValue || "",
    pageSnapshotPath: row.pageSnapshotPath || "",
    pageSnapshotMetadataPath: row.pageSnapshotMetadataPath || "",
  };
}

function makePageUnit(rows) {
  const sortedRows = rows.sort((a, b) => String(a.ctl).localeCompare(String(b.ctl), undefined, { numeric: true }));
  const first = sortedRows[0] || {};
  return {
    type: "page",
    branchKey: first.branchKey || "",
    letter: first.letter || "",
    path: first.path || [],
    firstPage: Number(first.page || 1),
    lastPage: Number(first.page || 1),
    pageCount: 1,
    rowCount: sortedRows.length,
    rows: sortedRows,
    pages: [{ page: Number(first.page || 1), rows: sortedRows }],
  };
}

function makeBranchUnit(rows) {
  const byPage = new Map();
  for (const row of rows) {
    if (!byPage.has(row.page)) byPage.set(row.page, []);
    byPage.get(row.page).push(row);
  }
  const pages = [...byPage.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([page, pageRows]) => ({
      page: Number(page),
      rows: pageRows.sort((a, b) => String(a.ctl).localeCompare(String(b.ctl), undefined, { numeric: true })),
    }));
  const first = rows[0] || {};
  return {
    type: "branch",
    branchKey: first.branchKey || "",
    letter: first.letter || "",
    path: first.path || [],
    firstPage: pages[0]?.page || 1,
    lastPage: pages[pages.length - 1]?.page || 1,
    pageCount: pages.length,
    rowCount: rows.length,
    rows,
    pages,
  };
}

async function readIndexWorkUnits(indexPath, options) {
  const groups = new Map();
  let readRows = 0;
  const rl = readline.createInterface({
    input: createReadStream(indexPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const key = options.groupMode === "branch" ? row.branchKey : `${row.branchKey}::${row.page}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(makeIndexRow(row));
    readRows += 1;
    if (options.maxRecords > 0 && readRows >= options.maxRecords) break;
  }

  const units = [...groups.values()]
    .map((rows) => (options.groupMode === "branch" ? makeBranchUnit(rows) : makePageUnit(rows)))
    .sort((a, b) => {
      const sizeDelta = b.rowCount - a.rowCount;
      if (sizeDelta) return sizeDelta;
      const pageDelta = b.pageCount - a.pageCount;
      if (pageDelta) return pageDelta;
      return String(a.branchKey).localeCompare(String(b.branchKey));
    });
  return options.maxGroups > 0 ? units.slice(0, options.maxGroups) : units;
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
    errorEvents: [],
    errorBursts: 0,
    snapshotPagesUsed: 0,
    activeWorkers: 0,
    desiredWorkers: 0,
    spawnedWorkers: 0,
    cooldownUntilMs: 0,
    completedRefs: new Set(),
    stopped: false,
    stopReason: "",
  };
}

async function processRowWithRetries(row, writers, options, stats, workerId) {
  let attempt = 0;
  while (attempt <= options.retryMismatches) {
    const session = new Session(`${workerId}.${attempt + 1}`, options, writers, stats);
    const listingHtml = await openBranchPage(session, row);
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

async function writeMatchedDetail(indexRow, detail, writers, stats, workerId, sourceRuntime) {
  if (stats.completedRefs.has(indexRow.expectedRef)) return;
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
    sourceRuntime,
  });
  stats.detailsFetched += 1;
}

async function processRowsFromListing(session, listingHtml, rows, writers, options, stats, workerId, sourceRuntime) {
  const gridRows = parseGridRows(listingHtml);
  const byRef = new Map(gridRows.map((row) => [row.ResultsSelect?.value, row]));

  for (const indexRow of rows) {
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
      const retried = await processRowWithRetries(indexRow, writers, options, stats, workerId);
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

    await writeMatchedDetail(indexRow, detail, writers, stats, workerId, sourceRuntime);
  }
}

async function processPageUnit(unit, writers, options, stats, workerId) {
  const session = new Session(workerId, options, writers, stats);
  let listingHtml = await readSnapshotHtml(unit.rows[0], options);
  let sourceRuntime = "raw-http-page-session-row-sequential";
  if (listingHtml) {
    stats.snapshotPagesUsed += 1;
    sourceRuntime = "raw-http-page-snapshot-row-sequential";
  } else {
    if (options.snapshotMode === "only") throw new Error(`No snapshot for ${unit.branchKey} page ${unit.firstPage}`);
    listingHtml = await openBranchPage(session, unit.rows[0]);
  }
  await processRowsFromListing(session, listingHtml, unit.rows, writers, options, stats, workerId, sourceRuntime);
  stats.groupsCompleted += 1;
}

async function processBranchUnit(unit, writers, options, stats, workerId) {
  const session = new Session(workerId, options, writers, stats);
  let listingHtml = await openBranchPage(session, { ...unit.rows[0], page: unit.firstPage });
  let currentPage = unit.firstPage;
  for (const page of unit.pages) {
    while (currentPage < page.page) {
      const next = findNextButton(listingHtml);
      if (!next) throw new Error(`Branch ${unit.branchKey} has no page ${page.page}`);
      listingHtml = await clickNext(session, listingHtml, next);
      currentPage += 1;
    }
    await processRowsFromListing(
      session,
      listingHtml,
      page.rows,
      writers,
      options,
      stats,
      workerId,
      "raw-http-branch-session-row-sequential",
    );
  }
  stats.groupsCompleted += 1;
}

// --- DFS traversal mode -----------------------------------------------------
// Instead of re-walking from the letter root for every branch, a worker owns a
// subtree and walks it depth-first, reaching siblings/children by re-POSTing a
// cached ancestor listing page (validated by scripts/proni-dfs-benchmark.mjs).

async function readIndexRecords(indexPath, options) {
  const records = [];
  const rl = readline.createInterface({ input: createReadStream(indexPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    records.push({ expectedRef: r.expectedRef, branchKey: r.branchKey, letter: r.letter, path: r.path || [], page: Number(r.page || 1), ctl: r.ctl });
    if (options.maxRecords > 0 && records.length >= options.maxRecords) break;
  }
  return records;
}

function buildSubtreeUnits(records, options) {
  const cap = options.maxSubtreeRecords > 0 ? options.maxSubtreeRecords : 1500;
  const nodes = new Map();
  const keyOf = (letter, pathArr) => `${letter}|${pathArr.join(">")}`;
  const ensureNode = (letter, pathArr) => {
    const key = keyOf(letter, pathArr);
    if (!nodes.has(key)) {
      nodes.set(key, {
        key, letter, ref: pathArr[pathArr.length - 1], pathArr,
        parentKey: pathArr.length > 1 ? keyOf(letter, pathArr.slice(0, -1)) : null,
        childKeys: new Set(), directRecords: [], subtreeCount: 0,
      });
    }
    return nodes.get(key);
  };
  for (const r of records) {
    const p = r.path;
    if (!p.length) continue;
    for (let i = 1; i <= p.length; i += 1) {
      ensureNode(r.letter, p.slice(0, i));
      if (i > 1) nodes.get(keyOf(r.letter, p.slice(0, i - 1))).childKeys.add(keyOf(r.letter, p.slice(0, i)));
    }
    ensureNode(r.letter, p).directRecords.push(r);
  }
  const computeCount = (key) => {
    const n = nodes.get(key);
    let c = n.directRecords.length;
    for (const ck of n.childKeys) c += computeCount(ck);
    n.subtreeCount = c;
    return c;
  };
  const roots = [...nodes.values()].filter((n) => n.parentKey === null);
  for (const root of roots) computeCount(root.key);

  const units = [];
  const makeUnit = (rootNode, includeDescendants) => {
    const recordsByBranch = new Map();
    const wantedBranchRefs = new Set();
    const refs = new Set();
    const rootIdx = rootNode.pathArr.length - 1;
    const collect = (key, descend) => {
      const n = nodes.get(key);
      for (const r of n.directRecords) {
        refs.add(r.expectedRef);
        const bref = r.path[r.path.length - 1];
        if (!recordsByBranch.has(bref)) recordsByBranch.set(bref, []);
        recordsByBranch.get(bref).push(r);
        for (let i = rootIdx + 1; i < r.path.length; i += 1) wantedBranchRefs.add(r.path[i]);
      }
      if (descend) for (const ck of n.childKeys) collect(ck, true);
    };
    collect(rootNode.key, includeDescendants);
    return {
      type: "subtree", letter: rootNode.letter, rootPath: rootNode.pathArr,
      rootBranchRef: rootNode.ref, rootBranchKey: rootNode.key,
      recordsByBranch, wantedBranchRefs, refs, rowCount: refs.size,
    };
  };
  const partition = (key) => {
    const n = nodes.get(key);
    if (n.subtreeCount <= cap) {
      if (n.subtreeCount > 0) units.push(makeUnit(n, true));
      return;
    }
    if (n.directRecords.length) units.push(makeUnit(n, false));
    for (const ck of n.childKeys) partition(ck);
  };
  for (const root of roots) partition(root.key);
  units.sort((a, b) => b.rowCount - a.rowCount);
  return units;
}

async function walkSubtreeNode(session, listingHtml, branchRef, unit, writers, options, stats, workerId, visited) {
  if (visited.has(branchRef)) return;
  visited.add(branchRef);
  const byPage = new Map();
  for (const r of unit.recordsByBranch.get(branchRef) || []) {
    const pg = Number(r.page || 1);
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg).push(r);
  }
  const childrenToDescend = [];
  let html = listingHtml;
  let page = 1;
  while (true) {
    const recsThisPage = byPage.get(page) || [];
    if (recsThisPage.length) {
      await processRowsFromListing(session, html, recsThisPage, writers, options, stats, workerId, "raw-http-dfs-traversal");
    }
    for (const row of parseGridRows(html)) {
      const cref = row.ResultsSelect?.value;
      if (row.ResultsSelect && !row.ResultsSelect.disabled && cref && unit.wantedBranchRefs.has(cref) && !visited.has(cref)) {
        childrenToDescend.push({ row, pageHtml: html });
      }
    }
    const next = findNextButton(html);
    if (!next || page >= options.maxPagesPerBranch) break;
    html = await clickNext(session, html, next);
    page += 1;
  }
  for (const { row, pageHtml } of childrenToDescend) {
    const cref = row.ResultsSelect.value;
    if (visited.has(cref)) continue;
    const childHtml = await clickSelect(session, pageHtml, row); // re-POST against cached parent listing
    await walkSubtreeNode(session, childHtml, cref, unit, writers, options, stats, workerId, visited);
  }
}

async function processSubtreeUnit(unit, writers, options, stats, workerId) {
  const session = new Session(workerId, options, writers, stats);
  const rootHtml = await openBranchPage(session, { letter: unit.letter, path: unit.rootPath, page: 1, branchKey: unit.rootBranchKey });
  await walkSubtreeNode(session, rootHtml, unit.rootBranchRef, unit, writers, options, stats, workerId, new Set());
  stats.groupsCompleted += 1;
}

async function processUnit(unit, writers, options, stats, workerId) {
  if (unit.type === "subtree") return processSubtreeUnit(unit, writers, options, stats, workerId);
  if (unit.type === "branch") return processBranchUnit(unit, writers, options, stats, workerId);
  return processPageUnit(unit, writers, options, stats, workerId);
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
    errorBursts: stats.errorBursts,
    requests: stats.requests,
    snapshotPagesUsed: stats.snapshotPagesUsed,
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

function summaryOptions(options) {
  return {
    maxRecords: options.maxRecords,
    maxGroups: options.maxGroups,
    groupMode: options.groupMode,
    snapshotMode: options.snapshotMode,
    httpClient: options.httpClient,
    httpConnections: options.httpConnections,
    httpPipelining: options.httpPipelining,
    initialWorkers: options.initialWorkers,
    maxWorkers: options.maxWorkers,
    rampWorkers: options.rampWorkers,
    adaptive: options.adaptive,
    maxGroupRetries: options.maxGroupRetries,
    retryDelayMs: options.retryDelayMs,
    maxRetryDelayMs: options.maxRetryDelayMs,
    maxCooldownMs: options.maxCooldownMs,
    retryMismatches: options.retryMismatches,
    errorWindowMs: options.errorWindowMs,
    errorBurstThreshold: options.errorBurstThreshold,
  };
}

function describeUnit(unit) {
  return {
    type: unit?.type || "",
    branchKey: unit?.branchKey || "",
    firstPage: unit?.firstPage || "",
    lastPage: unit?.lastPage || "",
    pageCount: unit?.pageCount || 0,
    rows: unit?.rowCount || 0,
  };
}

async function runWorker(workerId, units, workQueue, writers, options, stats) {
  stats.activeWorkers += 1;
  try {
    while (!stats.stopped) {
      const item = workQueue.next();
      if (!item) {
        if (!workQueue.hasPending()) break;
        await sleep(Math.min(1000, Math.max(100, workQueue.nextDelayMs())));
        continue;
      }
      const { index, attempt } = item;
      const unit = units[index];
      if (options.resume) {
        const unitRefs = unit.rows ? unit.rows.map((row) => row.expectedRef) : (unit.refs ? [...unit.refs] : []);
        if (unitRefs.length && unitRefs.every((ref) => stats.completedRefs.has(ref))) {
          stats.groupsCompleted += 1;
          continue;
        }
      }
      try {
        await processUnit(unit, writers, options, stats, workerId);
      } catch (error) {
        const message = String(error?.message || error);
        const blocking = /waf request rejected|access denied|too many requests|rate-limit|request-blocked/i.test(message);
        if (blocking && options.stopOnBlocked) {
          stats.failures += 1;
          await writers.failures.write({
            at: nowIso(),
            type: "group-failed",
            workerId,
            ...describeUnit(unit),
            attempt,
            blocking,
            error: String(error?.stack || error),
          });
          stats.stopped = true;
          stats.stopReason = stats.stopReason || message;
          throw error;
        }
        const retryItem = workQueue.retry(index, attempt);
        if (retryItem) {
          stats.retries += 1;
          await writers.retryQueue.write({
            at: nowIso(),
            type: "delayed-unit-retry",
            workerId,
            ...describeUnit(unit),
            attempt,
            nextAttempt: retryItem.attempt,
            dueAt: new Date(Date.now() + retryItem.delayMs).toISOString(),
            delayMs: retryItem.delayMs,
            blocking,
            error: String(error?.message || error),
          });
          await writers.failures.write({
            at: nowIso(),
            type: "group-retry",
            workerId,
            ...describeUnit(unit),
            attempt,
            nextAttempt: retryItem.attempt,
            delayMs: retryItem.delayMs,
            blocking,
            error: String(error?.message || error),
          });
        } else {
          stats.failures += 1;
          await writers.failures.write({
            at: nowIso(),
            type: "group-failed",
            workerId,
            ...describeUnit(unit),
            attempt,
            blocking,
            error: String(error?.stack || error),
          });
        }
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

function makeWorkQueue(units, options) {
  const hot = units.map((_, index) => ({ index, attempt: 1 }));
  const retry = [];
  const attempts = new Map(hot.map((item) => [item.index, item.attempt]));
  return {
    next() {
      if (hot.length) return hot.shift();
      const now = performance.now();
      retry.sort((a, b) => a.dueMs - b.dueMs);
      if (retry.length && retry[0].dueMs <= now) return retry.shift();
      return null;
    },
    hasPending() {
      return Boolean(hot.length || retry.length);
    },
    nextDelayMs() {
      if (hot.length) return 0;
      if (!retry.length) return 0;
      retry.sort((a, b) => a.dueMs - b.dueMs);
      return Math.max(0, retry[0].dueMs - performance.now());
    },
    retry(index, attempt = 1) {
      const nextAttempt = (attempts.get(index) || 1) + 1;
      attempts.set(index, nextAttempt);
      if (nextAttempt > options.maxGroupRetries) return null;
      const exponent = Math.max(0, nextAttempt - 2);
      const delayMs = Math.min(
        options.maxRetryDelayMs,
        Math.max(options.retryDelayMs, options.retryDelayMs * (options.retryDelayMultiplier ** exponent)),
      );
      const item = { index, attempt: nextAttempt, dueMs: performance.now() + delayMs, delayMs };
      retry.push(item);
      return item;
    },
  };
}

async function seedCompletedRefsFromOutput(outDir, stats) {
  const detailsPath = path.join(outDir, "records-details.jsonl");
  let count = 0;
  try {
    const rl = readline.createInterface({
      input: createReadStream(detailsPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ref = JSON.parse(trimmed).expectedRef;
        if (ref && !stats.completedRefs.has(ref)) {
          stats.completedRefs.add(ref);
          count += 1;
        }
      } catch {
        // Ignore a malformed/partial trailing line (e.g. a row cut off by an abrupt shutdown).
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return count;
}

async function runScan(options) {
  if (!["branch", "page"].includes(options.groupMode)) {
    throw new Error(`--group-mode must be branch or page, got ${options.groupMode}`);
  }
  if (!["off", "prefer", "only"].includes(options.snapshotMode)) {
    throw new Error(`--snapshot-mode must be off, prefer, or only, got ${options.snapshotMode}`);
  }
  if (!["https-agent", "fetch"].includes(options.httpClient)) {
    throw new Error(`--http-client must be https-agent or fetch, got ${options.httpClient}`);
  }
  if (!["branch", "dfs"].includes(options.traversal)) {
    throw new Error(`--traversal must be branch or dfs, got ${options.traversal}`);
  }
  if (options.httpClient === "https-agent") {
    options.httpAgent = new HttpsAgent({
      keepAlive: true,
      maxSockets: Math.max(1, options.httpConnections),
      maxFreeSockets: Math.max(1, Math.ceil(options.httpConnections / 2)),
      keepAliveMsecs: Math.max(1000, options.keepAliveMsecs),
      scheduling: "lifo",
    });
  }
  if (!options.outDir) {
    options.outDir = path.join("D:\\PRONI\\eCatalogue\\detail-scans", `quick-scan-${nowIso().replace(/[:.]/g, "-")}`);
  }
  await fsp.mkdir(options.outDir, { recursive: true });
  const writers = {
    details: new BufferedJsonlWriter(path.join(options.outDir, "records-details.jsonl"), options, options.resume),
    failures: new BufferedJsonlWriter(path.join(options.outDir, "failures.jsonl"), options, options.resume),
    mismatches: new BufferedJsonlWriter(path.join(options.outDir, "mismatches.jsonl"), options, options.resume),
    progress: new BufferedJsonlWriter(path.join(options.outDir, "progress.jsonl"), options, options.resume),
    retryQueue: new BufferedJsonlWriter(path.join(options.outDir, "retry-queue.jsonl"), options, options.resume),
  };
  const stats = makeStats();
  if (options.resume) {
    const seeded = await seedCompletedRefsFromOutput(options.outDir, stats);
    console.error(`[resume] seeded ${seeded} already-completed record(s) from ${path.join(options.outDir, "records-details.jsonl")}`);
  }
  const units = options.traversal === "dfs"
    ? buildSubtreeUnits(await readIndexRecords(options.index, options), options)
    : await readIndexWorkUnits(options.index, options);
  stats.groupsLoaded = units.length;
  stats.recordsPlanned = units.reduce((sum, unit) => sum + unit.rowCount, 0);
  stats.desiredWorkers = Math.min(options.initialWorkers, options.maxWorkers, units.length || 1);

  const workQueue = makeWorkQueue(units, options);
  const workerPromises = [];
  const workerErrors = [];
  const spawnWorker = () => {
    const workerId = stats.spawnedWorkers + 1;
    stats.spawnedWorkers = workerId;
    const promise = runWorker(workerId, units, workQueue, writers, options, stats).catch((error) => {
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
      const nextDesired = Math.min(options.maxWorkers, stats.desiredWorkers + options.rampWorkers, units.length);
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
      options: summaryOptions(options),
    };
    await writers.progress.write(partialSummary);
    for (const writer of Object.values(writers)) await writer.close();
    if (options.httpAgent) options.httpAgent.destroy();
    await fsp.writeFile(path.join(options.outDir, "summary.json"), `${JSON.stringify(partialSummary, null, 2)}\n`, "utf8");
    throw workerErrors[0];
  }

  const summary = {
    ...currentSummary(options, stats),
    startedAt: stats.startedAt,
    finishedAt: nowIso(),
    index: path.resolve(options.index),
    outDir: path.resolve(options.outDir),
    options: summaryOptions(options),
  };

  await writers.progress.write(summary);
  for (const writer of Object.values(writers)) await writer.close();
  if (options.httpAgent) options.httpAgent.destroy();
  await fsp.writeFile(path.join(options.outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

export {
  parseArgs,
  makeStats,
  Session,
  startBrowseLetter,
  clickSelect,
  clickSelectByRef,
  clickNext,
  openBranchPage,
  clickMore,
  parseGridRows,
  findNextButton,
  extractDetailFields,
  BASE,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
