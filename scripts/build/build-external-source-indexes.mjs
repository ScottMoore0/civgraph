#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crawlHeaders } from '../../packages/config/src/node.mjs';

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, 'data', 'database', 'external-sources.json');
const WIKI_CATEGORY = 'Category:Council_elections_in_the_Republic_of_Ireland';
const WIKI_CATEGORY_URL = 'https://en.wikipedia.org/wiki/Category:Council_elections_in_the_Republic_of_Ireland';
const IA_UPLOADER = 'ScottMoore0';
const IA_ADVANCED_SEARCH = 'https://archive.org/advancedsearch.php';
const IA_METADATA = 'https://archive.org/metadata/';

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/** A page from the MediaWiki API (a category member or a page's info). @typedef {{ pageid?: number, title?: string, fullurl?: string, thumbnail?: { source?: string }, original?: { source?: string } }} WikiPage */
/** The MediaWiki query API's JSON, the fields read. @typedef {{ query?: { categorymembers?: WikiPage[], pages?: Record<string, WikiPage> }, continue?: { cmcontinue?: string } }} WikiQueryJson */
/** An Internet Archive advanced-search result. @typedef {{ identifier: string, title?: string, description?: string, mediatype?: string, date?: string, publicdate?: string, item_size?: number | string }} IaDoc */
/** @typedef {{ response?: { docs?: IaDoc[] } }} IaSearchJson */
/** A file of an Internet Archive item. @typedef {{ name?: string, size?: number | string, format?: string, md5?: string, sha1?: string, source?: string }} IaFile */
/** The Internet Archive metadata API's JSON, the fields read. @typedef {{ files?: IaFile[], metadata?: { title?: string, description?: string, date?: string }, item_size?: number | string }} IaMetadataJson */
/** @typedef {{ name?: string, size?: number, format?: string, md5?: string, sha1?: string, url?: string }} CandidateFile */
/**
 * An Internet Archive item whose primary file is a raster map image.
 * @typedef {{ key: string, identifier: string, title: string, description: string, date: number | null, itemSize: number | null,
 *   itemUrl: string, file: CandidateFile, thumbnail: string }} Candidate
 */
/**
 * An external source as the two builders make it; stableRecord writes these fields in this order.
 * @typedef {{ id: string, type: string, title: string, subtitle?: string | null, category?: string, date?: number | null,
 *   provider?: string[], description?: string | null, url?: string, thumbnail?: unknown, references?: unknown[], downloads?: unknown[],
 *   keywords?: unknown[], duplicateCount?: number | null, sourceItems?: unknown[], license?: string }} SourceRecord
 */

async function main() {
  const wikipediaSources = await buildWikipediaCouncilElectionSources();
  const iaSources = await buildInternetArchiveRasterMapSources();
  const sources = [...wikipediaSources, ...iaSources].sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const output = {
    schemaVersion: 1,
    sources: sources.map(stableRecord),
    provenance: [
      {
        source: 'Wikipedia category',
        url: WIKI_CATEGORY_URL,
        note: 'Metadata-only index of articles in the category. Full article text is linked, not copied into this repository.'
      },
      {
        source: 'Internet Archive advanced search and metadata API',
        url: `https://archive.org/details/@${IA_UPLOADER}`,
        note: 'Metadata-only index of likely large raster map image items. Raster images remain hotlinked from archive.org and are not stored by Civgraph.'
      }
    ]
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`- Wikipedia council-election articles: ${wikipediaSources.length}`);
  console.log(`- Internet Archive raster map records: ${iaSources.length}`);
}

async function buildWikipediaCouncilElectionSources() {
  /** @type {WikiPage[]} */
  const members = [];
  /** @type {string | null} */
  let cmcontinue = null;
  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: WIKI_CATEGORY,
      cmnamespace: '0',
      cmlimit: '500',
      format: 'json',
      origin: '*'
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);
    // the query API's JSON
    const json = /** @type {WikiQueryJson} */ (await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`));
    members.push(...normalizeArray(json?.query?.categorymembers));
    cmcontinue = json?.continue?.cmcontinue || null;
  } while (cmcontinue);

  /** @type {WikiPage[]} */
  const pages = [];
  for (const chunk of chunks(members.map((member) => member.pageid).filter(Boolean), 50)) {
    const params = new URLSearchParams({
      action: 'query',
      pageids: chunk.join('|'),
      prop: 'info|pageimages',
      inprop: 'url',
      piprop: 'thumbnail|original',
      pithumbsize: '320',
      format: 'json',
      origin: '*'
    });
    // the query API's JSON
    const json = /** @type {WikiQueryJson} */ (await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`));
    pages.push(...Object.values(json?.query?.pages || {}));
  }

  return pages
    .filter((page) => page?.title)
    .sort((a, b) => String(a.title).localeCompare(String(b.title)))
    .map((page) => {
      const year = extractYear(page.title);
      // the filter kept only pages with a title
      const title = /** @type {string} */ (page.title);
      const url = page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
      return {
        id: `external:wikipedia:council-elections-roi:${slugify(title)}`,
        type: 'wikipedia-article',
        title,
        subtitle: compactJoin([year, 'Republic of Ireland council-election article']),
        category: 'Republic of Ireland council-election articles',
        date: year || null,
        provider: ['Wikipedia'],
        description: 'Wikipedia article listed under Council elections in the Republic of Ireland. Full article text remains on Wikipedia and is cited here as an external source.',
        url,
        thumbnail: page.thumbnail?.source ? {
          kind: 'external',
          url: page.original?.source || page.thumbnail.source,
          smallUrl: page.thumbnail.source,
          alt: `${title} thumbnail from Wikipedia`
        } : null,
        references: [
          {
            label: title,
            url,
            source: 'Wikipedia',
            role: 'article'
          },
          {
            label: WIKI_CATEGORY,
            url: WIKI_CATEGORY_URL,
            source: 'Wikipedia',
            role: 'category'
          }
        ],
        keywords: ['Wikipedia', 'Republic of Ireland', 'council elections', 'local elections', year].filter(Boolean)
      };
    });
}

async function buildInternetArchiveRasterMapSources() {
  const docs = await fetchInternetArchiveDocs();
  /** @type {Candidate[]} */
  const candidates = [];
  for (const doc of docs) {
    if (!isLikelyRasterMapDoc(doc)) continue;
    /** @type {IaMetadataJson | undefined} */
    let metadata;
    try {
      // the metadata API's JSON
      metadata = /** @type {IaMetadataJson} */ (await fetchJson(`${IA_METADATA}${encodeURIComponent(doc.identifier)}`));
    } catch (error) {
      // fetch and fetchJson throw Errors
      console.warn(`Skipping ${doc.identifier}: ${/** @type {Error} */ (error).message}`);
      continue;
    }
    const primaryFile = choosePrimaryRasterFile(metadata?.files || []);
    if (!primaryFile) continue;
    const itemUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
    const downloadUrl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodePathComponent(primaryFile.name)}`;
    const key = fileDedupeKey(primaryFile, doc);
    candidates.push({
      key,
      identifier: doc.identifier,
      title: cleanText(doc.title || metadata?.metadata?.title || doc.identifier),
      description: cleanText(stripHtml(doc.description || metadata?.metadata?.description || '')),
      date: extractYear(doc.date || metadata?.metadata?.date || doc.title || doc.identifier),
      itemSize: Number(doc.item_size || metadata?.item_size || 0) || null,
      itemUrl,
      file: compactObject({
        name: primaryFile.name,
        size: Number(primaryFile.size || 0) || null,
        format: primaryFile.format || null,
        md5: primaryFile.md5 || null,
        sha1: primaryFile.sha1 || null,
        url: downloadUrl
      }),
      thumbnail: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`
    });
  }

  /** @type {Map<string, Candidate[]>} */
  const grouped = new Map();
  for (const candidate of candidates) {
    if (!grouped.has(candidate.key)) grouped.set(candidate.key, []);
    // the key was set on the line before if it was missing
    /** @type {Candidate[]} */ (grouped.get(candidate.key)).push(candidate);
  }

  const records = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const primary = group[0];
    const extraTitles = group.slice(1).map((item) => item.title).filter((title) => title && title !== primary.title);
    records.push({
      id: `external:internet-archive-raster-map:${slugify(primary.identifier)}`,
      type: 'internet-archive-raster-map',
      title: primary.title,
      subtitle: compactJoin([primary.date, 'Internet Archive raster map']),
      category: 'Internet Archive raster maps',
      date: primary.date || null,
      provider: ['Internet Archive', IA_UPLOADER],
      description: compactJoin([
        'Large raster map image item uploaded to the Internet Archive. The Browse entry hotlinks the item and download URL; Civgraph does not store the raster image.',
        primary.description ? truncate(primary.description, 240) : null,
        extraTitles.length ? `Deduplicated duplicate image records: ${extraTitles.join('; ')}` : null
      ]),
      url: primary.itemUrl,
      thumbnail: {
        kind: 'external',
        url: primary.thumbnail,
        smallUrl: primary.thumbnail,
        alt: `${primary.title} thumbnail from Internet Archive`
      },
      references: group.map((item) => ({
        label: item.title,
        url: item.itemUrl,
        source: 'Internet Archive',
        role: item === primary ? 'item' : 'duplicate item'
      })),
      downloads: group.map((item) => ({
        label: item.file.name,
        url: item.file.url,
        type: item.file.format || fileExtension(item.file.name)
      })),
      keywords: unique(['Internet Archive', 'raster map', 'map scan', 'boundary map', primary.date, ...extractKeywords(primary.title)]),
      duplicateCount: group.length > 1 ? group.length : null,
      sourceItems: group.map((item) => compactObject({
        identifier: item.identifier,
        title: item.title,
        url: item.itemUrl,
        file: item.file
      }))
    });
  }
  return records.sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

/** @returns {Promise<IaDoc[]>} */
async function fetchInternetArchiveDocs() {
  /** @type {IaDoc[]} */
  const docs = [];
  let page = 1;
  const rows = 100;
  while (true) {
    const params = new URLSearchParams({
      q: `uploader:${IA_UPLOADER}`,
      'fl[]': 'identifier',
      rows: String(rows),
      page: String(page),
      output: 'json',
      sort: 'titleSorter asc'
    });
    for (const field of ['title', 'description', 'mediatype', 'date', 'publicdate', 'item_size']) {
      params.append('fl[]', field);
    }
    // the advanced-search API's JSON
    const json = /** @type {IaSearchJson} */ (await fetchJson(`${IA_ADVANCED_SEARCH}?${params.toString()}`));
    const batch = normalizeArray(json?.response?.docs);
    docs.push(...batch);
    if (batch.length < rows) break;
    page += 1;
  }
  return docs;
}

/** @param {IaDoc} doc */
function isLikelyRasterMapDoc(doc) {
  if (doc?.mediatype && doc.mediatype !== 'image') return false;
  const text = `${doc.identifier || ''} ${doc.title || ''} ${doc.description || ''}`.toLowerCase();
  if (/\b(crest|coat of arms|logo|watermark|thumbnail|profile|avatar)\b/.test(text)) return false;
  return /\b(map|maps|boundary|boundaries|ward|wards|district|districts|dea|deas|local government|lgd|electoral|constituenc|county|council|borough)\b/.test(text);
}

/**
 * @param {IaFile[]} files
 * @returns {IaFile | null}
 */
function choosePrimaryRasterFile(files) {
  const candidates = normalizeArray(files)
    .filter((file) => isRasterImageFile(file?.name))
    .filter((file) => !isDerivativeOrMetadataFile(file))
    .sort((a, b) => fileScore(b) - fileScore(a));
  return candidates[0] || null;
}

/** @param {unknown} name */
function isRasterImageFile(name) {
  return /\.(jpe?g|png|tiff?|jp2)$/i.test(String(name || ''));
}

/** @param {IaFile} file */
function isDerivativeOrMetadataFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (/(_files|_meta|_reviews|_archive|_scandata|_thumb|__ia_thumb|thumb|thumbnail)\./i.test(name)) return true;
  if (/\.(xml|json|txt|pdf|gif)$/i.test(name)) return true;
  return false;
}

/** @param {IaFile} file */
function fileScore(file) {
  const name = String(file?.name || '').toLowerCase();
  const size = Number(file?.size || 0) || 0;
  let score = size;
  if (file?.source === 'original') score += 1_000_000_000_000;
  if (/\.(tiff?|jp2)$/i.test(name)) score += 10_000_000_000;
  if (/\.(jpe?g|png)$/i.test(name)) score += 1_000_000_000;
  return score;
}

/**
 * @param {IaFile} file
 * @param {IaDoc} doc
 */
function fileDedupeKey(file, doc) {
  if (file.md5) return `md5:${file.md5}`;
  if (file.sha1) return `sha1:${file.sha1}`;
  const size = Number(file.size || 0) || Number(doc.item_size || 0) || 0;
  return `size-title:${size}:${normalizeName(doc.title || doc.identifier)}`;
}

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function fetchJson(url) {
  const response = await fetch(url, {
    // The site's User-Agent to Wikipedia only; none to archive.org.
    headers: crawlHeaders({ Accept: 'application/json' }, { url })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

/** @param {SourceRecord} record */
function stableRecord(record) {
  return compactObject({
    id: record.id,
    type: record.type,
    title: record.title,
    subtitle: record.subtitle,
    category: record.category,
    date: record.date,
    provider: record.provider,
    description: record.description,
    url: record.url,
    thumbnail: record.thumbnail,
    references: record.references,
    downloads: record.downloads,
    keywords: record.keywords,
    duplicateCount: record.duplicateCount,
    sourceItems: record.sourceItems,
    license: record.license
  });
}

/**
 * @template T
 * @param {T[]} values
 * @param {number} size
 */
function chunks(values, size) {
  /** @type {T[][]} */
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

/**
 * @template T
 * @param {T | T[] | null | undefined} value
 * @returns {NonNullable<T>[]}
 */
function normalizeArray(value) {
  // the filter drops null and undefined (and '')
  if (Array.isArray(value)) return /** @type {NonNullable<T>[]} */ (value.filter((item) => item !== null && item !== undefined && item !== ''));
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

/** @param {unknown[]} parts */
function compactJoin(parts) {
  return normalizeArray(parts)
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .map(cleanText)
    .join(' / ') || null;
}

/**
 * @template {object} T
 * @param {T} object
 * @returns {{ [K in keyof T]?: NonNullable<T[K]> }}
 */
function compactObject(object) {
  /** @type {Record<string, unknown>} */
  const output = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  // object's own fields, less the empty ones
  return /** @type {{ [K in keyof T]?: NonNullable<T[K]> }} */ (output);
}

/** @param {unknown[]} values */
function unique(values) {
  return [...new Set(normalizeArray(values).map((value) => cleanText(value)).filter(Boolean))];
}

/** @param {unknown} value */
function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** @param {unknown} value */
function stripHtml(value) {
  return cleanText(String(value || '').replace(/<[^>]*>/g, ' '));
}

/**
 * @param {unknown} value
 * @param {number} length
 */
function truncate(value, length) {
  const text = cleanText(value);
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trim()}...`;
}

/** @param {unknown} value */
function extractYear(value) {
  const match = String(value || '').match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/** @param {unknown} value */
function extractKeywords(value) {
  const text = normalizeName(value);
  const keywords = [];
  for (const keyword of ['ward', 'district', 'local government', 'electoral', 'boundary', 'council', 'county', 'map']) {
    if (text.includes(keyword)) keywords.push(keyword);
  }
  const year = extractYear(value);
  if (year) keywords.push(String(year));
  return keywords;
}

/** @param {unknown} value */
function fileExtension(value) {
  const match = String(value || '').match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match ? match[1].toLowerCase() : null;
}

/** @param {unknown} value */
function encodePathComponent(value) {
  return String(value || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

/** @param {unknown} value */
function normalizeName(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** @param {unknown} value */
function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}
