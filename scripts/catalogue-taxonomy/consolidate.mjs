/**
 * Consolidate entries that are one thing named several ways, and show the working.
 *
 * The first entry derivation merged only names that matched once years and BRACKETED
 * qualifiers were stripped. That missed three things, and Townlands ended up as eight cards:
 *
 *   - a lone-entry merge needed a multi-word shared prefix, so "Townlands" never tried
 *   - qualifiers at the FRONT were invisible ("Co. Wicklow Polling Districts")
 *   - synonyms and rendering qualifiers ("Ed Boundaries", "Settlements Generalised 20m")
 *
 * Run with no arguments for a dry run that prints every group it would form. Pass an output
 * path to write the consolidated entries.
 *
 *   node scripts/catalogue-taxonomy/consolidate.mjs                       # dry run
 *   node scripts/catalogue-taxonomy/consolidate.mjs build/.../entries.json
 */
import fs from 'fs';

const IN = 'build/catalogue-prototype/entries.json';
const entries = JSON.parse(fs.readFileSync(IN, 'utf8'));
const out = process.argv[2] || null;

/** Places and bodies that qualify a name without changing what the thing is. */
const PLACES = [
  'co wicklow', 'wicklow', 'mid ulster', 'galway city', 'galway county council', 'galway',
  'roscommon', 'south dublin', 'dublin city council', 'dublin city', 'dublin', 'fingal',
  'monaghan', 'cork city', 'cork', 'westmeath', 'longford',
  'sdcc', 'dcc', 'dlr', 'fcc', 'dun laoghaire rathdown', 'dun laoghaire',
  'osni 50k', 'osni largescale', 'osni', 'niea', 'tii', 'gsni', 'daera', 'cso', 'nisra',
  'eoni', 'opw', 'psni', 'dfi', 'tailte eireann', 'ulster wildlife', 'translink',
  'northern ireland', 'republic of ireland', 'all island', 'pre partition', 'ni',
];
/** Qualifiers describing how a thing is drawn, not which thing it is. */
const FORMS = [
  'generalised 20m', 'generalised', 'ungeneralised', 'points', 'point', 'lines', 'line',
  'polygons', 'polygon', 'open data', 'opendata', 'grouped', 'final recommendations',
];
/** Words that mean the same thing in these names. */
const ALIASES = new Map(Object.entries({
  ed: 'electoral division',
  eds: 'electoral division',
  election: 'electoral',
  nuts2: 'nuts 2',
  nuts3: 'nuts 3',
  // cycle / bike / bicycle are one word in this catalogue
  bike: 'bicycle',
  cycle: 'bicycle',
  cycleway: 'bicycle',
  // a register OF a thing is that thing
  record: '',
  site: '',
  boundary: '',
  area: '',
  zone: 'zone',
}));

/**
 * Entries whose name is generic enough to be swallowed by a national series they have
 * nothing to do with. Both are single Dún Laoghaire-Rathdown layers:
 *   "Administrative Area"  is DLR's own council boundary, NOT the 54 dated editions of
 *                          Northern Ireland's administrative areas 1920-73
 *   "Transport"            is DLR's transport network, not the OSNI 1:50,000 transport series
 * Listed by name rather than guarded by a rule, because the judgement is about what the
 * layer is, which no amount of string handling can recover.
 */
/** Words that pad a name without naming the thing, used only when choosing a card's title. */
const NAME_NOISE = ['record', 'boundaries', 'boundary', 'opendata', 'open data', 'all'];

const KEEP_DISTINCT = new Set(['Administrative Area', 'Transport']);

/**
 * Maps whose display name does not say what they are, so no string rule can place them.
 * Keyed on map id because the names are exactly the thing that is unreliable. The first
 * four were resolved by reading their data.gov.ie records; `all-ireland-townlands` is the
 * all-Ireland townland layer, named "Ireland", which is why Townlands had a stray card.
 */
const RENAME_BY_MAP_ID = new Map(Object.entries({
  'all-ireland-townlands': 'Townlands',
  'oda-map-00093-boundaries': 'Wetlands Survey — Boundaries',
  'oda-map-00625-locations': 'Wetlands Survey — Locations',
  'oda-map-00571-fossit-3-town': 'Fossitt Habitats — Town',
  'oda-map-00224-gzt-current-plan': 'Generalised Zoning Types',
  'dlr-transport': 'Transport Network',
  'tailte-heritage': 'Heritage Features',
  'tailte-hvd-sites': 'Topographic Sites',
}));
const displayName = (entry) => (entry.maps.length === 1 && RENAME_BY_MAP_ID.has(entry.maps[0].id)
  ? RENAME_BY_MAP_ID.get(entry.maps[0].id)
  : entry.name);

/**
 * Placements no rule can reach, because they turn on knowing what a layer is rather than
 * what it is called. Each names the card a map belongs in, "Subject :: Card".
 *
 * These are editorial decisions, applied after the automatic grouping and asserted: a map
 * that cannot be found, or a target subject that does not exist, fails the run rather than
 * being skipped.
 */
const ASSIGN_TO_CARD = new Map(Object.entries({
  // generalised and historic renderings belong with the thing they render
  'tailte-province-boundaries-generalised-20m': 'Counties & Provinces :: Provinces of Ireland',
  'counties-county-boroughs-1915': 'Counties & Provinces :: Counties of Ireland',
  // the two states, and the outline of one of them, are one card
  'ni-1921': 'States & Polities :: Polities',
  'roi-1938': 'States & Polities :: Polities',
  'osni-ni-outline': 'States & Polities :: Polities',
  // one Gaeltacht card: the boundaries, the areas and the language-planning areas
  'tailte-gaeltacht-boundaries-generalised-20m': 'Language & Gaeltacht :: Gaeltacht Areas',
  'roi-gaeltacht-areas': 'Language & Gaeltacht :: Gaeltacht Areas',
  'tailte-gaeltacht-language-planning-area-boundaries-generalised-20m': 'Language & Gaeltacht :: Gaeltacht Areas',
  // the four Garda tiers are one hierarchy, not four subjects
  'roi-garda-regions': 'Public Service Areas :: Garda Areas',
  'roi-garda-divisions': 'Public Service Areas :: Garda Areas',
  'roi-garda-districts': 'Public Service Areas :: Garda Areas',
  'roi-garda-sub-districts': 'Public Service Areas :: Garda Areas',
  // single council layers that are a variant of a national series, not a card of their own
  'dlr-administrative-area': 'Local Government Areas :: Local Authorities',
  'oda-map-00140-electoral-areas-roscommon': 'Electoral Boundaries :: Local Electoral Areas',

  // --- statutory site designations are one thing with a designation axis. They were one
  // card before this work and came apart only because their names share no words.
  'designated-aonb': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',
  'designated-assi': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',
  'designated-nnr': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',
  'designated-ramsar': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',
  'designated-sac': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',
  'designated-spa': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',
  'npws-designated-areas': 'Nature, Habitats & Designated Sites :: Designated & Protected Sites',

  // --- water: bodies by type, protected areas by source, monitoring by programme
  'niea-transitional-water-bodies': 'Water Quality & Monitoring :: Water Bodies',
  'wq-lake-water-bodies': 'Water Quality & Monitoring :: Water Bodies',
  'wq-groundwater-bodies': 'Water Quality & Monitoring :: Water Bodies',
  'wq-wfd-river-water-bodies': 'Water Quality & Monitoring :: Water Bodies',
  'wq-groundwater-dwpa': 'Water Quality & Monitoring :: Drinking-Water Protected Areas',
  'wq-surface-dwpa': 'Water Quality & Monitoring :: Drinking-Water Protected Areas',
  'river-and-lake-monitoring-points-2024': 'Water Quality & Monitoring :: Water Monitoring Points',
  'wq-wfd-monitoring-sites': 'Water Quality & Monitoring :: Water Monitoring Points',
  'dlr-dlr-river-and-bathing-water-sample-points': 'Water Quality & Monitoring :: Water Monitoring Points',
  'sdcc-monthly-river-quality-data-sdcc1': 'Water Quality & Monitoring :: River Water Quality',

  // --- rail: Translink assets in one card, the Tailte network in another
  'translink-rail-halts': 'Rail & Public Transport :: NI Railways Infrastructure',
  'translink-rail-platforms': 'Rail & Public Transport :: NI Railways Infrastructure',
  'translink-rail-bridges': 'Rail & Public Transport :: NI Railways Infrastructure',
  'translink-rail-culverts': 'Rail & Public Transport :: NI Railways Infrastructure',
  'tailte-rail-network': 'Rail & Public Transport :: Rail Network',
  'tailte-hvd-rail-network-segment': 'Rail & Public Transport :: Rail Network',
  'tailte-hvd-rail-points': 'Rail & Public Transport :: Rail Network',

  // --- roads
  'tailte-road-interchanges': 'Roads & Traffic :: Road Junctions & Interchanges',
  'tailte-road-intersections': 'Roads & Traffic :: Road Junctions & Interchanges',
  'tailte-motorway-access-exit-points': 'Roads & Traffic :: Road Junctions & Interchanges',
  'tailte-hvd-way-points': 'Roads & Traffic :: Way Network',
  'tailte-hvd-way-gdf2': 'Roads & Traffic :: Way Network',
  'dcc-traffic-signal-sites-juctions': 'Roads & Traffic :: Traffic Signals',
  'dcc-traffic-signals-and-scats-sites-locations': 'Roads & Traffic :: Traffic Signals',
  'tii-traffic-counter-locations': 'Roads & Traffic :: TII Roadside Sensors',
  'tii-wim-sensor-locations': 'Roads & Traffic :: TII Roadside Sensors',
  'osni-open-data-50k-transport-text-labelling': 'Roads & Traffic :: OSNI 50K Transport',
  'osni-transport-text-labels': 'Roads & Traffic :: OSNI 50K Transport',
  'osni-transport-points': 'Roads & Traffic :: OSNI 50K Transport',
  'osni-open-data-50k-transport-transport-points': 'Roads & Traffic :: OSNI 50K Transport',

  // --- smaller pairs of the same thing
  'dlr-parking-meters': 'Parking :: Parking Meters',
  'dcc-parking-meters-location-tariffs-and-zones-in-dublin-city': 'Parking :: Parking Meters',
  'accessible-parking-spaces-sdcc3': 'Parking :: Accessible Parking',
  'dcc-accessible-parking-spaces': 'Parking :: Accessible Parking',
  'dlr-accessible-parking-bays': 'Parking :: Accessible Parking',
  'dcc-street-lighting-dublin-city': 'Municipal Services & Utilities :: Street Lighting',
  'dlr-dlr-public-lighting': 'Municipal Services & Utilities :: Street Lighting',
  'oda-map-00913-covid-19-hse-daily-booster-vaccination-figures': 'Health :: COVID-19 Vaccination Figures',
  'oda-map-00914-covid-19-hse-daily-vaccination-figures': 'Health :: COVID-19 Vaccination Figures',
  'west-bann-sperrins': 'Regional Divides :: The Bann Divide',
  'east-west-bann': 'Regional Divides :: The Bann Divide',
  'catholic-dublin-parishes': 'Ecclesiastical Areas :: Catholic Dioceses & Parishes',
  'catholic-dioceses': 'Ecclesiastical Areas :: Catholic Dioceses & Parishes',
  'oda-map-00101-dail-constituencies-2013-sdcc': 'Constituencies :: Dáil Éireann Constituencies',
  'gsni-tellus-rural-soil-a-xrf': 'Geophysics & Geochemical Survey :: Tellus Rural Soil',

  // --- cross-subject: filed by a word in the name rather than by what it is
  'transport-carriageway-defects-2021': 'Roads & Traffic :: NI Road Surface Defects',
  'oda-map-00330-cityboundary': 'Local Government Areas :: CityBoundary',
  'oda-map-00647-operational-areas-roscommon': 'Local Government Areas :: Operational Areas - Roscommon',
  'tailte-hvd-building-groups': 'Property & Land Registry :: Building Groups',
  'tailte-hvd-sites': 'Property & Land Registry :: Topographic Sites',
  'nra': 'Housing & Accommodation :: Neighbourhood Renewal Areas',
}));

/** Card names set by hand where the derived one reads badly. */
const CARD_RENAME = new Map(Object.entries({
  'civil-parishes-by-province': 'Civil Parishes',
  'dcc-journey-times-across-dublin-city-from-dublin-city-council-traffic-departments-trips-system': 'Journey Times',
  'dlr-dlr-roads-schedule': 'Roads Schedule',
  'dcc-dcc-public-bin-locations': 'Public Bins',
  'dcc-eligible-entities-for-wifi': 'WiFi4EU Eligible Entities',
  'dlr-coco-markets': 'County Council Markets',
  'oda-map-00205-4dublin-pipeline-all': '4Dublin Pipeline',
}));

/**
 * Maps that are a rendering of ANOTHER map rather than a sibling of it: child id -> parent id.
 *
 * Distinct from ASSIGN_TO_CARD, which says which card a map belongs in. This says a map sits
 * UNDER a specific map inside that card -- the OSNI 1:50,000 and largescale renderings of the
 * 1993 local government districts are two more ways of drawing the same 1993 boundary set, not
 * two more editions beside it. A child is moved into its parent's card if it is not there yet.
 */
const VARIANT_OF = new Map(Object.entries({
  'osni-open-data-50k-boundaries-local-government-districts-1993': 'lgd-1993',
  'osni-open-data-largescale-boundaries-local-government-districts-1993': 'lgd-1993',
  'oda-map-00330-cityboundary': 'roi-settlements-ungeneralised',
  'oda-map-00639-municipal-district': 'roi-municipal-districts-2019',
  // the map with id local-authorities-2024 is the one named "Local Authorities 2019"
  'dlr-administrative-area': 'local-authorities-2024',
  'tailte-nuts2-boundaries-ungeneralised': 'nuts-2-roi',
  'tailte-nuts3-boundaries-generalised-20m': 'nuts-3',
}));

/** Subjects renamed to match what they now hold. */
const SUBJECT_RENAME = new Map(Object.entries({
  'Property & Land Registry': 'Property, Land & Buildings',
  'Housing & Accommodation': 'Housing & Regeneration',
}));

const BRACKET = /\s*\([^)]*\)/g;
const YEAR = /\b(1[6-9]\d{2}|20\d{2})\b/g;

const tokens = (name) => name
  .replace(BRACKET, ' ')
  .replace(YEAR, ' ')
  .replace(/\s+[–—-]\s+[^–—-]+$/, '')          // trailing qualifier
  .toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripList = (s, list) => {
  let v = ` ${s} `;
  for (const item of list) v = v.split(` ${item} `).join(' ');
  return v.replace(/\s+/g, ' ').trim();
};

const singular = (s) => s.split(' ')
  .map((w) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1'))
  .map((w) => (ALIASES.has(w) ? ALIASES.get(w) : w))
  .filter(Boolean)
  .join(' ');

const key = (name) => (KEEP_DISTINCT.has(name)
  ? `keep:${name}`
  : singular(stripList(stripList(tokens(name), PLACES), FORMS)) || tokens(name));

// ---- group within each subject ------------------------------------------------------------
const E_SUBJECTS = entries.map((e) => e.subject);
const bySubject = new Map();
for (const e of entries) {
  if (!bySubject.has(e.subject)) bySubject.set(e.subject, []);
  bySubject.get(e.subject).push(e);
}

/**
 * The name to keep.
 *
 * Shortest-wins alone named the merged wetlands card "Wetlands Survey — Locations" and the
 * merged ringfort card "Ringfort - Rath": one member's name standing for all of them, which
 * reads as though the others were dropped. When the members share a leading run of words,
 * that shared stem IS the name of the thing; the rest is what varies.
 */
const pickName = (group) => {
  const names = group.map(displayName).sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (names.length === 1) return names[0];
  const words = names.map((n) => n.split(/\s+/));
  const shared = [];
  for (let i = 0; i < words[0].length; i++) {
    const w = words[0][i];
    if (!words.every((ws) => ws[i] === w)) break;
    shared.push(w);
  }
  const stem = shared.join(' ').replace(/[\s,;:–—-]+$/, '').trim();
  // The stem is the name only when every member reads as "STEM <separator> qualifier" --
  // "Ringfort - Rath", "Wetlands Survey — Locations".
  // A real separator, not merely a space: "Local Electoral Areas" and "Local Election Areas"
  // share the word "Local", and naming the card "Local" is worse than either member.
  const stemIsName = stem && names.every((n) => /^\s*[–—\-,:(]/.test(n.slice(stem.length)));
  if (stemIsName) return stem;

  // Otherwise score each member by how much of it is qualifier rather than name, and take
  // the cleanest. Tested on the WHOLE name: tokens() drops a trailing qualifier, which made
  // "Polling Districts - Roscommon" look place-free and win.
  const whole = (n) => n.replace(BRACKET, ' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const countIn = (n, list) => list.filter((item) => ` ${whole(n)} `.includes(` ${item} `)).length;
  const scored = names.map((n) => ({
    n,
    places: countIn(n, PLACES),
    noise: countIn(n, FORMS) + countIn(n, NAME_NOISE),
  })).sort((a, b) => a.places - b.places || a.noise - b.noise || b.n.length - a.n.length);
  if (!scored[0].places) return scored[0].n;
  const longest = [...names].sort((a, b) => b.length - a.length)[0];
  let cleaned = longest.replace(BRACKET, ' ').replace(/\s+[–—-]\s+[^–—-]+$/, '');
  for (const p of PLACES) {
    cleaned = cleaned.replace(new RegExp(`\\b${p.replace(/ /g, '[ .]')}\\b`, 'gi'), ' ');
  }
  cleaned = cleaned.replace(/\bOpenData\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s.,-]+|[\s.,-]+$/g, '');
  return cleaned.length >= 4 ? cleaned : longest;
};

const consolidated = [];
const merges = [];
for (const [subject, list] of bySubject) {
  const groups = new Map();
  for (const e of list) {
    const k = key(displayName(e));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [k, group] of groups) {
    if (group.length > 1) merges.push({ subject, key: k, names: group.map((e) => e.name) });
    const maps = group.flatMap((e) => e.maps);
    consolidated.push({
      name: pickName(group),
      subject,
      kind: group[0].kind,
      n: maps.length,
      axis: maps.length === 1 ? null : (group.some((e) => e.axis === 'edition') ? 'edition' : 'variant'),
      maps,
    });
  }
}
// ---- editorial placements -----------------------------------------------------------------
const findCard = (subject, name) => consolidated.find((e) => e.subject === subject && e.name === name);
for (const [mapId, target] of ASSIGN_TO_CARD) {
  const [subject, name] = target.split(' :: ');
  const src = consolidated.find((e) => e.maps.some((m) => m.id === mapId));
  if (!src) throw new Error(`ASSIGN_TO_CARD names a map that is in no entry: ${mapId}`);
  const map = src.maps.find((m) => m.id === mapId);
  let dst = findCard(subject, name);
  if (!dst) {
    dst = { name, subject, kind: src.kind, n: 0, axis: null, maps: [] };
    consolidated.push(dst);
  }
  if (dst === src) continue;
  src.maps = src.maps.filter((m) => m.id !== mapId);
  dst.maps.push(map);
}
// Nest a map under the map it is a rendering of, moving it into that card if needed.
for (const [childId, parentId] of VARIANT_OF) {
  const parentEntry = consolidated.find((e) => e.maps.some((m) => m.id === parentId));
  const childEntry = consolidated.find((e) => e.maps.some((m) => m.id === childId));
  if (!parentEntry) throw new Error(`VARIANT_OF parent is in no entry: ${parentId}`);
  if (!childEntry) throw new Error(`VARIANT_OF child is in no entry: ${childId}`);
  const child = childEntry.maps.find((m) => m.id === childId);
  if (childEntry !== parentEntry) {
    childEntry.maps = childEntry.maps.filter((m) => m.id !== childId);
    parentEntry.maps.push(child);
  }
  child.variantOf = parentId;
}

// Put each variant immediately after the map it belongs to, so the order on screen reads
// as the nesting rather than as a list with the children swept to the end.
for (const e of consolidated) {
  const parents = e.maps.filter((m) => !m.variantOf);
  const kids = e.maps.filter((m) => m.variantOf);
  e.maps = parents.flatMap((p) => [p, ...kids.filter((k) => k.variantOf === p.id)]);
  const orphans = kids.filter((k) => !parents.some((p) => p.id === k.variantOf));
  if (orphans.length) throw new Error(`variant without its parent in the same entry: ${orphans.map((o) => o.id).join(", ")}`);
}

for (const e of consolidated) {
  e.n = e.maps.length;
  e.axis = e.n <= 1 ? null : (e.axis || 'variant');
}
// An entry emptied by the placements above has nothing left to show.
for (let i = consolidated.length - 1; i >= 0; i--) if (!consolidated[i].n) consolidated.splice(i, 1);

for (const [mapId, name] of CARD_RENAME) {
  const card = consolidated.find((e) => e.maps.some((m) => m.id === mapId));
  if (!card) throw new Error(`CARD_RENAME names a map that is in no entry: ${mapId}`);
  card.name = name;
}

// Rename last, so the ASSIGN targets above can keep naming subjects by their old names.
for (const e of consolidated) if (SUBJECT_RENAME.has(e.subject)) e.subject = SUBJECT_RENAME.get(e.subject);

// A subject the placements have emptied should not survive as a heading with nothing in it.
{
  const live = new Set(consolidated.map((e) => e.subject));
  const gone = [...new Set(E_SUBJECTS)].filter((s) => !live.has(s) && !SUBJECT_RENAME.has(s));
  if (gone.length) console.log(`\nsubjects now empty (remove from shelves.mjs): ${gone.join(', ')}`);
}

consolidated.sort((a, b) => b.n - a.n);

// ---- conservation ---------------------------------------------------------------------------
const before = entries.reduce((a, e) => a + e.n, 0);
const after = consolidated.reduce((a, e) => a + e.n, 0);
if (before !== after) throw new Error(`lost maps: ${before} in, ${after} out`);

console.log(`${entries.length} entries -> ${consolidated.length}  (${entries.length - consolidated.length} merged away, ${after} maps conserved)\n`);
console.log(`groups formed: ${merges.length}`);
for (const m of merges.sort((a, b) => b.names.length - a.names.length)) {
  console.log(`  [${m.subject}] ${m.names.length}x  "${m.key}"`);
  console.log(`      ${m.names.join('  |  ')}`);
}

const perSubject = new Map();
for (const e of consolidated) perSubject.set(e.subject, (perSubject.get(e.subject) || 0) + 1);
console.log('\nsubjects with the most entries after consolidation:');
[...perSubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([s, n]) => console.log(`  ${String(n).padStart(3)}  ${s}`));

if (out) {
  fs.writeFileSync(out, JSON.stringify(consolidated, null, 1));
  console.log(`\nwrote ${out}`);
}
