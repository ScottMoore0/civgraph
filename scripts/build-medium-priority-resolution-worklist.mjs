#!/usr/bin/env node
/**
 * Step-1 (read-only research) output builder for the still-unpublished
 * medium-priority buckets. Resolves each enrich/variant row to its best target
 * in the LIVE Civgraph corpora (elections, maps, browse sources) with a
 * confidence tier + method, flags the enrich-election misclassifications, and
 * triages the conversion buckets by format + likely-duplicate boundary family.
 *
 * Deterministic + offline (no network). The live data.gov.ie CKAN probe evidence
 * (stale-URL rate, licence variance) is recorded in the sibling README, not here.
 *
 * Usage: node scripts/build-medium-priority-resolution-worklist.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'data', 'review-inputs', 'medium-priority-publication-prep-2026-06-25', 'row-staging-records.json');
const OUT_DIR = path.join(ROOT, 'data', 'review-inputs', 'medium-priority-resolution-2026-07-08');
mkdirSync(OUT_DIR, { recursive: true });

const rows = JSON.parse(readFileSync(SRC, 'utf8'));

// ---- live target corpora ----
const elections = JSON.parse(readFileSync(path.join(ROOT, 'data', 'browse', 'elections.json'), 'utf8')).items || [];
const mapsRaw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'database', 'maps.json'), 'utf8'));
const maps = Array.isArray(mapsRaw) ? mapsRaw : (mapsRaw.maps || mapsRaw.items || Object.values(mapsRaw).find(Array.isArray));
const srcIdx = JSON.parse(readFileSync(path.join(ROOT, 'data', 'browse', 'sources.json'), 'utf8'));
const sources = [];
for (const sh of (srcIdx.shards || [])) {
  sources.push(...JSON.parse(readFileSync(path.join(ROOT, sh.url.replace(/^\//, '')), 'utf8')).items);
}
const srcByUrl = new Map();
for (const s of sources) for (const r of (s.references || [])) if (r.url) srcByUrl.set(r.url.replace(/\/+$/, ''), s);
const gate = JSON.parse(readFileSync(path.join(ROOT, 'data', 'database', 'approved-publication-sources.json'), 'utf8'));
for (const s of gate.sources) for (const r of (s.references || [])) if (r.url) { const u = r.url.replace(/\/+$/, ''); if (!srcByUrl.has(u)) srcByUrl.set(u, { id: s.id, title: s.title }); }

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'for', 'details', 'data', 'dataset', 'of', 'by', 'county', 'ireland']);
const toks = s => new Set(norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
const jac = (a, b) => { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return +(i / (A.size + B.size - i)).toFixed(3); };
const yearsOf = s => (String(s).match(/\b(1[89]\d\d|20\d\d)\b/g) || []);
const tier = (score, corroborated) => (corroborated || score >= 0.6) ? 'high' : score >= 0.4 ? 'medium' : score >= 0.25 ? 'low' : 'none';
const bestBy = (title, corpus, key) => { let best = null, bs = 0; for (const c of corpus) { const s = jac(title, c[key] || c.name || c.title); if (s > bs) { bs = s; best = c; } } return { best, score: bs }; };

// Word-boundaried so "daily"/"dailywork" don't match "Dail" — the exact
// tokenization bug ("daily" -> "Dail") that mis-bucketed weather/stats rows as
// elections in the prep pack. A row is a real election dataset only with a
// genuine election-event token, not bare "electoral"/"poll".
const ELECTION_KW = /\belection|\bd[aá]il\b|\bseanad\b|first preference|\bconstituenc|\bcandidate|referend|by-?election/i;

const write = (name, obj) => writeFileSync(path.join(OUT_DIR, name), JSON.stringify(obj, null, 2) + '\n');
const summary = { generatedAt: '2026-07-08', source: path.relative(ROOT, SRC), buckets: {} };

// ---- enrich-existing-election ----
{
  const b = rows.filter(r => r.proposedAction === 'enrich-existing-election');
  const out = b.map(r => {
    const url = (r.currentProviderUrl || '').replace(/\/+$/, '');
    const isElection = ELECTION_KW.test(r.title || '');
    const yrs = yearsOf(r.title);
    const isEuro = /europ/i.test(r.title), isLocal = /local elect|council elect/i.test(r.title), isSeanad = /seanad/i.test(r.title);
    let cands = elections.filter(e => yrs.includes(String(e.year || yearsOf(e.date)[0] || '')));
    if (isEuro) cands = cands.filter(e => /europ/i.test(e.title + e.body));
    else if (isLocal) cands = cands.filter(e => /local|council/i.test(e.title + e.body));
    else if (isSeanad) cands = cands.filter(e => /seanad/i.test(e.title + e.body));
    else cands = cands.filter(e => /general|d[aá]il/i.test(e.title + e.body));
    const { best, score } = bestBy(r.title, cands.length ? cands : elections, 'title');
    const corroborated = !!(best && yrs.length && score >= 0.3 && cands.length);
    return {
      rowId: r.id, title: r.title, providerUrl: url, waybackUrl: r.waybackUrl || null,
      classification: isElection ? 'election' : 'MISCLASSIFIED-non-election',
      proposedTarget: (isElection && best) ? { id: best.id, title: best.title, date: best.date } : null,
      score, method: cands.length ? 'year+type+title' : 'title-only',
      confidenceTier: isElection ? tier(score, corroborated) : 'none-reroute'
    };
  });
  write('enrich-existing-election-worklist.json', { note: 'enrich-election resolution. MISCLASSIFIED rows were snagged by a daily->Dail false match and are NOT elections; re-route to source-download/stats or drop.', items: out });
  const real = out.filter(o => o.classification === 'election');
  summary.buckets['enrich-existing-election'] = { total: b.length, realElection: real.length, misclassified: b.length - real.length, high: real.filter(o => o.confidenceTier === 'high').length, medium: real.filter(o => o.confidenceTier === 'medium').length, lowOrNone: real.filter(o => ['low', 'none'].includes(o.confidenceTier)).length };
}

// ---- enrich-existing-source ----
{
  const b = rows.filter(r => r.proposedAction === 'enrich-existing-source');
  const out = b.map(r => {
    const url = (r.currentProviderUrl || '').replace(/\/+$/, '');
    const urlHit = srcByUrl.get(url);
    if (urlHit) return { rowId: r.id, title: r.title, providerUrl: url, proposedTarget: { id: urlHit.id, title: urlHit.title }, score: 1, method: 'url-exact', confidenceTier: 'high' };
    const { best, score } = bestBy(r.title, sources, 'title');
    return { rowId: r.id, title: r.title, providerUrl: url, waybackUrl: r.waybackUrl || null, proposedTarget: best ? { id: best.id, title: best.title } : null, score, method: 'title', confidenceTier: tier(score, false) };
  });
  write('enrich-existing-source-worklist.json', { note: 'enrich-source resolution against the live browse source corpus. Exact-title matches are reliable targets; confirm each enrichment ADDS provenance vs. the existing record before attaching.', items: out });
  summary.buckets['enrich-existing-source'] = { total: b.length, high: out.filter(o => o.confidenceTier === 'high').length, medium: out.filter(o => o.confidenceTier === 'medium').length, lowOrNone: out.filter(o => ['low', 'none'].includes(o.confidenceTier)).length };
}

// ---- variant-child-map ----
{
  const b = rows.filter(r => r.proposedAction === 'variant-child-map');
  const out = b.map(r => {
    const { best, score } = bestBy(r.cleanTitle || r.title, maps, 'name');
    return { rowId: r.id, title: r.cleanTitle || r.title, provider: r.provider, waybackUrl: r.waybackUrl || null, proposedParent: best ? { id: best.id, name: best.name, slug: best.slug } : null, score, method: 'name', confidenceTier: tier(score, false) };
  });
  write('variant-child-map-worklist.json', { note: 'variant-child parent resolution against maps.json. none-tier rows have no on-site parent (new map or blocked on parent).', items: out });
  summary.buckets['variant-child-map'] = { total: b.length, high: out.filter(o => o.confidenceTier === 'high').length, medium: out.filter(o => o.confidenceTier === 'medium').length, noParent: out.filter(o => o.confidenceTier === 'none').length };
}

// ---- conversion feasibility: new-interactive-map + hold-special-format ----
{
  const cls = (fmts) => {
    const f = (Array.isArray(fmts) ? fmts.join('+') : String(fmts || '')).toUpperCase();
    if (/GEOJSON|GPKG|GEOPACKAGE|SHAPEFILE|\bSHP\b|SHP\.ZIP|\.SHP/.test(f)) return 'vector-direct';
    if (/\bGDB\b|GEODATABASE/.test(f)) return 'vector-gdb';
    if (/TIFF|\bTIF\b|COG|JPEG|\bJPG\b|\bPNG\b/.test(f)) return 'raster';
    if (/\bLAS\b|LAZ|POINT ?CLOUD|E57/.test(f)) return 'pointcloud';
    if (/KML|KMZ|WFS|WMS|ESRI REST|FEATURE SERVICE|ARCGIS/.test(f)) return 'vector-service';
    return 'non-spatial';
  };
  const DUP_BOUNDARY = /statutory boundar|electoral boundar|administrative area|constituency boundar|electoral division|townland|barony|baronies|local government district/i;
  const conv = {};
  for (const action of ['new-interactive-map', 'hold-special-format']) {
    const b = rows.filter(r => r.proposedAction === action);
    const items = b.map(r => ({ rowId: r.id, title: r.title, providerUrl: r.currentProviderUrl || null, waybackUrl: r.waybackUrl || null, formatClass: cls(r.formats), likelyDuplicateBoundaryFamily: DUP_BOUNDARY.test(r.title || '') }));
    const byClass = {}; for (const i of items) byClass[i.formatClass] = (byClass[i.formatClass] || 0) + 1;
    conv[action] = { total: b.length, byFormatClass: byClass, likelyDuplicateBoundaryFamily: items.filter(i => i.likelyDuplicateBoundaryFamily).length, withWaybackFallback: items.filter(i => i.waybackUrl).length, items };
    summary.buckets[action] = { total: b.length, convertibleVector: (byClass['vector-direct'] || 0) + (byClass['vector-gdb'] || 0) + (byClass['vector-service'] || 0), raster: byClass['raster'] || 0, pointcloud: byClass['pointcloud'] || 0, nonSpatial: byClass['non-spatial'] || 0, likelyDuplicateBoundaryFamily: conv[action].likelyDuplicateBoundaryFamily };
  }
  write('conversion-feasibility.json', { note: 'Format triage + dedup/wayback flags for the map/special-format buckets. See README for live data.gov.ie CKAN probe evidence (stale-URL rate + licence variance).', buckets: conv });
}

write('summary.json', summary);
console.log('resolution worklists written to', path.relative(ROOT, OUT_DIR));
console.log(JSON.stringify(summary, null, 2));
