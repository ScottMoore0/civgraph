/**
 * Fold the derived subject/entry/shelf structure into a catalogue document the pane can read.
 *
 * WHY THIS ADDS `subject` RATHER THAN REWRITING `category`
 *
 * The obvious move is to replace `categories` with the 54 subjects and repoint every map's
 * `category` at one. 31 of the 35 existing category ids are referenced literally in build
 * scripts and Functions -- `local-government` alone appears 41 times, and in
 * build-browse-indexes.mjs it is ALSO a bodySlug meaning something else entirely. Repointing
 * them would break the pipeline in ways no catalogue test would catch.
 *
 * So `category` is left exactly as it is and `subject` is added beside it. The pane reads
 * subjects; everything else keeps reading categories; the two can be reconciled later once
 * the new structure has proven itself. Prove first, remove second.
 *
 * Output is data/database/maps-v2.json -- a complete catalogue document, so the pane can load
 * it in place of maps.json behind a flag without a second code path for the data.
 *
 *   node scripts/catalogue-taxonomy/build-catalogue-v2.mjs
 */
import fs from 'fs';

const ROOT = process.cwd();
const P = (p) => `${ROOT}/${p}`;
const read = (p) => JSON.parse(fs.readFileSync(P(p), 'utf8'));

const catalogue = read('data/database/maps.json');
const shelves = read('build/catalogue-prototype/shelves.json');
const entries = read('build/catalogue-prototype/entries.json');
const unrenderable = read('build/catalogue-prototype/subjects-unrenderable.json');

const slug = (s) => String(s)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/**
 * Subject ids reuse an existing category id wherever the subject IS that category under a
 * clearer name, so the two taxonomies line up where they can. Everything else is slugged.
 * Because `category` is untouched, a wrong choice here costs nothing downstream.
 */
const SUBJECT_ID = {
  'Townlands': 'townlands',
  'Civil Parishes & Baronies': 'civil-parishes',
  'Counties & Provinces': 'counties',
  'States & Polities': 'polities',
  'Regional Divides': 'regional-divides',
  'Local Government Areas': 'local-government',
  'Electoral Boundaries': 'electoral-divisions',
  'Census & Statistical Geographies': 'census',
  'Settlements & Urban Areas': 'settlements',
  'Water Quality & Monitoring': 'water-quality',
  'Hills & Uplands': 'hills-and-mountains',
};
const subjectId = (name) => SUBJECT_ID[name] || slug(name);

// ---- subjects, each on exactly one shelf -------------------------------------------------
const subjects = [];
const shelfOfSubject = new Map();
for (const shelf of shelves) {
  for (const s of shelf.subjects) {
    if (shelfOfSubject.has(s.name)) throw new Error(`subject on two shelves: ${s.name}`);
    shelfOfSubject.set(s.name, shelf.name);
    subjects.push({
      id: subjectId(s.name),
      name: s.name,
      kind: s.kind,
      shelf: slug(shelf.name),
    });
  }
}
const dupSubjectIds = subjects.map((s) => s.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dupSubjectIds.length) throw new Error(`subject id collision: ${[...new Set(dupSubjectIds)].join(', ')}`);
const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));

// ---- shelves -----------------------------------------------------------------------------
const shelfDocs = shelves.map((sh, i) => ({
  id: slug(sh.name),
  name: sh.name,
  blurb: sh.blurb,
  order: i,
  subjects: sh.subjects.map((s) => subjectIdByName.get(s.name)),
}));

// ---- entries -----------------------------------------------------------------------------
// A handful of subjects already have a hand-built layout in `c1s` -- constituencies is a
// 33-row three-column grid with era annotations. Those are editorial work that flattening
// would destroy, so an entry carries a pointer to its layout rather than replacing it.
const mapById = new Map(catalogue.maps.map((m) => [m.id, m]));

// Subject per map, renderable or not. Built before the entries so the layout owner below
// can be resolved from it.
const subjectByMapId = new Map();
for (const e of entries) for (const m of e.maps) subjectByMapId.set(m.id, subjectIdByName.get(e.subject));
for (const r of unrenderable) subjectByMapId.set(r.id, subjectIdByName.get(r.subject));

const usedEntryIds = new Set();
const entryDocs = entries.map((e) => {
  let id = `e-${subjectIdByName.get(e.subject)}-${slug(e.name)}`.slice(0, 80);
  let n = 2;
  while (usedEntryIds.has(id)) id = `${id}-${n++}`;
  usedEntryIds.add(id);
  const mapIds = e.maps.map((m) => m.id);
  const missing = mapIds.filter((mid) => !mapById.has(mid));
  if (missing.length) throw new Error(`entry ${e.name} names maps that do not exist: ${missing.join(', ')}`);
  return {
    id,
    name: e.name,
    subject: subjectIdByName.get(e.subject),
    kind: e.kind,
    axis: e.axis,
    mapIds,
    // child map id -> the map it is a rendering of, within this entry
    ...(e.maps.some((m) => m.variantOf) ? { variantOf: Object.fromEntries(e.maps.filter((m) => m.variantOf).map((m) => [m.id, m.variantOf])) } : {}),
  };
});

// A c1 layout spans a whole subject, not one entry: the constituencies grid sets Dáil,
// Westminster and Assembly side by side across 33 rows. Attaching it per entry pinned the
// same layout to 26 of them. It belongs to the subject that owns most of its maps.
for (const c1 of catalogue.c1s || []) {
  // Sections address maps either directly or through a class -- `{classId: 'pre-1921-pcs'}`.
  // Counting only mapId found an owner for one layout of seven.
  const classMaps = new Map((catalogue.classes || []).map((c) => [c.id, c.maps || []]));
  // Three dialects in seven layouts: `{mapId}`, `{classId}`, and `{left, right}` holding bare
  // class ids. Keying on the field name missed the third and left that layout ownerless, so
  // any string that IS a known map or class id counts as a reference.
  const inLayout = [];
  const walk = (n) => {
    if (typeof n === 'string') {
      if (classMaps.has(n)) inLayout.push(...classMaps.get(n));
      else if (mapById.has(n)) inLayout.push(n);
      return;
    }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') Object.values(n).forEach(walk);
  };
  walk(c1);
  const tally = new Map();
  for (const mid of inLayout) {
    const s = subjectByMapId.get(mid);
    if (s) tally.set(s, (tally.get(s) || 0) + 1);
  }
  const owner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!owner) continue;
  const subject = subjects.find((s) => s.id === owner[0]);
  // A subject can own more than one: Electoral Boundaries has both the electoral-divisions
  // grid and the local-government electoral-areas one. A single field silently dropped one.
  if (subject) (subject.c1Ids ||= []).push(c1.id);
}

// ---- subject on every map ------------------------------------------------------------

const maps = catalogue.maps.map((m) => {
  const s = subjectByMapId.get(m.id);
  return s ? { ...m, subject: s } : m;
});
const withoutSubject = maps.filter((m) => !m.subject);

// ---- assertions --------------------------------------------------------------------------
const entryMapIds = entryDocs.flatMap((e) => e.mapIds);
if (new Set(entryMapIds).size !== entryMapIds.length) throw new Error('a map appears in two entries');
for (const e of entryDocs) {
  if (!subjects.some((s) => s.id === e.subject)) throw new Error(`entry ${e.id} names unknown subject ${e.subject}`);
}
for (const sh of shelfDocs) {
  for (const sid of sh.subjects) {
    if (!subjects.some((s) => s.id === sid)) throw new Error(`shelf ${sh.id} names unknown subject ${sid}`);
  }
}

const out = {
  ...catalogue,
  schemaVersion: (catalogue.schemaVersion || 1),
  taxonomyVersion: 2,
  generatedAt: new Date().toISOString(),
  shelves: shelfDocs,
  subjects,
  entries: entryDocs,
  maps,
};
fs.writeFileSync(P('data/database/maps-v2.json'), JSON.stringify(out, null, 1));

const bytes = fs.statSync(P('data/database/maps-v2.json')).size;
console.log(`shelves ${shelfDocs.length}  subjects ${subjects.length}  entries ${entryDocs.length}  maps ${maps.length}`);
console.log(`maps carrying a subject: ${maps.length - withoutSubject.length} of ${maps.length}`);
if (withoutSubject.length) console.log('  without:', withoutSubject.slice(0, 5).map((m) => m.id).join(', '));
console.log(`subjects keeping a hand-built c1 layout: ${subjects.filter((s) => s.c1Ids).length}`);
console.log(`subject ids reused from categories: ${subjects.filter((s) => catalogue.categories.some((c) => c.id === s.id)).length}`);
console.log(`wrote data/database/maps-v2.json (${(bytes / 1048576).toFixed(2)} MB)`);
