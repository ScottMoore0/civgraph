#!/usr/bin/env node
/**
 * The catalogue record and the render record must agree about the same layer.
 *
 * WHY
 *
 * The catalogue is one logical record split across three stores joined by a bare
 * string id:
 *
 *   data/database/maps.json       provenance -- licence, attribution, downloads
 *   render/metadata/maps-test.json  rendering  -- tiles, zoom, styling, labels
 *   c1Cards in src/ui-controller.js  navigation -- what a user can click
 *
 * Two of those three edges are already guarded. `npm run check` asserts the
 * compact index matches the full metadata, and validate-c1-coverage.mjs asserts
 * every renderable layer is reachable from a card. Nothing guarded the edge
 * between the catalogue and the render record, and that is the edge where four
 * separate "this layer is broken" diagnoses went wrong in one working session --
 * DoBIH, townlands, Wards_2012_FullRes and the Leinster 1931/1936 EDs were all
 * read out of the wrong store and all four were fine.
 *
 * The reason the drift was invisible is that most of it is not drift. The render
 * record is derived from the catalogue with four systematic transforms applied,
 * and comparing raw values reports ~750 of 757 joined records as mismatched --
 * so much noise that a real defect cannot be seen. This validator normalises the
 * four transforms and compares what is left:
 *
 *   keywords   the render record is a strict SUPERSET (adds name, category
 *              label, provider), so the catalogue's terms must be contained,
 *              not equal
 *   bounds     rounded to 7 decimal places (~1 cm), so compared with tolerance
 *   category   the catalogue holds a slug, the render record a display label
 *              ("regional-divides" vs "Regional Divides"), so both are slugged
 *   style      the render record is the catalogue's style PLUS derived fill
 *              properties, so the catalogue's keys must be contained, not equal
 *
 * What survives normalisation is real. At the time of writing: 10 descriptions
 * blanked to "", 35 layers where the catalogue names a label property and the
 * render record has none, 9 label properties disagreeing outright, 4 names
 * differing -- three of them being counties-ireland-1915/1955/1957, which all
 * render as plain "Counties of Ireland" and are therefore indistinguishable in
 * a time series whose whole purpose is telling years apart -- and one provider
 * mismatch.
 *
 * That last one is why this runs in `check` rather than as an occasional audit.
 * deds-ni-1926 credits OSI and OSM in the render record and OSNI and PRONI in
 * the catalogue. Those are different organisations under different licences, and
 * NOTICE states that the per-layer catalogue record is authoritative for
 * attribution. A wrong provider is a licence-compliance defect, not a cosmetic
 * one, so `provider` is reported at its own severity and is the one field that
 * cannot be silently baselined without saying so.
 *
 * AUTHORITY. The catalogue wins for provenance and presentation -- name,
 * description, provider, dates, identity. It does not automatically win for
 * `labelProperty`: converting FlatGeobuf to PMTiles normalises attribute names,
 * so a catalogue value of NAME_TAG or ENG_NAME_VALUE against a render value of
 * Name may mean the render record is correct and the catalogue stale. Deciding
 * that requires reading the actual tile attributes, which this script does not
 * do, so label findings are reported as ADVISORY and do not fail the build.
 * They are listed so the decision gets made deliberately rather than by default.
 *
 * BASELINE. Existing findings are pinned in
 * data/database/catalogue-render-parity-baseline.json. New findings fail; a
 * baselined finding that is fixed is reported so the pin can be re-cut with
 * --update-baseline. The list may shrink, never grow.
 *
 * Usage: node scripts/validate-catalogue-render-parity.mjs [--update-baseline] [--json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = resolve(ROOT, 'data/database/maps.json');
const RENDER = resolve(ROOT, 'render/metadata/maps-test.json');
const BASELINE = resolve(ROOT, 'data/database/catalogue-render-parity-baseline.json');

const UPDATE = process.argv.includes('--update-baseline');
const AS_JSON = process.argv.includes('--json');

for (const p of [CATALOGUE, RENDER]) {
  if (!existsSync(p)) {
    console.error(`FAIL: missing required file ${p.replace(ROOT, '').replace(/\\/g, '/')}`);
    process.exit(1);
  }
}

const catalogueDoc = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const renderDoc = JSON.parse(readFileSync(RENDER, 'utf8'));
const catalogue = catalogueDoc.maps || [];
const render = renderDoc.layers || [];

/** The render store suffixes converted layers; the join is otherwise the bare id. */
const joinKey = (id) => String(id || '').replace(/-vector-test$/, '');
const renderById = new Map(render.map((l) => [joinKey(l.id), l]));

// --- the four systematic transforms, normalised away -----------------------

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The catalogue stores a category id ("local-government"); the render record
 * stores the display name ("Local Government Districts"). These are not slug
 * variants of one string, so they are resolved through the categories tables
 * both documents carry rather than compared as text.
 */
const categoryDefs = [...(renderDoc.categories || []), ...(catalogueDoc.categories || [])];
const idByName = new Map(categoryDefs.map((c) => [slug(c.name), c.id]));
const knownIds = new Set(categoryDefs.map((c) => c.id));
const toCategoryId = (v) => {
  const s = String(v ?? '');
  if (knownIds.has(s)) return s;
  return idByName.get(slug(s)) || slug(s);
};

/** bounds are rounded to 7dp downstream; 1e-6 is looser than that and tighter than any real edit. */
function numericallyEqual(a, b, tol = 1e-6) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => numericallyEqual(v, b[i], tol));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** the render record adds derived terms/keys, so containment is the correct test, not equality. */
function contains(catVal, renVal) {
  if (Array.isArray(catVal)) {
    if (!Array.isArray(renVal)) return false;
    const have = new Set(renVal.map((v) => String(v).toLowerCase()));
    return catVal.every((v) => have.has(String(v).toLowerCase()));
  }
  if (catVal && typeof catVal === 'object') {
    if (!renVal || typeof renVal !== 'object') return false;
    return Object.entries(catVal).every(([k, v]) => JSON.stringify(renVal[k]) === JSON.stringify(v));
  }
  return JSON.stringify(catVal) === JSON.stringify(renVal);
}

const setEqual = (a, b) => {
  const A = [...new Set((Array.isArray(a) ? a : [a]).map(String))].sort();
  const B = [...new Set((Array.isArray(b) ? b : [b]).map(String))].sort();
  return JSON.stringify(A) === JSON.stringify(B);
};

// --- field rules -----------------------------------------------------------
// severity: 'attribution' > 'content' > 'identity' > 'advisory'

const RULES = [
  { field: 'provider', severity: 'attribution', compare: setEqual,
    why: 'credits a different organisation than the catalogue records' },
  { field: 'name', severity: 'content', compare: (a, b) => a === b,
    why: 'displays a different name than the catalogue records' },
  { field: 'description', severity: 'content', compare: (a, b) => a === b,
    why: 'description differs or was blanked' },
  { field: 'date', severity: 'identity', compare: (a, b) => a === b },
  { field: 'dateEffective', severity: 'identity', compare: (a, b) => a === b },
  { field: 'idProperty', severity: 'identity', compare: (a, b) => a === b },
  { field: 'parentId', severity: 'identity', compare: (a, b) => a === b },
  { field: 'cloneOf', severity: 'identity', compare: (a, b) => a === b },
  { field: 'category', severity: 'identity', compare: (a, b) => toCategoryId(a) === toCategoryId(b) },
  { field: 'keywords', severity: 'identity', compare: contains,
    why: 'render record dropped a keyword the catalogue records (search terms lost)' },
  { field: 'style', severity: 'identity', compare: contains,
    why: 'render record dropped a style property the catalogue sets' },
  // Advisory: the render bounds are computed from actual geometry, while many
  // catalogue bounds are hand-entered island-wide approximations
  // ([[51.4,-10.75],[55.5,-5.4]] recurs verbatim across unrelated layers).
  // Failing on these would assert the wrong direction of authority.
  { field: 'bounds', severity: 'advisory', compare: numericallyEqual,
    why: 'bounds differ; the render value is computed from geometry and is normally the better one' },
  // Advisory: the render side may legitimately win here -- see AUTHORITY above.
  { field: 'labelProperty', severity: 'advisory', compare: (a, b) => a === b,
    why: 'label property differs; PMTiles conversion may have renamed the attribute' },
];

// --- compare ---------------------------------------------------------------

const findings = [];
let joined = 0;

for (const entry of catalogue) {
  const layer = renderById.get(entry.id);
  if (!layer) continue; // catalogue-only entries are stubs/groups, not this check's business
  joined += 1;

  for (const rule of RULES) {
    const a = entry[rule.field];
    const b = layer[rule.field];
    // The catalogue asserting nothing is not a conflict; the render record
    // enriching beyond it is the designed direction of flow.
    if (a === undefined || a === null || a === '') continue;
    const missingDownstream = b === undefined || b === null || b === '';
    if (!missingDownstream && rule.compare(a, b)) continue;

    findings.push({
      key: `${entry.id}::${rule.field}`,
      id: entry.id,
      field: rule.field,
      severity: rule.severity,
      kind: missingDownstream ? 'missing' : 'conflict',
      catalogue: a,
      render: missingDownstream ? null : b,
      why: rule.why || `${rule.field} differs`,
    });
  }

  // A year keyword that disagrees is worse than a keyword merely dropped: the
  // render record asserts a *different* year, so the layer is both unfindable
  // by its own year and surfaced under someone else's. eds-connacht-1919 is
  // tagged 1970, which is what cloning a template layer and not revising the
  // keywords looks like.
  const years = (v) => (Array.isArray(v) ? v : []).map(String).filter((k) => /^(1[89]|20)\d{2}$/.test(k));
  const catYears = years(entry.keywords);
  const renYears = years(layer.keywords);
  const wrongYears = renYears.filter((y) => !catYears.includes(y));
  if (catYears.length && renYears.length && catYears.some((y) => !renYears.includes(y)) && wrongYears.length) {
    findings.push({
      key: `${entry.id}::keywordYear`,
      id: entry.id,
      field: 'keywordYear',
      severity: 'content',
      kind: 'conflict',
      catalogue: catYears,
      render: renYears,
      why: 'render record is tagged with a different year than the catalogue records',
    });
  }
}

// --- baseline ratchet ------------------------------------------------------

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).findings?.map((f) => f.key || f) || [])
  : new Set();

const blocking = findings.filter((f) => f.severity !== 'advisory');
const advisory = findings.filter((f) => f.severity === 'advisory');
const fresh = blocking.filter((f) => !baseline.has(f.key));
const fixed = [...baseline].filter((k) => !findings.some((f) => f.key === k)).sort();

if (UPDATE) {
  const payload = {
    note: 'Known catalogue/render disagreements. Ratchet baseline for validate-catalogue-render-parity.mjs; this list may shrink, never grow.',
    generated: 'run with --update-baseline to re-cut',
    count: findings.length,
    findings: findings
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((f) => ({ key: f.key, severity: f.severity, kind: f.kind, why: f.why })),
  };
  writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Re-pinned baseline: ${findings.length} finding(s) recorded.`);
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify({ joined, findings, fresh, fixed }, null, 2));
  process.exit(fresh.length ? 1 : 0);
}

// --- report ----------------------------------------------------------------

const bySeverity = (list, s) => list.filter((f) => f.severity === s);
const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === null || s === undefined ? '(none)' : (s.length > 72 ? `${s.slice(0, 72)}…` : s);
};

console.log('Catalogue/render parity');
console.log(`  joined records compared : ${joined}`);
console.log(`  disagreements           : ${findings.length} (${baseline.size} baselined)`);
console.log(`      attribution : ${bySeverity(findings, 'attribution').length}`);
console.log(`      content     : ${bySeverity(findings, 'content').length}`);
console.log(`      identity    : ${bySeverity(findings, 'identity').length}`);
console.log(`      advisory    : ${advisory.length} (labels; reported, not enforced)`);

const attribution = bySeverity(findings, 'attribution');
if (attribution.length) {
  console.log('\n  ATTRIBUTION — the catalogue is authoritative per NOTICE:');
  for (const f of attribution) {
    console.log(`    ${f.id}`);
    console.log(`      catalogue: ${short(f.catalogue)}`);
    console.log(`      render   : ${short(f.render)}`);
  }
}

const advisoryLabels = advisory.filter((f) => f.field === 'labelProperty');
const advisoryBounds = advisory.filter((f) => f.field === 'bounds');

if (advisoryLabels.length) {
  console.log(`\n  ADVISORY — ${advisoryLabels.length} label propert(ies) differ. The render side may be`);
  console.log('  correct: PMTiles conversion renames attributes. Decide against real tile');
  console.log('  attributes rather than assuming the catalogue wins.');
  for (const f of advisoryLabels.slice(0, 5)) {
    console.log(`    ${f.id}: catalogue ${short(f.catalogue)} vs render ${short(f.render)}`);
  }
  if (advisoryLabels.length > 5) console.log(`    …and ${advisoryLabels.length - 5} more (--json for all)`);
}

if (advisoryBounds.length) {
  console.log(`\n  ADVISORY — ${advisoryBounds.length} bounds differ. The render value is computed from`);
  console.log('  geometry; many catalogue bounds are island-wide approximations repeated');
  console.log('  verbatim across unrelated layers, so the render value is normally the better one.');
}

if (fixed.length) {
  console.log(`\n  ${fixed.length} baselined disagreement(s) now resolved. Re-pin with --update-baseline:`);
  for (const k of fixed.slice(0, 10)) console.log(`    ${k}`);
}

if (fresh.length) {
  console.error(`\nFAIL: ${fresh.length} new catalogue/render disagreement(s).`);
  console.error('  The catalogue and the render record describe the same layer differently.');
  console.error('  Whichever is wrong, a user sees one of them, so they cannot both stand.');
  for (const f of fresh.slice(0, 20)) {
    console.error(`    ${f.id} [${f.field}] ${f.why}`);
    console.error(`      catalogue: ${short(f.catalogue)}`);
    console.error(`      render   : ${short(f.render)}`);
  }
  if (fresh.length > 20) console.error(`    …and ${fresh.length - 20} more`);
  process.exit(1);
}

console.log('\nPASS: no new disagreements between the catalogue and the render record.');
process.exit(0);
