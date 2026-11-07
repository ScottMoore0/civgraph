#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const CDX = "https://web.archive.org/cdx";
const UA = "Civgraph NISRA Wayback recovery/1.0 (+https://civgraph.net; polite archival recovery)";

const BINARY_EXTS = new Set([
  ".7z",
  ".csv",
  ".doc",
  ".docx",
  ".geojson",
  ".gif",
  ".gz",
  ".jpeg",
  ".jpg",
  ".json",
  ".ods",
  ".pdf",
  ".png",
  ".rar",
  ".svg",
  ".tar",
  ".tsv",
  ".txt",
  ".xls",
  ".xlsm",
  ".xlsx",
  ".xml",
  ".zip",
]);

const SOFT_ERROR_PATTERNS = [
  /\b404\b.{0,80}\bnot found\b/i,
  /\bpage not found\b/i,
  /\bfile not found\b/i,
  /\bnot\s+found\s*\|\s*nisra\b/i,
  /\baccess denied\b/i,
  /\bforbidden\b/i,
  /\bservice unavailable\b/i,
  /\btemporarily unavailable\b/i,
  /\bthe requested page could not be found\b/i,
  /\bthe requested url was not found\b/i,
  /\bwayback machine has not archived that url\b/i,
  /\bgot an HTTP 3\d\d response at crawl time\b/i,
];

function defaultPatterns() {
  const pathBuckets = "abcdefghijklmnopqrstuvwxyz0123456789".split("").flatMap((ch) => [
    `www.nisra.gov.uk/${ch}`,
    `nisra.gov.uk/${ch}`,
  ]);
  return [
    ...pathBuckets,
    "ws-data.nisra.gov.uk/public/api.restful/",
    "ws-data.nisra.gov.uk/public/api.static/",
    "ws-data.nisra.gov.uk/public/Resources/",
  ];
}

function readArg(name, fallback = null) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const args = {
  currentRoot: path.resolve(readArg("--current-root", "D:\\nisra")),
  root: path.resolve(readArg("--root", "D:\\nisra-wayback")),
  reportDir: path.resolve(readArg("--report-dir", path.join("data", "provider-mirror-audit"))),
  patterns: readArg("--patterns", defaultPatterns().join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  download: process.argv.includes("--download"),
  inventoryOnly: process.argv.includes("--inventory-only"),
  listOnly: process.argv.includes("--list-only"),
  retryUnavailable: process.argv.includes("--retry-unavailable"),
  skipNoise: !process.argv.includes("--include-noise"),
  stopOnCdxError: process.argv.includes("--stop-on-cdx-error"),
  assetsOnly: process.argv.includes("--assets-only"),
  status200Only: process.argv.includes("--status-200-only"),
  trustCdxAssets: process.argv.includes("--trust-cdx-assets"),
  maxUrls: Number(readArg("--max-urls", 0)),
  maxDownloads: Number(readArg("--max-downloads", 0)),
  maxFallbacks: Number(readArg("--max-fallbacks", 20)),
  fromYear: Number(readArg("--from-year", 1996)),
  toYear: Number(readArg("--to-year", new Date().getUTCFullYear())),
  windowYears: Math.max(1, Number(readArg("--window-years", 2))),
  delayMs: Number(readArg("--delay-ms", 3000)),
  cdxDelayMs: Number(readArg("--cdx-delay-ms", 1000)),
  cdxAttempts: Math.max(1, Number(readArg("--cdx-attempts", 4))),
  timeoutMs: Number(readArg("--timeout-ms", 30000)),
  validateBytes: Number(readArg("--validate-bytes", 262144)),
  minFreeGb: Number(readArg("--min-free-gb", 10)),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function writeCsv(file, rows, columns) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${[columns.join(","), ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(","))].join("\n")}\n`,
    "utf8",
  );
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeOriginal(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function inventoryKey(raw) {
  const normalized = normalizeOriginal(raw);
  if (!normalized) return String(raw || "").toLowerCase();
  const url = new URL(normalized);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString().toLowerCase();
}

function isLikelyNoiseOriginal(original) {
  try {
    const url = new URL(original);
    const decoded = decodeURIComponent(url.pathname + url.search).toLowerCase();
    return [
      "||",
      "nodename",
      "document.write",
      "oldarray",
      "obj.src",
      "offsetleft",
      "parentnode",
      "\ufb01les",
      "\u2003",
      "%e2%80%83",
      "%ef%ac%81",
      "<",
      ">;",
    ].some((needle) => decoded.includes(needle));
  } catch {
    return true;
  }
}

function localPathForCurrentMirror(original) {
  const url = new URL(original);
  if (url.hostname.toLowerCase() !== "www.nisra.gov.uk") return "";
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  return safeResolve(args.currentRoot, path.join("mirror", rel));
}

function safeResolve(root, relOrAbs) {
  const target = path.isAbsolute(relOrAbs) ? path.resolve(relOrAbs) : path.resolve(root, relOrAbs);
  const resolvedRoot = path.resolve(root);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Refusing path outside root: ${target}`);
  }
  return target;
}

function filenameForOriginal(original) {
  const url = new URL(original);
  const pathname = decodeURIComponent(url.pathname);
  let rel = pathname.replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel = path.join(rel, "index.html");
  const ext = path.extname(rel);
  if (!ext && !url.search) rel = path.join(rel, "index.html");
  if (url.search) {
    const hash = crypto.createHash("sha1").update(url.search).digest("hex").slice(0, 12);
    const parsed = path.parse(rel || "index.html");
    rel = path.join(parsed.dir, `${parsed.name || "query"}-${hash}${parsed.ext || ".html"}`);
  }
  return rel.split(/[\\/]+/).map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, "_")).join(path.sep);
}

function localPathForWayback(original) {
  const url = new URL(original);
  return safeResolve(args.root, path.join("mirror", url.hostname.toLowerCase(), filenameForOriginal(original)));
}

function rawCaptureUrl(capture) {
  return `https://web.archive.org/web/${capture.timestamp}id_/${capture.original}`;
}

function isExistingCurrentFile(original) {
  try {
    const currentInventory = readJson(path.join(args.currentRoot, "_inventory.json"), {});
    if (currentInventory[inventoryKey(original)] || currentInventory[original]) {
      const target = path.resolve(args.currentRoot, currentInventory[inventoryKey(original)] || currentInventory[original]);
      return fs.existsSync(target) && fs.statSync(target).size > 0;
    }
    const local = localPathForCurrentMirror(original);
    return Boolean(local) && fs.existsSync(local) && fs.statSync(local).size > 0;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${args.timeoutMs}ms`)), args.timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      headers: {
        "user-agent": UA,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetries(url, options = {}, attempts = 4) {
  let lastError = null;
  let lastResponse = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.ok || attempt === attempts || ![408, 429, 500, 502, 503, 504].includes(res.status)) return res;
      lastResponse = res;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleep(Math.min(30000, 1500 * attempt * attempt));
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("fetch failed");
}

async function readLimitedBody(res, maxBytes) {
  if (!res.body) {
    return Buffer.from(await res.arrayBuffer()).subarray(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      chunks.push(buffer);
      total += buffer.length;
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

function looksLikeHtml(buffer, contentType, original) {
  const ext = path.extname(new URL(original).pathname).toLowerCase();
  if (contentType.includes("text/html")) return true;
  if (!BINARY_EXTS.has(ext)) return true;
  const text = buffer.subarray(0, 512).toString("utf8").trimStart();
  return /^<!doctype html\b/i.test(text) || /^<html[\s>]/i.test(text);
}

function validateSample(buffer, contentType, original) {
  const ext = path.extname(new URL(original).pathname).toLowerCase();
  if (!buffer.length) return { ok: false, reason: "empty-capture" };
  const htmlish = looksLikeHtml(buffer, contentType, original);
  const sampleText = buffer.toString("utf8");
  if (SOFT_ERROR_PATTERNS.some((pattern) => pattern.test(sampleText))) {
    return { ok: false, reason: "soft-error-page" };
  }
  if ([".pdf"].includes(ext) && !buffer.subarray(0, 8).includes(Buffer.from("%PDF"))) {
    if (htmlish) return { ok: false, reason: "html-instead-of-pdf" };
  }
  if ([".zip", ".docx", ".xlsx", ".ods"].includes(ext) && !buffer.subarray(0, 8).includes(Buffer.from("PK"))) {
    if (htmlish) return { ok: false, reason: "html-instead-of-archive" };
  }
  if ([".xls", ".doc"].includes(ext)) {
    const ole = buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
    if (!ole && htmlish) return { ok: false, reason: "html-instead-of-office-binary" };
  }
  if (htmlish && sampleText.replace(/<[^>]+>/g, " ").trim().length < 30) {
    return { ok: false, reason: "trivial-html-capture" };
  }
  return { ok: true, reason: "valid" };
}

async function validateCapture(capture) {
  const url = rawCaptureUrl(capture);
  const res = await fetchWithTimeout(url, {
    headers: {
      accept: "*/*",
      range: `bytes=0-${Math.max(0, args.validateBytes - 1)}`,
    },
  });
  const contentType = (res.headers.get("content-type") || capture.mimetype || "").toLowerCase();
  const buffer = await readLimitedBody(res, args.validateBytes);
  if (!res.ok && res.status !== 206) {
    return {
      ok: false,
      status: res.status,
      reason: `replay-http-${res.status}`,
      contentType,
      sampleBytes: buffer.length,
    };
  }
  const validation = validateSample(buffer, contentType, capture.original);
  return {
    ...validation,
    status: res.status,
    contentType,
    sampleBytes: buffer.length,
  };
}

async function cdxRows(params) {
  const url = new URL(CDX);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
    else if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  url.searchParams.set("output", "json");
  const res = await fetchWithRetries(url.toString(), { headers: { accept: "application/json" } }, args.cdxAttempts);
  if (res.status === 429) throw new Error(`Internet Archive throttle: ${res.status} ${res.statusText}`);
  if (!res.ok) throw new Error(`CDX failed: ${res.status} ${res.statusText} ${url}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return [];
  const headers = data[0];
  return data.slice(1).filter(Array.isArray).map((row) => Object.fromEntries(headers.map((header, idx) => [header, row[idx] || ""])));
}

async function loadLatestInventory(latestFile) {
  const rowsByUrl = new Map();
  for (const row of readJson(latestFile, [])) {
    if (row?.original) rowsByUrl.set(inventoryKey(row.original), row);
  }
  const cdxProgressFile = path.join(args.root, "_wayback_cdx_windows_done.json");
  const cdxErrorsFile = path.join(args.root, "_wayback_cdx_windows_errors.json");
  const cdxDone = new Set(readJson(cdxProgressFile, []));
  const cdxErrors = readJson(cdxErrorsFile, []);
  for (const pattern of args.patterns) {
    const matchType = pattern.includes("/") || pattern.includes("*") ? "prefix" : "domain";
    for (let startYear = args.fromYear; startYear <= args.toYear; startYear += args.windowYears) {
      const endYear = Math.min(args.toYear, startYear + args.windowYears - 1);
      const windowKey = `${pattern}|${matchType}|${startYear}|${endYear}`;
      if (cdxDone.has(windowKey)) continue;
      await sleep(args.cdxDelayMs);
      let rows = [];
      try {
        rows = await cdxRows({
          url: pattern,
          matchType,
          from: `${startYear}0101`,
          to: `${endYear}1231`,
          fl: "urlkey,original,timestamp,statuscode,mimetype,digest,length",
          collapse: "urlkey",
          sort: "reverse",
          limit: 250000,
        });
      } catch (error) {
        const errorRow = {
          pattern,
          matchType,
          startYear,
          endYear,
          message: error.message || String(error),
          generatedAt: new Date().toISOString(),
        };
        cdxErrors.push(errorRow);
        writeJson(cdxErrorsFile, cdxErrors);
        if (args.stopOnCdxError) throw error;
        continue;
      }
      for (const row of rows) {
      const original = normalizeOriginal(row.original);
      if (!original) continue;
      if (args.skipNoise && isLikelyNoiseOriginal(original)) continue;
      const host = new URL(original).hostname.toLowerCase();
        if (host !== "nisra.gov.uk" && !host.endsWith(".nisra.gov.uk")) continue;
        const key = inventoryKey(original);
        const existing = rowsByUrl.get(key);
        if (!existing || String(row.timestamp) > String(existing.timestamp)) {
          rowsByUrl.set(key, { ...row, original });
        }
      }
      writeJson(latestFile, [...rowsByUrl.values()].sort((a, b) => a.original.localeCompare(b.original)));
      cdxDone.add(windowKey);
      writeJson(cdxProgressFile, [...cdxDone].sort());
    }
  }
  return [...rowsByUrl.values()].sort((a, b) => a.original.localeCompare(b.original));
}

async function loadCapturesForOriginal(original) {
  await sleep(args.cdxDelayMs);
  const rows = await cdxRows({
    url: original,
    matchType: "exact",
    fl: "original,timestamp,statuscode,mimetype,digest,length",
    sort: "reverse",
    limit: args.maxFallbacks,
  });
  return rows.map((row) => ({ ...row, original: normalizeOriginal(row.original) || original }));
}

function freeBytesForRoot(root) {
  // Avoid a dependency on Win32 APIs in Node: this is checked by the caller before
  // large runs via PowerShell. The script still creates roots safely.
  fs.mkdirSync(root, { recursive: true });
  return null;
}

async function downloadCapture(capture, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  const res = await fetchWithTimeout(rawCaptureUrl(capture), { headers: { accept: "*/*" } });
  if (!res.ok) throw new Error(`download replay HTTP ${res.status}`);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(partial);
    out.on("error", reject);
    out.on("finish", resolve);
    const nodeStream = Readable.fromWeb(res.body);
    nodeStream.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      hash.update(buffer);
    });
    nodeStream.on("error", reject);
    nodeStream.pipe(out);
  });
  fs.renameSync(partial, target);
  return { bytes, sha256: hash.digest("hex") };
}

async function main() {
  fs.mkdirSync(args.reportDir, { recursive: true });
  fs.mkdirSync(args.root, { recursive: true });
  freeBytesForRoot(args.root);

  const stamp = nowStamp();
  const latestFile = path.join(args.root, "_wayback_latest_inventory.json");
  const inventoryFile = path.join(args.root, "_wayback_recovery_inventory.json");
  const progressFile = path.join(args.root, "_wayback_recovery_progress.json");

  let latestRows = readJson(latestFile, null);
  if (!Array.isArray(latestRows) || args.retryUnavailable) {
    latestRows = await loadLatestInventory(latestFile);
    writeJson(latestFile, latestRows);
  }

  if (args.listOnly) {
    const stampForList = nowStamp();
    const summary = {
      generatedAt: new Date().toISOString(),
      mode: "list-only",
      root: args.root,
      currentRoot: args.currentRoot,
      patterns: args.patterns,
      latestInventoryCount: latestRows.length,
      latestLengthBytes: latestRows.reduce((sum, row) => {
        const value = Number(row.length || 0);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
      statusCodeCounts: latestRows.reduce((acc, row) => {
        acc[row.statuscode || ""] = (acc[row.statuscode || ""] || 0) + 1;
        return acc;
      }, {}),
      mimeTypeCounts: latestRows.reduce((acc, row) => {
        acc[row.mimetype || ""] = (acc[row.mimetype || ""] || 0) + 1;
        return acc;
      }, {}),
      inventoryFile: latestFile,
    };
    const summaryFile = path.join(args.reportDir, `nisra-wayback-list-${stampForList}-summary.json`);
    writeJson(summaryFile, summary);
    console.log(JSON.stringify({ ...summary, summaryFile }, null, 2));
    return;
  }

  const progress = readJson(progressFile, {});
  const recoveryInventory = readJson(inventoryFile, {});
  const digestTargets = new Map();
  for (const [key, row] of Object.entries(recoveryInventory)) {
    if (row.digest && row.localPath && row.status === "downloaded") digestTargets.set(row.digest, row.localPath);
  }

  const selectedRows = args.maxUrls > 0 ? latestRows.slice(0, args.maxUrls) : latestRows;
  const filteredRows = selectedRows.filter((row) => {
    if (args.status200Only && row.statuscode !== "200") return false;
    if (args.assetsOnly) {
      const mimetype = String(row.mimetype || "").toLowerCase();
      if (mimetype === "text/html" || mimetype === "warc/revisit") return false;
      if (!row.statuscode || row.statuscode === "404") return false;
    }
    return true;
  });
  const reportRows = [];
  let processedThisRun = 0;
  let downloadedThisRun = 0;

  for (const latest of filteredRows) {
    if (args.maxDownloads > 0 && downloadedThisRun >= args.maxDownloads) break;
    const key = inventoryKey(latest.original);
    if (!args.retryUnavailable && progress[key]) {
      reportRows.push(progress[key]);
      continue;
    }

    const baseRow = {
      original: latest.original,
      latestTimestamp: latest.timestamp,
      latestStatusCode: latest.statuscode,
      latestMimeType: latest.mimetype,
      latestDigest: latest.digest,
      latestLength: latest.length,
      selectedTimestamp: "",
      selectedDigest: "",
      selectedMimeType: "",
      selectedLength: "",
      attempts: 0,
      status: "",
      reason: "",
      localPath: "",
      duplicateOf: "",
      replayUrl: "",
      bytes: "",
      sha256: "",
    };

    try {
      if (isExistingCurrentFile(latest.original)) {
        const row = { ...baseRow, status: "already-present-current-mirror", reason: "matched-existing-D-nisra-url-path" };
        progress[key] = row;
        reportRows.push(row);
        continue;
      }

      let valid = null;
      let lastValidation = null;
      const latestMimeType = String(latest.mimetype || "").toLowerCase();
      if (
        args.trustCdxAssets
        && latest.statuscode === "200"
        && latestMimeType
        && latestMimeType !== "text/html"
        && latestMimeType !== "warc/revisit"
      ) {
        baseRow.attempts = 1;
        valid = latest;
      } else {
        const candidates = [latest];
        for (const capture of candidates) {
          baseRow.attempts += 1;
          const status = Number(capture.statuscode || 0);
          if (status && status !== 200 && status !== 206) {
            lastValidation = { ok: false, reason: `cdx-status-${capture.statuscode}` };
            continue;
          }
          const validation = await validateCapture(capture);
          lastValidation = validation;
          if (validation.ok) {
            valid = capture;
            break;
          }
          await sleep(args.delayMs);
        }
      }

      if (!valid) {
        const captures = await loadCapturesForOriginal(latest.original);
        for (const capture of captures.filter((capture) => capture.timestamp !== latest.timestamp)) {
          baseRow.attempts += 1;
          const status = Number(capture.statuscode || 0);
          if (status && status !== 200 && status !== 206) {
            lastValidation = { ok: false, reason: `cdx-status-${capture.statuscode}` };
            continue;
          }
          const validation = await validateCapture(capture);
          lastValidation = validation;
          if (validation.ok) {
            valid = capture;
            break;
          }
          await sleep(args.delayMs);
        }
      }

      if (!valid) {
        const row = {
          ...baseRow,
          status: "unavailable",
          reason: lastValidation?.reason || "no-valid-capture",
        };
        progress[key] = row;
        reportRows.push(row);
        continue;
      }

      const target = localPathForWayback(valid.original);
      const duplicateTarget = valid.digest ? digestTargets.get(valid.digest) : "";
      if (duplicateTarget && fs.existsSync(path.resolve(args.root, duplicateTarget))) {
        const row = {
          ...baseRow,
          selectedTimestamp: valid.timestamp,
          selectedDigest: valid.digest,
          selectedMimeType: valid.mimetype,
          selectedLength: valid.length,
          status: "duplicate-wayback-digest",
          reason: "same-cdx-digest-already-downloaded",
          duplicateOf: duplicateTarget,
          replayUrl: rawCaptureUrl(valid),
        };
        progress[key] = row;
        recoveryInventory[key] = row;
        reportRows.push(row);
        continue;
      }

      if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        const rel = path.relative(args.root, target);
        const row = {
          ...baseRow,
          selectedTimestamp: valid.timestamp,
          selectedDigest: valid.digest,
          selectedMimeType: valid.mimetype,
          selectedLength: valid.length,
          status: "already-present-wayback-mirror",
          reason: "local-wayback-path-exists",
          localPath: rel,
          replayUrl: rawCaptureUrl(valid),
        };
        progress[key] = row;
        recoveryInventory[key] = row;
        if (valid.digest) digestTargets.set(valid.digest, rel);
        reportRows.push(row);
        continue;
      }

      if (!args.download || args.inventoryOnly) {
        const row = {
          ...baseRow,
          selectedTimestamp: valid.timestamp,
          selectedDigest: valid.digest,
          selectedMimeType: valid.mimetype,
          selectedLength: valid.length,
          status: "would-download",
          reason: "valid-missing-capture",
          localPath: path.relative(args.root, target),
          replayUrl: rawCaptureUrl(valid),
        };
        progress[key] = row;
        recoveryInventory[key] = row;
        reportRows.push(row);
        continue;
      }

      await sleep(args.delayMs);
      const downloaded = await downloadCapture(valid, target);
      const rel = path.relative(args.root, target);
      const row = {
        ...baseRow,
        selectedTimestamp: valid.timestamp,
        selectedDigest: valid.digest,
        selectedMimeType: valid.mimetype,
        selectedLength: valid.length,
        status: "downloaded",
        reason: "downloaded-latest-valid-capture",
        localPath: rel,
        replayUrl: rawCaptureUrl(valid),
        bytes: downloaded.bytes,
        sha256: downloaded.sha256,
      };
      progress[key] = row;
      recoveryInventory[key] = row;
      if (valid.digest) digestTargets.set(valid.digest, rel);
      reportRows.push(row);
      processedThisRun += 1;
      downloadedThisRun += 1;
    } catch (error) {
      const row = {
        ...baseRow,
        status: "failed",
        reason: error.message || String(error),
      };
      progress[key] = row;
      reportRows.push(row);
      if (/429|throttle/i.test(row.reason)) {
        writeJson(progressFile, progress);
        writeJson(inventoryFile, recoveryInventory);
        throw new Error(`Stopping on likely Internet Archive throttle: ${row.reason}`);
      }
    }

    writeJson(progressFile, progress);
    writeJson(inventoryFile, recoveryInventory);
  }

  const rows = Object.values(progress).sort((a, b) => String(a.original).localeCompare(String(b.original)));
  const columns = [
    "status",
    "reason",
    "original",
    "latestTimestamp",
    "selectedTimestamp",
    "attempts",
    "latestStatusCode",
    "latestMimeType",
    "selectedMimeType",
    "latestLength",
    "selectedLength",
    "latestDigest",
    "selectedDigest",
    "bytes",
    "sha256",
    "localPath",
    "duplicateOf",
    "replayUrl",
  ];
  const reportCsv = path.join(args.reportDir, `nisra-wayback-recovery-${stamp}.csv`);
  const reportJson = path.join(args.reportDir, `nisra-wayback-recovery-${stamp}-summary.json`);
  writeCsv(reportCsv, rows, columns);

  const summary = {
    generatedAt: new Date().toISOString(),
    root: args.root,
    currentRoot: args.currentRoot,
    patterns: args.patterns,
    latestInventoryCount: latestRows.length,
    filteredInventoryCount: filteredRows.length,
    processedRows: rows.length,
    processedThisRun,
    downloadedThisRun,
    reportCsv,
    counts: rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {}),
    selectedLengthBytes: rows.reduce((sum, row) => {
      const value = Number(row.selectedLength || row.latestLength || 0);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0),
    downloadedBytes: rows.reduce((sum, row) => {
      const value = Number(row.bytes || 0);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0),
  };
  writeJson(reportJson, summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
