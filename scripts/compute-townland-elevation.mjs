#!/usr/bin/env node
/**
 * Compute min/max elevation for all townland features using Copernicus GLO-30 DEM.
 *
 * Downloads 1°×1° DEM tiles from AWS S3 on-demand, samples elevation within 
 * each polygon's bounding box, computes min/max elevation (metres and feet).
 *
 * Writes a JSON lookup keyed by county→feature-index with elevation values,
 * which build-spatial-chunks.mjs consumes during chunk building.
 *
 * Usage: node --max-old-space-size=4096 scripts/compute-townland-elevation.mjs [--force]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import * as GeoTIFF from 'geotiff';
import https from 'https';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOWNLANDS_DIR = join(ROOT, 'data', 'maps', 'townlands');
const DEM_DIR = join(ROOT, 'data', 'maps', 'physical', 'dem_tiles');
const OUTPUT_FILE = join(TOWNLANDS_DIR, 'elevation-lookup.json');

const force = process.argv.includes('--force');

// Copernicus GLO-30 tile URL pattern
const DEM_BASE = 'https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com';

// County FGB files and their mapping
const COUNTY_MAP = {
    'AntrimTownlands.fgb': 'Antrim',
    'ArmaghTownlands.fgb': 'Armagh',
    'DownTownlands.fgb': 'Down',
    'FermanaghTownlands.fgb': 'Fermanagh',
    'LondonderryTownlands.fgb': 'Londonderry',
    'TyroneTownlands.fgb': 'Tyrone',
    'Townlands_Carlow.fgb': 'Carlow',
    'Townlands_Cavan.fgb': 'Cavan',
    'Townlands_Clare.fgb': 'Clare',
    'Townlands_Cork.fgb': 'Cork',
    'Townlands_Donegal.fgb': 'Donegal',
    'Townlands_Dublin.fgb': 'Dublin',
    'Townlands_Galway.fgb': 'Galway',
    'Townlands_Kerry.fgb': 'Kerry',
    'Townlands_Kildare.fgb': 'Kildare',
    'Townlands_Kilkenny.fgb': 'Kilkenny',
    'Townlands_Laois.fgb': 'Laois',
    'Townlands_Leitrim.fgb': 'Leitrim',
    'Townlands_Limerick.fgb': 'Limerick',
    'Townlands_Longford.fgb': 'Longford',
    'Townlands_Louth.fgb': 'Louth',
    'Townlands_Mayo.fgb': 'Mayo',
    'Townlands_Meath.fgb': 'Meath',
    'Townlands_Monaghan.fgb': 'Monaghan',
    'Townlands_Offaly.fgb': 'Offaly',
    'Townlands_Roscommon.fgb': 'Roscommon',
    'Townlands_Sligo.fgb': 'Sligo',
    'Townlands_Tipperary.fgb': 'Tipperary',
    'Townlands_Waterford.fgb': 'Waterford',
    'Townlands_Westmeath.fgb': 'Westmeath',
    'Townlands_Wexford.fgb': 'Wexford',
    'Townlands_Wicklow.fgb': 'Wicklow',
};

const NI_FILES = new Set([
    'AntrimTownlands.fgb', 'ArmaghTownlands.fgb', 'DownTownlands.fgb',
    'FermanaghTownlands.fgb', 'LondonderryTownlands.fgb', 'TyroneTownlands.fgb'
]);

// ─── DEM tile management ────────────────────────────────────────────

/** Cache for loaded GeoTIFF raster data */
const tileCache = new Map(); // 'N54_W007' -> { data, width, height, bbox }

/**
 * Get the DEM tile key for a given lat/lng
 */
function tileKey(lat, lng) {
    const latFloor = Math.floor(lat);
    const lngFloor = Math.floor(lng);
    const ns = latFloor >= 0 ? 'N' : 'S';
    const ew = lngFloor >= 0 ? 'E' : 'W';
    const latStr = `${ns}${String(Math.abs(latFloor)).padStart(2, '0')}`;
    const lngStr = `${ew}${String(Math.abs(lngFloor)).padStart(3, '0')}`;
    return `${latStr}_${lngStr}`;
}

/**
 * Download a file with HTTPS, following redirects
 */
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlinkSync(dest);
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(dest);
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(resolve); });
        });
        request.on('error', (err) => {
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            reject(err);
        });
    });
}

/**
 * Download and load a DEM tile, caching the raster data
 */
async function loadTile(lat, lng) {
    const key = tileKey(lat, lng);
    if (tileCache.has(key)) return tileCache.get(key);

    const latFloor = Math.floor(lat);
    const lngFloor = Math.floor(lng);
    const ns = latFloor >= 0 ? 'N' : 'S';
    const ew = lngFloor >= 0 ? 'E' : 'W';
    const latStr = `${ns}${String(Math.abs(latFloor)).padStart(2, '0')}_00`;
    const lngStr = `${ew}${String(Math.abs(lngFloor)).padStart(3, '0')}_00`;

    const dirName = `Copernicus_DSM_COG_10_${latStr}_${lngStr}_DEM`;
    const filename = `${dirName}.tif`;
    const localPath = join(DEM_DIR, filename);

    // Download if not cached locally
    if (!existsSync(localPath)) {
        const url = `${DEM_BASE}/${dirName}/${filename}`;
        console.log(`    Downloading DEM tile: ${key}...`);
        try {
            await downloadFile(url, localPath);
            const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(1);
            console.log(`    ✓ ${key} (${sizeMB} MB)`);
        } catch (err) {
            console.warn(`    ⚠ Failed to download ${key}: ${err.message}`);
            tileCache.set(key, null);
            return null;
        }
    }

    // Read the GeoTIFF
    try {
        const buf = readFileSync(localPath);
        const tiff = await GeoTIFF.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const image = await tiff.getImage();
        const [data] = await image.readRasters();
        const width = image.getWidth();
        const height = image.getHeight();
        const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
        const noData = image.getGDALNoData() ?? -9999;

        const tile = { data, width, height, bbox, noData };
        tileCache.set(key, tile);
        return tile;
    } catch (err) {
        console.warn(`    ⚠ Failed to read ${key}: ${err.message}`);
        tileCache.set(key, null);
        return null;
    }
}

/**
 * Sample elevation at a specific lat/lng from loaded tiles
 */
async function sampleElevation(lat, lng) {
    const tile = await loadTile(lat, lng);
    if (!tile) return null;

    const { data, width, height, bbox, noData } = tile;
    const [minX, minY, maxX, maxY] = bbox;

    // Convert lat/lng to pixel coordinates
    const px = Math.floor(((lng - minX) / (maxX - minX)) * width);
    const py = Math.floor(((maxY - lat) / (maxY - minY)) * height);

    if (px < 0 || px >= width || py < 0 || py >= height) return null;

    const val = data[py * width + px];
    if (val === noData || val < -500) return null;
    return val;
}

// ─── Bounding box computation ───────────────────────────────────────

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

// ─── Point-in-polygon test (ray casting) ────────────────────────────

function pointInPolygon(x, y, rings) {
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
    }
    return inside;
}

// ─── Zonal statistics for a polygon ─────────────────────────────────

/**
 * Compute min/max elevation within a polygon by sampling the DEM grid.
 * Uses ~30m sampling interval (≈0.00027° lat, ≈0.00045° lng at 53°N)
 */
async function computeZonalElevation(feature) {
    const geom = feature.geometry;
    if (!geom) return null;

    const bbox = computeBbox(geom);
    if (!bbox) return null;

    const [minX, minY, maxX, maxY] = bbox;

    // Sampling interval: ~90m for speed (3× DEM resolution, still captures key features)
    const latStep = 0.0008;
    const lngStep = 0.0013;

    // Get polygon rings for point-in-polygon test
    let rings;
    if (geom.type === 'Polygon') {
        rings = geom.coordinates;
    } else if (geom.type === 'MultiPolygon') {
        // For MultiPolygon, test against each polygon separately
        rings = geom.coordinates.flat();
    } else {
        return null;
    }

    let minElev = Infinity;
    let maxElev = -Infinity;
    let sampleCount = 0;

    // Pre-load all tiles that this bbox touches
    const latTiles = new Set();
    const lngTiles = new Set();
    for (let lat = minY; lat <= maxY; lat += 1) {
        latTiles.add(Math.floor(lat));
    }
    latTiles.add(Math.floor(maxY));
    for (let lng = minX; lng <= maxX; lng += 1) {
        lngTiles.add(Math.floor(lng));
    }
    lngTiles.add(Math.floor(maxX));

    for (const lt of latTiles) {
        for (const lg of lngTiles) {
            await loadTile(lt, lg);
        }
    }

    // Sample the grid
    for (let lat = minY; lat <= maxY; lat += latStep) {
        for (let lng = minX; lng <= maxX; lng += lngStep) {
            // Point-in-polygon test
            if (!pointInPolygon(lng, lat, rings)) continue;

            const elev = await sampleElevation(lat, lng);
            if (elev != null) {
                if (elev < minElev) minElev = elev;
                if (elev > maxElev) maxElev = elev;
                sampleCount++;
            }
        }
    }

    // If we got no samples from the grid, try centroid and corners
    if (sampleCount === 0) {
        const centerLat = (minY + maxY) / 2;
        const centerLng = (minX + maxX) / 2;
        const fallbackPoints = [
            [centerLat, centerLng],
            [minY, minX], [minY, maxX], [maxY, minX], [maxY, maxX]
        ];
        for (const [lat, lng] of fallbackPoints) {
            const elev = await sampleElevation(lat, lng);
            if (elev != null) {
                if (elev < minElev) minElev = elev;
                if (elev > maxElev) maxElev = elev;
                sampleCount++;
            }
        }
    }

    if (sampleCount === 0) return null;

    return {
        minElev_m: Math.round(minElev * 10) / 10,
        maxElev_m: Math.round(maxElev * 10) / 10,
        minElev_ft: Math.round(minElev * 3.28084 * 10) / 10,
        maxElev_ft: Math.round(maxElev * 3.28084 * 10) / 10,
    };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
    if (!force && existsSync(OUTPUT_FILE)) {
        console.log('Elevation lookup exists, use --force to recompute');
        return;
    }

    mkdirSync(DEM_DIR, { recursive: true });

    console.log('Computing townland elevations from Copernicus GLO-30 DEM\n');

    const elevationLookup = {}; // { countyName: [ {minElev_m, maxElev_m, minElev_ft, maxElev_ft} ] }

    for (const [filename, county] of Object.entries(COUNTY_MAP)) {
        const fgbPath = join(TOWNLANDS_DIR, filename);
        if (!existsSync(fgbPath)) {
            console.warn(`  ⚠ Missing: ${fgbPath}`);
            continue;
        }

        const isNI = NI_FILES.has(filename);
        if (isNI) {
            console.log(`  ⏭ ${county} (NI, already has elevation)`);
            // Still read features to store count for alignment
            const buf = readFileSync(fgbPath);
            const ab = new ArrayBuffer(buf.byteLength);
            new Uint8Array(ab).set(buf);
            const elevs = [];
            for await (const f of deserialize(new Uint8Array(ab))) {
                const p = f.properties || {};
                elevs.push({
                    minElev_m: p.minElev_m ?? null,
                    maxElev_m: p.maxElev_m ?? null,
                    minElev_ft: p.minElev_ft ?? null,
                    maxElev_ft: p.maxElev_ft ?? null,
                });
            }
            elevationLookup[filename] = elevs;
            continue;
        }

        console.log(`  Processing ${county}...`);
        const buf = readFileSync(fgbPath);
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);

        const elevs = [];
        let count = 0;
        let nullCount = 0;

        for await (const feature of deserialize(new Uint8Array(ab))) {
            const elev = await computeZonalElevation(feature);
            elevs.push(elev);
            count++;
            if (!elev) nullCount++;

            if (count % 500 === 0) {
                process.stdout.write(`    ${county}: ${count} features processed\r`);
            }
        }

        elevationLookup[filename] = elevs;
        console.log(`  ✓ ${county}: ${count} features (${nullCount} without elevation)`);
    }

    // Write lookup
    writeFileSync(OUTPUT_FILE, JSON.stringify(elevationLookup));
    const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`\n✓ Elevation lookup written: ${OUTPUT_FILE} (${sizeMB} MB)`);

    // Summary
    let totalFeatures = 0, totalNull = 0;
    for (const [, elevs] of Object.entries(elevationLookup)) {
        totalFeatures += elevs.length;
        totalNull += elevs.filter(e => !e).length;
    }
    console.log(`  Total: ${totalFeatures} features, ${totalNull} without elevation`);
}

main().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
});
