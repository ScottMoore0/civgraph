#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(filePath) {
  assert(existsSync(filePath), `Missing required file: ${filePath}`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const external = readJson('data/database/external-sources.json') || {};
const browseSources = readJson('data/browse/sources.json') || { items: [] };
const sourceItems = Array.isArray(external.sources) ? external.sources : [];
const browseItems = Array.isArray(browseSources.items) ? browseSources.items : [];
const sourceById = new Map(browseItems.map((item) => [item.id, item]));

const wikipedia = sourceItems.filter((item) => item.type === 'wikipedia-article');
const archiveMaps = sourceItems.filter((item) => item.type === 'internet-archive-raster-map');

assert(external.schemaVersion === 1, 'External source index must have schemaVersion 1.');
assert(wikipedia.length >= 20, 'External source index must include the Republic of Ireland council-election Wikipedia category articles.');
assert(archiveMaps.length > 0, 'External source index must include deduplicated Internet Archive raster map records.');

for (const item of sourceItems) {
  assert(item.id && item.title && item.type, `External source is missing id/title/type: ${JSON.stringify(item).slice(0, 160)}`);
  assert(sourceById.has(item.id), `Browse sources index is missing external source ${item.id}.`);
  const detailPath = path.join('data', 'browse', 'details', 'sources', `${item.slug || slugify(item.id)}.json`);
  assert(existsSync(detailPath), `Browse source detail file is missing for ${item.id}: ${detailPath}`);
  assert(!item.fullText && !item.articleText && !item.rawHtml, `External source ${item.id} must not copy full third-party article text into the repository.`);
}

for (const item of wikipedia) {
  const refs = Array.isArray(item.references) ? item.references : [];
  assert(refs.some((ref) => /https:\/\/en\.wikipedia\.org\//.test(String(ref.url || ''))), `Wikipedia source ${item.id} must cite its Wikipedia article URL.`);
  assert(!Array.isArray(item.downloads) || item.downloads.length === 0, `Wikipedia source ${item.id} should not expose copied article downloads.`);
}

for (const item of archiveMaps) {
  const refs = Array.isArray(item.references) ? item.references : [];
  const downloads = Array.isArray(item.downloads) ? item.downloads : [];
  assert(refs.some((ref) => /https:\/\/archive\.org\/details\//.test(String(ref.url || ''))), `Internet Archive source ${item.id} must cite its item page.`);
  assert(downloads.some((link) => /https:\/\/archive\.org\/download\//.test(String(link.url || ''))), `Internet Archive source ${item.id} must expose a hotlinked archive.org download URL.`);
  assert(!downloads.some((link) => /^\/|^\.{1,2}\//.test(String(link.url || ''))), `Internet Archive source ${item.id} must not point at a local raster copy.`);
  assert(item.thumbnail?.kind === 'external' && /https:\/\/archive\.org\/services\/img\//.test(String(item.thumbnail?.url || '')), `Internet Archive source ${item.id} must use an external archive.org thumbnail.`);
}

const browseExternalCount = browseItems.filter((item) => String(item.id || '').startsWith('external:')).length;
assert(browseExternalCount === sourceItems.length, `Browse sources should contain ${sourceItems.length} external records, found ${browseExternalCount}.`);

if (failures.length) {
  console.error('External Source Validation');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${wikipedia.length} Wikipedia council-election articles and ${archiveMaps.length} Internet Archive raster map records are indexed as external Browse sources.`);

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}
