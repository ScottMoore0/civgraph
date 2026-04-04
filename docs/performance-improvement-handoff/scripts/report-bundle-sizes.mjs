#!/usr/bin/env node

import { walkFiles, statOrNull, formatBytes, printSection } from './_shared.mjs';

const buildFiles = walkFiles('build', (relPath) => /\.(js|css|map)$/i.test(relPath));
const rows = buildFiles.map((relPath) => ({
    relPath,
    bytes: statOrNull(relPath)?.size ?? 0
}));

const jsRows = rows.filter((row) => row.relPath.endsWith('.js'));
const cssRows = rows.filter((row) => row.relPath.endsWith('.css'));

const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
const totalJsBytes = jsRows.reduce((sum, row) => sum + row.bytes, 0);
const totalCssBytes = cssRows.reduce((sum, row) => sum + row.bytes, 0);

console.log('# Bundle Size Report');
console.log(`Build files found: ${rows.length}`);
console.log(`Total bytes: ${formatBytes(totalBytes)}`);
console.log(`Total JS: ${formatBytes(totalJsBytes)}`);
console.log(`Total CSS: ${formatBytes(totalCssBytes)}`);

printSection('Largest Build Files');
for (const row of [...rows].sort((a, b) => b.bytes - a.bytes).slice(0, 20)) {
    console.log(`${formatBytes(row.bytes).padStart(8)}  ${row.relPath}`);
}

printSection('JavaScript Files');
for (const row of [...jsRows].sort((a, b) => b.bytes - a.bytes)) {
    console.log(`${formatBytes(row.bytes).padStart(8)}  ${row.relPath}`);
}

printSection('CSS Files');
for (const row of [...cssRows].sort((a, b) => b.bytes - a.bytes)) {
    console.log(`${formatBytes(row.bytes).padStart(8)}  ${row.relPath}`);
}

