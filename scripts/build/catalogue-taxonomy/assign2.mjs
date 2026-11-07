// Assign a subject to the 475 maps that already sit in a hand-authored card.
//
// Card-level assignment would be quicker but wrong: several hand-authored cards are grab-bags
// exactly like the Dublin ones -- "High Value Datasets (Tailte)" holds rail, water, cadastre and
// buildings; "NIEA Catchments, Waste & Water Bodies" says so in its own name. So rules run over
// the MAP name with the card name appended as context, and a grab-bag splits on its own.
import fs from 'fs';

const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const BOUNDARY_SUBJECTS = new Set([
  'Townlands', 'Civil Parishes & Baronies', 'Counties & Provinces', 'States & Polities',
  'Local Government Areas', 'Public Service Areas', 'Electoral Boundaries', 'Constituencies',
  'Census & Statistical Geographies', 'Settlements & Urban Areas', 'Ecclesiastical Areas',
  'Regional Divides',
  'Language & Gaeltacht', 'Administrative Boundaries',
]);
const kindOf = s => (BOUNDARY_SUBJECTS.has(s) ? 'Boundary' : 'Dataset');

const RULES = [
  // ---- named survey programmes, before their subject words scatter them
  ['Geophysics & Geochemical Survey', /tellus (airborne|magnetic|electromagnetic|radiometric)|flight lines|apparent conductivity|stream sediment|regional xrf|platinum group/i],
  ['Historic & Printed Maps', /historical six-inch|printed raster|streetmaps|éire thuaidh|mid-scale raster|1:1m thematic|map sheet coverage|benchmark/i],
  ['Aerial Imagery & Elevation', /orthophoto|lidar|hillshade|copernicus|\bdem\b/i],

  // ---- reference geography, most specific first
  ['Townlands', /townland/i],
  ['Civil Parishes & Baronies', /civil parish|baron/i],
  ['Ecclesiastical Areas', /catholic (parish|diocese)|diocese/i],
  ['Language & Gaeltacht', /gaeltacht/i],
  ['Counties & Provinces', /^counties|counties of ireland|province|county borough/i],
  ['States & Polities', /^northern ireland 1921|^republic of ireland 1921|polit/i],
  ['Constituencies', /constituenc|\bdáil\b|dail |european parliament|ni parliament|assembly/i],
  ['Electoral Boundaries', /electoral (division|area|count)|^wards |^wards$|ward \d|polling district|electoral counties/i],
  ['Elections & Voting', /polling station|election results|referendum counting/i],
  ['Census & Statistical Geographies', /output area|data zone|small area|census grid|travel to work|\bnuts\b|super census|small census/i],
  ['Settlements & Urban Areas', /settlement|built-up area|legal towns|urban areas|centres of population|rural areas/i],
  ['Public Service Areas', /garda|health (and|&) social care trust|education and library board|river basin district/i],
  ['Local Government Areas', /local (authorit|government district)|administrative area|municipal district|administrative count/i],

  // ---- names
  ['Place & Street Names', /place names|street names|geographical names|gazetteer|\blocales\b/i],

  // ---- environment
  ['Municipal Services & Utilities', /landfill|waste site|waste facilit/i],
  ['Flooding & Coastal Risk', /flood/i],
  ['Water Quality & Monitoring', /water quality|water bodies|monitoring site|wfd |transitional water|local management area|stakeholder group/i],
  // a landscape or a world heritage site is not a habitat, even on a card called 'Designated'
  ['Landscape & Scenic Amenity', /landscape character|scenic/i],
  ['Built Heritage & Protected Structures', /world heritage/i],
  ['Nature, Habitats & Designated Sites', /habitat|\bassi\b|\baonb\b|nature reserve|ramsar|designated|special (area|protection)|vegetation/i],
  ['Agriculture & Land Management', /livestock|bovine|caprine|ovine|porcine|poultry|holdings/i],
  ['Noise & Air Quality', /noise|lden|air quality/i],
  ['Geology & Soils', /geolog|bedrock|borehole|karst|superficial|mineral|mining lease|prospecting|core and cuttings|soils/i],
  ['Energy & Climate', /power plant|wind|solar|decarbonis/i],

  // ---- physical geography, last of the subject blocks: these words appear as qualifiers
  // inside thematic names, so they may only claim a row nothing else wanted
  ['Hills & Uplands', /hill (summit|prominence)|hills and mountains|highland|mountains|sperrin/i],
  ['Coasts, Seas & Islands', /seawater|coast|high water mark|low water mark|shore|^seas$|(?<!all-)islands?/i],
  ['Rivers, Lakes & Catchments', /river(s| basin| segment|s 2016)|lake|watercourse|waterfall|reservoir|catchment|hydro|water single stream|water points|bann/i],

  // ---- movement
  ['Cycling & Walking', /cycle|cycling|bicycle|pedestrian crossing|footway/i],
  ['Rail & Public Transport', /rail|luas|tram|translink|bus |glider|halt/i],
  ['Air & Sea Transport', /airfield|airport|runway|ferry|harbour|moorings|slipway|pier/i],
  ['Roads & Traffic', /road|traffic|collision|pothole|carriageway|surface defect|motorway|border (crossing|exits)|transport lines|way points|way gdf/i],

  // ---- built environment and heritage
  ['Archaeology & Monuments', /bullaun|crannog|ringfort|souterrain|monument|sites and monuments|standing stone|cairn|megalith/i],
  ['Built Heritage & Protected Structures', /listed building|heritage|defence heritage|historic site/i],
  ['Property & Land Registry', /land (and|&) property register|cadastral|property register|^march 20|^august 20|^september 20|^april 20/i],
  ['Planning Applications & Registers', /planning application/i],
  ['Deprivation & Regeneration', /neighbourhood renewal|deprivation/i],
  ['Conflict & Segregation', /peaceline|peace wall|interface/i],
  ['Buildings & Sites', /building group|^sites \(|sites \(tailte/i],
];

// Rows the rules cannot decide, or decide wrongly. Keyed on "card :: map".
const CORRECTIONS = {
  'Secondary maps :: West of the Bann and Sperrins': 'Regional Divides',
  'Secondary maps :: East and West of the Bann': 'Regional Divides',
  'Secondary maps :: Major River and Coastal Basins': 'Rivers, Lakes & Catchments',
  'Regions & Boundaries (Republic of Ireland, Tailte Éireann) :: Rural Areas (Tailte Éireann)': 'Settlements & Urban Areas',
  'Physical Features (Republic of Ireland, Tailte Éireann) :: Water (Tailte Éireann)': 'Rivers, Lakes & Catchments',
};

const applied = new Set();
const assign = (cardName, mapName) => {
  const key = `${cardName} :: ${mapName}`;
  if (CORRECTIONS[key]) { applied.add(key); return CORRECTIONS[key]; }
  const hay = `${mapName} ${cardName}`;
  for (const [subject, re] of RULES) if (re.test(hay)) return subject;
  return 'REVIEW';
};

const out = [];
for (const c of cards) for (const m of c.maps) {
  const subject = assign(c.card, m.name);
  out.push({ id: m.id, name: m.name, subject, kind: subject === 'REVIEW' ? '' : kindOf(subject), from: 'card:' + c.card });
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));

const missed = Object.keys(CORRECTIONS).filter(k => !applied.has(k));
if (missed.length) console.log('!! corrections that matched no row:\n   ' + missed.join('\n   '));

const tally = new Map();
out.forEach(r => tally.set(r.subject, (tally.get(r.subject) || 0) + 1));
const left = tally.get('REVIEW') || 0;
console.log(`assigned ${out.length - left} of ${out.length}, ${left} left\n`);
[...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => {
  if (s !== 'REVIEW') console.log(String(n).padStart(4) + '  ' + kindOf(s).padEnd(9) + s);
});
if (left) {
  console.log('\nREVIEW:');
  out.filter(r => r.subject === 'REVIEW').forEach(r => console.log('   ' + r.name + '   [' + r.from + ']'));
}
