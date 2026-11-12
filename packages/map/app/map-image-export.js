/**
 * "Download SVG": a map as an SVG in the style of Wikipedia's locator maps
 * (e.g. Commons File:FermanaghSouthTyrone2024Constituency.svg), and the same drawing as a PNG.
 *
 * Style, measured from the Commons file and treated as authoritative:
 *   features #ffc8c8, outlines #232323 at 0.74px, the selected feature #ff0000, the outer
 *   outline (the union of the features, under them) #f3a6b2, and no sea fill. An election map
 *   is filled with each area's winning-party colour on white strokes, as the Commons election
 *   maps are, and the selected area keeps its party colour with a heavy black outline, since
 *   red would read as a party.
 *
 * Geometry comes from the map's source FlatGeobuf (whole features, read by bounding box over
 * HTTP range requests), never from the rendered tiles, which are clipped and simplified per
 * tile. The frame is the current view, in Web Mercator like the map on screen: at the scale
 * of Ireland Mercator is conformal and its scale changes by about 3% across Northern Ireland,
 * so the drawing matches what the reader framed. Coordinates are simplified to a third of an
 * output pixel.
 *
 * Neighbouring land (Great Britain, the Isle of Man, the rest of the island of Ireland, the
 * Continent) is drawn grey under the features from assets/map/context-land.json, built by
 * scripts/build/svg-context-land.py from Civgraph's OSNI / Tailte Eireann outlines and
 * Natural Earth (public domain).
 *
 * The major loughs (Neagh, Erne, Strangford, Foyle, Carlingford, Corrib, Derg, Ree, ...) are cut
 * out of the land, the outline and the features and left unfilled like the sea, as on the Commons
 * maps: boundary data such as OSNI's constituencies shares them among the areas. The cut is an
 * even-odd clip path in the projected drawing, so the file stays a single plain SVG; the shores
 * are drawn along it, dark where they cross the features. Their outlines are
 * assets/map/context-loughs.json, built by scripts/build/svg-context-loughs.py.
 */
import dataService, { resolveMapDownloadUrl } from '../../../src/data-service.js';
import { compositeChildIds } from '../../../src/map-relations.mjs';
import { SITE } from '../../config/src/config.js';
import { siteNumber } from '../../core/src/format.js';
import { EXPORT_COLOURS } from '../src/colours.mjs';

export const WIKI_STYLE = Object.freeze({
  fill: EXPORT_COLOURS.fill,
  stroke: EXPORT_COLOURS.stroke,
  strokeWidth: 0.74,
  selected: EXPORT_COLOURS.selected,
  outline: EXPORT_COLOURS.outline,
  land: EXPORT_COLOURS.land,
  coast: EXPORT_COLOURS.coast,
  electionStroke: EXPORT_COLOURS.electionStroke,
  electionSelectedStroke: EXPORT_COLOURS.electionSelectedStroke,
  electionUnmatched: EXPORT_COLOURS.electionUnmatched
});

/** More features than this in view and the export stops and asks the reader to zoom in. */
export const MAX_FEATURES = 6000;
const TARGET_WIDTH = 800;
const CONTEXT_LAND_URL = '/assets/map/context-land.json';
const CONTEXT_LOUGHS_URL = '/assets/map/context-loughs.json';
const LICENCE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

const NAME_KEYS = ['Name', 'name', 'NAME', 'PC_NAME', 'CONSTITUENCY', 'Constituency', 'CON_NAME', 'ENGLISH', 'English_Name',
  'FinalR_DEA', 'DEA', 'DEANAME', 'WARDNAME', 'LGDNAME', 'COUNTY', 'PARISH', 'BARONY', 'TOWNLAND', 'Const_Nm'];

let contextLandPromise = null;
let contextLoughsPromise = null;

/* ------------------------------------------------------------------ projection */

const RAD = Math.PI / 180;
const mercX = (lon) => lon * RAD;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * RAD / 2));

export function createFrame(bounds, width = TARGET_WIDTH) {
  const [west, south, east, north] = bounds;
  const x0 = mercX(west);
  const x1 = mercX(east);
  const y0 = mercY(south);
  const y1 = mercY(north);
  const scale = width / (x1 - x0);
  const height = Math.max(1, Math.round((y1 - y0) * scale));
  return {
    bounds,
    width,
    height,
    project: (lon, lat) => [(mercX(lon) - x0) * scale, (y1 - mercY(lat)) * scale]
  };
}

/* ------------------------------------------------------------------ geometry helpers */

/** Douglas-Peucker on a projected ring or line (iterative; keeps first and last points). */
export function simplifyPoints(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  // A cheap radial pass first: dense source data can carry dozens of points per pixel.
  const radial = [points[0]];
  const r2 = (tolerance / 2) ** 2;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = radial[radial.length - 1];
    const dx = points[i][0] - prev[0];
    const dy = points[i][1] - prev[1];
    if (dx * dx + dy * dy >= r2) radial.push(points[i]);
  }
  radial.push(points[points.length - 1]);
  const n = radial.length;
  if (n <= 2) return radial;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = radial[first];
    const [bx, by] = radial[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = radial[i];
      let d;
      if (len2 === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d > maxD) { maxD = d; index = i; }
    }
    if (maxD > tol2 && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return radial.filter((_, i) => keep[i]);
}

function ringArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return area / 2;
}

function bboxOf(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Sutherland-Hodgman clip of a closed ring to a rectangle (used for the context land only). */
function clipRing(points, [minX, minY, maxX, maxY]) {
  const edges = [
    (p) => p[0] >= minX, (p) => p[0] <= maxX, (p) => p[1] >= minY, (p) => p[1] <= maxY
  ];
  const cut = [
    (a, b) => [minX, a[1] + (b[1] - a[1]) * (minX - a[0]) / (b[0] - a[0])],
    (a, b) => [maxX, a[1] + (b[1] - a[1]) * (maxX - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (minY - a[1]) / (b[1] - a[1]), minY],
    (a, b) => [a[0] + (b[0] - a[0]) * (maxY - a[1]) / (b[1] - a[1]), maxY]
  ];
  let output = points;
  for (let e = 0; e < 4 && output.length; e += 1) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      const inCurrent = edges[e](current);
      const inPrevious = edges[e](previous);
      if (inCurrent) {
        if (!inPrevious) output.push(cut[e](previous, current));
        output.push(current);
      } else if (inPrevious) {
        output.push(cut[e](previous, current));
      }
    }
  }
  return output;
}

const fmt = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** "M x,y l dx,dy ... z" with relative steps computed from rounded positions (no drift). */
export function pathData(rings, { close = true } = {}) {
  const parts = [];
  for (const ring of rings) {
    if (!ring || ring.length < 2) continue;
    let px = Math.round(ring[0][0] * 100);
    let py = Math.round(ring[0][1] * 100);
    let d = `M${fmt(px / 100)},${fmt(py / 100)}`;
    const steps = [];
    const last = close && ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1 : ring.length;
    for (let i = 1; i < last; i += 1) {
      const qx = Math.round(ring[i][0] * 100);
      const qy = Math.round(ring[i][1] * 100);
      if (qx === px && qy === py) continue;
      steps.push(`${fmt((qx - px) / 100)},${fmt((qy - py) / 100)}`);
      px = qx;
      py = qy;
    }
    if (!steps.length) continue;
    d += `l${steps.join(' ').replace(/ -/g, '-')}`;
    if (close) d += 'z';
    parts.push(d);
  }
  return parts.join('');
}

/* ------------------------------------------------------------------ text helpers */

const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 forbids.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** "Fermanagh and South Tyrone" -> "FermanaghAndSouthTyrone", as Wikipedia's ids read. */
export function svgId(name, used) {
  const ascii = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let id = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w[0].toUpperCase() + w.slice(1))).join('') || 'Feature';
  if (!/^[A-Za-z_]/.test(id)) id = `F${id}`;
  let unique = id;
  for (let n = 2; used.has(unique); n += 1) unique = `${id}-${n}`;
  used.add(unique);
  return unique;
}

const slugify = (value) => String(value || 'map').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'map';

function featureName(properties, labelProperty) {
  const keys = [labelProperty, ...NAME_KEYS].filter(Boolean);
  for (const key of keys) {
    const value = properties?.[key];
    if ((typeof value === 'string' && value.trim()) || typeof value === 'number') return String(value).trim();
  }
  const fallback = Object.entries(properties || {}).find(([key, value]) => typeof value === 'string' && value.trim()
    && /(name|title|label|dea|ward|district|constituency|county)/i.test(key));
  return fallback ? fallback[1].trim() : '';
}

/* ------------------------------------------------------------------ data */

/** Largest file read whole when it has no spatial index (bbox reads have no such limit). */
const MAX_WHOLE_FILE_BYTES = 40 * 1024 * 1024;

/**
 * The FlatGeobuf to read geometry from. The catalogue's download link can point at
 * archive.org, which sends no CORS headers, so a copy on Civgraph's own bucket (or this site)
 * is preferred; the download link is the fallback.
 */
export function resolveVectorSourceUrl(mapConfig) {
  if (!mapConfig) return null;
  const candidates = [
    typeof mapConfig.files === 'object' && mapConfig.files ? mapConfig.files.fgb : null,
    mapConfig.downloads?.fgb,
    mapConfig.sourceFile,
    resolveMapDownloadUrl(mapConfig)
  ].filter((value) => typeof value === 'string' && /\.fgb(\?|$)/i.test(value));
  const ownHost = (value) => /^https:\/\/data\.civgraph\.net\//i.test(value) || value.startsWith('/') || !/^[a-z]+:/i.test(value);
  return candidates.find(ownHost) || candidates.find((value) => /^https?:\/\//i.test(value)) || null;
}

function rewriteForLocalDev(url) {
  // The same rule as src/fgb-worker.js: the dev server proxies R2 at /_r/ on localhost.
  const dataOrigin = `${SITE.dataOrigin}/`;
  if (typeof location !== 'undefined' && location.hostname === 'localhost' && url.startsWith(dataOrigin)) {
    return url.replace(dataOrigin, `${location.origin}/_r/`);
  }
  return url;
}

async function readFeaturesInBounds(fgb, url, bounds, limit, onProgress) {
  const [minX, minY, maxX, maxY] = bounds;
  const rect = { minX, minY, maxX, maxY };
  const out = [];
  const take = (feature) => {
    out.push(feature);
    if (out.length > limit) {
      const error = new Error(`More than ${siteNumber(limit)} features are in view. Zoom in to export a smaller area.`);
      error.code = 'too-many-features';
      throw error;
    }
    if (out.length % 250 === 0) onProgress?.(`Reading features… ${siteNumber(out.length)}`);
  };
  try {
    for await (const feature of fgb.deserialize(rewriteForLocalDev(url), rect)) take(feature);
    return out;
  } catch (error) {
    if (error.code === 'too-many-features') throw error;
    // A file with no spatial index cannot be read by bounding box: read it whole, then filter.
    console.warn('[map-image-export] bbox read failed, reading the whole file', error);
  }
  out.length = 0;
  const response = await fetch(rewriteForLocalDev(url));
  if (!response.ok) throw new Error(`Could not read the map's data file (${response.status}).`);
  const size = Number(response.headers.get('content-length') || 0);
  if (size > MAX_WHOLE_FILE_BYTES) {
    response.body?.cancel?.();
    throw new Error("This map's data file is too large to read without a spatial index. Download the FlatGeobuf instead.");
  }
  for await (const feature of fgb.deserialize(response.body)) {
    const box = geometryBbox(feature.geometry);
    if (box && box[0] <= maxX && box[2] >= minX && box[1] <= maxY && box[3] >= minY) take(feature);
  }
  return out;
}

function geometryBbox(geometry) {
  if (!geometry) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    for (const part of c) walk(part);
  };
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries || []) { const b = geometryBbox(g); if (b) { walk([[b[0], b[1]], [b[2], b[3]]]); } }
  } else if (geometry.coordinates) walk(geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Split a GeoJSON geometry into polygons (arrays of rings), lines and points, in lon/lat. */
function explode(geometry, out = { polygons: [], lines: [], points: [] }) {
  if (!geometry) return out;
  const c = geometry.coordinates;
  switch (geometry.type) {
    case 'Polygon': out.polygons.push(c); break;
    case 'MultiPolygon': for (const p of c) out.polygons.push(p); break;
    case 'LineString': out.lines.push(c); break;
    case 'MultiLineString': for (const l of c) out.lines.push(l); break;
    case 'Point': out.points.push(c); break;
    case 'MultiPoint': for (const p of c) out.points.push(p); break;
    case 'GeometryCollection': for (const g of geometry.geometries || []) explode(g, out); break;
    default: break;
  }
  return out;
}

/** [x0, y0, dx1, dy1, ...] integers (degrees x q) to [[lon, lat], ...]. */
function decoder(q) {
  return (flat) => {
    const points = [];
    let x = 0; let y = 0;
    for (let i = 0; i < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      points.push([x / q, y / q]);
    }
    return points;
  };
}

export async function loadContextLoughs(url = CONTEXT_LOUGHS_URL) {
  if (!contextLoughsPromise) {
    contextLoughsPromise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not load the lough outlines (${response.status}).`);
      return response.json();
    }).then((doc) => {
      const decode = decoder(doc.quantisation || 10000);
      return {
        credits: doc.credits || [],
        loughs: (doc.features || []).map((f) => ({
          name: f.name,
          kind: f.kind,
          polygons: (f.rings || []).map((poly) => poly.map(decode)),
          shore: f.shore ? f.shore.map(decode) : null
        }))
      };
    }).catch((error) => {
      contextLoughsPromise = null;
      throw error;
    });
  }
  return contextLoughsPromise;
}

export async function loadContextLand(url = CONTEXT_LAND_URL) {
  if (!contextLandPromise) {
    contextLandPromise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not load the neighbouring-land outline (${response.status}).`);
      return response.json();
    }).then((doc) => {
      const decode = decoder(doc.quantisation || 10000);
      return {
        credits: doc.credits || [],
        land: doc.features.filter((f) => f.kind === 'land').map((f) => ({ name: f.name, polygons: f.rings.map((poly) => poly.map(decode)) })),
        borders: doc.features.filter((f) => f.kind === 'border').map((f) => ({ name: f.name, lines: f.lines.map(decode) }))
      };
    }).catch((error) => {
      contextLandPromise = null;
      throw error;
    });
  }
  return contextLandPromise;
}

/* ------------------------------------------------------------------ selection and elections */

function selectionMatcher(selection, labelProperty) {
  if (!selection) return () => 0;
  const props = { ...(selection.properties || {}) };
  // The selection's name: given by the caller, else read from its properties as the map's name
  // field reads (an election's enriched feature names the area as its Constituency).
  const nameText = selection.name
    || featureName(props, labelProperty)
    || (typeof props.Constituency === 'string' ? props.Constituency : '');
  const name = nameText ? String(nameText).trim().toLowerCase() : '';
  // Row ids (OBJECTID, FID, civ_fid) and measured floats (areas, lengths, elevations) differ
  // between a tile and its source for the same feature, so they neither confirm nor refute.
  const ignored = /^(civ_fid|fid|ogc_fid|objectid(_\d+)?|gid|uid|id|shape_{1,2}(area|length|leng)|st_area\(shape\)|st_length\(shape\)|area|perimeter|election|constituency|winning party|winner|leading party|leading candidate|leading votes|vote share|turnout|majority|majority share|seats won|seats|quota|electorate|valid poll|(min|max|mean)elev_(m|ft))$/i;
  const entries = Object.entries(props).filter(([key, value]) => !ignored.test(key)
    && value !== null && value !== undefined && value !== '' && typeof value !== 'object'
    && !(typeof value === 'number' && !Number.isInteger(value)));
  // Score each source feature: shared properties that agree count for it, ones that disagree
  // count against it, and the name agreeing counts most.
  return (properties, nameOfFeature) => {
    let matches = 0;
    let mismatches = 0;
    for (const [key, value] of entries) {
      if (!(key in properties)) continue;
      const other = properties[key];
      if (other === null || other === undefined) continue;
      const same = String(other).trim() === String(value).trim()
        || (other !== '' && Number.isFinite(Number(other)) && Number(other) === Number(value));
      if (same) matches += 1;
      else mismatches += 1;
    }
    if (name && nameOfFeature && nameOfFeature.trim().toLowerCase() === name) matches += 3;
    const score = matches - 2 * mismatches;
    return matches > 0 && score > 0 ? score : 0;
  };
}

/** The election that colours this map, if there is one: { colourFor(properties), legend, title }. */
function electionColouring(app, mapIds) {
  const em = app?.elections;
  if (!em?.activeBundle || !em.activeEntry) return null;
  const backing = new Set(em.getActiveElectionBackingLayerIds?.() || []);
  const styleMapId = em.getActiveElectionStyleSourceMapId?.() || em.activeBundle.sourceMapId;
  if (!styleMapId || !mapIds.some((id) => id === styleMapId || backing.has(id))) return null;
  const bundle = em.activeBundle;
  const mode = em.activeMode || 'winner';
  const partyMode = mode === 'winner' || mode === 'leadingParty';
  const results = em.resultsByLayer?.get(styleMapId)
    || em.resultsByLayer?.get(bundle.layerId)
    || em.resultsByLayer?.get(bundle.sourceMapId);
  const tally = new Map();
  return {
    styleMapId,
    title: bundle.displayTitle || em.activeEntry.displayTitle || `${bundle.body || 'Election'} ${bundle.date || ''}`.trim(),
    date: bundle.date || '',
    modeLabel: partyMode ? (mode === 'winner' ? 'winning party' : 'leading party') : mode,
    colourFor(properties, name) {
      let result = null;
      try {
        result = em.findResultForFeature(results, { mapId: styleMapId, properties, featureName: name, name });
      } catch (error) {
        console.warn('[map-image-export] election lookup failed', error);
      }
      if (!result) return { colour: WIKI_STYLE.electionUnmatched, party: '', matched: false };
      const colour = em.colourForMode(mode, result) || WIKI_STYLE.electionUnmatched;
      const party = partyMode ? (mode === 'winner' ? (result.winnerParty || result.leadingParty) : result.leadingParty) || '' : '';
      if (party) {
        const key = `${party}|${colour}`;
        if (!tally.has(key)) tally.set(key, { party, colour, count: 0 });
        tally.get(key).count += 1;
      }
      return { colour, party, matched: true };
    },
    legend: () => [...tally.values()].sort((a, b) => b.count - a.count || a.party.localeCompare(b.party))
  };
}

function currentSelection(app, mapIds) {
  const controller = app?.mapController;
  let selected = controller?.renderer?.selected;
  if (!selected) {
    // A click outside the map (on the download itself) clears the highlight; the feature still
    // counts as selected while its details box is open.
    const info = typeof document !== 'undefined' ? document.getElementById('featureInfo') : null;
    if (info && !info.classList.contains('hidden') && app._lastClearedSelection) selected = app._lastClearedSelection;
  }
  if (!selected) return null;
  const mainId = controller.testToMain?.get(selected.layerId) || selected.layerId;
  const record = controller.renderer?.layers?.get(selected.layerId);
  const sourceMapId = record?.config?.sourceMapId;
  if (!mapIds.includes(mainId) && !mapIds.includes(sourceMapId)) return null;
  return { properties: selected.properties || {}, id: selected.id };
}

/* ------------------------------------------------------------------ metadata */

async function describeSources(app, mapIds) {
  const credits = [];
  const references = [];
  for (const id of mapIds) {
    const config = dataService.getMapById(id) || {};
    const layer = app?.mapController?.resolveLayer?.(id) || null;
    if (layer?.id) await app.metadataService?.loadLayerDetails?.(layer.id).catch(() => null);
    const detailed = (layer?.id && app.metadataService?.getLayer?.(layer.id)) || layer || {};
    const provider = [config.provider, detailed.provider].flat(2).filter(Boolean);
    const licence = detailed.license || detailed.licence || config.license || config.licence || '';
    const name = config.name || detailed.name || id;
    credits.push(`${name}: ${[...new Set(provider)].join(', ') || 'source as recorded on Civgraph'}${licence ? ` (${licence})` : ''}`);
    for (const ref of [...(config.references || []), ...(detailed.references || [])]) {
      const url = ref?.url || ref?.file;
      if (url && /^https?:/i.test(url) && !references.some((r) => r.url === url)) references.push({ label: ref.label || url, url });
    }
  }
  return { credits, references: references.slice(0, 3) };
}

/* ------------------------------------------------------------------ main */

/**
 * Build the SVG for one map in the current view.
 * options: { selection?: { properties, name }, width?, onProgress?(text), contextLandUrl? }
 * Returns { svg, filename, width, height, featureCount, selectedName, election }.
 */
export async function buildMapSvg(app, mapId, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const controller = app?.mapController;
  const map = controller?.map;
  if (!map) throw new Error('The map is not ready yet.');

  // Which maps to draw: an election's map when this map is behind the active election.
  let election = electionColouring(app, [mapId]);
  const drawId = election?.styleMapId || mapId;
  const mainConfig = dataService.getMapById(drawId) || dataService.getMapById(mapId);
  if (!mainConfig) throw new Error('That map is not in the catalogue.');
  let sources = [];
  const own = resolveVectorSourceUrl(mainConfig);
  if (own) sources.push({ id: mainConfig.id, url: own, config: mainConfig });
  else {
    for (const childId of compositeChildIds(mainConfig)) {
      const child = dataService.getMapById(childId);
      const url = resolveVectorSourceUrl(child);
      if (url) sources.push({ id: childId, url, config: child });
    }
  }
  if (!sources.length) {
    throw new Error(`${mainConfig.name || 'This map'} has no vector data file to draw from (it may be a scanned or raster map).`);
  }
  // A group drawn from its loaded members only, where some are loaded.
  if (!own && sources.length > 1) {
    const loaded = sources.filter((s) => controller.isLayerLoaded?.(s.id));
    if (loaded.length) sources = loaded;
  }
  const mapIds = [mapId, drawId, ...sources.map((s) => s.id)];
  if (!election) election = electionColouring(app, mapIds);

  const b = map.getBounds();
  const bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const frame = createFrame(bounds, options.width || TARGET_WIDTH);
  const tolerance = 0.33;

  onProgress('Loading the FlatGeobuf reader…');
  const fgb = await app.ensureFlatgeobufRuntime();
  if (!fgb?.deserialize) throw new Error('The FlatGeobuf reader did not load.');

  const raw = [];
  for (const source of sources) {
    onProgress(`Reading ${source.config?.name || source.id}…`);
    const features = await readFeaturesInBounds(fgb, source.url, bounds, MAX_FEATURES - raw.length, onProgress);
    const labelProperty = source.config?.labelProperty || controller.resolveLayer?.(source.id)?.labelProperty || mainConfig.labelProperty;
    for (const feature of features) raw.push({ feature, labelProperty });
  }
  if (!raw.length) throw new Error('No features of this map are in view. Pan to the map and try again.');

  onProgress(`Drawing ${siteNumber(raw.length)} features…`);
  const selection = options.selection || currentSelection(app, mapIds);
  const match = selectionMatcher(selection, mainConfig.labelProperty || sources[0]?.config?.labelProperty);
  let best = { score: 0, index: -1 };

  const usedIds = new Set(['Outline', 'ContextLand', 'Features', 'FeaturePoints', 'Legend', 'MapFrame', 'Map', 'LoughCut', 'FeatureArea', 'LandAndFeatures', 'Loughs', 'LoughShores', 'LoughShoresInFeatures']);
  const drawn = [];
  for (const { feature, labelProperty } of raw) {
    const properties = feature.properties || {};
    const name = featureName(properties, labelProperty);
    const parts = explode(feature.geometry);
    const rings = [];
    for (const polygon of parts.polygons) {
      polygon.forEach((ring, ringIndex) => {
        const projected = ring.map(([lon, lat]) => frame.project(lon, lat));
        const simple = simplifyPoints(projected, tolerance);
        if (simple.length < 4) return;
        const box = bboxOf(simple);
        if (box[2] - box[0] < tolerance && box[3] - box[1] < tolerance) return;
        // Outer rings one way round, holes the other, so the union path (nonzero) fills correctly.
        const area = ringArea(simple);
        if ((ringIndex === 0 && area < 0) || (ringIndex > 0 && area > 0)) simple.reverse();
        rings.push(simple);
      });
    }
    const lines = parts.lines.map((line) => simplifyPoints(line.map(([lon, lat]) => frame.project(lon, lat)), tolerance)).filter((l) => l.length >= 2);
    const points = parts.points.map(([lon, lat]) => frame.project(lon, lat));
    if (!rings.length && !lines.length && !points.length) continue;
    const score = match(properties, name);
    const index = drawn.length;
    if (score > best.score) best = { score, index };
    drawn.push({ name, properties, rings, lines, points });
  }
  const selectedIndex = best.index;
  const selected = selectedIndex >= 0 ? drawn[selectedIndex] : null;

  // Context land, clipped to the frame plus a margin so its cut edges stay off the page.
  onProgress('Drawing neighbouring land…');
  const margin = 12;
  const clipBox = [-margin, -margin, frame.width + margin, frame.height + margin];
  const land = await loadContextLand(options.contextLandUrl);
  const landPaths = [];
  for (const feature of land.land) {
    const rings = [];
    for (const polygon of feature.polygons) {
      for (const ring of polygon) {
        const projected = simplifyPoints(ring.map(([lon, lat]) => frame.project(lon, lat)), tolerance);
        const box = bboxOf(projected);
        if (box[2] < clipBox[0] || box[0] > clipBox[2] || box[3] < clipBox[1] || box[1] > clipBox[3]) continue;
        const clipped = clipRing(projected, clipBox);
        if (clipped.length >= 3) rings.push(clipped);
      }
    }
    if (rings.length) landPaths.push({ name: feature.name, d: pathData(rings) });
  }
  const borderPaths = [];
  for (const border of land.borders) {
    const lines = border.lines.map((line) => simplifyPoints(line.map(([lon, lat]) => frame.project(lon, lat)), tolerance))
      .filter((line) => {
        const box = bboxOf(line);
        return !(box[2] < clipBox[0] || box[0] > clipBox[2] || box[3] < clipBox[1] || box[1] > clipBox[3]);
      });
    if (lines.length) borderPaths.push({ name: border.name, d: pathData(lines, { close: false }) });
  }

  // The major loughs: their rings, clipped to the same box, are holes in an even-odd clip path
  // over the land, outline and features (islands come back as holes in the holes). A lough a
  // feature is named after (a map of the loughs themselves) is not cut. Without the outlines
  // the map is drawn uncut rather than not at all.
  const loughs = await loadContextLoughs(options.contextLoughsUrl).catch(() => null);
  const featureNames = drawn.map((f) => String(f.name || '').toLowerCase()).filter(Boolean);
  const cutRings = [];
  const shoreRings = [];
  const shoreLines = [];
  const outsideClip = (box) => box[2] < clipBox[0] || box[0] > clipBox[2] || box[3] < clipBox[1] || box[1] > clipBox[3];
  const projectLine = (line) => simplifyPoints(line.map(([lon, lat]) => frame.project(lon, lat)), tolerance);
  for (const lough of loughs?.loughs || []) {
    const key = String(lough.name || '').toLowerCase();
    if (key && featureNames.some((name) => name.includes(key))) continue;
    const rings = [];
    for (const polygon of lough.polygons) {
      for (const ring of polygon) {
        const projected = projectLine(ring);
        if (projected.length < 4 || outsideClip(bboxOf(projected))) continue;
        const clipped = clipRing(projected, clipBox);
        if (clipped.length >= 3) {
          cutRings.push(clipped);
          rings.push(projected);
        }
      }
    }
    if (!rings.length) continue;
    if (lough.shore) {
      for (const line of lough.shore.map(projectLine)) {
        if (line.length >= 2 && !outsideClip(bboxOf(line))) shoreLines.push(line);
      }
    } else {
      shoreRings.push(...rings);
    }
  }
  const cutD = cutRings.length
    ? `M${fmt(clipBox[0])},${fmt(clipBox[1])}H${fmt(clipBox[2])}V${fmt(clipBox[3])}H${fmt(clipBox[0])}z${pathData(cutRings)}`
    : '';
  const shoreD = `${pathData(shoreRings)}${pathData(shoreLines, { close: false })}`;

  // The outer outline: every polygon ring in one path, filled nonzero = the union of the features.
  const polygonFeatures = drawn.filter((f) => f.rings.length);
  const outlineD = polygonFeatures.length && polygonFeatures.length <= 1500 ? pathData(polygonFeatures.flatMap((f) => f.rings)) : '';

  const today = new Date().toISOString().slice(0, 10);
  const meta = await describeSources(app, [...new Set(sources.map((s) => s.id))]);
  const mapName = mainConfig.name || drawId;
  const mapDate = String(mainConfig.dateEffective || mainConfig.date || '');
  const heading = election ? election.title : `${mapName}${mapDate ? ` (${mapDate})` : ''}`;
  const titleText = selected?.name ? `${selected.name}: ${heading}` : heading;
  const pageUrl = `${SITE.origin}/maps/#layers=${encodeURIComponent(drawId)}`;
  const descLines = [
    election ? `${election.title}: areas coloured by ${election.modeLabel}, from ${mapName}.` : `${mapName}${mapDate ? `, ${mapDate}` : ''}.`,
    selected?.name ? `Highlighted: ${selected.name}.` : '',
    `Sources: ${meta.credits.join('; ')}.`,
    meta.references.length ? `Source data: ${meta.references.map((r) => `${r.label} <${r.url}>`).join('; ')}.` : '',
    `Neighbouring land: ${land.credits.join('; ')}.`,
    cutD ? `Loughs, cut out and left unfilled: ${loughs.credits.join('; ')}.` : '',
    'Map: Civgraph (civgraph.net), CC BY-SA 4.0.',
    `Generated ${today} from ${pageUrl}; Web Mercator, view bounds ${bounds.map((v) => v.toFixed(4)).join(', ')} (W, S, E, N).`
  ].filter(Boolean);

  // Features: grouped style like the Commons file; the selected one last so its outline is whole.
  const featurePaths = [];
  // Points sit above the lough cut, so a site on an island or a lough shore is never lost.
  const pointPaths = [];
  const order =drawn.map((_, i) => i).filter((i) => i !== selectedIndex);
  if (selectedIndex >= 0) order.push(selectedIndex);
  for (const i of order) {
    const f = drawn[i];
    const isSelected = i === selectedIndex;
    const id = svgId(f.name || `Feature ${i + 1}`, usedIds);
    const styles = [];
    let fill = null;
    if (election) {
      const coloured = election.colourFor(f.properties, f.name);
      fill = coloured.colour;
      styles.push(`fill:${fill}`);
      // An area with no result: white, with a grey edge so it does not read as sea.
      if (!coloured.matched && !isSelected) styles.push(`stroke:${EXPORT_COLOURS.unmatchedEdge}`);
      if (isSelected) styles.push(`stroke:${WIKI_STYLE.electionSelectedStroke}`, 'stroke-width:2.4px', 'stroke-linejoin:round');
    } else if (isSelected) {
      styles.push(`fill:${WIKI_STYLE.selected}`);
    }
    const title = `<title>${xmlEscape(f.name || 'Unnamed feature')}</title>`;
    const styleAttr = styles.length ? ` style="${styles.join(';')};"` : '';
    if (f.rings.length) featurePaths.push(`<path id="${id}"${styleAttr} d="${pathData(f.rings)}">${title}</path>`);
    if (f.lines.length) {
      const lineStyle = `fill:none;stroke:${isSelected ? WIKI_STYLE.selected : (fill || WIKI_STYLE.stroke)};stroke-width:${isSelected ? 2.2 : 1.2}px;`;
      featurePaths.push(`<path id="${f.rings.length ? svgId(`${f.name} line`, usedIds) : id}" style="${lineStyle}" d="${pathData(f.lines, { close: false })}">${title}</path>`);
    }
    if (f.points.length) {
      const pointFill = isSelected ? WIKI_STYLE.selected : (fill || WIKI_STYLE.fill);
      const circles = f.points.map(([x, y]) => `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${isSelected ? 4 : 2.6}"/>`).join('');
      pointPaths.push(`<g id="${f.rings.length || f.lines.length ? svgId(`${f.name} point`, usedIds) : id}" style="fill:${pointFill};">${title}${circles}</g>`);
    }
  }

  // An election's key sits in a column beside the map, as on the Commons election maps, so it
  // never covers an area; the map itself is clipped to its frame.
  const legend = election ? renderLegend(election, frame) : null;
  const pageWidth = frame.width + (legend ? legend.width : 0);
  const pageHeight = Math.max(frame.height, legend ? legend.height : 0);
  const featureGroupStyle = election
    ? `fill:${WIKI_STYLE.electionUnmatched};stroke:${WIKI_STYLE.electionStroke};stroke-width:${WIKI_STYLE.strokeWidth}px;`
    : `fill:${WIKI_STYLE.fill};stroke:${WIKI_STYLE.stroke};stroke-width:${WIKI_STYLE.strokeWidth}px;`;

  const darkShores = Boolean(cutD && shoreD && outlineD && !election);

  const rdf = `<metadata><rdf:RDF><cc:Work rdf:about="">`
    + `<dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/>`
    + `<dc:title>${xmlEscape(titleText)}</dc:title><dc:date>${today}</dc:date>`
    + `<dc:creator><cc:Agent><dc:title>Civgraph (civgraph.net)</dc:title></cc:Agent></dc:creator>`
    + `<dc:source>${xmlEscape(pageUrl)}</dc:source>`
    + `<dc:description>${xmlEscape(descLines.join(' '))}</dc:description>`
    + `<cc:license rdf:resource="${LICENCE_URL}"/></cc:Work></rdf:RDF></metadata>`;

  const svg = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cc="http://creativecommons.org/ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}" version="1.1" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:10;">`,
    `<title>${xmlEscape(titleText)}</title>`,
    `<desc>${xmlEscape(descLines.join('\n'))}</desc>`,
    rdf,
    `<defs><clipPath id="MapFrame"><rect x="0" y="0" width="${frame.width}" height="${frame.height}"/></clipPath>${
      cutD ? `<clipPath id="LoughCut"><path style="clip-rule:evenodd;" d="${cutD}"/></clipPath>` : ''}${
      darkShores ? '<clipPath id="FeatureArea"><use xlink:href="#Outline" style="clip-rule:nonzero;"/></clipPath>' : ''}</defs>`,
    '<g id="Map" clip-path="url(#MapFrame)">',
    cutD ? '<g id="LandAndFeatures" clip-path="url(#LoughCut)">' : '',
    landPaths.length || borderPaths.length
      ? `<g id="ContextLand" style="fill:${WIKI_STYLE.land};stroke:${WIKI_STYLE.coast};stroke-width:0.5px;">${landPaths.map((p) => `<path id="${svgId(`Land ${p.name}`, usedIds)}" d="${p.d}"><title>${xmlEscape(p.name)}</title></path>`).join('')}${borderPaths.map((p) => `<path id="${svgId(`Border ${p.name}`, usedIds)}" style="fill:none;" d="${p.d}"><title>${xmlEscape(p.name)}</title></path>`).join('')}</g>`
      : '',
    outlineD && !election ? `<path id="Outline" style="fill:${WIKI_STYLE.outline};fill-rule:nonzero;stroke:none;" d="${outlineD}"/>` : '',
    `<g id="Features" style="${featureGroupStyle}">${featurePaths.join('')}</g>`,
    cutD ? '</g>' : '',
    // Lough shores along the cut: grey like the coast, and dark like the outlines over the features.
    cutD && shoreD
      ? `<g id="Loughs" style="fill:none;stroke:${WIKI_STYLE.coast};stroke-width:0.5px;"><title>Loughs</title><path id="LoughShores" d="${shoreD}"/>${
        darkShores ? `<path id="LoughShoresInFeatures" clip-path="url(#FeatureArea)" style="stroke:${WIKI_STYLE.stroke};stroke-width:${WIKI_STYLE.strokeWidth}px;" d="${shoreD}"/>` : ''}</g>`
      : '',
    pointPaths.length ? `<g id="FeaturePoints" style="${featureGroupStyle}">${pointPaths.join('')}</g>` : '',
    '</g>',
    legend ? legend.svg : '',
    '</svg>',
    ''
  ].filter((part) => part !== '').join('\n');

  const filename = `${slugify(drawId)}${selected?.name ? `-${slugify(selected.name)}` : ''}${election ? `-${slugify(election.title)}` : ''}.svg`;
  return {
    svg,
    filename,
    width: pageWidth,
    height: pageHeight,
    featureCount: drawn.length,
    selectedName: selected?.name || '',
    election: Boolean(election)
  };
}

function renderLegend(election, frame) {
  const items = election.legend();
  if (!items.length) return null;
  const row = 18;
  const pad = 10;
  const width = 210;
  const shown = items.slice(0, Math.max(6, Math.floor((Math.max(frame.height, 300) - 3 * pad - 20) / row)));
  const more = items.length - shown.length;
  const height = pad * 2 + 20 + shown.length * row + (more > 0 ? row : 0);
  const x = frame.width + pad;
  const y = pad;
  const label = (text, max = 30) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const rows = shown.map((item, i) => {
    const ty = y + 22 + i * row;
    return `<rect x="${x}" y="${ty}" width="13" height="13" style="fill:${item.colour};stroke:${EXPORT_COLOURS.legendSwatchEdge};stroke-width:0.5px;"/>`
      + `<text x="${x + 19}" y="${ty + 11}"><title>${xmlEscape(item.party)}</title>${xmlEscape(label(item.party))} (${item.count})</text>`;
  }).join('');
  const tail = more > 0 ? `<text x="${x}" y="${y + 22 + shown.length * row + 11}">and ${more} more</text>` : '';
  const svg = `<g id="Legend" style="font-family:'DejaVu Sans',Arial,sans-serif;font-size:11px;fill:${EXPORT_COLOURS.legendText};stroke:none;">`
    + `<text x="${x}" y="${y + 11}" style="font-weight:bold;">${xmlEscape(`Coloured by ${election.modeLabel}`)}</text>${rows}${tail}</g>`;
  return { svg, width: width + pad, height: height + pad };
}

/** Rasterise the SVG (no external references, so the canvas stays clean) to a PNG blob. */
export async function svgToPng(svg, width, height, scale = 2) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The SVG could not be drawn as a PNG.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
