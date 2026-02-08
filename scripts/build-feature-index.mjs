#!/usr/bin/env node
/**
 * Build Feature Search Index
 * 
 * Reads all FlatGeobuf map files referenced in maps.json, extracts feature
 * names using each map's labelProperty, computes bounding boxes, and writes
 * the results into data/database/spatial-index.json's `features` array.
 * 
 * Usage: node scripts/build-feature-index.mjs
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve, join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAPS_JSON = join(ROOT, 'data', 'database', 'maps.json');
const SPATIAL_INDEX = join(ROOT, 'data', 'database', 'spatial-index.json');

// Compute bbox from a GeoJSON geometry
function computeBbox(geometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function walk(coords) {
        if (typeof coords[0] === 'number') {
            if (coords[0] < minX) minX = coords[0];
            if (coords[0] > maxX) maxX = coords[0];
            if (coords[1] < minY) minY = coords[1];
            if (coords[1] > maxY) maxY = coords[1];
        } else {
            for (const c of coords) walk(c);
        }
    }

    if (geometry?.coordinates) walk(geometry.coordinates);
    return [minX, minY, maxX, maxY];
}

async function buildIndex() {
    const mapsDb = JSON.parse(readFileSync(MAPS_JSON, 'utf8'));
    const maps = mapsDb.maps || [];

    console.log(`Found ${maps.length} maps in maps.json`);

    const features = [];
    const seenNames = new Set();
    let skipped = 0, processed = 0;

    for (const map of maps) {
        const labelProp = map.labelProperty;
        let fgbPath = map.files?.fgb;

        // Resolve clone source files
        if (!fgbPath && map.cloneOf) {
            const src = maps.find(m => m.id === map.cloneOf);
            if (src?.files?.fgb) fgbPath = src.files.fgb;
        }

        if (!fgbPath || !labelProp) { skipped++; continue; }

        const fullPath = join(ROOT, fgbPath);
        if (!existsSync(fullPath)) {
            console.warn(`  ⚠ Missing: ${fgbPath}`);
            skipped++;
            continue;
        }

        // Skip LFS pointer files
        if (statSync(fullPath).size < 200) {
            console.warn(`  ⚠ LFS pointer: ${fgbPath}`);
            skipped++;
            continue;
        }

        try {
            const buf = new Uint8Array(readFileSync(fullPath));
            let count = 0;

            for await (const feature of deserialize(buf)) {
                let name = feature.properties?.[labelProp];
                if (!name || typeof name !== 'string') continue;

                name = name.trim();
                if (map.labelCleanup === 'stripTrailingBracketNumber') {
                    name = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
                }
                if (!name) continue;

                const key = `${map.id}:${name}`;
                if (seenNames.has(key)) continue;
                seenNames.add(key);

                features.push({
                    name,
                    mapId: map.id,
                    bbox: computeBbox(feature.geometry)
                });
                count++;
            }

            processed++;
            console.log(`  ✓ ${map.id}: ${count} features`);
        } catch (err) {
            console.error(`  ✗ ${map.id}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\nProcessed: ${processed}, Skipped: ${skipped}`);
    console.log(`Total features indexed: ${features.length}`);

    // Update spatial index
    let idx = {};
    if (existsSync(SPATIAL_INDEX)) {
        idx = JSON.parse(readFileSync(SPATIAL_INDEX, 'utf8'));
    }
    idx.features = features;
    idx.generated = new Date().toISOString();
    idx.version = '1.1';

    writeFileSync(SPATIAL_INDEX, JSON.stringify(idx, null, 2), 'utf8');
    console.log(`Wrote to ${relative(ROOT, SPATIAL_INDEX)}`);
}

buildIndex().catch(err => { console.error('Fatal:', err); process.exit(1); });
