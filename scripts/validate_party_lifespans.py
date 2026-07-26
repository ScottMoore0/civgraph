#!/usr/bin/env python3
"""Check the explicit party lifespans against the election results.

data/elections/parties/party_lifespans.json asserts when each party was founded and,
where applicable, dissolved. Those are facts about the organisations, supplied with a
source. This script does the one thing that makes them worth having: it confronts them
with the contest record and reports where the two disagree.

Three checks:

  1. CONTRADICTION -- a candidacy dated before the party was founded, or after it was
     dissolved. Either the lifespan is wrong, or the party string is being used for
     something that is not that organisation. Both are worth knowing; neither can be
     detected without the explicit dates.

  2. GAP -- the interval between founding and first recorded contest. A large gap is
     usually mundane (the party was founded between elections) but a very large one
     suggests the string is being matched too broadly, or that early contests are
     missing from the data.

  3. UNRECORDED -- party strings with many candidacies and no lifespan entry, ranked
     so the next entries to write are obvious.

Note what this deliberately does NOT do: it never infers a lifespan from the contest
record. `firstYear`/`lastYear` in data/browse/details/parties/ already do that, and the
whole point of the explicit file is that a party which stopped contesting has not
thereby been dissolved.

Usage:  python scripts/validate_party_lifespans.py
        python scripts/validate_party_lifespans.py --wanted 40
"""
import os, sys, csv, json, glob, argparse, collections, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
LIFE = os.path.join(REPO, 'data', 'elections', 'parties', 'party_lifespans.json')
OUT = os.path.dirname(LIFE)

VALID_STATUS = {'active', 'dissolved', 'unknown'}
VALID_PREC = {'day', 'month', 'year'}
# Strings that are not organisations and so cannot have a lifespan: 'Yes'/'No' are
# referendum options, 'Independent*' describes a candidate, and Unity / Anti H-Block are
# non-party banners. Listing them as "wanted" would be asking for a founding date for
# something that was never founded.
NON_PARTY = {'Yes', 'No', 'Unity', 'Unity (Northern Ireland)', 'Anti H-Block', 'Other',
             'Non-party', 'Independent'}


def is_party(s):
    return bool(s) and s not in NON_PARTY and not s.lower().startswith('independent')


def load():
    with open(LIFE, encoding='utf-8') as fh:
        spec = json.load(fh)
    parties, index, problems = spec['parties'], {}, []
    for p in parties:
        st, dis = p.get('status'), p.get('dissolved')
        if st not in VALID_STATUS:
            problems.append(f"{p['id']}: status {st!r} not in {sorted(VALID_STATUS)}")
        if p.get('foundedPrecision') not in VALID_PREC:
            problems.append(f"{p['id']}: foundedPrecision "
                            f"{p.get('foundedPrecision')!r} invalid")
        if st == 'dissolved' and not dis:
            problems.append(f"{p['id']}: status 'dissolved' but no dissolved date")
        if st == 'active' and dis:
            problems.append(f"{p['id']}: status 'active' but dissolved={dis}")
        if dis and p.get('founded') and dis < p['founded']:
            problems.append(f"{p['id']}: dissolved {dis} precedes founded {p['founded']}")
        if not p.get('source'):
            problems.append(f"{p['id']}: no source")
        for s in list(p.get('partyStrings') or []) + list(p.get('corruptedStrings') or []):
            if s in index:
                problems.append(f"party string {s!r} claimed by both "
                                f"{index[s]['id']} and {p['id']}")
            index[s] = p
    return parties, index, problems


def scan(index):
    """Per party string: candidacy count, first and last contest, and any out-of-window."""
    seen = collections.Counter()
    first, last = {}, {}
    breaches = []
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        with open(f, encoding='utf-8') as fh:
            doc = json.load(fh)
        date = str(doc.get('date') or '')
        for r in doc.get('results') or []:
            for c in (r.get('candidates') or []):
                s = (c.get('party') or '').strip()
                seen[s] += 1
                if s not in index:
                    continue
                if s not in first or date < first[s][0]:
                    first[s] = (date, doc.get('key', ''), r.get('constituency', ''))
                if s not in last or date > last[s][0]:
                    last[s] = (date, doc.get('key', ''), r.get('constituency', ''))
                p = index[s]
                why = None
                if p.get('founded') and date < p['founded']:
                    why = f"before founding {p['founded']}"
                elif p.get('dissolved') and date > p['dissolved']:
                    why = f"after dissolution {p['dissolved']}"
                if why:
                    breaches.append({
                        'party_id': p['id'], 'party_string': s, 'date': date,
                        'election_key': doc.get('key', ''),
                        'constituency': r.get('constituency', ''),
                        'candidate': (c.get('name') or '').strip(), 'reason': why})
    return seen, first, last, breaches


def days(a, b):
    fmt = '%Y-%m-%d'
    return (datetime.datetime.strptime(b, fmt) - datetime.datetime.strptime(a, fmt)).days


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wanted', type=int, default=25,
                    help='how many unrecorded party strings to list')
    args = ap.parse_args()

    parties, index, problems = load()
    print("=" * 78)
    print(f"party lifespans — {len(parties)} parties, {len(index)} party strings mapped")
    if problems:
        print("\n  SCHEMA PROBLEMS:")
        for p in problems:
            print(f"    {p}")
    else:
        print("  schema: OK (status/precision consistent, no duplicate strings, all sourced)")

    seen, first, last, breaches = scan(index)

    print(f"\n  {'party':10} {'founded':12} {'status':9} {'dissolved':11} "
          f"{'cands':>6}  {'first contest':13} {'last contest':13} gap")
    for p in sorted(parties, key=lambda x: x['founded']):
        ss = list(p.get('partyStrings') or []) + list(p.get('corruptedStrings') or [])
        n = sum(seen.get(s, 0) for s in ss)
        fs = [first[s][0] for s in ss if s in first]
        ls = [last[s][0] for s in ss if s in last]
        f0, l0 = (min(fs) if fs else '—'), (max(ls) if ls else '—')
        gap = ''
        if fs and p.get('founded'):
            d = days(p['founded'], f0)
            gap = f"{d//365}y {(d%365)//30}m"
        print(f"  {p['shortName'][:10]:10} {p['founded']:12} {p['status']:9} "
              f"{str(p.get('dissolved') or '—'):11} {n:6,}  {f0:13} {l0:13} {gap}")

    print(f"\n  CONTRADICTIONS: {len(breaches)}")
    if breaches:
        for b in breaches[:20]:
            print(f"    {b['date']}  {b['party_string']:12} {b['candidate'][:24]:24} "
                  f"{b['constituency'][:22]:22} {b['reason']}")
        with open(os.path.join(OUT, 'lifespan_contradictions.csv'), 'w',
                  encoding='utf-8', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=list(breaches[0].keys()))
            w.writeheader()
            w.writerows(breaches)
        print(f"    wrote lifespan_contradictions.csv")
    else:
        print("    no candidacy falls outside the declared window of its party")

    unrecorded = [(s, n) for s, n in seen.most_common()
                  if is_party(s) and s not in index]
    excluded = sum(n for s, n in seen.items() if not is_party(s))
    with open(os.path.join(OUT, 'lifespan_wanted.csv'), 'w', encoding='utf-8',
              newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['party', 'candidacies'])
        w.writerows(unrecorded)
    covered = sum(n for s, n in seen.items() if s in index)
    tot = sum(seen.values())
    party_tot = sum(n for s, n in seen.items() if is_party(s))
    print(f"\n  COVERAGE: {covered:,}/{party_tot:,} party candidacies "
          f"({100*covered/party_tot:.1f}%) have a recorded lifespan")
    print(f"    ({excluded:,} of the {tot:,} total are not party candidacies at all — "
          f"independents, referendum Yes/No, non-party banners)")
    print(f"  {len(unrecorded)} party strings have none — the largest:")
    for s, n in unrecorded[:args.wanted]:
        print(f"    {n:6,}  {s}")
    print(f"  wrote lifespan_wanted.csv ({len(unrecorded)} rows)")


if __name__ == '__main__':
    main()
