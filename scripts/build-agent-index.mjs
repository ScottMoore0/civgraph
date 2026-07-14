#!/usr/bin/env node
/**
 * Build /agent/maps-index.json — a slim, machine-readable catalogue of Civgraph's
 * interactive map layers for AI agents. Each entry links directly to the layer's
 * FlatGeobuf (.fgb, EPSG:4326) geometry on data.civgraph.net, so an agent can find
 * two maps by name/category and fetch their geometries without touching the
 * (WebGL/MapLibre) UI. Regenerate whenever maps.json changes.
 *
 * Usage: node scripts/build-agent-index.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const doc = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));
const catGroup = new Map((doc.categories || []).map((c) => [c.id, c.group || '']));

const maps = [];
for (const m of doc.maps || []) {
  const fgb = m.files?.fgb || null;
  const geometry = fgb
    ? { format: 'flatgeobuf', crs: 'EPSG:4326', url: fgb }
    : (m.files?.chunkIndex || m.chunkIndex
      ? { format: 'chunked-flatgeobuf', crs: 'EPSG:4326', chunkIndex: m.files?.chunkIndex || m.chunkIndex }
      : null);
  maps.push({
    id: m.id,
    name: m.name,
    category: m.category,
    categoryGroup: catGroup.get(m.category) || undefined,
    provider: Array.isArray(m.provider) ? m.provider : (m.provider ? [m.provider] : undefined),
    date: m.date ?? undefined,
    labelProperty: m.labelProperty || undefined,
    bounds: m.bounds || undefined,
    geometry,
  });
}

// Statistical/attribute overlays (census, deprivation, …): a value table joined
// to a map layer by a key column. Agents can fetch the CSV directly and join it
// to the geometry themselves — no UI needed.
let dataOverlays = [];
try {
  const de = JSON.parse(readFileSync('data/database/data-entries.json', 'utf8')).dataEntries || [];
  dataOverlays = de.map((e) => ({
    id: e.id,
    name: e.name,
    geography: e.geography,
    valueColumn: e.valueColumn,
    joinKey: e.joinKey,
    csv: e.csv ? `https://civgraph.net/${e.csv}` : undefined,
    source: e.source || undefined,
  }));
} catch { /* none */ }

const out = {
  $schema: 'https://civgraph.net/agent/maps-index.schema (informal)',
  generatedFrom: 'data/database/maps.json + data/database/data-entries.json',
  about: 'Civgraph catalogue for AI agents. `maps` links each layer to a FlatGeobuf (.fgb, EPSG:4326) geometry on https://data.civgraph.net. `dataOverlays` links statistical tables (census, NIMDM deprivation, …) as CSVs joined to a map layer by `joinKey`. Fetch the CSV(s) and/or geometry and compute directly — see https://civgraph.net/agent/guide.md.',
  count: maps.length,
  withGeometry: maps.filter((m) => m.geometry).length,
  dataOverlayCount: dataOverlays.length,
  maps,
  dataOverlays,
};
mkdirSync('agent', { recursive: true });
writeFileSync('agent/maps-index.json', JSON.stringify(out, null, 0) + '\n');
console.log(`Wrote agent/maps-index.json: ${maps.length} maps (${out.withGeometry} with fetchable geometry).`);
