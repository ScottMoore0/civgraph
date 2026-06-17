#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const UA = "Civgraph Tailte completeness audit/1.0 (+https://civgraph.net)";
const SERVICE_FORMATS = new Set([
  "API",
  "ARCGIS",
  "ARCGIS_GEOSERVICE",
  "ESRI REST",
  "ESRI REST API",
  "GEOJSON API",
  "HTML",
  "JSON API",
  "WEBPAGE",
  "WFS",
  "WMS",
  "WMTS",
]);
const TAILTE_RE = /(tailte|ordnance survey ireland|osi\b|geohive|national mapping|landdirect|property registration|prime2|boundary data|cadastral|land cover)/i;

function readArg(name, fallback = null) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const args = {
  root: path.resolve(readArg("--datagovie-root", "D:\\datagovie")),
  reportDir: path.resolve(readArg("--report-dir", path.join("data", "provider-mirror-audit"))),
  download: process.argv.includes("--download"),
  canonicalMissingOnly: process.argv.includes("--canonical-missing-only"),
  skipHead: process.argv.includes("--no-head"),
  headLimit: Number(readArg("--head-limit", Infinity)),
  headConcurrency: Math.max(1, Math.min(32, Number(readArg("--head-concurrency", 8)))),
  downloadTimeoutMs: Number(readArg("--download-timeout-ms", 0)),
  downloadAttempts: Math.max(1, Number(readArg("--download-attempts", 12))),
  downloadPollMs: Number(readArg("--download-poll-ms", 30000)),
  minFreeGb: Number(readArg("--min-free-gb", 5)),
  rows: Number(readArg("--rows", 1000)),
};

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function readManifest(root) {
  const manifest = path.join(root, "_manifest.csv");
  if (!fs.existsSync(manifest)) return [];
  return parseCsv(fs.readFileSync(manifest, "utf8"));
}

function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    return new URL(s).toString();
  } catch {
    return "";
  }
}

function isDownloadable(resource) {
  const format = String(resource.format || resource.mimetype || "").trim().toUpperCase();
  const url = normalizeUrl(resource.url);
  if (!url) return false;
  if (SERVICE_FORMATS.has(format)) return false;
  if (/\/query(?:\?|$)|\/MapServer(?:\/|$)|\/FeatureServer(?:\/|$)|\/wms|\/wfs|\/wmts/i.test(url)) return false;
  return true;
}

function sanitizeSegment(value, fallback = "_") {
  const s = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (s || fallback).slice(0, 150);
}

function extForFormat(formatRaw) {
  const format = String(formatRaw || "").toUpperCase();
  if (format.includes("CSV")) return ".csv";
  if (format.includes("GEOJSON")) return ".geojson";
  if (format.includes("JSON")) return ".json";
  if (format.includes("PDF")) return ".pdf";
  if (format.includes("ZIP") || format.includes("SHAPE")) return ".zip";
  if (format.includes("GPKG") || format.includes("GEOPACKAGE")) return ".gpkg";
  if (format.includes("KML")) return ".kml";
  if (format.includes("XLSX")) return ".xlsx";
  if (format.includes("XLS")) return ".xls";
  return "";
}

function resourceFilename(resource) {
  let base = "";
  try {
    base = decodeURIComponent(path.posix.basename(new URL(resource.url).pathname));
  } catch {
    base = "";
  }
  const fromName = resource.name || resource.title || resource.id || "resource";
  const candidate = base && base.toLowerCase() !== "download" ? base : fromName;
  const suffix = /\.[a-z0-9]{1,8}$/i.test(candidate) ? "" : extForFormat(resource.format || resource.mimetype || "");
  return sanitizeSegment(`${candidate}${suffix}`, "resource");
}

function formatPriority(formatRaw) {
  const format = String(formatRaw || "").toUpperCase();
  if (format === "ZIP" || format.includes("FILE GEODATABASE")) return 0;
  if (format === "GPKG" || format.includes("GEOPACKAGE")) return 1;
  if (format === "GDB" || format.includes("SQLITE")) return 2;
  if (format.includes("GEOJSON")) return 3;
  if (format.includes("CSV")) return 4;
  if (format.includes("KML")) return 5;
  if (format.includes("XLS")) return 6;
  if (format.includes("TXT") || format.includes("FEATURE COLLECTION")) return 7;
  return 99;
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

function targetPathFor(pkg, resource) {
  return safeResolve(args.root, path.join(
    sanitizeSegment(pkg.organization?.title || pkg.organization?.name || "Tailte Eireann"),
    sanitizeSegment(pkg.title || pkg.name || "package"),
    resourceFilename(resource),
  ));
}

function isArcgisPendingPlaceholder(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 4096) return false;
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text.startsWith("{")) return false;
    const parsed = JSON.parse(text);
    return String(parsed.status || "").toLowerCase() === "pending" || /download file is being generated/i.test(String(parsed.message || ""));
  } catch {
    return false;
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

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept": "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function searchPackages(query, fq = "") {
  const packages = new Map();
  let start = 0;
  while (true) {
    const url = new URL("https://data.gov.ie/api/3/action/package_search");
    if (query) url.searchParams.set("q", query);
    if (fq) url.searchParams.set("fq", fq);
    url.searchParams.set("rows", String(args.rows));
    url.searchParams.set("start", String(start));
    const data = await fetchJson(url);
    const result = data?.result;
    for (const pkg of result?.results || []) packages.set(pkg.id || pkg.name, pkg);
    start += args.rows;
    if (!result || start >= Number(result.count || 0)) break;
  }
  return packages;
}

async function headSize(url) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { status: `${res.status} ${res.statusText}`, bytes: 0 };
    const n = Number(res.headers.get("content-length") || 0);
    return { status: "ok", bytes: Number.isFinite(n) ? n : 0 };
  } catch (error) {
    return { status: `failed: ${error.message}`, bytes: 0 };
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

async function downloadFile(url, output) {
  const partial = `${output}.partial`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  for (let attempt = 1; attempt <= args.downloadAttempts; attempt += 1) {
    const fetchOptions = { headers: { "user-agent": UA } };
    if (args.downloadTimeoutMs > 0) fetchOptions.signal = AbortSignal.timeout(args.downloadTimeoutMs);
    const res = await fetch(url, fetchOptions);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    await new Promise((resolve, reject) => {
      const readable = Readable.fromWeb(res.body);
      const file = fs.createWriteStream(partial);
      readable.on("error", reject);
      file.on("finish", resolve);
      file.on("error", reject);
      readable.pipe(file);
    });
    if (!isArcgisPendingPlaceholder(partial)) break;
    fs.rmSync(partial, { force: true });
    if (attempt === args.downloadAttempts) throw new Error("ArcGIS export is still pending after polling");
    await new Promise((resolve) => setTimeout(resolve, args.downloadPollMs));
  }
  if (fs.existsSync(output)) fs.rmSync(output, { force: true });
  fs.renameSync(partial, output);
  const digest = await sha256File(output);
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, "utf8");
  return { bytes: fs.statSync(output).size, sha256: digest };
}

async function mapLimit(items, workerCount, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function main() {
  fs.mkdirSync(args.reportDir, { recursive: true });
  fs.mkdirSync(args.root, { recursive: true });
  const stamp = nowStamp();
  const manifestRows = readManifest(args.root);
  const knownByUrl = new Map(manifestRows.map((row) => [normalizeUrl(row.url), row]));
  const knownById = new Map(manifestRows.filter((row) => row.resource_id).map((row) => [row.resource_id, row]));

  const packages = new Map();
  const searches = [
    { query: "", fq: "organization:tailte-eireann" },
  ];
  if (process.argv.includes("--broad-search")) {
    searches.push(
      { query: "Tailte", fq: "" },
      { query: "\"Ordnance Survey Ireland\"", fq: "" },
      { query: "GeoHive", fq: "" },
      { query: "\"National Mapping\"", fq: "" },
      { query: "Landdirect", fq: "" },
      { query: "\"Property Registration\"", fq: "" },
    );
  }
  for (const { query, fq } of searches) {
    const found = await searchPackages(query, fq);
    for (const [key, value] of found) packages.set(key, value);
  }

  const rows = [];
  for (const pkg of packages.values()) {
    const haystack = `${pkg.title || ""} ${pkg.name || ""} ${pkg.notes || ""} ${pkg.organization?.title || ""} ${pkg.organization?.name || ""}`;
    const packageLooksTailte = TAILTE_RE.test(haystack);
    for (const resource of pkg.resources || []) {
      const resourceHaystack = `${resource.name || ""} ${resource.description || ""} ${resource.format || ""} ${resource.url || ""}`;
      if (!packageLooksTailte && !TAILTE_RE.test(resourceHaystack)) continue;
      const url = normalizeUrl(resource.url);
      const targetPath = targetPathFor(pkg, resource);
      const manifest = knownById.get(resource.id || "") || knownByUrl.get(url);
      const exists = fs.existsSync(targetPath) && !isArcgisPendingPlaceholder(targetPath);
      const downloadable = isDownloadable(resource);
      rows.push({
        packageId: pkg.id || pkg.name || "",
        packageName: pkg.name || "",
        packageTitle: pkg.title || "",
        organization: pkg.organization?.title || pkg.organization?.name || "",
        resourceId: resource.id || "",
        resourceName: resource.name || "",
        format: resource.format || "",
        url,
        downloadable,
        manifestStatus: manifest?.status || "",
        manifestTarget: manifest?.target_path || "",
        targetPath,
        status: exists || manifest?.status === "ok" ? "present" : (downloadable ? "missing-downloadable" : "service-or-non-downloadable"),
        expectedBytes: 0,
        bytes: exists ? fs.statSync(targetPath).size : 0,
        error: "",
      });
    }
  }

  console.error(`Tailte audit: matched ${packages.size} packages and ${rows.length} resource rows.`);
  const missingRows = rows.filter((row) => row.status === "missing-downloadable");
  const headRows = [];
  for (const row of missingRows) {
    if (args.skipHead || headRows.length >= args.headLimit) {
      row.headStatus = args.skipHead ? "skipped" : "head-limit-skipped";
      continue;
    }
    headRows.push(row);
  }
  let headCount = 0;
  await mapLimit(headRows, args.headConcurrency, async (row) => {
    const head = await headSize(row.url);
    row.headStatus = head.status;
    row.expectedBytes = head.bytes || 0;
    headCount += 1;
  });

  let canonicalSelected = 0;
  if (args.canonicalMissingOnly) {
    const byPackage = new Map();
    for (const row of rows) {
      const key = row.packageId || row.packageName;
      if (!byPackage.has(key)) byPackage.set(key, []);
      byPackage.get(key).push(row);
    }
    const selected = new Set();
    for (const packageRows of byPackage.values()) {
      const hasPresent = packageRows.some((row) => row.status === "present");
      if (hasPresent) {
        for (const row of packageRows) {
          if (row.status === "missing-downloadable") row.status = "skipped-alternate-package-present";
        }
        continue;
      }
      const candidates = packageRows
        .filter((row) => row.status === "missing-downloadable")
        .sort((a, b) => formatPriority(a.format) - formatPriority(b.format) || Number(b.expectedBytes || 0) - Number(a.expectedBytes || 0));
      if (!candidates.length) continue;
      selected.add(candidates[0]);
      canonicalSelected += 1;
      for (const row of candidates.slice(1)) row.status = "skipped-alternate-canonical";
    }
    for (const row of rows) {
      if (row.status === "missing-downloadable" && !selected.has(row)) row.status = "skipped-alternate-canonical";
    }
  }

  const pendingBytes = rows.filter((row) => row.status === "missing-downloadable").reduce((sum, row) => sum + Number(row.expectedBytes || 0), 0);
  const freeBytes = freeBytesForRoot(args.root);
  if (args.download && freeBytes != null && pendingBytes + args.minFreeGb * 1000 ** 3 > freeBytes) {
    throw new Error(`D: free-space guard failed: pending known bytes ${pendingBytes}, free bytes ${freeBytes}`);
  }

  if (args.download) {
    for (const row of rows) {
      if (row.status !== "missing-downloadable") continue;
      try {
        const result = await downloadFile(row.url, row.targetPath);
        row.status = "downloaded";
        row.bytes = result.bytes;
        row.sha256 = result.sha256;
      } catch (error) {
        row.status = "failed";
        row.error = error.message;
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    dataGovPackagesMatched: packages.size,
    tailteResourceRows: rows.length,
    present: rows.filter((row) => row.status === "present").length,
    missingDownloadable: rows.filter((row) => row.status === "missing-downloadable").length,
    downloaded: rows.filter((row) => row.status === "downloaded").length,
    failed: rows.filter((row) => row.status === "failed").length,
    serviceOrNonDownloadable: rows.filter((row) => row.status === "service-or-non-downloadable").length,
    skippedAlternatePackagePresent: rows.filter((row) => row.status === "skipped-alternate-package-present").length,
    skippedAlternateCanonical: rows.filter((row) => row.status === "skipped-alternate-canonical").length,
    canonicalSelected,
    headProbed: headCount,
    headSkipped: rows.filter((row) => row.status === "missing-downloadable" && (row.headStatus === "skipped" || row.headStatus === "head-limit-skipped")).length,
    pendingKnownBytes: pendingBytes,
    freeBytesAfter: freeBytesForRoot(args.root),
  };

  const summaryPath = path.join(args.reportDir, `tailte-completeness-${stamp}-summary.json`);
  const rowsPath = path.join(args.reportDir, `tailte-completeness-${stamp}-resources.csv`);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeCsv(rowsPath, rows, ["packageId", "packageName", "packageTitle", "organization", "resourceId", "resourceName", "format", "url", "downloadable", "manifestStatus", "manifestTarget", "targetPath", "status", "headStatus", "expectedBytes", "bytes", "error", "sha256"]);
  console.log(JSON.stringify({ summaryPath, rowsPath, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
