#!/usr/bin/env python3
"""Total votes by party in Northern Ireland elections, 1970-2024.

Sums first-preference / FPTP votes across every NI contest in the window, and uses
data/elections/parties/party_lifespans.json to combine the strings that are the same
organisation -- 'UKUP' with 'UK Unionist Party', 'Ecology' with the pre-1990 half of
'Green / Ecology', and so on -- rather than reporting raw strings.

WHAT THIS NUMBER IS, AND IS NOT. It is a cumulative count of votes cast, over 54 years
and roughly 60 contests. It is not a measure of support, and comparing two parties'
totals is only fair if they contested the same elections. Three things drive it as much
as popularity does:

  * LONGEVITY. The UUP has been on ballots since 1921 and the TUV since 2009.
  * WHICH CONTESTS. Local elections have ~80-100 areas against Westminster's 12-18, so a
    party that fights local government hard accumulates votes faster.
  * STV vs FPTP. Under STV only first preferences are counted here, so a party that
    lives on transfers is understated relative to its actual influence.

Scope decisions, all of which change the answer:
  * NI bodies only. Dail, Irish European and Irish presidential contests are excluded.
  * Referendums excluded -- Yes/No are not parties.
  * The 1996 Forum's synthetic NI-wide row is dropped: it is the regional top-up list
    covering the SAME ballots as the 18 constituency rows, and including it double-counts
    that contest exactly (1,504,936 against a true 752,468).
  * By-elections included by default, with --no-byelections to drop them. Note the
    January 1986 file is titled a general election but is the 15 simultaneous
    resignations by-elections; it is treated as a by-election here.

Usage:  python scripts/party_vote_totals.py [--top N] [--no-byelections] [--since YEAR]
"""
import os, sys, csv, json, glob, argparse, collections, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
OUT = os.path.join(REPO, 'data', 'elections', 'parties')

NI_BODIES = {'house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly',
             'local-government', 'european-parliament', 'parliament-of-northern-ireland',
             'northern-ireland-constitutional-convention',
             'northern-ireland-forum-for-political-dialogue'}


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        'vpl', os.path.join(HERE, 'validate_party_lifespans.py'))
    m = importlib.util.module_from_spec(spec)
    sys.modules['vpl'] = m
    spec.loader.exec_module(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--top', type=int, default=30)
    ap.add_argument('--since', type=int, default=1970)
    ap.add_argument('--until', type=int, default=2024)
    ap.add_argument('--no-byelections', action='store_true')
    args = ap.parse_args()

    v = _load_validator()
    parties, index, problems = v.load()
    if problems:
        print("  WARNING: registry problems present:", problems[:3])
    canon = {p['id']: p for p in parties}

    votes = collections.Counter()
    outside = collections.Counter()
    cands = collections.Counter()
    contests = collections.defaultdict(set)
    years = collections.defaultdict(list)
    total = 0.0
    nfiles = 0
    dropped_synthetic = 0

    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        with open(f, encoding='utf-8') as fh:
            doc = json.load(fh)
        body = doc.get('bodySlug') or ''
        if body not in NI_BODIES:
            continue
        date = str(doc.get('date') or '')
        year = int(date[:4]) if date[:4].isdigit() else 0
        if not (args.since <= year <= args.until):
            continue
        byel = bool(doc.get('isByElection')) or (
            year == 1986 and body == 'house-of-commons-of-the-united-kingdom')
        if byel and args.no_byelections:
            continue
        nfiles += 1
        results = doc.get('results') or []
        # drop the Forum's synthetic NI-wide top-up row (same ballots, counted twice)
        if len(results) > 1:
            keep = [r for r in results if not r.get('syntheticRegion')
                    and str(r.get('constituency')).strip().lower() != 'northern ireland']
            dropped_synthetic += len(results) - len(keep)
            results = keep
        for r in results:
            for c in (r.get('candidates') or []):
                s = (c.get('party') or '').strip()
                fp = float(c.get('firstPrefs') or 0)
                if fp <= 0:
                    continue
                got = v.resolve(index, s, body, date)
                if got and got[0] == 'ok':
                    key = got[1]['shortName']
                elif got and got[0] == 'breach' and len(got[1]) == 1:
                    # The candidacy sits outside the party's recorded lifespan (the
                    # back-labelling problem: McCartney 'UKUP' in 1995, Samuel 'Green'
                    # in 1987/89). For a vote TOTAL the votes still belong to that
                    # organisation, so attribute them and count the exposure separately.
                    # Falling back to the raw string here would be worse than useless:
                    # it splits Green in two while silently merging UKUP, because the
                    # raw string happens to equal that party's shortName.
                    key = got[1][0]['shortName']
                    outside[key] += fp
                else:
                    key = s or '(blank)'
                votes[key] += fp
                cands[key] += 1
                contests[key].add(doc.get('key', ''))
                years[key].append(year)
                total += fp

    print("=" * 88)
    print(f"NI elections {args.since}-{args.until}: total votes by party")
    print(f"  {nfiles} contests"
          + ("  (by-elections excluded)" if args.no_byelections else "  (by-elections included)")
          + f", {total:,.0f} votes counted"
          + (f", {dropped_synthetic} synthetic row(s) dropped" if dropped_synthetic else ""))
    print(f"\n  {'#':>2} {'party':26} {'votes':>12} {'share':>7} {'cands':>6} "
          f"{'contests':>8}  {'span':11}")
    for i, (k, n) in enumerate(votes.most_common(args.top), 1):
        yy = years[k]
        print(f"  {i:2} {k[:26]:26} {n:12,.0f} {100*n/total:6.2f}% {cands[k]:6,} "
              f"{len(contests[k]):8}  {min(yy)}-{max(yy)}")

    rows = [{'rank': i, 'party': k, 'votes': int(n),
             'share_pct': round(100 * n / total, 4), 'candidacies': cands[k],
             'contests': len(contests[k]), 'first_year': min(years[k]),
             'last_year': max(years[k]),
             'votes_outside_recorded_lifespan': int(outside.get(k, 0))}
            for i, (k, n) in enumerate(votes.most_common(), 1)]
    out = os.path.join(OUT, 'party_vote_totals_ni.csv')
    with open(out, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\n  {len(rows)} parties/labels total; wrote party_vote_totals_ni.csv")

    top5 = sum(n for _, n in votes.most_common(5))
    print(f"  top 5 account for {100*top5/total:.1f}% of all votes cast")
    if outside:
        print(f"\n  votes attributed to a party OUTSIDE its recorded lifespan "
              f"({sum(outside.values()):,.0f} total) — the back-labelling cases:")
        for k, n in outside.most_common():
            print(f"    {k:16} {n:9,.0f}  ({100*n/votes[k]:.2f}% of that party's total)")


if __name__ == '__main__':
    main()
