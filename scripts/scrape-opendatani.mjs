#!/usr/bin/env node
/**
 * Enumerate the full Open Data NI catalogue via its CKAN API.
 * Writes raw package records (with nested resources) to
 *   data/external/opendatani-catalogue.json
 * and a flattened resources table to
 *   data/external/opendatani-resources.json
 *
 * Politeness: 1 request per second; retries once on transient failures.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const API = 'https://admin.opendatani.gov.uk/api/3/action';
const PAGE = 50;
const SLEEP_MS = 1000;
const OUT_DIR = resolve('data/external');
const OUT_RAW = resolve(OUT_DIR, 'opendatani-catalogue.json');
const OUT_FLAT = resolve(OUT_DIR, 'opendatani-resources.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'civgraph-catalogue-enumerator/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!body.success) throw new Error(`API error: ${JSON.stringify(body.error)}`);
        return body.result;
    } catch (err) {
        if (attempt < 2) {
            console.warn(`  retry ${attempt + 1}: ${err.message}`);
            await sleep(2000);
            return fetchJson(url, attempt + 1);
        }
        throw err;
    }
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });

    console.log('Fetching package_list…');
    const ids = await fetchJson(`${API}/package_list`);
    console.log(`  ${ids.length} packages`);

    const packages = [];
    const pages = Math.ceil(ids.length / PAGE);
    for (let p = 0; p < pages; p++) {
        const offset = p * PAGE;
        const url = `${API}/current_package_list_with_resources?limit=${PAGE}&offset=${offset}`;
        process.stdout.write(`  page ${p + 1}/${pages} (offset ${offset})… `);
        const batch = await fetchJson(url);
        console.log(`${batch.length} records`);
        packages.push(...batch);
        if (p < pages - 1) await sleep(SLEEP_MS);
    }

    console.log(`\nTotal packages fetched: ${packages.length}`);

    // Flatten to one row per resource
    const resources = [];
    for (const pkg of packages) {
        const orgTitle = pkg.organization?.title || null;
        const orgName = pkg.organization?.name || null;
        const tags = (pkg.tags || []).map(t => t.name);
        for (const r of (pkg.resources || [])) {
            resources.push({
                resource_id: r.id,
                resource_name: r.name || null,
                resource_description: r.description || null,
                url: r.url || null,
                format: r.format || null,
                mimetype: r.mimetype || null,
                size: r.size ?? null,
                hash: r.hash || null,
                created: r.created || null,
                last_modified: r.last_modified || null,
                package_id: pkg.id,
                package_name: pkg.name,
                package_title: pkg.title,
                package_notes: pkg.notes || null,
                organization_name: orgName,
                organization_title: orgTitle,
                license_id: pkg.license_id || null,
                license_title: pkg.license_title || null,
                tags,
                metadata_created: pkg.metadata_created || null,
                metadata_modified: pkg.metadata_modified || null
            });
        }
    }

    writeFileSync(OUT_RAW, JSON.stringify(packages, null, 2));
    writeFileSync(OUT_FLAT, JSON.stringify(resources, null, 2));

    console.log(`\nWrote:`);
    console.log(`  ${OUT_RAW}  (${(JSON.stringify(packages).length / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  ${OUT_FLAT}  (${resources.length} resources)`);

    // Quick summary
    const byFormat = {};
    const byOrg = {};
    let withSize = 0, withoutSize = 0, totalBytes = 0;
    for (const r of resources) {
        const fmt = (r.format || 'UNKNOWN').toUpperCase();
        byFormat[fmt] = (byFormat[fmt] || 0) + 1;
        byOrg[r.organization_title || '—'] = (byOrg[r.organization_title || '—'] || 0) + 1;
        const n = typeof r.size === 'number' ? r.size : Number(r.size);
        if (Number.isFinite(n) && n > 0) { withSize++; totalBytes += n; } else withoutSize++;
    }
    const topFormats = Object.entries(byFormat).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topOrgs = Object.entries(byOrg).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('\nTop formats:');
    for (const [f, c] of topFormats) console.log(`  ${f.padEnd(12)} ${c}`);
    console.log('\nTop publishing orgs:');
    for (const [o, c] of topOrgs) console.log(`  ${c.toString().padStart(4)}  ${o}`);
    console.log(`\nResources with size: ${withSize}; without: ${withoutSize}; total known bytes: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
