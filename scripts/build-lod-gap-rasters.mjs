#!/usr/bin/env node
/**
 * Build "gap-fill" raster underlays for maps whose chunked zoom variants
 * drop features. For each chunk we diff the full feature set against the
 * zoom-level variant (e.g. z7, z10) and rasterize only the dropped
 * features. At runtime the raster sits under the vector so the user sees
 * outlines even for the features the zoom variant omitted, without
 * paying the vector-decode cost for them.
 *
 * Output: data/maps/raster/<mapId>-<level>-fill.png
 *
 * Currently applies to townland maps (ni-townlands, roi-townlands,
 * all-ireland-townlands) which drop ~30% of features at z7/z10.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { createCanvas } from 'canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CONFIGS = [
    {
        mapId: 'ni-townlands',
        chunksIndexPath: 'data/maps/townlands/ni-townlands-chunks.json',
        levels: ['z7', 'z10'],
        color: '#A87000',
        outputDir: 'data/maps/raster',
        // Render at ~80m/px for NI extent (~160km wide)
        targetWidth: 2048
    },
    {
        mapId: 'roi-townlands',
        chunksIndexPath: 'data/maps/townlands/roi-townlands-chunks.json',
        levels: ['z7', 'z10'],
        color: '#A87000',
        outputDir: 'data/maps/raster',
        targetWidth: 4096
    },
    {
        mapId: 'all-ireland-townlands',
        chunksIndexPath: 'data/maps/townlands/all-ireland-townlands-chunks.json',
        levels: ['z7', 'z10'],
        color: '#A87000',
        outputDir: 'data/maps/raster',
        targetWidth: 4096
    }
];

/** Load every feature from an FGB file on disk. */
async function loadFgb(path) {
    if (!existsSync(path)) return null;
    const buf = new Uint8Array(readFileSync(path));
    const features = [];
    for await (const feature of deserialize(buf)) {
        features.push(feature);
    }
    return features;
}

/** Stable feature key across variants. Townland chunks carry TOWNLAND_I
 *  (OSNI) or OBJECTID (OSi); fall back to TownlandNa / ENG_NAME_VALUE. */
function featureKey(feature) {
    const p = feature?.properties || {};
    return (
        p.TOWNLAND_I ??
        p.OBJECTID ??
        p.TownlandNa ??
        p.ENG_NAME_VALUE ??
        null
    );
}

/** Resolve a chunk-index file-path entry to a local filesystem path
 *  (chunks are gitignored but live at data/maps/townlands/chunks/). */
function localChunkPath(repoPath) {
    return join(ROOT, repoPath);
}

async function diffGapFeatures(chunksIndex, level) {
    const gap = [];
    let fullTotal = 0;
    let levelTotal = 0;

    for (const chunk of chunksIndex.chunks) {
        const zoomMeta = chunk.zoomFiles?.[level];
        const fullPath = localChunkPath(chunk.file);
        const full = await loadFgb(fullPath);
        if (!full) {
            console.warn(`  [${level}] missing full chunk: ${chunk.file}`);
            continue;
        }
        fullTotal += full.length;

        if (!zoomMeta) {
            // Chunk has no zoom variant for this level; every feature is
            // effectively present - contribute nothing to the gap raster.
            levelTotal += full.length;
            continue;
        }
        const zoomPath = localChunkPath(zoomMeta.file);
        const zoomFeatures = await loadFgb(zoomPath);
        if (!zoomFeatures) {
            console.warn(`  [${level}] missing zoom chunk: ${zoomMeta.file}`);
            continue;
        }
        levelTotal += zoomFeatures.length;

        const keptKeys = new Set(zoomFeatures.map(featureKey).filter((k) => k !== null));
        for (const f of full) {
            const k = featureKey(f);
            if (k === null || !keptKeys.has(k)) {
                gap.push(f);
            }
        }
    }

    return { gap, fullTotal, levelTotal };
}

function computeBboxFromFeatures(features, fallbackBbox) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (coords) => {
        if (typeof coords[0] === 'number') {
            if (coords[0] < minX) minX = coords[0];
            if (coords[0] > maxX) maxX = coords[0];
            if (coords[1] < minY) minY = coords[1];
            if (coords[1] > maxY) maxY = coords[1];
        } else {
            for (const c of coords) visit(c);
        }
    };
    for (const f of features) {
        if (f.geometry?.coordinates) visit(f.geometry.coordinates);
    }
    if (!Number.isFinite(minX)) {
        return fallbackBbox;
    }
    return [minX, minY, maxX, maxY];
}

function rasterizeGapFeatures(features, bbox, color, targetWidth) {
    const [minX, minY, maxX, maxY] = bbox;
    const geoW = maxX - minX;
    const geoH = maxY - minY;
    const aspect = geoH / geoW;
    const width = targetWidth;
    const height = Math.round(width * aspect);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.fillStyle = color + '25'; // ~15% alpha fill, same as thumbnails

    const project = (lon, lat) => [
        ((lon - minX) / geoW) * width,
        ((maxY - lat) / geoH) * height
    ];

    for (const feat of features) {
        const g = feat.geometry;
        if (!g) continue;
        const polys = g.type === 'MultiPolygon' ? g.coordinates
            : g.type === 'Polygon' ? [g.coordinates]
            : [];
        for (const poly of polys) {
            for (const ring of poly) {
                if (!ring || ring.length < 3) continue;
                ctx.beginPath();
                for (let i = 0; i < ring.length; i++) {
                    const [px, py] = project(ring[i][0], ring[i][1]);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        }
    }

    return { buffer: canvas.toBuffer('image/png'), width, height };
}

async function main() {
    const manifest = [];
    for (const cfg of CONFIGS) {
        console.log(`\n=== ${cfg.mapId} ===`);
        const indexPath = join(ROOT, cfg.chunksIndexPath);
        const chunksIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
        console.log(`Chunks: ${chunksIndex.chunks.length}, bbox: ${chunksIndex.bbox.map(n => n.toFixed(3)).join(', ')}`);

        const outDir = join(ROOT, cfg.outputDir);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

        for (const level of cfg.levels) {
            const { gap, fullTotal, levelTotal } = await diffGapFeatures(chunksIndex, level);
            const bbox = computeBboxFromFeatures(gap, chunksIndex.bbox);
            console.log(`  [${level}] full=${fullTotal}, kept=${levelTotal}, gap=${gap.length} (${(100 * gap.length / fullTotal).toFixed(0)}%)`);
            if (gap.length === 0) {
                console.log(`  [${level}] no gap features - skipping raster`);
                continue;
            }

            const { buffer, width, height } = rasterizeGapFeatures(gap, bbox, cfg.color, cfg.targetWidth);
            const outName = `${cfg.mapId}-${level}-fill.png`;
            const outPath = join(outDir, outName);
            writeFileSync(outPath, buffer);
            console.log(`  [${level}] wrote ${outName} (${width}x${height}, ${Math.round(buffer.length / 1024)} KB)`);

            manifest.push({
                mapId: cfg.mapId,
                level,
                file: `${cfg.outputDir}/${outName}`.replace(/\\/g, '/'),
                bounds: [[bbox[1], bbox[0]], [bbox[3], bbox[2]]],
                maxZoom: level === 'z7' ? 8 : 11,
                gapFeatureCount: gap.length
            });
        }
    }
    console.log(`\nManifest:\n${JSON.stringify(manifest, null, 2)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
