#!/usr/bin/env node
/**
 * Emit approved-publication source/download records for three medium-priority
 * prep-pack buckets whose placement is "Books/Tables/Sources source/download
 * record" (same lightweight mechanism as the census and the first LA tranche):
 *
 *   --bucket held-la          755 local-authority rows held only by the single
 *                             conservative "duplicate-or-variant-review: no
 *                             existing match candidate" blocker. Dedup pass
 *                             (2026-07-08) confirmed 0 auto-match evidence, 0
 *                             URL/id collision with the live gate, 0 intra-batch
 *                             dups -> publish-as-distinct. id prefix la-source-.
 *   --bucket transport        transport/roads/infrastructure/public-asset rows
 *                             with residualBlockerCount 0. id prefix transport-source-.
 *   --bucket source-download  non-spatial/tabular/doc rows with residualBlockerCount 0.
 *                             id prefix dl-source-.
 *
 * All three: rights confirmed clear 2026-07-08. data.gov.ie -> CC BY 4.0 (Irish
 * PSI attribution); Open Data NI -> OGL v3.0. ids are made unique against the
 * LIVE gate (suffixing) so the merge step drops nothing; rows whose provider URL
 * already appears as a gate reference are skipped as already-published.
 *
 * Usage: node scripts/emit-medium-priority-source-records.mjs --bucket <b> --out <path>
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const getArg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const bucket = getArg('--bucket');
const out = getArg('--out', `mp-source-records-${bucket || 'x'}.json`);
const SRC = 'data/review-inputs/medium-priority-publication-prep-2026-06-25/row-staging-records.json';
const GATE = 'data/database/approved-publication-sources.json';

const BUCKETS = {
  'held-la': {
    action: 'local-authority-batch-review',
    idPrefix: 'la-source',
    batchId: 'la-local-authority-source-records-held-dedup-cleared',
    held: true,
    rightsNote: 'Local-authority / data.gov.ie / Open Data NI open data. Held only by a conservative duplicate-or-variant-review flag; dedup pass 2026-07-08 confirmed no existing match / no collision -> published as distinct. Rights confirmed clear 2026-07-08.',
  },
  'transport': {
    action: 'transport-public-asset-batch-review',
    idPrefix: 'transport-source',
    batchId: 'transport-public-asset-source-records',
    held: false,
    rightsNote: 'Transport / roads / infrastructure / public-asset open data (data.gov.ie / Open Data NI). Rights confirmed clear 2026-07-08.',
  },
  'source-download': {
    action: 'source-download-only',
    idPrefix: 'dl-source',
    batchId: 'source-download-records',
    held: false,
    rightsNote: 'Non-spatial / tabular / document open-data source (data.gov.ie / Open Data NI). Rights confirmed clear 2026-07-08.',
  },
};

if (!BUCKETS[bucket]) { console.error(`--bucket must be one of: ${Object.keys(BUCKETS).join(', ')}`); process.exit(1); }
const cfg = BUCKETS[bucket];

const rows = JSON.parse(readFileSync(SRC, 'utf8'));
const gate = JSON.parse(readFileSync(GATE, 'utf8'));

// Live-gate collision sets: ids (suffix to avoid silent merge-dedup drops) and
// reference URLs (skip rows already published under any id).
const gateIds = new Set(gate.sources.map((s) => s.id));
const gateUrls = new Set();
for (const s of gate.sources) for (const ref of (s.references || [])) if (ref.url) gateUrls.add(ref.url.replace(/\/+$/, ''));

const LICENSE = {
  'data.gov.ie': { license: 'CC BY 4.0', attribution: 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.' },
  'Open Data NI': { license: 'OGL v3.0', attribution: 'Contains public sector information licensed under the Open Government Licence v3.0.' },
};

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const yearOf = (t) => (String(t || '').match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || '';

const sources = [];
const seenId = new Set();
let skippedBlocker = 0, skippedUrl = 0, skippedLicense = 0, skippedAlreadyPublished = 0;

for (const r of rows) {
  if (r.proposedAction !== cfg.action) continue;
  const blockerCount = r.residualBlockerCount || 0;
  if (cfg.held) {
    // Held bucket: accept only rows whose sole blocker is the conservative
    // duplicate-or-variant flag AND that carry no auto-match evidence.
    const blockers = Array.isArray(r.residualBlockers) ? r.residualBlockers : (r.residualBlockers ? [r.residualBlockers] : []);
    const onlyDupFlag = blockers.length === 1 && String(blockers[0]).startsWith('duplicate-or-variant-review');
    const hasMatch = r.bestExistingMatchId || (Array.isArray(r.allMatchEvidence) && r.allMatchEvidence.length > 0);
    if (!(onlyDupFlag && !hasMatch)) { skippedBlocker++; continue; }
  } else {
    if (blockerCount !== 0) { skippedBlocker++; continue; }
    if (r.bestExistingMatchId) { skippedBlocker++; continue; }
  }

  const url = (r.currentProviderUrl || '');
  if (!/^https?:\/\//i.test(url)) { skippedUrl++; continue; }
  const normUrl = url.replace(/\/+$/, '');
  if (gateUrls.has(normUrl)) { skippedAlreadyPublished++; continue; }

  const lic = LICENSE[r.provider];
  if (!lic) { skippedLicense++; continue; }

  const title = r.cleanTitle || r.title;
  const baseSlug = slugify(r.slugOrId || title);
  let id = `approved-publication:${cfg.idPrefix}-${baseSlug}`;
  if (gateIds.has(id) || seenId.has(id)) { let n = 2; while (gateIds.has(`${id}-${n}`) || seenId.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
  seenId.add(id);

  const references = [{ label: `${r.provider} — ${title}`, url, note: lic.license }];
  if (r.waybackUrl && /^https?:\/\//i.test(r.waybackUrl)) {
    references.push({ label: 'Wayback Machine (provider URL history)', url: r.waybackUrl, note: 'archived copy' });
  }

  const topicKw = r.topic ? [r.topic] : [];
  sources.push({
    id,
    slug: id.replace('approved-publication:', 'approved-publication-'),
    type: 'approved-table-source',
    title,
    subtitle: `${r.provider} / ${cfg.idPrefix.replace('-source', '')}-open-data / Browse/Tables plus Sources`,
    category: 'Approved tables',
    date: yearOf(title),
    dateSource: yearOf(title) ? 'title' : 'none',
    provider: [r.organisation || r.provider],
    description: `${r.topic ? r.topic.replace(/-/g, ' ') + ' ' : ''}open-data source from ${r.provider}${r.organisation ? ` — ${r.organisation}` : ''}. Published as a Books/Tables/Sources source record under ${lic.license}. ${lic.attribution}`,
    keywords: [cfg.idPrefix, 'open-data', slugify(r.provider), ...topicKw, lic.license === 'OGL v3.0' ? 'OGL-v3.0' : 'CC-BY-4.0', 'publish', 'approved-publication'].filter(Boolean),
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approved-staged',
    license: lic.license,
    licence: lic.license,
    attribution: lic.attribution,
    references,
    approval: {
      stagingId: r.id,
      recommendedAction: 'publish',
      batchId: cfg.batchId,
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-provider-url',
      sourceResolutionConfidence: (r.confidence || 0) >= 70 ? 'high' : 'medium',
      defaultAction: 'publish-as-books-tables-sources-entry-after-approval',
      rightsNote: cfg.rightsNote,
    },
  });
}

const doc = {
  schemaVersion: 1,
  generatedFrom: SRC,
  bucket,
  candidateOnly: true,
  note: `${cfg.batchId}: source/download records. Rights confirmed clear 2026-07-08. data.gov.ie=CC BY 4.0, Open Data NI=OGL v3.0.`,
  counts: { total: sources.length, skippedBlocker, skippedUrl, skippedLicense, skippedAlreadyPublished },
  sources,
};
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`[${bucket}] emitted ${sources.length} (skip: blocker ${skippedBlocker}, url ${skippedUrl}, license ${skippedLicense}, already-published ${skippedAlreadyPublished}) -> ${out}`);
