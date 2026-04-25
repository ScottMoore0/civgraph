/**
 * Item 2: Add three catalogue cards for the raw Tellus airborne flight-line
 * data, hosted by BGS. These are point/line measurements (not gridded) —
 * specialist consumption only, exposed as download-only catalogue entries
 * without an interactive map layer.
 */
import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));
const catId = 'geology-geophysics';

const entries = [
    {
        id: 'tellus-mag-raw',
        name: 'Tellus Magnetic — raw airborne flight-line data',
        slug: 'tellus-mag-raw',
        category: catId,
        provider: ['GSNI', 'Tellus', 'BGS'],
        description: 'Raw magnetometer readings along each Tellus survey flight line — the original point measurements that the gridded "Tellus Magnetic" products on this site are derived from. Typically ~250 m line spacing with samples every ~7 m. Useful only if you want to re-grid with custom parameters or interrogate noise; for a map-style view use the gridded TMI / RTP / RTP-Tilt cards in this category.',
        keywords: ['tellus','gsni','bgs','geophysics','magnetic','airborne','raw','flight line','point data'],
        references: [{ label: 'OSNI Open Data — Tellus Magnetics (raw)', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-magnetics', note: '' }],
        sourceDownloads: [
            { label: 'Tellus Magnetics raw (ZIP, 952 MB)', file: 'http://resources.bgs.ac.uk/gsni/geophysics/Magnetics.zip' }
        ]
    },
    {
        id: 'tellus-em-raw',
        name: 'Tellus Electromagnetic — raw airborne flight-line data',
        slug: 'tellus-em-raw',
        category: catId,
        provider: ['GSNI', 'Tellus', 'BGS'],
        description: 'Raw multi-frequency airborne EM coil readings along each Tellus flight line — the original point measurements behind the gridded conductivity products. Frequencies 912 Hz, 3 kHz, 11.9 kHz, and 24.5 kHz at the same line/sample spacing as the magnetic data.',
        keywords: ['tellus','gsni','bgs','geophysics','electromagnetic','em','airborne','raw','flight line','conductivity'],
        references: [{ label: 'OSNI Open Data — Tellus Electromagnetics (raw)', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-electromagnetics', note: '' }],
        sourceDownloads: [
            { label: 'Tellus Electromagnetics raw (ZIP, 366 MB)', file: 'http://resources.bgs.ac.uk/gsni/geophysics/Electromagnetics.zip' }
        ]
    },
    {
        id: 'tellus-rad-raw',
        name: 'Tellus Radiometric — raw airborne flight-line data',
        slug: 'tellus-rad-raw',
        category: catId,
        provider: ['GSNI', 'Tellus', 'BGS'],
        description: 'Raw airborne gamma-ray spectrometer readings along each Tellus flight line — K, U, Th window counts plus total count, before gridding into the radiometric maps already on this site. Useful for re-processing or quality-assessing the gridded products.',
        keywords: ['tellus','gsni','bgs','geophysics','radiometric','gamma','airborne','raw','flight line','potassium','uranium','thorium'],
        references: [{ label: 'OSNI Open Data — Tellus Radiometrics (raw)', url: 'https://admin.opendatani.gov.uk/dataset/gsni-tellus-regional-airborne-geophysical-survey-radiometrics', note: '' }],
        sourceDownloads: [
            { label: 'Tellus Radiometrics raw (ZIP, 56 MB)', file: 'http://resources.bgs.ac.uk/gsni/geophysics/Radiometrics.zip' }
        ]
    }
];

const seen = new Set(db.maps.map(m => m.id));
let added = 0;
for (const e of entries) {
    if (seen.has(e.id)) continue;
    db.maps.push(e);
    added++;
    console.log(`+ ${e.id}`);
}
writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`${added} entries added. Total: ${db.maps.length}`);
