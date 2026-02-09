#!/usr/bin/env node
/**
 * Generate Thumbnails for Map Entries
 * 
 * Reads FlatGeobuf map files, renders boundary outlines to small PNGs.
 * Handles both standalone maps and group maps with variants.
 * 
 * Usage: node scripts/generate-thumbnails.mjs [mapId1] [mapId2] ...
 *   If no IDs given, generates for all maps missing thumbnails.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAPS_JSON = join(ROOT, 'data', 'database', 'maps.json');
const THUMB_DIR = join(ROOT, 'assets', 'thumbnails');

const WIDTH = 120;
const HEIGHT = 120;
const PADDING = 6;

/**
 * Collect all coordinates from a GeoJSON geometry
 */
function collectCoords(geometry) {
    const coords = [];
    function walk(c) {
        if (typeof c[0] === 'number') {
            coords.push([c[0], c[1]]);
        } else {
            for (const sub of c) walk(sub);
        }
    }
    if (geometry?.coordinates) walk(geometry.coordinates);
    return coords;
}

/**
 * Collect all rings (for drawing) from a GeoJSON geometry
 */
function collectRings(geometry) {
    const rings = [];
    const type = geometry?.type;
    const coords = geometry?.coordinates;
    if (!coords) return rings;

    if (type === 'Polygon') {
        for (const ring of coords) rings.push(ring);
    } else if (type === 'MultiPolygon') {
        for (const poly of coords) {
            for (const ring of poly) rings.push(ring);
        }
    } else if (type === 'LineString') {
        rings.push(coords);
    } else if (type === 'MultiLineString') {
        for (const line of coords) rings.push(line);
    }
    return rings;
}

/**
 * Read an FGB file and return all feature geometries
 */
async function readFgb(fgbPath) {
    const fullPath = join(ROOT, fgbPath);
    if (!existsSync(fullPath)) return null;

    const buf = new Uint8Array(readFileSync(fullPath));
    const geometries = [];

    for await (const feature of deserialize(buf)) {
        if (feature.geometry) {
            geometries.push(feature.geometry);
        }
    }
    return geometries;
}

/**
 * Render geometries to a PNG thumbnail
 */
function renderThumbnail(geometries, color, lineWidth = 0.5) {
    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const geom of geometries) {
        for (const [x, y] of collectCoords(geom)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    const geoW = maxX - minX;
    const geoH = maxY - minY;
    if (geoW === 0 || geoH === 0) return null;

    // Maintain aspect ratio
    const drawW = WIDTH - 2 * PADDING;
    const drawH = HEIGHT - 2 * PADDING;
    const scale = Math.min(drawW / geoW, drawH / geoH);
    const offX = PADDING + (drawW - geoW * scale) / 2;
    const offY = PADDING + (drawH - geoH * scale) / 2;

    // Project: lon → x, lat → y (flip y)
    function project(lon, lat) {
        return [
            offX + (lon - minX) * scale,
            offY + (maxY - lat) * scale  // flip Y axis
        ];
    }

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Draw boundaries
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = color + '18'; // Very subtle fill

    for (const geom of geometries) {
        const rings = collectRings(geom);
        for (const ring of rings) {
            ctx.beginPath();
            for (let i = 0; i < ring.length; i++) {
                const [px, py] = project(ring[i][0], ring[i][1]);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
                ctx.closePath();
                ctx.fill();
            }
            ctx.stroke();
        }
    }

    return canvas.toBuffer('image/png');
}

/**
 * Get the file path and color for a map entry
 */
function getMapInfo(map, allMaps) {
    let fgbPath = map.files?.fgb;
    const color = map.style?.color || '#666666';

    // For groups with variants, collect all variant files
    if (map.isGroup && map.variants && map.variants.length > 0) {
        const paths = map.variants.map(v => v.files?.fgb).filter(Boolean);
        return { paths, color, isGroup: true };
    }

    // Resolve cloneOf
    if (!fgbPath && map.cloneOf) {
        const src = allMaps.find(m => m.id === map.cloneOf);
        if (src?.files?.fgb) fgbPath = src.files.fgb;
    }

    return { paths: fgbPath ? [fgbPath] : [], color, isGroup: false };
}

async function main() {
    const mapsDb = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));
    const allMaps = mapsDb.maps || [];

    // Determine which maps to process
    const requestedIds = process.argv.slice(2);
    let toProcess;

    if (requestedIds.length > 0) {
        toProcess = requestedIds.map(id => allMaps.find(m => m.id === id)).filter(Boolean);
    } else {
        // Find all maps missing thumbnails
        toProcess = allMaps.filter(m => {
            const thumbPath = join(THUMB_DIR, `${m.cloneOf || m.id}.png`);
            return !existsSync(thumbPath) && !m.hidden;
        });
    }

    console.log(`Generating thumbnails for ${toProcess.length} maps...\n`);

    let generated = 0, skipped = 0;

    for (const map of toProcess) {
        const thumbFile = join(THUMB_DIR, `${map.cloneOf || map.id}.png`);
        const { paths, color } = getMapInfo(map, allMaps);

        if (paths.length === 0) {
            console.log(`  ⊘ ${map.id}: no files`);
            skipped++;
            continue;
        }

        try {
            // Read all FGB files and combine geometries
            const allGeometries = [];
            for (const p of paths) {
                const geoms = await readFgb(p);
                if (geoms) allGeometries.push(...geoms);
            }

            if (allGeometries.length === 0) {
                console.log(`  ⊘ ${map.id}: no geometries`);
                skipped++;
                continue;
            }

            // Adjust line width based on feature count
            const lineWidth = allGeometries.length > 500 ? 0.3 :
                allGeometries.length > 100 ? 0.5 : 0.8;

            const png = renderThumbnail(allGeometries, color, lineWidth);
            if (png) {
                writeFileSync(thumbFile, png);
                const kb = Math.round(png.length / 1024);
                console.log(`  ✓ ${map.id}: ${allGeometries.length} features → ${kb} KB`);
                generated++;
            }
        } catch (err) {
            console.error(`  ✗ ${map.id}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\nDone: ${generated} generated, ${skipped} skipped`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
