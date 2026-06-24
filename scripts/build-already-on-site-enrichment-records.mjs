#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'tasks', 'already-on-site-enrichment-review-2026-06-24.csv');
const OUTPUT = path.join(ROOT, 'data', 'database', 'already-on-site-enrichments.json');

const APPLIED_SAFETY_CLASSES = new Set([
  'safe metadata enrichment candidate',
  'high-confidence enrichment candidate'
]);

const REVIEW_ONLY_SAFETY_CLASSES = new Set([
  'variant/source enrichment review',
  'context-overlap review only',
  'weak feature-family match'
]);

main();

function main() {
  if (!existsSync(INPUT)) {
    throw new Error(`Missing enrichment review CSV: ${path.relative(ROOT, INPUT)}`);
  }

  const rows = parseCsv(readFileSync(INPUT, 'utf8'));
  const appliedRows = rows.filter((row) => APPLIED_SAFETY_CLASSES.has(cleanText(row.safetyClass)));
  const reviewRows = rows.filter((row) => REVIEW_ONLY_SAFETY_CLASSES.has(cleanText(row.safetyClass)));
  const groupedTargets = groupAppliedRows(appliedRows);

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReviewCsv: 'tasks/already-on-site-enrichment-review-2026-06-24.csv',
    policy: {
      application: 'safe and high-confidence duplicate-match rows enrich existing source records only',
      reviewOnly: 'variant, context-overlap, and weak feature-family rows remain staged for review and are not published as factual enrichment',
      privacy: 'local filesystem paths are intentionally excluded from this public sidecar'
    },
    summary: {
      inputRows: rows.length,
      appliedRows: appliedRows.length,
      appliedTargets: groupedTargets.length,
      reviewRows: reviewRows.length,
      omittedRows: rows.length - appliedRows.length - reviewRows.length
    },
    targets: groupedTargets,
    reviewRows: reviewRows.map(toReviewRow)
  };

  assertNoLocalPaths(output);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${groupedTargets.length} enriched targets from ${appliedRows.length} applied rows; ${reviewRows.length} rows remain review-only.`);
}

function groupAppliedRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const target = chooseTarget(row);
    const key = target.sourceTargetId;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceTargetId: target.sourceTargetId,
        targetEntityKind: target.targetEntityKind,
        targetEntityId: target.targetEntityId,
        targetTitle: target.targetTitle,
        targetBrowseUrl: target.targetBrowseUrl,
        sourceRecordBrowseUrl: `/browse/sources/${encodeURIComponent(slugify(target.sourceTargetId))}`,
        evidence: [],
        sourceItems: [],
        safetyClasses: [],
        enrichmentTypes: [],
        formats: [],
        providers: [],
        categories: [],
        rowNumbers: []
      });
    }
    const group = groups.get(key);
    group.evidence.push(...parseTargetEvidence(row.targetEvidence));
    group.sourceItems.push(toSourceItem(row));
    addUnique(group.safetyClasses, cleanText(row.safetyClass));
    addMany(group.enrichmentTypes, splitList(row.enrichmentTypes, ';'));
    addMany(group.formats, splitList(row.formats, '|'));
    addUnique(group.providers, publicText(row.provider, 'Local source mirror'));
    addUnique(group.categories, publicText(row.category, 'Local source'));
    addUnique(group.rowNumbers, Number(row.rowNumber) || cleanText(row.rowNumber));
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      evidence: dedupeEvidence(group.evidence).slice(0, 12),
      sourceItems: group.sourceItems.sort((a, b) => Number(a.auditRowNumber) - Number(b.auditRowNumber)),
      confidence: group.safetyClasses.includes('safe metadata enrichment candidate') ? 'safe' : 'high-confidence',
      sourceItemCount: group.sourceItems.length
    }))
    .sort((a, b) => a.targetTitle.localeCompare(b.targetTitle) || a.sourceTargetId.localeCompare(b.sourceTargetId));
}

function chooseTarget(row) {
  const evidence = parseTargetEvidence(row.targetEvidence);
  const sourceEvidence = evidence.find((item) => item.kind === 'browse-source');
  if (sourceEvidence) {
    return {
      sourceTargetId: sourceEvidence.id,
      targetEntityKind: inferEntityKindFromSourceId(sourceEvidence.id),
      targetEntityId: inferEntityIdFromSourceId(sourceEvidence.id),
      targetTitle: sourceEvidence.title || cleanText(row.title),
      targetBrowseUrl: browseUrlForSourceTarget(sourceEvidence.id)
    };
  }

  const mapEvidence = evidence.find((item) => item.kind === 'database-map' || item.kind === 'browse-map');
  if (mapEvidence) {
    return {
      sourceTargetId: `map-source:${mapEvidence.id}`,
      targetEntityKind: 'map',
      targetEntityId: mapEvidence.id,
      targetTitle: mapEvidence.title || cleanText(row.title),
      targetBrowseUrl: `/browse/maps/${encodeURIComponent(mapEvidence.id)}`
    };
  }

  const tableEvidence = evidence.find((item) => item.kind === 'browse-table' || item.kind === 'database-table');
  if (tableEvidence) {
    return {
      sourceTargetId: `table:${tableEvidence.id}`,
      targetEntityKind: 'table',
      targetEntityId: tableEvidence.id,
      targetTitle: tableEvidence.title || cleanText(row.title),
      targetBrowseUrl: `/browse/sources/${encodeURIComponent(slugify(`table:${tableEvidence.id}`))}`
    };
  }

  const featureEvidence = evidence.find((item) => item.kind === 'browse-feature');
  if (featureEvidence) {
    return {
      sourceTargetId: `feature-source:${featureEvidence.id}`,
      targetEntityKind: 'feature-group',
      targetEntityId: featureEvidence.id,
      targetTitle: featureEvidence.title || cleanText(row.title),
      targetBrowseUrl: `/browse/features?map=${encodeURIComponent(featureEvidence.id)}`
    };
  }

  const fallbackId = `already-on-site-enrichment:${row.rowNumber || slugify(row.title)}`;
  return {
    sourceTargetId: fallbackId,
    targetEntityKind: 'unknown',
    targetEntityId: fallbackId,
    targetTitle: cleanText(row.title || fallbackId),
    targetBrowseUrl: null
  };
}

function parseTargetEvidence(value) {
  return splitList(value, '|').map((part) => {
    const match = part.match(/^([^:()]+):([^()]+?)(?:\s*\((.*?)(?:;\s*([0-9.]+))?\))?$/);
    if (!match) return null;
    const kind = cleanText(match[1]);
    const id = cleanText(match[2]);
    const title = cleanText(match[3] || '');
    const score = Number(match[4]);
    return compactObject({
      kind,
      id,
      title,
      score: Number.isFinite(score) ? score : null
    });
  }).filter(Boolean);
}

function toSourceItem(row) {
  return compactObject({
    auditRowNumber: Number(row.rowNumber) || cleanText(row.rowNumber),
    title: cleanText(row.title),
    provider: publicText(row.provider, 'Local source mirror'),
    category: publicText(row.category, 'Local source'),
    formats: splitList(row.formats, '|'),
    safetyClass: cleanText(row.safetyClass),
    recommendedAction: cleanText(row.cleanedRecommendation || row.recommendedEnrichmentAction),
    sourcePlacement: cleanText(row.sourcePlacement),
    geographyRecommendation: cleanText(row.geographyRecommendation),
    enrichmentTypes: splitList(row.enrichmentTypes, ';'),
    detectedFamilies: splitList(row.detectedFamilies, ';'),
    siteFamiliesPresent: splitList(row.siteFamiliesPresent, ';'),
    refinedStatus: cleanText(row.refinedStatus)
  });
}

function toReviewRow(row) {
  return compactObject({
    auditRowNumber: Number(row.rowNumber) || cleanText(row.rowNumber),
    safetyClass: cleanText(row.safetyClass),
    title: cleanText(row.title),
    provider: publicText(row.provider, 'Local source mirror'),
    category: publicText(row.category, 'Local source'),
    formats: splitList(row.formats, '|'),
    targetIds: splitList(row.targetIds, ';'),
    targetEvidence: parseTargetEvidence(row.targetEvidence),
    recommendedAction: cleanText(row.cleanedRecommendation || row.recommendedEnrichmentAction),
    decisionNeeded: cleanText(row.decisionNeeded),
    sourcePlacement: cleanText(row.sourcePlacement),
    geographyRecommendation: cleanText(row.geographyRecommendation),
    enrichmentTypes: splitList(row.enrichmentTypes, ';'),
    refinedStatus: cleanText(row.refinedStatus)
  });
}

function inferEntityKindFromSourceId(id) {
  if (id.startsWith('map-source:')) return 'map';
  if (id.startsWith('election-source:')) return 'election';
  if (id.startsWith('table:')) return 'table';
  if (id.startsWith('book:')) return 'book';
  return 'source';
}

function inferEntityIdFromSourceId(id) {
  return id.replace(/^(map-source|election-source|table|book):/, '');
}

function browseUrlForSourceTarget(id) {
  if (id.startsWith('map-source:')) return `/browse/maps/${encodeURIComponent(id.replace(/^map-source:/, ''))}`;
  if (id.startsWith('election-source:')) return `/#layers=${encodeURIComponent(id.replace(/^election-source:/, ''))}`;
  return `/browse/sources/${encodeURIComponent(slugify(id))}`;
}

function dedupeEvidence(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data
    .filter((cells) => cells.some((cell) => String(cell || '').trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
}

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  const match = text.match(/[A-Z]:\\|\\\\|\/Users\/scomo/i);
  if (match) {
    throw new Error(`Public enrichment sidecar contains a local path token: ${match[0]}`);
  }
}

function publicText(value, localFallback = 'Local source mirror') {
  const text = cleanText(value);
  if (!text) return '';
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) return localFallback;
  return text;
}

function addUnique(list, value) {
  const clean = typeof value === 'number' ? value : cleanText(value);
  if (clean === '' || clean === null || clean === undefined) return;
  if (!list.includes(clean)) list.push(clean);
}

function addMany(list, values) {
  for (const value of values) addUnique(list, value);
}

function splitList(value, separator) {
  return String(value || '')
    .split(separator)
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'item';
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === null || item === undefined || item === '') return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
}
