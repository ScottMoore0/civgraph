#!/usr/bin/env node
/**
 * Build Spatial Chunks (v3 — Fine Grid + Feature Index + Geometry Simplification)
 * 
 * For townlands: reads all 32 county FGBs, merges them, and re-chunks into a
 * fine 0.25° spatial grid (~150-200 cells of 50-300 features each).
 * 
 * For each chunk, creates zoom-filtered variants with simplified geometry:
 *   z7  (zoom < 9):  features with diag >= 0.02°, simplified at 0.005° tolerance
 *   z10 (zoom 9-11): features with diag >= 0.004°, simplified at 0.001° tolerance
 *   full (zoom 12+): all features, original geometry
 * 
 * Generates a feature-level spatial index for zero-network-cost visibility queries.
 * 
 * For grid-based census maps: same as before but with zoom variants.
 * 
 * Usage: node scripts/build-spatial-chunks.mjs [--force] [--map <mapId>]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { resolve, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { deserialize, serialize } from 'flatgeobuf/lib/mjs/geojson.js';
import simplifyModule from '@turf/simplify';
import turfAreaModule from '@turf/area';
import turfLengthModule from '@turf/length';
const simplify = simplifyModule.default || simplifyModule;
const turfArea = turfAreaModule.default || turfAreaModule;
const turfLength = turfLengthModule.default || turfLengthModule;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAPS_JSON = join(ROOT, 'data', 'database', 'maps.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const mapFilter = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;

/** Zoom level definitions with simplification tolerances */
const ZOOM_LEVELS = [
    { name: 'z7', minDiag: 0.02, maxZoom: 8, tolerance: 0.005 },
    { name: 'z10', minDiag: 0.004, maxZoom: 11, tolerance: 0.001 },
];

/** Grid-based census maps */
const CHUNK_CONFIGS = {
    'census-grid-2021': { grid: [6, 4] },
    'oa-2001': { grid: [4, 3] },
    'sa-2011': { grid: [4, 3] },
    'dz-2021': { grid: [3, 3] },
    'soa-2011': { grid: [2, 2] },
    'sdz-2021': { grid: [2, 2] },
};

/** Townland fine grid cell size in degrees */
const TOWNLAND_CELL_SIZE = 0.25;

// ─── Geometry utilities ──────────────────────────────────────────────

function computeBbox(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (coords) => {
        if (typeof coords[0] === 'number') {
            if (coords[0] < minX) minX = coords[0];
            if (coords[0] > maxX) maxX = coords[0];
            if (coords[1] < minY) minY = coords[1];
            if (coords[1] > maxY) maxY = coords[1];
        } else {
            for (const c of coords) walk(c);
        }
    };
    walk(geometry.coordinates);
    return [minX, minY, maxX, maxY];
}

function computeDiag(geometry) {
    if (!geometry || !geometry.coordinates) return Infinity;
    if (geometry.type === 'Point') return Infinity;
    const bbox = computeBbox(geometry);
    if (!bbox) return Infinity;
    const dx = bbox[2] - bbox[0], dy = bbox[3] - bbox[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function computeCentroid(geometry) {
    const bbox = computeBbox(geometry);
    if (!bbox) return null;
    return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function simplifyFeature(feature, tolerance) {
    try {
        return simplify(feature, { tolerance, highQuality: false, mutate: false });
    } catch {
        return feature; // If simplification fails, keep original
    }
}

// ─── FGB I/O ─────────────────────────────────────────────────────────

/**
 * Compute/normalise universal attributes for a feature.
 * Area and perimeter are computed from geometry; elevation is carried
 * forward from existing properties (NI data) or set to null (ROI data).
 */
function computeUniversalAttributes(feature) {
    const p = feature.properties || {};

    // Area (geodesic, m² → km²)
    try {
        const areaM2 = turfArea(feature);
        p.Area_sqkm = Math.round(areaM2 / 1e6 * 1000) / 1000; // 3 decimals
    } catch {
        if (p.Area_SqKM != null) p.Area_sqkm = p.Area_SqKM;
        else p.Area_sqkm = null;
    }

    // Perimeter (geodesic, km)
    try {
        const geom = feature.geometry;
        let rings;
        if (geom.type === 'Polygon') {
            rings = geom.coordinates;
        } else if (geom.type === 'MultiPolygon') {
            rings = geom.coordinates.flat();
        }
        if (rings && rings.length > 0) {
            let totalLen = 0;
            for (const ring of rings) {
                const line = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } };
                totalLen += turfLength(line, { units: 'kilometers' });
            }
            p.Perimeter_km = Math.round(totalLen * 1000) / 1000;
        } else {
            p.Perimeter_km = null;
        }
    } catch {
        p.Perimeter_km = null;
    }

    // Elevation — use injected lookup data, then existing NI properties, then null
    const elev = feature._elev;
    p.minElev_m = elev?.minElev_m ?? p.minElev_m ?? null;
    p.maxElev_m = elev?.maxElev_m ?? p.maxElev_m ?? null;
    p.minElev_ft = elev?.minElev_ft ?? p.minElev_ft ?? null;
    p.maxElev_ft = elev?.maxElev_ft ?? p.maxElev_ft ?? null;
    delete feature._elev; // Clean up temp field

    // Remove legacy inconsistent keys
    delete p.Area_SqKM;

    feature.properties = p;
}

function writeFGB(features, filePath) {
    if (features.length === 0) return null;
    // Filter and normalize — flatgeobuf requires:
    //   1. Homogeneous geometry types (promote Polygon → MultiPolygon)
    //   2. Consistent property schemas (all features must have the same keys)
    const valid = [];
    for (const f of features) {
        if (!f || !f.geometry || !f.geometry.coordinates) continue;
        const g = f.geometry;
        if (g.type === 'Polygon' && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
            valid.push({ ...f, geometry: { type: 'MultiPolygon', coordinates: [g.coordinates] } });
        } else {
            valid.push(f);
        }
    }
    if (valid.length === 0) return null;

    // Harmonize property schemas: collect all keys, fill missing with null
    const allKeys = new Set();
    for (const f of valid) {
        if (f.properties) for (const k of Object.keys(f.properties)) allKeys.add(k);
    }
    const keyList = [...allKeys];
    for (const f of valid) {
        const props = f.properties || {};
        for (const k of keyList) {
            if (!(k in props)) props[k] = null;
        }
        f.properties = props;
    }

    const fc = { type: 'FeatureCollection', features: valid };
    const fgbBytes = serialize(fc);
    writeFileSync(filePath, Buffer.from(fgbBytes));
    return filePath;
}

async function readFGB(filePath) {
    // Node.js Buffers share V8's internal buffer pool, meaning byteOffset
    // is often non-zero. FlatGeobuf's flatbuffers parser requires aligned
    // TypedArrays. Copy to a fresh ArrayBuffer to fix.
    const nodeBuf = readFileSync(filePath);
    const buf = new Uint8Array(nodeBuf.length);
    nodeBuf.copy(buf);

    const features = [];
    for await (const feature of deserialize(buf)) {
        features.push(feature);
    }
    return features;
}

// ─── Zoom variant builder ────────────────────────────────────────────

function buildZoomVariants(features, chunksDir, chunkBaseName) {
    const zoomFiles = {};
    for (const level of ZOOM_LEVELS) {
        // Filter by size
        const filtered = features.filter(f => f.geometry && computeDiag(f.geometry) >= level.minDiag);
        if (filtered.length === 0) continue;
        if (filtered.length === features.length) continue; // Same as full — skip

        // Simplify geometry
        const simplified = [];
        for (const f of filtered) {
            try {
                simplified.push(simplifyFeature(f, level.tolerance));
            } catch (err) {
                simplified.push(f); // Keep original on simplification failure
            }
        }

        const variantPath = join(chunksDir, `${chunkBaseName}_${level.name}.fgb`);
        try {
            writeFGB(simplified, variantPath);
        } catch (err) {
            console.warn(`    ⚠ Failed writing ${chunkBaseName}_${level.name}: ${err.message}`);
            continue;
        }

        zoomFiles[level.name] = {
            file: relative(ROOT, variantPath).replace(/\\/g, '/'),
            count: simplified.length,
            maxZoom: level.maxZoom
        };
    }
    return zoomFiles;
}

// ─── Grid-based map chunking (census maps etc.) ──────────────────────

async function chunkMap(mapId, fgbPath, gridCols, gridRows) {
    const fullPath = join(ROOT, fgbPath);
    const dir = dirname(fullPath);
    const chunksDir = join(dir, 'chunks');
    const indexPath = join(dir, `${mapId}-chunks.json`);

    if (!force && existsSync(indexPath)) {
        console.log(`  ⏭ ${mapId} (exists, use --force)`);
        return true;
    }
    if (!existsSync(fullPath)) {
        console.error(`  ✗ ${mapId}: FGB not found: ${fgbPath}`);
        return false;
    }

    console.log(`  Processing ${mapId} (${gridCols}×${gridRows})...`);
    const features = await readFGB(fullPath);
    console.log(`    Read ${features.length} features`);

    // Overall bbox
    let oMinX = Infinity, oMinY = Infinity, oMaxX = -Infinity, oMaxY = -Infinity;
    for (const f of features) {
        const bbox = computeBbox(f.geometry);
        if (!bbox) continue;
        if (bbox[0] < oMinX) oMinX = bbox[0];
        if (bbox[1] < oMinY) oMinY = bbox[1];
        if (bbox[2] > oMaxX) oMaxX = bbox[2];
        if (bbox[3] > oMaxY) oMaxY = bbox[3];
    }
    const padX = (oMaxX - oMinX) * 0.001, padY = (oMaxY - oMinY) * 0.001;
    oMinX -= padX; oMinY -= padY; oMaxX += padX; oMaxY += padY;
    const cellW = (oMaxX - oMinX) / gridCols, cellH = (oMaxY - oMinY) / gridRows;

    // Assign to grid cells
    const cells = new Map();
    for (const feature of features) {
        const centroid = computeCentroid(feature.geometry);
        if (!centroid) continue;
        let col = Math.floor((centroid[0] - oMinX) / cellW);
        let row = Math.floor((centroid[1] - oMinY) / cellH);
        col = Math.max(0, Math.min(gridCols - 1, col));
        row = Math.max(0, Math.min(gridRows - 1, row));
        const key = `${col}_${row}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(feature);
    }

    mkdirSync(chunksDir, { recursive: true });
    const chunks = [];
    let totalZoomFiles = 0;

    for (const [key, cellFeatures] of cells) {
        let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
        for (const f of cellFeatures) {
            const bbox = computeBbox(f.geometry);
            if (!bbox) continue;
            if (bbox[0] < cMinX) cMinX = bbox[0];
            if (bbox[1] < cMinY) cMinY = bbox[1];
            if (bbox[2] > cMaxX) cMaxX = bbox[2];
            if (bbox[3] > cMaxY) cMaxY = bbox[3];
        }

        const chunkBaseName = `${mapId}_${key}`;
        const chunkPath = join(chunksDir, `${chunkBaseName}.fgb`);
        writeFGB(cellFeatures, chunkPath);

        const zoomFiles = buildZoomVariants(cellFeatures, chunksDir, chunkBaseName);
        totalZoomFiles += Object.keys(zoomFiles).length;

        chunks.push({
            id: key,
            bbox: [cMinX, cMinY, cMaxX, cMaxY],
            file: relative(ROOT, chunkPath).replace(/\\/g, '/'),
            count: cellFeatures.length,
            zoomFiles
        });
    }

    chunks.sort((a, b) => a.id.localeCompare(b.id));
    const index = {
        mapId,
        grid: [gridCols, gridRows],
        totalFeatures: features.length,
        zoomLevels: ZOOM_LEVELS.map(l => ({ name: l.name, minDiag: l.minDiag, maxZoom: l.maxZoom })),
        chunks
    };
    writeFileSync(indexPath, JSON.stringify(index, null, 2));

    console.log(`    ✓ ${chunks.length} chunks + ${totalZoomFiles} zoom variants`);
    console.log(`    ✓ Index: ${relative(ROOT, indexPath)}`);
    return true;
}

// ─── Townland fine-grid chunking ─────────────────────────────────────

async function buildTownlandFineGrid(overrideMapId = null) {
    const mapId = overrideMapId || 'ni-townlands-1844';
    const mapsDb = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));
    const townlandMap = mapsDb.maps.find(m => m.id === mapId);
    if (!townlandMap) {
        console.error(`  ✗ Map ${mapId} not found`);
        return false;
    }

    const dir = join(ROOT, 'data', 'maps', 'townlands');
    const chunksDir = join(dir, 'chunks');
    const indexPath = join(dir, `${mapId}-chunks.json`);
    const featureIndexPath = join(dir, `${mapId}-feature-index.json`);

    if (!force && existsSync(indexPath) && existsSync(featureIndexPath)) {
        console.log(`  ⏭ ${mapId} (exists, use --force)`);
        return true;
    }

    mkdirSync(chunksDir, { recursive: true });
    console.log(`  Building townland fine grid (${TOWNLAND_CELL_SIZE}° cells) for ${mapId}...`);

    // 1. Load elevation lookup if available
    const elevLookupPath = join(dir, 'elevation-lookup.json');
    let elevLookup = null;
    if (existsSync(elevLookupPath)) {
        elevLookup = JSON.parse(readFileSync(elevLookupPath, 'utf8'));
        console.log('    ✓ Elevation lookup loaded');
    } else {
        console.log('    ⚠ No elevation lookup found (run compute-townland-elevation.mjs first)');
    }

    // 2. Read ALL townland features — from single FGB or county variants
    const allFeatures = [];
    const hasSingleFGB = townlandMap.files?.fgb && !townlandMap.variants?.length;
    const hasLocalFGB = townlandMap.files?.fgb && existsSync(join(ROOT, townlandMap.files.fgb));

    if (hasLocalFGB || (hasSingleFGB && existsSync(join(ROOT, townlandMap.files.fgb)))) {
        // Load directly from single FGB file
        const fgbPath = join(ROOT, townlandMap.files.fgb);
        console.log(`    Loading from ${townlandMap.files.fgb}...`);
        try {
            const features = await readFGB(fgbPath);
            allFeatures.push(...features);
            console.log(`    ${features.length} features loaded`);
        } catch (err) {
            console.error(`    ✗ Failed to load ${fgbPath}: ${err.message}`);
            return false;
        }
    } else if (townlandMap.variants?.length) {
        // Load from county-level variant FGBs (legacy approach)
        for (const variant of townlandMap.variants) {
            const fgbPath = variant.files?.fgb;
            if (!fgbPath) continue;
            const fullPath = join(ROOT, fgbPath);
            if (!existsSync(fullPath) || statSync(fullPath).size < 200) continue;

            const fgbFilename = fgbPath.split('/').pop();
            const countyElevs = elevLookup?.[fgbFilename] || null;

            try {
                const features = await readFGB(fullPath);
                if (countyElevs) {
                    for (let i = 0; i < features.length && i < countyElevs.length; i++) {
                        features[i]._elev = countyElevs[i];
                    }
                }
                allFeatures.push(...features);
                process.stdout.write(`    ${variant.id}: ${features.length} features\r\n`);
            } catch (err) {
                console.warn(`    ⚠ Skipping ${variant.id}: ${err.message}`);
            }
        }
    } else {
        console.error(`  ✗ No FGB source found for ${mapId}`);
        return false;
    }

    console.log(`    Total: ${allFeatures.length} features`);

    // Compute universal attributes for all features
    console.log('    Computing universal attributes (area, perimeter, elevation)...');
    for (const f of allFeatures) {
        computeUniversalAttributes(f);
    }
    console.log('    ✓ Universal attributes computed');

    // 2. Compute overall bbox
    let oMinX = Infinity, oMinY = Infinity, oMaxX = -Infinity, oMaxY = -Infinity;
    for (const f of allFeatures) {
        const bbox = computeBbox(f.geometry);
        if (!bbox) continue;
        if (bbox[0] < oMinX) oMinX = bbox[0];
        if (bbox[1] < oMinY) oMinY = bbox[1];
        if (bbox[2] > oMaxX) oMaxX = bbox[2];
        if (bbox[3] > oMaxY) oMaxY = bbox[3];
    }

    // Grid dimensions
    const gridCols = Math.ceil((oMaxX - oMinX) / TOWNLAND_CELL_SIZE);
    const gridRows = Math.ceil((oMaxY - oMinY) / TOWNLAND_CELL_SIZE);
    console.log(`    Grid: ${gridCols}×${gridRows} (${TOWNLAND_CELL_SIZE}° cells)`);
    console.log(`    Bbox: [${oMinX.toFixed(2)}, ${oMinY.toFixed(2)}, ${oMaxX.toFixed(2)}, ${oMaxY.toFixed(2)}]`);

    // 3. Assign features to grid cells + build feature index
    const cells = new Map();
    const featureIndex = []; // [minX, minY, maxX, maxY, diag, chunkId] per feature

    for (let i = 0; i < allFeatures.length; i++) {
        const feature = allFeatures[i];
        const centroid = computeCentroid(feature.geometry);
        if (!centroid) continue;

        let col = Math.floor((centroid[0] - oMinX) / TOWNLAND_CELL_SIZE);
        let row = Math.floor((centroid[1] - oMinY) / TOWNLAND_CELL_SIZE);
        col = Math.max(0, Math.min(gridCols - 1, col));
        row = Math.max(0, Math.min(gridRows - 1, row));

        const key = `${col}_${row}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ feature, globalIdx: i });

        const bbox = computeBbox(feature.geometry);
        const diag = computeDiag(feature.geometry);
        if (bbox) {
            featureIndex.push([
                Math.round(bbox[0] * 10000) / 10000,
                Math.round(bbox[1] * 10000) / 10000,
                Math.round(bbox[2] * 10000) / 10000,
                Math.round(bbox[3] * 10000) / 10000,
                Math.round(diag * 10000) / 10000,
                key
            ]);
        }
    }

    // 4. Write chunk FGBs with zoom variants
    const chunks = [];
    let totalZoomFiles = 0;
    let nonEmptyCells = 0;

    for (const [key, cellEntries] of cells) {
        const cellFeatures = cellEntries.map(e => e.feature);
        nonEmptyCells++;

        try {
            // Compute cell bbox from actual feature extents
            let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
            for (const f of cellFeatures) {
                const bbox = computeBbox(f.geometry);
                if (!bbox) continue;
                if (bbox[0] < cMinX) cMinX = bbox[0];
                if (bbox[1] < cMinY) cMinY = bbox[1];
                if (bbox[2] > cMaxX) cMaxX = bbox[2];
                if (bbox[3] > cMaxY) cMaxY = bbox[3];
            }

            const chunkBaseName = `${mapId}_${key}`;
            const chunkPath = join(chunksDir, `${chunkBaseName}.fgb`);
            writeFGB(cellFeatures, chunkPath);

            // Build zoom variants with simplified geometry
            const zoomFiles = buildZoomVariants(cellFeatures, chunksDir, chunkBaseName);
            totalZoomFiles += Object.keys(zoomFiles).length;

            chunks.push({
                id: key,
                bbox: [cMinX, cMinY, cMaxX, cMaxY],
                file: relative(ROOT, chunkPath).replace(/\\/g, '/'),
                count: cellFeatures.length,
                zoomFiles
            });

            if (nonEmptyCells % 20 === 0) {
                process.stdout.write(`    ${nonEmptyCells} cells written...\r\n`);
            }
        } catch (err) {
            console.warn(`    ⚠ Cell ${key} (${cellFeatures.length} features) FAILED: ${err.message}`);
            console.warn(`      Stack: ${err.stack?.split('\n')[1]?.trim()}`);
        }
    }

    chunks.sort((a, b) => a.id.localeCompare(b.id));

    // 5. Write chunk index
    const chunkIndex = {
        mapId,
        grid: [gridCols, gridRows],
        cellSize: TOWNLAND_CELL_SIZE,
        bbox: [oMinX, oMinY, oMaxX, oMaxY],
        totalFeatures: allFeatures.length,
        zoomLevels: ZOOM_LEVELS.map(l => ({ name: l.name, minDiag: l.minDiag, maxZoom: l.maxZoom })),
        chunks
    };
    writeFileSync(indexPath, JSON.stringify(chunkIndex, null, 2));

    // 6. Write feature index (compact array format)
    const featureIndexData = {
        mapId,
        totalFeatures: featureIndex.length,
        // Column order: [minX, minY, maxX, maxY, diag, chunkId]
        columns: ['minX', 'minY', 'maxX', 'maxY', 'diag', 'chunk'],
        features: featureIndex
    };
    writeFileSync(featureIndexPath, JSON.stringify(featureIndexData));

    const indexSizeKB = Math.round(statSync(featureIndexPath).size / 1024);
    console.log(`    ✓ ${nonEmptyCells} grid cells + ${totalZoomFiles} zoom variants`);
    console.log(`    ✓ Feature index: ${indexSizeKB}KB (${featureIndex.length} features)`);
    console.log(`    ✓ Chunk index: ${relative(ROOT, indexPath)}`);
    return true;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
    const mapsDb = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));
    const maps = mapsDb.maps || [];
    let processed = 0, errors = 0;

    for (const [mapId, config] of Object.entries(CHUNK_CONFIGS)) {
        if (mapFilter && mapFilter !== mapId) continue;
        const map = maps.find(m => m.id === mapId);
        if (!map) { console.warn(`  ⚠ ${mapId} not found`); continue; }
        const fgbPath = map.files?.fgb;
        if (!fgbPath) { console.warn(`  ⚠ ${mapId} has no FGB`); continue; }

        try {
            if (await chunkMap(mapId, fgbPath, config.grid[0], config.grid[1])) processed++;
            else errors++;
        } catch (err) {
            console.error(`  ✗ ${mapId}: ${err.message}`);
            errors++;
        }
    }

    // Townland maps — fine grid chunking
    const townlandMaps = ['ni-townlands-1844', 'ni-townlands', 'roi-townlands'];
    for (const tlMapId of townlandMaps) {
        if (mapFilter && mapFilter !== tlMapId) continue;
        const tlMap = maps.find(m => m.id === tlMapId);
        if (!tlMap) continue;
        try {
            if (await buildTownlandFineGrid(tlMapId)) processed++;
            else errors++;
        } catch (err) {
            console.error(`  ✗ ${tlMapId}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\nDone! Processed: ${processed}, Errors: ${errors}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
