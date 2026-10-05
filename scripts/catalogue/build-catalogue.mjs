#!/usr/bin/env node
/**
 * Build the rebuilt catalogue's client data from its curated source and the site's own records.
 *
 *   node scripts/catalogue/build-catalogue.mjs [--check]
 *
 * Inputs
 *   data/catalogue/catalogue.source.json   the arrangement: shelves, subjects, series (curated)
 *   scripts/catalogue/records.mjs          every map the site can load: maps.json, the renderer's
 *                                          own layers (maps-test.json), census statistics
 *   render/metadata/maps-test-index.json   per-layer bounds, geometry type, renderer
 *   assets/thumbnails/manifest.json        which thumbnails exist
 *   data/database/spatial-index.json       named features with their bounding boxes
 *   render/metadata/elections-test2.json   every election
 *   src/ui-controller.js                   the current pane's card ids, for redirects only
 * Outputs
 *   data/catalogue/catalogue.json          what the pane loads: arrangement + derived fields
 *   data/catalogue/places.json             place names -> maps, loaded when a search needs it
 *   data/catalogue/people.json             everyone who stood, for person search, loaded likewise
 *
 * Nothing the pane shows is typed twice. A series' years come from its maps' dates, its
 * jurisdiction from its scope, an edition's label from its date, a thumbnail only from a file
 * that exists. With --check it builds in memory and fails if the files on disk differ.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRecords } from './records.mjs';

const ROOT = process.cwd();
const rel = (p) => path.join(ROOT, p);
const read = (p) => JSON.parse(readFileSync(rel(p), 'utf8'));
const CHECK = process.argv.includes('--check');

const source = read('data/catalogue/catalogue.source.json');
const { records: mapById, parts: partsOf } = loadRecords(ROOT);
const layerIndex = read('render/metadata/maps-test-index.json').layers || [];
const thumbs = new Set(read('assets/thumbnails/manifest.json'));
const spatial = read('data/database/spatial-index.json');
const elections = read('render/metadata/elections-test2.json').elections || [];

// ------------------------------------------------------------------ per map
const layerBySource = new Map();
for (const l of layerIndex) if (l.sourceMapId && !layerBySource.has(l.sourceMapId)) layerBySource.set(l.sourceMapId, l);

const YEAR = /(1[5-9]\d\d|20\d\d)/;
function dateOf(m) {
  const d = String(m.dateEffective || m.date || '').trim();
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)) return d;
  const y = YEAR.exec(d) || YEAR.exec(`${m.id} ${m.name}`);
  return y ? y[1] : '';
}
const round = (n) => Math.round(n * 1e4) / 1e4;
function boundsOf(m) {
  // A census statistic is drawn on its geography, so it covers what that map covers.
  if (m.origin === 'data' && m.geography && mapById.has(m.geography)) return boundsOf(mapById.get(m.geography));
  const b = layerBySource.get(m.id)?.bounds || m.bounds;
  if (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)) return b.map(round);
  if (!Array.isArray(b) || b.length !== 2) return null;
  const [[s, w], [n, e]] = b;
  if (![s, w, n, e].every(Number.isFinite)) return null;
  return [round(Math.min(w, e)), round(Math.min(s, n)), round(Math.max(w, e)), round(Math.max(s, n))];
}
function thumbOf(m) {
  for (const id of [m.id, m.cloneOf, m.parentId, m.variants?.[0]?.id, partsOf.get(m.id)?.[0]?.id, m.geography]) if (id && thumbs.has(id)) return id;
  return null;
}
const statusOf = (m) => (m.placeholder ? 'placeholder' : m.incomplete ? 'incomplete' : 'ready');
const providers = (m) => (Array.isArray(m.provider) ? m.provider : m.provider ? [m.provider] : []).map(String);
const licenceOf = (m) => m.licence || m.license || '';

// A part is named by what sets it apart from its parent: "NI LiDAR 1 m — Ballycastle (2010)" -> "Ballycastle (2010)".
function shortPart(label, parentName) {
  const l = String(label || '');
  const head = l.split(/\s+[—–]\s+/);
  if (head.length > 1 && parentName && parentName.toLowerCase().startsWith(head[0].toLowerCase())) return head.slice(1).join(' — ');
  return l;
}
// Labels that all open the same way lose it: "NI LiDAR 1 m — Ballycastle (2010)" -> "Ballycastle (2010)".
function dropSharedPrefix(items) {
  if (items.length < 2) return items;
  const parts = items.map((x) => x.label.split(/\s+[—–]\s+/));
  let k = 0;
  while (parts.every((p) => p.length > k + 1 && p[k] === parts[0][k])) k += 1;
  return k ? items.map((x, i) => ({ ...x, label: parts[i].slice(k).join(' — ') })) : items;
}
const out = { maps: {} };
function addMap(id) {
  if (out.maps[id]) return out.maps[id];
  const m = mapById.get(id);
  const layer = layerBySource.get(id);
  const rec = {
    name: m.name,
    date: dateOf(m),
    status: statusOf(m),
  };
  const p = providers(m);
  if (p.length) rec.provider = p;
  const t = thumbOf(m);
  if (t) rec.thumb = t;
  const b = boundsOf(m);
  if (b) rec.bounds = b;
  if (m.featureCount) rec.features = m.featureCount;
  if (layer?.geometryType) rec.geometry = layer.geometryType;
  if (m.description) rec.description = String(m.description).slice(0, 600);
  if (m.changeNote) rec.note = String(m.changeNote).slice(0, 300);
  if (licenceOf(m)) rec.licence = licenceOf(m);
  if (m.files?.fgb || (m.origin === 'layer' && m.sourceDownloads?.length)) rec.download = true;
  if (m.origin === 'data') rec.kind = 'statistic';
  if (m.keywords?.length) rec.keywords = m.keywords.slice(0, 12);
  // The colour the layer is drawn in, so the catalogue can show it (census statistics are drawn
  // on the viridis ramp; its middle stands for it).
  const color = m.style?.color || m.style?.fillColor || (m.origin === 'data' ? '#21918c' : '');
  if (/^#[0-9a-f]{6}$/i.test(color)) rec.color = color.toLowerCase();
  const parts = partsOf.get(id);
  if (parts?.length) rec.parts = dropSharedPrefix(parts.map((p) => ({ id: p.id, label: shortPart(p.label, m.name) })));
  out.maps[id] = rec;
  return rec;
}

// ------------------------------------------------------------------ series
const subjectById = new Map(source.subjects.map((s) => [s.id, s]));
const shelfOfSubject = new Map();
for (const sh of source.shelves) for (const sid of sh.subjects) shelfOfSubject.set(sid, sh.id);
const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const yearOfDate = (d) => (YEAR.exec(d || '') ? Number(YEAR.exec(d)[1]) : null);

function editionLabel(series, rec, all) {
  if (series.arrangement === 'editions') {
    const sameYear = all.filter((r) => yearOfDate(r.date) === yearOfDate(rec.date)).length > 1;
    if (rec.date && sameYear && rec.date.length === 10) {
      const [y, mo, d] = rec.date.split('-').map(Number);
      return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1]} ${y}`;
    }
    if (yearOfDate(rec.date)) return String(yearOfDate(rec.date));
  }
  // A set's member is named by what distinguishes it from the series: "Habitat Network — Bog".
  const stem = series.name.toLowerCase();
  let label = rec.name.replace(/\s*[—–-]\s*/g, ' — ');
  if (label.toLowerCase().startsWith(stem)) label = label.slice(stem.length).replace(/^[\s—:–-]+/, '').replace(/^(of|in|for|the)\s+/i, '') || rec.name;
  return label.replace(/^\((.*)\)$/, '$1');
}

const seriesOut = [];
const slugsSeen = new Set();
for (const s of source.series) {
  const recs = s.members.map((id) => ({ id, ...addMap(id) }));
  if (s.arrangement === 'editions') recs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const years = recs.map((r) => yearOfDate(r.date)).filter(Boolean);
  let slug = slugify(s.name) || s.id;
  if (slugsSeen.has(`${s.subject}/${slug}`)) slug = `${slug}-${slugify(s.scope || s.id)}`;
  slugsSeen.add(`${s.subject}/${slug}`);
  const provs = [...new Set(recs.flatMap((r) => r.provider || []))];
  const statusCounts = recs.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  // Variants (another scale, a council's excerpt) are labelled as a set member is, by what sets
  // them apart, and listed straight after the edition they are a version of.
  const variantOf = s.arrangement === 'editions' ? (s.variantOf || {}) : {};
  const editions = recs.filter((r) => !variantOf[r.id]);
  const members = [];
  for (const r of editions) {
    members.push({ id: r.id, label: editionLabel(s, r, editions) });
    for (const v of recs.filter((x) => variantOf[x.id] === r.id)) members.push({ id: v.id, label: editionLabel({ ...s, arrangement: 'set' }, v, recs), of: r.id });
  }
  if (s.arrangement === 'set') {
    for (const m of members) m.label = m.label.replace(/^\((1[5-9]\d\d|20\d\d)\)\s*—\s*(.+)$/, '$2 ($1)');
  }
  // Set members lose a prefix every one of them shares ("1990 — 2018 — pH" -> "pH").
  if (s.arrangement === 'set' && members.length > 1) {
    const parts = members.map((m) => m.label.split(' — '));
    let k = 0;
    while (parts.every((p) => p.length > k + 1 && p[k] === parts[0][k])) k += 1;
    if (k) members.forEach((m, i) => { m.label = parts[i].slice(k).join(' — '); });
  }
  // A variant's label drops the edition's year it repeats: "(1993) — OSNI 50k" -> "OSNI 50k".
  for (const m of members) if (m.of) m.label = m.label.replace(YEAR, '').replace(/^[\s()—–:-]+/, '').replace(/\(\s*\)/g, '').trim() || m.label;
  // Two editions with one date (a national map and a council's copy) are told apart by who
  // published them, or failing that by name.
  const byLabel = new Map();
  for (const m of members) if (!m.of) byLabel.set(m.label, [...(byLabel.get(m.label) || []), m]);
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    const provs = group.map((m) => out.maps[m.id].provider?.[0] || '');
    const useProvider = provs.every(Boolean) && new Set(provs).size === group.length;
    group.forEach((m, i) => {
      const rec = out.maps[m.id];
      const name = editionLabel({ ...s, arrangement: 'set' }, { ...rec, name: rec.name.replace(YEAR, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim() }, recs);
      m.label = `${m.label} · ${useProvider ? provs[i] : (name || m.id)}`;
    });
  }
  const entry = {
    id: s.id,
    slug,
    name: s.name,
    subject: s.subject,
    shelf: shelfOfSubject.get(s.subject),
    scope: s.scope || '',
    arrangement: s.arrangement,
    members,
  };
  // Maps listed but not yet drawn, which a row shows on request ("52 to be added"), labelled
  // the way the series labels its own maps.
  const todoRecs = (s.toBeAdded || []).map((id) => ({ id, ...addMap(id) }));
  if (todoRecs.length) {
    if (s.arrangement === 'editions') todoRecs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    entry.todo = todoRecs.map((r) => ({ id: r.id, label: editionLabel(s, r, [...editions, ...todoRecs]) }));
  }
  const todoYears = todoRecs.map((r) => yearOfDate(r.date)).filter(Boolean);
  if (years.length) entry.years = [Math.min(...years), Math.max(...years)];
  else if (todoYears.length) entry.years = [Math.min(...todoYears), Math.max(...todoYears)];
  const t = recs.find((r) => r.thumb)?.thumb || todoRecs.find((r) => r.thumb)?.thumb;
  if (t) entry.thumb = t;
  const c = members.map((x) => out.maps[x.id]?.color).find(Boolean) || todoRecs.map((r) => r.color).find(Boolean);
  if (c) entry.color = c;
  if (provs.length) entry.provider = provs.slice(0, 6);
  if (!recs.length) entry.status = { placeholder: todoRecs.length };
  else if (statusCounts.ready !== recs.length) entry.status = statusCounts;
  if (s.aliases?.length) entry.aliases = s.aliases;
  if (s.description) entry.description = s.description;
  seriesOut.push(entry);
}
for (const sub of source.subjects) for (const id of sub.toBeAdded || []) addMap(id);

// ------------------------------------------------------------------ elections
const ELECTION_BODY_ORDER = ['dail-eireann', 'house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly', 'parliament-of-northern-ireland',
  'local-government', 'european-parliament', 'european-parliament-ireland', 'president-of-ireland', 'ireland-referendum', 'ireland-local'];
const electionsOut = elections.map((e) => {
  const rec = {
    key: e.key,
    title: e.displayTitle || `${e.date} ${e.body}`,
    body: e.body,
    bodySlug: e.bodySlug,
    date: e.date,
    kind: e.isByElection ? 'by-election' : (e.kind || 'general'),
    seats: e.totalConstituencies || (e.constituencies || []).length,
  };
  if (e.contestType && e.contestType !== 'election') rec.contestType = e.contestType;
  if (e.layerId) rec.layerId = e.layerId;
  if (e.sourceMapId) rec.sourceMapId = e.sourceMapId;
  if (e.bodyGroup) rec.bodyGroup = e.bodyGroup;
  if (e.placeholder || e.loadable === false) rec.mapless = true;
  if (e.displaySubtitle) rec.subtitle = e.displaySubtitle;
  // Where it was held: Westminster elections before 1922 were all-Ireland ones.
  rec.scope = ['dail-eireann', 'ireland-referendum', 'ireland-local', 'ireland-european', 'ireland-president'].includes(e.bodySlug) ? 'Republic of Ireland'
    : e.bodySlug === 'house-of-commons-of-the-united-kingdom' && String(e.date) < '1922' ? 'Ireland' : 'Northern Ireland';
  // The map the election is drawn on, for its thumbnail.
  const own = [e.sourceMapId, e.layerId, mapById.get(e.sourceMapId)?.cloneOf].find((id) => id && thumbs.has(id));
  if (own) rec.thumb = own;
  return rec;
}).sort((a, b) => String(b.date).localeCompare(String(a.date)));
// An election with no map of its own (results only) borrows the thumbnail of the nearest election
// of the same body that has one, as today's pane does from a hand-kept table.
{
  const byBody = new Map();
  for (const e of electionsOut) if (e.thumb) byBody.set(e.bodySlug, [...(byBody.get(e.bodySlug) || []), e]);
  const t = (d) => Date.parse(String(d).slice(0, 10)) || 0;
  for (const e of electionsOut) {
    if (e.thumb) continue;
    const near = (byBody.get(e.bodySlug) || []).reduce((best, x) => (!best || Math.abs(t(x.date) - t(e.date)) < Math.abs(t(best.date) - t(e.date)) ? x : best), null);
    if (near) { e.thumb = near.thumb; e.thumbBorrowed = true; }
  }
}
// Constituency names -> elections, so a search for "Dungannon" finds the elections it was fought in.
const contestIndex = {};
for (const e of elections) {
  for (const c of new Set(e.constituencies || [])) {
    const k = String(c).trim();
    if (!k) continue;
    (contestIndex[k] ||= []).push(e.key);
  }
}
const bodies = [...new Set(electionsOut.map((e) => e.bodySlug))].sort((a, b) => {
  const ia = ELECTION_BODY_ORDER.indexOf(a); const ib = ELECTION_BODY_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}).map((slug) => ({ slug, name: electionsOut.find((e) => e.bodySlug === slug).body, count: electionsOut.filter((e) => e.bodySlug === slug).length }));

// ------------------------------------------------------------------ places
// Named features (wards, districts, townlands...) with their maps and boxes, for place search.
const placeMaps = [];
const placeMapIndex = new Map();
const places = [];
for (const f of spatial.features || []) {
  if (!f.name || !f.mapId || !Array.isArray(f.bbox) || !out.maps[f.mapId]) continue;
  if (!placeMapIndex.has(f.mapId)) { placeMapIndex.set(f.mapId, placeMaps.length); placeMaps.push(f.mapId); }
  places.push([String(f.name).trim(), placeMapIndex.get(f.mapId), ...f.bbox.map((n) => Math.round(n * 1000) / 1000)]);
}

// ------------------------------------------------------------------ redirects from today's cards
// The current pane's anchors (#flat-card-<id>) keep working: each card points to the series that
// holds most of its maps. Cards are read from ui-controller.js only for this.
const redirects = {};
try {
  const ui = readFileSync(rel('src/ui-controller.js'), 'utf8');
  const classes = new Map((read('data/database/maps.json').classes || []).map((c) => [c.id, c.maps || []]));
  const seriesOfMap = new Map();
  for (const s of seriesOut) for (const m of s.members) seriesOfMap.set(m.id, s.id);
  for (const m of ui.matchAll(/\{\s*id:\s*'(flat-[a-z0-9-]+)'[^{}]*?\}/g)) {
    const body = m[0];
    const ids = [...(body.match(/mapIds:\s*\[([^\]]*)\]/)?.[1] || '').matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
    for (const c of (body.match(/classIds:\s*\[([^\]]*)\]/)?.[1] || '').matchAll(/'([a-z0-9-]+)'/g)) ids.push(...(classes.get(c[1]) || []));
    const tally = new Map();
    for (const id of ids) { const s = seriesOfMap.get(id); if (s) tally.set(s, (tally.get(s) || 0) + 1); }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) redirects[m[1]] = best[0];
  }
} catch { /* redirects are a convenience */ }

// ------------------------------------------------------------------ people
// Everyone who stood in an election here, from the Browse pages' person index
// (data/browse/person-shards, about 42 MB), boiled down to what search shows and does: name and
// its other forms, main party and constituency, years, contests stood and won, and each contest
// as [election (an index into `elections`), constituency, elected 0/1, party if not the main one].
// A row is [id, name, party, constituency, firstYear, lastYear, stood, elected, contests,
// otherNames?, slug?]; the slug (their Browse page) is given only when it is not name-id.
const peopleDoc = (() => {
  const dir = rel('data/browse/person-shards');
  if (!existsSync(dir)) return null;
  const parties = [];
  const constituencies = [];
  const partyIndex = new Map();
  const placeIndex = new Map();
  const at = (table, index, v) => {
    if (!v) return -1;
    if (!index.has(v)) { index.set(v, table.length); table.push(v); }
    return index.get(v);
  };
  const electionIndex = new Map(electionsOut.map((e, i) => [e.key, i]));
  const people = [];
  for (const f of readdirSync(dir).filter((x) => /^persons-\d+\.json$/.test(x)).sort()) {
    for (const p of JSON.parse(readFileSync(path.join(dir, f), 'utf8')).items || []) {
      const party = p.parties?.[0]?.name || '';
      const contests = (p.elections || []).filter((e) => electionIndex.has(e.key)).map((e) => {
        const c = [electionIndex.get(e.key), at(constituencies, placeIndex, e.constituency || ''), e.elected ? 1 : 0];
        if (e.party && e.party !== party) c.push(at(parties, partyIndex, e.party));
        return c;
      });
      const row = [String(p.id), p.name, at(parties, partyIndex, party), at(constituencies, placeIndex, p.constituencies?.[0]?.name || ''),
        p.firstYear || 0, p.lastYear || 0, p.totals?.stood ?? contests.length, p.totals?.elected ?? contests.filter((c) => c[2]).length, contests];
      const others = [...new Set((p.names || []).map((n) => n.name).filter((n) => n && slugify(n) !== slugify(p.name)))];
      const slug = p.slug && p.slug !== `${slugify(p.name)}-${p.id}` ? p.slug : '';
      if (others.length || slug) row.push(others);
      if (slug) row.push(slug);
      people.push(row);
    }
  }
  return { schemaVersion: 1, parties, constituencies, people };
})();

// ------------------------------------------------------------------ write
const catalogue = {
  schemaVersion: 1,
  about: 'Built by scripts/catalogue/build-catalogue.mjs from data/catalogue/catalogue.source.json; do not edit.',
  shelves: source.shelves,
  subjects: source.subjects.map((s) => ({ id: s.id, name: s.name, kind: s.kind, shelf: shelfOfSubject.get(s.id), series: s.series, toBeAdded: s.toBeAdded || [] })),
  series: seriesOut,
  maps: out.maps,
  elections: electionsOut,
  electionBodies: bodies,
  contestIndex,
  redirects,
};
const placesDoc = { schemaVersion: 1, maps: placeMaps, places };
const files = [['data/catalogue/catalogue.json', catalogue], ['data/catalogue/places.json', placesDoc]];
if (peopleDoc) files.push(['data/catalogue/people.json', peopleDoc]);
let stale = false;
for (const [p, doc] of files) {
  const text = JSON.stringify(doc) + '\n';
  if (CHECK) {
    if (!existsSync(rel(p)) || readFileSync(rel(p), 'utf8') !== text) { console.error(`stale: ${p}`); stale = true; }
  } else writeFileSync(rel(p), text);
}
if (CHECK && stale) process.exit(1);
console.log(JSON.stringify({
  shelves: catalogue.shelves.length, subjects: catalogue.subjects.length, series: seriesOut.length,
  maps: Object.keys(out.maps).length, withThumb: Object.values(out.maps).filter((m) => m.thumb).length,
  withBounds: Object.values(out.maps).filter((m) => m.bounds).length, elections: electionsOut.length,
  places: places.length, redirects: Object.keys(redirects).length, people: peopleDoc?.people.length || 0,
  bytes: { catalogue: JSON.stringify(catalogue).length, places: JSON.stringify(placesDoc).length, people: peopleDoc ? JSON.stringify(peopleDoc).length : 0 },
}));
