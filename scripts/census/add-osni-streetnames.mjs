#!/usr/bin/env node
/**
 * Item 6 (OSNI vector layers): add the OSNI Open Data Streetnames Gazetteer as an
 * interactive point layer. This is the only OSNI open *vector* dataset not already
 * on Civgraph — the other 24 OSNI GeoJSON layers (boundaries, transport,
 * place-names gazetteer, coverage grids) are already hosted, and the remaining
 * OSNI datasets are raster/LiDAR (out of scope here). The .fgb is already uploaded
 * to R2 at data/maps/communities/OSNI_Streetnames.fgb. Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MAPS = 'data/database/maps.json';
const doc = JSON.parse(readFileSync(MAPS, 'utf8'));
const ID = 'streetnames-gazetteer';
if (doc.maps.some((m) => m.id === ID)) { console.log('already present — no change'); process.exit(0); }

const DS = 'https://admin.opendatani.gov.uk/dataset/8b3953f1-da42-4d98-b2b9-311e7c9c8075/resource';
const geojson = `${DS}/ce3e70dc-92f3-4107-87eb-aaa89f2690ce/download/osni_open_data_-_gazetteer_-_streetnames.geojson`;
const kml = `${DS}/261943bc-26fa-4982-bbd0-6bc1e44fc31f/download/osni_open_data_-_gazetteer_-_streetnames.kml`;
const shp = `${DS}/8ed80001-5c96-4574-afeb-851f34446b0b/download/osni_open_data_-_gazetteer_-_streetnames.zip`;
const csv = `${DS}/84b246cf-acf0-4313-b6dc-5995f8e3f122/download/osni_open_data_-_gazetteer_-_streetnames.csv`;

const record = {
  id: ID,
  name: 'Street Names Gazetteer',
  slug: ID,
  category: 'settlements',
  featured: true,
  provider: ['OSNI'],
  description: 'Geographical index of 25,643 named streets across Northern Ireland, from OSNI Open Data (each point carries the street name and its Unique Street Reference Number / USRN).',
  files: { fgb: 'https://data.civgraph.net/data/maps/communities/OSNI_Streetnames.fgb' },
  style: { color: '#3A7CA5', weight: 2, radius: 3 },
  keywords: ['street names', 'gazetteer', 'usrn', 'roads', 'points', 'osni'],
  labelProperty: 'STREETNAME',
  useLOD: true,
  references: [
    { label: 'OSNI OpenData - Gazetteer - Streetnames - Open Data NI (admin.opendatani.gov.uk)', url: 'https://admin.opendatani.gov.uk/dataset/osni-opendata-gazetteer-streetnames', note: '' },
    { label: 'Street Names Gazetteer — GeoJSON download', url: geojson, note: '' },
    { label: 'Street Names Gazetteer — KML download', url: kml, note: '' },
    { label: 'Street Names Gazetteer — Shapefile (ZIP) download', url: shp, note: '' },
    { label: 'Street Names Gazetteer — CSV download', url: csv, note: '' },
  ],
  sourceDownloads: [
    { label: 'GeoJSON', file: geojson },
    { label: 'KML', file: kml },
    { label: 'Shapefile (ZIP)', file: shp },
    { label: 'CSV', file: csv },
  ],
};

const at = doc.maps.findIndex((m) => m.id === 'place-names-gazetteer');
const insertAt = at >= 0 ? at + 1 : doc.maps.length;
doc.maps.splice(insertAt, 0, record);
writeFileSync(MAPS, JSON.stringify(doc, null, 2) + '\n');
console.log(`Inserted '${ID}' after index ${at} (maps now ${doc.maps.length}).`);
