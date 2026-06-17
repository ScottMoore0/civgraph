#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const UA = "Civgraph NISRA throttle probe/1.0 (+https://civgraph.net; bounded archival-rate test)";

function readArg(name, fallback = null) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const args = {
  root: path.resolve(readArg("--root", "D:\\nisra")),
  reportDir: path.resolve(readArg("--report-dir", path.join("data", "provider-mirror-audit"))),
  latestFailuresCsv: readArg("--failures-csv", path.join("data", "provider-mirror-audit", "nisra-complete-20260617T063136Z-assets.csv")),
  discoveredJsonl: readArg("--discovered-jsonl", "D:\\nisra\\_assets_discovered.jsonl"),
  delays: readArg("--delays", "15000,10000,7500,5000").split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v >= 0),
  samplePerDelay: Number(readArg("--sample-per-delay", 5)),
  timeoutMs: Number(readArg("--timeout-ms", 15000)),
  maxCandidates: Number(readArg("--max-candidates", 80)),
  candidateOffset: Number(readArg("--candidate-offset", 0)),
  continueOnBlocked: process.argv.includes("--continue-on-blocked"),
  maxBlockedRows: Number(readArg("--max-blocked-rows", 5)),
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

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(value);
      value = "";
    } else value += ch;
  }
  out.push(value);
  return out;
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, idx) => [header, values[idx] || ""]));
  });
}

function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function localPathForAsset(url) {
  const parsed = new URL(url);
  const rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, "") || "download";
  const target = path.resolve(args.root, "mirror", rel);
  const root = path.resolve(args.root);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) throw new Error(`Refusing path outside root: ${target}`);
  return target;
}

function isPresent(url) {
  try {
    const output = localPathForAsset(url);
    return fs.existsSync(output) && fs.statSync(output).size > 0;
  } catch {
    return false;
  }
}

function collectCandidates() {
  const urls = new Map();
  for (const row of readCsv(args.latestFailuresCsv)) {
    if (row.status === "failed" && row.url) {
      const url = normalizeUrl(row.url);
      if (url) urls.set(url, { url, source: "failed-assets-csv", previousError: row.error || "" });
    }
  }
  if (fs.existsSync(args.discoveredJsonl)) {
    for (const line of fs.readFileSync(args.discoveredJsonl, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const url = normalizeUrl(row.url);
        if (url && !urls.has(url)) urls.set(url, { url, source: "discovered-jsonl", previousError: "" });
      } catch {
        // Ignore malformed scratch rows; they are not useful throttle candidates.
      }
    }
  }
  return [...urls.values()]
    .filter((row) => !isPresent(row.url))
    .slice(Math.max(0, args.candidateOffset), Math.max(0, args.candidateOffset) + args.maxCandidates);
}

async function probeUrl(url, delayMs) {
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${args.timeoutMs}ms`)), args.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        "range": "bytes=0-0",
        "accept": "application/octet-stream,*/*",
      },
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    if (res.body) await res.body.cancel().catch(() => {});
    return {
      delayMs,
      url,
      ok: res.ok || res.status === 206,
      status: res.status,
      statusText: res.statusText,
      elapsedMs,
      contentLength: res.headers.get("content-length") || "",
      retryAfter: res.headers.get("retry-after") || "",
      error: "",
    };
  } catch (error) {
    return {
      delayMs,
      url,
      ok: false,
      status: 0,
      statusText: "",
      elapsedMs: Date.now() - started,
      contentLength: "",
      retryAfter: "",
      error: error.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function shouldStop(row) {
  if (row.status === 429) return true;
  if (row.status >= 500) return true;
  if (row.status === 0) return true;
  if (!row.ok && BLOCKED_OR_STALE_STATUSES.has(row.status)) return !args.continueOnBlocked;
  if (!row.ok) return true;
  return false;
}

async function main() {
  fs.mkdirSync(args.reportDir, { recursive: true });
  const candidates = collectCandidates();
  const rows = [];
  let cursor = 0;
  let stopped = false;
  let stopReason = "";

  for (const delayMs of args.delays) {
    for (let i = 0; i < args.samplePerDelay && cursor < candidates.length; i += 1) {
      if (rows.length > 0 && delayMs > 0) await sleep(delayMs);
      const candidate = candidates[cursor];
      cursor += 1;
      const row = await probeUrl(candidate.url, delayMs);
      row.source = candidate.source;
      row.previousError = candidate.previousError;
      row.classification = row.ok
        ? "ok"
        : row.status === 429
          ? "throttle"
          : row.status === 0
            ? "network-or-timeout"
            : row.status >= 500
              ? "server-error"
              : BLOCKED_OR_STALE_STATUSES.has(row.status)
                ? "blocked-or-stale"
                : "unexpected";
      rows.push(row);
      const blockedRows = rows.filter((item) => item.classification === "blocked-or-stale").length;
      if (args.continueOnBlocked && blockedRows > args.maxBlockedRows) {
        stopped = true;
        stopReason = `stopped after ${blockedRows} blocked/stale rows`;
        break;
      }
      if (shouldStop(row)) {
        stopped = true;
        stopReason = row.status === 429 ? `throttled at ${delayMs}ms` : `stopped at ${delayMs}ms: ${row.status || row.error} ${row.statusText}`;
        break;
      }
    }
    if (stopped) break;
  }

  const stamp = nowStamp();
  const summary = {
    generatedAt: new Date().toISOString(),
    root: args.root,
    candidates: candidates.length,
    candidateOffset: args.candidateOffset,
    tested: rows.length,
    delays: args.delays,
    samplePerDelay: args.samplePerDelay,
    timeoutMs: args.timeoutMs,
    continueOnBlocked: args.continueOnBlocked,
    maxBlockedRows: args.maxBlockedRows,
    stopped,
    stopReason,
    okRows: rows.filter((row) => row.ok).length,
    throttleRows: rows.filter((row) => row.status === 429).length,
    errorRows: rows.filter((row) => row.status === 0 || row.status >= 500).length,
    blockedOrStaleRows: rows.filter((row) => row.classification === "blocked-or-stale").length,
    fastestCompletedDelayMs: stopped ? null : args.delays.at(-1),
    testedDelaysCompleted: args.delays.filter((delayMs) => rows.filter((row) => row.delayMs === delayMs).length === args.samplePerDelay),
  };
  const jsonPath = path.join(args.reportDir, `nisra-throttle-probe-${stamp}.json`);
  const csvPath = path.join(args.reportDir, `nisra-throttle-probe-${stamp}.csv`);
  fs.writeFileSync(jsonPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`, "utf8");
  writeCsv(csvPath, rows, ["delayMs", "url", "source", "previousError", "classification", "ok", "status", "statusText", "elapsedMs", "contentLength", "retryAfter", "error"]);
  console.log(JSON.stringify({ summaryPath: jsonPath, csvPath, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
