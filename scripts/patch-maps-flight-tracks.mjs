import { readFileSync, writeFileSync } from 'fs';
const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const entry = {
    id: 'tellus-flight-tracks',
    name: 'Tellus Airborne Survey — Flight Lines',
    slug: 'tellus-flight-tracks',
    category: 'geology-geophysics',
    provider: ['GSNI', 'Tellus', 'BGS'],
    description: 'The actual flight-line pattern flown by the Tellus airborne geophysical survey (2005–2008) — 2 210 individual flight lines at ~250 m spacing across all of Northern Ireland, derived from the raw radiometric sample positions. Toggle on alongside any of the gridded magnetic / electromagnetic / radiometric layers to see where the survey actually sampled the ground; anomalies on the gridded products are most reliable inside dense flight coverage and progressively less reliable on the edges and in gaps. Single inert MultiLineString — non-interactive (no per-line popup, hover, or click) so it doesn\'t compete with the per-feature data layers underneath.',
    files: { fgb: 'https://data.civgraph.net/data/maps/geology/tellus-flight-tracks.fgb' },
    style: { color: '#444444', weight: 0.5, opacity: 0.55 },
    keywords: ['tellus','gsni','geophysics','flight','line','airborne','survey','coverage','tracks'],
    references: [{ label: 'OSNI Open Data — Tellus Radiometrics raw (source)', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-radiometrics', note: '' }]
};

if (!db.maps.find(m => m.id === entry.id)) {
    db.maps.push(entry);
    console.log(`+ ${entry.id}`);
} else {
    console.log(`(skip) ${entry.id}`);
}
writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`Total maps: ${db.maps.length}`);
