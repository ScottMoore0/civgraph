// Assign a subject to each of the 283 maps that currently carry none.
//
// The vocabulary was read off the inventory rather than imposed: every subject here has at
// least one map unambiguously about it. Rules are ordered, most specific first, and each rule
// is the argument for its assignment. CORRECTIONS then overrides the rows where a broad rule
// won a row it should not have ("Recycle Bring Banks" is not cycling) or where the name alone
// cannot say what the layer is -- those four were resolved from their data.gov.ie records.
import fs from 'fs';

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// kind: 'Boundary' = reference geography you drape other things on.
//       'Dataset'  = something observed, recorded or proposed at a place.
const BOUNDARY_SUBJECTS = new Set(['Administrative Boundaries', 'Townlands', 'Electoral Boundaries']);
const kindOf = s => (BOUNDARY_SUBJECTS.has(s) ? 'Boundary' : 'Dataset');

const RULES = [
  // named series first, before the generic words inside them can steal the row
  ['Aerial Imagery & Elevation', /orthophoto|lidar|hillshade/i],
  ['Trees, Hedgerows & Woodland', /tree preservation|treelines?|hedgerow|trees and woodland|^trees |wildlife corridor/i],
  ['Landscape & Scenic Amenity', /landscape character|scenic (route|view)|views prospects/i],
  ['Built Heritage & Protected Structures', /protected structure|architectural conservation|conservation area|niah|thatch|industrial heritage|heritage sites|burial ground/i],
  ['Archaeology & Monuments', /monuments and place|record of monuments|historic monument/i],

  // energy and flooding before the development-plan rule, or every Roscommon CDP layer
  // is filed by the document it came from instead of by what it is about
  ['Energy & Climate', /wind (energy|speed)|windfarm|decarbonis|ev charging|solar/i],
  ['Flooding & Coastal Risk', /flood/i],

  ['Development Plans & Zoning', /\b(cdp|lap)\b|development plan|land.?use zoning|use zoning|zoning|local area plan|settlement boundar|core retail|urban influence|opportunity sites|specific local objective|strategic land reserve|institutional lands|mews development|planning scheme|boundary plan areas/i],
  ['Planning Applications & Registers', /planning (application|register|exemption)|derelict site|eia location|certificate of registration|proposed education site/i],

  // elections: districts are geography, the rest is the event
  ['Electoral Boundaries', /polling district|electoral (area|division|county)|^wards|constituenc|local election areas|ed boundaries/i],
  ['Elections & Voting', /polling station|election results/i],

  // movement
  ['Cycling & Walking', /cycleway|cycle (network|infrastructure|parking|counter)|cycling|bicycle|bike|bleeperbike|moby bikes|pedestrian|greenway|trim trail|the metals|right of way/i],
  ['Parking', /parking/i],
  ['Public Transport', /bus corridor|railway|ferry|park and ride/i],
  ['Roads & Traffic', /traffic|road|bridge|speed sign|journey time|variable message|winter service|transport/i],

  // water
  ['Water Quality & Monitoring', /water quality|water sample|river quality|monitoring point|water framework|bathing water/i],
  ['Marine & Inland Waterways', /mooring|slipway|pier|angling|beach|canal/i],

  // land and nature
  ['Nature, Habitats & Designated Sites', /habitat|\bsac\b|designated area|npws|wetland|biodiversity|nature reserve/i],
  ['Land Cover & Land Use', /corine|land cover|land classification|historic land use/i],
  ['Geology & Soils', /geolog|bedrock|borehole|soils|peat/i],

  // people and services
  ['Emergency Services', /fire (station|brigade)|garda|ambulance/i],
  ['Health', /covid|vaccination|hospital/i],
  ['Housing & Accommodation', /housing|residential land|traveller accommodation/i],
  ['Sport & Recreation', /sport|pitch|swimming|leisure centre|tennis|golf|skateboard|\bmuga\b/i],
  ['Parks & Open Space', /park|open space|allotment|community garden|playground/i],
  ['Culture & the Arts', /sculpture|artwork|\bart\b|arts |gallery|galleries|theatre|museum|archive|librar|exhibition|tourism attraction/i],
  ['Community, Education & Civic Facilities', /community (centre|facilit)|adult learning|universit|college|school|places? of worship|council office|local authority office|spacefinder/i],
  ['Enterprise & Economy', /enterprise|market/i],
  ['Municipal Services & Utilities', /waste|recycl|bring bank|civic amenity|public bin|toilet|wifi|pipeline|lighting|water district/i],

  // reference geography last: these words sit inside many of the rules above
  ['Townlands', /townland/i],
  ['Administrative Boundaries', /administrative area|city ?boundary|local government district|social care trust|outline|operational areas|municipal district/i],
];

// name -> subject. Each entry is a row a rule got wrong, or one the name could not decide.
const CORRECTIONS = {
  // resolved from the data.gov.ie record, because the name says nothing
  'Boundaries': 'Nature, Habitats & Designated Sites',            // Roscommon/Longford wetlands survey 2017
  'Locations': 'Nature, Habitats & Designated Sites',             // same survey
  'Fossit 3 - Town': 'Nature, Habitats & Designated Sites',       // Fossitt habitat classification, level 3
  'GZT Current Plan': 'Development Plans & Zoning',               // generalised zoning types, DHLGH
  // a broad rule won a row it should not have
  'Art in the Parks - A Guide to Sculpture in Parks DCC': 'Culture & the Arts',
  'Dlr Unfinished Housing (DLR)': 'Housing & Accommodation',
  'Settlement Flood Zones - Roscommon CDP 2022-2028': 'Flooding & Coastal Risk',
  'Noise Maps From Traffic Sources In Dublin City Council (DCC)': 'Municipal Services & Utilities',
};

const applied = new Set();
const assign = (r) => {
  if (CORRECTIONS[r.name]) { applied.add(r.name); return CORRECTIONS[r.name]; }
  const hay = `${r.name} ${r.keywords}`;
  for (const [subject, re] of RULES) if (re.test(hay)) return subject;
  return 'REVIEW';
};

const out = rows.map(r => {
  const subject = assign(r);
  return { id: r.id, name: r.name, subject, kind: subject === 'REVIEW' ? '' : kindOf(subject), from: r.why };
});
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));

const missed = Object.keys(CORRECTIONS).filter(k => !applied.has(k));
if (missed.length) console.log('!! corrections that matched no row:', missed);

const tally = new Map();
out.forEach(r => tally.set(r.subject, (tally.get(r.subject) || 0) + 1));
const left = tally.get('REVIEW') || 0;
console.log(`assigned ${out.length - left} of ${out.length}, ${left} left for review\n`);
[...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => {
  if (s !== 'REVIEW') console.log(String(n).padStart(4) + '  ' + kindOf(s).padEnd(9) + s);
});
console.log('\nsubjects used:', tally.size - (left ? 1 : 0));
