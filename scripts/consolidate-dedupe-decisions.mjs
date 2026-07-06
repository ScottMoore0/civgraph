#!/usr/bin/env node
/**
 * Consolidate the dedupe adjudication into one worklist:
 *   - 972 auto decisions (600 publish-new / 372 duplicate-skip) taken as-is
 *   - 50 escalations resolved by human/agent adjudication (see maps below)
 *   - 3 Tellus ESRIGRID rows reclassified publish-new -> duplicate-skip
 * Emits consolidated CSV + a publish-new backlog JSON + a summary.
 */
import { readFileSync, writeFileSync } from 'fs';

const D = 'data/review-inputs/remaining-decision-packs-2026-06-27';
const SRC = `${D}/dedupe-decisions.csv`;

function parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else q=false;}else field+=c;}else if(c==='"')q=true;else if(c===','){row.push(field);field='';}else if(c==='\n'||c==='\r'){if(field!==''||row.length){row.push(field);rows.push(row);row=[];field='';}if(c==='\r'&&text[i+1]==='\n')i++;}else field+=c;}if(field!==''||row.length){row.push(field);rows.push(row);}return rows;}
const csvCell = (v) => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };

const rows = parseCsv(readFileSync(SRC,'utf8'));
const hdr = rows[0]; const ix = Object.fromEntries(hdr.map((h,i)=>[h.trim(),i]));
const recs = rows.slice(1).filter(r => r.length >= hdr.length && r[ix.id]);

// --- escalation adjudication (by numeric suffix of already-on-site-review:NNNN) ---
const num = (id) => id.replace(/^.*:/,'');
const ESC_SKIP = new Set(['949','950','952','953','954','956','957','958','959','960','961','962','963','964','965', // 15 constituency slices (parent already on-site)
                          '270',   // Northern Ireland River Segments == on-site NIEA River Segments
                          '1087']); // short-title internal dup of 1085
const ESC_VARIANT = new Map([['522', 'Development Plan 2022 2028 (DCC)']]); // DCC Development Planning -> variant of on-site plan
const ESC_SKIP_REASON = {
  constituency: 'escalation: per-constituency slice of "Parliamentary Constituencies 2023" which is already on-site (parent set published)',
  '270': 'escalation: duplicate of on-site "NIEA River Segments"',
  '1087': 'escalation: internal duplicate of record 1085 (fuller-titled INSPIRE WFD groundwater DWPA register)',
};
// 3 Tellus ESRIGRID rows: raw grid download format of already-published Tellus geophysics
const TELLUS_SKIP = new Set(['1112','1113','1114']);

let escSkip=0, escVariant=0, escPublish=0, tellus=0;
const out = [];
for (const r of recs) {
  const id = r[ix.id]; const n = num(id);
  const rec = {
    id, title: r[ix.title], provider: r[ix.provider],
    autoDecision: (r[ix.autoDecision]||'').trim(),
    bestMatchCandidateTitle: r[ix.bestMatchCandidateTitle],
    bestMatchScore: r[ix.bestMatchScore], titleJaccard: r[ix.titleJaccard],
  };
  let finalDecision = rec.autoDecision, source = 'auto', variantOf = '', reason = r[ix.reason];

  if (rec.autoDecision === 'escalate') {
    source = 'escalation-adjudication';
    if (ESC_SKIP.has(n)) {
      finalDecision = 'duplicate-skip'; escSkip++;
      reason = /^9[0-9][0-9]$|^95[0-9]$|^96[0-5]$/.test(n) ? ESC_SKIP_REASON.constituency : (ESC_SKIP_REASON[n] || 'escalation: duplicate of on-site record');
      if (n === '270') reason = ESC_SKIP_REASON['270'];
      else if (n === '1087') reason = ESC_SKIP_REASON['1087'];
      else reason = ESC_SKIP_REASON.constituency;
    } else if (ESC_VARIANT.has(n)) {
      finalDecision = 'publish-as-variant'; variantOf = ESC_VARIANT.get(n); escVariant++;
      reason = `escalation: publish as variant/enrichment of on-site "${variantOf}"`;
    } else {
      finalDecision = 'publish-new'; escPublish++;
      reason = 'escalation: distinct from nearest on-site match (different jurisdiction/scale/product) — publish';
    }
  } else if (TELLUS_SKIP.has(n) && rec.autoDecision === 'publish-new') {
    finalDecision = 'duplicate-skip'; source = 'tellus-reclass'; tellus++;
    reason = 'reclassified: ESRIGRID raw-grid download format of already-published Tellus geophysics raster';
  }

  out.push({ ...rec, finalDecision, variantOf, source, reason });
}

// counts
const tally = out.reduce((a,r)=>{a[r.finalDecision]=(a[r.finalDecision]||0)+1;return a;},{});

// --- write consolidated CSV ---
const cols = ['id','title','provider','autoDecision','finalDecision','variantOf','source','bestMatchCandidateTitle','bestMatchScore','titleJaccard','reason'];
const csv = [cols.join(',')].concat(out.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\n') + '\n';
writeFileSync(`${D}/consolidated-dedupe-decisions.csv`, csv);

// --- write publish-new backlog (map-conversion worklist) ---
const backlog = out.filter(r => r.finalDecision === 'publish-new')
  .map(r => ({ id: r.id, title: r.title, provider: r.provider, bestMatchCandidateTitle: r.bestMatchCandidateTitle, source: r.source }));
writeFileSync(`${D}/publish-new-backlog.json`, JSON.stringify({ generatedFrom: SRC, count: backlog.length, note: 'Distinct layers cleared to publish; feed through scripts/publish-clean-maps.mjs pipeline.', records: backlog }, null, 2));

// --- summary ---
const md = `# Consolidated dedupe decisions

Source: \`${SRC}\` (1,022 ranked candidates) + 50-escalation adjudication + Tellus ESRIGRID reclassification.

## Final tally
- **publish-new: ${tally['publish-new']||0}** — distinct layers cleared to publish (map-conversion backlog)
- **duplicate-skip: ${tally['duplicate-skip']||0}** — already represented on-site; drop
- **publish-as-variant: ${tally['publish-as-variant']||0}** — link as enrichment of an existing record

## How the 50 escalations resolved
- **${escSkip} → duplicate-skip**: 15 per-constituency slices of "Parliamentary Constituencies 2023" (parent already on-site); \`270\` NI River Segments (= on-site NIEA River Segments); \`1087\` (internal dup of \`1085\`).
- **${escVariant} → publish-as-variant**: \`522\` Development Planning DCC → variant of on-site "Development Plan 2022 2028 (DCC)".
- **${escPublish} → publish-new**: distinct by jurisdiction / scale / product (ROI-vs-NI splits, INSPIRE HVD registers, community-scale flood layers, county-specific civic layers, etc.).

## Tellus reclassification
- **${tellus} → duplicate-skip**: \`1112/1113/1114\` (Tellus_{Electromagnetics,Magnetics,Radiometrics}_ESRIGRID) are the ESRIGRID raw-grid *download format* of the already-published Tellus geophysics rasters. The rendered raster products (985–988) correctly remain publish-new.

## Outputs
- \`consolidated-dedupe-decisions.csv\` — all 1,022 with finalDecision + source + reason
- \`publish-new-backlog.json\` — the ${backlog.length} publish-new records as a conversion worklist
`;
writeFileSync(`${D}/CONSOLIDATED-DEDUPE-SUMMARY.md`, md);

console.log('final tally:', JSON.stringify(tally));
console.log(`escalations: skip ${escSkip}, variant ${escVariant}, publish ${escPublish} (=${escSkip+escVariant+escPublish})`);
console.log(`tellus reclassified: ${tellus}`);
console.log(`total rows: ${out.length}; backlog: ${backlog.length}`);
