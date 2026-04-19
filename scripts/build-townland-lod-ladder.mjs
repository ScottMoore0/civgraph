#!/usr/bin/env node
/**
 * Build a feature-dropping LOD ladder for the all-Ireland townlands map.
 *
 *   -lod0.fgb  — top 5 000 largest townlands, heavy simplification
 *   -lod1.fgb  — top 20 000 largest, moderate simplification
 *   -lod2.fgb  — top 40 000 largest, light simplification
 *   (no lod3 monolith — full resolution is served via per-chunk FGBs)
 *
 * For each LOD we also emit a gap-fill raster PNG showing the *dropped*
 * features at that level, so the user sees a complete outline even when
 * the vector LOD omits the smallest townlands.
 *
 *   Townlands_AllIreland-lod0-fill.png
 *   Townlands_AllIreland-lod1-fill.png
 *   Townlands_AllIreland-lod2-fill.png
 *
 * Sources: data/maps/townlands/OSNI_Townlands.fgb (NI, 9520 feats)
 *          data/maps/townlands/OSI_Townlands.fgb  (ROI, 50580 feats)
 * Output schema: { Name, County?, IrishName?, Source } — unified across
 * the two input schemas to match the existing Townlands_AllIreland-lod1
 * conventions the runtime already reads.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { deserialize, serialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { createCanvas } from 'canvas';
import simplify from '@turf/simplify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TLDIR = join(ROOT, 'data/maps/townlands');
const RASTER_DIR = join(ROOT, 'data/maps/raster');
if (!existsSync(RASTER_DIR)) mkdirSync(RASTER_DIR, { recursive: true });

const LOD_LEVELS = [
    { level: 0, keepTop: 5000,  simplifyDeg: 0.0004,  name: 'lod0' },
    { level: 1, keepTop: 20000, simplifyDeg: 0.0001,  name: 'lod1' },
    { level: 2, keepTop: 40000, simplifyDeg: 0.00003, name: 'lod2' }
];
const RASTER_WIDTH = 4096;
const RASTER_COLOR = '#A87000';

// ───────────────────────────────────────────────────────────────────
// Load + normalize
// ───────────────────────────────────────────────────────────────────
async function loadSource(path, mapper) {
    const buf = new Uint8Array(readFileSync(path));
    const features = [];
    let i = 0;
    for await (const f of deserialize(buf)) {
        const norm = mapper(f, i);
        if (norm) features.push(norm);
        i++;
    }
    console.log(`  loaded ${features.length} from ${path}`);
    return features;
}

// Compute bbox-diagonal in degrees - stable size proxy that avoids the
// OSNI/OSI area-unit mismatch (OSNI has Area_SqKM, OSI has no area field).
function bboxDiag(feature) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (c) => {
        if (typeof c[0] === 'number') {
            if (c[0] < minX) minX = c[0];
            if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1];
            if (c[1] > maxY) maxY = c[1];
        } else {
            for (const s of c) visit(s);
        }
    };
    if (feature.geometry?.coordinates) visit(feature.geometry.coordinates);
    if (!Number.isFinite(minX)) return 0;
    const dx = maxX - minX;
    const dy = maxY - minY;
    return Math.sqrt(dx * dx + dy * dy);
}

// OSI features come back from flatgeobuf.geojson as 3D polygons (x,y,z).
// Strip z so @turf/simplify and downstream readers behave.
function stripZ(geom) {
    if (!geom) return geom;
    const strip = (c) => {
        if (typeof c[0] === 'number') return [c[0], c[1]];
        return c.map(strip);
    };
    if (geom.coordinates) geom.coordinates = strip(geom.coordinates);
    return geom;
}

console.log('Loading source FGBs...');
const ni = await loadSource(join(TLDIR, 'OSNI_Townlands.fgb'), (f) => {
    if (!f.geometry) return null;
    return {
        type: 'Feature',
        properties: {
            Name: f.properties?.TownlandNa || '',
            County: '',
            IrishName: '',
            Source: 'NI'
        },
        geometry: stripZ(f.geometry)
    };
});
const roi = await loadSource(join(TLDIR, 'OSI_Townlands.fgb'), (f) => {
    if (!f.geometry) return null;
    return {
        type: 'Feature',
        properties: {
            Name: f.properties?.ENG_NAME_VALUE || '',
            County: '',
            IrishName: f.properties?.GLE_NAME_VALUE || '',
            Source: 'ROI'
        },
        geometry: stripZ(f.geometry)
    };
});

const allFeatures = [...ni, ...roi];
console.log(`Total features: ${allFeatures.length}`);

// Compute bbox-diag once
console.log('Computing bbox diagonals...');
for (const f of allFeatures) f._diag = bboxDiag(f);
allFeatures.sort((a, b) => b._diag - a._diag);

// Compute all-Ireland bbox from source features (single pass)
let globMinX = Infinity, globMinY = Infinity, globMaxX = -Infinity, globMaxY = -Infinity;
for (const f of allFeatures) {
    const visit = (c) => {
        if (typeof c[0] === 'number') {
            if (c[0] < globMinX) globMinX = c[0];
            if (c[0] > globMaxX) globMaxX = c[0];
            if (c[1] < globMinY) globMinY = c[1];
            if (c[1] > globMaxY) globMaxY = c[1];
        } else {
            for (const s of c) visit(s);
        }
    };
    if (f.geometry?.coordinates) visit(f.geometry.coordinates);
}
const BBOX = [globMinX, globMinY, globMaxX, globMaxY];
console.log(`All-Ireland bbox: ${BBOX.map(n => n.toFixed(4)).join(', ')}`);

// ───────────────────────────────────────────────────────────────────
// Write per-LOD FGB (top-N + simplified)
// ───────────────────────────────────────────────────────────────────
for (const lod of LOD_LEVELS) {
    console.log(`\n=== LOD${lod.level} (keep top ${lod.keepTop}, simplify ${lod.simplifyDeg}) ===`);
    const kept = allFeatures.slice(0, lod.keepTop).map(src => ({
        type: 'Feature',
        properties: { ...src.properties },
        geometry: src.geometry
    }));
    // Simplify (in-place on copies - our source features retain their raw geom)
    for (const f of kept) {
        try {
            const s = simplify(f, { tolerance: lod.simplifyDeg, highQuality: false, mutate: false });
            f.geometry = s.geometry;
        } catch (err) {
            // Keep original geometry on simplify failure (occasionally fires on
            // degenerate polygons).
        }
    }

    const outFgb = join(TLDIR, `Townlands_AllIreland-${lod.name}.fgb`);
    if (existsSync(outFgb)) unlinkSync(outFgb);
    const body = serialize({ type: 'FeatureCollection', features: kept });
    writeFileSync(outFgb, body);
    console.log(`  wrote ${outFgb} (${kept.length} feats, ${Math.round(body.byteLength / 1024)} KB)`);

    // ── Gap-fill raster (features NOT in this LOD) ──
    const dropped = allFeatures.slice(lod.keepTop);
    if (dropped.length === 0) {
        console.log(`  no dropped features - skipping raster`);
        continue;
    }

    const [minX, minY, maxX, maxY] = BBOX;
    const geoW = maxX - minX;
    const geoH = maxY - minY;
    const width = RASTER_WIDTH;
    const height = Math.round(width * geoH / geoW);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = RASTER_COLOR;
    ctx.lineWidth = 0.7;
    ctx.fillStyle = RASTER_COLOR + '22';

    const project = (lon, lat) => [
        ((lon - minX) / geoW) * width,
        ((maxY - lat) / geoH) * height
    ];

    for (const f of dropped) {
        const g = f.geometry;
        if (!g) continue;
        const polys = g.type === 'MultiPolygon' ? g.coordinates
            : g.type === 'Polygon' ? [g.coordinates]
            : [];
        for (const poly of polys) {
            for (const ring of poly) {
                if (!ring || ring.length < 3) continue;
                ctx.beginPath();
                for (let k = 0; k < ring.length; k++) {
                    const [px, py] = project(ring[k][0], ring[k][1]);
                    if (k === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        }
    }

    const outPng = join(RASTER_DIR, `Townlands_AllIreland-${lod.name}-fill.png`);
    const pngBuf = canvas.toBuffer('image/png');
    writeFileSync(outPng, pngBuf);
    console.log(`  wrote ${outPng} (${dropped.length} dropped feats → ${Math.round(pngBuf.length / 1024)} KB, ${width}×${height})`);
}

console.log('\nDone.');
