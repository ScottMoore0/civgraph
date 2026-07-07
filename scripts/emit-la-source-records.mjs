#!/usr/bin/env node
/**
 * Local-authority source-record emitter. Turns the ready (zero residual-blocker)
 * local-authority-batch-review rows from the medium-priority prep pack into
 * approved-publication gate records with placement "Books/Tables/Sources
 * source/download record" (same mechanism as the census tranches).
 *
 * Scope (rights confirmed clear 2026-07-07): only rows with
 *   proposedAction === 'local-authority-batch-review'
 *   AND residualBlockerCount === 0            (worklist's "ready" gate)
 *   AND no bestExistingMatchId                (non-duplicate)
 *   AND a public currentProviderUrl
 * License by provider: data.gov.ie -> CC BY 4.0 (Irish PSI); Open Data NI -> OGL v3.0.
 *
 * Usage: node scripts/emit-la-source-records.mjs --out <path>
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'la-source-records.json';
const SRC = 'data/review-inputs/medium-priority-publication-prep-2026-06-25/row-staging-records.json';

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = Array.isArray(raw) ? raw : Object.values(raw).find(Array.isArray);

const LICENSE = {
  'data.gov.ie': { license: 'CC BY 4.0', attribution: 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.' },
  'Open Data NI': { license: 'OGL v3.0', attribution: 'Contains public sector information licensed under the Open Government Licence v3.0.' },
};

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const yearOf = (t) => (String(t || '').match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || '';

const sources = [];
let skipped = 0;
const seen = new Set();
for (const r of rows) {
  if (r.proposedAction !== 'local-authority-batch-review') continue;
  if ((r.residualBlockerCount || 0) !== 0) { skipped++; continue; }
  if (r.bestExistingMatchId) { skipped++; continue; }
  const url = r.currentProviderUrl;
  if (!(url && /^https?:\/\//i.test(url))) { skipped++; continue; }
  const lic = LICENSE[r.provider];
  if (!lic) { skipped++; continue; }

  const title = r.cleanTitle || r.title;
  const baseSlug = slugify(r.slugOrId || title);
  let id = `approved-publication:la-source-${baseSlug}`;
  // guarantee uniqueness within this batch
  if (seen.has(id)) { let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
  seen.add(id);

  const references = [{ label: `${r.provider} — ${title}`, url, note: lic.license }];
  if (r.waybackUrl && /^https?:\/\//i.test(r.waybackUrl)) {
    references.push({ label: 'Wayback Machine (provider URL history)', url: r.waybackUrl, note: 'archived copy' });
  }

  sources.push({
    id,
    slug: id.replace('approved-publication:', 'approved-publication-'),
    type: 'approved-table-source',
    title,
    subtitle: `${r.provider} / local-authority-open-data / Browse/Tables plus Sources`,
    category: 'Approved tables',
    date: yearOf(title),
    dateSource: yearOf(title) ? 'title' : 'none',
    provider: [r.organisation || r.provider],
    description: `Local authority / public-sector open-data source${r.topic ? ` (${r.topic})` : ''} from ${r.provider}${r.organisation ? ` — ${r.organisation}` : ''}. Published as a Books/Tables/Sources source record under ${lic.license}. ${lic.attribution}`,
    keywords: ['local-authority', 'open-data', slugify(r.provider), ...(r.topic ? [r.topic] : []), lic.license === 'OGL v3.0' ? 'OGL-v3.0' : 'CC-BY-4.0', 'publish', 'approved-publication'].filter(Boolean),
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approved-staged',
    license: lic.license,
    licence: lic.license,
    attribution: lic.attribution,
    references,
    approval: {
      stagingId: r.id,
      recommendedAction: 'publish',
      batchId: 'la-local-authority-source-records',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-provider-url',
      sourceResolutionConfidence: (r.confidence || 0) >= 70 ? 'high' : 'medium',
      defaultAction: 'publish-as-books-tables-sources-entry-after-approval',
      rightsNote: 'Local-authority / data.gov.ie / Open Data NI open data; rights confirmed clear 2026-07-07.',
    },
  });
}

const doc = {
  schemaVersion: 1,
  generatedFrom: SRC,
  candidateOnly: true,
  note: 'Ready (zero-blocker, non-duplicate) local-authority source/download records. Rights confirmed clear 2026-07-07. data.gov.ie=CC BY 4.0, Open Data NI=OGL v3.0.',
  counts: { total: sources.length, skipped },
  sources,
};
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`emitted ${sources.length} LA source records (${skipped} skipped) -> ${out}`);
