#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'data', 'review-inputs', 'content-blocker-review-2026-06-24.csv');
const OUTPUT = path.join(ROOT, 'data', 'database', 'raw-source-documents.json');
const TARGET_GROUP = '8. Raw source-document corpus';

main();

function main() {
  if (!existsSync(INPUT)) {
    throw new Error(`Missing blocker review CSV: ${path.relative(ROOT, INPUT)}`);
  }

  const rows = parseCsv(readFileSync(INPUT, 'utf8'))
    .map((row, index) => ({ ...row, auditRowNumber: index + 1 }))
    .filter((row) => cleanText(row.roiGroup) === TARGET_GROUP);

  if (rows.length !== 252) {
    throw new Error(`Expected 252 raw source-document rows, found ${rows.length}`);
  }

  const sources = rows.map(toSourceRecord);
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) {
      throw new Error(`Duplicate raw source id: ${source.id}`);
    }
    ids.add(source.id);
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReview: 'data/review-inputs/content-blocker-review-2026-06-24.csv',
    policy: {
      placement: 'Books / Tables / Sources',
      canonicalLinkOrder: ['current provider URL', 'Wayback URL when available', 'Internet Archive mirror URL when available'],
      publicRecords: 'source/document/table records only; do not create duplicate map or election parent records',
      localPaths: 'local operational mirror paths are intentionally excluded from this public sidecar',
      internetArchive: 'records are IA-ready; actual IA item/file URLs remain pending until raw files are uploaded or matched to public IA mirrors',
      r2Cdn: 'not used for raw source files; R2/CDN is reserved for cleaned/queryable/filterable/chartable/map-ready bundles'
    },
    conventions: {
      typeSplit: {
        book: 'PDF, DOC/DOCX, image, text, or report-like records',
        table: 'CSV, XLS/XLSX, ODS, PX, JSON-STAT, XML, or statistical table records',
        source: 'dataset, service, website, map hub, ZIP, database, or mixed-source records'
      },
      viewportSupport: {
        pdf: 'previewable from public URL or IA mirror when file URL is available',
        csvText: 'previewable as a capped read-only table/text viewport when file URL is available',
        image: 'previewable as an image viewport when file URL is available',
        spreadsheet: 'previewable through a parsed sheet viewport after file URL/sheet metadata is available',
        zipDatabase: 'download-only initially'
      },
      statusChips: ['Source only', 'Preview available', 'Download available', 'Mirror available', 'Structured', 'Superseded', 'Needs review']
    },
    summary: buildSummary(sources),
    sources
  };

  assertNoLocalPaths(output);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${sources.length} raw source-document records.`);
}

function toSourceRecord(row) {
  const title = cleanText(row.title || row.slugOrId || 'Untitled source document');
  const slugOrId = slugify(row.slugOrId || title);
  const provider = cleanText(row.provider);
  const organisation = cleanText(row.organisation);
  const formats = normalizeFormats(row.formats);
  const sourceKind = classifySourceKind(row, formats);
  const providerUrl = providerDatasetUrl(provider, slugOrId);
  const id = `raw-source:${slugify(provider)}:${slugOrId}`;
  const providerNames = unique([organisation, provider].filter(Boolean));
  const category = sourceCategory(sourceKind);
  const viewport = viewportMetadata(formats, providerUrl);
  const statusChips = buildStatusChips(viewport, formats);
  const shortCitation = `${providerNames.join(', ') || 'Source provider'}, ${title}.`;
  const fullCitation = `${providerNames.join(', ') || 'Source provider'}. ${title}. Current provider dataset URL: ${providerUrl || 'not resolved from audit row'}. Civgraph raw source-document record.`;

  return compactObject({
    id,
    slug: slugify(id),
    type: `raw-source-${sourceKind}`,
    title,
    subtitle: compactJoin([
      organisation,
      provider,
      formats.join(', '),
      'Source-only'
    ]),
    category,
    date: inferYear(title),
    provider: providerNames,
    description: sourceDescription(title, providerNames, sourceKind, formats),
    url: providerUrl,
    references: [
      compactObject({
        label: `${title} provider dataset page`,
        url: providerUrl,
        source: provider,
        role: 'canonical-provider-dataset',
        status: providerUrl ? 'inferred-from-provider-slug' : 'missing-provider-url'
      })
    ].filter((entry) => entry.url),
    downloads: providerUrl ? [
      {
        label: 'Provider dataset page',
        url: providerUrl,
        type: 'dataset-page',
        status: 'resource downloads listed by provider dataset page'
      }
    ] : [],
    status: 'Source only',
    statusChips,
    sourceHierarchy: sourceHierarchy(provider, organisation, title),
    viewport,
    shortCitation,
    fullCitation,
    sourceItems: [
      compactObject({
        auditRowNumber: row.auditRowNumber,
        title,
        provider,
        organisation,
        formats,
        category: cleanText(row.category),
        refinedStatus: cleanText(row.refinedStatus),
        recommendedAction: cleanText(row.cleanedRecommendation),
        sourcePlacement: cleanText(row.sourcePlacement),
        blockerCategories: splitList(row.blockerCategories, ';'),
        detectedFamilies: splitList(row.detectedFamilies, ';'),
        siteFamiliesPresent: splitList(row.siteFamiliesPresent, ';'),
        mirrorPolicy: 'IA mirror/download URL pending; do not expose local operational mirror paths',
        providerDatasetUrl: providerUrl
      })
    ],
    license: compactObject({
      status: 'provider-specific',
      note: 'Use the provider dataset page, Wayback capture, and IA item metadata to confirm resource-level licence before structured reuse.'
    }),
    approval: {
      recommendedAction: 'publish as source/document/table record; do not create duplicate map or election parent',
      stagingId: id,
      confidence: 'approved-convention',
      sourceType: 'raw source-document corpus',
      provider: providerNames.join('; ')
    },
    publicationStatus: 'raw-source-staged',
    proposedBrowsePath: `Books / Tables / Sources > ${category}`,
    relatedRecords: parseMatchedEvidence(row.matchedSiteEvidence),
    keywords: unique([
      'raw-source-document',
      'ia-ready',
      'source-only',
      sourceKind,
      provider,
      organisation,
      ...formats,
      ...splitList(row.detectedFamilies, ';')
    ].filter(Boolean)),
    browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
  });
}

function sourceDescription(title, providers, sourceKind, formats) {
  const providerText = providers.length ? providers.join(', ') : 'the source provider';
  return `${title} is staged as a ${sourceKind.replace(/-/g, ' ')} source record from ${providerText}. The record is suitable for a Browse/Books/Tables source page with provider links now and IA-hotlinked viewport/download links once the public IA item/file URLs are attached. No map conversion or deep semantic modelling is implied by this source-only record. Formats observed in the local audit: ${formats.join(', ') || 'not specified'}.`;
}

function providerDatasetUrl(provider, slug) {
  const key = cleanText(provider).toLowerCase();
  if (!slug) return null;
  if (key === 'data.gov.ie') return `https://data.gov.ie/dataset/${encodeURIComponent(slug)}`;
  if (key === 'open data ni') return `https://admin.opendatani.gov.uk/dataset/${encodeURIComponent(slug)}`;
  return null;
}

function classifySourceKind(row, formats) {
  const category = cleanText(row.category).toLowerCase();
  const formatSet = new Set(formats.map((format) => format.toLowerCase()));
  if (category === 'service' || hasAny(formatSet, ['website', 'data portal', 'map hub'])) return 'source';
  if (hasAny(formatSet, ['csv', 'xlsx', 'xls', 'ods', 'px', 'json-stat', 'json', 'xml'])) return 'table';
  if (hasAny(formatSet, ['pdf', 'docx', 'doc', 'txt', 'png', 'jpg', 'jpeg', 'tiff'])) return 'document';
  if (hasAny(formatSet, ['zip', 'database', 'mdb', 'sqlite'])) return 'source';
  return category === 'tabular' ? 'table' : 'source';
}

function sourceCategory(kind) {
  if (kind === 'table') return 'Raw source tables';
  if (kind === 'document') return 'Raw source documents';
  return 'Raw source files';
}

function viewportMetadata(formats, providerUrl) {
  const formatSet = new Set(formats.map((format) => format.toLowerCase()));
  const support = [];
  if (hasAny(formatSet, ['pdf'])) support.push('pdf');
  if (hasAny(formatSet, ['csv', 'txt'])) support.push('table-or-text');
  if (hasAny(formatSet, ['png', 'jpg', 'jpeg', 'tiff'])) support.push('image');
  if (hasAny(formatSet, ['xls', 'xlsx', 'ods'])) support.push('spreadsheet');
  if (hasAny(formatSet, ['zip', 'database', 'mdb', 'sqlite'])) support.push('download-only');
  return compactObject({
    status: support.length ? 'ready-when-public-file-url-attached' : 'source-page-only',
    supportedViewportTypes: support,
    canonicalDatasetUrl: providerUrl,
    internetArchiveUrl: null,
    waybackUrl: null,
    note: 'The audit row does not include public IA item/file URLs. Attach IA and/or resource file URLs before rendering embedded previews.'
  });
}

function buildStatusChips(viewport, formats) {
  const chips = ['Source only'];
  if (viewport.supportedViewportTypes?.length && !viewport.supportedViewportTypes.includes('download-only')) chips.push('Preview available');
  if (formats.length) chips.push('Download available');
  chips.push('Needs review');
  return unique(chips);
}

function sourceHierarchy(provider, organisation, title) {
  return ['Books / Tables / Sources', provider, organisation, title].map(cleanText).filter(Boolean);
}

function parseMatchedEvidence(value) {
  return splitList(value, '|').slice(0, 5).map((entry) => {
    const parts = entry.split('::').map(cleanText);
    const first = parts[0] || '';
    const [kind, id] = first.split(':', 2);
    return compactObject({
      kind,
      id,
      title: parts[1] || null,
      score: Number.isFinite(Number(parts[2])) ? Number(parts[2]) : null
    });
  });
}

function buildSummary(sources) {
  return {
    total: sources.length,
    byProvider: countBy(sources, (source) => source.provider?.at(-1) || 'Unknown'),
    byCategory: countBy(sources, (source) => source.category || 'Unknown'),
    byType: countBy(sources, (source) => source.type || 'Unknown'),
    withProviderDatasetUrl: sources.filter((source) => source.url).length,
    withIaMirrorUrl: sources.filter((source) => source.viewport?.internetArchiveUrl).length,
    iaMirrorUrlsPending: sources.filter((source) => !source.viewport?.internetArchiveUrl).length
  };
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function normalizeFormats(value) {
  return unique(String(value || '')
    .split(/[|,]/)
    .map((part) => cleanText(part).replace(/^\./, '').toUpperCase())
    .filter(Boolean));
}

function inferYear(value) {
  const match = String(value || '').match(/\b(18|19|20)\d{2}\b/);
  return match ? match[0] : null;
}

function hasAny(set, values) {
  return values.some((value) => set.has(value));
}

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) {
    throw new Error('Raw source-document output leaks a local filesystem path');
  }
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item == null) continue;
    if (Array.isArray(item) && !item.length) continue;
    if (typeof item === 'string' && !item.trim()) continue;
    if (typeof item === 'object' && !Array.isArray(item) && !Object.keys(item).length) continue;
    out[key] = item;
  }
  return out;
}

function compactJoin(parts) {
  return parts.map((part) => Array.isArray(part) ? part.join(', ') : part)
    .map(cleanText)
    .filter(Boolean)
    .join(' / ');
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const cleaned = typeof value === 'string' ? cleanText(value) : value;
    if (cleaned == null || cleaned === '') continue;
    const key = String(cleaned).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function splitList(value, delimiter = ';') {
  return String(value || '')
    .split(delimiter)
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'item';
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
  row.push(field);
  rows.push(row);
  const [headers, ...records] = rows.filter((items) => items.some((item) => item !== ''));
  return records.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ''])));
}
