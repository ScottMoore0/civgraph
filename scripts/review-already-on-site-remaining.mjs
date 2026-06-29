#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REVIEW_INPUT_DIR = path.join(ROOT, 'data', 'review-inputs');
const ENRICHMENTS_PATH = path.join(ROOT, 'data', 'database', 'already-on-site-enrichments.json');
const RANKINGS_PATH = path.join(REVIEW_INPUT_DIR, 'remaining-decision-packs-2026-06-27', 'already-on-site-review-rankings.json');
const LICENCE_RISK_PATH = path.join(REVIEW_INPUT_DIR, 'remaining-decision-packs-2026-06-27', 'licence-risk-review.json');
const OUT_DIR = path.join(REVIEW_INPUT_DIR, 'already-on-site-remaining-full-review-2026-06-27');

const ROW_OVERRIDES = new Map([
  [945, {
    finalBucket: 'hold-resolved-counties-roi-local-component',
    recommendedDecision: 'Hold or remap only as internal counties source-lineage evidence. Do not approve as a rights-clear exact public source.',
    caveat: 'The local 26-feature Counties_RoI file does not byte-match live Tailte 2019 or 2024 counties GeoJSON downloads, and the automatic target evidence points at weak election-feature/source matches.'
  }]
]);

main();

function main() {
  const enrichments = readJson(ENRICHMENTS_PATH);
  const rankings = readJson(RANKINGS_PATH);
  const licenceRisks = readJson(LICENCE_RISK_PATH);
  const rankingByRow = new Map(rankings.map((row) => [String(row.rowNumber), row]));
  const licenceByRow = new Map(licenceRisks
    .filter((row) => row.scope === 'already-on-site-review')
    .map((row) => [String(row.rowId), row]));

  const reviewRows = normalizeArray(enrichments.reviewRows);
  const reviewedRows = reviewRows.map((row) => reviewRow(row, rankingByRow, licenceByRow));
  const summary = buildSummary(reviewedRows, enrichments.summary);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'reviewed-rows.json'), `${JSON.stringify(reviewedRows, null, 2)}\n`);
  writeFileSync(path.join(OUT_DIR, 'reviewed-rows.csv'), toCsv(reviewedRows));
  writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(OUT_DIR, 'README.md'), buildMarkdown(summary, reviewedRows));

  console.log(`Reviewed ${reviewedRows.length} remaining already-on-site rows.`);
  for (const [bucket, count] of Object.entries(summary.finalBucketCounts)) {
    console.log(`${bucket}: ${count}`);
  }
}

function reviewRow(row, rankingByRow, licenceByRow) {
  const rowNumber = Number(row.auditRowNumber);
  const ranking = rankingByRow.get(String(rowNumber)) || {};
  const licence = licenceByRow.get(String(rowNumber)) || {};
  const rightsStatus = cleanText(ranking.rightsStatus || licence.rightsStatus || 'unknown');
  const decisionBucket = cleanText(ranking.decisionBucket || 'unranked-review-row');
  const text = classificationText(row, ranking, licence);

  const override = ROW_OVERRIDES.get(rowNumber);
  if (override) return decorate(row, ranking, licence, override);

  if (rightsStatus && rightsStatus !== 'standard-open-licence-confirmed') {
    return decorate(row, ranking, licence, {
      finalBucket: 'hold-rights-provider-unresolved',
      recommendedDecision: 'Hold until a public provider URL and explicit open rights statement are available.',
      caveat: cleanText(licence.recommendedRestriction || ranking.prerequisites)
    });
  }

  if (decisionBucket === 'hold-low-confidence-variant-review') {
    return decorate(row, ranking, licence, {
      finalBucket: 'hold-low-confidence-variant-review',
      recommendedDecision: 'Hold. Evidence is too weak for public source/provenance enrichment without row-level confirmation.',
      caveat: 'Low match confidence means this may be a neighbouring topic, variant, or false positive.'
    });
  }

  if (decisionBucket === 'hold-context-overlap') {
    return decorate(row, ranking, licence, {
      finalBucket: 'hold-context-overlap',
      recommendedDecision: 'Hold. Treat as contextual overlap only unless a later review proves exact source-family relevance.',
      caveat: 'The row appears related by geography/topic context, not by a reliable source relationship.'
    });
  }

  if (decisionBucket === 'hold-weak-match') {
    return decorate(row, ranking, licence, {
      finalBucket: 'hold-weak-match',
      recommendedDecision: 'Hold. Do not approve from the current evidence.',
      caveat: 'The automatic match is below the threshold needed for enrichment.'
    });
  }

  if (isTailteOrOsi(text)) {
    if (needsGovernmentBoundaryRemap(text)) {
      return decorate(row, ranking, licence, {
        finalBucket: 'remap-tailte-government-boundary-family',
        recommendedDecision: 'Review for target-family remap, then approve only as source-family evidence for the correct government/election boundary family.',
        caveat: 'Do not attach these broadly to counties or historic boundary maps just because Tailte/OSI is authoritative.'
      });
    }
    return decorate(row, ranking, licence, {
      finalBucket: 'ready-source-family-tailte-osi-national-geospatial',
      recommendedDecision: 'Ready for curated source-family approval with wording that this is related authoritative Tailte/OSI source evidence, not exact map equivalence.',
      caveat: 'Target family and date/generalisation wording still need to be explicit before applying.'
    });
  }

  if (isGsiGeology(text)) {
    return decorate(row, ranking, licence, {
      finalBucket: 'ready-source-family-gsi-geology',
      recommendedDecision: 'Review as a separate GSI/geology source-family batch before approval.',
      caveat: 'Keep geology/groundwater variants separate from OPW flood or general hydro source families.'
    });
  }

  if (isOpwHydro(text)) {
    return decorate(row, ranking, licence, {
      finalBucket: 'ready-source-family-opw-hydro',
      recommendedDecision: 'Review as a separate OPW/hydro/flood source-family batch before approval.',
      caveat: 'Scenario, model year, and flood/hydro subtype must be preserved; do not collapse into one generic water layer.'
    });
  }

  if (isOpenDataNi(text)) {
    return decorate(row, ranking, licence, {
      finalBucket: 'review-open-data-ni-boundary-statistical-family',
      recommendedDecision: 'Review as Open Data NI boundary/statistical source-family evidence.',
      caveat: 'Northern Ireland boundary, statistical, transport, and environmental rows should be split by family before applying.'
    });
  }

  if (isLocalAuthorityTopic(text)) {
    return decorate(row, ranking, licence, {
      finalBucket: 'hold-local-authority-topic-not-direct-enrichment',
      recommendedDecision: 'Hold out of already-on-site direct enrichment; review later as local-authority source records, council-topic families, or map candidates.',
      caveat: 'These matches are often same-council/topic-neighbourhood evidence rather than the same source record.'
    });
  }

  if (isHeritageOrEnvironment(text)) {
    return decorate(row, ranking, licence, {
      finalBucket: 'review-heritage-environment-source-family',
      recommendedDecision: 'Review as heritage/environment source-family evidence.',
      caveat: 'Attach only to matching heritage/environment families; avoid broad geography-only attachment.'
    });
  }

  if (isCensusOrStatistical(text)) {
    return decorate(row, ranking, licence, {
      finalBucket: 'review-census-statistical-source-family',
      recommendedDecision: 'Review as census/statistical source-family evidence.',
      caveat: 'Confirm geography vintage and statistical unit before attaching.'
    });
  }

  return decorate(row, ranking, licence, {
    finalBucket: 'hold-mixed-other-row-level-review',
    recommendedDecision: 'Hold for row-level review; do not bulk-approve.',
    caveat: 'Rights may be clear, but the topic/target relationship is not specific enough for automatic provenance enrichment.'
  });
}

function decorate(row, ranking, licence, decision) {
  return compactObject({
    rowNumber: Number(row.auditRowNumber),
    title: cleanText(row.title),
    provider: cleanText(ranking.provider || row.provider),
    category: cleanText(ranking.category || row.category),
    formats: cleanText(ranking.formats || normalizeArray(row.formats).join('|')),
    decisionBucket: cleanText(ranking.decisionBucket),
    finalBucket: decision.finalBucket,
    rightsStatus: cleanText(ranking.rightsStatus || licence.rightsStatus || 'unknown'),
    licenseTitle: cleanText(ranking.licenseTitle || licence.licenseTitle),
    currentProviderUrl: cleanText(ranking.currentProviderUrl || licence.currentProviderUrl),
    bestMatchScore: cleanText(ranking.bestMatchScore),
    roiGroup: cleanText(ranking.roiGroup),
    targetIds: cleanText(ranking.targetIds || normalizeArray(row.targetIds).join('; ')),
    recommendedDecision: decision.recommendedDecision,
    caveat: cleanText(decision.caveat),
    evidenceSummary: cleanText(ranking.evidenceSummary)
  });
}

function buildSummary(rows, enrichmentSummary) {
  const finalBucketCounts = countBy(rows, (row) => row.finalBucket);
  const decisionBucketCounts = countBy(rows, (row) => row.decisionBucket || 'unranked-review-row');
  const rightsStatusCounts = countBy(rows, (row) => row.rightsStatus || 'unknown');
  const implementationReadyBuckets = [
    'ready-source-family-tailte-osi-national-geospatial',
    'ready-source-family-gsi-geology',
    'ready-source-family-opw-hydro'
  ];
  return {
    generatedAt: new Date().toISOString(),
    sourceEnrichmentSummary: enrichmentSummary,
    reviewedRows: rows.length,
    finalBucketCounts,
    decisionBucketCounts,
    rightsStatusCounts,
    implementationReadyRows: rows.filter((row) => implementationReadyBuckets.includes(row.finalBucket)).length,
    remapBeforeApprovalRows: rows.filter((row) => row.finalBucket === 'remap-tailte-government-boundary-family').length,
    rightsOrResolvedHolds: rows.filter((row) => row.finalBucket.startsWith('hold-rights-') || row.finalBucket.startsWith('hold-resolved-')).length,
    rowLevelOrWeakHolds: rows.filter((row) => row.finalBucket.startsWith('hold-low-')
      || row.finalBucket.startsWith('hold-context')
      || row.finalBucket.startsWith('hold-weak')
      || row.finalBucket.startsWith('hold-mixed')
      || row.finalBucket.startsWith('hold-local-authority')).length
  };
}

function buildMarkdown(summary, rows) {
  const lines = [];
  lines.push('# Already-On-Site Remaining Full Review');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Reviewed rows: ${summary.reviewedRows}`);
  lines.push('');
  lines.push('## Bucket Counts');
  lines.push('');
  for (const [bucket, count] of Object.entries(summary.finalBucketCounts)) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  lines.push('- Apply nothing automatically from this report without a specific approval pass.');
  lines.push('- The highest-ROI next batch is the curated source-family approval set: Tailte/OSI national geospatial, OPW/hydro, and GSI/geology rows.');
  lines.push('- Tailte government-boundary rows need target-family remapping before approval.');
  lines.push('- Local-authority topic rows and mixed-other rows should stay out of direct already-on-site enrichment.');
  lines.push('- Rights/provider holds and the two resolved holds remain blocked.');
  lines.push('');
  lines.push('## Representative Rows');
  lines.push('');
  for (const [bucket] of Object.entries(summary.finalBucketCounts)) {
    const examples = rows.filter((row) => row.finalBucket === bucket).slice(0, 5);
    lines.push(`### ${bucket}`);
    for (const row of examples) {
      lines.push(`- Row ${row.rowNumber}: ${row.title} | ${row.recommendedDecision}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function classificationText(row, ranking, licence) {
  return [
    row.title,
    row.provider,
    row.category,
    normalizeArray(row.formats).join(' '),
    ranking.title,
    ranking.provider,
    ranking.category,
    ranking.formats,
    ranking.currentProviderUrl,
    licence.title,
    licence.provider,
    licence.currentProviderUrl
  ].map((value) => String(value || '')).join(' ').toLowerCase();
}

function isTailteOrOsi(text) {
  return /\btailte\b|\bosi\b|data-osi|national statutory boundaries|high value dataset/.test(text);
}

function needsGovernmentBoundaryRemap(text) {
  return /constituenc|gaeltacht|province|provinces|local electoral area|\blea\b|municipal district|administrative area|referendum|dail|electoral division/.test(text);
}

function isGsiGeology(text) {
  return /\bgsi\b|\bgsni\b|geolog|groundwater|aquifer|bedrock|quaternary|mineral|soil/.test(text);
}

function isOpwHydro(text) {
  return /\bopw\b|flood|catchment|river basin|water bod|coastal flood|hydro/.test(text);
}

function isOpenDataNi(text) {
  return /open data ni|opendatani|admin\.opendatani/.test(text);
}

function isHeritageOrEnvironment(text) {
  return /heritage|monument|archae|protected structure|protected areas|niah|national parks|wildlife|designated|habitats?|\bsac\b|\bspa\b|\bramsar\b|\baonb\b|\bassi\b/.test(text);
}

function isLocalAuthorityTopic(text) {
  return /\bdcc\b|\bdlr\b|\bsdcc\b|dublin city council|south dublin|dun laoghaire|fingal|cork city|cork county|donegal county|galway city|limerick city|waterford city|local authority open data/.test(text);
}

function isCensusOrStatistical(text) {
  return /\bcso\b|\bnisra\b|census|small area|population|statistical/.test(text);
}

function countBy(rows, fn) {
  const counts = {};
  for (const row of rows) {
    const key = fn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function toCsv(rows) {
  const headers = [
    'rowNumber',
    'title',
    'provider',
    'category',
    'formats',
    'decisionBucket',
    'finalBucket',
    'rightsStatus',
    'licenseTitle',
    'currentProviderUrl',
    'bestMatchScore',
    'roiGroup',
    'targetIds',
    'recommendedDecision',
    'caveat'
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === null || item === undefined || item === '') return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
}
