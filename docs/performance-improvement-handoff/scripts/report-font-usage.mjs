#!/usr/bin/env node

import { walkFiles, readText, printSection } from './_shared.mjs';

const targetFiles = [
    ...walkFiles('assets/css', (relPath) => /\.css$/i.test(relPath)),
    ...walkFiles('election-viewer-package/css', (relPath) => /\.css$/i.test(relPath)),
    ...walkFiles('.', (relPath) => /^(index\.html|about\.html|pages\/.*\.html|partials\/.*\.html|js\/.*\.js)$/i.test(relPath))
];

const familyHits = new Map();
const googleFonts = new Set();

function recordFamily(family, relPath) {
    const cleaned = family.trim().replace(/^['"]|['"]$/g, '');
    if (!cleaned) return;
    const hit = familyHits.get(cleaned) ?? new Set();
    hit.add(relPath);
    familyHits.set(cleaned, hit);
}

for (const relPath of targetFiles) {
    const text = readText(relPath);

    for (const match of text.matchAll(/font-family\s*:\s*([^;]+);/gi)) {
        const families = match[1].split(',').map((part) => part.trim()).filter(Boolean);
        for (const family of families) {
            recordFamily(family, relPath);
        }
    }

    for (const match of text.matchAll(/fonts\.googleapis\.com\/css2\?family=([^"'&>]+)/gi)) {
        googleFonts.add(decodeURIComponent(match[1]));
    }
}

console.log('# Font Usage Report');
console.log(`Files scanned: ${targetFiles.length}`);
console.log(`Distinct font-family tokens: ${familyHits.size}`);
console.log(`Google Fonts family query tokens: ${googleFonts.size}`);

printSection('Font Families');
for (const [family, files] of [...familyHits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${family}`);
    for (const relPath of [...files].sort((a, b) => a.localeCompare(b))) {
        console.log(`  - ${relPath}`);
    }
}

printSection('Google Fonts Query Families');
if (googleFonts.size === 0) {
    console.log('(none found)');
} else {
    for (const token of [...googleFonts].sort((a, b) => a.localeCompare(b))) {
        console.log(token);
    }
}

