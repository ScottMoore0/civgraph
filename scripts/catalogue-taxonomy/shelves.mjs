// Group the 54 subjects into shelves.
//
// Shelves are the browsing layer: a reader scans shelf headings, then subjects, then entries.
// Two decisions are baked in here and both are arguable, so they are stated rather than assumed.
//
// 1. Shelves may mix boundaries and datasets. An Elections shelf that holds constituency
//    boundaries AND polling stations AND results is more useful than one split by kind, and the
//    kind is already on every entry, so it can stay a filter instead of becoming the top split.
//    This is the same conclusion reached about DCAT: carry it as a field, not as shelving.
//
// 2. No shelf is allowed to be a leftovers bin. Every subject named below was placed because it
//    belongs there, and the script fails if a subject is missing, named twice, or unknown.
import fs from 'fs';

const SHELVES = [
  ['Land Divisions',
   'The territorial fabric: the units Ireland has been divided into, from the townland up.',
   ['Townlands', 'Civil Parishes & Baronies', 'Counties & Provinces', 'States & Polities',
    'Regional Divides', 'Ecclesiastical Areas', 'Language & Gaeltacht']],

  ['Government & Administration',
   'Who administers what, and the areas they administer it over.',
   ['Local Government Areas', 'Public Service Areas']],

  ['Elections & Representation',
   'The geography of voting: the areas, where the vote happens, and how it came out.',
   ['Electoral Boundaries', 'Constituencies', 'Elections & Voting']],

  ['People & Places',
   'Where people are, what the places are called, and how they are counted.',
   ['Census & Statistical Geographies', 'Settlements & Urban Areas', 'Place & Street Names',
    'Health', 'Conflict & Segregation']],

  ['Planning & Property',
   'What is proposed, permitted and owned.',
   ['Development Plans & Zoning', 'Planning Applications & Registers', 'Housing & Regeneration',
    'Property, Land & Buildings']],

  ['Transport',
   'Getting about, by every mode.',
   ['Roads & Traffic', 'Cycling & Walking', 'Rail & Public Transport', 'Air & Sea Transport',
    'Parking']],

  ['Heritage & Culture',
   'What was built, what was left behind, and where culture happens.',
   ['Built Heritage & Protected Structures', 'Archaeology & Monuments', 'Culture & the Arts',
    'Historic & Printed Maps']],

  ['Local Services & Amenities',
   'What a council provides and where you go to use it.',
   ['Municipal Services & Utilities', 'Parks & Open Space', 'Sport & Recreation',
    'Community, Education & Civic Facilities', 'Emergency Services', 'Enterprise & Economy']],

  ['Water',
   'Fresh and salt: where it is, how clean it is, and where it goes when it rises.',
   ['Water Quality & Monitoring', 'Rivers, Lakes & Catchments', 'Flooding & Coastal Risk',
    'Coasts, Seas & Islands']],

  ['Environment & Land Use',
   'The living surface, how it is used, and what is done to it.',
   ['Nature, Habitats & Designated Sites', 'Trees, Hedgerows & Woodland',
    'Landscape & Scenic Amenity', 'Land Cover & Land Use', 'Agriculture & Land Management',
    'Energy & Climate', 'Noise & Air Quality']],

  ['Earth & Terrain',
   'What is under the ground and the shape of what is on top of it.',
   ['Geology & Soils', 'Geophysics & Geochemical Survey', 'Hills & Uplands',
    'Aerial Imagery & Elevation']],
];

const entries = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// ---- every subject placed exactly once
const known = new Set(entries.map(e => e.subject));
const placed = new Map();
for (const [shelf, , subs] of SHELVES) {
  for (const s of subs) {
    if (!known.has(s)) throw new Error(`shelf "${shelf}" names an unknown subject: ${s}`);
    if (placed.has(s)) throw new Error(`subject on two shelves: ${s} (${placed.get(s)}, ${shelf})`);
    placed.set(s, shelf);
  }
}
const orphans = [...known].filter(s => !placed.has(s));
if (orphans.length) throw new Error(`subjects on no shelf: ${orphans.join(', ')}`);

// ---- assemble
const out = SHELVES.map(([name, blurb, subs]) => {
  const subjects = subs.map(s => {
    const items = entries.filter(e => e.subject === s);
    return { name: s, kind: items[0].kind, entries: items.length, maps: items.reduce((a, e) => a + e.n, 0) };
  }).sort((a, b) => b.entries - a.entries);
  return {
    name, blurb, subjects,
    entries: subjects.reduce((a, s) => a + s.entries, 0),
    maps: subjects.reduce((a, s) => a + s.maps, 0),
  };
});
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));

const tE = out.reduce((a, s) => a + s.entries, 0);
const tM = out.reduce((a, s) => a + s.maps, 0);
if (tE !== entries.length) throw new Error(`lost entries: ${entries.length} in, ${tE} out`);
console.log(`${SHELVES.length} shelves, ${placed.size} subjects, ${tE} entries, ${tM} maps\n`);
console.log('shelf'.padEnd(30) + 'subj  entries  maps   kinds');
for (const s of out) {
  const b = s.subjects.filter(x => x.kind === 'Boundary').length;
  const mix = b === 0 ? 'dataset' : b === s.subjects.length ? 'boundary' : `${b}B / ${s.subjects.length - b}D`;
  console.log(s.name.padEnd(30) + String(s.subjects.length).padStart(4) + String(s.entries).padStart(9)
    + String(s.maps).padStart(6) + '   ' + mix);
}
const sizes = out.map(s => s.entries).sort((a, b) => a - b);
console.log(`\nentries per shelf: smallest ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, largest ${sizes[sizes.length - 1]}`);
