#!/usr/bin/env node
/**
 * Validate the rebuilt catalogue's arrangement (data/catalogue/catalogue.source.json) against the
 * site's map records, and its built output (data/catalogue/catalogue.json) against both.
 *
 *   node scripts/catalogue/check-catalogue.mjs
 *
 * Fails (exit 1) when:
 *   - a map the site can load (records.mjs) that is neither hidden nor a part of another map is in
 *     no series and not listed as to be added, or is in two places; a part is placed on its own;
 *   - a series, subject or shelf names an id that does not exist;
 *   - a subject is on no shelf or on two, or a series is in no subject or in two;
 *   - a series or subject is empty, or two series share an id, a name or a web address (slug);
 *   - a series of editions has two editions with the same label;
 *   - a thumbnail the catalogue names is not in assets/thumbnails/manifest.json;
 *   - an election names a layer the site does not have;
 *   - an old card link redirects to a series that does not exist;
 *   - the built files are stale (run build-catalogue.mjs);
 *   - a map in a series lacks a provider, a source link or something to draw, beyond the
 *     problems pinned in data/catalogue/quality-baseline.json; or is new and not signed off
 *     (catalogue.source.json `signedOff`). Re-pin with --update-baseline only deliberately.
 * Reports (without failing) the maps placed in a series but still placeholders, so that placeholders
 * are shown on purpose rather than by accident.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadRecords, placeable } from './records.mjs';

const ROOT = process.cwd();
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const source = read('data/catalogue/catalogue.source.json');
const built = read('data/catalogue/catalogue.json');
const { records: mapById } = loadRecords(ROOT);
const thumbs = new Set(read('assets/thumbnails/manifest.json'));
const layerIds = new Set((read('render/metadata/maps-test-index.json').layers || []).flatMap((l) => [l.id, l.sourceMapId].filter(Boolean)));

const errors = [];
const fail = (msg) => errors.push(msg);

// ---- the arrangement
const shelfIds = new Set();
const subjectOnShelf = new Map();
for (const sh of source.shelves) {
  if (shelfIds.has(sh.id)) fail(`shelf ${sh.id} is defined twice`);
  shelfIds.add(sh.id);
  if (!sh.subjects?.length) fail(`shelf ${sh.id} has no subjects`);
  for (const sid of sh.subjects || []) {
    if (subjectOnShelf.has(sid)) fail(`subject ${sid} is on two shelves (${subjectOnShelf.get(sid)}, ${sh.id})`);
    subjectOnShelf.set(sid, sh.id);
  }
}
const subjectById = new Map();
for (const sub of source.subjects) {
  if (subjectById.has(sub.id)) fail(`subject ${sub.id} is defined twice`);
  subjectById.set(sub.id, sub);
  if (!subjectOnShelf.has(sub.id)) fail(`subject ${sub.id} is on no shelf`);
  if (!sub.series?.length && !sub.toBeAdded?.length) fail(`subject ${sub.id} is empty`);
}
for (const sid of subjectOnShelf.keys()) if (!subjectById.has(sid)) fail(`a shelf names subject ${sid}, which does not exist`);

const seriesById = new Map();
const seriesInSubject = new Map();
for (const sub of source.subjects) {
  for (const id of sub.series || []) {
    if (seriesInSubject.has(id)) fail(`series ${id} is in two subjects (${seriesInSubject.get(id)}, ${sub.id})`);
    seriesInSubject.set(id, sub.id);
  }
}
// Maps kept out of the pane on purpose (source.hidden, each with its reason). A hidden map's
// parts may then be placed as maps of their own.
const hiddenIds = new Set((source.hidden || []).map((h) => h.id));
for (const h of source.hidden || []) {
  if (!mapById.has(h.id)) fail(`hidden names map ${h.id}, which the site does not define`);
  if (!h.why) fail(`hidden map ${h.id} gives no reason`);
}
const placed = new Map();
const place = (mapId, where) => {
  if (!mapById.has(mapId)) { fail(`${where} names map ${mapId}, which the site does not define (scripts/catalogue/records.mjs)`); return; }
  if (mapById.get(mapId).partOf && !hiddenIds.has(mapById.get(mapId).partOf)) fail(`${where} names ${mapId}, which is a part of ${mapById.get(mapId).partOf}: parts are reached through their parent`);
  if (placed.has(mapId)) fail(`map ${mapId} is in two places (${placed.get(mapId)}, ${where})`);
  placed.set(mapId, where);
};
for (const s of source.series) {
  if (seriesById.has(s.id)) fail(`series id ${s.id} is used twice`);
  seriesById.set(s.id, s);
  if (!seriesInSubject.has(s.id)) fail(`series ${s.id} is in no subject`);
  if (s.subject && seriesInSubject.get(s.id) && s.subject !== seriesInSubject.get(s.id)) fail(`series ${s.id} says subject ${s.subject} but is listed under ${seriesInSubject.get(s.id)}`);
  if (!s.members?.length && !s.toBeAdded?.length) fail(`series ${s.id} is empty`);
  if (!['editions', 'set'].includes(s.arrangement)) fail(`series ${s.id} has arrangement "${s.arrangement}"; use editions or set`);
  for (const [v, of] of Object.entries(s.variantOf || {})) {
    if (!s.members.includes(v) || !s.members.includes(of)) fail(`series ${s.id} says ${v} is a version of ${of}, but both must be its members`);
    if (s.variantOf[of]) fail(`series ${s.id}: ${of} is itself a variant, so ${v} cannot be a version of it`);
  }
  for (const m of s.members || []) place(m, `series ${s.id}`);
  for (const m of s.toBeAdded || []) place(m, `series ${s.id} (to be added)`);
}
for (const id of seriesInSubject.keys()) if (!seriesById.has(id)) fail(`a subject names series ${id}, which does not exist`);
// Names are what readers search and scan by: two series must never share one.
const byName = new Map();
for (const s of source.series) byName.set(s.name.toLowerCase(), [...(byName.get(s.name.toLowerCase()) || []), s.id]);
for (const [name, ids] of byName) if (ids.length > 1) fail(`${ids.length} series are called "${name}" (${ids.join(', ')}): give each its jurisdiction or years`);
for (const sub of source.subjects) for (const m of sub.toBeAdded || []) place(m, `subject ${sub.id} (to be added)`);

let unplaced = 0;
for (const m of placeable(mapById)) {
  if (hiddenIds.has(m.id) && placed.has(m.id)) fail(`map ${m.id} is hidden but placed in ${placed.get(m.id)}`);
  if (placed.has(m.id) || hiddenIds.has(m.id)) continue;
  unplaced += 1;
  if (unplaced <= 25) fail(`map ${m.id} (${m.name}) is not hidden but is in no series and not listed as to be added`);
}
if (unplaced > 25) fail(`… and ${unplaced - 25} more maps in no series`);
const placedHidden = [...placed.keys()].filter((id) => mapById.get(id)?.hidden);
if (placedHidden.length) fail(`${placedHidden.length} hidden maps are placed in the catalogue: ${placedHidden.slice(0, 8).join(', ')}`);

// ---- the built output
const slugs = new Map();
for (const s of built.series) {
  if (slugs.has(s.slug)) fail(`series ${s.id} and ${slugs.get(s.slug)} share the address ${s.slug}`);
  slugs.set(s.slug, s.id);
  if (s.arrangement === 'editions') {
    const labels = s.members.filter((m) => !m.of).map((m) => m.label);
    const dup = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dup) fail(`series ${s.id} has two editions labelled ${dup}`);
  }
  if (s.thumb && !thumbs.has(s.thumb)) fail(`series ${s.id} names thumbnail ${s.thumb}, which is not in the manifest`);
}
for (const [id, rec] of Object.entries(built.maps)) if (rec.thumb && !thumbs.has(rec.thumb)) fail(`map ${id} names thumbnail ${rec.thumb}, which is not in the manifest`);
for (const e of built.elections) {
  if (!e.mapless && e.layerId && !layerIds.has(e.layerId) && !mapById.has(e.layerId)) fail(`election ${e.key} names layer ${e.layerId}, which the site does not have`);
}
// The person index points into the elections and its own tables by position: every pointer must land.
const peoplePath = path.join(ROOT, 'data/catalogue/people.json');
if (existsSync(peoplePath)) {
  const doc = JSON.parse(readFileSync(peoplePath, 'utf8'));
  let bad = 0;
  for (const row of doc.people) {
    const okParty = (i) => i === -1 || (Number.isInteger(i) && i >= 0 && i < doc.parties.length);
    const okPlace = (i) => i === -1 || (Number.isInteger(i) && i >= 0 && i < doc.constituencies.length);
    if (!row[1] || !okParty(row[2]) || !okPlace(row[3])) bad += 1;
    for (const c of row[8]) if (!(c[0] >= 0 && c[0] < built.elections.length) || !okPlace(c[1]) || (c.length > 3 && !okParty(c[3]))) bad += 1;
  }
  if (bad) fail(`${bad} people or contests in people.json point at elections, parties or constituencies that do not exist: rebuild it`);
}
// ---- curator fields: kinds, labels, versions in sets, flat sections
const KINDS = new Set(['Boundary', 'Places', 'Statistics']);
for (const s of source.series) {
  if (s.kind && !KINDS.has(s.kind)) fail(`series ${s.id} has kind "${s.kind}"; use Boundary, Places or Statistics`);
  for (const id of Object.keys(s.labels || {})) {
    if (!s.members.includes(id) && !(s.toBeAdded || []).includes(id)) fail(`series ${s.id} labels ${id}, which is not one of its maps`);
  }
}
for (const sub of source.subjects) if (sub.seriesKind && !KINDS.has(sub.seriesKind)) fail(`subject ${sub.id} has seriesKind "${sub.seriesKind}"`);

// ---- quality: what every map in a series needs (Phelim Birch's review, 2026-10-06)
//
// A provider; at least one source link (references, a source download, or the statistic's
// source); and something the map can draw (a file, a tile set or a renderer layer). Failures
// already present when the rule came in are pinned in data/catalogue/quality-baseline.json and
// may only shrink. A map not in that baseline also needs a reviewer's sign-off
// (catalogue.source.json `signedOff`: {id, by, date}) before it may be placed.
const qualityIssues = (id) => {
  const r = mapById.get(id) || {};
  const rec = built.maps[id] || {};
  const issues = [];
  if (!(rec.provider || []).length) issues.push('no provider');
  if (!((r.references || []).length || (r.sourceDownloads || []).length || r.source || (r.downloads && Object.keys(r.downloads).length))) issues.push('no source link');
  if (!(r.files || r.tileUrl || r.origin === 'layer' || r.origin === 'data' || layerIds.has(id) || r.placeholder)) issues.push('nothing to draw');
  return issues;
};
const BASELINE = 'data/catalogue/quality-baseline.json';
const live = {};
for (const s of source.series) for (const id of s.members) { const q = qualityIssues(id); if (q.length) live[id] = q; }
if (process.argv.includes('--update-baseline')) {
  const known = [...new Set(source.series.flatMap((s) => s.members))].sort();
  writeFileSync(path.join(ROOT, BASELINE), `${JSON.stringify({
    about: 'Maps placed before the quality rule (check-catalogue.mjs), and the problems they already had. May only shrink.',
    known, issues: live,
  }, null, 1)}
`);
  console.log(`quality baseline: ${known.length} maps, ${Object.keys(live).length} with known problems`);
}
if (existsSync(path.join(ROOT, BASELINE))) {
  const base = read(BASELINE);
  const known = new Set(base.known || []);
  const signed = new Set((source.signedOff || []).map((x) => x.id));
  for (const [id, issues] of Object.entries(live)) {
    const old = new Set(base.issues?.[id] || []);
    for (const q of issues) if (!old.has(q)) fail(`map ${id}: ${q} (every map in a series needs a provider, a source link and something to draw)`);
  }
  for (const s of source.series) for (const id of s.members) {
    if (!known.has(id) && !signed.has(id)) fail(`map ${id} is new in series ${s.id} and has no sign-off: add {"id": "${id}", "by": "...", "date": "..."} to signedOff once it has been reviewed`);
  }
} else fail(`${BASELINE} is missing: create it with --update-baseline`);

const builtSeries = new Set(built.series.map((s) => s.id));
for (const [card, sid] of Object.entries(built.redirects || {})) if (!builtSeries.has(sid)) fail(`old card ${card} redirects to series ${sid}, which does not exist`);

try {
  execFileSync(process.execPath, ['scripts/catalogue/build-catalogue.mjs', '--check'], { stdio: 'pipe' });
} catch (err) {
  fail(`the built catalogue is stale: run node scripts/catalogue/build-catalogue.mjs (${String(err.stderr || err.stdout || err.message).trim().split('\n').pop()})`);
}

const placeholdersInSeries = source.series.flatMap((s) => s.members.filter((m) => mapById.get(m)?.placeholder));
const toBeAdded = source.subjects.reduce((n, s) => n + (s.toBeAdded?.length || 0), 0) + source.series.reduce((n, s) => n + (s.toBeAdded?.length || 0), 0);
console.log(`catalogue: ${source.shelves.length} shelves, ${source.subjects.length} subjects, ${source.series.length} series; `
  + `${placed.size - toBeAdded} maps in series, ${toBeAdded} listed as to be added, ${placeholdersInSeries.length} placeholders inside series (shown as "to be added").`);
if (errors.length) {
  console.error(`\n${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('catalogue: OK');
