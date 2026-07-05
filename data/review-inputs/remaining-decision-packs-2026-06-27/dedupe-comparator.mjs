#!/usr/bin/env node
// dedupe-comparator.mjs
// -----------------------------------------------------------------------------
// Collapses the 1,022-row "already-on-site" dedupe queue into three
// auto-decisions so a human only has to look at the genuinely ambiguous middle.
//
//   duplicate-skip : do NOT republish as new (it is a variant / alternate
//                    format / source of an existing Civgraph record).
//   publish-new    : negligible overlap with the named candidate -> republish.
//   escalate       : signals disagree or are unclear -> human eyes required.
//
// KEY DATA FACT (verified while building this): `bestMatchScore` is a
// family / geography / provider AFFINITY score, NOT a title-similarity score.
// High-score rows routinely have an unrelated candidate title (e.g.
// "Government Land and Property Assets" scores 0.80 against candidate
// "March 2020"). The matcher never confirmed a hard duplicate (max ~0.80).
// Therefore the *primary* duplicate discriminator here is a normalized
// title-token Jaccard against the named candidate, combined with the tool's
// own `decisionBucket` (whose `recommendedAction` text already encodes a
// multi-signal provider/date/geometry judgement) and the affinity score.
//
// Run:  node dedupe-comparator.mjs
// Outputs (written next to this script):
//   dedupe-decisions.csv      all 1,022 rows + autoDecision + reason
//   dedupe-escalate.csv        just the escalate rows (human worklist)
//   DEDUPE-DECISIONS-SUMMARY.md
// -----------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const IN_CSV = path.join(DIR, 'dedupe-queue-ranked.csv');

// ---- Tunable thresholds -----------------------------------------------------
const T = {
  // titleJaccard at/above this = titles are effectively the same dataset.
  J_NEAR_IDENTICAL: 0.55,
  // titleJaccard band that is "partial overlap" -> ambiguous -> escalate.
  J_PARTIAL_LO: 0.30,
  // affinity score below this = tool sees essentially no family match.
  SCORE_TAIL: 0.15,
  // affinity score that a title-based duplicate-skip must also clear.
  SCORE_DUP_MIN: 0.45,
};

// Buckets whose recommendedAction explicitly says "do not create a duplicate
// parent" / "promote only as a variant/source". These ARE duplicate-skip by
// the tool's own recommendation (it already compared provider/date/geometry).
const DUP_BUCKETS = new Set([
  'safe-related-source-enrichment-review',
  'probable-variant-or-source-enrichment',
]);

// ---- CSV parse / write ------------------------------------------------------
function parseCSV(t) {
  const rows = []; let f = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { f.push(cur); cur = ''; }
      else if (c === '\n') { f.push(cur); rows.push(f); f = []; cur = ''; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || f.length) { f.push(cur); rows.push(f); }
  return rows;
}
function csvCell(v) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(header, rows) {
  return [header.map(csvCell).join(',')]
    .concat(rows.map(r => header.map(h => csvCell(r[h])).join(',')))
    .join('\n') + '\n';
}

// ---- Title normalization + Jaccard -----------------------------------------
const STOP = new Set([
  'boundary', 'boundaries', 'the', 'of', 'and', 'a', 'an', 'for', 'in', 'on',
  'to', 'by', 'with', 'at', 'as', 'or',
]);
function tokens(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w
      && !STOP.has(w)
      && !/^(19|20)\d{2}$/.test(w)); // strip 4-digit years
}
function jaccard(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// ---- Decision logic ---------------------------------------------------------
function decide({ score, bucket, j }) {
  // 1. Strong title match overrides everything: same dataset, don't republish.
  if (j >= T.J_NEAR_IDENTICAL && score >= T.SCORE_DUP_MIN)
    return ['duplicate-skip', `near-identical title (jaccard ${j.toFixed(2)}) + score ${score.toFixed(2)}`];

  // 2. Tool's own confident variant/source buckets (recommendedAction says
  //    "do not create a duplicate parent" / "promote only as variant").
  if (DUP_BUCKETS.has(bucket))
    return ['duplicate-skip', `tool bucket "${bucket}" (variant/source; score ${score.toFixed(2)}, jaccard ${j.toFixed(2)})`];

  // 3. Tool says weak / no real target -> republish.
  if (bucket === 'hold-weak-match')
    return ['publish-new', `weak-match bucket; no existing target (score ${score.toFixed(2)})`];

  // 4. Negligible affinity tail -> republish.
  if (score < T.SCORE_TAIL)
    return ['publish-new', `negligible affinity (score ${score.toFixed(2)} < ${T.SCORE_TAIL})`];

  // 5. Uncertain buckets: hold-context-overlap & hold-low-confidence-variant.
  //    Discriminate purely on title-token overlap.
  if (j >= T.J_NEAR_IDENTICAL)
    return ['duplicate-skip', `near-identical title (jaccard ${j.toFixed(2)}) in "${bucket}"`];
  if (j >= T.J_PARTIAL_LO)
    return ['escalate', `partial title overlap (jaccard ${j.toFixed(2)}) in "${bucket}" — signals ambiguous`];
  return ['publish-new', `low title overlap (jaccard ${j.toFixed(2)}) in "${bucket}"; tool: context/low-confidence not enough for a dupe`];
}

// ---- Main -------------------------------------------------------------------
const rows = parseCSV(fs.readFileSync(IN_CSV, 'utf8'));
const H = rows[0];
const idx = Object.fromEntries(H.map((h, i) => [h, i]));
const data = rows.slice(1).filter(r => r.length > 1);

const OUT_HEADER = ['id', 'title', 'provider', 'bestMatchScore',
  'bestMatchCandidateTitle', 'titleJaccard', 'autoDecision', 'reason'];

const out = data.map(r => {
  const score = parseFloat(r[idx.bestMatchScore]) || 0;
  const bucket = r[idx.decisionBucket];
  const title = r[idx.title];
  const cand = r[idx.bestMatchCandidateTitle];
  const j = jaccard(title, cand);
  const [autoDecision, reason] = decide({ score, bucket, j });
  return {
    id: r[idx.id], title, provider: r[idx.provider],
    bestMatchScore: r[idx.bestMatchScore],
    bestMatchCandidateTitle: cand,
    titleJaccard: j.toFixed(3),
    autoDecision, reason,
  };
});

// counts
const counts = {};
out.forEach(o => counts[o.autoDecision] = (counts[o.autoDecision] || 0) + 1);

// write all decisions
fs.writeFileSync(path.join(DIR, 'dedupe-decisions.csv'), toCSV(OUT_HEADER, out));

// write escalate worklist, sorted by score desc
const esc = out.filter(o => o.autoDecision === 'escalate')
  .sort((a, b) => parseFloat(b.bestMatchScore) - parseFloat(a.bestMatchScore));
fs.writeFileSync(path.join(DIR, 'dedupe-escalate.csv'), toCSV(OUT_HEADER, esc));

// summary md
const md = `# Dedupe auto-decision summary

Generated by \`dedupe-comparator.mjs\` from \`dedupe-queue-ranked.csv\` (${out.length} rows).

## Result — human decisions remaining: **${counts.escalate || 0}**

| autoDecision | count |
|---|---:|
| duplicate-skip | ${counts['duplicate-skip'] || 0} |
| publish-new | ${counts['publish-new'] || 0} |
| **escalate (human worklist)** | **${counts.escalate || 0}** |
| total | ${out.length} |

## Key data fact driving the method

\`bestMatchScore\` is a **family / geography / provider affinity** score, **not**
title similarity. High-score rows routinely have an unrelated candidate title
(e.g. "Government Land and Property Assets" scores 0.80 vs candidate
"March 2020"). The matcher **never confirmed a hard duplicate** (max ~0.80).
So the primary duplicate discriminator is a normalized **title-token Jaccard**
against the named candidate, combined with the tool's own \`decisionBucket\`
(whose \`recommendedAction\` already encodes a provider/date/geometry judgement)
and the affinity score.

## Decision rules (in order)

1. **duplicate-skip** if titleJaccard ≥ ${T.J_NEAR_IDENTICAL} **and** score ≥ ${T.SCORE_DUP_MIN} (same dataset, near-identical title).
2. **duplicate-skip** if \`decisionBucket\` ∈ {\`safe-related-source-enrichment-review\`, \`probable-variant-or-source-enrichment\`} — the tool's own recommendedAction says *"do not create a duplicate parent"* / *"promote only as a variant/source"* (it already compared provider/date/geometry). All such rows sit at score ≥ 0.45.
3. **publish-new** if \`decisionBucket\` = \`hold-weak-match\` (no existing target).
4. **publish-new** if score < ${T.SCORE_TAIL} (negligible affinity tail).
5. For the uncertain buckets (\`hold-context-overlap\`, \`hold-low-confidence-variant-review\`), decide on title overlap alone:
   - titleJaccard ≥ ${T.J_NEAR_IDENTICAL} → **duplicate-skip**
   - ${T.J_PARTIAL_LO} ≤ titleJaccard < ${T.J_NEAR_IDENTICAL} → **escalate** (partial overlap, ambiguous)
   - titleJaccard < ${T.J_PARTIAL_LO} → **publish-new** (tool itself says context/low-confidence overlap is not enough evidence for a dupe)

## Thresholds

\`\`\`json
${JSON.stringify(T, null, 2)}
\`\`\`

Title normalization: lowercase, non-alphanumerics → spaces, drop 4-digit years
and stopwords (${[...STOP].join(', ')}); Jaccard over the resulting token sets.

## What "escalate" contains

Only rows in the uncertain buckets where the new title *partially* matches the
named candidate (Jaccard ${T.J_PARTIAL_LO}–${T.J_NEAR_IDENTICAL}) — i.e. score
and title genuinely disagree or are borderline. Everything cleanly separable was
auto-decided. See \`dedupe-escalate.csv\` (sorted by score desc).
`;
fs.writeFileSync(path.join(DIR, 'DEDUPE-DECISIONS-SUMMARY.md'), md);

console.log('counts:', JSON.stringify(counts));
console.log('escalate rows:', counts.escalate || 0);
