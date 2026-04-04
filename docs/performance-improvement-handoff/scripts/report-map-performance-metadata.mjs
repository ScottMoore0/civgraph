#!/usr/bin/env node

import { readText, exists, printSection } from './_shared.mjs';

const mapsPath = 'data/database/maps.json';
if (!exists(mapsPath)) {
    console.error(`Missing ${mapsPath}`);
    process.exit(1);
}

const mapsJson = JSON.parse(readText(mapsPath));
const mapList = Array.isArray(mapsJson.maps) ? mapsJson.maps : Array.isArray(mapsJson) ? mapsJson : [];

const lod = [];
const chunked = [];
const chunkedWithLod = [];
const concurrencyRows = [];

for (const map of mapList) {
    if (!map || typeof map !== 'object') continue;
    const id = map.id || map.slug || map.name || '(unknown)';
    if (map.useLOD === true) lod.push(id);
    if (map.chunked === true) chunked.push(id);
    if (map.chunked === true && map.useLOD === true) chunkedWithLod.push(id);
    if (Number.isFinite(Number(map.chunkLoadConcurrency))) {
        concurrencyRows.push({ id, concurrency: Number(map.chunkLoadConcurrency) });
    }
}

console.log('# Map Performance Metadata Report');
console.log(`Maps scanned: ${mapList.length}`);
console.log(`useLOD: ${lod.length}`);
console.log(`chunked: ${chunked.length}`);
console.log(`chunked + useLOD: ${chunkedWithLod.length}`);
console.log(`explicit chunkLoadConcurrency: ${concurrencyRows.length}`);

printSection('Maps Using useLOD');
for (const id of lod.sort((a, b) => a.localeCompare(b)).slice(0, 200)) {
    console.log(id);
}

printSection('Maps Using chunked');
for (const id of chunked.sort((a, b) => a.localeCompare(b)).slice(0, 200)) {
    console.log(id);
}

printSection('Maps With Explicit chunkLoadConcurrency');
for (const row of concurrencyRows.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${row.id}  ->  ${row.concurrency}`);
}

