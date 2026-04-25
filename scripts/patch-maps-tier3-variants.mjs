/**
 * Tier 3: convert the bedrock + superficial geology entries into groups
 * with two variants each:
 *
 *   By formation / lithology (BGS-published palette via QML)  — default
 *   By geological age / textbook earth-tones                   — variant
 *
 * The parent entry becomes a group (isGroup: true, no files) referring to
 * two variants in its variants[] array. Each variant carries its own
 * colorMap config; data-service.js getMapById merges parent + variant
 * when a variant is loaded.
 */
import { readFileSync, writeFileSync } from 'fs';

const PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

function patchToGroup(parentId, variants) {
    const parent = db.maps.find(m => m.id === parentId);
    if (!parent) { console.error(`! parent missing: ${parentId}`); return; }

    // Strip the per-feature colour spec, files, style etc. from the parent —
    // they live on the variants now. Keep id, name, slug, category, provider,
    // description, keywords, references, sourceDownloads, useLOD.
    delete parent.files;
    delete parent.style;
    delete parent.colorMap;
    delete parent.colorScale;
    delete parent.labelProperty;
    parent.isGroup = true;
    parent.variants = variants;
    console.log(`+ ${parentId} → group with ${variants.length} variants`);
    for (const v of variants) console.log(`    - ${v.id}: ${v.label}${v.isDefault ? '  (default)' : ''}`);
}

// ─── Bedrock 250K ─────────────────────────────────────────────────────────
const bedrockFgb = 'https://data.civgraph.net/data/maps/geology/bedrock-geology-polygons.fgb';
patchToGroup('gsni-bedrock-geology-polygons-250k', [
    {
        id: 'gsni-bedrock-by-formation',
        label: 'By formation (BGS palette)',
        description: 'Bedrock geology coloured by lithological formation using the official BGS / GSNI 1:250K palette extracted from the QGIS style file published with the dataset. Each of the 234 named formations gets its specific colour.',
        files: { fgb: bedrockFgb },
        style: { weight: 0.6 },
        labelProperty: 'LEX_D',
        useLOD: true,
        isDefault: true,
        colorMap: {
            property: 'LEX_RCS_I',
            palette: 'bgs_lex_bedrock',
            fallback: {
                property: ['MAX_PERIOD', 'MAX_ERA', 'MAX_EON'],
                palette: 'iugs'
            },
            default: '#bdbdbd'
        }
    },
    {
        id: 'gsni-bedrock-by-age',
        label: 'By geological age (IUGS)',
        description: 'Bedrock geology coloured by geological period / era using the IUGS / International Commission on Stratigraphy palette (the textbook age-coloured map). Coarser than the formation view but immediately legible — Carboniferous teal, Cretaceous green, Palaeogene orange, etc.',
        files: { fgb: bedrockFgb },
        style: { weight: 0.6 },
        labelProperty: 'MAX_PERIOD',
        useLOD: true,
        colorMap: {
            property: ['MAX_PERIOD', 'MAX_ERA', 'MAX_EON'],
            palette: 'iugs',
            default: '#bdbdbd'
        }
    }
]);

// ─── Superficial 250K ─────────────────────────────────────────────────────
const superficialFgb = 'https://data.civgraph.net/data/maps/geology/superficial-geology-polygons.fgb';
patchToGroup('gsni-superficial-geology-polygons-250k', [
    {
        id: 'gsni-superficial-by-deposit',
        label: 'By deposit type (BGS palette)',
        description: 'Quaternary superficial deposits coloured by deposit-type using the official BGS / GSNI 1:250K palette from the published QGIS style file. ALLUVIUM yellow, TILL pale cyan, PEAT brown, GLACIAL SAND AND GRAVEL pink — the colours used in the BGS Geology of Britain Viewer.',
        files: { fgb: superficialFgb },
        style: { weight: 0.6 },
        labelProperty: 'LEX_D',
        useLOD: true,
        isDefault: true,
        colorMap: {
            property: 'LEX_D',
            palette: 'bgs_lex_superficial',
            default: '#cccccc'
        }
    },
    {
        id: 'gsni-superficial-conventional',
        label: 'By deposit type (conventional earth-tones)',
        description: 'Quaternary superficial deposits coloured using the conventional textbook earth-tone palette (TILL brown, ALLUVIUM yellow, BLOWN SAND cream) rather than the BGS-pink convention.',
        files: { fgb: superficialFgb },
        style: { weight: 0.6 },
        labelProperty: 'LEX_D',
        useLOD: true,
        colorMap: {
            property: 'LEX_D',
            palette: 'superficial',
            default: '#bdbdbd'
        }
    }
]);

writeFileSync(PATH, JSON.stringify(db, null, 2));
console.log(`\nDone. Total maps: ${db.maps.length}`);
