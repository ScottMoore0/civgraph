#!/usr/bin/env python3
"""v9 phase 19 (stage 4) — PR-STV count simulator + seat projection.

Implements the count directly (Gregory surplus method, as the source data's
`votingSystem: "stv-gregory"` specifies). Written from the published STV rules
rather than copied from any other project, and driven entirely by the repo's own
data: first preferences and seat counts from test/metadata/elections-test2, and
the transfer matrix estimated in 18_transfer_model.py from the same files.

Count rules implemented
-----------------------
  quota            floor(valid / (seats + 1)) + 1
  election         any continuing candidate at or above quota is elected
  surplus          distributed at transfer value = surplus / transferable votes,
                   destinations from the transfer model, restricted to parties
                   with a continuing candidate and renormalised
  within-party     a party's share is split across its continuing candidates in
                   proportion to their current votes
  non-transferable the source party's observed non-transferable rate is withheld
  elimination      when nobody is over quota, the lowest continuing candidate is
                   eliminated and all their votes transferred
  early finish     if continuing candidates == remaining seats, all are elected

Validation is a REPLAY: feed each real contest its true first preferences and
compare the simulated elected set with what actually happened. That isolates the
count engine + transfer model from any error in predicting first preferences.

Output: stv_replay_report.csv, and a seat-projection helper `project_seats()`
        that takes predicted party shares and returns seats.
"""
import os, json, math, collections
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

CONTESTS = [
    ('assembly', 2016, 'northern-ireland-assembly__2016-05-05.json'),
    ('assembly', 2017, 'northern-ireland-assembly__2017-03-02.json'),
    ('assembly', 2022, 'northern-ireland-assembly__2022-05-05.json'),
    ('local', 2014, 'local-government-local-government-districts__2014-05-22.json'),
    ('local', 2019, 'local-government-local-government-districts__2019-05-02.json'),
    ('local', 2023, 'local-government-local-government-districts__2023-05-18.json'),
]

# within-party transfer split exponent; 1.0 = proportional to current votes.
# Fitted from the count data in phase 43 and set by callers.
SPLIT_ALPHA = 1.0

TM = json.load(open(os.path.join(HERE, 'transfer_matrix.json'), encoding='utf-8'))
MATRIX, NONTRANS = TM['matrix'], TM['nontransferable']
BLOCM = TM['bloc_matrix']
NAT = {'Sinn Féin', 'SDLP', 'Aontú', 'Independent Nationalist', "Workers' Party", 'IRSP'}
UNI = {'DUP', 'UUP', 'TUV', 'PUP', 'Independent Unionist', 'UKIP', 'Conservative'}


def bloc(p):
    return 'NAT' if p in NAT else ('UNI' if p in UNI else 'OTH')


def dest_weights(src_party, avail_parties):
    """P(dest party | source party), restricted to available parties, renormalised.

    Falls back to the bloc matrix for source parties never observed donating, and
    to a flat split if even that is empty -- an unseen party still has to transfer
    somewhere, and silently dropping the votes would inflate non-transferables.
    """
    row = MATRIX.get(src_party)
    if not row:
        b = BLOCM.get(bloc(src_party), {})
        row = {}
        for p in avail_parties:
            row[p] = b.get(bloc(p), 0.0)
    w = {p: row.get(p, 0.0) for p in avail_parties}
    tot = sum(w.values())
    if tot <= 0:
        return {p: 1.0 / len(avail_parties) for p in avail_parties} if avail_parties else {}
    return {p: v / tot for p, v in w.items()}


def run_stv(names, parties, first_prefs, seats, valid=None):
    """Return the list of elected candidate indices, in order of election."""
    n = len(names)
    votes = np.asarray(first_prefs, dtype=float).copy()
    valid = float(valid if valid is not None else votes.sum())
    quota = math.floor(valid / (seats + 1)) + 1
    status = ['continuing'] * n
    elected, guard = [], 0

    def continuing():
        return [i for i in range(n) if status[i] == 'continuing']

    while len(elected) < seats and guard < 200:
        guard += 1
        cont = continuing()
        if not cont:
            break
        # early finish: exactly as many continuing as seats left
        if len(cont) <= seats - len(elected):
            for i in sorted(cont, key=lambda i: -votes[i]):
                status[i] = 'elected'
                elected.append(i)
            break
        over = [i for i in cont if votes[i] >= quota]
        if over:
            i = max(over, key=lambda i: votes[i])
            status[i] = 'elected'
            elected.append(i)
            surplus = votes[i] - quota
            votes[i] = quota
            if surplus <= 0 or len(elected) >= seats:
                continue
            src = i
        else:
            i = min(cont, key=lambda i: votes[i])
            status[i] = 'excluded'
            surplus = votes[i]
            votes[i] = 0.0
            if surplus <= 0:
                continue
            src = i

        rec = [j for j in continuing()]
        if not rec:
            continue
        sp = parties[src]
        transferable = surplus * (1.0 - float(NONTRANS.get(sp, 0.15)))
        avail = sorted({parties[j] for j in rec})
        w = dest_weights(sp, avail)
        for p, frac in w.items():
            members = [j for j in rec if parties[j] == p]
            if not members or frac <= 0:
                continue
            pot = transferable * frac
            # Within-party split across continuing candidates. SPLIT_ALPHA=1 is the
            # proportional-to-current-votes assumption; phase 43 fits it from the
            # observed count data instead of assuming it.
            base = np.array([max(votes[j], 1e-9) for j in members], dtype=float)
            base = base ** SPLIT_ALPHA
            base = base / base.sum()
            for j, b in zip(members, base):
                votes[j] += pot * b
    return elected, quota, votes


def load_contest(contest, year, fname):
    d = json.load(open(os.path.join(META, fname), encoding='utf-8'))
    out = []
    for r in d['results']:
        cands = r.get('candidates') or []
        if not cands:
            continue
        names = [c.get('name') for c in cands]
        parties = [(c.get('party') or '').strip() for c in cands]
        fp = [float(c.get('firstPrefs') or 0) for c in cands]
        if sum(fp) <= 0:
            continue
        seats = int(r.get('seatsTotal') or 1)
        actual = {i for i, c in enumerate(cands) if c.get('elected')}
        if len(actual) != seats:
            # uncontested / co-option cases -- skip rather than score against an
            # elected set that the count did not produce
            continue
        out.append({'area': r.get('constituency'), 'names': names, 'parties': parties,
                    'fp': fp, 'seats': seats, 'actual': actual,
                    'valid': float(r.get('validPoll') or sum(fp))})
    return out


def project_seats(names, parties, shares_pct, seats, valid_poll):
    """Seat projection from PREDICTED party shares.

    shares_pct maps party -> predicted share. Votes are split across that party's
    candidates evenly, which is the assumption the model cannot avoid: how a party
    spreads its vote across candidates is a nomination/vote-management decision,
    not a demographic quantity. Supply candidate-level first_prefs directly to
    run_stv() when a better assumption is available.
    """
    per = collections.Counter(parties)
    fp = [valid_poll * shares_pct.get(p, 0.0) / 100.0 / per[p] for p in parties]
    return run_stv(names, parties, fp, seats, valid_poll)


def main():
    rows = []
    for contest, year, fname in CONTESTS:
        for c in load_contest(contest, year, fname):
            el, quota, _ = run_stv(c['names'], c['parties'], c['fp'], c['seats'],
                                   c['valid'])
            pred = set(el)
            correct = len(pred & c['actual'])
            ap = collections.Counter(c['parties'][i] for i in c['actual'])
            pp = collections.Counter(c['parties'][i] for i in pred)
            seat_err = sum((ap - pp).values()) + sum((pp - ap).values())
            rows.append({'contest': contest, 'year': year, 'area': c['area'],
                         'seats': c['seats'], 'correct': correct,
                         'party_seat_err': seat_err,
                         'exact': int(pred == c['actual']),
                         'party_exact': int(ap == pp)})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, 'stv_replay_report.csv'), index=False)

    print("STV replay — true first preferences in, simulated count out")
    print(f"  contests replayed: {len(df)} area-contests, {int(df.seats.sum())} seats\n")
    print(f"  {'contest':16} {'areas':>6} {'seat acc':>9} {'party-exact':>12} {'cand-exact':>11}")
    for (co, yr), g in df.groupby(['contest', 'year']):
        acc = g.correct.sum() / g.seats.sum()
        print(f"  {co+str(yr):16} {len(g):6} {100*acc:8.1f}% "
              f"{100*g.party_exact.mean():11.1f}% {100*g.exact.mean():10.1f}%")
    acc = df.correct.sum() / df.seats.sum()
    print(f"\n  OVERALL          {len(df):6} {100*acc:8.1f}% "
          f"{100*df.party_exact.mean():11.1f}% {100*df.exact.mean():10.1f}%")
    print(f"  mean party-seat error per area: {df.party_seat_err.mean():.2f} seats")

    # NI-wide seat totals per party, actual vs simulated
    print("\n  NI-wide seat totals (assembly 2022):")
    d = json.load(open(os.path.join(META, 'northern-ireland-assembly__2022-05-05.json'),
                       encoding='utf-8'))
    act, sim = collections.Counter(), collections.Counter()
    for c in load_contest('assembly', 2022, 'northern-ireland-assembly__2022-05-05.json'):
        el, _, _ = run_stv(c['names'], c['parties'], c['fp'], c['seats'], c['valid'])
        for i in c['actual']:
            act[c['parties'][i]] += 1
        for i in el:
            sim[c['parties'][i]] += 1
    print(f"    {'party':14} {'actual':>7} {'sim':>5} {'diff':>5}")
    for p in sorted(set(act) | set(sim), key=lambda p: -act[p]):
        print(f"    {p:14} {act[p]:7} {sim[p]:5} {sim[p]-act[p]:+5}")
    print(f"    total abs seat error: {sum(abs(sim[p]-act[p]) for p in set(act)|set(sim))}")


if __name__ == '__main__':
    main()
