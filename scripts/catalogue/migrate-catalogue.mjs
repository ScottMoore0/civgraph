#!/usr/bin/env node
/**
 * Write the catalogue's curated source, data/catalogue/catalogue.source.json, from the
 * structure the site already has.
 *
 *   node scripts/catalogue/migrate-catalogue.mjs [--force]
 *
 * The rebuilt catalogue keeps three things apart that the current pane blurs: what exists (the
 * maps in data/database/maps.json), how it is arranged for browsing (this file), and everything
 * that can be derived from the two (built by build-catalogue.mjs). This script seeds the
 * arrangement once, from the reviewed taxonomy in data/database/maps-v2.json
 * (scripts/catalogue-taxonomy/): its shelves, subjects and entries, in their order. After that
 * the source is edited directly -- by hand or by the catalogue editor -- and this script refuses
 * to overwrite it without --force.
 *
 * The arrangement it writes:
 *   shelves   ordered; each lists its subjects in order
 *   subjects  ordered; each lists its series in order, and the maps still to be added
 *   series    one thing a reader thinks of as "a map": Local Government Districts (NI), the
 *             1911 census areas. Its members are maps.json ids. `arrangement` says how they
 *             relate: "editions" (the same thing at different dates, shown on a timeline) or
 *             "set" (related maps of one subject, shown as a list). In a series of editions,
 *             `variantOf` maps a member to the edition it is another version of (an excerpt,
 *             another scale); it is listed under that edition, not as an edition of its own.
 * Nothing here names a map by its display name: every reference is an id.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRecords } from './records.mjs';

const ROOT = process.cwd();
const V2 = path.join(ROOT, 'data/database/maps-v2.json');
const MAPS = path.join(ROOT, 'data/database/maps.json');
const OUT = path.join(ROOT, 'data/catalogue/catalogue.source.json');

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error(`${path.relative(ROOT, OUT)} exists and is the edited source; pass --force to replace it.`);
  process.exit(1);
}

const v2 = JSON.parse(readFileSync(V2, 'utf8'));
const maps = JSON.parse(readFileSync(MAPS, 'utf8')).maps;
const mapById = new Map(maps.map((m) => [m.id, m]));
const yearOf = (m) => {
  const d = String(m?.dateEffective || m?.date || '');
  const y = /(1[5-9]\d\d|20\d\d)/.exec(d) || /(1[5-9]\d\d|20\d\d)/.exec(`${m?.id || ''} ${m?.name || ''}`);
  return y ? Number(y[1]) : null;
};
const SCOPE = { NI: 'Northern Ireland', ROI: 'Republic of Ireland', IRE: 'Ireland' };

const series = [];
const seriesBySubject = new Map();
for (const e of v2.entries) {
  const members = e.mapIds.filter((id) => mapById.has(id));
  if (!members.length) continue;
  // How the members relate. A member the taxonomy marked as a variant of another (an excerpt,
  // another scale) hangs under that edition. The rest form a timeline when they have their own
  // years -- most of them distinct -- and a set otherwise (thirteen 1990 river measures are a set).
  const variantOf = Object.fromEntries(Object.entries(e.variantOf || {}).filter(([k, v]) => members.includes(k) && members.includes(v) && k !== v));
  const base = members.filter((id) => !variantOf[id]);
  const years = base.map((id) => yearOf(mapById.get(id)));
  const distinctYears = new Set(years.filter(Boolean));
  const arrangement = base.length > 1 && distinctYears.size >= 2 && distinctYears.size >= 0.6 * base.length
    && (e.axis === 'edition' || years.every(Boolean)) ? 'editions' : 'set';
  const s = {
    id: e.id.replace(/^e-/, ''),
    name: e.name,
    subject: e.subject,
    scope: SCOPE[e.scope] || '',
    arrangement,
    members,
  };
  if (arrangement === 'editions' && Object.keys(variantOf).length) s.variantOf = variantOf;
  series.push(s);
  if (!seriesBySubject.has(e.subject)) seriesBySubject.set(e.subject, []);
  seriesBySubject.get(e.subject).push(s.id);
}

// One series is one thing in one jurisdiction. The taxonomy filed some maps of different
// jurisdictions together (the pre-partition and the Republic's local authorities; NISRA's and
// Tailte Éireann's settlements) that today's pane keeps on separate cards, each card naming its
// extent. Those are split here, by the extent of the card each map is on today.
const mapClasses = JSON.parse(readFileSync(MAPS, 'utf8')).classes || [];
// The extent each map's card names in today's pane (src/ui-controller.js's flat cards), and each
// class's card name ("Assembly Areas (1998-)"), which reads better than the class's own.
const extentOf = new Map();
const cardNameOfClass = new Map();
{
  const ui = readFileSync(path.join(ROOT, 'src/ui-controller.js'), 'utf8');
  const classes = new Map(mapClasses.map((c) => [c.id, c.maps || []]));
  const EXTENT = { 'Northern Ireland': 'Northern Ireland', 'Republic of Ireland': 'Republic of Ireland', Dublin: 'Republic of Ireland', Ireland: 'Ireland' };
  for (const m of ui.matchAll(/\{\s*id:\s*'(flat-[a-z0-9-]+)'[^{}]*?\}/g)) {
    const extent = EXTENT[m[0].match(/extent:\s*'([^']*)'/)?.[1] || ''];
    if (!extent) continue;
    const ids = [...(m[0].match(/mapIds:\s*\[([^\]]*)\]/)?.[1] || '').matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
    const name = m[0].match(/name:\s*'([^']*)'/)?.[1] || '';
    for (const c of (m[0].match(/classIds:\s*\[([^\]]*)\]/)?.[1] || '').matchAll(/'([a-z0-9-]+)'/g)) {
      ids.push(...(classes.get(c[1]) || []));
      if (name && !cardNameOfClass.has(c[1])) cardNameOfClass.set(c[1], name);
    }
    for (const id of ids) if (!extentOf.has(id)) extentOf.set(id, extent);
  }
}
{
  const SUFFIX = { 'Northern Ireland': 'ni', 'Republic of Ireland': 'roi', Ireland: 'ireland' };
  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const groups = new Map();
    for (const id of s.members) {
      const e = extentOf.get(id) || '';
      if (!groups.has(e)) groups.set(e, []);
      groups.get(e).push(id);
    }
    const known = [...groups.keys()].filter(Boolean);
    if (known.length < 2) continue;
    // A map on no card goes with the part of the series' own jurisdiction, or the largest part.
    const unplaced = groups.get('') || [];
    groups.delete('');
    const home = groups.has(s.scope) ? s.scope : [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
    groups.get(home).push(...unplaced);
    const largest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
    const parts = [...groups.entries()].map(([scope, members]) => {
      const years = members.map((id) => yearOf(mapById.get(id))).filter(Boolean);
      const qualifier = scope === 'Ireland' && years.length && Math.max(...years) <= 1921 ? 'Ireland before partition' : scope;
      const part = {
        ...s,
        id: scope === largest ? s.id : `${s.id}--${SUFFIX[scope]}`,
        name: `${s.name} (${qualifier})`,
        scope,
        members: s.members.filter((id) => members.includes(id)),
      };
      const base = part.members.filter((id) => !s.variantOf?.[id]);
      const distinct = new Set(base.map((id) => yearOf(mapById.get(id))).filter(Boolean));
      part.arrangement = base.length > 1 && distinct.size >= 2 && distinct.size >= 0.6 * base.length ? 'editions' : 'set';
      if (s.variantOf) {
        const v = Object.fromEntries(Object.entries(s.variantOf).filter(([k, of]) => part.members.includes(k) && part.members.includes(of)));
        if (part.arrangement === 'editions' && Object.keys(v).length) part.variantOf = v; else delete part.variantOf;
      }
      return part;
    }).sort((a, b) => (a.id === s.id ? -1 : b.id === s.id ? 1 : a.scope.localeCompare(b.scope)));
    series.splice(i, 1, ...parts);
    const list = seriesBySubject.get(s.subject);
    list.splice(list.indexOf(s.id), 1, ...parts.map((p) => p.id));
    i += parts.length - 1;
  }
}

// Maps the taxonomy predates: the renderer's own layers (3D terrain, LiDAR, point clouds) and
// the census statistics (data-entries.json). Seeded here once, as today's pane groups them.
const { records } = loadRecords(ROOT);
const extraSubjects = [];
function seed(subject, id, name, scope, members, arrangement = 'set') {
  const present = members.filter((m) => records.has(m));
  if (!present.length) return;
  series.push({ id, name, subject, scope, arrangement, members: present });
  if (!seriesBySubject.has(subject)) seriesBySubject.set(subject, []);
  seriesBySubject.get(subject).push(id);
}
seed('aerial-imagery-and-elevation', 'ireland-3d-terrain', 'Ireland 3D Terrain', 'Ireland', ['ireland-terrain-3d', 'ireland-terrain-3d-grey']);
seed('aerial-imagery-and-elevation', 'ni-river-basin-lidar-3d', 'NI River-Basin LiDAR — 1 m 3D Terrain', 'Northern Ireland', ['ni-lidar-1m-3d', 'ni-lidar-1m-3d-grey']);
seed('aerial-imagery-and-elevation', 'lidar-point-clouds', 'LiDAR Point Clouds', 'Northern Ireland',
  [...records.values()].filter((r) => r.origin === 'layer' && !r.partOf && /pointcloud/.test(r.id)).map((r) => r.id).sort());
{
  // One series per statistic; its members are the same statistic at different geographies.
  const byTopic = new Map();
  for (const r of records.values()) {
    if (r.origin !== 'data') continue;
    const topic = r.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(r.id);
  }
  extraSubjects.push({ shelf: 'people-and-places', after: 'census', id: 'census-statistics', name: 'Census Statistics', kind: 'Dataset' });
  for (const [topic, ids] of byTopic) {
    const slug = topic.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    seed('census-statistics', `census-statistics-${slug}`, topic, 'Northern Ireland', ids);
  }
}

// A set's maps are listed widest first -- the all-island layer before a council's copy -- then
// current (undated) before dated, newest first. This is a starting order: editors reorder the
// members in the source and the build keeps their order.
{
  const { records: recs, parts } = loadRecords(ROOT);
  const index = JSON.parse(readFileSync(path.join(ROOT, 'render/metadata/maps-test-index.json'), 'utf8')).layers || [];
  const layerBounds = new Map(index.filter((l) => l.sourceMapId && Array.isArray(l.bounds)).map((l) => [l.sourceMapId, l.bounds]));
  const box = (id) => {
    const b = layerBounds.get(id) || recs.get(id)?.bounds;
    if (!Array.isArray(b) || b.length !== 2) return null;
    const [[s1, w1], [n1, e1]] = b;
    return [Math.min(w1, e1), Math.min(s1, n1), Math.max(w1, e1), Math.max(s1, n1)];
  };
  const extent = (id) => {
    const own = box(id);
    if (own) return own;
    const bs = (parts.get(id) || []).map((p) => box(p.id)).filter(Boolean);
    return bs.length ? [Math.min(...bs.map((x) => x[0])), Math.min(...bs.map((x) => x[1])), Math.max(...bs.map((x) => x[2])), Math.max(...bs.map((x) => x[3]))] : null;
  };
  const area = (id) => { const b = extent(id); return b ? Math.round((b[2] - b[0]) * (b[3] - b[1]) * 10) : 0; };
  for (const s of series) {
    if (s.arrangement !== 'set' || s.members.length < 2) continue;
    s.members.sort((a, b) => area(b) - area(a)
      || Number(Boolean(yearOf(recs.get(a)))) - Number(Boolean(yearOf(recs.get(b))))
      || (yearOf(recs.get(b)) || 0) - (yearOf(recs.get(a)) || 0)
      || (parts.get(b)?.length || 0) - (parts.get(a)?.length || 0));
  }
}

// Maps that cannot draw anything yet ("to be added"). Each joins the series its card is in today
// (the card's maps.json class), so a row can show "52 to be added" as today's cards do. A class
// with no map ready yet (the Assembly Areas, say) becomes a series of its own; a map on no card
// becomes a series of one. Hidden maps (withdrawn, duplicates, superseded) are left out entirely.
const placed = new Set(series.flatMap((s) => s.members));
const toAdd = new Map();
for (const m of v2.maps) {
  if (placed.has(m.id)) continue;
  const full = mapById.get(m.id);
  if (!full || full.hidden) continue;
  const subject = m.subject || full.category;
  if (!toAdd.has(subject)) toAdd.set(subject, []);
  toAdd.get(subject).push(m.id);
}
{
  const classOf = new Map();
  for (const c of mapClasses) for (const id of c.maps || []) if (!classOf.has(id)) classOf.set(id, c);
  const seriesOfMap = new Map();
  for (const s of series) for (const id of s.members) seriesOfMap.set(id, s);
  const seriesOfClass = new Map();
  for (const c of mapClasses) {
    const tally = new Map();
    for (const id of c.maps || []) { const s = seriesOfMap.get(id); if (s) tally.set(s, (tally.get(s) || 0) + 1); }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) seriesOfClass.set(c.id, best[0]);
  }
  const usedNames = new Set(series.map((s) => s.name.toLowerCase()));
  const uniqueName = (name, scope) => {
    let n = name;
    if (usedNames.has(n.toLowerCase()) && scope) n = `${name} (${scope})`;
    for (let i = 2; usedNames.has(n.toLowerCase()); i += 1) n = `${name} (${i})`;
    usedNames.add(n.toLowerCase());
    return n;
  };
  const newSeries = (subject, id, name, scope) => {
    const s = { id, name: uniqueName(name, scope), subject, scope, arrangement: 'set', members: [], toBeAdded: [] };
    series.push(s);
    if (!seriesBySubject.has(subject)) seriesBySubject.set(subject, []);
    seriesBySubject.get(subject).push(s.id);
    return s;
  };
  const slug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const [subject, ids] of toAdd) {
    for (const id of ids) {
      const c = classOf.get(id);
      let s = c ? seriesOfClass.get(c.id) : null;
      if (!s && c) {
        // The card's name without its open date range ("Assembly Areas (1998-)" -> "Assembly Areas"),
        // unless that name is taken.
        const card = cardNameOfClass.get(c.id);
        const bare = card ? card.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, '') : '';
        const name = card ? (usedNames.has(bare.toLowerCase()) ? card : bare) : (c.name || c.id);
        s = newSeries(subject, `${subject}-${slug(c.id)}`, name, extentOf.get(id) || '');
        seriesOfClass.set(c.id, s);
      }
      if (!s) s = newSeries(subject, `${subject}-${slug(id)}`, mapById.get(id)?.name || id, extentOf.get(id) || '');
      (s.toBeAdded ||= []).push(id);
    }
    toAdd.set(subject, []);
  }
  // A series of maps still to come is a timeline when they have their own years, like any other.
  for (const s of series) {
    if (s.members.length || !s.toBeAdded?.length) continue;
    const years = s.toBeAdded.map((id) => yearOf(mapById.get(id)));
    if (years.filter(Boolean).length >= 2 && new Set(years.filter(Boolean)).size >= 0.6 * years.length) s.arrangement = 'editions';
  }
}

const allSubjects = [...v2.subjects, ...extraSubjects];
const subjectIds = new Set(allSubjects.map((s) => s.id));
const source = {
  schemaVersion: 1,
  about: 'The catalogue\'s arrangement: shelves, subjects and series, by id. Edited directly; '
    + 'everything else the catalogue shows is derived by scripts/catalogue/build-catalogue.mjs.',
  shelves: [...v2.shelves].sort((a, b) => a.order - b.order).map((s) => {
    const subjects = s.subjects.filter((id) => subjectIds.has(id));
    for (const x of extraSubjects.filter((e) => e.shelf === s.id)) subjects.splice(subjects.indexOf(x.after) + 1, 0, x.id);
    return { id: s.id, name: s.name, blurb: s.blurb || '', subjects };
  }),
  subjects: allSubjects.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    series: seriesBySubject.get(s.id) || [],
    toBeAdded: toAdd.get(s.id) || [],
  })),
  series,
};
const homeless = [...toAdd.keys()].filter((k) => !subjectIds.has(k));
if (homeless.length) {
  console.error(`maps to be added under unknown subjects: ${homeless.join(', ')}`);
  process.exit(1);
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(source, null, 2) + '\n');
console.log(JSON.stringify({
  shelves: source.shelves.length,
  subjects: source.subjects.length,
  series: series.length,
  editions: series.filter((s) => s.arrangement === 'editions').length,
  sets: series.filter((s) => s.arrangement === 'set').length,
  mapsPlaced: placed.size,
  toBeAdded: [...toAdd.values()].reduce((n, l) => n + l.length, 0),
}));
