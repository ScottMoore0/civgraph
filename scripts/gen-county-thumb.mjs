#!/usr/bin/env node
/**
 * Generate a single county townland thumbnail
 * Usage: node scripts/gen-county-thumb.mjs <county-id>
 * Example: node scripts/gen-county-thumb.mjs donegal-townlands
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const countyId = process.argv[2];
if (!countyId) { console.error('Usage: node gen-county-thumb.mjs <county-id>'); process.exit(1); }

const d = JSON.parse(readFileSync(join(ROOT, 'data/database/maps.json'), 'utf8'));
const tl = d.maps.find(m => m.id === 'ni-townlands-1844');
const v = tl.variants.find(v => v.id === countyId);
if (!v) { console.error('Variant not found: ' + countyId); process.exit(1); }

const fgb = v.files?.fgb;
if (!fgb) { console.error('No fgb file for ' + countyId); process.exit(1); }

const fp = join(ROOT, fgb);
if (!existsSync(fp)) { console.error('File missing: ' + fgb); process.exit(1); }

const color = tl.style?.color || '#DAA520';
const buf = new Uint8Array(readFileSync(fp));
const geoms = [];

// Only keep outer ring coords to save memory on large files
const outerRings = [];
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

let count = 0;
for await (const f of deserialize(buf)) {
    if (!f.geometry) continue;
    count++;
    const g = f.geometry;
    const rings = [];
    if (g.type === 'Polygon') rings.push(g.coordinates[0]); // outer ring only
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) rings.push(p[0]); // outer rings only

    for (const ring of rings) {
        // Simplify: keep every Nth point for large rings
        const step = ring.length > 200 ? Math.floor(ring.length / 100) : 1;
        const simplified = [];
        for (let i = 0; i < ring.length; i += step) {
            const [x, y] = ring[i];
            simplified.push([x, y]);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        outerRings.push(simplified);
    }
}

console.log(`${countyId}: ${count} features, ${outerRings.length} rings`);

const W = 120, H = 120, P = 6;
const dW = W - 2 * P, dH = H - 2 * P;
const sc = Math.min(dW / (maxX - minX), dH / (maxY - minY));
const oX = P + (dW - (maxX - minX) * sc) / 2;
const oY = P + (dH - (maxY - minY) * sc) / 2;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.clearRect(0, 0, W, H);
ctx.strokeStyle = color;
ctx.lineWidth = count > 500 ? 0.3 : 0.5;
ctx.fillStyle = color + '18';

for (const ring of outerRings) {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
        const px = oX + (ring[i][0] - minX) * sc;
        const py = oY + (maxY - ring[i][1]) * sc;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
}

const out = join(ROOT, 'assets/thumbnails', countyId + '.png');
writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`Wrote ${out}`);
