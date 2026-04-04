#!/usr/bin/env node

import { readText, walkFiles, exists, printSection } from './_shared.mjs';

const packageJsonPath = 'package.json';
if (!exists(packageJsonPath)) {
    console.error(`Missing ${packageJsonPath}`);
    process.exit(1);
}

const packageJson = JSON.parse(readText(packageJsonPath));
const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
};

const codeFiles = [
    ...walkFiles('js', (relPath) => /\.(js|mjs)$/i.test(relPath)),
    ...walkFiles('scripts', (relPath) => /\.(js|mjs)$/i.test(relPath))
];

const usage = new Map(
    Object.keys(allDeps).sort((a, b) => a.localeCompare(b)).map((name) => [name, []])
);

for (const relPath of codeFiles) {
    const text = readText(relPath);
    for (const depName of usage.keys()) {
        const quoted = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`["']${quoted}(?:\\/[^"']*)?["']`, 'g');
        if (regex.test(text)) {
            usage.get(depName).push(relPath);
        }
    }
}

console.log('# Dependency Usage Report');
console.log(`Dependencies scanned: ${usage.size}`);
console.log(`Code files scanned: ${codeFiles.length}`);

printSection('Dependencies With No Detected Import Site');
const unused = [...usage.entries()].filter(([, files]) => files.length === 0);
if (unused.length === 0) {
    console.log('(none)');
} else {
    for (const [depName] of unused) {
        console.log(depName);
    }
}

printSection('Dependencies With Detected Import Sites');
for (const [depName, files] of [...usage.entries()].filter(([, files]) => files.length > 0)) {
    console.log(depName);
    for (const relPath of files.sort((a, b) => a.localeCompare(b))) {
        console.log(`  - ${relPath}`);
    }
}

