#!/usr/bin/env node
/**
 * Build an intake manifest for /test vector candidates that are not locally
 * convertible yet.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const PLAN_PATH = resolve(ROOT, 'render/metadata/main-site-port-plan.json');
const REPORT_PATH = resolve(ROOT, 'render/metadata/vector-conversion-report.json');
const OUTPUT_PATH = resolve(ROOT, 'render/metadata/vector-intake-report.json');
const VECTOR_EXTENSIONS = new Set(['.fgb', '.geojson', '.json', '.gpkg', '.shp', '.zip']);

/**
 * @typedef {{ kind?: string, file?: string }} VectorSource  a source file of a plan row
 * @typedef {{ label?: string, url: string }} SourceLink  a download or reference of a plan row
 * @typedef {{ sourceMapId: string, parentId?: string, name?: string, category?: string, recommendedTarget?: string,
 *   conversionStatus?: string, sourceFiles?: VectorSource[], sourceDownloads?: SourceLink[], references?: SourceLink[] }} PlanRow
 */
const plan = /** @type {{ rows?: PlanRow[] }} */ (JSON.parse(readFileSync(PLAN_PATH, 'utf8')));
const conversionReport = /** @type {{ converted?: Array<{ sourceMapId: string }>, skipped: unknown[] }} */ (existsSync(REPORT_PATH) ? JSON.parse(readFileSync(REPORT_PATH, 'utf8')) : { skipped: [] });
const convertedIds = new Set((conversionReport.converted || []).map((row) => row.sourceMapId));
const rows = (plan.rows || []).filter((row) => row.conversionStatus === 'needsVectorTileConversion' && !convertedIds.has(row.sourceMapId));

const items = rows.map((row) => {
  const vectorSources = uniqueSources([
    ...(row.sourceFiles || []),
    ...(row.sourceDownloads || []).map((source) => ({ kind: source.label || 'download', file: source.url })),
    ...(row.references || []).map((source) => ({ kind: source.label || 'reference', file: source.url }))
  ].filter((source) => isVectorSource(source.file || '')));
  const remoteSources = vectorSources.filter((source) => /^https?:\/\//i.test(source.file || ''));
  const localSources = vectorSources.filter((source) => !/^https?:\/\//i.test(source.file || ''));
  const missingLocal = localSources.filter((source) => !existsSync(resolve(ROOT, /** @type {string} */ (source.file).replace(/^\//, ''))));
  const action = chooseAction({ vectorSources, remoteSources, localSources, missingLocal });
  return {
    sourceMapId: row.sourceMapId,
    parentId: row.parentId || null,
    name: row.name,
    category: row.category,
    recommendedTarget: row.recommendedTarget,
    action,
    sourceFiles: vectorSources,
    postIntakeCommands: [
      `npm run build:test:batch-vectors -- --execute --ids ${row.sourceMapId}`,
      'npm run build:test:promote',
      'npm run build:test:feature-indexes',
      'npm run build:test:metadata',
      'npm run check:test'
    ],
    cdnRequirement: 'Upload generated /render/tiles output or PMTiles archive to the data host before production use if the repo is not the canonical tile host.'
  };
});

const totals = items.reduce((acc, item) => {
  acc.total += 1;
  acc[item.action] = (acc[item.action] || 0) + 1;
  return acc;
}, /** @type {{ total: number } & Record<string, number>} */ ({ total: 0 }));

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: PLAN_PATH.replace(`${ROOT}\\`, ''),
  conversionReport: REPORT_PATH.replace(`${ROOT}\\`, ''),
  totals,
  notes: [
    'This is the intake queue for vector candidates that cannot currently be converted from local files.',
    'Rows with download-remote-source need a download/cache step before conversion.',
    'Rows with locate-local-source refer to local paths that are not present in the repo checkout, commonly because large source files are ignored and hosted outside git.',
    'Rows with add-source-metadata do not currently expose a direct vector source in main metadata.'
  ],
  items
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH.replace(`${ROOT}\\`, '')}`);
console.log(`Intake rows: ${totals.total}`);

/**
 * What a row needs before it can be converted.
 * @param {{ vectorSources: VectorSource[], remoteSources: VectorSource[], localSources: VectorSource[], missingLocal: VectorSource[] }} sources
 */
function chooseAction({ vectorSources, remoteSources, localSources, missingLocal }) {
  if (remoteSources.length) return 'download-remote-source';
  if (missingLocal.length || localSources.length) return 'locate-local-source';
  if (!vectorSources.length) return 'add-source-metadata';
  return 'review-source';
}

/** @param {string} file */
function isVectorSource(file) {
  if (!file) return false;
  const clean = /** @type {string} */ (file.split('?')[0]).toLowerCase();
  return VECTOR_EXTENSIONS.has(extname(clean));
}

/** The sources with a file, each file once. @param {VectorSource[]} sources @returns {VectorSource[]} */
function uniqueSources(sources) {
  /** @type {Map<string, VectorSource>} */
  const byFile = new Map();
  for (const source of sources) {
    const file = source.file || '';
    if (!file || byFile.has(file)) continue;
    byFile.set(file, source);
  }
  return [...byFile.values()];
}
