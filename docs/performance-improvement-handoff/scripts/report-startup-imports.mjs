#!/usr/bin/env node

import { readText, exists, extractStaticImports, extractDynamicImports, relativeImportTarget, printSection } from './_shared.mjs';

const entry = 'js/app.js';
if (!exists(entry)) {
    console.error(`Entry file not found: ${entry}`);
    process.exit(1);
}

const visited = new Set();
const edges = [];
const packageImports = new Map();
const dynamicImports = new Map();

function visit(relPath) {
    if (visited.has(relPath)) return;
    visited.add(relPath);

    const source = readText(relPath);
    const staticImports = extractStaticImports(source);
    const dynamic = extractDynamicImports(source);

    for (const specifier of staticImports) {
        if (specifier.startsWith('.')) {
            const target = relativeImportTarget(relPath, specifier);
            edges.push({ from: relPath, type: 'static', specifier, target: target ?? '(unresolved)' });
            if (target) visit(target);
        } else {
            packageImports.set(specifier, (packageImports.get(specifier) ?? 0) + 1);
            edges.push({ from: relPath, type: 'package', specifier, target: specifier });
        }
    }

    for (const specifier of dynamic) {
        dynamicImports.set(specifier, (dynamicImports.get(specifier) ?? 0) + 1);
        const target = specifier.startsWith('.') ? relativeImportTarget(relPath, specifier) : null;
        edges.push({ from: relPath, type: 'dynamic', specifier, target: target ?? specifier });
    }
}

visit(entry);

console.log('# Startup Import Report');
console.log(`Entry: ${entry}`);
console.log(`Visited local modules: ${visited.size}`);
console.log(`Static local import edges: ${edges.filter((e) => e.type === 'static').length}`);
console.log(`Dynamic import sites: ${edges.filter((e) => e.type === 'dynamic').length}`);
console.log(`Package import sites: ${edges.filter((e) => e.type === 'package').length}`);

printSection('Visited Local Modules');
for (const relPath of [...visited].sort((a, b) => a.localeCompare(b))) {
    console.log(relPath);
}

printSection('Package Imports');
for (const [pkg, count] of [...packageImports.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${pkg}  (${count})`);
}

printSection('Dynamic Imports');
if (dynamicImports.size === 0) {
    console.log('(none found)');
} else {
    for (const [specifier, count] of [...dynamicImports.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`${specifier}  (${count})`);
    }
}

printSection('Potentially Deferrable Large Local Modules');
for (const relPath of [...visited]
    .filter((p) => /^js\/(election-controller|ui-controller|map-controller|time-slider-controller)\.js$/.test(p))
    .sort((a, b) => a.localeCompare(b))) {
    console.log(relPath);
}

