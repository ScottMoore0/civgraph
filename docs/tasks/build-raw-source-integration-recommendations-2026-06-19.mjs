import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'tasks');
const DATE = '2026-06-19';

const shapefileAuditPath = path.join(ROOT, 'tasks', 'shapefile-site-coverage-audit-2026-06-19.csv');
const providerAuditPath = path.join(ROOT, 'data', 'provider-mirror-audit', 'provider-mirror-audit.json');
const tailteSummaryPath = path.join(ROOT, 'data', 'provider-mirror-audit', 'tailte-completeness-20260617T100826Z-summary.json');
const tailteResourcesPath = path.join(ROOT, 'data', 'provider-mirror-audit', 'tailte-completeness-20260617T100826Z-resources.csv');
const datagovieInventoryPath = path.join(ROOT, 'data', 'provider-mirror-audit', 'datagovie-file-inventory.json');
const tailteInventoryPath = path.join(ROOT, 'data', 'provider-mirror-audit', 'tailte-file-inventory.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((line) => line.some((value) => value !== ''))
    .map((line) => Object.fromEntries(header.map((key, index) => [key, line[index] ?? ''])));
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  }
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function slugText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactKey(value) {
  return slugText(value).replace(/\s+/g, '-');
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function classifyTheme(row) {
  const text = slugText(`${row.provider} ${row.dataset} ${row.file} ${row.raw} ${row.url}`);
  const rules = [
    ['administrative-boundaries', ['boundary', 'boundaries', 'local authority', 'council boundary', 'administrative', 'district council', 'cadastral', 'parcel']],
    ['electoral-geography', ['electoral', 'constituenc', 'ward', 'dea', 'polling', 'election', 'franchise']],
    ['census-statistical-geography', ['census', 'output area', 'small area', 'super output', 'statistics', 'nisra']],
    ['planning-development', ['planning', 'development', 'zoning', 'part8', 'part 8', 'local area plan', 'development plan']],
    ['environment-water-geology', ['environment', 'habitat', 'geology', 'bedrock', 'water', 'river', 'catchment', 'flood', 'marine', 'coastal', 'wind', 'noise', 'air quality']],
    ['transport-infrastructure', ['road', 'transport', 'traffic', 'collision', 'tii', 'rail', 'cycle', 'bridge']],
    ['heritage-public-assets', ['heritage', 'park', 'monument', 'protected', 'conservation', 'tourism', 'allotment', 'burial', 'school', 'health', 'hospital']],
    ['lidar-raster-large-format', ['lidar', 'raster', 'orthophoto', 'imagery', 'point cloud', 'laser']],
  ];
  for (const [theme, words] of rules) {
    if (includesAny(text, words)) return theme;
  }
  return 'general-open-data';
}

function roiScore(row, theme) {
  if (row.coverage.startsWith('confirmed')) return 20;
  if (row.coverage.startsWith('probable')) return 75;
  if (['administrative-boundaries', 'electoral-geography', 'census-statistical-geography'].includes(theme)) return 95;
  if (['planning-development', 'transport-infrastructure'].includes(theme)) return 78;
  if (['environment-water-geology', 'heritage-public-assets'].includes(theme)) return 68;
  if (theme === 'lidar-raster-large-format') return 35;
  return 55;
}

function actionFor(row, theme, duplicateCount) {
  const bytes = Number(row.bytes || 0);
  if (row.coverage === 'confirmed-interactive-or-geospatial') {
    return {
      action: 'already-interactive-on-site',
      placement: 'no new map; add source/variant metadata only if provider/version differs',
      needsUserDecision: 'no',
    };
  }
  if (row.coverage === 'confirmed-source-or-download-record') {
    return {
      action: 'already-source-on-site-review-interactive-value',
      placement: 'keep source record; consider conversion only if geometry adds high-value interactive use',
      needsUserDecision: 'maybe',
    };
  }
  if (row.coverage.startsWith('probable')) {
    return {
      action: 'review-probable-duplicate-or-variant',
      placement: 'compare geometry/provider/date against likely parent; merge as variant if materially different',
      needsUserDecision: 'maybe',
    };
  }
  if (bytes > 500_000_000 || theme === 'lidar-raster-large-format') {
    return {
      action: 'hold-size-format-review',
      placement: 'download/source-only unless converted through a specific large-format pipeline',
      needsUserDecision: 'yes',
    };
  }
  if (duplicateCount > 1) {
    return {
      action: 'candidate-variant-group-review',
      placement: 'group duplicates/near-duplicates first; publish one canonical entry with provider variants',
      needsUserDecision: 'maybe',
    };
  }
  if (['administrative-boundaries', 'electoral-geography', 'census-statistical-geography'].includes(theme)) {
    return {
      action: 'new-interactive-map-candidate-high-priority',
      placement: 'Browse maps plus MapLibre conversion after geometry validation',
      needsUserDecision: 'no',
    };
  }
  if (['planning-development', 'environment-water-geology', 'transport-infrastructure', 'heritage-public-assets'].includes(theme)) {
    return {
      action: 'new-interactive-or-source-candidate',
      placement: 'Browse map if geometry is useful at national/local scale; otherwise IA-backed source/download record',
      needsUserDecision: 'maybe',
    };
  }
  return {
    action: 'source-download-first',
    placement: 'IA-backed source/download record; convert only after demand or clear map value',
    needsUserDecision: 'maybe',
  };
}

function iaGroupFor(row) {
  const sourceGroup = row.sourceGroup || row.source || '';
  if (/open data ni/i.test(sourceGroup)) return 'civgraph-open-data-ni-raw-sources';
  if (/tailte/i.test(sourceGroup) || /Tailte/i.test(row.provider || '')) return 'civgraph-tailte-eireann-raw-sources';
  if (/data\.gov\.ie/i.test(sourceGroup) || /data\.gov\.ie/i.test(row.source || '')) return 'civgraph-data-gov-ie-raw-sources';
  return 'civgraph-provider-raw-sources';
}

function viewportRecommendation(row) {
  const text = slugText(`${row.file} ${row.url} ${row.raw}`);
  if (/(pdf)/.test(text)) return 'direct PDF viewport';
  if (/(csv|txt)/.test(text)) return 'streamed text/table viewport';
  if (/(png|jpg|jpeg|webp|tif|tiff)/.test(text)) return 'image viewport';
  if (/(xls|xlsx|ods)/.test(text)) return 'spreadsheet viewport with lazy sheet/row parsing';
  if (/(shp|shapefile|zip|gdb|geodatabase)/.test(text)) return 'download-only raw source; converted MapLibre layer if approved';
  return 'download/source metadata first; viewport after format sniffing';
}

function cleanedBundleRecommendation(row, action) {
  if (/interactive-map/.test(action)) return 'R2/CDN only for generated PMTiles/metadata after conversion; raw file stays IA-hotlinked';
  if (/source|download|hold/.test(action)) return 'no R2/CDN cleaned bundle until structured query/map/chart use is approved';
  if (/variant/.test(action)) return 'R2/CDN only if variant gets a converted tile/query bundle';
  return 'defer';
}

function summarizeBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function topRows(rows, count, sortKey = 'roiScore') {
  return [...rows].sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0)).slice(0, count);
}

function formatTable(rows, columns) {
  if (!rows.length) return '_None._';
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(row[column.key] ?? '').replaceAll('|', '\\|')).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function providerSummary(providerAudit) {
  const providers = providerAudit.providers || {};
  return Object.values(providers).map((provider) => {
    const byExtension = provider.scan?.byExtension || {};
    const viewportDirect = ['.pdf', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.webp'].reduce((sum, ext) => sum + (byExtension[ext] || 0), 0);
    const spreadsheet = ['.xls', '.xlsx', '.ods'].reduce((sum, ext) => sum + (byExtension[ext] || 0), 0);
    const geospatial = ['.geojson', '.gpkg', '.kml', '.kmz', '.zip', '[none]', '.0'].reduce((sum, ext) => sum + (byExtension[ext] || 0), 0);
    return {
      providerId: provider.id,
      label: provider.label,
      fileCount: provider.scan?.fileCount || 0,
      totalBytes: provider.scan?.totalBytes || 0,
      viewportDirect,
      spreadsheet,
      geospatialOrPackage: geospatial,
      largestFiles: (provider.scan?.largestFiles || []).slice(0, 3).map((file) => `${file.relativePath} (${Math.round((file.bytes || 0) / 1024 / 1024)} MB)`).join(' | '),
    };
  });
}

function main() {
  const shapefileRows = parseCsv(readFileSync(shapefileAuditPath, 'utf8'));
  const providerAudit = existsSync(providerAuditPath) ? JSON.parse(readFileSync(providerAuditPath, 'utf8')) : { providers: {} };
  const tailteSummary = existsSync(tailteSummaryPath) ? JSON.parse(readFileSync(tailteSummaryPath, 'utf8')) : {};
  const tailteRows = existsSync(tailteResourcesPath) ? parseCsv(readFileSync(tailteResourcesPath, 'utf8')) : [];
  const datagovieInventoryRaw = existsSync(datagovieInventoryPath) ? readFileSync(datagovieInventoryPath, 'utf8') : '';
  const tailteInventoryRaw = existsSync(tailteInventoryPath) ? readFileSync(tailteInventoryPath, 'utf8') : '';

  const duplicateCounts = summarizeBy(shapefileRows, (row) => compactKey(`${row.sourceGroup}|${row.provider}|${row.dataset}`));
  const recommendations = shapefileRows.map((row) => {
    const theme = classifyTheme(row);
    const duplicateKey = compactKey(`${row.sourceGroup}|${row.provider}|${row.dataset}`);
    const duplicateCount = duplicateCounts[duplicateKey] || 1;
    const decision = actionFor(row, theme, duplicateCount);
    const score = roiScore(row, theme);
    return {
      rowNumber: row.rowNumber,
      sourceGroup: row.sourceGroup,
      provider: row.provider,
      dataset: row.dataset,
      file: row.file,
      bytes: row.bytes,
      coverage: row.coverage,
      confidence: row.confidence,
      theme,
      roiScore: score,
      duplicateGroupSize: duplicateCount,
      recommendedAction: decision.action,
      recommendedPlacement: decision.placement,
      needsUserDecision: decision.needsUserDecision,
      iaItem: iaGroupFor(row),
      rawViewport: viewportRecommendation(row),
      cleanedBundle: cleanedBundleRecommendation(row, decision.action),
      evidence: row.evidence || row.secondaryEvidence || '',
      url: row.url,
      raw: row.raw,
    };
  });

  const byAction = summarizeBy(recommendations, (row) => row.recommendedAction);
  const byTheme = summarizeBy(recommendations, (row) => row.theme);
  const byCoverage = summarizeBy(recommendations, (row) => row.coverage);
  const byIaItem = summarizeBy(recommendations, (row) => row.iaItem);
  const needsDecision = recommendations.filter((row) => row.needsUserDecision === 'yes').length;
  const maybeDecision = recommendations.filter((row) => row.needsUserDecision === 'maybe').length;

  const tailteAlternateRows = tailteRows.filter((row) => /^(skippedAlternate|skipped-alternate)/.test(row.status || ''));
  const tailteAlternativePackages = new Set(tailteAlternateRows.map((row) => row.packageId || row.packageName).filter(Boolean));
  const tailteAlternativeExpectedBytes = tailteAlternateRows.reduce((sum, row) => sum + Number(row.expectedBytes || 0), 0);
  const tailteInventoryMirrorsDatagovie = Boolean(datagovieInventoryRaw && tailteInventoryRaw && datagovieInventoryRaw === tailteInventoryRaw);

  const providerRows = providerSummary(providerAudit);

  const iaRows = Object.entries(byIaItem).map(([iaItem, count]) => {
    const matching = recommendations.filter((row) => row.iaItem === iaItem);
    return {
      iaItem,
      candidateRows: count,
      sourceGroups: [...new Set(matching.map((row) => row.sourceGroup))].join(' | '),
      proposedInternalStructure: 'provider / organization / dataset / resource-or-format',
      uploadStatus: 'do-not-upload-yet',
      siteUse: 'future IA hotlinked raw view/download records only after approval',
    };
  });

  const viewportRows = [
    { formatClass: 'PDF', support: 'high', recommendation: 'native browser/PDF.js iframe viewport; IA hotlinked URL; text extraction optional later' },
    { formatClass: 'CSV/TSV/TXT', support: 'high', recommendation: 'streamed table/text viewport with row cap, search, and download link' },
    { formatClass: 'Images', support: 'high', recommendation: 'image viewport with pan/zoom and IA hotlinked original/download link' },
    { formatClass: 'XLS/XLSX/ODS', support: 'medium-high', recommendation: 'build-side or client-side parser into read-only sheet viewport; lazy-load sheets/rows for large workbooks' },
    { formatClass: 'Shapefile/FileGDB/GeoPackage/KML/GeoJSON', support: 'medium', recommendation: 'raw download/source page first; converted MapLibre layer only after dedupe/size/geometry checks' },
    { formatClass: 'ZIP/databases/SAV/large LIDAR', support: 'low for viewport', recommendation: 'download-only initially; derive previews only for approved high-value records' },
  ];

  const summary = {
    generatedAt: new Date().toISOString(),
    shapefileRows: recommendations.length,
    confirmedOnSite: recommendations.filter((row) => row.coverage.startsWith('confirmed')).length,
    probableMatches: recommendations.filter((row) => row.coverage.startsWith('probable')).length,
    notFound: recommendations.filter((row) => row.coverage === 'not-found-in-site-manifests').length,
    byAction,
    byTheme,
    byCoverage,
    byIaItem,
    needsUserDecision: needsDecision,
    maybeNeedsUserDecision: maybeDecision,
    tailte: {
      latestSummary: tailteSummary,
      resourcesRows: tailteRows.length,
      alternateExportRows: tailteAlternateRows.length,
      alternateExportDatasetCount: tailteAlternativePackages.size,
      alternateExportExpectedBytes: tailteAlternativeExpectedBytes,
      tailteFileInventoryMirrorsDatagovie: tailteInventoryMirrorsDatagovie,
      recommendation: tailteInventoryMirrorsDatagovie
        ? 'Build a direct Tailte-specific inventory from Tailte package/resource catalogue before treating tailte-file-inventory.json as independent local coverage.'
        : 'Tailte inventory appears distinct; proceed with package/resource comparison against site manifests.',
    },
    providerRows,
  };

  const recommendationCsv = path.join(OUT_DIR, `shapefile-candidate-publication-recommendations-${DATE}.csv`);
  writeCsv(recommendationCsv, recommendations, [
    'rowNumber',
    'sourceGroup',
    'provider',
    'dataset',
    'file',
    'bytes',
    'coverage',
    'confidence',
    'theme',
    'roiScore',
    'duplicateGroupSize',
    'recommendedAction',
    'recommendedPlacement',
    'needsUserDecision',
    'iaItem',
    'rawViewport',
    'cleanedBundle',
    'evidence',
    'url',
    'raw',
  ]);

  writeCsv(path.join(OUT_DIR, `raw-source-ia-item-recommendations-${DATE}.csv`), iaRows, [
    'iaItem',
    'candidateRows',
    'sourceGroups',
    'proposedInternalStructure',
    'uploadStatus',
    'siteUse',
  ]);

  writeCsv(path.join(OUT_DIR, `raw-source-viewport-recommendations-${DATE}.csv`), viewportRows, [
    'formatClass',
    'support',
    'recommendation',
  ]);

  writeCsv(path.join(OUT_DIR, `provider-corpus-viewport-summary-${DATE}.csv`), providerRows, [
    'providerId',
    'label',
    'fileCount',
    'totalBytes',
    'viewportDirect',
    'spreadsheet',
    'geospatialOrPackage',
    'largestFiles',
  ]);

  writeFileSync(
    path.join(OUT_DIR, `raw-source-integration-recommendations-summary-${DATE}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  const topHighRoi = topRows(recommendations.filter((row) => row.recommendedAction.includes('new-interactive')), 25);
  const topHolds = topRows(recommendations.filter((row) => row.recommendedAction === 'hold-size-format-review'), 20);
  const probable = topRows(recommendations.filter((row) => row.coverage.startsWith('probable')), 25);

  const md = `# Raw Source, Shapefile, IA, and Site-Integration Recommendations

Generated: ${summary.generatedAt}

This is a research-only recommendation pass. It did not upload to Internet Archive, R2, or CDN, and it did not add any public site records.

## Executive Summary

- Shapefile candidate rows reviewed: ${summary.shapefileRows}
- Confirmed already represented on the site: ${summary.confirmedOnSite}
- Probable matches needing duplicate/variant review: ${summary.probableMatches}
- Not found in current site manifests: ${summary.notFound}
- Rows needing an explicit user decision before publication/conversion: ${summary.needsUserDecision}
- Rows that can be recommended but should be batch-reviewed: ${summary.maybeNeedsUserDecision}

## 1. Shapefile Candidate Decisions

Recommended action breakdown:

${formatTable(Object.entries(byAction).map(([recommendedAction, count]) => ({ recommendedAction, count })), [
  { key: 'recommendedAction', label: 'Recommended action' },
  { key: 'count', label: 'Rows' },
])}

Theme breakdown:

${formatTable(Object.entries(byTheme).map(([theme, count]) => ({ theme, count })), [
  { key: 'theme', label: 'Theme' },
  { key: 'count', label: 'Rows' },
])}

High-ROI interactive candidates to review first:

${formatTable(topHighRoi, [
  { key: 'roiScore', label: 'ROI' },
  { key: 'sourceGroup', label: 'Source group' },
  { key: 'provider', label: 'Provider' },
  { key: 'dataset', label: 'Dataset' },
  { key: 'theme', label: 'Theme' },
  { key: 'recommendedAction', label: 'Action' },
])}

Probable duplicates/variants to resolve first:

${formatTable(probable, [
  { key: 'sourceGroup', label: 'Source group' },
  { key: 'provider', label: 'Provider' },
  { key: 'dataset', label: 'Dataset' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'evidence', label: 'Evidence' },
])}

Large/format-risk holds:

${formatTable(topHolds, [
  { key: 'bytes', label: 'Bytes' },
  { key: 'sourceGroup', label: 'Source group' },
  { key: 'provider', label: 'Provider' },
  { key: 'dataset', label: 'Dataset' },
  { key: 'recommendedPlacement', label: 'Recommendation' },
])}

Full row-level recommendations are in \`tasks/shapefile-candidate-publication-recommendations-${DATE}.csv\`.

## 2. Tailte Eireann Separation

- Latest Tailte completeness resource rows: ${summary.tailte.resourcesRows}
- Tailte resources marked present: ${tailteSummary.present ?? 'unknown'}
- Tailte downloadable resources missing in latest completeness summary: ${tailteSummary.missingDownloadable ?? 'unknown'}
- Tailte service/non-downloadable resources: ${tailteSummary.serviceOrNonDownloadable ?? 'unknown'}
- Alternate export rows skipped: ${summary.tailte.alternateExportRows}
- Datasets/packages with skipped alternate exports: ${summary.tailte.alternateExportDatasetCount}
- Known byte total for skipped alternate exports: ${summary.tailte.alternateExportExpectedBytes}
- \`tailte-file-inventory.json\` mirrors \`datagovie-file-inventory.json\`: ${summary.tailte.tailteFileInventoryMirrorsDatagovie ? 'yes' : 'no'}

Recommendation: ${summary.tailte.recommendation}

Practical next step before any publication: use the Tailte resource catalogue CSV as the direct Tailte authority, not \`tailte-file-inventory.json\`, then match Tailte package/resource IDs against Civgraph maps and source records.

## 3. Internet Archive Source Hosting Structure

Proposed IA item grouping:

${formatTable(iaRows, [
  { key: 'iaItem', label: 'IA item' },
  { key: 'candidateRows', label: 'Candidate rows' },
  { key: 'proposedInternalStructure', label: 'Internal structure' },
  { key: 'siteUse', label: 'Future site use' },
])}

Recommendation: keep IA item count low, group by provider/corpus, and preserve internal folder/category paths in manifest metadata so users can browse individual files on Civgraph without creating one IA item per source file.

## 4. Raw File Viewports

${formatTable(viewportRows, [
  { key: 'formatClass', label: 'Format class' },
  { key: 'support', label: 'Feasibility' },
  { key: 'recommendation', label: 'Recommendation' },
])}

Provider corpus file/viewport summary:

${formatTable(providerRows, [
  { key: 'providerId', label: 'Provider' },
  { key: 'fileCount', label: 'Files' },
  { key: 'totalBytes', label: 'Bytes' },
  { key: 'viewportDirect', label: 'Direct viewport files' },
  { key: 'spreadsheet', label: 'Spreadsheet files' },
  { key: 'geospatialOrPackage', label: 'Geospatial/package files' },
])}

## 5. R2/CDN Cleaned Bundle Criteria

Recommended rule: use R2/CDN for cleaned/queryable/filterable/chartable/map-ready data only. Raw provider files should be IA-hotlinked for view/download. A row should get R2/CDN treatment only after it has one of:

- converted PMTiles/vector-tile data for MapLibre;
- a cleaned statistical/election/census table intended for filtering/charting;
- a search/query bundle consumed by Civgraph runtime;
- a large derived preview that cannot reasonably live in the repo.

## 6. Duplicate And Variant Handling

Recommended default:

- Confirmed exact matches: do not create duplicate maps; add provenance/source links only if needed.
- Probable matches: compare provider, title, dates, spatial coverage, geometry type, and source URL; merge as variant when materially different but same conceptual layer.
- Multiple rows for one provider/dataset: group before publication, choose one canonical source page, and attach alternate formats/resources below it.
- New high-ROI boundaries/electoral/census geographies: prepare for interactive conversion after dedupe.

## 7. Deferred OCR And Geography Comparability

Still deferred by policy:

- OCR-derived table values should not become structured public facts until QA rules are agreed.
- Approximate geography matches should not be visible as if exact; presentation of warnings still needs policy.
- These do not block raw source records or IA-hotlinked view/download pages, but they do block cleaned Census/statistical publication.

## 8. Site Integration Recommendations

No site integration was performed. Recommended sequence when you approve publication:

1. Approve shapefile candidate batches from the row-level CSV.
2. Create IA manifests for raw files by provider/corpus; upload only after approval.
3. Add source/download Browse records using IA hotlinks, preserving folder/category structure.
4. Convert approved interactive geospatial candidates to MapLibre-friendly PMTiles/metadata.
5. Put converted/queryable bundles in R2/CDN only where runtime interaction needs them.
6. Add validators ensuring raw files are IA-hotlinked, cleaned bundles are versioned, and duplicate/variant rules are followed.

## Generated Artifacts

- \`tasks/shapefile-candidate-publication-recommendations-${DATE}.csv\`
- \`tasks/raw-source-ia-item-recommendations-${DATE}.csv\`
- \`tasks/raw-source-viewport-recommendations-${DATE}.csv\`
- \`tasks/provider-corpus-viewport-summary-${DATE}.csv\`
- \`tasks/raw-source-integration-recommendations-summary-${DATE}.json\`
`;

  writeFileSync(path.join(OUT_DIR, `raw-source-integration-recommendations-${DATE}.md`), md, 'utf8');
}

main();
