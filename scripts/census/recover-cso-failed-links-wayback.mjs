#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();

function readArg(name, fallback = null) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const manifestPath = path.resolve(readArg("--manifest-path", path.join(REPO, "data", "census", "source-inventory", "cso-historical-reports.json")));
const outJsonPath = path.resolve(readArg("--out-json", path.join(REPO, "data", "census", "source-inventory", "cso-wayback-recovery.json")));
const outHtmlPath = path.resolve(readArg("--out-html", path.join(REPO, "data", "census", "source-inventory", "cso-wayback-recovery.html")));
const downloadDir = path.resolve(readArg("--download-dir", path.join(REPO, "data", "downloads", "wayback-cso")));

const args = new Set(process.argv.slice(2));
const shouldDownload = args.has("--download");
const retryFailed = args.has("--retry-failed") || args.has("--retry");
const retryProblemsOnly = args.has("--retry-problems-only");
const retryDownloadFailedOnly = args.has("--retry-download-failed-only");
const useAlternateSnapshots = args.has("--alternate-snapshots");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = Math.max(1, Math.min(8, concurrencyArg ? Number(concurrencyArg.slice("--concurrency=".length)) : 3));
const checkpointEvery = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[character] || character));
}

function safeFileName(url, timestamp = "wayback") {
  const parsed = new URL(url);
  const ext = path.extname(parsed.pathname) || ".bin";
  const base = path.basename(parsed.pathname, ext) || "download";
  const cleanBase = base.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "download";
  const hash = crypto.createHash("sha1").update(`${timestamp}:${url}`).digest("hex").slice(0, 10);
  return `${cleanBase}.${timestamp}.${hash}${ext}`;
}

async function fetchJson(url) {
  const res = await fetchWithRetries(url, {
    headers: {
      "user-agent": "CivgraphSourceRecovery/1.0 (+https://civgraph.net)"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchWithRetries(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if (res.ok || attempt === attempts || ![408, 429, 500, 502, 503, 504].includes(res.status)) {
        return res;
      }
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500 * attempt);
  }
  throw lastError || new Error("fetch failed");
}

async function findWaybackSnapshot(url) {
  const candidates = candidateUrls(url);
  const apiUrl = new URL("https://archive.org/wayback/available");
  for (const candidate of candidates) {
    apiUrl.searchParams.set("url", candidate);
    try {
      const data = await fetchJson(apiUrl.toString());
      const closest = data?.archived_snapshots?.closest;
      if (closest?.available && closest?.url) {
        const alternates = useAlternateSnapshots ? await findWaybackSnapshotsByCdx([candidate], 10) : [];
        return {
          status: "available",
          lookup: "available",
          originalUrl: candidate,
          timestamp: closest.timestamp || null,
          snapshotUrl: closest.url,
          statusCode: closest.status || null,
          alternates: alternates.filter((snapshot) => snapshot.timestamp !== closest.timestamp)
        };
      }
    } catch (error) {
      const cdxResult = await findWaybackSnapshotByCdx(candidates);
      if (cdxResult.status === "available") return cdxResult;
      return { status: "lookup_failed", error: error.message };
    }
  }
  return findWaybackSnapshotByCdx(candidates);
}

function candidateUrls(url) {
  const candidates = [url];
  try {
    const parsed = new URL(url);
    const alternateProtocol = new URL(parsed.toString());
    alternateProtocol.protocol = parsed.protocol === "https:" ? "http:" : "https:";
    candidates.push(alternateProtocol.toString());
    if (parsed.hostname === "www.cso.ie") {
      const noWww = new URL(parsed.toString());
      noWww.hostname = "cso.ie";
      candidates.push(noWww.toString());
      const noWwwAlt = new URL(noWww.toString());
      noWwwAlt.protocol = noWww.protocol === "https:" ? "http:" : "https:";
      candidates.push(noWwwAlt.toString());
    } else if (parsed.hostname === "cso.ie") {
      const www = new URL(parsed.toString());
      www.hostname = "www.cso.ie";
      candidates.push(www.toString());
      const wwwAlt = new URL(www.toString());
      wwwAlt.protocol = www.protocol === "https:" ? "http:" : "https:";
      candidates.push(wwwAlt.toString());
    }
  } catch {
    // Keep the original candidate only.
  }
  return [...new Set(candidates)];
}

async function findWaybackSnapshotsByCdx(candidates, limitCount = 20) {
  const snapshots = [];
  let lastError = null;
  for (const candidate of candidates) {
    const apiUrl = new URL("https://web.archive.org/cdx");
    apiUrl.searchParams.set("url", candidate);
    apiUrl.searchParams.set("output", "json");
    apiUrl.searchParams.set("fl", "timestamp,original,statuscode,mimetype,digest");
    apiUrl.searchParams.append("filter", "statuscode:200");
    apiUrl.searchParams.set("collapse", "digest");
    apiUrl.searchParams.set("limit", String(limitCount));
    apiUrl.searchParams.set("from", "1996");
    try {
      const data = await fetchJson(apiUrl.toString());
      const rows = Array.isArray(data) ? data.slice(1) : [];
      snapshots.push(...rows
        .map((row) => ({
          timestamp: row[0],
          originalUrl: row[1] || candidate,
          statusCode: row[2] || "200",
          mimetype: row[3] || "",
          digest: row[4] || ""
        }))
        .filter((row) => row.timestamp && !String(row.mimetype).includes("warc/revisit"))
        .map((row) => ({
          lookup: "cdx",
          originalUrl: row.originalUrl,
          timestamp: row.timestamp,
          snapshotUrl: `https://web.archive.org/web/${row.timestamp}/${row.originalUrl}`,
          statusCode: row.statusCode,
          mimetype: row.mimetype,
          digest: row.digest
        })));
    } catch (error) {
      lastError = error;
    }
  }
  if (!snapshots.length && lastError) throw lastError;
  return snapshots;
}

async function findWaybackSnapshotByCdx(candidates) {
  try {
    const snapshots = await findWaybackSnapshotsByCdx(candidates, 20);
    const selected = snapshots[0];
    if (selected) {
      return {
        status: "available",
        ...selected,
        alternates: snapshots.slice(1)
      };
    }
  } catch (error) {
    return { status: "lookup_failed", error: error.message };
  }
  return { status: "not_found" };
}

function rawSnapshotUrl(snapshotUrl, originalUrl, mode = "id_") {
  const timestampMatch = String(snapshotUrl || "").match(/\/web\/(\d+)\//);
  if (!timestampMatch) return snapshotUrl;
  return `https://web.archive.org/web/${timestampMatch[1]}${mode}/${originalUrl}`;
}

async function downloadSnapshot(asset, snapshot) {
  if (!shouldDownload || snapshot.status !== "available") return { status: "not_requested" };
  fs.mkdirSync(downloadDir, { recursive: true });
  const attempts = [snapshot, ...(useAlternateSnapshots ? (snapshot.alternates || []) : [])];
  const errors = [];
  try {
    const headers = {
      "user-agent": "CivgraphSourceRecovery/1.0 (+https://civgraph.net)"
    };
    for (const candidateSnapshot of attempts) {
      const originalUrl = candidateSnapshot.originalUrl || snapshot.originalUrl || asset.url;
      const timestamp = candidateSnapshot.timestamp || snapshot.timestamp || "wayback";
      const outPath = path.join(downloadDir, safeFileName(originalUrl, timestamp));
      if (fs.existsSync(outPath)) {
        return {
          status: "cached",
          path: path.relative(REPO, outPath).replace(/\\/g, "/"),
          bytes: fs.statSync(outPath).size,
          timestamp
        };
      }
      let res = await fetchWithRetries(rawSnapshotUrl(candidateSnapshot.snapshotUrl, originalUrl, "id_"), { headers }, 3);
      if (!res.ok) {
        res = await fetchWithRetries(rawSnapshotUrl(candidateSnapshot.snapshotUrl, originalUrl, ""), { headers }, 2);
      }
      if (!res.ok) {
        errors.push(`${timestamp}: ${res.status} ${res.statusText}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, bytes);
      return {
        status: "downloaded",
        path: path.relative(REPO, outPath).replace(/\\/g, "/"),
        bytes: bytes.length,
        timestamp
      };
    }
    return { status: "failed", error: errors.join("; ") || "no downloadable snapshot" };
  } catch (error) {
    return { status: "failed", error: error.message };
  }
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

function buildHtml(report) {
  const rows = report.assets.map((asset, index) => `<tr>
  <td>${index + 1}</td>
  <td>${escapeHtml(asset.recovery.status)}</td>
  <td>${escapeHtml(asset.download?.status)}</td>
  <td><a href="${escapeHtml(asset.url)}">${escapeHtml(asset.text || asset.url)}</a><div class="url">${escapeHtml(asset.url)}</div></td>
  <td>${asset.recovery.snapshotUrl ? `<a href="${escapeHtml(asset.recovery.snapshotUrl)}">snapshot</a>` : ""}<div class="url">${escapeHtml(asset.recovery.timestamp || "")}</div></td>
  <td>${asset.download?.path ? escapeHtml(asset.download.path) : escapeHtml(asset.download?.error || "")}</td>
</tr>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CSO Wayback Recovery Report</title>
  <style>
    body { background: #f7f9fc; color: #172033; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }
    table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #d8e0ea; font-size: 13px; }
    th, td { border-bottom: 1px solid #e3e8ef; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #edf3fb; position: sticky; top: 0; }
    .url { color: #52607a; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>CSO Wayback recovery report</h1>
  <p>Downloaded files, if requested, are stored under <code>${escapeHtml(downloadDir)}</code>.</p>
  <ul>
    <li>Input failed assets: ${report.inputFailedAssets}</li>
    <li>Checked assets: ${report.checkedAssets}</li>
    <li>Available snapshots: ${report.availableSnapshots}</li>
    <li>Downloaded or cached: ${report.downloadedOrCached}</li>
    <li>Still unavailable: ${report.stillUnavailable}</li>
  </ul>
  <table>
    <thead><tr><th>#</th><th>Recovery</th><th>Download</th><th>Asset</th><th>Snapshot</th><th>Local file / error</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

function summarizeReport(assets) {
  return {
    generatedAt: new Date().toISOString(),
    inputManifest: path.relative(REPO, manifestPath).replace(/\\/g, "/"),
    downloadDirectory: downloadDir,
    inputFailedAssets: (manifest.assets || []).filter((asset) => asset.download?.status === "failed").length,
    checkedAssets: assets.length,
    availableSnapshots: assets.filter((asset) => asset.recovery?.status === "available").length,
    downloadedOrCached: assets.filter((asset) => ["downloaded", "cached"].includes(asset.download?.status)).length,
    stillUnavailable: assets.filter((asset) => asset.recovery?.status !== "available").length,
    downloadRequested: shouldDownload,
    assets
  };
}

function writeReport(assets) {
  const report = summarizeReport(assets);
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outHtmlPath, buildHtml(report));
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const allFailedAssets = (manifest.assets || [])
  .filter((asset) => asset.download?.status === "failed")
  .sort((a, b) => String(a.url || "").localeCompare(String(b.url || "")))
  .slice(0, Number.isFinite(limit) ? limit : undefined);

let previousAssets = [];
if (fs.existsSync(outJsonPath)) {
  try {
    previousAssets = JSON.parse(fs.readFileSync(outJsonPath, "utf8")).assets || [];
  } catch {
    previousAssets = [];
  }
}
const previousByUrl = new Map(previousAssets.map((asset) => [asset.url, asset]));
const previousProblemUrls = new Set(previousAssets
  .filter((asset) => asset.recovery?.status !== "available" || asset.download?.status === "failed")
  .map((asset) => asset.url));
let failedAssets = allFailedAssets;
if (retryProblemsOnly) {
  failedAssets = allFailedAssets.filter((asset) => previousProblemUrls.has(asset.url));
} else if (retryDownloadFailedOnly) {
  failedAssets = allFailedAssets.filter((asset) => previousByUrl.get(asset.url)?.download?.status === "failed");
}
const recoveredAssets = failedAssets.map((asset) => previousByUrl.get(asset.url)).map((asset) => asset || null);
let completedCount = 0;

function shouldReusePrevious(previous) {
  if (!previous?.recovery?.status) return false;
  if (!retryFailed) return true;
  if (["downloaded", "cached"].includes(previous.download?.status)) return true;
  if (previous.recovery.status !== "available") return false;
  if (previous.download?.status === "failed") return false;
  return !shouldDownload;
}

function currentFullReportAssets() {
  const updatedByUrl = new Map(previousAssets.map((asset) => [asset.url, asset]));
  for (const asset of recoveredAssets) {
    if (asset?.url) updatedByUrl.set(asset.url, asset);
  }
  return allFailedAssets
    .map((asset) => updatedByUrl.get(asset.url))
    .filter(Boolean);
}

await mapLimit(failedAssets, concurrency, async (asset, index) => {
  const previous = previousByUrl.get(asset.url);
  if (shouldReusePrevious(previous)) {
    recoveredAssets[index] = previous;
    completedCount += 1;
    return previous;
  }
  const recovery = await findWaybackSnapshot(asset.url);
  const download = await downloadSnapshot(asset, recovery);
  recoveredAssets[index] = {
    url: asset.url,
    text: asset.text,
    sourcePage: asset.sourcePage,
    originalError: asset.download?.error,
    recovery,
    download
  };
  completedCount += 1;
  if (completedCount % checkpointEvery === 0 || completedCount === failedAssets.length) {
    writeReport(currentFullReportAssets());
    console.log(`Checked ${completedCount}/${failedAssets.length}`);
  }
  await sleep(150);
  return recoveredAssets[index];
});

writeReport(currentFullReportAssets());
console.log(`Wrote ${path.relative(REPO, outJsonPath)}`);
console.log(`Wrote ${path.relative(REPO, outHtmlPath)}`);
