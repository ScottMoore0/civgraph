/**
 * Build vector "backstop" FGBs for the townland layers — single-feature
 * MultiPolygons containing all townland boundaries at simplified resolution,
 * one per LOD band, used as inert visual underlays beneath the per-feature
 * vector chunks. Replaces the per-zoom PNG raster underlays that used to
 * sit at the same z-index.
 *
 * Each backstop:
 *   - one Feature, one MultiPolygon, one geometry per townland part
 *   - no attributes (stripped — backstop is non-interactive)
 *   - simplified per-zoom-band using ST_SimplifyPreserveTopology
 *   - collected into a single MultiPolygon via ST_Collect (NOT ST_Union —
 *     we want internal boundaries preserved, not dissolved)
 *
 * Outputs go to data/maps/townlands/backstops/. Re-run whenever the
 * source townland files change.
 */
import { execSync } from 'child_process';
import { mkdirSync, statSync, existsSync } from 'fs';

const GDAL = String.raw`C:\Program Files\GDAL\ogr2ogr.exe`;
const OUT_DIR = 'data/maps/townlands/backstops';
mkdirSync(OUT_DIR, { recursive: true });

// (label, sourceFgb, sourceLayer, outName, toleranceDegrees)
//
// Tolerances picked to give ~80m at z7, ~20m at z10. We deliberately skip
// a z13 backstop — at that zoom the chunked vector layer is close to
// feature-complete, so the backstop's marginal benefit is dwarfed by its
// transfer cost. At 54°N: 1 degree ≈ 65 km, so:
//   80m ≈ 0.0008°    20m ≈ 0.0002°
const builds = [
    // NI
    { name: 'ni-townlands-backstop-z7',   src: 'data/maps/townlands/OSNI_Townlands.fgb',          layer: 'OSNI_Townlands',          tol: 0.0008   },
    { name: 'ni-townlands-backstop-z10',  src: 'data/maps/townlands/OSNI_Townlands.fgb',          layer: 'OSNI_Townlands',          tol: 0.0002   },
    // RoI
    { name: 'roi-townlands-backstop-z7',  src: 'data/maps/townlands/OSI_Townlands.fgb',           layer: 'OSI_Townlands',           tol: 0.0008   },
    { name: 'roi-townlands-backstop-z10', src: 'data/maps/townlands/OSI_Townlands.fgb',           layer: 'OSI_Townlands',           tol: 0.0002   },
    // All-Ireland (built from the existing LOD ladder for speed)
    { name: 'all-ireland-townlands-backstop-z7',  src: 'data/maps/townlands/Townlands_AllIreland-lod0.fgb', layer: null, tol: 0.0008   },
    { name: 'all-ireland-townlands-backstop-z10', src: 'data/maps/townlands/Townlands_AllIreland-lod1.fgb', layer: null, tol: 0.0002   },
];

for (const b of builds) {
    const dst = `${OUT_DIR}/${b.name}.fgb`;
    if (!existsSync(b.src)) { console.log(`! source missing: ${b.src}`); continue; }
    console.log(`\nBuilding ${b.name}...`);
    console.log(`  source: ${b.src} (${(statSync(b.src).size / 1024 / 1024).toFixed(1)} MB)`);
    if (existsSync(dst)) {
        console.log(`  (skip — ${dst} exists, ${(statSync(dst).size / 1024 / 1024).toFixed(2)} MB)`);
        continue;
    }
    // Detect layer name if not given
    let layer = b.layer;
    if (!layer) {
        const info = execSync(`"${GDAL.replace('ogr2ogr', 'ogrinfo')}" -so "${b.src}"`, { encoding: 'utf8' });
        const m = info.match(/^\d+:\s*(\S+)/m);
        layer = m ? m[1] : 'layer1';
        console.log(`  detected layer: ${layer}`);
    }
    // Single-feature MultiPolygon: simplify each row's geometry, then collect.
    // -dialect SQLite + ogrinfo's spatialite means ST_* are available.
    const sql = `SELECT ST_Collect(ST_SimplifyPreserveTopology(geometry, ${b.tol})) AS geometry FROM "${layer}"`;
    const cmd = `"${GDAL}" -f FlatGeobuf -nlt MULTIPOLYGON -dialect SQLite ` +
        `-sql "${sql}" -nln backstop "${dst}" "${b.src}"`;
    try {
        execSync(cmd, { stdio: 'pipe' });
        const sz = statSync(dst).size;
        console.log(`  → ${(sz / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
        console.error(`  FAIL: ${e.stderr?.toString()?.slice(0, 200) || e.message}`);
    }
}

console.log('\nDone.');
