#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "data", "census", "statistical-staging");
const EXTRACT_DIR = path.join(OUT_DIR, "extracted");
const AUDIT_DIR = path.join(REPO, "data", "provider-mirror-audit");

const XLSX_HEADER_ROWS = 8;
const CSV_HEADER_ROWS = 20;
const LARGE_JSON_BYTES = 25 * 1024 * 1024;
const LARGE_EXCEL_BYTES = 75 * 1024 * 1024;

const ROOTS = [
  {
    provider: "nisra",
    corpus: "nisra-current",
    root: "D:\\nisra",
    provenance: "current NISRA mirror",
    inventoryPath: "D:\\nisra\\_inventory.json",
  },
  {
    provider: "nisra",
    corpus: "nisra-wayback",
    root: "D:\\nisra-wayback",
    provenance: "NISRA Wayback recovery mirror",
    waybackInventoryPath: "D:\\nisra-wayback\\_wayback_recovery_inventory.json",
  },
  {
    provider: "cso",
    corpus: "cso-historical-reports",
    root: "D:\\cso-historical-reports",
    provenance: "CSO historical reports mirror",
    csoAuditPath: path.join(AUDIT_DIR, "cso-historical-reports-d-drive.json"),
    csoWaybackPath: path.join(AUDIT_DIR, "cso-wayback-recovery-d-drive.json"),
  },
  {
    provider: "cso",
    corpus: "cso-pxstat",
    root: "D:\\cso-pxstat",
    provenance: "CSO PXStat mirror",
    pxstatCataloguePath: "D:\\cso-pxstat\\_catalogue.json",
  },
  {
    provider: "cso",
    corpus: "cso-repo-recovered",
    root: path.join(REPO, "data", "downloads", "cso-historical-reports"),
    provenance: "repo-local CSO historical recovery cache",
    csoDirectRecoveryCsv: path.join(AUDIT_DIR, "cso-direct-recovery-20260619.csv"),
  },
];

const SIDE_CAR_EXTENSIONS = new Set([".sha256", ".md5"]);
const BOOKKEEPING_NAMES = new Set([
  "_log.txt",
  "_pages_seen.txt",
  "_inventory.json",
  "_frontier.txt",
  "_assets_discovered.jsonl",
  "_wayback_latest_inventory.json",
  "_wayback_cdx_windows_done.json",
  "_wayback_cdx_windows_errors.json",
  "_wayback_recovery_progress.json",
  "_wayback_recovery_inventory.json",
  "_catalogue.json",
  "_done.txt",
  "_summary.md",
]);
const EXTRACTABLE_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".json",
  ".xlsx",
  ".xlsm",
  ".xls",
  ".ods",
  ".pdf",
]);
const NON_STATISTICAL_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".webmanifest",
  ".ofss",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".zip",
  ".rar",
  ".7z",
  ".wk1",
  ".wk4",
]);

function normalisePathForKey(value) {
  return path.resolve(value).replace(/\\/g, "/").toLowerCase();
}

function normaliseRel(value) {
  return value.replace(/\\/g, "/");
}

function stableId(...parts) {
  const digest = crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
  return `src-${digest}`;
}

function addCount(map, key, delta = 1) {
  map[key] = (map[key] || 0) + delta;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(file, rows, headers) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function appendJsonl(file, rows) {
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.appendFileSync(file, lines ? `${lines}\n` : "", "utf8");
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readCsvIfExists(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.length);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? "";
    });
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function fileSignature(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(16);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).toString("hex").toUpperCase();
  } finally {
    fs.closeSync(fd);
  }
}

function detectMagic(signatureHex) {
  if (signatureHex.startsWith("25504446")) return "pdf";
  if (signatureHex.startsWith("504B0304")) return "zip";
  if (signatureHex.startsWith("D0CF11E0A1B11AE1")) return "ole";
  if (signatureHex.startsWith("7B") || signatureHex.startsWith("5B")) return "json";
  if (signatureHex.startsWith("EFBBBF")) return "text-bom";
  return "unknown";
}

async function walkFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return files;
}

function buildNisraCurrentProvenance(rootConfig) {
  const map = new Map();
  const inventory = readJsonIfExists(rootConfig.inventoryPath);
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return map;
  for (const [url, localPath] of Object.entries(inventory)) {
    map.set(normalisePathForKey(localPath), {
      sourceUrl: url,
      archiveUrl: "",
      title: path.basename(localPath),
      provenanceStatus: "inventory-url",
      providerMetadata: "D:/nisra/_inventory.json",
    });
  }
  return map;
}

function buildNisraWaybackProvenance(rootConfig) {
  const map = new Map();
  const inventory = readJsonIfExists(rootConfig.waybackInventoryPath);
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return map;
  for (const item of Object.values(inventory)) {
    if (!item?.localPath) continue;
    const full = path.join(rootConfig.root, item.localPath);
    map.set(normalisePathForKey(full), {
      sourceUrl: item.original || "",
      archiveUrl: item.replayUrl || "",
      title: path.basename(item.localPath),
      publicationDate: item.selectedTimestamp ? `${String(item.selectedTimestamp).slice(0, 4)} archive capture` : "",
      provenanceStatus: "wayback-inventory-url",
      providerMetadata: "D:/nisra-wayback/_wayback_recovery_inventory.json",
    });
  }
  return map;
}

function buildCsoProvenance(rootConfig) {
  const map = new Map();
  const direct = readJsonIfExists(rootConfig.csoAuditPath);
  if (direct?.assets) {
    for (const asset of direct.assets) {
      const localPath = asset.download?.path;
      if (!localPath) continue;
      map.set(normalisePathForKey(localPath), {
        sourceUrl: asset.url || "",
        archiveUrl: "",
        title: asset.text || "",
        sourcePage: asset.sourcePage || "",
        provenanceStatus: asset.download?.status === "downloaded" ? "direct-cso-audit-url" : "direct-cso-audit-nonlocal",
        providerMetadata: "data/provider-mirror-audit/cso-historical-reports-d-drive.json",
      });
    }
  }
  const wayback = readJsonIfExists(rootConfig.csoWaybackPath);
  if (wayback?.assets) {
    for (const asset of wayback.assets) {
      const localPath = asset.download?.path;
      if (!localPath) continue;
      map.set(normalisePathForKey(localPath), {
        sourceUrl: asset.url || asset.recovery?.originalUrl || "",
        archiveUrl: asset.recovery?.snapshotUrl || "",
        title: asset.text || "",
        sourcePage: asset.sourcePage || "",
        publicationDate: asset.download?.timestamp ? `${String(asset.download.timestamp).slice(0, 4)} archive capture` : "",
        provenanceStatus: "cso-wayback-audit-url",
        providerMetadata: "data/provider-mirror-audit/cso-wayback-recovery-d-drive.json",
      });
    }
  }
  return map;
}

function buildCsoDirectRecoveryProvenance(rootConfig) {
  const map = new Map();
  for (const row of readCsvIfExists(rootConfig.csoDirectRecoveryCsv)) {
    if (!row.path) continue;
    map.set(normalisePathForKey(row.path), {
      sourceUrl: row.url || "",
      archiveUrl: "",
      title: row.title || "",
      sourcePage: row.sourcePage || "",
      provenanceStatus: row.status === "downloaded" ? "direct-recovery-csv-url" : "direct-recovery-csv-failed",
      providerMetadata: "data/provider-mirror-audit/cso-direct-recovery-20260619.csv",
    });
  }
  return map;
}

function buildPxstatProvenance(rootConfig) {
  const map = new Map();
  const catalogue = readJsonIfExists(rootConfig.pxstatCataloguePath);
  const tables = Array.isArray(catalogue) ? catalogue : Array.isArray(catalogue?.tables) ? catalogue.tables : [];
  for (const table of tables) {
    const code = table.code || table.matrix || table.id || table.CUBE || table.matrixCode;
    if (!code) continue;
    const title = table.title || table.label || table.name || table.description || "";
    const folder = String(code).slice(0, 3).toUpperCase();
    for (const suffix of [".json", ".meta.json"]) {
      const full = path.join(rootConfig.root, folder, `${code}${suffix}`);
      map.set(normalisePathForKey(full), {
        sourceUrl: table.href || table.url || "",
        archiveUrl: "",
        title,
        sourcePage: table.link || "",
        publicationDate: table.updated || table.modified || "",
        provenanceStatus: "pxstat-catalogue",
        providerMetadata: "D:/cso-pxstat/_catalogue.json",
      });
    }
  }
  return map;
}

function buildProvenance(rootConfig) {
  if (rootConfig.inventoryPath) return buildNisraCurrentProvenance(rootConfig);
  if (rootConfig.waybackInventoryPath) return buildNisraWaybackProvenance(rootConfig);
  if (rootConfig.csoAuditPath || rootConfig.csoWaybackPath) return buildCsoProvenance(rootConfig);
  if (rootConfig.csoDirectRecoveryCsv) return buildCsoDirectRecoveryProvenance(rootConfig);
  if (rootConfig.pxstatCataloguePath) return buildPxstatProvenance(rootConfig);
  return new Map();
}

function classifyFile(file, relPath, ext) {
  const base = path.basename(file).toLowerCase();
  if (SIDE_CAR_EXTENSIONS.has(ext)) return "sidecar";
  if (BOOKKEEPING_NAMES.has(base)) return "mirror-bookkeeping";
  if (EXTRACTABLE_EXTENSIONS.has(ext)) return "extractable";
  if (NON_STATISTICAL_EXTENSIONS.has(ext)) return "non-statistical-asset";
  return "unknown";
}

function inferUrlFromPath(rootConfig, relPath) {
  const rel = normaliseRel(relPath);
  if (rootConfig.corpus === "nisra-current" && rel.startsWith("www.nisra.gov.uk/")) {
    return `https://${rel}`;
  }
  if (rootConfig.corpus === "nisra-wayback" && rel.startsWith("mirror/")) {
    const withoutMirror = rel.replace(/^mirror\//, "");
    if (/^[a-z0-9.-]+\//i.test(withoutMirror)) return `https://${withoutMirror}`;
  }
  if (rootConfig.corpus === "cso-repo-recovered" && rel.includes("/www.cso.ie/")) {
    const idx = rel.indexOf("www.cso.ie/");
    return `https://${rel.slice(idx)}`;
  }
  if (rootConfig.corpus === "cso-pxstat") {
    const base = path.basename(rel);
    const code = base.replace(/\.meta\.json$/i, "").replace(/\.json$/i, "");
    if (/^[A-Z0-9]{4,}$/i.test(code)) {
      return `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/${code}/JSON-stat/2.0/en`;
    }
  }
  return "";
}

function workbookExtraction(file, row) {
  if (row.bytes > LARGE_EXCEL_BYTES) {
    return {
      status: "queued-large-workbook",
      reason: `workbook exceeds ${LARGE_EXCEL_BYTES} byte fast-extraction threshold`,
      details: { bytes: row.bytes },
      records: [],
    };
  }
  const workbook = XLSX.readFile(file, {
    bookSheets: false,
    bookProps: true,
    sheetRows: XLSX_HEADER_ROWS,
    cellDates: false,
    cellNF: false,
    cellStyles: false,
  });
  const records = [];
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }).slice(0, XLSX_HEADER_ROWS);
    records.push({
      sourceId: row.sourceId,
      kind: "workbook-sheet",
      sheetName,
      range: sheet?.["!ref"] || "",
      firstRow: range ? range.s.r + 1 : "",
      lastRow: range ? range.e.r + 1 : "",
      firstColumn: range ? range.s.c + 1 : "",
      lastColumn: range ? range.e.c + 1 : "",
      sampleRows: rows,
    });
  }
  return {
    status: "extracted",
    reason: "",
    details: {
      sheetCount: (workbook.SheetNames || []).length,
      title: workbook.Props?.Title || "",
      author: workbook.Props?.Author || "",
      createdDate: workbook.Props?.CreatedDate ? new Date(workbook.Props.CreatedDate).toISOString() : "",
      modifiedDate: workbook.Props?.ModifiedDate ? new Date(workbook.Props.ModifiedDate).toISOString() : "",
    },
    records,
  };
}

function csvExtraction(file, row, delimiter) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).slice(0, CSV_HEADER_ROWS).filter((line) => line.length);
  const rows = lines.map((line) => delimiter === "\t" ? line.split("\t") : parseCsvLine(line));
  return {
    status: "extracted",
    reason: "",
    details: {
      sampledRows: rows.length,
      sampledColumns: Math.max(0, ...rows.map((fields) => fields.length)),
    },
    records: [{
      sourceId: row.sourceId,
      kind: delimiter === "\t" ? "tsv-sample" : "csv-sample",
      sampleRows: rows,
    }],
  };
}

function jsonExtraction(file, row) {
  if (row.bytes > LARGE_JSON_BYTES) {
    return {
      status: "queued-large-json",
      reason: `JSON exceeds ${LARGE_JSON_BYTES} byte parse threshold`,
      details: { bytes: row.bytes },
      records: [],
    };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const isPxstat = parsed?.class === "dataset" || parsed?.extension?.matrix || Array.isArray(parsed?.id);
  const dimensions = parsed?.dimension && typeof parsed.dimension === "object" ? parsed.dimension : {};
  const dimensionIds = Array.isArray(parsed?.id) ? parsed.id : Object.keys(dimensions);
  const valueCount = Array.isArray(parsed?.value) ? parsed.value.length : typeof parsed?.value === "object" && parsed.value ? Object.keys(parsed.value).length : "";
  const records = [];
  if (isPxstat) {
    records.push({
      sourceId: row.sourceId,
      kind: "pxstat-dataset-summary",
      label: parsed.label || "",
      matrix: parsed.extension?.matrix || "",
      updated: parsed.updated || "",
      role: parsed.role || {},
      dimensionIds,
      dimensions: dimensionIds.map((id) => {
        const dimension = dimensions[id] || {};
        const categories = dimension.category?.index || Object.keys(dimension.category?.label || {});
        return {
          id,
          label: dimension.label || "",
          categoryCount: Array.isArray(categories) ? categories.length : 0,
          sampleCategories: Array.isArray(categories) ? categories.slice(0, 20) : [],
        };
      }),
      size: parsed.size || [],
      valueCount,
      unitSample: dimensions.STATISTIC?.category?.unit || {},
    });
  } else {
    records.push({
      sourceId: row.sourceId,
      kind: "json-summary",
      rootType: Array.isArray(parsed) ? "array" : typeof parsed,
      itemCount: Array.isArray(parsed) ? parsed.length : "",
      topLevelKeys: parsed && !Array.isArray(parsed) && typeof parsed === "object" ? Object.keys(parsed).slice(0, 80) : [],
    });
  }
  return {
    status: "extracted",
    reason: "",
    details: {
      isPxstat,
      dimensionCount: dimensionIds.length,
      valueCount,
      label: parsed?.label || "",
      updated: parsed?.updated || "",
    },
    records,
  };
}

function pdfExtraction(file, row) {
  const size = Math.min(row.bytes, 2 * 1024 * 1024);
  const fd = fs.openSync(file, "r");
  let headerText = "";
  try {
    const buffer = Buffer.alloc(size);
    const bytes = fs.readSync(fd, buffer, 0, size, 0);
    headerText = buffer.subarray(0, bytes).toString("latin1");
  } finally {
    fs.closeSync(fd);
  }
  const parsedInfo = {
    PDFVersion: headerText.match(/%PDF-([0-9.]+)/)?.[1] || "",
    Title: decodePdfLiteral(headerText.match(/\/Title\s*\(([^)]{0,500})\)/)?.[1] || ""),
    Author: decodePdfLiteral(headerText.match(/\/Author\s*\(([^)]{0,500})\)/)?.[1] || ""),
    Creator: decodePdfLiteral(headerText.match(/\/Creator\s*\(([^)]{0,500})\)/)?.[1] || ""),
    Producer: decodePdfLiteral(headerText.match(/\/Producer\s*\(([^)]{0,500})\)/)?.[1] || ""),
    CreationDate: decodePdfLiteral(headerText.match(/\/CreationDate\s*\(([^)]{0,200})\)/)?.[1] || ""),
    ModDate: decodePdfLiteral(headerText.match(/\/ModDate\s*\(([^)]{0,200})\)/)?.[1] || ""),
    ApproxPageCount: headerText.match(/\/Count\s+([0-9]+)/)?.[1] || "",
  };
  const textOperators = (headerText.match(/\b(Tj|TJ|BT|ET)\b/g) || []).length;
  const imageOperators = (headerText.match(/\/Subtype\s*\/Image/g) || []).length;
  const textStatus = textOperators > 3 ? "text-layer-likely-present" : "ocr-required-or-image-pdf";
  const textReason = "Sandbox-safe PDF pass records metadata and text-layer likelihood only; full Poppler/OCR text extraction is queued separately.";
  return {
    status: "extracted",
    reason: textReason,
    details: {
      pages: parsedInfo.ApproxPageCount || "",
      title: parsedInfo.Title || "",
      author: parsedInfo.Author || "",
      creator: parsedInfo.Creator || "",
      producer: parsedInfo.Producer || "",
      creationDate: parsedInfo.CreationDate || "",
      modDate: parsedInfo.ModDate || "",
      textStatus,
      textOperators,
      imageOperators,
      sampledPages: 0,
      textSampleChars: 0,
    },
    records: [{
      sourceId: row.sourceId,
      kind: "pdf-metadata-summary",
      metadata: parsedInfo,
      textStatus,
      textOperators,
      imageOperators,
      textSample: "",
    }],
  };
}

function decodePdfLiteral(value) {
  return String(value || "")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .trim();
}

function extractFile(row) {
  const ext = row.extension;
  if (row.classification === "sidecar") {
    return { status: "skipped-sidecar", reason: "checksum sidecar", details: {}, records: [] };
  }
  if (row.classification === "mirror-bookkeeping") {
    return { status: "skipped-mirror-bookkeeping", reason: "crawler bookkeeping file", details: {}, records: [] };
  }
  if (row.classification === "non-statistical-asset") {
    return { status: "skipped-non-statistical-asset", reason: "site asset or source archive handled separately", details: {}, records: [] };
  }
  if (!EXTRACTABLE_EXTENSIONS.has(ext)) {
    return { status: "unsupported", reason: `no extraction handler for ${ext || "[no extension]"}`, details: {}, records: [] };
  }
  try {
    if (ext === ".csv") return csvExtraction(row.localPath, row, ",");
    if (ext === ".tsv") return csvExtraction(row.localPath, row, "\t");
    if (ext === ".json") return jsonExtraction(row.localPath, row);
    if (ext === ".xlsx" || ext === ".xlsm" || ext === ".xls" || ext === ".ods") return workbookExtraction(row.localPath, row);
    if (ext === ".pdf") return pdfExtraction(row.localPath, row);
  } catch (error) {
    return {
      status: "extraction-failed",
      reason: error.message,
      details: { stack: error.stack?.split("\n").slice(0, 3).join(" | ") || "" },
      records: [],
    };
  }
  return { status: "unsupported", reason: `no extraction handler for ${ext || "[no extension]"}`, details: {}, records: [] };
}

function validateRow(row, byHash, byUrl) {
  const issues = [];
  if (!row.localPath || !fs.existsSync(row.localPath)) issues.push(issue(row, "error", "missing-file", "Registry row points to a missing file"));
  if (row.bytes === 0) issues.push(issue(row, "warning", "zero-byte-file", "File is zero bytes"));
  if (!row.sourceUrl && !row.archiveUrl && row.classification !== "sidecar" && row.classification !== "mirror-bookkeeping") {
    issues.push(issue(row, "warning", "missing-url-provenance", "No source URL or archive URL could be inferred from available manifests"));
  }
  if (!row.sha256) issues.push(issue(row, "error", "missing-hash", "File has no SHA-256 hash"));
  if (row.extension === ".pdf" && row.magic !== "pdf") issues.push(issue(row, "warning", "extension-signature-mismatch", `PDF extension has ${row.magic} signature`));
  if ((row.extension === ".xlsx" || row.extension === ".xlsm" || row.extension === ".ods" || row.extension === ".zip") && row.magic !== "zip") {
    issues.push(issue(row, "warning", "extension-signature-mismatch", `${row.extension} extension has ${row.magic} signature`));
  }
  if (row.extension === ".xls" && row.magic !== "ole") issues.push(issue(row, "warning", "extension-signature-mismatch", `XLS extension has ${row.magic} signature`));
  const duplicateHashCount = byHash.get(row.sha256)?.length || 0;
  if (row.sha256 && duplicateHashCount > 1 && row.classification !== "sidecar") {
    issues.push(issue(row, "info", "duplicate-content-hash", `${duplicateHashCount} registry rows share this content hash`));
  }
  const duplicateUrlCount = row.sourceUrl ? byUrl.get(row.sourceUrl)?.length || 0 : 0;
  if (row.sourceUrl && duplicateUrlCount > 1) {
    issues.push(issue(row, "info", "duplicate-source-url", `${duplicateUrlCount} registry rows share this source URL`));
  }
  return issues;
}

function issue(row, severity, code, message) {
  return {
    severity,
    code,
    message,
    sourceId: row.sourceId,
    provider: row.provider,
    corpus: row.corpus,
    localPath: row.localPath,
    sourceUrl: row.sourceUrl,
  };
}

async function buildRegistry() {
  const registry = [];
  for (const rootConfig of ROOTS) {
    if (!fs.existsSync(rootConfig.root)) {
      registry.push({
        sourceId: stableId(rootConfig.provider, rootConfig.corpus, rootConfig.root, "missing-root"),
        provider: rootConfig.provider,
        corpus: rootConfig.corpus,
        sourceRoot: rootConfig.root,
        relativePath: "",
        localPath: "",
        sourceUrl: "",
        archiveUrl: "",
        sourcePage: "",
        title: "",
        publicationDate: "",
        crawlBatch: rootConfig.corpus,
        provenance: rootConfig.provenance,
        provenanceStatus: "missing-root",
        providerMetadata: "",
        extension: "",
        fileType: "",
        classification: "missing-root",
        bytes: 0,
        modifiedTime: "",
        sha256: "",
        signature: "",
        magic: "",
      });
      continue;
    }
    const provenance = buildProvenance(rootConfig);
    const files = await walkFiles(rootConfig.root);
    console.log(`[registry] ${rootConfig.corpus}: ${files.length} files`);
    let index = 0;
    for (const file of files) {
      index++;
      if (index % 5000 === 0) console.log(`[registry] ${rootConfig.corpus}: ${index}/${files.length}`);
      const stat = fs.statSync(file);
      const relPath = normaliseRel(path.relative(rootConfig.root, file));
      const ext = path.extname(file).toLowerCase();
      const classification = classifyFile(file, relPath, ext);
      const meta = provenance.get(normalisePathForKey(file)) || {};
      const sourceUrl = meta.sourceUrl || inferUrlFromPath(rootConfig, relPath);
      const signature = fileSignature(file);
      const sha256 = sha256File(file);
      registry.push({
        sourceId: stableId(rootConfig.provider, rootConfig.corpus, sourceUrl, relPath),
        provider: rootConfig.provider,
        corpus: rootConfig.corpus,
        sourceRoot: rootConfig.root,
        relativePath: relPath,
        localPath: file,
        sourceUrl,
        archiveUrl: meta.archiveUrl || "",
        sourcePage: meta.sourcePage || "",
        title: meta.title || path.basename(file),
        publicationDate: meta.publicationDate || "",
        crawlBatch: rootConfig.corpus,
        provenance: rootConfig.provenance,
        provenanceStatus: meta.provenanceStatus || (sourceUrl ? "inferred-from-path" : "local-file-only"),
        providerMetadata: meta.providerMetadata || "",
        extension: ext,
        fileType: ext.replace(/^\./, "") || "[none]",
        classification,
        bytes: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        sha256,
        signature,
        magic: detectMagic(signature),
      });
    }
  }
  return registry;
}

function summarizeRows(rows, key) {
  const counts = {};
  for (const row of rows) addCount(counts, row[key] || "[blank]");
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function topDuplicates(groups, limit = 200) {
  return [...groups.entries()]
    .filter(([key, rows]) => key && rows.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      sampleSourceIds: rows.slice(0, 12).map((row) => row.sourceId),
      samplePaths: rows.slice(0, 8).map((row) => row.localPath),
    }));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  for (const name of [
    "source-registry.jsonl",
    "extracted-summaries.jsonl",
    "extraction-manifest.jsonl",
  ]) {
    fs.writeFileSync(path.join(OUT_DIR, name), "", "utf8");
  }

  const startedAt = new Date().toISOString();
  const registry = await buildRegistry();
  const byHash = new Map();
  const byUrl = new Map();
  for (const row of registry) {
    if (row.sha256) {
      if (!byHash.has(row.sha256)) byHash.set(row.sha256, []);
      byHash.get(row.sha256).push(row);
    }
    if (row.sourceUrl) {
      if (!byUrl.has(row.sourceUrl)) byUrl.set(row.sourceUrl, []);
      byUrl.get(row.sourceUrl).push(row);
    }
  }

  appendJsonl(path.join(OUT_DIR, "source-registry.jsonl"), registry);
  writeCsv(path.join(OUT_DIR, "source-registry.csv"), registry, [
    "sourceId",
    "provider",
    "corpus",
    "relativePath",
    "localPath",
    "sourceUrl",
    "archiveUrl",
    "sourcePage",
    "title",
    "publicationDate",
    "crawlBatch",
    "provenance",
    "provenanceStatus",
    "providerMetadata",
    "extension",
    "fileType",
    "classification",
    "bytes",
    "modifiedTime",
    "sha256",
    "magic",
  ]);

  const validationIssues = [];
  for (const row of registry) validationIssues.push(...validateRow(row, byHash, byUrl));

  const extractionManifest = [];
  const extractedSummaryFile = path.join(OUT_DIR, "extracted-summaries.jsonl");
  let extractedRecordCount = 0;
  let extractedFileCount = 0;
  for (let i = 0; i < registry.length; i++) {
    const row = registry[i];
    if ((i + 1) % 1000 === 0) console.log(`[extract] ${i + 1}/${registry.length}`);
    const extraction = extractFile(row);
    if (extraction.records?.length) {
      appendJsonl(extractedSummaryFile, extraction.records);
      extractedRecordCount += extraction.records.length;
      extractedFileCount++;
    }
    const manifestRow = {
      sourceId: row.sourceId,
      provider: row.provider,
      corpus: row.corpus,
      localPath: row.localPath,
      sourceUrl: row.sourceUrl,
      extension: row.extension,
      classification: row.classification,
      extractionStatus: extraction.status,
      extractionReason: extraction.reason,
      extractedRecordCount: extraction.records?.length || 0,
      detailsJson: JSON.stringify(extraction.details || {}),
    };
    extractionManifest.push(manifestRow);
    if (extraction.status === "extraction-failed") {
      validationIssues.push(issue(row, "warning", "extraction-failed", extraction.reason));
    }
    if (extraction.details?.textStatus === "ocr-required-or-image-pdf") {
      validationIssues.push(issue(row, "info", "ocr-required", "PDF has no extractable sample text in the first pages"));
    }
    if (extraction.status === "queued-large-workbook" || extraction.status === "queued-large-json") {
      validationIssues.push(issue(row, "info", "queued-large-file", extraction.reason));
    }
  }

  appendJsonl(path.join(OUT_DIR, "extraction-manifest.jsonl"), extractionManifest);
  writeCsv(path.join(OUT_DIR, "extraction-manifest.csv"), extractionManifest, [
    "sourceId",
    "provider",
    "corpus",
    "localPath",
    "sourceUrl",
    "extension",
    "classification",
    "extractionStatus",
    "extractionReason",
    "extractedRecordCount",
    "detailsJson",
  ]);

  writeCsv(path.join(OUT_DIR, "validation-issues.csv"), validationIssues, [
    "severity",
    "code",
    "message",
    "sourceId",
    "provider",
    "corpus",
    "localPath",
    "sourceUrl",
  ]);

  const validationReport = {
    generatedAt: new Date().toISOString(),
    startedAt,
    host: os.hostname(),
    roots: ROOTS.map((root) => ({
      provider: root.provider,
      corpus: root.corpus,
      root: root.root,
      exists: fs.existsSync(root.root),
    })),
    registry: {
      totalFiles: registry.length,
      byProvider: summarizeRows(registry, "provider"),
      byCorpus: summarizeRows(registry, "corpus"),
      byClassification: summarizeRows(registry, "classification"),
      byExtension: summarizeRows(registry, "extension"),
      byProvenanceStatus: summarizeRows(registry, "provenanceStatus"),
      duplicateHashes: [...byHash.entries()].filter(([key, rows]) => key && rows.length > 1).length,
      duplicateSourceUrls: [...byUrl.entries()].filter(([key, rows]) => key && rows.length > 1).length,
    },
    extraction: {
      totalFiles: extractionManifest.length,
      filesWithExtractedRecords: extractedFileCount,
      extractedRecords: extractedRecordCount,
      byStatus: summarizeRows(extractionManifest, "extractionStatus"),
      byClassification: summarizeRows(extractionManifest, "classification"),
    },
    validation: {
      issueCount: validationIssues.length,
      bySeverity: summarizeRows(validationIssues, "severity"),
      byCode: summarizeRows(validationIssues, "code"),
      topDuplicateHashes: topDuplicates(byHash),
      topDuplicateSourceUrls: topDuplicates(byUrl),
    },
    notes: [
      "Registry and validation are complete for discovered local files under configured roots.",
      "Extraction is a fast staging layer: workbook headers/sheet metadata, CSV samples, PXStat summaries, and sandbox-safe PDF metadata/text-layer likelihood.",
      "Full OCR and full PDF table reconstruction remain follow-up work for files flagged ocr-required.",
      "Raw provider data remains on D: or in ignored data/downloads; this output stores indexes and summaries only.",
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, "validation-report.json"), `${JSON.stringify(validationReport, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "README.md"), buildReadme(validationReport), "utf8");
  console.log(JSON.stringify({
    registryRows: registry.length,
    extractionRows: extractionManifest.length,
    extractedFileCount,
    extractedRecordCount,
    validationIssues: validationIssues.length,
    output: path.relative(REPO, OUT_DIR),
  }, null, 2));
}

function buildReadme(report) {
  return `# CSO/NISRA Statistical Staging

Generated: ${report.generatedAt}

This staging pack implements the first three concrete layers for the collected CSO and NISRA corpora:

1. Source registry
2. Validation
3. Extraction layer

It does not publish anything to the Civgraph site and does not copy raw provider corpora into Git.

## Outputs

- \`source-registry.csv\` / \`source-registry.jsonl\`: one stable source record per discovered local file.
- \`validation-report.json\`: aggregate validation and extraction summary.
- \`validation-issues.csv\`: row-level validation issues and follow-up flags.
- \`extraction-manifest.csv\` / \`extraction-manifest.jsonl\`: extraction status per source record.
- \`extracted-summaries.jsonl\`: compact extracted sheet/table/page summaries.

## Registry Summary

- Total files: ${report.registry.totalFiles}
- By provider: ${JSON.stringify(report.registry.byProvider)}
- By corpus: ${JSON.stringify(report.registry.byCorpus)}
- By classification: ${JSON.stringify(report.registry.byClassification)}

## Extraction Summary

- Files with extracted summary records: ${report.extraction.filesWithExtractedRecords}
- Extracted summary records: ${report.extraction.extractedRecords}
- By status: ${JSON.stringify(report.extraction.byStatus)}

## Validation Summary

- Total issues/flags: ${report.validation.issueCount}
- By severity: ${JSON.stringify(report.validation.bySeverity)}
- By code: ${JSON.stringify(report.validation.byCode)}

## Notes

- PDF extraction in this script is sandbox-safe: it records basic metadata and text-layer likelihood without spawning Poppler.
- OCR is not run here. PDFs without likely extractable text are flagged for later OCR/table reconstruction.
- Workbook extraction is intentionally header/sheet focused to avoid committing large source-derived cell dumps.
- PXStat JSON extraction records dataset labels, dimensions, category counts, sizes, units, and value counts without copying raw payloads.
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
