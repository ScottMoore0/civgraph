import { readFileSync } from 'fs';
const res = JSON.parse(readFileSync('data/external/opendatani-resources.json', 'utf8'));

// Phase 1 target datasets (use package_name slugs or title patterns)
const targets = [
    { id: 'gsni-250k-geology', pattern: /^GSNI 250K Geology$/i },
    { id: 'bedrock-polygon', pattern: /^Bedrock Polygon$/i },
    { id: 'bedrock-boundary', pattern: /^Bedrock boundary$/i },
    { id: 'boundary-line', pattern: /^Boundary Line$/i },
    { id: 'fault-fracture-trace', pattern: /^Fault or fracture trace$/i },
    { id: 'base-of-lava-flow', pattern: /^Base of Lava Flow$/i },
    { id: 'fold-axial-plane-trace', pattern: /^Fold Axial Plane Trace$/i },
    { id: 'linear-bedrock-intrusive', pattern: /^Linear Bedrock Intrusive$/i },
    { id: 'linear-bedrock-unit', pattern: /^Linear Bedrock Unit$/i },
    { id: 'coastal-bedrock-geology', pattern: /^Coastal Bedrock Geology$/i },
    { id: 'gsni-mineral-resources', pattern: /GSNI Northern Ireland Mineral Resources/i },
    { id: 'tellus-stream-sediments', pattern: /GSNI Tellus Regional Stream Sediments/i },
    { id: 'tellus-stream-waters', pattern: /GSNI Tellus Regional Stream Waters/i },
    { id: 'tellus-rural-soil', pattern: /GSNI Tellus Rural Soil Survey/i },
    { id: 'gsni-core-cuttings', pattern: /Core and Cuttings held by GSNI/i }
];

const preferredFormats = ['SHP', 'GEOJSON', 'GPKG', 'GEOPACKAGE', 'GDB', 'KML', 'ZIP'];

for (const t of targets) {
    const matches = res.filter(r => t.pattern.test(r.package_title || ''));
    if (!matches.length) { console.log(`[${t.id}]  NO MATCH`); continue; }

    // Group by package, then pick best spatial resource per package
    const byPkg = new Map();
    for (const r of matches) {
        if (!byPkg.has(r.package_name)) byPkg.set(r.package_name, []);
        byPkg.get(r.package_name).push(r);
    }

    console.log(`\n[${t.id}] — ${byPkg.size} package(s), ${matches.length} resource(s)`);
    for (const [pkg, rs] of byPkg) {
        // Rank resources by preferred format
        const ranked = rs.filter(r => r.url).sort((a, b) => {
            const fa = preferredFormats.indexOf((a.format || '').toUpperCase());
            const fb = preferredFormats.indexOf((b.format || '').toUpperCase());
            return (fa === -1 ? 999 : fa) - (fb === -1 ? 999 : fb);
        });
        const best = ranked[0];
        console.log(`  pkg: ${pkg}`);
        console.log(`    best: [${best.format}] ${best.resource_name || '(unnamed)'} — ${best.resolved_size ? (best.resolved_size/1e6).toFixed(1)+' MB' : '?'}`);
        console.log(`    url: ${best.url}`);
        // Also list the other formats for sourceDownloads
        console.log(`    other-formats: ${ranked.slice(1).map(r => r.format).join(', ')}`);
    }
}
