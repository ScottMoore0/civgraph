/**
 * Parse the GSNI 1:250K QML style files (downloaded from Open Data NI's
 * `gsni-250k-geology` package) and extract per-feature colour lookups:
 *
 *   bgs_lex_bedrock      LEX_RCS_I -> #rrggbb     (260 categories)
 *   bgs_lex_superficial  LEX_D     -> #rrggbb     (12 deposit types, derived
 *                                                   from rule labels of the
 *                                                   form "LEX_D - RCS_D")
 *
 * Writes both as JSON files in js/ for the bundle to import.
 */
import { readFileSync, writeFileSync } from 'fs';

function parseSymbols(qml) {
    // For each <symbol type="fill" name="N">, walk forward to find the first
    // <Option ... name="color" value="r,g,b,a"/> in its <SimpleFill> layer.
    const symbols = {};
    const symbolRe = /<symbol[^>]*type="fill"[^>]*name="(\d+)"[^>]*>([\s\S]*?)<\/symbol>/g;
    let m;
    while ((m = symbolRe.exec(qml)) !== null) {
        const name = m[1];
        const body = m[2];
        // Find the SimpleFill layer's color option
        const colorMatch = body.match(/<Option[^>]*name="color"[^>]*value="(\d+),(\d+),(\d+),?\d*"/);
        if (colorMatch) {
            const [, r, g, b] = colorMatch;
            symbols[name] = '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
        }
    }
    return symbols;
}

function extractCategorized(qml) {
    // Bedrock: <category symbol="N" value="LEX_RCS_I" label="..."/>
    const cats = [];
    const catRe = /<category\b[^/]*symbol="(\d+)"[^/]*value="([^"]+)"[^/]*\/>/g;
    let m;
    while ((m = catRe.exec(qml)) !== null) {
        cats.push({ symbol: m[1], value: m[2] });
    }
    return cats;
}

function extractRules(qml) {
    // Superficial: <rule symbol="N" label="LEX_D - RCS_D" .../>
    const rules = [];
    const ruleRe = /<rule\b[^/]*symbol="(\d+)"[^/]*label="([^"]+)"[^/]*\/>/g;
    let m;
    while ((m = ruleRe.exec(qml)) !== null) {
        rules.push({ symbol: m[1], label: m[2] });
    }
    return rules;
}

// ─── Bedrock ──────────────────────────────────────────────────────────────
{
    const qml = readFileSync('_tmp_geology_styles/NI_250k_Bedrock_Geology_Polygons.qml', 'utf8');
    const symbols = parseSymbols(qml);
    const cats = extractCategorized(qml);
    const lookup = {};
    let mapped = 0, missing = 0;
    for (const c of cats) {
        const hex = symbols[c.symbol];
        if (hex) { lookup[c.value] = hex; mapped++; }
        else { missing++; }
    }
    writeFileSync('js/bgs-palette-bedrock.json', JSON.stringify(lookup, null, 0));
    console.log(`bedrock: ${cats.length} categories, ${Object.keys(symbols).length} symbol colours, ${mapped} mapped, ${missing} missing`);
    // Print 5 samples
    for (const k of Object.keys(lookup).slice(0, 5)) console.log(`  ${k} -> ${lookup[k]}`);
}

// ─── Superficial ──────────────────────────────────────────────────────────
{
    const qml = readFileSync('_tmp_geology_styles/NI_250k_Superficial_Geology_Polygons.qml', 'utf8');
    const symbols = parseSymbols(qml);
    const rules = extractRules(qml);
    // Rule labels are "LEX_D - RCS_D"; extract the LEX_D portion
    const lookup = {};
    for (const r of rules) {
        const lex = r.label.split(' - ')[0]?.trim();
        if (!lex) continue;
        const hex = symbols[r.symbol];
        if (hex) lookup[lex] = hex;
    }
    writeFileSync('js/bgs-palette-superficial.json', JSON.stringify(lookup, null, 2));
    console.log(`superficial: ${rules.length} rules, ${Object.keys(symbols).length} symbol colours, ${Object.keys(lookup).length} mapped`);
    for (const k of Object.keys(lookup)) console.log(`  ${k} -> ${lookup[k]}`);
}
