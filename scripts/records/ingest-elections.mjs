/**
 * Elections into the records tables: the bundles (ELECTION_BUNDLE_DIR), the manifest and the
 * trend summaries the transforms wrote, normalised as scripts/build/build-elections-sqlite.mjs did
 * (its residual/txt/num rules), extended with ord, the label columns, slugs and source files.
 *
 * Lossless by construction. Each stored JSON keeps the document's own key order, and a value
 * that lives in another table is replaced in place by a marker string:
 *   r_elections.meta   results -> "$contests", mainLikeCandidateSummary/entityIndex -> "$aggregate"
 *   contests.meta      candidates -> "$candidacies", animationPayload -> "$animation",
 *                      countGroup -> "$animation.countGroup" when it equals the payload's rows
 *   candidacies.meta   the candidate verbatim
 * so functions/_api/_records.js can rebuild the bundle exactly (the compatibility route at
 * /render/metadata/elections-test2/<key>.json).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TableWriter, bool, int, num, transaction, txt, withPlaceholders } from './db.mjs';
import { PART_CHARS } from './schema.mjs';
import { slugify } from '../../functions/_lib/format.js';

export { slugify };

export function contestSlug(electionKey, name) {
  const slug = slugify(name);
  // The NI Forum's province-wide list is "regional-list" in Browse (_browse-page.js lookupElection).
  if (/^northern-ireland-forum/.test(electionKey) && slug === 'northern-ireland') return 'regional-list';
  return slug || 'contest';
}

export const ELECTION_MARKERS = { results: '$contests', mainLikeCandidateSummary: '$aggregate', entityIndex: '$aggregate' };
export const AGGREGATES = ['mainLikeCandidateSummary', 'entityIndex'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function ingestElections(db, { bundleDir, manifestFile, summaryDir }) {
  const files = readdirSync(bundleDir).filter((f) => f.endsWith('.json')).sort();
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const manifestEntries = manifest.elections || [];
  const ordByKey = new Map(manifestEntries.map((e, i) => [e.key, i]));
  const stats = { unstampedCandidacies: 0, countGroupVerbatim: 0, nonUniqueCandidateIds: 0 };

  const n = transaction(db, () => {
    const W = {
      elections: new TableWriter(db, 'r_elections'),
      aggregates: new TableWriter(db, 'election_aggregates'),
      contests: new TableWriter(db, 'contests'),
      candidacies: new TableWriter(db, 'candidacies'),
      counts: new TableWriter(db, 'r_counts'),
      animation: new TableWriter(db, 'contest_animation'),
      features: new TableWriter(db, 'contest_features'),
      manifest: new TableWriter(db, 'election_manifest'),
      summaries: new TableWriter(db, 'election_summaries'),
    };
    let extraOrd = manifestEntries.length;
    for (const file of files) {
      const text = readFileSync(path.join(bundleDir, file), 'utf8');
      const d = JSON.parse(text);
      const key = d.key;
      W.elections.add({
        key,
        slug: slugify(key),
        body_slug: d.bodySlug || '',
        body: txt(d.body),
        body_group: txt(d.bodyGroup),
        display_title: txt(d.displayTitle),
        contest_type: txt(d.contestType),
        kind: txt(d.kind),
        voting_system: txt(d.votingSystem),
        contest_status: txt(d.contestStatus),
        date: d.date || '',
        year: int(d.year),
        decade: Number.isFinite(Number(d.year)) && d.year !== null ? Math.floor(Number(d.year) / 10) * 10 : null,
        source_map_id: txt(d.sourceMapId),
        layer_id: txt(d.layerId),
        label_property: txt(d.labelProperty),
        candidate_rows_expected: bool(d.candidateRowsExpected),
        transfer_data_expected: bool(d.transferDataExpected),
        previous_key: txt(d.previousKey),
        placeholder: bool(d.placeholder),
        compact: /^\{\r?\n/.test(text) ? 0 : 1,
        ord: ordByKey.has(key) ? ordByKey.get(key) : extraOrd++,
        meta: JSON.stringify(withPlaceholders(d, ELECTION_MARKERS)),
      });
      for (const name of AGGREGATES) {
        if (!(name in d)) continue;
        const payload = JSON.stringify(d[name]);
        for (let part = 0, at = 0; at < payload.length || part === 0; part += 1, at += PART_CHARS) {
          W.aggregates.add({ election_key: key, name, part, payload: payload.slice(at, at + PART_CHARS) });
        }
      }

      (d.results || []).forEach((r, seq) => {
        const anim = r.animationPayload;
        const markers = { candidates: '$candidacies' };
        if ('animationPayload' in r && anim) markers.animationPayload = '$animation';
        if ('countGroup' in r && anim && same(r.countGroup, anim?.Constituency?.countGroup)) markers.countGroup = '$animation.countGroup';
        else if ('countGroup' in r) stats.countGroupVerbatim += 1;
        W.contests.add({
          election_key: key,
          seq,
          name: String(r.constituency ?? ''),
          slug: contestSlug(key, r.constituency),
          source_file: txt(r.sourceFile),
          seats_total: int(r.seatsTotal),
          electorate: int(r.electorate),
          quota: num(r.quota),
          turnout_pct: num(r.turnoutPct),
          winner_party: txt(r.winnerParty),
          winner_name: txt(r.winnerName),
          leading_party: txt(r.leadingParty),
          leading_name: txt(r.leadingName),
          leading_votes: num(r.leadingVotes),
          leading_pct: num(r.leadingPct),
          majority: num(r.majority),
          majority_pct: num(r.majorityPct),
          seats_won: int(r.seatsWon),
          meta: JSON.stringify(withPlaceholders(r, markers)),
        });
        if (anim) W.animation.add({ election_key: key, contest_seq: seq, payload: JSON.stringify(anim) });
        if (r.featureId != null || r.matched != null) {
          W.features.add({
            election_key: key, contest_seq: seq, layer_id: txt(d.layerId), feature_id: txt(r.featureId),
            feature_name: txt(r.featureName), match_name: txt(r.matchName), matched: bool(r.matched),
          });
        }

        const candidates = r.candidates || [];
        const ordById = new Map();
        const seen = new Set();
        candidates.forEach((cand, ord) => {
          const id = cand.id == null ? '' : String(cand.id);
          if (seen.has(id)) ordById.set(id, null); else { seen.add(id); ordById.set(id, ord); }
        });
        const printedById = new Map();
        for (const row of r.countGroup || []) {
          const id = String(row.Candidate_Id ?? '');
          if (id && !printedById.has(id)) printedById.set(id, row);
        }
        candidates.forEach((cand, ord) => {
          const id = cand.id == null ? '' : String(cand.id);
          const printed = ordById.get(id) === ord ? printedById.get(id) : null;
          if (cand.personId == null && cand.name) stats.unstampedCandidacies += 1;
          W.candidacies.add({
            election_key: key,
            contest_seq: seq,
            ord,
            candidate_id: txt(cand.id),
            person_id: txt(cand.personId),
            name: txt(cand.name),
            name_as_printed: txt(cand.nameAsPrinted ?? printed?.Name_As_Printed ?? null),
            party_as_printed: txt(cand.partyAsPrinted ?? printed?.Party_As_Printed ?? null),
            party_label: txt(cand.party),
            party_rule: int(cand.partyLabelRule),
            party_id: txt(cand.partyId ?? cand.party_id),
            ballot_description: txt(cand.ballotDescription),
            first_prefs: num(cand.firstPrefs),
            final_votes: num(cand.finalVotes),
            elected: bool(cand.elected),
            elected_at: int(cand.electedAt),
            excluded: bool(cand.excluded),
            excluded_at: int(cand.excludedAt),
            status: txt(cand.status),
            unopposed: bool(cand.unopposed),
            colour: txt(cand.colour),
            gender: txt(cand.gender),
            meta: JSON.stringify(cand),
          });
        });
        for (const [ord, row] of (r.countGroup || []).entries()) {
          const id = String(row.Candidate_Id ?? row.id ?? '');
          const candidacyOrd = ordById.has(id) ? ordById.get(id) : null;
          if (ordById.has(id) && candidacyOrd === null) stats.nonUniqueCandidateIds += 1;
          W.counts.add({
            election_key: key, contest_seq: seq, ord, row_id: int(row.id), candidacy_ord: candidacyOrd,
            candidate_id: txt(row.Candidate_Id ?? row.id), count_number: int(row.Count_Number),
            total_votes: num(row.Total_Votes), transfers: num(row.Transfers), status: txt(row.Status) || null,
          });
        }
      });
    }

    manifestEntries.forEach((entry, ord) => W.manifest.add({ key: entry.key, ord, entry: JSON.stringify(entry) }));
    // The manifest without its election list, for view=manifest.
    const { elections: _list, ...head } = manifest;
    stats.manifestHead = head;

    for (const entry of manifestEntries) {
      const url = String(entry.summaryUrl || '');
      if (!url) continue;
      const file = url.split('?')[0].split('/').pop() ?? '';
      let text;
      try { text = readFileSync(path.join(summaryDir, file), 'utf8'); } catch { continue; }
      W.summaries.add({ election_key: entry.key, file, summary: JSON.stringify(JSON.parse(text)) });
    }

    return Object.fromEntries(Object.entries(W).map(([k, writer]) => [k, writer.finish()]));
  });
  return { counts: n, stats };
}
