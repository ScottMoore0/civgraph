import fs from "node:fs";
import path from "node:path";

const manifestPath = path.join(
  "data",
  "census",
  "source-inventory",
  "cso-historical-reports.json",
);
const outPath = path.join(
  "data",
  "census",
  "source-inventory",
  "cso-failed-links.html",
);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return character;
    }
  });
}

function hostFor(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failedAssets = manifest.assets
  .filter((asset) => asset.download?.status === "failed")
  .sort((left, right) => (
    String(left.download?.error ?? "").localeCompare(String(right.download?.error ?? ""))
    || hostFor(left.url).localeCompare(hostFor(right.url))
    || String(left.sourcePage ?? "").localeCompare(String(right.sourcePage ?? ""))
    || String(left.url ?? "").localeCompare(String(right.url ?? ""))
  ));

const summaryCounts = new Map();
for (const asset of failedAssets) {
  const key = `${asset.download?.error ?? "unknown"} on ${hostFor(asset.url)}`;
  summaryCounts.set(key, (summaryCounts.get(key) ?? 0) + 1);
}

const summaryRows = Array.from(summaryCounts.entries())
  .map(([key, count]) => `<li><strong>${count}</strong> ${escapeHtml(key)}</li>`)
  .join("\n");

const bodyRows = failedAssets.map((asset, index) => {
  const label = asset.text || asset.url;
  return `<tr>
  <td>${index + 1}</td>
  <td><span class="err">${escapeHtml(asset.download?.error)}</span></td>
  <td>${escapeHtml(hostFor(asset.url))}</td>
  <td>
    <a href="${escapeHtml(asset.url)}">${escapeHtml(label)}</a>
    <div class="url">${escapeHtml(asset.url)}</div>
  </td>
  <td>
    <a href="${escapeHtml(asset.sourcePage)}">source page</a>
    <div class="url">${escapeHtml(asset.sourcePage)}</div>
  </td>
</tr>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CSO Failed Historical Report Links</title>
  <style>
    body {
      background: #f7f9fc;
      color: #172033;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 24px;
    }
    h1 { margin: 0 0 4px; }
    p { color: #52607a; }
    .panel {
      background: #fff;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      margin: 16px 0;
      padding: 16px;
    }
    table {
      background: #fff;
      border: 1px solid #d8e0ea;
      border-collapse: collapse;
      font-size: 13px;
      width: 100%;
    }
    th,
    td {
      border-bottom: 1px solid #e3e8ef;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #edf3fb;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    a { color: #0d4e96; }
    code {
      background: #edf3fb;
      border-radius: 4px;
      padding: 2px 4px;
    }
    .err {
      color: #8a2c14;
      font-weight: 700;
      white-space: nowrap;
    }
    .url {
      color: #52607a;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      margin-top: 3px;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <h1>CSO failed historical-report asset links</h1>
  <p>
    Generated from <code>${escapeHtml(manifestPath)}</code>. These are asset
    downloads recorded as failed by the scrape manifest, not necessarily dead
    source pages.
  </p>
  <div class="panel">
    <strong>Total failed assets: ${failedAssets.length}</strong>
    <ul>
${summaryRows}
    </ul>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Error</th>
        <th>Host</th>
        <th>Failed asset</th>
        <th>Source page</th>
      </tr>
    </thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log(outPath);
