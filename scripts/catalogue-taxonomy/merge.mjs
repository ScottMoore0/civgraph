// Merge the two assignment passes into one whole-catalogue subject table.
import fs from 'fs';
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));   // the 283 unfiled
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));   // the 475 already carded
// The two passes were written independently and landed on two names for one subject, and split
// water access two ways. Reconcile here rather than in either pass, so both stay readable.
const RENAME = { 'Public Transport': 'Rail & Public Transport' };
const REHOME = {
  'Angling Stands - Roscommon': 'Sport & Recreation',
  'Beaches (DCC)': 'Coasts, Seas & Islands',
  'Public Moorings and Piers - Roscommon': 'Air & Sea Transport',
  'Public Slipways - Roscommon': 'Air & Sea Transport',
};
// Pass 1 ran before "Constituencies" existed as a subject and swept constituency maps into
// Electoral Boundaries. Pull them back, or the same entry appears under two subjects.
const isConstituency = (name) => /constituenc|\bdáil\b|dail /i.test(name);

// Kind is a property of the SUBJECT, not of the row. The two passes each carried their own
// idea of it, which broke the moment a map moved subject: river basin districts arrived as a
// boundary and moved to a dataset subject, leaving one subject with two kinds.
const BOUNDARY_SUBJECTS = new Set([
  'Townlands', 'Civil Parishes & Baronies', 'Counties & Provinces', 'States & Polities',
  'Regional Divides', 'Ecclesiastical Areas', 'Language & Gaeltacht', 'Local Government Areas',
  'Administrative Boundaries', 'Public Service Areas', 'Electoral Boundaries', 'Constituencies',
  'Census & Statistical Geographies', 'Settlements & Urban Areas',
]);

const all = [...a, ...b].map(r => {
  let subject = REHOME[r.name] || RENAME[r.subject] || r.subject;
  if (subject === 'Electoral Boundaries' && isConstituency(r.name)) subject = 'Constituencies';
  // and a third: the health trusts landed in Administrative Boundaries on one side and
  // Public Service Areas on the other, so the same thing had two subjects
  if (subject === 'Administrative Boundaries' && /social care trust/i.test(r.name)) subject = 'Public Service Areas';
  // river basin DISTRICTS are the management units for the river basins, and belong beside them
  if (/river basin district/i.test(r.name)) subject = 'Rivers, Lakes & Catchments';
  // same drift: pass 1 had no Local Government Areas subject
  if (subject === 'Administrative Boundaries' && /local government district|administrative area|municipal district/i.test(r.name)) subject = 'Local Government Areas';
  return { ...r, subject, kind: BOUNDARY_SUBJECTS.has(subject) ? 'Boundary' : 'Dataset' };
});
if (all.some(r => r.subject === 'Marine & Inland Waterways')) throw new Error('Marine subject survived');
fs.writeFileSync(process.argv[4], JSON.stringify(all, null, 1));

// the two passes were written independently, so check they agree on kind
const kindBySubject = new Map();
const clash = [];
for (const r of all) {
  if (!kindBySubject.has(r.subject)) kindBySubject.set(r.subject, r.kind);
  else if (kindBySubject.get(r.subject) !== r.kind) clash.push(r.subject);
}
if (clash.length) console.log('!! same subject, two kinds:', [...new Set(clash)]);

const tally = new Map();
all.forEach(r => tally.set(r.subject, (tally.get(r.subject) || 0) + 1));
const rows = [...tally.entries()].sort((x, y) => y[1] - x[1]);
const nB = all.filter(r => r.kind === 'Boundary').length;
console.log(`${all.length} maps, ${rows.length} subjects  (${nB} boundary / ${all.length - nB} dataset)\n`);
for (const [s, n] of rows) console.log(String(n).padStart(4) + '  ' + kindBySubject.get(s).padEnd(9) + s);

const thin = rows.filter(([, n]) => n <= 3);
console.log(`\nsubjects with 3 or fewer maps: ${thin.length} (${thin.reduce((t, [, n]) => t + n, 0)} maps)`);
