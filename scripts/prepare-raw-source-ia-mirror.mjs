#!/usr/bin/env node
import crypto from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, 'tmp', 'raw-source-ia');
const SOURCE_DOCS = path.join(ROOT, 'data', 'database', 'raw-source-documents.json');
const UA = 'Civgraph raw source IA mirror/1.0 (+https://civgraph.net)';
const TARGET_ITEMS = {
  'data.gov.ie': {
    identifier: 'civgraph-data-gov-ie-raw-sources',
    api: 'https://data.gov.ie/api/3/action/package_show?id=',
    rootEnv: 'RAW_SOURCE_DATAGOVIE_ROOT',
    title: 'Civgraph raw source mirrors - data.gov.ie',
    provider: 'data.gov.ie'
  },
  'Open Data NI': {
    identifier: 'civgraph-open-data-ni-raw-sources',
    api: 'https://admin.opendatani.gov.uk/api/3/action/package_show?id=',
    rootEnv: 'RAW_SOURCE_OPENDATANI_ROOT',
    title: 'Civgraph raw source mirrors - Open Data NI',
    provider: 'Open Data NI'
  }
};

const SERVICE_FORMATS = new Set([
  'API',
  'ARCGIS',
  'ARCGIS GEOSERVICES REST API',
  'ARCGIS_GEOSERVICE',
  'ESRI REST',
  'ESRI REST API',
  'FEATURESERVER',
  'HTML',
  'JSON API',
  'MAPSERVER',
  'REST API',
  'WEBPAGE',
  'WFS',
  'WMS',
  'WMTS'
]);

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args['out-dir'] || DEFAULT_OUT_DIR);
const fetchProvider = Boolean(args['fetch-provider'] || args['download-missing']);
const downloadMissing = Boolean(args['download-missing']);
const stageFiles = Boolean(args.stage || args['download-missing']);
const limit = Number(args.limit || 0);
const concurrency = Math.max(1, Math.min(8, Number(args.concurrency || 4)));

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  const sourceDocs = readJson(SOURCE_DOCS);
  const allSources = sourceDocs.sources || [];
  const sources = limit > 0 ? allSources.slice(0, limit) : allSources;
  const providerManifests = readProviderManifests();
  const records = [];
  const downloadJobs = [];
  const warnings = [];

  for (const source of sources) {
    const provider = sourceProvider(source);
    const target = TARGET_ITEMS[provider];
    if (!target) {
      warnings.push({ sourceId: source.id, warning: `Unsupported provider ${provider || '[missing]'}` });
      continue;
    }
    const slug = sourceSlug(source);
    if (!slug) {
      warnings.push({ sourceId: source.id, warning: 'Could not infer provider package slug' });
      continue;
    }

    const manifestRows = providerManifests.get(provider)?.filter((row) => row.package_name === slug) || [];
    const localRows = manifestRows
      .filter((row) => row.status === 'ok' && row.target_path && providerRoot(provider) && existsSync(path.join(providerRoot(provider), row.target_path)))
      .map((row) => localRecordFromManifest(source, target, row));

    const seenResourceKeys = new Set(localRows.map((row) => row.resourceKey).filter(Boolean));
    const sourceRecords = [...localRows];
    let packageJson = null;
    if (fetchProvider) {
      try {
        packageJson = await fetchPackage(target, slug, source);
      } catch (error) {
        warnings.push({ sourceId: source.id, slug, warning: `Provider package fetch failed: ${error.message}` });
      }
    }

    if (packageJson) {
      const apiRows = resourcesFromPackage(source, target, packageJson)
        .filter((row) => !seenResourceKeys.has(row.resourceKey));
      sourceRecords.push(...apiRows);
    }

    if (!sourceRecords.length && manifestRows.length) {
      warnings.push({
        sourceId: source.id,
        slug,
        warning: `Provider manifest had ${manifestRows.length} rows, but no local ok files were available`
      });
    }

    for (const record of dedupeSourceRecords(sourceRecords)) {
      if (downloadMissing && record.status === 'download-pending') {
        downloadJobs.push(record);
      }
      assertPublicSafe(record);
      records.push(record);
    }
  }

  if (downloadJobs.length) {
    console.log(`Downloading ${downloadJobs.length} provider resources with concurrency ${concurrency}...`);
    await runPool(downloadJobs, concurrency, downloadResource);
  }

  for (const record of records) {
    applyIaStoragePathAdjustments(record);
  }

  const stageable = records.filter(isUsableRecord);
  if (stageFiles) {
    console.log(`Staging ${stageable.length} files under ${path.relative(ROOT, outDir)}...`);
    for (const record of stageable) {
      stageRecord(record);
    }
  }

  for (const record of records) {
    if (record.stagingPath && existsSync(record.stagingPath)) {
      const stat = statSync(record.stagingPath);
      record.size = stat.size;
      record.sha256 = await sha256File(record.stagingPath);
    } else if (record.localPath && existsSync(record.localPath)) {
      const stat = statSync(record.localPath);
      record.size = stat.size;
      record.sha256 = await sha256File(record.localPath);
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, 'upload-manifest.local.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note: 'Local operational manifest. Ignored by git. Contains local filesystem paths for IA upload only.',
    summary: buildLocalSummary(records, warnings),
    items: itemSummaries(records),
    records: records.map((record) => ({
      ...record,
      publicDownloadUrl: downloadUrl(record.itemIdentifier, record.internalPath)
    })),
    warnings
  });

  const publicCandidate = buildPublicMirrorCandidate(sourceDocs, records, warnings);
  assertNoLocalPaths(publicCandidate);
  writeJson(path.join(outDir, 'raw-source-ia-mirrors.candidate.json'), publicCandidate);

  for (const item of itemSummaries(records)) {
    const fileList = records
      .filter((record) => record.itemIdentifier === item.identifier && record.stagingRelativePath)
      .map((record) => record.stagingRelativePath)
      .sort();
    writeFileSync(path.join(outDir, `upload-file-list-${item.identifier}.txt`), `${fileList.join('\n')}\n`, 'utf8');
  }

  console.log(JSON.stringify({
    sourceRows: sources.length,
    candidateRecords: records.length,
    stageableFiles: stageable.length,
    downloadJobs: downloadJobs.length,
    warnings: warnings.length,
    outDir: path.relative(ROOT, outDir)
  }, null, 2));
}

function localRecordFromManifest(source, target, row) {
  const root = providerRoot(target.provider);
  const internalPath = posixPath(row.target_path);
  const localPath = path.join(root, row.target_path);
  return {
    sourceId: source.id,
    title: source.title,
    provider: target.provider,
    sourceUrl: source.url,
    sourceSlug: sourceSlug(source),
    itemIdentifier: target.identifier,
    itemTitle: target.title,
    itemUrl: itemUrl(target.identifier),
    resourceKey: row.resource_id || row.url || internalPath,
    resourceId: row.resource_id || null,
    format: cleanText(row.format),
    resourceUrl: normalizeUrl(row.url),
    internalPath,
    localPath,
    origin: 'provider-mirror-manifest',
    status: 'local-ready'
  };
}

function resourcesFromPackage(source, target, packageJson) {
  const result = packageJson.result || {};
  const organization = result.organization?.title || result.organization?.name || source.provider?.[0] || target.provider;
  const packageName = result.name || sourceSlug(source);
  const rows = [];
  const used = new Set();
  for (const [index, resource] of (result.resources || []).entries()) {
    if (!isDownloadableResource(resource)) continue;
    const internalPath = uniqueInternalPath(organization, packageName, resourceFilename(packageName, resource, index), used);
    rows.push({
      sourceId: source.id,
      title: source.title,
      provider: target.provider,
      sourceUrl: source.url,
      sourceSlug: sourceSlug(source),
      itemIdentifier: target.identifier,
      itemTitle: target.title,
      itemUrl: itemUrl(target.identifier),
      resourceKey: resource.id || normalizeUrl(resource.url) || `${packageName}:${index}`,
      resourceId: resource.id || null,
      resourceName: cleanText(resource.name || resource.title),
      format: cleanText(resource.format || resource.mimetype),
      resourceUrl: normalizeUrl(resource.url),
      internalPath,
      localPath: path.join(outDir, 'downloads', target.identifier, ...internalPath.split('/')),
      origin: 'provider-api-download',
      status: downloadMissing ? 'download-pending' : 'download-needed'
    });
  }
  return rows;
}

async function downloadResource(record) {
  mkdirSync(path.dirname(record.localPath), { recursive: true });
  if (existsSync(record.localPath) && statSync(record.localPath).size > 0) {
    if (!(await recoverInvalidDownloadedFile(record))) return;
    record.status = 'downloaded';
    return;
  }
  const response = await fetch(record.resourceUrl, {
    headers: { 'user-agent': UA, accept: '*/*' },
    signal: AbortSignal.timeout(300000)
  });
  if (!response.ok || !response.body) {
    if (response.status === 403 && process.platform === 'win32') {
      await downloadWithPowerShell(record.resourceUrl, record.localPath);
      record.status = 'downloaded';
      return;
    }
    record.status = 'download-failed';
    record.error = `${response.status} ${response.statusText}`;
    return;
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(record.localPath));
  if (!(await recoverInvalidDownloadedFile(record))) return;
  record.status = 'downloaded';
}

async function recoverInvalidDownloadedFile(record) {
  if (!isInvalidPdf(record.localPath, record.internalPath)) return true;
  if (shouldMirrorInvalidPdfAsHtml(record)) {
    mirrorRecordAsHtml(record);
    return true;
  }
  const recovered = await fetchWaybackCapture(record.resourceUrl, 'application/pdf');
  if (!recovered) {
    record.status = 'download-failed';
    record.error = 'Downloaded .pdf is not a PDF and no valid Wayback PDF capture was found';
    return false;
  }
  const response = await fetch(recovered.downloadUrl, {
    headers: { 'user-agent': UA, accept: 'application/pdf,*/*' },
    signal: AbortSignal.timeout(300000)
  });
  if (!response.ok || !response.body) {
    record.status = 'download-failed';
    record.error = `Wayback PDF download failed: ${response.status} ${response.statusText}`;
    return false;
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(record.localPath));
  if (isInvalidPdf(record.localPath, record.internalPath)) {
    record.status = 'download-failed';
    record.error = 'Wayback PDF capture did not produce a valid PDF';
    return false;
  }
  record.originalResourceUrl = record.resourceUrl;
  record.resourceUrl = recovered.downloadUrl;
  record.origin = 'wayback-provider-resource';
  record.waybackTimestamp = recovered.timestamp;
  return true;
}

function isInvalidPdf(filePath, internalPath) {
  if (!/\.pdf$/i.test(internalPath || filePath)) return false;
  if (!existsSync(filePath) || statSync(filePath).size < 5) return true;
  const head = readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 5);
  return head !== '%PDF-';
}

function applyIaStoragePathAdjustments(record) {
  if (record.status === 'download-failed') return;
  if (!/\.pdf$/i.test(record.internalPath || '') || !existsSync(record.localPath)) return;
  if (!hasNonZeroIndexedXref(record.localPath)) return;
  const originalPath = record.internalPath;
  record.internalPath = `${record.internalPath}.dat`;
  record.iaStorage = {
    mode: 'raw-bytes',
    originalPath,
    note: 'Provider PDF has a non-zero-indexed xref table that Internet Archive rejects under a .pdf path; mirrored as exact raw provider bytes under .pdf.dat.'
  };
}

function hasNonZeroIndexedXref(filePath) {
  const text = readFileSync(filePath, 'latin1');
  const matches = text.matchAll(/(?:^|[\r\n])xref\s*[\r\n]+\s*(\d+)\s+\d+/g);
  for (const match of matches) {
    if (match[1] !== '0') return true;
  }
  return false;
}

function shouldMirrorInvalidPdfAsHtml(record) {
  if (!isHtmlDocument(record.localPath)) return false;
  try {
    const ext = path.posix.extname(new URL(record.resourceUrl).pathname).toLowerCase();
    return !ext || ext === '.html' || ext === '.htm' || ext === '.aspx';
  } catch {
    return false;
  }
}

function isHtmlDocument(filePath) {
  if (!existsSync(filePath) || statSync(filePath).size < 15) return false;
  const head = readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 256).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function mirrorRecordAsHtml(record) {
  record.internalPath = record.internalPath.replace(/\.pdf$/i, '.html');
  record.format = 'HTML';
  record.validation = {
    note: 'Provider metadata labelled this resource as PDF, but the resource URL resolves to an HTML disclosure page; mirrored as HTML.'
  };
}

async function fetchWaybackCapture(originalUrl, mimetype) {
  if (!normalizeUrl(originalUrl)) return null;
  const cdx = new URL('https://web.archive.org/cdx');
  cdx.searchParams.set('url', originalUrl);
  cdx.searchParams.set('output', 'json');
  cdx.searchParams.set('fl', 'timestamp,original,statuscode,mimetype,digest');
  cdx.searchParams.set('filter', 'statuscode:200');
  cdx.searchParams.set('limit', '10');
  const response = await fetch(cdx, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) return null;
  const rows = await response.json();
  for (const row of rows.slice(1)) {
    const [timestamp, original, , capturedMimetype] = row;
    if (mimetype && !String(capturedMimetype || '').toLowerCase().includes(mimetype)) continue;
    return {
      timestamp,
      original,
      downloadUrl: `https://web.archive.org/web/${timestamp}id_/${original}`
    };
  }
  return null;
}

async function downloadWithPowerShell(url, outFile) {
  mkdirSync(path.dirname(outFile), { recursive: true });
  const escapedUrl = psSingleQuote(url);
  const escapedOutFile = psSingleQuote(outFile);
  const command = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'; 'Accept' = '*/*'; 'Referer' = 'https://www.gov.ie/' }",
    `Invoke-WebRequest -Uri ${escapedUrl} -Headers $headers -MaximumRedirection 10 -OutFile ${escapedOutFile}`
  ].join('; ');
  await runProcess('powershell.exe', ['-NoProfile', '-Command', command]);
  if (!existsSync(outFile) || statSync(outFile).size === 0) {
    throw new Error('PowerShell download completed without writing the expected output file');
  }
}

function stageRecord(record) {
  const itemRoot = path.join(outDir, 'staging', record.itemIdentifier);
  const targetPath = path.join(itemRoot, ...record.internalPath.split('/'));
  mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!existsSync(targetPath) || statSync(targetPath).size !== statSync(record.localPath).size) {
    copyFileSync(record.localPath, targetPath);
  }
  record.stagingPath = targetPath;
  record.stagingRelativePath = record.internalPath;
}

function readProviderManifests() {
  const map = new Map();
  for (const [provider, target] of Object.entries(TARGET_ITEMS)) {
    const root = providerRoot(provider);
    if (!root) {
      map.set(provider, []);
      continue;
    }
    const manifest = path.join(root, '_manifest.csv');
    map.set(provider, existsSync(manifest) ? parseCsv(readFileSync(manifest, 'utf8')) : []);
  }
  return map;
}

function providerRoot(provider) {
  const envName = TARGET_ITEMS[provider]?.rootEnv;
  const value = envName ? process.env[envName] : '';
  return value ? path.resolve(value) : '';
}

async function fetchPackage(target, slug, source) {
  const url = `${target.api}${encodeURIComponent(slug)}`;
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    if (response.status === 404) {
      const searched = await searchPackage(target, source);
      if (searched) return searched;
    }
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  if (!json.success) throw new Error('CKAN package_show returned success=false');
  return json;
}

async function searchPackage(target, source) {
  const api = target.api.replace(/package_show\?id=$/, 'package_search?q=');
  const query = source.title || sourceSlug(source);
  const url = `${api}${encodeURIComponent(query)}&rows=5`;
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) return null;
  const json = await response.json();
  const result = json.result?.results?.[0];
  if (!json.success || !result) return null;
  return { success: true, result, searchFallback: true };
}

function isDownloadableResource(resource) {
  const url = normalizeUrl(resource.url);
  if (!url) return false;
  const format = cleanText(resource.format || resource.mimetype).toUpperCase();
  if (SERVICE_FORMATS.has(format)) return false;
  if (/\/(?:MapServer|FeatureServer)(?:\/|$)|\/query(?:\?|$)|\/wms\b|\/wfs\b|\/wmts\b/i.test(url)) return false;
  return true;
}

function resourceFilename(packageName, resource, index) {
  const url = normalizeUrl(resource.url);
  let basename = '';
  try {
    basename = decodeURIComponent(path.posix.basename(new URL(url).pathname));
  } catch {
    basename = '';
  }
  const hasUsefulBasename = basename && basename.length > 2 && basename.toLowerCase() !== 'download' && /\.[a-z0-9]{1,8}$/i.test(basename);
  if (hasUsefulBasename) return sanitizeSegment(basename);
  const format = cleanText(resource.format || resource.mimetype || `resource-${index + 1}`);
  const base = sanitizeSegment(`${packageName}-${slugify(format) || `resource-${index + 1}`}`);
  const ext = extForFormat(format);
  return `${base}${ext}`;
}

function uniqueInternalPath(organization, packageName, filename, used) {
  const dir = `${sanitizeSegment(organization)}/${sanitizeSegment(packageName)}`;
  const parsed = path.parse(filename);
  let candidate = `${dir}/${filename}`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${dir}/${parsed.name}-${suffix}${parsed.ext}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return posixPath(candidate);
}

function extForFormat(value) {
  const format = cleanText(value).toUpperCase();
  if (format.includes('CSV')) return '.csv';
  if (format.includes('JSON')) return '.json';
  if (format === 'PX' || format.includes('PXSTAT')) return '.px';
  if (format.includes('XLSX')) return '.xlsx';
  if (format.includes('XLS')) return '.xls';
  if (format.includes('ODS')) return '.ods';
  if (format.includes('PDF')) return '.pdf';
  if (format.includes('DOCX')) return '.docx';
  if (format.includes('DOC')) return '.doc';
  if (format.includes('ZIP')) return '.zip';
  if (format.includes('TXT') || format.includes('TEXT')) return '.txt';
  if (format.includes('PNG')) return '.png';
  if (format.includes('JPEG') || format.includes('JPG')) return '.jpg';
  return '.dat';
}

function buildPublicMirrorCandidate(sourceDocs, records, warnings) {
  const grouped = groupRecords(records);
  const sources = (sourceDocs.sources || []).map((source) => {
    const files = grouped.get(source.id) || [];
    const provider = sourceProvider(source);
    const target = TARGET_ITEMS[provider];
    return {
      sourceId: source.id,
      title: source.title,
      provider,
      sourceUrl: source.url,
      sourceSlug: sourceSlug(source),
      itemIdentifier: target?.identifier || null,
      itemUrl: target ? itemUrl(target.identifier) : null,
      mirrorStatus: files.length ? 'staged-for-upload' : 'pending-source-file',
      files: files.map((file) => ({
        path: file.internalPath,
        fileName: path.posix.basename(file.internalPath),
        format: file.format || null,
        resourceUrl: file.resourceUrl || null,
        downloadUrl: downloadUrl(file.itemIdentifier, file.internalPath),
        size: file.size || null,
        sha256: file.sha256 || null,
        origin: file.origin,
        storageMode: file.iaStorage?.mode || 'native',
        originalPath: file.iaStorage?.originalPath || null,
        storageNote: file.iaStorage?.note || null
      }))
    };
  });
  const mirrored = sources.filter((source) => source.files.length);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: {
      itemStrategy: 'group raw source files by provider/corpus, not one IA item per source row',
      publicData: 'only provider URLs, IA item/download URLs, file names, formats, sizes, and checksums are public',
      localPaths: 'local filesystem paths remain only in ignored operational manifests under tmp/raw-source-ia',
      r2Cdn: 'not used for raw source files; IA is the public raw-source mirror'
    },
    summary: {
      totalSources: sources.length,
      sourcesWithMirrorFiles: mirrored.length,
      sourcesPendingMirrorFiles: sources.length - mirrored.length,
      files: records.filter(isUsableRecord).length,
      bytes: records.reduce((sum, record) => sum + Number(record.size || 0), 0),
      warnings: warnings.length
    },
    items: itemSummaries(records).map((item) => ({
      identifier: item.identifier,
      url: itemUrl(item.identifier),
      provider: item.provider,
      sourceCount: item.sourceCount,
      fileCount: item.fileCount,
      bytes: item.bytes
    })),
    sources,
    warnings
  };
}

function buildLocalSummary(records, warnings) {
  const stageable = records.filter(isUsableRecord);
  return {
    records: records.length,
    stageableFiles: stageable.length,
    sourcesWithRecords: new Set(records.map((record) => record.sourceId)).size,
    filesByItem: Object.fromEntries(itemSummaries(records).map((item) => [item.identifier, item.fileCount])),
    bytes: stageable.reduce((sum, record) => sum + statSync(record.localPath).size, 0),
    warnings: warnings.length
  };
}

function itemSummaries(records) {
  const map = new Map();
  for (const record of records) {
    if (!map.has(record.itemIdentifier)) {
      map.set(record.itemIdentifier, {
        identifier: record.itemIdentifier,
        provider: record.provider,
        title: record.itemTitle,
        sourceIds: new Set(),
        fileCount: 0,
        bytes: 0
      });
    }
    const item = map.get(record.itemIdentifier);
    item.sourceIds.add(record.sourceId);
    if (isUsableRecord(record)) {
      item.fileCount += 1;
      item.bytes += statSync(record.localPath).size;
    }
  }
  return [...map.values()].map((item) => ({
    identifier: item.identifier,
    provider: item.provider,
    title: item.title,
    sourceCount: item.sourceIds.size,
    fileCount: item.fileCount,
    bytes: item.bytes
  })).sort((a, b) => a.identifier.localeCompare(b.identifier));
}

function groupRecords(records) {
  const map = new Map();
  for (const record of records) {
    if (!isUsableRecord(record)) continue;
    if (!map.has(record.sourceId)) map.set(record.sourceId, []);
    map.get(record.sourceId).push(record);
  }
  for (const files of map.values()) {
    files.sort((a, b) => a.internalPath.localeCompare(b.internalPath));
  }
  return map;
}

function isUsableRecord(record) {
  if (!record?.localPath || !existsSync(record.localPath)) return false;
  if (record.status === 'download-failed') return false;
  if (isInvalidPdf(record.localPath, record.internalPath)) return false;
  return true;
}

function dedupeSourceRecords(records) {
  const byPath = new Map();
  for (const record of records) {
    const key = `${record.itemIdentifier}|${record.internalPath}`.toLowerCase();
    const existing = byPath.get(key);
    if (!existing || rankRecord(record) < rankRecord(existing)) {
      byPath.set(key, record);
    }
  }
  return [...byPath.values()];
}

function rankRecord(record) {
  if (record.status === 'local-ready') return 0;
  if (record.status === 'downloaded') return 1;
  if (record.status === 'download-pending') return 2;
  return 9;
}

function sourceProvider(source) {
  return Array.isArray(source.provider) ? source.provider.at(-1) : source.provider;
}

function sourceSlug(source) {
  try {
    return decodeURIComponent(new URL(source.url).pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    const parts = String(source.id || '').split(':');
    return parts.at(-1) || '';
  }
}

function itemUrl(identifier) {
  return `https://archive.org/details/${identifier}`;
}

function downloadUrl(identifier, internalPath) {
  return `https://archive.org/download/${identifier}/${encodeIaPath(internalPath)}`;
}

function encodeIaPath(value) {
  return posixPath(value).split('/').map((part) => encodeURIComponent(part)).join('/');
}

function posixPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const input = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function sanitizeSegment(value, fallback = 'resource') {
  const cleaned = cleanText(value)
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 150);
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUrl(value) {
  const raw = cleanText(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    return new URL(raw).toString();
  } catch {
    return '';
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function psSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    }
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((item) => item !== '')) rows.push(row);
  const [headers, ...records] = rows;
  return records.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}

async function runPool(items, size, worker) {
  let index = 0;
  const errors = [];
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      try {
        await worker(item);
      } catch (error) {
        item.status = 'download-failed';
        item.error = error.message;
        errors.push(error);
      }
    }
  });
  await Promise.all(workers);
  if (errors.length) {
    console.warn(`Download warnings: ${errors.length} resources failed; see local manifest for details.`);
  }
}

function runProcess(command, runArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, runArgs, {
      cwd: ROOT,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}${stderr ? `: ${stderr}` : ''}`));
    });
  });
}

function assertPublicSafe(record) {
  const text = JSON.stringify({
    sourceId: record.sourceId,
    title: record.title,
    provider: record.provider,
    sourceSlug: record.sourceSlug,
    internalPath: record.internalPath,
    resourceUrl: record.resourceUrl
  });
  if (/pointer|uprn|properties\.geojson|\beoni\b/i.test(text)) {
    throw new Error(`Refusing to stage sensitive-looking raw-source record: ${record.sourceId}`);
  }
}

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) {
    throw new Error('Public IA mirror candidate leaks a local filesystem path');
  }
}
