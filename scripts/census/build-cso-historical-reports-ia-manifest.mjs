#!/usr/bin/env node
/**
 * Build a committed manifest of the original-content files in the Internet
 * Archive item `civgraph-cso-historical-reports`
 * (https://archive.org/details/civgraph-cso-historical-reports, CC BY 4.0).
 *
 * The IA item holds 2,172 original CSO historical census/statistical files
 * (report PDFs 1841-1991 + SAPS 2016/2022 data) alongside IA-generated
 * derivatives. This manifest keeps original-content files only:
 *   - keep .pdf/.csv/.xlsx/.zip/.txt
 *   - EXCLUDE `*_jp2.zip` OCR derivatives
 *   - EXCLUDE the stray `D:/cso-ia-staging/probe.txt` accidental upload
 *
 * Source of truth is the live IA metadata endpoint. Fetch it once (curl works;
 * WebFetch may 403) and pass the JSON path, or let this script curl it.
 *
 * Usage:
 *   node scripts/census/build-cso-historical-reports-ia-manifest.mjs [metadata.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const ITEM = 'civgraph-cso-historical-reports';
const OUT = 'data/census/source-inventory/cso-historical-reports-ia-manifest.json';
const KEEP_EXT = new Set(['.pdf', '.csv', '.xlsx', '.zip', '.txt']);

const metaPath = process.argv[2];
let meta;
if (metaPath && existsSync(metaPath)) {
  meta = JSON.parse(readFileSync(metaPath, 'utf8'));
} else {
  const raw = execSync(`curl -sL https://archive.org/metadata/${ITEM}`, {
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  meta = JSON.parse(raw);
}

const ext = (name) => (name.match(/\.[^.\/]+$/) || [''])[0].toLowerCase();
const isDerivative = (name) => /_jp2\.zip$/i.test(name);
const isProbe = (name) => /(^|\/)probe\.txt$/i.test(name) || /^[A-Za-z]:\//.test(name);

const files = (meta.files || [])
  .filter((f) => f.source === 'original')
  .filter((f) => KEEP_EXT.has(ext(f.name)))
  .filter((f) => !isDerivative(f.name))
  .filter((f) => !isProbe(f.name))
  .map((f) => ({
    name: f.name,
    ext: ext(f.name),
    size: Number(f.size) || 0,
    md5: f.md5,
    format: f.format,
    wayback: /^wayback\//i.test(f.name),
    downloadUrl: `https://archive.org/download/${ITEM}/${encodeURI(f.name)}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const byExt = {};
for (const f of files) byExt[f.ext] = (byExt[f.ext] || 0) + 1;

const manifest = {
  schemaVersion: 1,
  item: ITEM,
  itemUrl: `https://archive.org/details/${ITEM}`,
  metadataUrl: `https://archive.org/metadata/${ITEM}`,
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution:
    'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.',
  note:
    'Original-content files only. Excludes *_jp2.zip OCR derivatives and the stray D:/cso-ia-staging/probe.txt accidental upload.',
  counts: { total: files.length, byExtension: byExt, wayback: files.filter((f) => f.wayback).length },
  files,
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${OUT}: ${files.length} files`, JSON.stringify(byExt));
