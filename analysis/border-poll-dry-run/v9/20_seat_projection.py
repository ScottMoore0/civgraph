#!/usr/bin/env python3
"""v9 phase 20 — END-TO-END: census -> party shares -> STV count -> seats.

Chains the pieces built in stages 1-4 and measures the error that actually
matters, with each link's contribution separated:

  A  replay          true first preferences -> count            (engine + transfers only)
  B  true shares     true PARTY shares, votes split evenly      (adds the nomination
                     across each party's real candidates         assumption)
  C  end-to-end      leave-one-council-out PREDICTED shares     (adds share-model error)

The B - A gap is the cost of not knowing how a party spreads its vote across its
candidates. The C - B gap is the cost of the demographic share model. Reporting
them separately is the point: they are fixed by completely different things.
"""
import os, sys, json, importlib.util, collections
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


stv = _load('stv19', '19_stv_simulator.py')
pm = _load('pm17', '17_party_model.py')

# STV contests the share model can also cover (assembly = constituency scale,
# local = DEA scale). Westminster is FPTP and excluded.
GROUPS = [('local', 'dea', [2014, 2019, 2023]),
          ('assembly', 'constituency', [2016, 2017, 2022])]


def predicted_shares(scale):
    """Leave-one-council-out predicted party shares, keyed (contest_year, area)."""
    S, stood, X, meta, feats = pm.build(scale)
    groups = meta.council.values
    P = pm.cv_share(S, stood, X, meta, groups)
    out = {}
    for i, (k, row) in enumerate(zip(meta.index, P)):
        cy, area = k.split('||')
        out[(cy, area)] = dict(zip(pm.PARTIES, row))
    return out


def main():
    rows = []
    for contest, scale, years in GROUPS:
        pred = predicted_shares(scale)
        for year in years:
            fn = [f for f in stv.CONTESTS if f[0] == contest and f[1] == year][0][2]
            for c in stv.load_contest(contest, year, fn):
                area = c['area']
                key = (f"{contest}{year}", area.upper() if scale != 'dea' else area)
                actual = collections.Counter(c['parties'][i] for i in c['actual'])

                # A — replay with true first preferences
                elA, _, _ = stv.run_stv(c['names'], c['parties'], c['fp'],
                                        c['seats'], c['valid'])
                simA = collections.Counter(c['parties'][i] for i in elA)

                # B — true party shares, evenly split across that party's candidates
                tot = sum(c['fp'])
                tshare = collections.defaultdict(float)
                for p, v in zip(c['parties'], c['fp']):
                    tshare[p] += 100.0 * v / tot
                elB, _, _ = stv.project_seats(c['names'], c['parties'], dict(tshare),
                                              c['seats'], c['valid'])
                simB = collections.Counter(c['parties'][i] for i in elB)

                # C — predicted shares
                ps = pred.get(key)
                simC = None
                if ps:
                    elC, _, _ = stv.project_seats(c['names'], c['parties'], ps,
                                                  c['seats'], c['valid'])
                    simC = collections.Counter(c['parties'][i] for i in elC)

                def err(sim):
                    if sim is None:
                        return np.nan
                    return sum((actual - sim).values()) + sum((sim - actual).values())

                rows.append({'contest': contest, 'year': year, 'area': area,
                             'seats': c['seats'], 'errA': err(simA), 'errB': err(simB),
                             'errC': err(simC), 'matched': ps is not None})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, 'seat_projection_report.csv'), index=False)

    m = df[df.matched]
    print("\n" + "=" * 74)
    print("END-TO-END SEAT PROJECTION — party-seat error per area (lower is better)")
    print(f"  areas scored: {len(m)}   seats: {int(m.seats.sum())}\n")
    print(f"  {'stage':44} {'mean err':>9} {'exact':>8}")
    for col, lab in [('errA', 'A  replay (true first prefs)'),
                     ('errB', 'B  + nomination assumption (true shares)'),
                     ('errC', 'C  + predicted shares (full end-to-end)')]:
        print(f"  {lab:44} {m[col].mean():9.2f} {100*(m[col]==0).mean():7.1f}%")
    print(f"\n  cost of the nomination assumption (B-A): {m.errB.mean()-m.errA.mean():+.2f} seats/area")
    print(f"  cost of the share model            (C-B): {m.errC.mean()-m.errB.mean():+.2f} seats/area")

    print("\n  by contest (mean party-seat error):")
    print(f"  {'contest':16} {'A':>6} {'B':>6} {'C':>6}")
    for (co, yr), g in m.groupby(['contest', 'year']):
        print(f"  {co+str(yr):16} {g.errA.mean():6.2f} {g.errB.mean():6.2f} {g.errC.mean():6.2f}")

    # NI-wide seat totals, end-to-end, for the most recent of each contest type
    for contest, scale, years in GROUPS:
        year = years[-1]
        fn = [f for f in stv.CONTESTS if f[0] == contest and f[1] == year][0][2]
        pred = predicted_shares(scale)
        act, sC = collections.Counter(), collections.Counter()
        for c in stv.load_contest(contest, year, fn):
            key = (f"{contest}{year}", c['area'].upper() if scale != 'dea' else c['area'])
            ps = pred.get(key)
            if not ps:
                continue
            for i in c['actual']:
                act[c['parties'][i]] += 1
            el, _, _ = stv.project_seats(c['names'], c['parties'], ps, c['seats'], c['valid'])
            for i in el:
                sC[c['parties'][i]] += 1
        print(f"\n  NI-wide seats, {contest} {year}, FULL end-to-end:")
        print(f"    {'party':16} {'actual':>7} {'proj':>6} {'diff':>5}")
        for p in sorted(set(act) | set(sC), key=lambda p: -act[p]):
            print(f"    {p:16} {act[p]:7} {sC[p]:6} {sC[p]-act[p]:+5}")
        print(f"    total abs seat error: "
              f"{sum(abs(sC[p]-act[p]) for p in set(act)|set(sC))} of {sum(act.values())}")


if __name__ == '__main__':
    main()
