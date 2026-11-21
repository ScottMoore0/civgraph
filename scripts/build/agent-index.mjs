#!/usr/bin/env node
/**
 * Build /agent/maps-index.json — a slim, machine-readable catalogue of Civgraph's
 * interactive map layers for AI agents. Each entry links directly to the layer's
 * FlatGeobuf (.fgb, EPSG:4326) geometry on data.civgraph.net, so an agent can find
 * two maps by name/category and fetch their geometries without touching the
 * (WebGL/MapLibre) UI. Regenerate whenever maps.json changes.
 *
 * Every map in maps.json is listed, with its `status` in the catalogue's own states (ready, partial,
 * to-be-added; packages/core/src/agent-map-status.mjs). A map to be added keeps its metadata and has no
 * geometry link; a hidden copy or part points at the map it belongs to (`sameAs`, `partOf`).
 *
 * Usage: node scripts/build/agent-index.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { SITE } from '@civgraph/config/node';
import { derivedFromLines } from '@civgraph/core/credits.mjs';
import { agentMapStatuses } from '@civgraph/core/agent-map-status.mjs';

const doc = JSON.parse(readFileSync('data/database/maps.json', 'utf8'));
const catGroup = new Map((doc.categories || []).map((/** @type {{ id: string, group?: string }} */ c) => [c.id, c.group || '']));

// The catalogue source's hidden copies that name the map they duplicate (`to` a map id).
const catalogueSource = JSON.parse(readFileSync('data/catalogue/catalogue.source.json', 'utf8'));
const mapIds = new Set((doc.maps || []).map((/** @type {{ id: string }} */ m) => m.id));
/** @type {Record<string, string>} */
const copyOf = {};
for (const h of catalogueSource.hidden || []) if (h.id && h.to && mapIds.has(h.to)) copyOf[h.id] = h.to;
const statuses = agentMapStatuses(doc.maps || [], copyOf);
const byId = new Map((doc.maps || []).map((/** @type {{ id: string }} */ m) => [m.id, m]));

const maps = [];
for (const m of doc.maps || []) {
  const st = statuses.get(m.id) || { status: 'to-be-added', geometryFrom: null };
  const g = st.geometryFrom ? byId.get(st.geometryFrom) : null;
  const fgb = g?.files?.fgb || null;
  const geometry = fgb
    ? { format: 'flatgeobuf', crs: 'EPSG:4326', url: fgb }
    : (g && (g.files?.chunkIndex || g.chunkIndex)
      ? { format: 'chunked-flatgeobuf', crs: 'EPSG:4326', chunkIndex: g?.files?.chunkIndex || g?.chunkIndex }
      : null);
  maps.push({
    id: m.id,
    name: m.name,
    status: st.status,
    sameAs: st.sameAs,
    partOf: st.partOf,
    category: m.category,
    categoryGroup: catGroup.get(m.category) || undefined,
    provider: Array.isArray(m.provider) ? m.provider : (m.provider ? [m.provider] : undefined),
    // What a layer built from other people's maps was derived from ("Derived from ...").
    derivedFrom: derivedFromLines(m.sourceCredits).length ? derivedFromLines(m.sourceCredits) : undefined,
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
  dataOverlays = de.map((/** @type {Record<string, unknown>} */ e) => ({
    id: e['id'],
    name: e['name'],
    geography: e['geography'],
    valueColumn: e['valueColumn'],
    joinKey: e['joinKey'],
    // The tables are on the data host, as the map app reads them (cdnUrl); civgraph.net answers 404 (site QA 12 Nov).
    csv: e['csv'] ? `${SITE.dataOrigin}/${e['csv']}` : undefined,
    source: e['source'] || undefined,
  }));
} catch { /* none */ }

const out = {
  $schema: `${SITE.origin}/agent/maps-index.schema (informal)`,
  generatedFrom: 'data/database/maps.json + data/database/data-entries.json',
  about: 'Civgraph catalogue for AI agents. `maps` lists every map with its `status` (ready, partial or to-be-added, as in the catalogue) and links each map the site shows to a FlatGeobuf (.fgb, EPSG:4326) geometry on https://data.civgraph.net; a map to be added has no geometry link. `dataOverlays` links statistical tables (census, NIMDM deprivation, …) as CSVs joined to a map layer by `joinKey`. Fetch the CSV(s) and/or geometry and compute directly — see https://civgraph.net/agent/guide.md.',
  count: maps.length,
  withGeometry: maps.filter((m) => m.geometry).length,
  statusCounts: Object.fromEntries(['ready', 'partial', 'to-be-added'].map((k) => [k, maps.filter((m) => m.status === k).length])),
  dataOverlayCount: dataOverlays.length,
  maps,
  dataOverlays,
};
mkdirSync('site/agent', { recursive: true });
writeFileSync('site/agent/maps-index.json', JSON.stringify(out, null, 0) + '\n');
console.log(`Wrote agent/maps-index.json: ${maps.length} maps (${out.withGeometry} with fetchable geometry).`);
