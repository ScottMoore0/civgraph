#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

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

const DEFAULT_UA = "Mozilla/5.0 Civgraph provider mirror repair/1.0";

function usage() {
  console.log(`Usage:
  node scripts/repair-provider-mirrors.mjs [--download] [--max-gb 200]
       [--opendatani-root D:\\opendatani] [--datagovie-root D:\\datagovie]
       [--report-dir data\\provider-mirror-audit] [--limit N]

Dry-run is the default. The script never deletes files and never rewrites the
original provider manifests in place. Download mode writes .partial files and
then atomically renames completed files.`);
}

function parseArgs(argv) {
  const args = {
    download: false,
    maxGb: 200,
    opendataniRoot: "D:\\opendatani",
    datagovieRoot: "D:\\datagovie",
    reportDir: path.join(repoRoot, "data", "provider-mirror-audit"),
    limit: 0,
    minFreeGb: 5,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--download") args.download = true;
    else if (a === "--dry-run") args.download = false;
    else if (a === "--max-gb") args.maxGb = Number(argv[++i]);
    else if (a === "--opendatani-root") args.opendataniRoot = argv[++i];
    else if (a === "--datagovie-root") args.datagovieRoot = argv[++i];
    else if (a === "--report-dir") args.reportDir = path.resolve(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--min-free-gb") args.minFreeGb = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!Number.isFinite(args.maxGb) || args.maxGb <= 0) throw new Error("--max-gb must be positive");
  return args;
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (quoted) {
      if (c === '"' && n === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      continue;
    } else if (c === "\n") {
      row.push(cell);
      if (row.some((v) => v.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some((v) => v.length)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const out = {};
    headers.forEach((h, idx) => {
      out[h] = r[idx] ?? "";
    });
    return out;
  });
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function writeCsv(file, rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function asInt(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (Math.abs(n) >= 1000 && i < units.length - 1) {
    n /= 1000;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function sanitizeSegment(value, fallback = "_") {
  const s = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (s || fallback).slice(0, 150);
}

function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s || !/^https?:\/\//i.test(s)) return "";
  try {
    return new URL(s).href;
  } catch {
    try {
      return new URL(encodeURI(s)).href;
    } catch {
      return "";
    }
  }
}

function urlBasename(url) {
  try {
    const u = new URL(url);
    const decoded = decodeURIComponent(path.posix.basename(u.pathname));
    return decoded && decoded !== "/" ? decoded : "";
  } catch {
    return "";
  }
}

function filenameFromResource(resource) {
  const fromUrl = urlBasename(resource.url || "");
  const name = resource.resource_name || resource.name || resource.title || resource.resource_id || resource.id || "resource";
  const candidate = fromUrl && fromUrl.toLowerCase() !== "download" ? fromUrl : name;
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(candidate);
  const ext = hasExt ? "" : extensionForFormat(resource.format || resource.mimetype || "");
  return sanitizeSegment(`${candidate}${ext}`);
}

function extensionForFormat(formatRaw) {
  const format = String(formatRaw || "").toUpperCase();
  if (format.includes("CSV")) return ".csv";
  if (format.includes("GEOJSON")) return ".geojson";
  if (format.includes("JSON")) return ".json";
  if (format.includes("PDF")) return ".pdf";
  if (format.includes("ZIP")) return ".zip";
  if (format.includes("XLSX")) return ".xlsx";
  if (format.includes("XLS")) return ".xls";
  if (format.includes("SHAPE")) return ".zip";
  if (format.includes("XML")) return ".xml";
  return "";
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

function findFirstExistingPath(row, root) {
  for (const key of ["target_path", "path", "file", "local_path", "dest", "destination"]) {
    if (row[key]) return safeResolve(root, row[key]);
  }
  return "";
}

function loadManifestRows(root) {
  const manifest = path.join(root, "_manifest.csv");
  return parseCsv(readTextIfExists(manifest));
}

function getStatus(row) {
  return String(row.status || row.result || "").trim().toLowerCase();
}

function getUrl(row) {
  for (const key of ["url", "source_url", "download_url", "resource_url"]) {
    if (row[key]) return normalizeUrl(row[key]);
  }
  return "";
}

function getExpectedSize(row) {
  for (const key of ["expected_size", "size", "bytes", "content_length", "resolved_size"]) {
    const n = asInt(row[key]);
    if (n > 0) return n;
  }
  return 0;
}

function manifestRelativePath(row, root, provider) {
  const existing = findFirstExistingPath(row, root);
  if (existing) return path.relative(root, existing);
  if (provider === "opendatani") {
    return path.join(
      sanitizeSegment(row.organization_name || row.organization_title || "unknown-org"),
      sanitizeSegment(row.package_name || row.package_title || "unknown-package"),
      filenameFromResource(row),
    );
  }
  return path.join(
    sanitizeSegment(row.organization_name || row.organization_title || "unknown-org"),
    sanitizeSegment(row.package_name || row.package_title || "unknown-package"),
    filenameFromResource(row),
  );
}

function isServiceLike(row) {
  const format = String(row.format || row.mimetype || "").toUpperCase().trim();
  if (SERVICE_FORMATS.has(format)) return true;
  const url = String(row.url || "").toLowerCase();
  if (/\/wms|\/wfs|\/wmts|\/arcgis\/rest|service=wms|service=wfs|service=wmts/.test(url)) return true;
  if (/\/(?:mapserver|featureserver)(?:\/\d+)?(?:\?.*)?$/.test(url)) return true;
  if (/\/server\/rest\/services\//.test(url) && /\/(?:mapserver|featureserver)(?:\/\d+)?(?:\?.*)?$/.test(url)) return true;
  return false;
}

function buildOpenDataNiManifestFailures(root) {
  return loadManifestRows(root)
    .filter((row) => getStatus(row) === "failed")
    .map((row) => ({
      provider: "opendatani",
      source: "manifest-failed",
      resourceId: row.resource_id || row.id || "",
      packageId: row.package_id || "",
      packageName: row.package_name || "",
      organization: row.organization_name || row.organization_title || "",
      title: row.resource_name || row.name || row.title || "",
      format: row.format || "",
      url: getUrl(row),
      expectedSize: getExpectedSize(row),
      downloadedSize: asInt(row.bytes_written || row.downloaded_size || row.downloaded_bytes || row.size_downloaded),
      relativePath: manifestRelativePath(row, root, "opendatani"),
      root,
      skipReason: "",
    }));
}

function buildDataGovIeManifestFailures(root) {
  return loadManifestRows(root)
    .filter((row) => getStatus(row) === "failed")
    .map((row) => ({
      provider: "datagovie",
      source: "manifest-failed",
      resourceId: row.resource_id || row.id || "",
      packageId: row.package_id || "",
      packageName: row.package_name || "",
      organization: row.organization_name || row.organization_title || "",
      title: row.resource_name || row.name || row.title || "",
      format: row.format || "",
      url: getUrl(row),
      expectedSize: getExpectedSize(row),
      downloadedSize: asInt(row.bytes_written || row.downloaded_size || row.downloaded_bytes || row.size_downloaded),
      relativePath: manifestRelativePath(row, root, "datagovie"),
      root,
      skipReason: "",
    }));
}

function buildOpenDataNiCatalogueMissing(root) {
  const resources = readJson(path.join(repoRoot, "data", "external", "opendatani-resources.json"), []);
  const manifestRows = loadManifestRows(root);
  const seen = new Set();
  for (const row of manifestRows) {
    if (row.resource_id) seen.add(row.resource_id);
    const url = getUrl(row);
    if (url) seen.add(`url:${url}`);
  }
  const items = [];
  for (const resource of resources) {
    const url = normalizeUrl(resource.url);
    const id = resource.resource_id || resource.id || "";
    if ((id && seen.has(id)) || (url && seen.has(`url:${url}`))) continue;
    if (!url) continue;
    const relativePath = path.join(
      sanitizeSegment(resource.organization_name || resource.organization_title || "unknown-org"),
      sanitizeSegment(resource.package_name || resource.package_title || resource.package_id || "unknown-package"),
      filenameFromResource(resource),
    );
    items.push({
      provider: "opendatani",
      source: "catalogue-missing",
      resourceId: id,
      packageId: resource.package_id || "",
      packageName: resource.package_name || "",
      organization: resource.organization_name || resource.organization_title || "",
      title: resource.resource_name || "",
      format: resource.format || "",
      url,
      expectedSize: asInt(resource.resolved_size || resource.size),
      downloadedSize: 0,
      relativePath,
      root,
      skipReason: "",
    });
  }
  return items;
}

function buildDataGovIeReconcileMissing(root) {
  const missing = parseCsv(readTextIfExists(path.join(root, "_reconcile_missing.csv")));
  return missing.map((row) => {
    const url = getUrl(row);
    return {
      provider: "datagovie",
      source: "reconcile-missing",
      resourceId: row.resource_id || row.id || "",
      packageId: row.package_id || "",
      packageName: row.package_name || row.package_title || "",
      organization: row.organization_name || row.organization_title || "",
      title: row.resource_name || row.name || row.title || "",
      format: row.format || "",
      url,
      expectedSize: getExpectedSize(row),
      downloadedSize: 0,
      relativePath: manifestRelativePath(row, root, "datagovie"),
      root,
      skipReason: "",
    };
  });
}

function csoPxstatCodesAvailable() {
  const root = "D:\\cso-pxstat";
  const done = path.join(root, "_done.txt");
  const codes = new Set();
  if (fs.existsSync(done)) {
    for (const line of fs.readFileSync(done, "utf8").split(/\r?\n/)) {
      const code = line.trim().toUpperCase();
      if (code) codes.add(code);
    }
  }
  return codes;
}

function pxstatCodeFromUrl(url) {
  const decoded = decodeURIComponent(String(url || ""));
  const matches = [...decoded.matchAll(/\/([A-Z0-9]{3,12})\.(?:CSV|JSON|PX|PXE?)\b/gi)];
  if (matches.length) return matches[matches.length - 1][1].toUpperCase();
  const table = decoded.match(/[?&](?:table|matrix|id)=([A-Z0-9]{3,12})/i);
  return table ? table[1].toUpperCase() : "";
}

function classifyAndDedupe(items) {
  const csoDone = csoPxstatCodesAvailable();
  const keyed = new Map();
  for (const item of items) {
    if (!item.url) item.skipReason = "no-url";
    else if (isServiceLike(item)) item.skipReason = "service-or-web-endpoint";
    if (item.provider === "datagovie") {
      const code = pxstatCodeFromUrl(item.url);
      if (code && csoDone.has(code)) item.skipReason = `covered-by-cso-pxstat:${code}`;
    }
    const targetPath = safeResolve(item.root, item.relativePath);
    item.targetPath = targetPath;
    const existingSize = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
    const partialPath = `${targetPath}.partial`;
    const partialSize = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
    item.existingSize = existingSize;
    item.partialSize = partialSize;
    if (!item.skipReason && item.expectedSize > 0 && existingSize >= item.expectedSize) {
      item.skipReason = "already-complete";
    }
    if (!item.skipReason && !item.expectedSize && existingSize > 0) {
      item.skipReason = "already-present-unknown-size";
    }
    item.incrementalEstimate = Math.max(0, (item.expectedSize || 0) - Math.max(existingSize, partialSize));
    const key = item.resourceId ? `${item.provider}:id:${item.resourceId}` : `${item.provider}:url:${item.url}`;
    const previous = keyed.get(key);
    if (!previous) {
      keyed.set(key, item);
      continue;
    }
    if (previous.skipReason && !item.skipReason) keyed.set(key, item);
    else if ((item.expectedSize || 0) > (previous.expectedSize || 0)) keyed.set(key, item);
  }
  return [...keyed.values()];
}

function getDriveFreeBytes(driveRoot) {
  try {
    const stats = fs.statfsSync(path.parse(path.resolve(driveRoot)).root);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return Number.isFinite(free) && free > 0 ? free : null;
  } catch {
    return null;
  }
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function hasCompleteXmlRoot(file) {
  const size = fs.statSync(file).size;
  if (size <= 0) return false;
  const firstTake = Math.min(4096, size);
  const lastTake = Math.min(4096, size);
  const fd = fs.openSync(file, "r");
  try {
    const first = Buffer.alloc(firstTake);
    fs.readSync(fd, first, 0, firstTake, 0);
    const last = Buffer.alloc(lastTake);
    fs.readSync(fd, last, 0, lastTake, size - lastTake);
    const firstText = first.toString("utf8");
    const lastText = last.toString("utf8").trim();
    const root = firstText.match(/^\s*<([A-Za-z_][\w:.-]*)[\s>]/)?.[1];
    return Boolean(root && lastText.endsWith(`</${root}>`));
  } finally {
    fs.closeSync(fd);
  }
}

function summarize(items) {
  const summary = {
    total: items.length,
    byProvider: {},
    bySource: {},
    bySkipReason: {},
    downloadable: 0,
    knownCompleteBytes: 0,
    knownIncrementalBytes: 0,
    unknownSizeDownloadables: 0,
  };
  for (const item of items) {
    summary.byProvider[item.provider] = (summary.byProvider[item.provider] || 0) + 1;
    summary.bySource[item.source] = (summary.bySource[item.source] || 0) + 1;
    if (item.skipReason) {
      summary.bySkipReason[item.skipReason] = (summary.bySkipReason[item.skipReason] || 0) + 1;
      continue;
    }
    summary.downloadable += 1;
    summary.knownCompleteBytes += item.expectedSize || 0;
    summary.knownIncrementalBytes += item.incrementalEstimate || 0;
    if (!item.expectedSize) summary.unknownSizeDownloadables += 1;
  }
  return summary;
}

function reportRows(items, statuses = null) {
  return items
    .filter((item) => !statuses || statuses.has(item.status || item.skipReason || "queued"))
    .map((item) => ({
      provider: item.provider,
      source: item.source,
      status: item.status || (item.skipReason ? "skipped" : "queued"),
      reason: item.skipReason || item.error || "",
      resource_id: item.resourceId,
      package_name: item.packageName,
      organization: item.organization,
      title: item.title,
      format: item.format,
      expected_size: item.expectedSize,
      existing_size: item.existingSize,
      partial_size: item.partialSize,
      incremental_estimate: item.incrementalEstimate,
      bytes_written: item.bytesWritten || 0,
      final_size: item.finalSize || 0,
      sha256: item.sha256 || "",
      relative_path: item.relativePath,
      url: item.url,
    }));
}

async function headSize(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": DEFAULT_UA },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status, size: 0 };
    const len = Number(res.headers.get("content-length") || 0);
    return { ok: true, status: res.status, size: Number.isFinite(len) ? len : 0 };
  } catch (error) {
    return { ok: false, status: 0, size: 0, error: String(error?.message || error) };
  }
}

async function downloadItem(item, budget) {
  fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
  const partialPath = `${item.targetPath}.partial`;
  const existingSize = fs.existsSync(item.targetPath) ? fs.statSync(item.targetPath).size : 0;
  if (item.expectedSize > 0 && existingSize >= item.expectedSize) {
    return { status: "skipped", reason: "already-complete", bytesWritten: 0, finalSize: existingSize };
  }
  if (!item.expectedSize && existingSize > 0) {
    return { status: "skipped", reason: "already-present-unknown-size", bytesWritten: 0, finalSize: existingSize };
  }

  let partialSize = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
  if (item.expectedSize > 0 && partialSize > item.expectedSize) {
    fs.rmSync(partialPath);
    partialSize = 0;
  }
  const remainingEstimate = Math.max(0, (item.expectedSize || 0) - Math.max(existingSize, partialSize));
  if (remainingEstimate && budget.bytesWritten + remainingEstimate > budget.maxBytes) {
    return { status: "skipped", reason: "quota-exceeded-before-download", bytesWritten: 0, finalSize: existingSize };
  }

  const headers = { "User-Agent": DEFAULT_UA };
  let mode = "write";
  if (partialSize > 0) {
    headers.Range = `bytes=${partialSize}-`;
    mode = "append";
  }

  let res;
  try {
    res = await fetch(item.url, { headers, redirect: "follow" });
  } catch (error) {
    return { status: "failed", reason: `fetch-error:${String(error?.message || error)}`, bytesWritten: 0, finalSize: existingSize };
  }
  if (partialSize > 0 && res.status === 200) {
    fs.rmSync(partialPath);
    partialSize = 0;
    delete headers.Range;
    mode = "write";
    try {
      res = await fetch(item.url, { headers, redirect: "follow" });
    } catch (error) {
      return { status: "failed", reason: `fetch-error:${String(error?.message || error)}`, bytesWritten: 0, finalSize: existingSize };
    }
  }
  if (partialSize > 0 && res.status === 416) {
    fs.rmSync(partialPath);
    partialSize = 0;
    delete headers.Range;
    mode = "write";
    try {
      res = await fetch(item.url, { headers, redirect: "follow" });
    } catch (error) {
      return { status: "failed", reason: `fetch-error:${String(error?.message || error)}`, bytesWritten: 0, finalSize: existingSize };
    }
  }
  if (!res.ok) {
    return { status: "failed", reason: `http-${res.status}`, bytesWritten: 0, finalSize: existingSize };
  }

  const stream = fs.createWriteStream(partialPath, { flags: mode === "append" ? "a" : "w" });
  let wrote = 0;
  try {
    for await (const chunk of res.body) {
      if (budget.bytesWritten + chunk.length > budget.maxBytes) {
        stream.destroy();
        return { status: "stopped", reason: "quota-reached-during-download", bytesWritten: wrote, finalSize: partialSize + wrote };
      }
      await new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
      wrote += chunk.length;
      budget.bytesWritten += chunk.length;
    }
    await new Promise((resolve, reject) => stream.end((error) => (error ? reject(error) : resolve())));
  } catch (error) {
    try {
      stream.destroy();
    } catch {}
    return { status: "failed", reason: `write-or-stream-error:${String(error?.message || error)}`, bytesWritten: wrote, finalSize: partialSize + wrote };
  }

  const finalPartialSize = fs.statSync(partialPath).size;
  if (item.expectedSize > 0 && finalPartialSize < item.expectedSize) {
    const isXml = /\.xml$/i.test(item.targetPath);
    if (!isXml || !hasCompleteXmlRoot(partialPath)) {
      return { status: "failed", reason: `short-download:${finalPartialSize}/${item.expectedSize}`, bytesWritten: wrote, finalSize: finalPartialSize };
    }
  }
  if (fs.existsSync(item.targetPath)) fs.rmSync(item.targetPath);
  fs.renameSync(partialPath, item.targetPath);
  const finalSize = fs.statSync(item.targetPath).size;
  const sha256 = await sha256File(item.targetPath);
  fs.writeFileSync(`${item.targetPath}.sha256`, `${sha256}  ${path.basename(item.targetPath)}\n`, "utf8");
  return { status: "ok", reason: "", bytesWritten: wrote, finalSize, sha256 };
}

async function maybeResolveUnknownSizes(items, maxChecks = 25) {
  const unknown = items.filter((item) => !item.skipReason && !item.expectedSize).slice(0, maxChecks);
  for (const item of unknown) {
    const head = await headSize(item.url);
    item.headStatus = head.status;
    if (head.ok && head.size > 0) {
      item.expectedSize = head.size;
      item.incrementalEstimate = Math.max(0, head.size - Math.max(item.existingSize || 0, item.partialSize || 0));
    } else {
      item.headError = head.error || "";
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const maxBytes = Math.floor(args.maxGb * 1000 * 1000 * 1000);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");

  const rawItems = [
    ...buildOpenDataNiManifestFailures(args.opendataniRoot),
    ...buildOpenDataNiCatalogueMissing(args.opendataniRoot),
    ...buildDataGovIeManifestFailures(args.datagovieRoot),
    ...buildDataGovIeReconcileMissing(args.datagovieRoot),
  ];
  let items = classifyAndDedupe(rawItems);
  await maybeResolveUnknownSizes(items);
  items = classifyAndDedupe(items);
  if (args.limit > 0) items = items.slice(0, args.limit);

  const summary = summarize(items);
  const roots = [...new Set(items.filter((i) => !i.skipReason).map((i) => path.parse(path.resolve(i.root)).root))];
  const freeSpace = Object.fromEntries(roots.map((root) => [root, getDriveFreeBytes(root)]));
  const minFreeBytes = Math.floor(args.minFreeGb * 1000 * 1000 * 1000);
  const limitingFreeSpace = Object.values(freeSpace).some((free) => free != null && free < summary.knownIncrementalBytes + minFreeBytes);

  fs.mkdirSync(args.reportDir, { recursive: true });
  const reportBase = path.join(args.reportDir, `provider-mirror-repair-${stamp}`);
  const dryRunReport = {
    generatedAt: new Date().toISOString(),
    mode: args.download ? "download" : "dry-run",
    maxBytes,
    maxBytesHuman: humanBytes(maxBytes),
    minFreeBytes,
    minFreeBytesHuman: humanBytes(minFreeBytes),
    roots: {
      opendatani: args.opendataniRoot,
      datagovie: args.datagovieRoot,
    },
    freeSpace,
    freeSpaceHuman: Object.fromEntries(Object.entries(freeSpace).map(([k, v]) => [k, v == null ? "unknown" : humanBytes(v)])),
    limitingFreeSpace,
    summary,
    summaryHuman: {
      knownCompleteBytes: humanBytes(summary.knownCompleteBytes),
      knownIncrementalBytes: humanBytes(summary.knownIncrementalBytes),
    },
  };

  console.log(JSON.stringify(dryRunReport, null, 2));
  writeCsv(`${reportBase}-queue.csv`, reportRows(items), [
    "provider",
    "source",
    "status",
    "reason",
    "resource_id",
    "package_name",
    "organization",
    "title",
    "format",
    "expected_size",
    "existing_size",
    "partial_size",
    "incremental_estimate",
    "bytes_written",
    "final_size",
    "sha256",
    "relative_path",
    "url",
  ]);

  if (!args.download) {
    fs.writeFileSync(`${reportBase}-summary.json`, JSON.stringify(dryRunReport, null, 2), "utf8");
    return;
  }
  if (summary.knownIncrementalBytes > maxBytes) {
    throw new Error(`Refusing download: known incremental queue ${humanBytes(summary.knownIncrementalBytes)} exceeds cap ${humanBytes(maxBytes)}`);
  }
  if (limitingFreeSpace) {
    throw new Error(`Refusing download: free-space guard failed. Need queue plus ${humanBytes(minFreeBytes)} reserve.`);
  }

  const budget = { maxBytes, bytesWritten: 0 };
  const downloadable = items.filter((item) => !item.skipReason);
  for (let idx = 0; idx < downloadable.length; idx += 1) {
    const item = downloadable[idx];
    console.log(`[${idx + 1}/${downloadable.length}] ${item.provider} ${humanBytes(item.incrementalEstimate)} ${item.relativePath}`);
    const result = await downloadItem(item, budget);
    item.status = result.status;
    item.skipReason = result.reason;
    item.bytesWritten = result.bytesWritten;
    item.finalSize = result.finalSize;
    item.sha256 = result.sha256 || "";
    if (result.status === "stopped") break;
  }

  const finalSummary = {
    ...dryRunReport,
    completedAt: new Date().toISOString(),
    bytesWrittenThisRun: budget.bytesWritten,
    bytesWrittenThisRunHuman: humanBytes(budget.bytesWritten),
    resultCounts: items.reduce((acc, item) => {
      const key = item.status || (item.skipReason ? "skipped" : "not-run");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
  writeCsv(`${reportBase}-results.csv`, reportRows(items), [
    "provider",
    "source",
    "status",
    "reason",
    "resource_id",
    "package_name",
    "organization",
    "title",
    "format",
    "expected_size",
    "existing_size",
    "partial_size",
    "incremental_estimate",
    "bytes_written",
    "final_size",
    "sha256",
    "relative_path",
    "url",
  ]);
  fs.writeFileSync(`${reportBase}-summary.json`, JSON.stringify(finalSummary, null, 2), "utf8");
  console.log(JSON.stringify(finalSummary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
