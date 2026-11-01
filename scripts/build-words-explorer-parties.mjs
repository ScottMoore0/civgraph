#!/usr/bin/env node
/**
 * Party labels for the Words in parliament explorer (apps/words/).
 *
 * The parliament word counts carry party labels exactly as each source writes them:
 * "Democratic Unionist Party" from the Assembly and the Members API, "DUP" from Civgraph's
 * election record, "Sinn Féin" from the Oireachtas. Shown raw, one party would split into
 * two lines on the chart. This folds every label to Civgraph's party record the same way
 * Browse does (data/browse/party-names.json, folded keys -> slug) and takes the record's
 * display name from data/browse/parties.json, so the explorer can merge and link parties
 * without loading the 450 KB party index at runtime. Line colours are the page's own
 * validated categorical palette, not party colours: several parties in one chamber share
 * a green or a grey, and the chart has to tell them apart.
 *
 * Labels with no party record (a role such as "Ceann Comhairle", "No party recorded",
 * or a party Browse does not hold) are kept with their own name and no link.
 *
 * Input is the counts' meta.json (its `parties` list), from the static shard folder the
 * explorer reads on R2. Output: apps/words/parties.json, { label: [slug, name] }.
 *
 *   node scripts/build-words-explorer-parties.mjs --meta <counts/static/meta.json>
 *   node scripts/build-words-explorer-parties.mjs --meta <...> --check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const META = opt('--meta') || process.env.WORDS_META;
const CHECK = args.includes('--check');
const OUT = 'apps/words/parties.json';

if (!META || !existsSync(META)) {
  console.error('Usage: node scripts/build-words-explorer-parties.mjs --meta <counts/static/meta.json> [--check]');
  process.exit(2);
}
for (const f of ['data/browse/party-names.json', 'data/browse/parties.json']) {
  if (!existsSync(f)) { console.error(`Missing ${f}: build the Browse indexes first.`); process.exit(2); }
}

// Folded exactly as browse.js partyLinkHtml and build-browse-indexes normalizeName fold.
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const meta = JSON.parse(readFileSync(META, 'utf8'));
const names = JSON.parse(readFileSync('data/browse/party-names.json', 'utf8')).items || {};
const bySlug = new Map(JSON.parse(readFileSync('data/browse/parties.json', 'utf8')).items.map((p) => [p.slug, p]));

// Labels that are not parties: shown as a neutral group, never linked.
const NO_PARTY = new Set(['(none)', 'No party recorded']);
// Where the Browse fold picks the wrong record for this corpus. "Labour Party" is the
// Oireachtas's label for the Irish Labour Party (Dáil and Seanad only), but folds to an
// unlinked "labour-party" record; "Labour" occurs only for Lords members (the UK party),
// but folds to Irish Labour. Measured against meta.json totals on 2026-11-01.
const OVERRIDES = { 'Labour Party': 'irish-labour', Labour: null };
const UNLINKED_NAMES = { Labour: 'Labour (UK)' };

const out = {};
let linked = 0;
for (const label of meta.parties) {
  if (NO_PARTY.has(label)) { out[label] = ['', 'No party recorded']; continue; }
  const slug = label in OVERRIDES ? OVERRIDES[label] : names[fold(label)];
  const rec = slug ? bySlug.get(slug) : null;
  if (rec) {
    out[label] = [rec.slug, rec.title || label];
    linked += 1;
  } else {
    out[label] = ['', UNLINKED_NAMES[label] || label];
  }
}

const body = `${JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"')}\n`;
if (CHECK) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== body) { console.error(`FAIL: ${OUT} is out of date; re-run without --check.`); process.exit(1); }
  console.log(`PASS: ${OUT} current (${meta.parties.length} labels).`);
} else {
  writeFileSync(OUT, body);
  console.log(`${OUT}: ${meta.parties.length} labels, ${linked} linked to a party record.`);
}
