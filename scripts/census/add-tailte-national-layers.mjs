#!/usr/bin/env node
/**
 * Item 7 (Tailte Éireann / OSi national mapping): register the 45 new Tailte open
 * vector layers as interactive maps. Each .fgb is already converted from the
 * Tailte GeoJSON and hosted on R2 (data/maps/tailte/…); this inserts the maps.json
 * records + thematic flat groups. Layers whose geography already exists on Civgraph
 * (counties, baronies, civil parishes, townlands, electoral divisions, small areas,
 * LEAs, constituencies, admin/municipal areas) were excluded upstream; redundant
 * generalisations collapsed to one. Idempotent by id.
 *
 * Usage: node scripts/census/add-tailte-national-layers.mjs <tailte-results.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const resultsPath = process.argv[2];
if (!resultsPath) { console.error('usage: add-tailte-national-layers.mjs <tailte-results.json>'); process.exit(1); }
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));

const MAPS = 'data/database/maps.json';
const doc = JSON.parse(readFileSync(MAPS, 'utf8'));
const have = new Set(doc.maps.map((m) => m.id));

const CC_BY = 'Creative Commons Attribution 4.0';
const styleFor = (geom) => {
  const g = String(geom).toLowerCase();
  if (g.includes('point')) return { radius: 3, weight: 2 };
  if (g.includes('polygon')) return { weight: 1, fillOpacity: 0.08 };
  return { weight: 2 }; // lines / 3D
};

let added = 0;
const byCat = {};
for (const r of results) {
  if (have.has(r.id)) continue;
  const lic = r.license || CC_BY;
  const datasetUrl = `https://data.gov.ie/dataset/${r.datasetSlug}`;
  const rec = {
    id: r.id,
    name: r.name,
    slug: r.id,
    category: r.category,
    provider: ['Tailte Éireann'],
    description: `${r.feature} across the Republic of Ireland (${r.featureCount.toLocaleString()} features), from Tailte Éireann / Ordnance Survey Ireland open data${r.notes ? `. ${r.notes}` : ''}`.slice(0, 600),
    files: { fgb: r.fgb },
    style: { color: r.color, ...styleFor(r.geom) },
    keywords: ['tailte éireann', 'osi', 'ireland', 'republic of ireland', ...r.feature.toLowerCase().split(/\s+/).slice(0, 4)],
    ...(r.labelProperty ? { labelProperty: r.labelProperty } : {}),
    useLOD: true,
    references: [
      { label: `${r.feature} — Tailte Éireann (data.gov.ie)`, url: datasetUrl, note: lic },
      { label: `${r.feature} — GeoJSON download`, url: r.geojson, note: '' },
    ],
    sourceDownloads: [{ label: 'GeoJSON', file: r.geojson }],
  };
  doc.maps.push(rec);
  (byCat[r.category] ||= []).push(r.id);
  added += 1;
}

writeFileSync(MAPS, JSON.stringify(doc, null, 2) + '\n');
console.log(`Inserted ${added} Tailte layers (maps now ${doc.maps.length}).`);
console.log('by category:', JSON.stringify(Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.length]))));
