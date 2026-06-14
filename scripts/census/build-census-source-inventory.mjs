#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(REPO, "data", "census", "source-inventory");
const OUT_PATH = path.join(OUT_DIR, "census-source-archives.json");
const DOWNLOADS_DIR = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "Downloads")
  : path.join(process.env.HOME || "", "Downloads");

function downloadsPath(file) {
  return path.join(DOWNLOADS_DIR, file);
}

const LOCAL_ARCHIVES = [
  { year: 2011, scope: "Northern Ireland", kind: "digital_tables", file: "Census 2011 Complete.zip", path: downloadsPath("Census 2011 Complete.zip") },
  { year: 2021, scope: "Northern Ireland", kind: "digital_tables", file: "Census 2021 Complete.zip", path: downloadsPath("Census 2021 Complete.zip") },
  { year: 2001, scope: "Northern Ireland", kind: "digital_tables", file: "Census 2001 Complete.zip", path: downloadsPath("Census 2001 Complete.zip") },
  { year: 1991, scope: "Northern Ireland", kind: "historical_reports", file: "1991 Census Complete.zip", path: downloadsPath("1991 Census Complete.zip") },
  { year: 1981, scope: "Northern Ireland", kind: "historical_reports", file: "1981 Census Complete.zip", path: downloadsPath("1981 Census Complete.zip") },
  { year: 1971, scope: "Northern Ireland", kind: "historical_reports", file: "1971 Census Complete.zip", path: downloadsPath("1971 Census Complete.zip") },
  { year: 1966, scope: "Northern Ireland", kind: "historical_reports", file: "1966 Census Complete.zip", path: downloadsPath("1966 Census Complete.zip") },
  { year: 1961, scope: "Northern Ireland", kind: "historical_reports", file: "1961 Census Complete.zip", path: downloadsPath("1961 Census Complete.zip") },
  { year: 1951, scope: "Northern Ireland", kind: "historical_reports", file: "1951 Census Complete.zip", path: downloadsPath("1951 Census Complete.zip") },
  { year: 1937, scope: "Northern Ireland", kind: "historical_reports", file: "1937 Census Complete.zip", path: downloadsPath("1937 Census Complete.zip") },
  { year: 1911, scope: "Ireland", kind: "all_ireland_historical", file: "1911 Census Complete.zip", path: downloadsPath("1911 Census Complete.zip") },
];

function extOf(file) {
  const ext = path.extname(file || "").toLowerCase().replace(".", "");
  return ext || "[none]";
}

function addCount(counts, key, delta = 1) {
  counts[key] = (counts[key] || 0) + delta;
}

async function listFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory() && (rel === "source-inventory" || rel === "cleaned")) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        files.push({ path: path.relative(REPO, full).replace(/\\/g, "/"), bytes: stat.size });
      }
    }
  }
  await walk(root);
  return files;
}

function readZipEntriesFromBuffer(buffer) {
  const tailSize = Math.min(buffer.length, 1024 * 128);
  const tailStart = buffer.length - tailSize;
  const tail = buffer.subarray(tailStart);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = tailStart + i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP central directory not found");
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported by this lightweight inventory reader");
  }
  const central = buffer.subarray(centralOffset, centralOffset + centralSize);
  const entries = [];
  let pos = 0;
  while (pos + 46 <= central.length) {
    if (central.readUInt32LE(pos) !== 0x02014b50) break;
    const flags = central.readUInt16LE(pos + 8);
    const method = central.readUInt16LE(pos + 10);
    const compressedSize = central.readUInt32LE(pos + 20);
    const uncompressedSize = central.readUInt32LE(pos + 24);
    const nameLen = central.readUInt16LE(pos + 28);
    const extraLen = central.readUInt16LE(pos + 30);
    const commentLen = central.readUInt16LE(pos + 32);
    const localHeaderOffset = central.readUInt32LE(pos + 42);
    const nameStart = pos + 46;
    const nameEnd = nameStart + nameLen;
    const encoding = flags & 0x0800 ? "utf8" : "latin1";
    const name = central.toString(encoding, nameStart, nameEnd).replace(/\\/g, "/");
    entries.push({
      path: name,
      directory: name.endsWith("/"),
      extension: extOf(name),
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    pos = nameEnd + extraLen + commentLen;
  }
  return { zip64: false, advertisedEntries: totalEntries, entries };
}

function readZipEntryData(buffer, entry) {
  if (entry.directory || entry.compressedSize <= 0 || entry.uncompressedSize <= 0) return null;
  if (entry.flags & 0x0001) return null;
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return null;
  const nameLen = buffer.readUInt16LE(offset + 26);
  const extraLen = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) return null;
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  return null;
}

function inspectNestedZipEntries(buffer, entries, depth = 1) {
  if (depth > 3) return [];
  const nestedArchives = [];
  for (const entry of entries.filter((item) => !item.directory && item.extension === "zip")) {
    try {
      const nestedBuffer = readZipEntryData(buffer, entry);
      if (!nestedBuffer) {
        nestedArchives.push({ path: entry.path, error: "Unsupported compressed ZIP entry" });
        continue;
      }
      const nested = readZipEntriesFromBuffer(nestedBuffer);
      const childNestedArchives = inspectNestedZipEntries(nestedBuffer, nested.entries, depth + 1);
      nestedArchives.push({
        path: entry.path,
        advertisedEntries: nested.advertisedEntries,
        ...summariseEntries(nested.entries),
        nestedArchives: childNestedArchives,
      });
    } catch (error) {
      nestedArchives.push({ path: entry.path, error: error.message });
    }
  }
  return nestedArchives;
}

async function readZipCentralDirectory(zipPath) {
  const buffer = await fs.readFile(zipPath);
  const zip = readZipEntriesFromBuffer(buffer);
  zip.nestedArchives = inspectNestedZipEntries(buffer, zip.entries);
  return zip;
}

function summariseEntries(entries) {
  const files = entries.filter((entry) => !entry.directory);
  const byExtension = {};
  const topDirectories = {};
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  for (const entry of files) {
    addCount(byExtension, entry.extension);
    addCount(topDirectories, entry.path.split("/")[0] || "[root]");
    uncompressedBytes += entry.uncompressedSize || 0;
    compressedBytes += entry.compressedSize || 0;
  }
  return {
    entries: entries.length,
    files: files.length,
    directories: entries.length - files.length,
    byExtension,
    topDirectories,
    compressedBytes,
    uncompressedBytes,
    sampleFiles: files.slice(0, 60).map((entry) => entry.path),
    fileIndex: files.map((entry) => ({
      path: entry.path,
      extension: entry.extension,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    })),
  };
}

async function inventoryArchive(spec) {
  const archive = {
    year: spec.year,
    scope: spec.scope,
    kind: spec.kind,
    file: spec.file,
    sourceHint: `<Downloads>/${spec.file}`,
    exists: false,
    bytes: null,
    lastModified: null,
    zip: null,
    error: null,
  };
  try {
    const stat = await fs.stat(spec.path);
    archive.exists = true;
    archive.bytes = stat.size;
    archive.lastModified = stat.mtime.toISOString();
    const zip = await readZipCentralDirectory(spec.path);
    archive.zip = {
      advertisedEntries: zip.advertisedEntries,
      ...summariseEntries(zip.entries),
      nestedArchives: zip.nestedArchives,
    };
  } catch (error) {
    archive.error = error.message;
  }
  return archive;
}

async function inventoryRepoCensus() {
  const root = path.join(REPO, "data", "census");
  const files = await listFiles(root);
  const byExtension = {};
  const byTopDirectory = {};
  let bytes = 0;
  for (const file of files) {
    addCount(byExtension, extOf(file.path));
    const parts = file.path.split("/");
    addCount(byTopDirectory, parts.slice(0, 3).join("/") || "[root]");
    bytes += file.bytes;
  }
  return {
    root: "data/census",
    files: files.length,
    bytes,
    byExtension,
    byTopDirectory,
    sampleFiles: files.slice(0, 80).map((file) => file.path),
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const archives = [];
  for (const spec of LOCAL_ARCHIVES) archives.push(await inventoryArchive(spec));
  const repoCensus = await inventoryRepoCensus();
  const csoManifestPath = path.join(OUT_DIR, "cso-historical-reports.json");
  const csoManifest = JSON.parse(await fs.readFile(csoManifestPath, "utf8").catch(() => "null"));
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourcePolicy: "Local ZIP/PDF sources are inventoried only. Raw CSO downloads live under data/downloads/, which is gitignored.",
    localArchives: archives,
    repoCensus,
    csoHistoricalReports: csoManifest
      ? {
          manifestPath: "data/census/source-inventory/cso-historical-reports.json",
          pagesVisited: csoManifest.pagesVisited,
          assetsFound: csoManifest.assetsFound,
          assetsDownloaded: csoManifest.assetsDownloaded,
          assetsCached: csoManifest.assetsCached,
          assetsFailed: csoManifest.assetsFailed,
        }
      : null,
  };
  await fs.writeFile(OUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Census source inventory: ${path.relative(REPO, OUT_PATH)}`);
  console.log(`Local archives found: ${archives.filter((archive) => archive.exists).length}/${archives.length}`);
  console.log(`Repo census files: ${repoCensus.files}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
