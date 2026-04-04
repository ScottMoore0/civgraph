#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

export const repoRoot = path.resolve(currentDir, '..', '..', '..');

export function readText(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

export function exists(relPath) {
    return fs.existsSync(path.join(repoRoot, relPath));
}

export function statOrNull(relPath) {
    try {
        return fs.statSync(path.join(repoRoot, relPath));
    } catch (_) {
        return null;
    }
}

export function walkFiles(relDir, predicate = () => true) {
    const root = path.join(repoRoot, relDir);
    const results = [];
    if (!fs.existsSync(root)) return results;

    const visit = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
                continue;
            }
            const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
            if (predicate(relPath, entry)) {
                results.push(relPath);
            }
        }
    };

    visit(root);
    return results.sort((a, b) => a.localeCompare(b));
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return 'n/a';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function printSection(title) {
    console.log(`\n## ${title}`);
}

export function relativeImportTarget(fromFile, specifier) {
    const baseDir = path.dirname(fromFile);
    const candidateBase = path.normalize(path.join(baseDir, specifier));
    const suffixes = ['', '.js', '.mjs', '.json'];
    for (const suffix of suffixes) {
        const relCandidate = `${candidateBase}${suffix}`.replace(/\\/g, '/');
        const fullCandidate = path.join(repoRoot, relCandidate);
        if (fs.existsSync(fullCandidate) && fs.statSync(fullCandidate).isFile()) {
            return relCandidate;
        }
    }
    for (const suffix of ['/index.js', '/index.mjs', '/index.json']) {
        const relCandidate = `${candidateBase}${suffix}`.replace(/\\/g, '/');
        const fullCandidate = path.join(repoRoot, relCandidate);
        if (fs.existsSync(fullCandidate) && fs.statSync(fullCandidate).isFile()) {
            return relCandidate;
        }
    }
    return null;
}

export function extractStaticImports(sourceText) {
    const imports = [];
    const importRegex = /import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/g;
    for (const match of sourceText.matchAll(importRegex)) {
        imports.push(match[1]);
    }
    return imports;
}

export function extractDynamicImports(sourceText) {
    const imports = [];
    const importRegex = /import\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of sourceText.matchAll(importRegex)) {
        imports.push(match[1]);
    }
    return imports;
}
