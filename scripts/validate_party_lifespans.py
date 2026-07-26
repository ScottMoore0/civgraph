#!/usr/bin/env python3
"""Check the explicit party lifespans against the election results.

data/elections/parties/party_lifespans.json asserts when each party was founded and,
where applicable, dissolved. Those are facts about the organisations, supplied with a
source. This script does the one thing that makes them worth having: it confronts them
with the contest record and reports where the two disagree.

RESOLUTION. A candidacy is matched to a party by its `party` string, optionally narrowed
by `bodySlug`, and then by date. Membership is the HALF-OPEN interval [founded,
dissolved) — a candidacy dated exactly on a dissolution date belongs to the successor,
so a same-day handover has neither a gap nor an overlap. A string may legitimately be
claimed by two parties when their windows are disjoint; that is how succession is
modelled, and it is why `Green / Ecology` (a label the local-government dataset uses
across 1981-2011, spanning both organisations) can be attributed correctly.

Checks:

  1. CONTRADICTION -- the string is claimed for this body, but no party's window covers
     the date. Either a lifespan is wrong, or the string is being used for something
     that is not that organisation, or the label outlived/preceded the party.
  2. AMBIGUITY -- more than one party's window covers the same candidacy. A registry
     bug, not a data finding.
  3. GAP -- founding to first recorded contest.
  4. UNRECORDED -- party strings with candidacies and no entry, ranked by volume.

It never INFERS a lifespan from the contest record. firstYear/lastYear in
data/browse/details/parties/ already do that, and the point of the explicit file is that
a party which stopped contesting has not thereby been dissolved.

Usage:  python scripts/validate_party_lifespans.py [--wanted N]
"""
import os, sys, csv, json, glob, argparse, collections, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
LIFE = os.path.join(REPO, 'data', 'elections', 'parties', 'party_lifespans.json')
OUT = os.path.dirname(LIFE)

VALID_STATUS = {'active', 'dissolved', 'unknown'}
VALID_PREC = {'day', 'month', 'year'}
# Not organisations, so they cannot have a lifespan: Yes/No are referendum options,
# Independent* describes a candidate, Unity and Anti H-Block are non-party banners.
NON_PARTY = {'Yes', 'No', 'Unity', 'Unity (Northern Ireland)', 'Anti H-Block', 'Other',
             'Non-party', 'Independent'}


def is_party(s):
    return bool(s) and s not in NON_PARTY and not s.lower().startswith('independent')


def covers(p, date):
    if p.get('founded') and date < p['founded']:
        return False
    if p.get('dissolved') and date >= p['dissolved']:   # half-open
        return False
    return True


def overlap(a, b):
    """Do two parties' windows overlap at all?"""
    a_end = a.get('dissolved') or '9999-12-31'
    b_end = b.get('dissolved') or '9999-12-31'
    return a['founded'] < b_end and b['founded'] < a_end


def load():
    with open(LIFE, encoding='utf-8') as fh:
        spec = json.load(fh)
    parties = spec['parties']
    index = collections.defaultdict(list)   # string -> [(party, bodies|None)]
    problems = []
    by_id = {p['id']: p for p in parties}
    for p in parties:
        st, dis = p.get('status'), p.get('dissolved')
        if st not in VALID_STATUS:
            problems.append(f"{p['id']}: status {st!r} invalid")
        if p.get('foundedPrecision') not in VALID_PREC:
            problems.append(f"{p['id']}: foundedPrecision invalid")
        if st == 'dissolved' and not dis:
            problems.append(f"{p['id']}: status 'dissolved' but no dissolved date")
        if st == 'active' and dis:
            problems.append(f"{p['id']}: status 'active' but dissolved={dis}")
        if dis and dis < p['founded']:
            problems.append(f"{p['id']}: dissolved precedes founded")
        if not p.get('source'):
            problems.append(f"{p['id']}: no source")
        for rel in ('predecessor', 'successor', 'splitFrom', 'revivalOf'):
            if p.get(rel) and p[rel] not in by_id:
                problems.append(f"{p['id']}: {rel} {p[rel]!r} is not a known party id")
        entries = list(p.get('partyStrings') or []) + \
            [{'string': s, 'corrupted': True} for s in (p.get('corruptedStrings') or [])]
        for e in entries:
            s = e if isinstance(e, str) else e['string']
            bodies = None if isinstance(e, str) else (
                set(e['bodies']) if e.get('bodies') else None)
            for other, obodies in index[s]:
                shared = (bodies is None or obodies is None or bodies & obodies)
                if shared and overlap(other, p):
                    problems.append(
                        f"string {s!r} claimed by {other['id']} and {p['id']} with "
                        f"overlapping windows and bodies")
            index[s].append((p, bodies))
    # A SUCCESSION must hand over on the day: predecessor ends when successor begins.
    for p in parties:
        s = p.get('successor')
        if s and by_id[s].get('founded') != p.get('dissolved'):
            problems.append(f"{p['id']} -> successor {s}: dissolution "
                            f"{p.get('dissolved')} != successor founding "
                            f"{by_id[s].get('founded')} (gap or overlap in the handover)")
    # A SPLIT is different: the parent continues, so no date equality is implied. The
    # only thing that must hold is that the parent existed when the child broke away.
    for p in parties:
        par = p.get('splitFrom')
        if par and not covers(by_id[par], p['founded']):
            problems.append(f"{p['id']} splitFrom {par}: parent did not exist on "
                            f"{p['founded']} (parent window "
                            f"[{by_id[par]['founded']}..{by_id[par].get('dissolved') or '—'}))")
    # A REVIVAL requires a GAP: the earlier organisation must already have ended. If the
    # dates touch exactly it is a succession, and if they overlap it is neither.
    for p in parties:
        par = p.get('revivalOf')
        if not par:
            continue
        prev = by_id[par]
        if not prev.get('dissolved'):
            problems.append(f"{p['id']} revivalOf {par}: {par} has no dissolution date, "
                            f"so there is nothing to revive")
        elif prev['dissolved'] > p['founded']:
            problems.append(f"{p['id']} revivalOf {par}: {par} was still alive at "
                            f"{p['founded']} (dissolved {prev['dissolved']})")
    return parties, index, problems


def resolve(index, s, body, date):
    """-> ('ok', party) | ('breach', [parties]) | ('ambiguous', [parties]) | None."""
    cands = [p for p, bodies in index.get(s, []) if bodies is None or body in bodies]
    if not cands:
        return None
    inwin = [p for p in cands if covers(p, date)]
    if len(inwin) == 1:
        return ('ok', inwin[0])
    if len(inwin) > 1:
        return ('ambiguous', inwin)
    return ('breach', cands)


def scan(index):
    seen = collections.Counter()
    per_party = collections.Counter()
    first, last = {}, {}
    breaches, ambiguous = [], []
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        with open(f, encoding='utf-8') as fh:
            doc = json.load(fh)
        date = str(doc.get('date') or '')
        body = doc.get('bodySlug') or ''
        for r in doc.get('results') or []:
            for c in (r.get('candidates') or []):
                s = (c.get('party') or '').strip()
                seen[s] += 1
                got = resolve(index, s, body, date)
                if got is None:
                    continue
                kind, who = got
                rec = {'party_string': s, 'body': body, 'date': date,
                       'election_key': doc.get('key', ''),
                       'constituency': r.get('constituency', ''),
                       'candidate': (c.get('name') or '').strip()}
                if kind == 'ok':
                    per_party[who['id']] += 1
                    k = who['id']
                    if k not in first or date < first[k]:
                        first[k] = date
                    if k not in last or date > last[k]:
                        last[k] = date
                elif kind == 'breach':
                    w = '; '.join(f"{p['id']} [{p['founded']}..{p.get('dissolved') or '—'})"
                                  for p in who)
                    breaches.append({**rec, 'claimed_by': w,
                                     'reason': 'no party window covers this date'})
                else:
                    ambiguous.append({**rec,
                                      'parties': ','.join(p['id'] for p in who)})
    return seen, per_party, first, last, breaches, ambiguous


def days(a, b):
    f = '%Y-%m-%d'
    return (datetime.datetime.strptime(b, f) - datetime.datetime.strptime(a, f)).days


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wanted', type=int, default=25)
    args = ap.parse_args()

    parties, index, problems = load()
    print("=" * 82)
    print(f"party lifespans — {len(parties)} parties, {len(index)} distinct party strings")
    if problems:
        print("\n  REGISTRY PROBLEMS:")
        for p in problems:
            print(f"    {p}")
    else:
        print("  registry: OK — status/precision consistent, no conflicting string "
              "claims, successions line up, all sourced")

    seen, per_party, first, last, breaches, ambiguous = scan(index)

    print(f"\n  {'party':16} {'founded':12} {'status':9} {'dissolved':12} {'cands':>6}  "
          f"{'first':12} {'last':12} gap")
    for p in sorted(parties, key=lambda x: x['founded']):
        n = per_party.get(p['id'], 0)
        f0, l0 = first.get(p['id'], '—'), last.get(p['id'], '—')
        gap = ''
        if f0 != '—':
            d = days(p['founded'], f0)
            gap = f"{d//365}y {(d % 365)//30}m"
        print(f"  {p['shortName'][:16]:16} {p['founded']:12} {p['status']:9} "
              f"{str(p.get('dissolved') or '—'):12} {n:6,}  {f0:12} {l0:12} {gap}")

    print(f"\n  CONTRADICTIONS: {len(breaches)}")
    for b in breaches[:25]:
        print(f"    {b['date']}  {b['party_string']:16} {b['candidate'][:22]:22} "
              f"{b['constituency'][:20]:20} claimed by {b['claimed_by']}")
    if breaches:
        with open(os.path.join(OUT, 'lifespan_contradictions.csv'), 'w',
                  encoding='utf-8', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=list(breaches[0].keys()))
            w.writeheader()
            w.writerows(breaches)
        print("    wrote lifespan_contradictions.csv")
    if ambiguous:
        print(f"  AMBIGUOUS (registry bug): {len(ambiguous)}")
        for a in ambiguous[:5]:
            print(f"    {a['date']}  {a['party_string']}  -> {a['parties']}")

    unrecorded = [(s, n) for s, n in seen.most_common()
                  if is_party(s) and s not in index]
    with open(os.path.join(OUT, 'lifespan_wanted.csv'), 'w', encoding='utf-8',
              newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['party', 'candidacies'])
        w.writerows(unrecorded)
    matched = sum(per_party.values())
    party_tot = sum(n for s, n in seen.items() if is_party(s))
    tot = sum(seen.values())
    print(f"\n  COVERAGE: {matched:,}/{party_tot:,} party candidacies "
          f"({100*matched/party_tot:.1f}%) resolve to a party with a recorded lifespan")
    print(f"    ({tot-party_tot:,} of the {tot:,} total are not party candidacies — "
          f"independents, referendum Yes/No, non-party banners)")
    print(f"  {len(unrecorded)} party strings have no entry — the largest:")
    for s, n in unrecorded[:args.wanted]:
        print(f"    {n:6,}  {s}")
    print(f"  wrote lifespan_wanted.csv ({len(unrecorded)} rows)")


if __name__ == '__main__':
    main()
