#!/usr/bin/env python3
"""Attach `alignment_label` and `endorsed_by` to every candidacy in the test2 metadata.

Both are arrays of zero or more strings, written explicitly (an empty array, never a
missing key) so "nothing recorded" is distinguishable from "not yet applied".

    "party": "Aontú",
    "alignment_label": ["nationalist", "pro-unity", "republican"],
    "endorsed_by": []

THE TWO FIELDS ARE EPISTEMOLOGICALLY DIFFERENT, which is why they are populated by
different mechanisms and why they are not merged into one table.

`alignment_label` is DERIVED. It is a function of (party string, body, date) via
alignment_rules.json: reproducible, exhaustively applicable, auditable. Re-running
regenerates it identically, and a disagreement about it is a disagreement about a rule,
not about a fact.

`endorsed_by` is an EXTERNAL CLAIM. No election result records who endorsed whom, so it
cannot be derived from this data at any level of effort. Every entry is a per-candidacy
assertion in endorsements.csv carrying its own source and confidence, and the field
defaults to empty. An empty array means "no endorsement recorded", NOT "no endorsement
existed" -- absence of evidence only.

WHAT COUNTS AS AN ENDORSEMENT, because the edge cases matter more than the core:

  * The candidate's OWN party is never listed. That is what `party` is for; `endorsed_by`
    records backing by organisations other than the candidate's own.
  * A STAND-ASIDE IS NOT AN ENDORSEMENT. A party declining to contest a seat and a party
    actively backing someone are different facts, and conflating them would manufacture
    endorsements wholesale. The UUP did not stand against Sylvia Hermon in North Down in
    2015; it did not thereby endorse her. Stand-asides ARE derivable from the results and
    are emitted to endorsement_leads.csv as triage material -- never into the field.
  * A joint ticket is not an endorsement, it is a party. 'UCUNF' (UUP plus Conservative,
    2010) already exists as its own party string.
  * Endorsement attaches to a CANDIDACY, not a person. Hermon 2010 and Hermon 2017 are
    separate rows and may differ.

Usage:
    python scripts/apply_candidate_attributes.py            # apply
    python scripts/apply_candidate_attributes.py --check    # report only, write nothing
    python scripts/apply_candidate_attributes.py --leads    # refresh leads only
"""
import os, sys, csv, json, glob, argparse, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
ALIGN = os.path.join(REPO, 'data', 'elections', 'alignment')
RULES = os.path.join(ALIGN, 'alignment_rules.json')
OVERRIDES = os.path.join(ALIGN, 'alignment_overrides.csv')
ENDORSE = os.path.join(ALIGN, 'endorsements.csv')

F_ALIGN = 'alignment_label'
F_ENDORSE = 'endorsed_by'

NI_BODIES = {'house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly',
             'local-government', 'european-parliament', 'parliament-of-northern-ireland',
             'northern-ireland-constitutional-convention',
             'northern-ireland-forum-for-political-dialogue'}
# A party counts as "generally contesting" an election if it stands in at least this
# share of that election's areas. Below it, absence is ordinary rather than notable --
# without the threshold every small party's every non-candidacy becomes a false lead.
CONTEST_RATE = 0.6
# strings that describe a candidate rather than name an organisation
NON_PARTY = {'Unity', 'Unity (Northern Ireland)', 'Anti H-Block', 'Other', ''}


def load_rules():
    with open(RULES, encoding='utf-8') as fh:
        spec = json.load(fh)
    return spec, [{
        'id': r['id'], 'labels': list(r['labels']), 'strings': set(r['partyStrings']),
        'bodies': set(r['bodies']) if r.get('bodies') else None,
        'from': r.get('from'), 'until': r.get('until'),
    } for r in spec['rules']]


def load_csv_map(path, column):
    """key -> list of strings, from a pipe-separated column."""
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, encoding='utf-8-sig', newline='') as fh:
        for row in csv.DictReader(fh):
            ek = (row.get('election_key') or '').strip()
            con = (row.get('constituency') or '').strip()
            if not ek or not con:
                continue
            raw = (row.get(column) or '').strip()
            out[f"{ek}|{con}|{(row.get('candidate_id') or '').strip()}"] = [
                s.strip() for s in raw.split('|') if s.strip()]
    return out


def match(rules, party, body, date):
    for r in rules:
        if party not in r['strings']:
            continue
        if r['bodies'] is not None and body not in r['bodies']:
            continue
        if r['from'] and date < r['from']:
            continue
        if r['until'] and date >= r['until']:
            continue
        return r
    return None


def write_leads(docs):
    """Constituencies where a generally-contesting party did not stand.

    This is EVIDENCE OF A STAND-ASIDE, derived from the results, and nothing more. It is
    the raw material for deciding whether an endorsement happened, not an endorsement,
    and it is never written to `endorsed_by`.
    """
    rows = []
    for doc in docs:
        body = doc.get('bodySlug') or ''
        if body not in NI_BODIES or doc.get('isByElection'):
            continue
        results = [r for r in (doc.get('results') or []) if (r.get('candidates') or [])]
        if len(results) < 4:
            continue
        stood = collections.Counter()
        present = {}
        for r in results:
            ps = {(c.get('party') or '').strip() for c in r['candidates']} - {''}
            present[str(r.get('constituency') or '')] = (ps, r)
            for p in ps:
                stood[p] += 1
        n = len(results)
        for con, (ps, r) in sorted(present.items()):
            for party, cnt in stood.items():
                if party in ps or cnt < n * CONTEST_RATE:
                    continue
                # "Independent" is a description, not an organisation: it cannot stand
                # aside or endorse, and its absence from a seat means nothing. Same for
                # the non-party banners. Without this the leads file is mostly noise.
                if party.lower().startswith('independent') or party in NON_PARTY:
                    continue
                rows.append({
                    'election_key': doc.get('key', ''), 'date': doc.get('date', ''),
                    'body': body, 'constituency': con, 'absent_party': party,
                    'absent_party_contested': f'{cnt}/{n}',
                    'winner': r.get('winnerParty') or r.get('leadingParty') or '',
                    'parties_present': ' | '.join(sorted(ps)),
                })
    rows.sort(key=lambda x: (x['date'], x['constituency'], x['absent_party']))
    cols = ['election_key', 'date', 'body', 'constituency', 'absent_party',
            'absent_party_contested', 'winner', 'parties_present']
    with open(os.path.join(ALIGN, 'endorsement_leads.csv'), 'w', encoding='utf-8',
              newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='report only; write nothing')
    ap.add_argument('--leads', action='store_true', help='regenerate leads only')
    args = ap.parse_args()

    spec, rules = load_rules()
    overrides = load_csv_map(OVERRIDES, 'alignment_label')
    endorsements = load_csv_map(ENDORSE, 'endorsed_by')
    bad = {l for r in rules for l in r['labels']} - set(spec['labelVocabulary'])
    if bad:
        sys.exit(f'rule uses labels outside labelVocabulary: {sorted(bad)}')

    files = sorted(glob.glob(os.path.join(META, '*.json')))
    docs = []
    labelled = collections.Counter()
    unlabelled = collections.Counter()
    unlab_body = collections.defaultdict(collections.Counter)
    by_party = collections.Counter()
    party_labels = {}
    ov_hits = en_hits = changed = total = 0
    self_endorse = []

    for path in files:
        with open(path, encoding='utf-8') as fh:
            doc = json.load(fh)
        key = doc.get('key') or os.path.basename(path)[:-5]
        body = doc.get('bodySlug') or os.path.basename(path).split('__')[0]
        date = str(doc.get('date') or os.path.basename(path).split('__')[1][:10])
        dirty = False

        def resolve(cand, con):
            nonlocal ov_hits, en_hits
            party = (cand.get('party') or '').strip()
            ok = f"{key}|{con}|{str(cand.get('id') or '').strip()}"
            if ok in overrides:
                ov_hits += 1
                labels, src = list(overrides[ok]), 'override'
            else:
                r = match(rules, party, body, date)
                labels, src = (list(r['labels']), r['id']) if r else ([], None)
            end = list(endorsements.get(ok, []))
            if end:
                en_hits += 1
                if party and party in end:
                    self_endorse.append((ok, party))
            return labels, src, end

        def stamp(cand, con):
            nonlocal dirty
            labels, src, end = resolve(cand, con)
            if cand.get(F_ALIGN) != labels:
                cand[F_ALIGN] = labels
                dirty = True
            if cand.get(F_ENDORSE) != end:
                cand[F_ENDORSE] = end
                dirty = True
            return labels, src

        for res in doc.get('results') or []:
            con = str(res.get('constituency') or '').strip()
            for cand in (res.get('candidates') or []):
                total += 1
                labels, src = stamp(cand, con)
                party = (cand.get('party') or '').strip()
                by_party[party] += 1
                if src:
                    labelled[src] += 1
                    party_labels.setdefault(party, set()).add(tuple(labels))
                else:
                    unlabelled[party] += 1
                    unlab_body[party][body] += 1

        for cand in (doc.get('mainLikeCandidateSummary') or []):
            stamp(cand, str(cand.get('constituency') or '').strip())

        docs.append(doc)
        if dirty:
            changed += 1
            if not (args.check or args.leads):
                with open(path, 'w', encoding='utf-8', newline='\n') as fh:
                    json.dump(doc, fh, ensure_ascii=False, indent=2)
                    fh.write('\n')

    if self_endorse:
        print(f"  WARNING: {len(self_endorse)} endorsement rows name the candidate's own "
              f"party as an endorser; `party` already records that. e.g. {self_endorse[0]}")

    print("=" * 78)
    print(f"candidate attributes — {total:,} candidacies across {len(files)} files")
    print(f"\n  {F_ALIGN}  (derived from alignment_rules.json)")
    for r in rules:
        print(f"    {labelled.get(r['id'], 0):7,}  {r['id']:26} -> {r['labels']}")
    print(f"    {ov_hits:7,}  {'override':26} -> (alignment_overrides.csv)")
    tot = sum(labelled.values()) + ov_hits
    print(f"    labelled {tot:,}/{total:,} ({100*tot/total:.1f}%); "
          f"unlabelled spans {len(unlabelled)} party strings")

    print(f"\n  {F_ENDORSE}  (external claims, from endorsements.csv)")
    print(f"    {en_hits:7,}  populated   ({len(endorsements)} rows in the file)")
    print(f"    {total-en_hits:7,}  empty — no endorsement recorded")
    print(f"\n  files {'that would change' if (args.check or args.leads) else 'written'}:"
          f" {changed}")

    if args.check:
        print("\n  --check: nothing written")
        return

    leads = write_leads(docs)
    print(f"\n  wrote endorsement_leads.csv — {len(leads)} stand-asides across "
          f"{len({r['election_key'] for r in leads})} contests")
    print("    (evidence a party did not stand; NOT endorsements — see module docstring)")
    per = collections.Counter(f"{r['date'][:4]} {r['body'][:22]:22} {r['absent_party']}"
                              for r in leads)
    for k, v in per.most_common(6):
        print(f"      {v:3}  {k}")
    if args.leads:
        return

    with open(os.path.join(ALIGN, 'alignment_review.csv'), 'w', encoding='utf-8',
              newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['party', 'candidacies', 'bodies', 'suggested_action'])
        roi = {'independent ireland', 'independent alliance', 'independents 4 change',
               'independent labour', 'independent health alliance',
               'south kerry independent alliance'}
        for party, n in unlabelled.most_common():
            low, hint = party.lower(), ''
            if low in roi:
                hint = 'registered party in the Republic, not an unaffiliated candidate'
            elif low.startswith('independent'):
                hint = 'independent — set per candidacy in alignment_overrides.csv'
            elif 'unionist' in low or 'loy' in low:
                hint = 'unionist-adjacent — not in the supplied list; confirm before labelling'
            elif 'sinn f' in low or 'republican' in low:
                hint = 'republican-adjacent but a distinct party from Sinn Féin'
            elif 'nationalist' in low:
                hint = 'nationalist-adjacent; check body and era'
            elif 'pbp' in low:
                hint = 'PBP-adjacent; separate registration from PBP'
            w.writerow([party, n,
                        ','.join(f'{b}:{c}' for b, c in unlab_body[party].most_common()),
                        hint])

    with open(os.path.join(ALIGN, 'alignment_coverage.csv'), 'w', encoding='utf-8',
              newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['party', 'candidacies', 'distinct_label_tuples', 'labels'])
        for party in sorted(party_labels):
            tups = sorted(party_labels[party])
            w.writerow([party, by_party[party], len(tups),
                        ' ; '.join('|'.join(t) if t else '(none)' for t in tups)])
    print("  wrote alignment_review.csv, alignment_coverage.csv")


if __name__ == '__main__':
    main()
