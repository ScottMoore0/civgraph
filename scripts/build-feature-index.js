#!/usr/bin/env node
/**
 * Build Feature Search Index
 * 
 * Reads all FlatGeobuf map files referenced in maps.json, extracts feature
 * names using each map's labelProperty, computes bounding boxes, and writes
 * the results into data/database/spatial-index.json's `features` array.
 * 
 * This makes ALL map features searchable in the autocomplete, even when
 * the maps are not currently loaded on the Leaflet map.
 * 
 * Usage: node scripts/build-feature-index.js
 */

const fs = require('fs');
const path = require('path');
const { deserialize } = require('flatgeobuf/lib/mjs/geojson.js');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..');
const MAPS_JSON = path.join(ROOT, 'data', 'database', 'maps.json');
const SPATIAL_INDEX = path.join(ROOT, 'data', 'database', 'spatial-index.json');

// Helper: compute bbox from a GeoJSON geometry
function computeBbox(geometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function processCoords(coords) {
        if (typeof coords[0] === 'number') {
            // It's a single coordinate [lng, lat]
            if (coords[0] < minX) minX = coords[0];
            if (coords[0] > maxX) maxX = coords[0];
            if (coords[1] < minY) minY = coords[1];
            if (coords[1] > maxY) maxY = coords[1];
        } else {
            for (const c of coords) processCoords(c);
        }
    }

    if (geometry.coordinates) {
        processCoords(geometry.coordinates);
    }

    return [minX, minY, maxX, maxY];
}

async function buildIndex() {
    // Load maps.json
    const mapsDb = JSON.parse(fs.readFileSync(MAPS_JSON, 'utf8'));
    const maps = mapsDb.maps || [];

    console.log(`Found ${maps.length} maps in maps.json`);

    const features = [];
    const seenNames = new Map(); // Deduplicate across clone maps
    let skipped = 0;
    let processed = 0;

    for (const map of maps) {
        const labelProp = map.labelProperty;
        let fgbPath = map.files?.fgb;

        // If this is a clone, resolve files from the source map
        if (!fgbPath && map.cloneOf) {
            const sourceMap = maps.find(m => m.id === map.cloneOf);
            if (sourceMap?.files?.fgb) {
                fgbPath = sourceMap.files.fgb;
            }
        }

        if (!fgbPath || !labelProp) {
            skipped++;
            continue;
        }

        const fullPath = path.join(ROOT, fgbPath);
        if (!fs.existsSync(fullPath)) {
            console.warn(`  ⚠ Missing file: ${fgbPath}`);
            skipped++;
            continue;
        }

        // Check file size - skip LFS pointer files (< 200 bytes)
        const stat = fs.statSync(fullPath);
        if (stat.size < 200) {
            console.warn(`  ⚠ LFS pointer (not pulled): ${fgbPath}`);
            skipped++;
            continue;
        }

        try {
            const fileBuffer = fs.readFileSync(fullPath);
            const uint8 = new Uint8Array(fileBuffer);

            // Use flatgeobuf to deserialize
            let featureCount = 0;
            for await (const feature of deserialize(uint8)) {
                const name = feature.properties?.[labelProp];
                if (!name || typeof name !== 'string' || !name.trim()) continue;

                const trimmedName = name.trim();

                // Clean up label if map has labelCleanup rule
                let cleanName = trimmedName;
                if (map.labelCleanup === 'stripTrailingBracketNumber') {
                    cleanName = trimmedName.replace(/\s*\([^()]*\)\s*$/, '').trim();
                }
                if (!cleanName) continue;

                // Deduplicate: same name in same map
                const dedupeKey = `${map.id}:${cleanName}`;
                if (seenNames.has(dedupeKey)) continue;
                seenNames.set(dedupeKey, true);

                // Compute bbox
                const bbox = computeBbox(feature.geometry);

                features.push({
                    name: cleanName,
                    mapId: map.id,
                    bbox
                });

                featureCount++;
            }

            processed++;
            console.log(`  ✓ ${map.id}: ${featureCount} features (label: ${labelProp})`);
        } catch (err) {
            console.error(`  ✗ Error reading ${map.id}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\nProcessed: ${processed} maps, Skipped: ${skipped}`);
    console.log(`Total unique features indexed: ${features.length}`);

    // Load existing spatial index or create new
    let spatialIndex = {};
    if (fs.existsSync(SPATIAL_INDEX)) {
        spatialIndex = JSON.parse(fs.readFileSync(SPATIAL_INDEX, 'utf8'));
    }

    // Update features array
    spatialIndex.features = features;
    spatialIndex.generated = new Date().toISOString();
    spatialIndex.version = '1.1';

    // Write back
    fs.writeFileSync(SPATIAL_INDEX, JSON.stringify(spatialIndex, null, 2), 'utf8');
    console.log(`\nWrote ${features.length} features to ${path.relative(ROOT, SPATIAL_INDEX)}`);
}

buildIndex().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
