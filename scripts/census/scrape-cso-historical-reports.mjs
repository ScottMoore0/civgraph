#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(REPO, "data", "census", "source-inventory");
const CACHE_DIR = path.join(REPO, "data", "downloads", "cso-historical-reports");
const MANIFEST_PATH = path.join(OUT_DIR, "cso-historical-reports.json");

const START_URLS = [
  "https://www.cso.ie/en/statistics/historicalreports/",
  "https://www.cso.ie/en/census/censusvolumes1926to1991/historicalreports/",
];

const ASSET_RE = /\.(pdf|zip|csv|xls|xlsx|doc|docx)(?:[?#].*)?$/i;
const PAGE_HINT_RE = /census|historicalreports|historical\s+reports|volume/i;

const args = new Set(process.argv.slice(2));
const SHOULD_DOWNLOAD = args.has("--download");
const MAX_PAGES = Number(process.argv.find((arg) => arg.startsWith("--max-pages="))?.split("=")[1] || 120);

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function safeFileName(url, fallback = "download") {
  const parsed = new URL(url);
  const base = decodeURIComponent(path.basename(parsed.pathname) || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const ext = path.extname(base);
  const stem = (ext ? base.slice(0, -ext.length) : base).slice(0, 130).replace(/[. ]+$/g, "") || fallback;
  const suffix = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `${stem}-${suffix}${ext || ""}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Civgraph census source inventory (contact: civgraph.net)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1] || "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    try {
      const url = new URL(decodeEntities(href), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      links.push({
        url: url.toString(),
        text: stripTags(match[2]),
      });
    } catch {
      // Ignore malformed site links; they are not useful for inventory.
    }
  }
  return links;
}

function isSameSiteCsoPage(url, text) {
  const parsed = new URL(url);
  if (parsed.hostname !== "www.cso.ie") return false;
  if (ASSET_RE.test(parsed.pathname)) return false;
  const haystack = `${parsed.pathname} ${text || ""}`;
  if (!PAGE_HINT_RE.test(haystack)) return false;
  if (parsed.pathname.includes("/px/") || parsed.pathname.includes("/databases/")) return false;
  return true;
}

async function maybeDownload(asset) {
  if (!SHOULD_DOWNLOAD) return { status: "not_requested" };
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const filename = safeFileName(asset.url);
  const outputPath = path.join(CACHE_DIR, filename);
  try {
    const existing = await fs.stat(outputPath).catch(() => null);
    if (existing?.size > 0) {
      return { status: "cached", path: path.relative(REPO, outputPath).replace(/\\/g, "/"), bytes: existing.size };
    }
    const res = await fetch(asset.url, {
      headers: { "user-agent": "Civgraph census source inventory (contact: civgraph.net)" },
    });
    if (!res.ok) return { status: "failed", error: `${res.status} ${res.statusText}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outputPath, bytes);
    return { status: "downloaded", path: path.relative(REPO, outputPath).replace(/\\/g, "/"), bytes: bytes.length };
  } catch (error) {
    return { status: "failed", error: error.message };
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const queue = [...START_URLS];
  const seenPages = new Set();
  const pages = [];
  const assetsByUrl = new Map();

  while (queue.length && seenPages.size < MAX_PAGES) {
    const pageUrl = queue.shift();
    if (!pageUrl || seenPages.has(pageUrl)) continue;
    seenPages.add(pageUrl);
    const page = { url: pageUrl, status: "pending", links: 0, error: null };
    pages.push(page);
    try {
      const html = await fetchText(pageUrl);
      const links = extractLinks(html, pageUrl);
      page.status = "ok";
      page.links = links.length;
      for (const link of links) {
        const parsed = new URL(link.url);
        if (ASSET_RE.test(parsed.pathname)) {
          if (!assetsByUrl.has(link.url)) {
            assetsByUrl.set(link.url, {
              url: link.url,
              text: link.text,
              extension: path.extname(parsed.pathname).replace(".", "").toLowerCase(),
              sourcePage: pageUrl,
            });
          }
          continue;
        }
        if (isSameSiteCsoPage(link.url, link.text) && !seenPages.has(link.url) && queue.length < MAX_PAGES * 4) {
          queue.push(link.url);
        }
      }
    } catch (error) {
      page.status = "failed";
      page.error = error.message;
    }
  }

  const assets = [...assetsByUrl.values()];
  for (const asset of assets) {
    asset.download = await maybeDownload(asset);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    startUrls: START_URLS,
    downloadRequested: SHOULD_DOWNLOAD,
    cacheDirectory: path.relative(REPO, CACHE_DIR).replace(/\\/g, "/"),
    pagesVisited: pages.length,
    assetsFound: assets.length,
    assetsDownloaded: assets.filter((asset) => asset.download?.status === "downloaded").length,
    assetsCached: assets.filter((asset) => asset.download?.status === "cached").length,
    assetsFailed: assets.filter((asset) => asset.download?.status === "failed").length,
    pages,
    assets: assets.sort((a, b) => a.url.localeCompare(b.url)),
  };

  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`CSO historical reports manifest: ${path.relative(REPO, MANIFEST_PATH)}`);
  console.log(`Pages visited: ${manifest.pagesVisited}`);
  console.log(`Assets found: ${manifest.assetsFound}`);
  if (SHOULD_DOWNLOAD) {
    console.log(`Downloaded: ${manifest.assetsDownloaded}; cached: ${manifest.assetsCached}; failed: ${manifest.assetsFailed}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
