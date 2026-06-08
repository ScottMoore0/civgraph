#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixText, normalizeName, parseNumber } from '../js/election-domain.mjs';

const ROOT = process.cwd();
const DAIL_ROOT = path.join(ROOT, 'election-viewer-package', 'data', 'elections', 'dail-eireann');
const OUT_ROOT = path.join(ROOT, 'data', 'elections', 'dail-wikipedia-counts');
const REPORT_PATH = path.join(OUT_ROOT, '_report.json');
const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const REQUEST_DELAY_MS = Number(valueAfter('--delay-ms') || 800);
const RETRY_DELAYS_MS = [3000, 8000, 15000];
const NO_TRANSFER_PATH = path.join(OUT_ROOT, '_no-transfer.json');
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

const args = new Set(process.argv.slice(2));
const onlyDate = valueAfter('--date');
const onlyConstituency = valueAfter('--constituency');
const limit = Number(valueAfter('--limit') || 0);

const PAGE_TITLE_ALIASES = new Map([
  ['tipperary mid north south', 'Tipperary Mid, North and South'],
  ['cork east north east', 'Cork East and North East'],
  ['cork mid north south south east west', 'Cork Mid, North, South, South East and West'],
  ['clare galway south', 'Clare-South Galway'],
  ['cork city north', 'Cork City North-West'],
  ['cork city south', 'Cork City South-East'],
  ['cork north central', 'Cork North-Central'],
  ['cork south central', 'Cork South-Central'],
  ['dublin north central', 'Dublin North-Central'],
  ['dublin south central', 'Dublin South-Central'],
  ['dublin mid west', 'Dublin Mid-West'],
  ['dublin north east', 'Dublin North-East'],
  ['dublin south east', 'Dublin South-East'],
  ['dublin south west', 'Dublin South-West'],
  ['dublin north west', 'Dublin North-West'],
  ['dun laoghaire rathdown', 'D\u00fan Laoghaire and Rathdown'],
  ['dun laoghaire and rathdown', 'D\u00fan Laoghaire and Rathdown'],
  ['cavan monaghan', 'Cavan-Monaghan'],
  ['carlow kilkenny', 'Carlow-Kilkenny'],
  ['donegal leitrim', 'Donegal-Leitrim'],
  ['galway east', 'Galway East'],
  ['kerry limerick west', 'Kerry-Limerick West'],
  ['leitrim roscommon north', 'Leitrim-Roscommon North'],
  ['kerry north limerick west', 'Kerry North-West Limerick'],
  ['leix offaly', 'Laois-Offaly'],
  ['laoighis offaly', 'Laois-Offaly'],
  ['laois offaly', 'Laois-Offaly'],
  ['longford westmeath', 'Longford-Westmeath'],
  ['roscommon galway', 'Roscommon-Galway'],
  ['roscommon leitrim', 'Roscommon-Leitrim'],
  ['roscommon leitrim south', 'Roscommon-South Leitrim'],
  ['mayo south roscommon south', 'Mayo South-Roscommon South'],
  ['sligo mayo east', 'Sligo-Mayo East'],
  ['sligo leitrim', 'Sligo-Leitrim'],
  ['sligo leitrim north', 'Sligo-North Leitrim'],
  ['waterford tipperary east', 'Waterford-Tipperary East'],
  ['national univeristy', 'National University of Ireland'],
  ['national university', 'National University of Ireland'],
  ['wicklow wexford3', 'Wicklow-Wexford']
]);

const NON_DAIL_CONSTITUENCY_TITLE_ALIASES = new Map([
  ['dublin university', 'Dublin University'],
  ['national univeristy', 'National University of Ireland'],
  ['national university', 'National University of Ireland']
]);

async function main() {
  if (!existsSync(DAIL_ROOT)) {
    throw new Error(`Dail source root is missing: ${DAIL_ROOT}`);
  }
  mkdirSync(OUT_ROOT, { recursive: true });

  const targets = loadTargets();
  const limitedTargets = limit > 0 ? targets.slice(0, limit) : targets;
  const noTransferRecords = loadNoTransferRecords();
  if (args.has('--report-only')) {
    const existingTargets = limitedTargets.filter((target) => targetIsRepresented(target, noTransferRecords));
    const missingTargets = limitedTargets.filter((target) => !targetIsRepresented(target, noTransferRecords));
    writeJson(REPORT_PATH, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      reportOnly: true,
      totalTargets: limitedTargets.length,
      existingSidecars: existingTargets.length,
      noTransferRecords: limitedTargets.filter((target) => noTransferRecords.has(targetKey(target))).length,
      pendingTargets: missingTargets.length,
      pages: 0,
      written: 0,
      unmatched: missingTargets.map((target) => ({
        date: target.date,
        constituency: target.constituency,
        file: target.file,
        reason: 'No local Wikipedia count-table sidecar'
      })),
      errors: []
    });
    console.log(`Dail Wikipedia count import report: represented ${existingTargets.length}/${limitedTargets.length} local sidecars; missing ${missingTargets.length}.`);
    return;
  }
  const existingTargets = args.has('--force')
    ? []
    : limitedTargets.filter((target) => targetIsRepresented(target, noTransferRecords));
  const pendingTargets = args.has('--force')
    ? limitedTargets
    : limitedTargets.filter((target) => !targetIsRepresented(target, noTransferRecords));
  const pages = new Map();
  for (const target of pendingTargets) {
    const title = wikipediaPageTitle(target.constituency, target.date);
    if (!pages.has(title)) pages.set(title, []);
    pages.get(title).push(target);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalTargets: limitedTargets.length,
    existingSidecars: existingTargets.length,
    noTransferRecords: limitedTargets.filter((target) => noTransferRecords.has(targetKey(target))).length,
    pendingTargets: pendingTargets.length,
    pages: pages.size,
    written: 0,
    unmatched: [],
    errors: []
  };

  for (const [title, pageTargets] of pages) {
    let page;
    try {
      page = await fetchWikipediaWikitext(wikipediaPageTitleCandidates(pageTargets[0]?.constituency || title, pageTargets[0]?.date));
      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      report.errors.push({ title, error: error.message });
      continue;
    }
    if (!page?.wikitext) {
      report.errors.push({ title, error: 'No wikitext returned' });
      continue;
    }
    const sections = parseElectionSections(page.wikitext);
    for (const target of pageTargets) {
      const section = matchSection(sections, target.date);
      if (!section) {
        report.unmatched.push({
          date: target.date,
          constituency: target.constituency,
          pageTitle: page.title || title,
          reason: 'No matching STV general-election section'
        });
        continue;
      }
      const sidecar = buildSidecar(target, page, section);
      if (!sidecar.candidates.length || sidecar.numCounts < 2) {
        report.unmatched.push({
          date: target.date,
          constituency: target.constituency,
          pageTitle: page.title || title,
          sectionTitle: section.title,
          reason: 'Matched section has no multi-count candidate table'
        });
        continue;
      }
      const outputDir = path.join(OUT_ROOT, target.date);
      mkdirSync(outputDir, { recursive: true });
      writeJson(path.join(outputDir, target.file), sidecar);
      report.written += 1;
    }
  }

  writeJson(REPORT_PATH, report);
  const represented = report.existingSidecars + report.written;
  console.log(`Dail Wikipedia count import: represented ${represented}/${report.totalTargets} sidecars (${report.written} new); unmatched ${report.unmatched.length}; errors ${report.errors.length}.`);
  if (args.has('--fail-on-unmatched') && (report.unmatched.length || report.errors.length)) {
    process.exitCode = 1;
  }
}

function sidecarPathForTarget(target) {
  return path.join(OUT_ROOT, target.date, target.file);
}

function targetKey(target) {
  return `${target.date}/${target.file}`;
}

function targetIsRepresented(target, noTransferRecords = new Map()) {
  return existsSync(sidecarPathForTarget(target)) || noTransferRecords.has(targetKey(target));
}

function loadNoTransferRecords() {
  if (!existsSync(NO_TRANSFER_PATH)) return new Map();
  const data = readJson(NO_TRANSFER_PATH);
  const records = Array.isArray(data?.records) ? data.records : [];
  const map = new Map();
  for (const record of records) {
    if (record?.date && record?.file) map.set(`${record.date}/${record.file}`, record);
  }
  return map;
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function loadTargets() {
  const targets = [];
  const dateDirs = readdirSync(DAIL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => String(b).localeCompare(String(a)));
  for (const date of dateDirs) {
    if (onlyDate && date !== onlyDate) continue;
    const dir = path.join(DAIL_ROOT, date);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && name !== '_index.json').sort()) {
      const raw = readJson(path.join(dir, file));
      const constituency = fixText(raw?.constituency || file.replace(/\.json$/, '').replace(/-/g, ' '));
      if (onlyConstituency && normalizeName(constituency) !== normalizeName(onlyConstituency)) continue;
      targets.push({ date, file, constituency });
    }
  }
  return targets;
}

function wikipediaPageTitle(constituency, date = '') {
  return wikipediaPageTitleCandidates(constituency, date)[0];
}

function wikipediaPageTitleCandidates(constituency, date = '') {
  const base = normalizeConstituencySourceName(constituency);
  const year = Number(String(date || '').slice(0, 4));
  const dateAwareAlias = normalizeName(base) === 'limerick' && year >= 2016 ? 'Limerick County' : '';
  const nonDailAlias = NON_DAIL_CONSTITUENCY_TITLE_ALIASES.get(normalizeName(base));
  const aliases = [
    dateAwareAlias,
    PAGE_TITLE_ALIASES.get(normalizeName(base)),
    hyphenateCompassTitle(base),
    hyphenateCountyPairTitle(base),
    base
  ].filter(Boolean);
  const titleCandidates = [];
  if (nonDailAlias) {
    titleCandidates.push(`${nonDailAlias} (constituency)`);
  }
  for (const title of unique(aliases)) {
    titleCandidates.push(`${title} (D\u00e1il constituency)`);
    titleCandidates.push(title);
    titleCandidates.push(`${title} (constituency)`);
  }
  return unique(titleCandidates);
}

function hyphenateCompassTitle(value) {
  return String(value || '')
    .replace(/\b(North|South|East|West|Mid) (Central|East|West|North|South)\b/gi, '$1-$2')
    .replace(/\bDun Laoghaire Rathdown\b/i, 'D\u00fan Laoghaire and Rathdown')
    .trim();
}

function normalizeConstituencySourceName(value) {
  return fixText(String(value || '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/\bDun Laoghaire\b/i, 'D\u00fan Laoghaire')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim());
}

function hyphenateCountyPairTitle(value) {
  const words = String(value || '').trim().split(/\s+/);
  if (words.length !== 2) return '';
  if (/\b(North|South|East|West|Mid|City|County)\b/i.test(words.join(' '))) return '';
  return `${words[0]}-${words[1]}`;
}

async function fetchWikipediaWikitext(titleOrTitles) {
  const titles = Array.isArray(titleOrTitles) ? titleOrTitles : [titleOrTitles];
  let lastError = null;
  for (const title of titles) {
    try {
      return await fetchSingleWikipediaWikitext(title);
    } catch (error) {
      lastError = error;
      if (!/doesn't exist/i.test(error.message)) throw error;
    }
  }
  throw lastError || new Error('No Wikipedia title candidates were supplied');
}

async function fetchSingleWikipediaWikitext(title) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', title);
  url.searchParams.set('prop', 'wikitext');
  url.searchParams.set('format', 'json');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('origin', '*');
  let response;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Civgraph test2 Dail count importer (local build script)'
      }
    });
    if (response.status !== 429) break;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const delay = retryAfter > 0 ? retryAfter * 1000 : RETRY_DELAYS_MS[attempt] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    await sleep(delay);
  }
  if (!response.ok) throw new Error(`Wikipedia API ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.info || json.error.code || 'Wikipedia API error');
  const wikitext = json.parse?.wikitext?.['*'];
  return {
    title: json.parse?.title || title,
    pageid: json.parse?.pageid || null,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(json.parse?.title || title).replace(/ /g, '_')).replace(/%2F/g, '/')}`,
    wikitext
  };
}

function unique(values) {
  return [...new Set(values)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseElectionSections(wikitext) {
  const headings = [...wikitext.matchAll(/^={3,}\s*([^=\n]+?)\s*=+\s*$/gm)];
  const sections = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = cleanWikitext(heading[1]);
    if (!/\bgeneral election\b/i.test(title)) continue;
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? wikitext.length;
    const block = wikitext.slice(start, end);
    const beginTemplate = extractTemplates(block, 'STV Election box begin')[0];
    const beginFields = beginTemplate ? parseTemplateFields(beginTemplate.source) : new Map();
    const numCounts = parseNumber(beginFields.get('numcounts')) || inferNumCounts(block);
    const candidates = extractTemplates(block, 'STV Election box candidate')
      .map((template, candidateIndex) => parseCandidateTemplate(template.source, candidateIndex, numCounts))
      .filter((candidate) => candidate.name && candidate.counts.some((value) => value !== null));
    if (!candidates.length) continue;
    sections.push({
      title,
      beginTitle: cleanWikitext(beginFields.get('title') || ''),
      year: extractYear(`${title} ${beginFields.get('title') || ''}`),
      month: extractMonth(`${title} ${beginFields.get('title') || ''}`),
      numCounts,
      candidates
    });
  }
  return sections;
}

function inferNumCounts(block) {
  const matches = [...block.matchAll(/\|\s*count(\d+)\s*=/gi)].map((match) => Number(match[1])).filter(Number.isFinite);
  return Math.max(1, ...matches);
}

function matchSection(sections, date) {
  const year = Number(String(date).slice(0, 4));
  const month = MONTHS[Number(String(date).slice(5, 7)) - 1] || '';
  const candidates = sections.filter((section) => section.year === year);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const monthMatch = candidates.find((section) => section.month === month);
  return monthMatch || candidates[0];
}

function parseCandidateTemplate(source, index, numCounts) {
  const fields = parseTemplateFields(source);
  const counts = [];
  const countRaw = [];
  for (let count = 1; count <= numCounts; count += 1) {
    const raw = fields.get(`count${count}`) || '';
    countRaw.push(raw);
    counts.push(parseCountValue(raw));
  }
  const electedAt = countRaw.findIndex((raw) => /'''/.test(String(raw))) + 1 || null;
  const lastCount = lastNonNullIndex(counts) + 1 || null;
  return {
    id: String(index + 1),
    name: cleanWikitext(fields.get('candidate') || ''),
    party: cleanWikitext(fields.get('party') || fields.get('party1') || 'Independent'),
    percentage: parseNumber(fields.get('percentage')),
    counts,
    electedAt,
    lastCount,
    status: electedAt ? 'Elected' : (lastCount && lastCount < numCounts ? 'Excluded' : 'Not Elected')
  };
}

function buildSidecar(target, page, section) {
  return {
    schemaVersion: 1,
    source: 'Wikipedia',
    pageTitle: page.title,
    pageId: page.pageid,
    pageUrl: page.url,
    sectionTitle: section.title,
    electionDate: target.date,
    constituency: target.constituency,
    numCounts: section.numCounts,
    importedAt: new Date().toISOString(),
    candidates: section.candidates
  };
}

function extractTemplates(text, prefix) {
  const templates = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('{{', index);
    if (start < 0) break;
    let depth = 0;
    let cursor = start;
    for (; cursor < text.length - 1; cursor += 1) {
      if (text[cursor] === '{' && text[cursor + 1] === '{') {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (text[cursor] === '}' && text[cursor + 1] === '}') {
        depth -= 1;
        cursor += 1;
        if (depth === 0) break;
      }
    }
    if (depth === 0) {
      const source = text.slice(start, cursor + 1);
      const name = templateName(source);
      if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
        templates.push({ name, source });
      }
      index = cursor + 1;
    } else {
      break;
    }
  }
  return templates;
}

function templateName(source) {
  const inner = source.replace(/^\{\{/, '').replace(/\}\}$/, '');
  return inner.split('|')[0].trim();
}

function parseTemplateFields(source) {
  const inner = source.replace(/^\{\{/, '').replace(/\}\}$/, '');
  const parts = splitWikitextTemplate(inner);
  const fields = new Map();
  for (const part of parts.slice(1)) {
    const equals = topLevelEqualsIndex(part);
    if (equals < 0) continue;
    const key = part.slice(0, equals).trim().toLowerCase();
    const value = part.slice(equals + 1).trim();
    if (key) fields.set(key, value);
  }
  return fields;
}

function splitWikitextTemplate(text) {
  const parts = [];
  let current = '';
  let braceDepth = 0;
  let linkDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '{' && next === '{') {
      braceDepth += 1;
      current += '{{';
      index += 1;
      continue;
    }
    if (char === '}' && next === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      current += '}}';
      index += 1;
      continue;
    }
    if (char === '[' && next === '[') {
      linkDepth += 1;
      current += '[[';
      index += 1;
      continue;
    }
    if (char === ']' && next === ']') {
      linkDepth = Math.max(0, linkDepth - 1);
      current += ']]';
      index += 1;
      continue;
    }
    if (char === '|' && braceDepth === 0 && linkDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function topLevelEqualsIndex(text) {
  let braceDepth = 0;
  let linkDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '{' && next === '{') {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (char === '}' && next === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }
    if (char === '[' && next === '[') {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (char === ']' && next === ']') {
      linkDepth = Math.max(0, linkDepth - 1);
      index += 1;
      continue;
    }
    if (char === '=' && braceDepth === 0 && linkDepth === 0) return index;
  }
  return -1;
}

function cleanWikitext(value) {
  return fixText(String(value ?? '')
    .replace(/<ref\b[^/>]*\/>/gi, ' ')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/\{\{cref\|[^}]*\}\}/gi, ' ')
    .replace(/\{\{nowrap\|([\s\S]*?)\}\}/gi, '$1')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function parseCountValue(value) {
  const text = cleanWikitext(value);
  if (!text || /^[-\u2013\u2014]$/.test(text)) return null;
  return parseNumber(text);
}

function extractYear(value) {
  const match = String(value || '').match(/\b(18|19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractMonth(value) {
  const text = normalizeName(value);
  return MONTHS.find((month) => text.includes(month)) || null;
}

function lastNonNullIndex(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && values[index] !== undefined) return index;
  }
  return -1;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
