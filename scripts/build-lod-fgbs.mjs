#!/usr/bin/env node
/**
 * Build LOD FGB Files
 * 
 * For each FGB map file referenced in maps.json, generates simplified
 * geometry variants at two LOD levels:
 *   - LOD-0 ({name}-lod0.fgb): tolerance 0.005° (~500m) for zoom 0-8
 *   - LOD-1 ({name}-lod1.fgb): tolerance 0.0005° (~50m) for zoom 8-12
 *   - LOD-2: original FGB file (no action needed)
 * 
 * Uses @turf/simplify (Douglas-Peucker) for geometry simplification
 * and flatgeobuf's serialize to write new FGB files.
 * 
 * Usage: node scripts/build-lod-fgbs.mjs [--force] [--map <mapId>]
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve, join, dirname, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { deserialize, serialize } from 'flatgeobuf/lib/mjs/geojson.js';
import simplify from '@turf/simplify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAPS_JSON = join(ROOT, 'data', 'database', 'maps.json');

const LOD_LEVELS = [
    { level: 0, suffix: '-lod0.fgb', tolerance: 0.005 },   // ~500m
    { level: 1, suffix: '-lod1.fgb', tolerance: 0.0005 },   // ~50m
];

// Max features to process at once. Files above this get chunked processing.
const MAX_FEATURES_PER_PASS = 10000;

const args = process.argv.slice(2);
const force = args.includes('--force');
const mapFilter = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;

/**
 * Simplify a GeoJSON feature's geometry in-place using Douglas-Peucker
 */
function simplifyFeature(feature, tolerance) {
    if (!feature.geometry || feature.geometry.type === 'Point') {
        return feature; // Points can't be simplified
    }

    try {
        // Use mutate:true for memory efficiency (modifies in place)
        simplify(feature, {
            tolerance,
            highQuality: false, // Use faster Ramer-Douglas-Peucker
            mutate: true
        });
        return feature;
    } catch (err) {
        // If simplification fails, return original
        return feature;
    }
}

/**
 * Check if a geometry is valid (has coordinates)
 */
function isValidGeometry(geom) {
    if (!geom || !geom.type) return false;
    if (geom.type === 'Point') return geom.coordinates?.length >= 2;
    if (geom.type === 'LineString') return geom.coordinates?.length >= 2;
    if (geom.type === 'Polygon') return geom.coordinates?.length > 0 && geom.coordinates[0]?.length >= 4;
    if (geom.type === 'MultiPolygon') return geom.coordinates?.length > 0;
    if (geom.type === 'MultiLineString') return geom.coordinates?.length > 0;
    if (geom.type === 'MultiPoint') return geom.coordinates?.length > 0;
    return true;
}

/**
 * Deep clone a feature (for when we need separate copies for different LODs)
 */
function cloneFeature(feature) {
    return {
        type: feature.type,
        properties: { ...feature.properties },
        geometry: JSON.parse(JSON.stringify(feature.geometry))
    };
}

async function generateLODForFile(fgbPath, fullPath, mapIds, lodConfig) {
    const name = basename(fgbPath, '.fgb');
    const dir = dirname(fullPath);
    const outputPath = join(dir, `${name}${lodConfig.suffix}`);

    // Read features from FGB
    const buf = new Uint8Array(readFileSync(fullPath));
    const simplifiedFeatures = [];

    let count = 0;
    for await (const feature of deserialize(buf)) {
        // Clone and simplify in-place
        const clone = cloneFeature(feature);
        simplifyFeature(clone, lodConfig.tolerance);

        if (isValidGeometry(clone.geometry)) {
            simplifiedFeatures.push(clone);
        } else {
            // Keep original if simplification produced invalid geometry
            simplifiedFeatures.push({
                type: feature.type,
                properties: { ...feature.properties },
                geometry: JSON.parse(JSON.stringify(feature.geometry))
            });
        }
        count++;

        // Log progress for large files
        if (count % 5000 === 0) {
            process.stdout.write(`      ${count} features simplified...\r`);
        }
    }

    if (count === 0) return null;

    // Serialize to FGB
    const fc = { type: 'FeatureCollection', features: simplifiedFeatures };
    const fgbBytes = serialize(fc);
    writeFileSync(outputPath, Buffer.from(fgbBytes));

    const originalSize = statSync(fullPath).size;
    const lodSize = statSync(outputPath).size;
    const reduction = ((1 - lodSize / originalSize) * 100).toFixed(1);

    console.log(`    ✓ LOD-${lodConfig.level}: ${relative(ROOT, outputPath)} (${(lodSize / 1024 / 1024).toFixed(1)} MB, ${reduction}% reduction, ${count} features)`);
    return { count, lodSize, reduction };
}

async function buildLOD() {
    const mapsDb = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));
    const maps = mapsDb.maps || [];

    // Collect all unique FGB paths
    const fgbEntries = new Map();

    for (const map of maps) {
        let fgbPath = map.files?.fgb;
        if (!fgbPath && map.cloneOf) {
            const src = maps.find(m => m.id === map.cloneOf);
            if (src?.files?.fgb) fgbPath = src.files.fgb;
        }
        if (!fgbPath) continue;
        if (mapFilter && map.id !== mapFilter) continue;

        const fullPath = join(ROOT, fgbPath);
        if (!existsSync(fullPath) || statSync(fullPath).size < 200) continue;

        // Skip LOD variant files themselves
        if (fgbPath.match(/-lod\d+\.fgb$/i)) continue;

        if (!fgbEntries.has(fgbPath)) {
            fgbEntries.set(fgbPath, { mapIds: [], fgbPath, fullPath });
        }
        fgbEntries.get(fgbPath).mapIds.push(map.id);
    }

    console.log(`Found ${fgbEntries.size} unique FGB files to process\n`);

    let processed = 0, skipped = 0, errors = 0;

    for (const [fgbPath, entry] of fgbEntries) {
        const { fullPath, mapIds } = entry;
        const name = basename(fgbPath, '.fgb');
        const dir = dirname(fullPath);

        // Check if LOD files already exist (skip unless --force)
        const lod0Path = join(dir, `${name}-lod0.fgb`);
        const lod1Path = join(dir, `${name}-lod1.fgb`);

        if (!force && existsSync(lod0Path) && existsSync(lod1Path)) {
            console.log(`  ⏭ ${fgbPath} (LOD files exist, use --force to rebuild)`);
            skipped++;
            continue;
        }

        const fileSize = statSync(fullPath).size;
        console.log(`  Processing ${fgbPath} (${(fileSize / 1024 / 1024).toFixed(1)} MB, maps: ${mapIds.join(', ')})...`);

        try {
            // Process each LOD level separately to limit memory usage
            for (const lodConfig of LOD_LEVELS) {
                await generateLODForFile(fgbPath, fullPath, mapIds, lodConfig);
                // Force GC if available
                if (global.gc) global.gc();
            }
            processed++;
        } catch (err) {
            console.error(`  ✗ ${fgbPath}: ${err.message}`);
            if (err.stack) console.error(`    ${err.stack.split('\n')[1]?.trim()}`);
            errors++;
        }
    }

    console.log(`\nDone! Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
}

buildLOD().catch(err => { console.error('Fatal:', err); process.exit(1); });
