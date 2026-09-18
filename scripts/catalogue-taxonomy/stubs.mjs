// Give a subject to the 273 catalogue rows that cannot draw anything yet: 155 stubs with no
// files and 118 hidden rows.
//
// These are assigned differently from the renderable 758, and deliberately so. Most are named by
// a bare year -- "2023", "1912", "1996 Forum" -- so the name rules that classified the renderable
// maps have nothing to bite on. Their CATEGORY is reliable instead: 225 of the 273 are wards or
// electoral divisions. So the mapping below is category-first, with name rules only where the
// category is genuinely mixed. Every category present must be named here or the script fails, so
// a new category cannot arrive unclassified.
//
//   node scripts/catalogue-taxonomy/stubs.mjs <out.json>
import fs from 'fs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const j = JSON.parse(fs.readFileSync(ROOT + 'data/database/maps.json', 'utf8'));

const renderable = m => Object.keys(m.files || {}).length || (m.variants || []).length
  || (m.members || []).length || m.chunked;
const rows = j.maps.filter(m => m.hidden || !renderable(m));

// category -> subject, using the same 54-subject vocabulary as the renderable set
const BY_CATEGORY = {
  'wards': 'Electoral Boundaries',
  'electoral-divisions': 'Electoral Boundaries',
  'hills-and-mountains': 'Hills & Uplands',
  'devolved': 'Constituencies',
  'dail': 'Constituencies',
  'referendums': 'Elections & Voting',
  'water-quality': 'Water Quality & Monitoring',
  'geology-geophysics': 'Geology & Soils',
  'settlements': 'Settlements & Urban Areas',
  'local-government': 'Local Government Areas',
  'census': 'Census & Statistical Geographies',
};

// where the name says something the category does not
const BY_NAME = [
  ['Constituencies', /parliament|assembly|convention|forum|constituenc/i],
  ['Geophysics & Geochemical Survey', /tellus|magnetic|radiometric|electromagnetic/i],
  ['Local Government Areas', /rural and urban district|county borough/i],
];

const BOUNDARY_SUBJECTS = new Set([
  'Townlands', 'Civil Parishes & Baronies', 'Counties & Provinces', 'States & Polities',
  'Regional Divides', 'Ecclesiastical Areas', 'Language & Gaeltacht', 'Local Government Areas',
  'Administrative Boundaries', 'Public Service Areas', 'Electoral Boundaries', 'Constituencies',
  'Census & Statistical Geographies', 'Settlements & Urban Areas',
]);

const missing = [...new Set(rows.map(m => m.category || '-'))].filter(c => !BY_CATEGORY[c]);
if (missing.length) throw new Error(`categories with no subject mapping: ${missing.join(', ')}`);

const out = rows.map(m => {
  const name = m.name || m.id;
  let subject = BY_CATEGORY[m.category];
  for (const [s, re] of BY_NAME) if (re.test(name)) { subject = s; break; }
  return {
    id: m.id,
    name,
    subject,
    kind: BOUNDARY_SUBJECTS.has(subject) ? 'Boundary' : 'Dataset',
    status: m.hidden ? 'hidden' : 'stub',
    from: 'category:' + (m.category || '-'),
  };
});
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));

const tally = new Map();
out.forEach(r => tally.set(r.subject, (tally.get(r.subject) || 0) + 1));
console.log(`${out.length} unrenderable rows (${out.filter(r => r.status === 'stub').length} stub, ${out.filter(r => r.status === 'hidden').length} hidden)\n`);
[...tally.entries()].sort((a, b) => b[1] - a[1])
  .forEach(([s, n]) => console.log(String(n).padStart(4) + '  ' + (BOUNDARY_SUBJECTS.has(s) ? 'Boundary' : 'Dataset ') + '  ' + s));
console.log(`\nsubjects used: ${tally.size}, all from the existing vocabulary`);
