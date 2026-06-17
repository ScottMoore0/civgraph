#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const ASSET_EXTS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".geojson",
  ".gpkg",
  ".json",
  ".ods",
  ".pdf",
  ".tsv",
  ".xls",
  ".xlsm",
  ".xlsx",
  ".zip",
]);
const NON_PAGE_EXTS = new Set([
  ...ASSET_EXTS,
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".map",
  ".png",
  ".svg",
  ".webmanifest",
  ".webp",
  ".xml",
]);

const BASE = "https://www.nisra.gov.uk";
const UA = "Civgraph NISRA mirror completion/1.0 (+https://civgraph.net; polite archival crawl)";

function readArg(name, fallback = null) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const args = {
  root: path.resolve(readArg("--root", "D:\\nisra")),
  reportDir: path.resolve(readArg("--report-dir", path.join("data", "provider-mirror-audit"))),
  download: process.argv.includes("--download"),
  ignorePagesSeen: process.argv.includes("--ignore-pages-seen"),
  skipPages: process.argv.includes("--skip-pages"),
  skipHead: process.argv.includes("--skip-head"),
  maxPages: Number(readArg("--max-pages", 0)),
  maxDownloads: Number(readArg("--max-downloads", 0)),
  delayMs: Number(readArg("--delay-ms", 250)),
  assetDelayMs: Number(readArg("--asset-delay-ms", 1000)),
  requestTimeoutMs: Number(readArg("--request-timeout-ms", 30000)),
  minFreeGb: Number(readArg("--min-free-gb", 5)),
  stopOnThrottle: !process.argv.includes("--no-stop-on-throttle"),
};

const BLOCKED_OR_STALE_STATUSES = new Set([401, 403, 404, 410]);

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
  fs.writeFileSync(file, `${[columns.join(","), ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(","))].join("\n")}\n`, "utf8");
}

function loadLines(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function appendLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${line}\n`, "utf8");
}

function loadInventory(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const normalized = {};
    for (const [url, target] of Object.entries(parsed)) {
      normalized[inventoryKey(url)] = target;
    }
    return normalized;
  } catch {
    return {};
  }
}

function saveInventory(file, inventory) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = {};
  for (const [url, target] of Object.entries(inventory)) {
    normalized[inventoryKey(url)] = target;
  }
  fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`, "utf8");
}

function normalizeUrl(raw, base = BASE) {
  try {
    const url = new URL(String(raw || "").trim(), base);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function withoutQuery(url) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function inventoryKey(url) {
  try {
    const parsed = new URL(url);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    return parsed.toString().toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

function isNisraPage(url) {
  const parsed = new URL(url);
  const ext = path.extname(parsed.pathname).toLowerCase();
  return parsed.hostname === "www.nisra.gov.uk" && !NON_PAGE_EXTS.has(ext);
}

function isNisraAsset(url) {
  const parsed = new URL(url);
  return parsed.hostname.endsWith("nisra.gov.uk") && ASSET_EXTS.has(path.extname(parsed.pathname).toLowerCase());
}

function localPathForAsset(url) {
  const parsed = new URL(url);
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, "") || "download";
  return safeResolve(args.root, path.join("mirror", rel));
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

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) continue;
    const normalized = normalizeUrl(raw.replaceAll("&amp;", "&"), baseUrl);
    if (normalized) links.push(normalized);
  }
  return links;
}

function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function loadDiscoveredAssets(file) {
  const assets = new Map();
  if (!fs.existsSync(file)) return assets;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.url && isNisraAsset(row.url) && !assets.has(row.url)) {
        assets.set(row.url, { url: row.url, sourcePage: row.sourcePage || "" });
      }
    } catch {
      // Ignore malformed scratch rows; later validation reports missing assets.
    }
  }
  return assets;
}

function persistFrontier(file, pageQueue, pagesSeen) {
  const remaining = pageQueue.filter((url) => !pagesSeen.has(url));
  fs.writeFileSync(file, `${remaining.join("\n")}\n`, "utf8");
}

async function fetchText(url) {
  const res = await fetchWithRetries(url, { headers: { "user-agent": UA, "accept": "text/html,application/xml,text/xml" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchWithRetries(url, options = {}, attempts = 4) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout ${args.requestTimeoutMs}ms`)), args.requestTimeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || attempt === attempts || ![408, 429, 500, 502, 503, 504].includes(res.status)) return res;
      lastResponse = res;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(Math.min(30000, 1500 * attempt * attempt));
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("fetch failed");
}

async function fetchSitemaps() {
  const queue = [`${BASE}/sitemap.xml`];
  const seen = new Set();
  const pages = new Set([BASE]);
  while (queue.length) {
    const sitemap = queue.shift();
    if (!sitemap || seen.has(sitemap)) continue;
    seen.add(sitemap);
    try {
      const xml = await fetchText(sitemap);
      for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
        const url = normalizeUrl(match[1]);
        if (!url) continue;
        if (/\.xml(?:$|\?)/i.test(new URL(url).pathname)) queue.push(url);
        else if (isNisraPage(url)) pages.add(withoutQuery(url));
        else if (isNisraAsset(url)) pages.add(url);
      }
    } catch (error) {
      // Keep going; sitemap outages should not block page-link discovery.
      console.warn(`sitemap failed: ${sitemap}: ${error.message}`);
    }
  }
  return pages;
}

async function headSize(url) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "user-agent": UA } });
    if (!res.ok) return { status: `${res.status} ${res.statusText}`, bytes: 0 };
    const n = Number(res.headers.get("content-length") || 0);
    return { status: "ok", bytes: Number.isFinite(n) ? n : 0 };
  } catch (error) {
    return { status: `failed: ${error.message}`, bytes: 0 };
  }
}

function freeBytesForRoot(root) {
  try {
    const parsed = path.parse(path.resolve(root));
    const stat = fs.statfsSync(parsed.root || root);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadAsset(url, output) {
  const partial = `${output}.partial`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const res = await fetchWithRetries(url, { headers: { "user-agent": UA } }, 5);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const file = fs.createWriteStream(partial);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
  fs.renameSync(partial, output);
  const digest = await sha256File(output);
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, "utf8");
  return { bytes: fs.statSync(output).size, sha256: digest };
}

function shouldAbortDownload(error) {
  const message = error?.message || String(error || "");
  if (/^429\b/.test(message)) return true;
  if (/^5\d\d\b/.test(message)) return true;
  if (/timeout|abort/i.test(message)) return true;
  return false;
}

async function main() {
  fs.mkdirSync(args.root, { recursive: true });
  fs.mkdirSync(args.reportDir, { recursive: true });

  const stamp = nowStamp();
  const inventoryPath = path.join(args.root, "_inventory.json");
  const pagesSeenPath = path.join(args.root, "_pages_seen.txt");
  const frontierPath = path.join(args.root, "_frontier.txt");
  const assetDiscoveryPath = path.join(args.root, "_assets_discovered.jsonl");
  const summaryPath = path.join(args.reportDir, `nisra-complete-${stamp}-summary.json`);
  const assetsPath = path.join(args.reportDir, `nisra-complete-${stamp}-assets.csv`);
  const pagesPath = path.join(args.reportDir, `nisra-complete-${stamp}-pages.csv`);
  const inventory = loadInventory(inventoryPath);
  const pagesSeen = loadLines(pagesSeenPath);
  const frontier = [...loadLines(frontierPath)].filter(isNisraPage);
  const assets = loadDiscoveredAssets(assetDiscoveryPath);
  const persistedAssetUrls = new Set(assets.keys());

  const sitemapPages = args.skipPages ? new Set() : await fetchSitemaps();
  const pageQueue = args.skipPages ? [] : [...new Set([...frontier, ...sitemapPages].filter((url) => !isNisraAsset(url)))];
  if (!args.skipPages && !pageQueue.includes(BASE)) pageQueue.unshift(BASE);
  const queuedPages = new Set(pageQueue);
  const pageRows = [];
  let processed = 0;

  function writePageProgress(status) {
    persistFrontier(frontierPath, pageQueue, pagesSeen);
    writeCsv(pagesPath, pageRows, ["url", "status", "assetLinks", "error"]);
    fs.writeFileSync(summaryPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      root: args.root,
      download: args.download,
      partial: true,
      status,
      pageCandidates: queuedPages.size,
      pagesProcessed: pageRows.length,
      pageFailures: pageRows.filter((row) => row.status === "failed").length,
      assetsDiscovered: assets.size,
      frontierRemaining: pageQueue.filter((url) => !pagesSeen.has(url)).length,
      freeBytesAfter: freeBytesForRoot(args.root),
    }, null, 2)}\n`, "utf8");
  }

  while (!args.skipPages && pageQueue.length) {
    const pageUrl = pageQueue.shift();
    if (args.maxPages && processed >= args.maxPages) break;
    if (!args.ignorePagesSeen && pagesSeen.has(pageUrl)) continue;
    try {
      const html = await fetchText(pageUrl);
      const links = extractLinks(html, pageUrl);
      let assetLinks = 0;
      for (const link of links) {
        const clean = withoutQuery(link);
        if (isNisraAsset(clean)) {
          assets.set(clean, { url: clean, sourcePage: pageUrl });
          if (!persistedAssetUrls.has(clean)) {
            appendJsonLine(assetDiscoveryPath, { url: clean, sourcePage: pageUrl, discoveredAt: new Date().toISOString() });
            persistedAssetUrls.add(clean);
          }
          assetLinks += 1;
        } else if (isNisraPage(clean) && !queuedPages.has(clean)) {
          if (!args.ignorePagesSeen && pagesSeen.has(clean)) continue;
          queuedPages.add(clean);
          pageQueue.push(clean);
        }
      }
      pageRows.push({ url: pageUrl, status: "ok", assetLinks, error: "" });
      appendLine(pagesSeenPath, pageUrl);
      pagesSeen.add(pageUrl);
      processed += 1;
    } catch (error) {
      pageRows.push({ url: pageUrl, status: "failed", assetLinks: 0, error: error.message });
    }
    if (pageRows.length % 100 === 0) writePageProgress("crawling-pages");
    if (args.delayMs > 0) await sleep(args.delayMs);
  }
  writePageProgress("page-crawl-complete");

  const assetRows = [];
  for (const asset of assets.values()) {
    const output = localPathForAsset(asset.url);
    const existing = fs.existsSync(output) ? fs.statSync(output).size : 0;
    const inInventory = Boolean(inventory[inventoryKey(asset.url)]);
    const head = existing || inInventory
      ? { status: "skipped", bytes: existing }
      : args.skipHead
        ? { status: "skipped", bytes: 0 }
        : await headSize(asset.url);
    assetRows.push({
      url: asset.url,
      sourcePage: asset.sourcePage,
      output,
      status: existing || inInventory ? "already-present" : "pending",
      headStatus: head.status,
      expectedBytes: head.bytes || 0,
      bytes: existing,
      error: "",
    });
    if (!args.skipHead && !existing && !inInventory && args.delayMs > 0) await sleep(Math.min(args.delayMs, 250));
  }

  const pendingBytes = assetRows.filter((row) => row.status === "pending").reduce((sum, row) => sum + Number(row.expectedBytes || 0), 0);
  const freeBytes = freeBytesForRoot(args.root);
  const minFreeBytes = args.minFreeGb * 1000 ** 3;
  if (args.download && freeBytes != null && pendingBytes + minFreeBytes > freeBytes) {
    throw new Error(`D: free-space guard failed: pending known bytes ${pendingBytes}, min free bytes ${minFreeBytes}, free bytes ${freeBytes}`);
  }

  if (args.download) {
    let downloadAttempts = 0;
    let stoppedReason = "";
    for (const row of assetRows) {
      if (row.status !== "pending") continue;
      if (args.maxDownloads && downloadAttempts >= args.maxDownloads) {
        row.status = "deferred";
        row.error = `deferred after max-downloads=${args.maxDownloads}`;
        continue;
      }
      downloadAttempts += 1;
      try {
        const result = await downloadAsset(row.url, row.output);
        row.status = "downloaded";
        row.bytes = result.bytes;
        row.sha256 = result.sha256;
        inventory[inventoryKey(row.url)] = row.output;
      } catch (error) {
        const statusMatch = String(error.message || "").match(/^(\d{3})\b/);
        const status = statusMatch ? Number(statusMatch[1]) : 0;
        row.status = BLOCKED_OR_STALE_STATUSES.has(status) ? "blocked-or-stale" : "failed";
        row.error = error.message;
        if (args.stopOnThrottle && shouldAbortDownload(error)) {
          saveInventory(inventoryPath, inventory);
          stoppedReason = `Stopping bounded download after ${row.error} for ${row.url}`;
          break;
        }
      }
      saveInventory(inventoryPath, inventory);
      if (args.assetDelayMs > 0) await sleep(args.assetDelayMs);
    }
    if (stoppedReason) {
      for (const row of assetRows) {
        if (row.status === "pending") {
          row.status = "deferred";
          row.error = stoppedReason;
        }
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    root: args.root,
    download: args.download,
    pageCandidates: queuedPages.size,
    pagesProcessed: pageRows.length,
    pageFailures: pageRows.filter((row) => row.status === "failed").length,
    assetsDiscovered: assetRows.length,
    alreadyPresent: assetRows.filter((row) => row.status === "already-present").length,
    downloaded: assetRows.filter((row) => row.status === "downloaded").length,
    failed: assetRows.filter((row) => row.status === "failed").length,
    blockedOrStale: assetRows.filter((row) => row.status === "blocked-or-stale").length,
    deferred: assetRows.filter((row) => row.status === "deferred").length,
    stopped: assetRows.some((row) => row.status === "deferred" && /^Stopping bounded download/.test(row.error)),
    pendingKnownBytes: pendingBytes,
    freeBytesAfter: freeBytesForRoot(args.root),
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeCsv(assetsPath, assetRows, ["url", "sourcePage", "output", "status", "headStatus", "expectedBytes", "bytes", "error", "sha256"]);
  writeCsv(pagesPath, pageRows, ["url", "status", "assetLinks", "error"]);

  console.log(JSON.stringify({ summaryPath, assetsPath, pagesPath, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
