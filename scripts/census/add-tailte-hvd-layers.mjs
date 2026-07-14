#!/usr/bin/env node
/**
 * A1: register the hosted Tailte Éireann High Value Dataset (HVD) layers as
 * interactive maps. The .fgb files are already converted from the Tailte/OSi
 * ArcGIS GeoJSON exports and hosted on R2 (data/maps/tailte-hvd/…). The largest
 * national HVD datasets (buildings, cadastral-freehold, land-cover, water, ways)
 * are NOT included — they exceed the ArcGIS export / single-PUT limits and would
 * need a chunking pipeline to be usable. Idempotent by id.
 *
 * Usage: node scripts/census/add-tailte-hvd-layers.mjs <hvd-results.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const resultsPath = process.argv[2];
if (!resultsPath) { console.error('usage: add-tailte-hvd-layers.mjs <hvd-results.json>'); process.exit(1); }
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));

const MAPS = 'data/database/maps.json';
const doc = JSON.parse(readFileSync(MAPS, 'utf8'));
const have = new Set(doc.maps.map((m) => m.id));

const CC_BY = 'Creative Commons Attribution 4.0';
const styleFor = (geom) => {
  const g = String(geom).toLowerCase();
  if (g.includes('point')) return { radius: 3, weight: 2 };
  if (g.includes('polygon')) return { weight: 1, fillOpacity: 0.08 };
  return { weight: 2 };
};

let added = 0;
const ids = [];
for (const r of results) {
  if (have.has(r.id)) continue;
  const lic = r.license || CC_BY;
  const datasetUrl = `https://data.gov.ie/dataset/${r.datasetSlug}`;
  doc.maps.push({
    id: r.id,
    name: r.name,
    slug: r.id,
    category: r.category,
    provider: ['Tailte Éireann'],
    description: `${r.feature} — Tailte Éireann / Ordnance Survey Ireland High Value Dataset (${r.featureCount.toLocaleString()} features)${r.notes ? `. ${r.notes}` : ''}`.slice(0, 600),
    files: { fgb: r.fgb },
    style: { color: r.color, ...styleFor(r.geom) },
    keywords: ['tailte éireann', 'osi', 'high value dataset', 'hvd', 'ireland', ...r.feature.toLowerCase().split(/\s+/).slice(0, 3)],
    ...(r.labelProperty ? { labelProperty: r.labelProperty } : {}),
    useLOD: true,
    references: [
      { label: `${r.feature} — Tailte Éireann HVD (data.gov.ie)`, url: datasetUrl, note: lic },
      { label: `${r.feature} — GeoJSON download`, url: r.geojson, note: '' },
    ],
    sourceDownloads: [{ label: 'GeoJSON', file: r.geojson }],
  });
  ids.push(r.id);
  added += 1;
}
writeFileSync(MAPS, JSON.stringify(doc, null, 2) + '\n');
console.log(`Inserted ${added} HVD layers (maps now ${doc.maps.length}).`);
console.log('ids:', ids.join(', '));
