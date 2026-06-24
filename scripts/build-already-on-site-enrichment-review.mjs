import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATE = '2026-06-24';
const INPUT = path.join(ROOT, 'tasks', `d-drive-already-on-site-review-${DATE}.csv`);
const OUT_CSV = path.join(ROOT, 'tasks', `already-on-site-enrichment-review-${DATE}.csv`);
const OUT_MD = path.join(ROOT, 'tasks', `already-on-site-enrichment-review-${DATE}.md`);
const OUT_JSON = path.join(ROOT, 'tasks', `already-on-site-enrichment-summary-${DATE}.json`);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  const [headers, ...body] = rows.filter((r) => r.some((cell) => cell !== ''));
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows, headers) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function countBy(rows, getter) {
  const counts = new Map();
  for (const row of rows) {
    const key = getter(row) || '(blank)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function splitList(value, sep = ';') {
  return String(value || '')
    .split(sep)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseEvidence(value) {
  return String(value || '')
    .split(/\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)::(.*?)::([0-9.]+)$/);
      if (!match) {
        return { raw: part, kind: '', id: '', title: part, score: 0 };
      }
      const left = match[1];
      const colon = left.indexOf(':');
      const kind = colon >= 0 ? left.slice(0, colon) : left;
      const id = colon >= 0 ? left.slice(colon + 1) : '';
      return {
        raw: part,
        kind,
        id,
        title: match[2],
        score: Number(match[3]),
      };
    });
}

function score(row) {
  return Number(row.bestMatchScore || 0);
}

function formatList(row) {
  return splitList(row.formats, '|').map((item) => item.toUpperCase());
}

function hasAny(text, needles) {
  const haystack = String(text || '').toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function tokens(value) {
  const stop = new Set([
    'and',
    'the',
    'for',
    'from',
    'with',
    'open',
    'data',
    'national',
    'statutory',
    'boundaries',
    'boundary',
    'ireland',
    'northern',
    'republic',
    'extract',
    'generalised',
  ]);
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stop.has(token));
}

function tokenOverlap(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  return common / Math.min(left.size, right.size);
}

function classifyTypes(row) {
  const text = [
    row.roiGroup,
    row.provider,
    row.category,
    row.title,
    row.organisation,
    row.slugOrId,
    row.detectedFamilies,
    row.sourcePlacement,
    row.cleanedRecommendation,
  ].join(' ');
  const formats = formatList(row);
  const types = new Set();

  types.add('source/provenance metadata');

  if (row.dPath || hasAny(text, ['download', 'source files', 'source/download'])) {
    types.add('download/source-file metadata');
  }
  if (formats.length > 1) {
    types.add('alternate-format metadata');
  }
  if (formats.some((fmt) => ['SHP', 'GEOJSON', 'KML', 'GPKG', 'GDB', 'MAPINFO', 'GEOPACKAGE', 'FGDB'].includes(fmt))) {
    types.add('geospatial source-format metadata');
  }
  if (hasAny(text, ['boundary', 'boundaries', 'constituenc', 'ward', 'district electoral', 'dea', 'local government', 'output area', 'small area', 'townland', 'admin', 'electoral', 'council'])) {
    types.add('geometry lineage and boundary-version metadata');
  }
  if (hasAny(text, ['ungeneralised', 'generalised', '50k', 'largescale', 'large scale', '1:1m', 'scale', 'full detail', 'provisional', 'final recommendations'])) {
    types.add('scale/generalisation/edition metadata');
  }
  if (/\b(18|19|20)\d{2}\b/.test(text)) {
    types.add('date/version metadata');
  }
  if (formats.some((fmt) => ['CSV', 'XLS', 'XLSX', 'ODS', 'JSON', 'HTML', 'PDF', 'TXT'].includes(fmt))) {
    types.add('schema/table/attribute metadata');
  }
  if (hasAny(text, ['census', 'nisra', 'cso', 'statistic', 'pxstat', 'output areas', 'small areas', 'super output'])) {
    types.add('census/statistical provenance and concept context');
  }
  if (hasAny(text, ['election', 'dail', 'dail', 'parliamentary', 'constituenc', 'eoni', 'electoral'])) {
    types.add('election geography/source provenance');
  }
  if (hasAny(text, ['raster', 'lidar', 'point cloud', 'geotiff', 'tif', 'imagery', '3d']) || formats.some((fmt) => ['TIF', 'TIFF', 'GEOTIFF', 'ECW', 'JPEG', 'JPG', 'PNG'].includes(fmt))) {
    types.add('large raster/imagery preview or download metadata');
  }
  if (formats.some((fmt) => ['PDF', 'CSV', 'TXT', 'XLS', 'XLSX', 'ODS', 'PNG', 'JPG', 'JPEG'].includes(fmt))) {
    types.add('raw-source viewport candidate metadata');
  }

  return [...types].sort();
}

function classifySafety(row, evidence) {
  const refined = row.refinedStatus || '';
  const best = score(row);
  const sourceEvidence = evidence.some((item) => item.kind === 'browse-source');
  const mapEvidence = evidence.some((item) => item.kind === 'browse-map' || item.kind === 'database-map');
  const featureEvidence = evidence.some((item) => item.kind === 'browse-feature');
  const sourceOrMap = sourceEvidence || mapEvidence;
  const bestTitleOverlap = evidence.length ? Math.max(...evidence.map((item) => tokenOverlap(row.title, item.title))) : 0;

  if (refined.includes('already represented or very strong exact match')) {
    return {
      safety: 'safe metadata enrichment candidate',
      action: 'enrich existing record only; do not create a new parent record',
      decision: 'No user decision needed for provenance/download metadata if target ID is confirmed; review before geometry/schema claims.',
    };
  }
  if (best >= 0.75 && sourceOrMap && bestTitleOverlap >= 0.25) {
    return {
      safety: 'high-confidence enrichment candidate',
      action: 'enrich matched source/map after target check; treat geometry as variant only if materially different',
      decision: 'Target check recommended before applying.',
    };
  }
  if (refined.includes('context overlaps existing site family')) {
    return {
      safety: 'context-overlap review only',
      action: 'do not auto-enrich; use as evidence for a source/variant review batch',
      decision: 'User or curator should decide whether this is a source, variant, citation-only, or hold.',
    };
  }
  if (featureEvidence && !sourceOrMap && best < 0.7) {
    return {
      safety: 'weak feature-family match',
      action: 'do not auto-enrich from feature-only fuzzy evidence',
      decision: 'Needs stronger target evidence.',
    };
  }
  return {
    safety: 'variant/source enrichment review',
    action: 'compare provider/date/scale/schema with existing family before adding metadata',
    decision: 'Review required; likely source metadata or child/variant relationship, not a duplicate parent.',
  };
}

function targetSummary(evidence) {
  return evidence
    .slice(0, 3)
    .map((item) => `${item.kind}:${item.id} (${item.title}; ${item.score.toFixed(2)})`)
    .join(' | ');
}

function topTypes(types) {
  return types.join('; ');
}

function markdownTable(rows, headers) {
  const escapeCell = (value) => String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => escapeCell(row[header])).join(' | ')} |`);
  }
  return lines.join('\n');
}

function mdCountTable(entries, keyName) {
  return markdownTable(
    entries.map(([key, count]) => ({ [keyName]: key, Rows: count })),
    [keyName, 'Rows'],
  );
}

function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Missing input: ${INPUT}`);
  }

  const rows = parseCsv(fs.readFileSync(INPUT, 'utf8'));
  const review = rows.map((row, index) => {
    const evidence = parseEvidence(row.matchedSiteEvidence);
    const types = classifyTypes(row);
    const safety = classifySafety(row, evidence);
    return {
      rowNumber: index + 2,
      roiGroup: row.roiGroup,
      provider: row.provider,
      category: row.category,
      title: row.title,
      formats: row.formats,
      dPath: row.dPath,
      refinedStatus: row.refinedStatus,
      bestMatchScore: row.bestMatchScore,
      enrichmentTypes: topTypes(types),
      safetyClass: safety.safety,
      recommendedEnrichmentAction: safety.action,
      decisionNeeded: safety.decision,
      targetEvidence: targetSummary(evidence),
      targetIds: evidence.slice(0, 5).map((item) => `${item.kind}:${item.id}`).join('; '),
      detectedFamilies: row.detectedFamilies,
      siteFamiliesPresent: row.siteFamiliesPresent,
      sourcePlacement: row.sourcePlacement,
      cleanedRecommendation: row.cleanedRecommendation,
      geographyRecommendation: row.geographyRecommendation,
    };
  });

  const headers = [
    'rowNumber',
    'safetyClass',
    'recommendedEnrichmentAction',
    'decisionNeeded',
    'enrichmentTypes',
    'roiGroup',
    'provider',
    'category',
    'title',
    'formats',
    'bestMatchScore',
    'targetEvidence',
    'targetIds',
    'detectedFamilies',
    'siteFamiliesPresent',
    'sourcePlacement',
    'dPath',
    'cleanedRecommendation',
    'geographyRecommendation',
    'refinedStatus',
  ];
  writeCsv(OUT_CSV, review, headers);

  const typeRows = [];
  for (const item of review) {
    for (const type of splitList(item.enrichmentTypes)) {
      typeRows.push({ type });
    }
  }

  const examples = review
    .filter((row) => row.safetyClass.includes('safe') || row.safetyClass.includes('high-confidence'))
    .slice(0, 14)
    .map((row) => ({
      Safety: row.safetyClass,
      Provider: row.provider,
      Title: row.title,
      Formats: row.formats,
      Action: row.recommendedEnrichmentAction,
      Target: row.targetEvidence,
    }));

  const reviewExamples = review
    .filter((row) => row.safetyClass.includes('review'))
    .slice(0, 14)
    .map((row) => ({
      Safety: row.safetyClass,
      Provider: row.provider,
      Title: row.title,
      Formats: row.formats,
      Action: row.recommendedEnrichmentAction,
      Target: row.targetEvidence,
    }));

  const summary = {
    generatedAt: new Date().toISOString(),
    input: path.relative(ROOT, INPUT),
    outputs: [path.relative(ROOT, OUT_CSV), path.relative(ROOT, OUT_MD), path.relative(ROOT, OUT_JSON)],
    totalRows: review.length,
    bySafetyClass: Object.fromEntries(countBy(review, (row) => row.safetyClass)),
    byRoiGroup: Object.fromEntries(countBy(review, (row) => row.roiGroup)),
    byProvider: Object.fromEntries(countBy(review, (row) => row.provider)),
    byEnrichmentType: Object.fromEntries(countBy(typeRows, (row) => row.type)),
    recommendedPolicy: {
      exactMatches: 'Use for provenance/download/source metadata enrichment on existing records only.',
      highConfidenceMatches: 'Confirm target IDs, then enrich existing source/map records; no duplicate parent records.',
      familyMatches: 'Review as source, edition, scale, schema, or child/variant evidence before applying.',
      contextOverlaps: 'Do not apply automatically; put into curator review batches.',
    },
  };

  const md = `# Already-On-Site Enrichment Review - ${DATE}

## Scope

This is a research-only review of the ${review.length} rows in \`${path.relative(ROOT, INPUT).replaceAll('\\', '/')}\`.

The goal is to identify what can be extracted from already-on-site or strong duplicate-match source rows without creating duplicate public records. No website catalogue/runtime records, R2/CDN assets, or Internet Archive uploads are changed by this script.

## Headline Findings

- Exact or very strong duplicate rows are useful for safe metadata enrichment: provenance, provider/source URLs, alternate download formats, hashes, dates, edition/scale labels, and source-file references.
- Family/context overlap rows are still useful, but mostly as review evidence. They should not be auto-applied because some matched evidence is fuzzy or points to a related family rather than the actual target record.
- The highest-value enrichment surfaces are existing map/source records for boundary datasets, census/statistical geographies, election geographies, environmental layers, and large raster/source-only items.
- The safest default is: enrich existing records, add source/download/variant references where confirmed, and avoid duplicate parent records.

## Safety Classes

${mdCountTable(countBy(review, (row) => row.safetyClass), 'Safety Class')}

## Possible Enrichment Types

${mdCountTable(countBy(typeRows, (row) => row.type), 'Enrichment Type')}

## ROI Groups

${mdCountTable(countBy(review, (row) => row.roiGroup), 'ROI Group')}

## Providers

${mdCountTable(countBy(review, (row) => row.provider), 'Provider')}

## Stronger Candidates

${markdownTable(examples, ['Safety', 'Provider', 'Title', 'Formats', 'Action', 'Target'])}

## Review-Only Examples

${markdownTable(reviewExamples, ['Safety', 'Provider', 'Title', 'Formats', 'Action', 'Target'])}

## Recommended Use

1. Do not add these rows as new parent records just because the raw file exists locally.
2. For exact and high-confidence rows, enrich the existing Civgraph record with:
   - provider and organisation provenance,
   - original/local source path,
   - source URL or future Internet Archive mirror URL,
   - alternate source formats,
   - publication/version/date/scale labels,
   - source file hashes and sizes where available,
   - source-document or viewport links where appropriate.
3. For family matches, compare source geometry, date, scale, schema, and provider before deciding whether to add:
   - source-file metadata only,
   - a child/variant record,
   - a citation-only source record,
   - or nothing.
4. For context-overlap rows, keep them in review batches. Do not apply automatically.
5. For census/statistical rows, treat this pass as source/provenance and geography/context evidence only. Structured facts still need the census/statistical semantic model before publication.

## Outputs

- Row-level review: \`${path.relative(ROOT, OUT_CSV).replaceAll('\\', '/')}\`
- Machine-readable summary: \`${path.relative(ROOT, OUT_JSON).replaceAll('\\', '/')}\`
`;

  fs.writeFileSync(OUT_MD, md);
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT_CSV)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_MD)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`Rows: ${review.length}`);
}

main();
