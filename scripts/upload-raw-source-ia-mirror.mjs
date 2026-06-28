#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, 'tmp', 'raw-source-ia');
const PUBLIC_MIRRORS = path.join(ROOT, 'data', 'database', 'raw-source-ia-mirrors.json');
const IA_CLI = process.env.IA_CLI || 'ia.exe';

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args['out-dir'] || DEFAULT_OUT_DIR);
const skipUpload = Boolean(args['skip-upload']);
const writePublic = Boolean(args['write-public']);
const verifyRetries = Math.max(1, Number(args['verify-retries'] || 8));
const verifySleepMs = Math.max(1000, Number(args['verify-sleep-ms'] || 15000));
const batchSize = Math.max(1, Math.min(100, Number(args['batch-size'] || 40)));
const onlyItem = args['only-item'] || '';

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  const local = readJson(path.join(outDir, 'upload-manifest.local.json'));
  const candidate = readJson(path.join(outDir, 'raw-source-ia-mirrors.candidate.json'));
  const grouped = groupByItem(local.records || []);
  const verification = [];

  for (const [identifier, records] of grouped.entries()) {
    if (onlyItem && identifier !== onlyItem) continue;
    const itemRoot = path.join(outDir, 'staging', identifier);
    if (!existsSync(itemRoot)) throw new Error(`Missing IA staging root for ${identifier}: ${path.relative(ROOT, itemRoot)}`);
    if (!records.length) throw new Error(`No staged files for ${identifier}`);

    if (!skipUpload) {
      const existingFiles = await archiveFileSet(identifier);
      const uploadRecords = records.filter((record) => !existingFiles.has(posixPath(record.internalPath)));
      console.log(`${identifier}: ${records.length - uploadRecords.length}/${records.length} expected files already present in IA metadata; uploading ${uploadRecords.length} missing files.`);
      const itemTitle = records.find((record) => record.itemTitle)?.itemTitle || `Civgraph raw source mirrors - ${identifier}`;
      console.log(`Uploading ${uploadRecords.length} files to ${identifier} in batches of ${batchSize}...`);
      for (let offset = 0; offset < uploadRecords.length; offset += batchSize) {
        const batch = uploadRecords.slice(offset, offset + batchSize);
        console.log(`Uploading ${identifier} batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(uploadRecords.length / batchSize)} (${batch.length} files)...`);
        await run(IA_CLI, [
          'upload',
          identifier,
          ...batch.map((record) => record.stagingRelativePath),
          '--keep-directories',
          '--checksum',
          '--verify',
          '--no-derive',
          '--no-collection-check',
          '-R',
          '5',
          '-s',
          '10',
          '-m',
          `title:${itemTitle}`,
          '-m',
          'mediatype:data',
          '-m',
          'creator:Civgraph',
          '-m',
          'subject:Civgraph;raw source mirror;open data;public records',
          '-m',
          'description:Provider raw source files mirrored for Civgraph provenance and durable public download links. Civgraph public records retain the provider dataset page as the canonical source and use this Internet Archive item as a raw-source mirror.'
        ], { cwd: itemRoot });
      }
    }

    const expected = new Set(records.map((record) => posixPath(record.internalPath)));
    const meta = await verifyItem(identifier, expected);
    verification.push(meta);
  }

  writeJson(path.join(outDir, 'verification.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    items: verification
  });

  const failed = verification.filter((item) => item.missingFiles.length);
  if (failed.length) {
    throw new Error(`IA verification failed for ${failed.length} item(s); see ${path.relative(ROOT, path.join(outDir, 'verification.json'))}`);
  }

  if (writePublic) {
    const publicMirrors = markCandidateVerified(candidate, verification);
    assertNoLocalPaths(publicMirrors);
    writeJson(PUBLIC_MIRRORS, publicMirrors);
    console.log(`Wrote ${path.relative(ROOT, PUBLIC_MIRRORS)}.`);
  }

  console.log(JSON.stringify({
    itemsVerified: verification.length,
    filesVerified: verification.reduce((sum, item) => sum + item.expectedFiles, 0),
    publicSidecarWritten: writePublic
  }, null, 2));
}

async function verifyItem(identifier, expected) {
  let last = null;
  for (let attempt = 1; attempt <= verifyRetries; attempt += 1) {
    const metadata = await iaMetadata(identifier);
    const files = new Set((metadata.files || []).map((file) => posixPath(file.name)));
    const missingFiles = [...expected].filter((name) => !files.has(name)).sort();
    last = {
      identifier,
      itemUrl: `https://archive.org/details/${identifier}`,
      verifiedAt: new Date().toISOString(),
      expectedFiles: expected.size,
      archiveFileCount: files.size,
      missingFiles
    };
    if (!missingFiles.length) return last;
    if (attempt < verifyRetries) await sleep(verifySleepMs);
  }
  return last;
}

async function archiveFileSet(identifier) {
  const metadata = await iaMetadata(identifier);
  return new Set((metadata.files || []).map((file) => posixPath(file.name)));
}

async function iaMetadata(identifier) {
  const result = await run(IA_CLI, ['metadata', identifier], { cwd: ROOT, capture: true });
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    throw new Error(`Could not parse ia metadata for ${identifier}: ${error.message}`);
  }
}

function markCandidateVerified(candidate, verification) {
  const byIdentifier = new Map(verification.map((item) => [item.identifier, item]));
  const verifiedAt = new Date().toISOString();
  const sources = (candidate.sources || []).map((source) => {
    const item = byIdentifier.get(source.itemIdentifier);
    const verifiedFiles = new Set(item?.missingFiles?.length ? [] : (source.files || []).map((file) => file.path));
    const files = (source.files || []).map((file) => ({
      ...file,
      verifiedAt: verifiedFiles.has(file.path) ? item.verifiedAt : null
    }));
    return {
      ...source,
      mirrorStatus: files.length && files.every((file) => file.verifiedAt) ? 'mirrored' : source.mirrorStatus,
      verifiedAt: files.length && files.every((file) => file.verifiedAt) ? item.verifiedAt : null,
      files
    };
  });
  const mirrored = sources.filter((source) => source.mirrorStatus === 'mirrored');
  return {
    ...candidate,
    generatedAt: verifiedAt,
    summary: {
      ...candidate.summary,
      sourcesWithMirrorFiles: mirrored.length,
      sourcesPendingMirrorFiles: sources.length - mirrored.length,
      verifiedFiles: mirrored.reduce((sum, source) => sum + (source.files || []).length, 0)
    },
    items: (candidate.items || []).map((item) => {
      const verified = byIdentifier.get(item.identifier);
      return {
        ...item,
        verifiedAt: verified?.verifiedAt || null,
        archiveFileCount: verified?.archiveFileCount || null
      };
    }),
    sources
  };
}

function groupByItem(records) {
  const map = new Map();
  for (const record of records) {
    if (!record.stagingRelativePath) continue;
    if (!map.has(record.itemIdentifier)) map.set(record.itemIdentifier, []);
    map.get(record.itemIdentifier).push(record);
  }
  for (const rows of map.values()) rows.sort((a, b) => a.internalPath.localeCompare(b.internalPath));
  return map;
}

function run(command, runArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, runArgs, {
      cwd: options.cwd || ROOT,
      shell: false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${runArgs.join(' ')} exited ${code}${stderr ? `\n${stderr}` : ''}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function posixPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
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

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) {
    throw new Error('Public IA mirror sidecar leaks a local filesystem path');
  }
}
