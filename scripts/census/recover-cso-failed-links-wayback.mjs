#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const manifestPath = path.join(REPO, "data", "census", "source-inventory", "cso-historical-reports.json");
const outJsonPath = path.join(REPO, "data", "census", "source-inventory", "cso-wayback-recovery.json");
const outHtmlPath = path.join(REPO, "data", "census", "source-inventory", "cso-wayback-recovery.html");
const downloadDir = path.join(REPO, "data", "downloads", "wayback-cso");

const args = new Set(process.argv.slice(2));
const shouldDownload = args.has("--download");
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
  const res = await fetch(url, {
    headers: {
      "user-agent": "CivgraphSourceRecovery/1.0 (+https://civgraph.net)"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function findWaybackSnapshot(url) {
  const apiUrl = new URL("https://archive.org/wayback/available");
  apiUrl.searchParams.set("url", url);
  try {
    const data = await fetchJson(apiUrl.toString());
    const closest = data?.archived_snapshots?.closest;
    if (closest?.available && closest?.url) {
      return {
        status: "available",
        timestamp: closest.timestamp || null,
        snapshotUrl: closest.url,
        statusCode: closest.status || null
      };
    }
    return { status: "not_found" };
  } catch (error) {
    return { status: "lookup_failed", error: error.message };
  }
}

function rawSnapshotUrl(snapshotUrl, originalUrl) {
  const timestampMatch = String(snapshotUrl || "").match(/\/web\/(\d+)\//);
  if (!timestampMatch) return snapshotUrl;
  return `https://web.archive.org/web/${timestampMatch[1]}id_/${originalUrl}`;
}

async function downloadSnapshot(asset, snapshot) {
  if (!shouldDownload || snapshot.status !== "available") return { status: "not_requested" };
  fs.mkdirSync(downloadDir, { recursive: true });
  const outPath = path.join(downloadDir, safeFileName(asset.url, snapshot.timestamp || "wayback"));
  if (fs.existsSync(outPath)) {
    return {
      status: "cached",
      path: path.relative(REPO, outPath).replace(/\\/g, "/"),
      bytes: fs.statSync(outPath).size
    };
  }
  try {
    const res = await fetch(rawSnapshotUrl(snapshot.snapshotUrl, asset.url), {
      headers: {
        "user-agent": "CivgraphSourceRecovery/1.0 (+https://civgraph.net)"
      }
    });
    if (!res.ok) return { status: "failed", error: `${res.status} ${res.statusText}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, bytes);
    return {
      status: "downloaded",
      path: path.relative(REPO, outPath).replace(/\\/g, "/"),
      bytes: bytes.length
    };
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
  <p>Downloaded files, if requested, are stored under ignored <code>data/downloads/wayback-cso/</code>.</p>
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
const failedAssets = (manifest.assets || [])
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
const recoveredAssets = new Array(failedAssets.length);
let completedCount = 0;

await mapLimit(failedAssets, concurrency, async (asset, index) => {
  const previous = previousByUrl.get(asset.url);
  if (previous?.recovery?.status) {
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
    writeReport(recoveredAssets.filter(Boolean));
    console.log(`Checked ${completedCount}/${failedAssets.length}`);
  }
  await sleep(150);
  return recoveredAssets[index];
});

writeReport(recoveredAssets.filter(Boolean));
console.log(`Wrote ${path.relative(REPO, outJsonPath)}`);
console.log(`Wrote ${path.relative(REPO, outHtmlPath)}`);
