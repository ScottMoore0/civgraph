#!/usr/bin/env python3
"""v9 phase 44 — the holdout: what the model is worth on a contest it has not seen.

Everything reported so far is leave-one-contest-out on six STV contests, and the
configuration itself was selected by looking at those same six across ~43 phases. So
the headline (1.97 seats/area) is optimistic by an unknown amount. This measures part
of that gap.

TWO LEAKS FIXED HERE
--------------------
1. THE TRANSFER MATRIX. 18_ estimates it from ALL six contests and 19_/38_ then use
   it to project every one of them -- including the contest whose own transfer
   behaviour is in the matrix. That is straightforward leakage and has been present
   in every seat number reported. Here the matrix is re-estimated per fold from the
   other contests only.
2. FORWARD-IN-TIME. Leave-one-contest-out lets a 2014 prediction learn from 2023.
   The forward test trains only on contests STRICTLY EARLIER than the target, which
   is the situation an actual forecast faces.

WHAT THIS STILL CANNOT UNDO
---------------------------
The architecture and hyperparameters -- which features, alpha=50, field features on,
the per-type policy, eps=0.5, the blend design -- were all chosen with knowledge of
all six contests. No retrospective procedure can un-know that. So even the forward
number below remains an upper bound on true out-of-sample performance, and should be
read as "at least this bad", not "this good".
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
p38 = _load('p38', '38_forecast_v4.py')
stv = _load('stv19', '19_stv_simulator.py')
tm18 = _load('tm18', '18_transfer_model.py')
ind34 = _load('ind34', '34_independents.py')
p41 = _load('p41', '41_independents_fix.py')
PARTIES = pm.PARTIES
IND = ind34.IND

ORDER = {'local2014': 2014, 'assembly2016': 2016, 'assembly2017': 2017,
         'local2019': 2019, 'assembly2022': 2022, 'local2023': 2023}


def build_matrix(exclude=(), only_before=None):
    """Re-estimate the party->party transfer matrix from a subset of contests."""
    events = []
    for contest, year, fn in tm18.CONTESTS:
        cyk = f"{contest}{year}"
        if cyk in exclude:
            continue
        if only_before is not None and ORDER.get(cyk, 9999) >= only_before:
            continue
        path = os.path.join(tm18.META, fn)
        if not os.path.exists(path):
            continue
        for e in tm18.extract_events(path, contest, year):
            srcp = {s for s in e['sources'] if s}
            if len(srcp) == 1:
                events.append(dict(e, sources=[next(iter(srcp))]))
    pair = collections.defaultdict(float)
    mass = collections.defaultdict(float)
    ntn, ntd = collections.defaultdict(float), collections.defaultdict(float)
    bpair, bmass = collections.defaultdict(float), collections.defaultdict(float)
    for e in events:
        s = e['sources'][0]
        if e['moved'] <= 0:
            continue
        for dp, v in e['gains'].items():
            pair[(s, dp)] += v
            bpair[(tm18.bloc(s), tm18.bloc(dp))] += v
        mass[s] += e['moved']
        bmass[tm18.bloc(s)] += e['moved']
        if e['lost'] > 0:
            direct = e.get('nt_direct', 0.0)
            ntn[s] += direct if direct > 0 else max(0.0, e['lost'] - e['moved'])
            ntd[s] += e['lost']
    matrix = {s: {d: pair[(s, d)] / mass[s] for (ss, d) in pair if ss == s}
              for s in mass}
    nt = {s: (ntn[s] / ntd[s]) if ntd[s] > 0 else 0.0 for s in ntd}
    blocm = {b: {d: bpair[(b, d)] / bmass[b] for d in ['NAT', 'UNI', 'OTH']
                 if bpair[(b, d)] > 0} for b in bmass}
    return matrix, nt, blocm, len(events)


def score(cy_target, matrix, nt, blocm, cand_before):
    """Project the target contest's seats with the supplied transfer model."""
    stv.MATRIX, stv.NONTRANS, stv.BLOCM = matrix, nt, blocm
    est_ind = p41.candidate_estimates()
    df = ind34.load()
    hist = collections.defaultdict(list)
    for r in df.sort_values('order').itertuples():
        hist[r.pid].append(r)
    cw = {}
    for r in df.itertuples():
        prior = [h for h in hist[r.pid] if h.order < r.order
                 and (cand_before is None or h.order < cand_before)]
        if prior:
            last = prior[-1]
            cw[(p41.ORD2CY.get(int(r.order)), r.area, r.name)] = \
                last.share * (1.0 if last.elected else 0.75)
    lut = {}
    for scale in ['dea', 'constituency']:
        P, S, meta = p38.predict(scale)
        for k, row in zip(meta.index, P):
            c, a = k.split('||')
            lut[(c, a)] = dict(zip(PARTIES, row))
    rows = []
    for contest, year, fn in stv.CONTESTS:
        cyk = f"{contest}{year}"
        if cyk != cy_target:
            continue
        scale = 'dea' if contest == 'local' else 'constituency'
        for cd in stv.load_contest(contest, year, fn):
            ak = cd['area'] if scale == 'dea' else cd['area'].upper()
            ps = lut.get((cyk, ak))
            if not ps:
                continue
            byp = collections.defaultdict(list)
            for i, (nm, pty) in enumerate(zip(cd['names'], cd['parties'])):
                byp[pty].append((i, nm))
            fp = [0.0] * len(cd['names'])
            for pty, mem in byp.items():
                if pty in IND:
                    for i, nm in mem:
                        fp[i] = cd['valid'] * est_ind.get((cyk, cd['area'], nm), 3.0) / 100.0
                    continue
                tot = cd['valid'] * ps.get(pty, 0.0) / 100.0
                ws = np.array([cw.get((cyk, cd['area'], nm), np.nan) for _, nm in mem])
                if np.isfinite(ws).any():
                    ws = np.where(np.isfinite(ws), ws, np.nanmean(ws[np.isfinite(ws)]))
                    ws = np.clip(ws, 1e-6, None); ws = ws / ws.sum()
                else:
                    ws = np.repeat(1.0 / len(mem), len(mem))
                for (i, _), w in zip(mem, ws):
                    fp[i] = tot * w
            actual = collections.Counter(cd['parties'][i] for i in cd['actual'])
            el, _, _ = stv.run_stv(cd['names'], cd['parties'], fp, cd['seats'], cd['valid'])
            sim = collections.Counter(cd['parties'][i] for i in el)
            rows.append({'seats': cd['seats'],
                         'err': sum((actual - sim).values()) + sum((sim - actual).values())})
    return pd.DataFrame(rows)


def main():
    print("=" * 74)
    print("HOLDOUT — how much of 1.97 survives?")
    base_m, base_nt, base_b, n_all = build_matrix()
    print(f"  full transfer matrix: {n_all} events (all six contests)")

    print("\nA. leave-one-contest-out, TRANSFER MATRIX ALSO HELD OUT")
    print(f"  {'contest':16} {'events':>7} {'seat err':>9}")
    tot, wt = [], []
    for cyk in sorted(ORDER, key=ORDER.get):
        m, nt, b, n = build_matrix(exclude=(cyk,))
        df = score(cyk, m, nt, b, cand_before=None)
        if df.empty:
            continue
        tot.append(df.err.mean()); wt.append(len(df))
        print(f"  {cyk:16} {n:7} {df.err.mean():9.2f}")
    a_mean = np.average(tot, weights=wt)
    print(f"  {'WEIGHTED MEAN':16} {'':7} {a_mean:9.2f}")

    print("\nB. FORWARD ONLY — train on strictly earlier contests")
    print(f"  {'contest':16} {'events':>7} {'seat err':>9}")
    ft, fw = [], []
    for cyk in sorted(ORDER, key=ORDER.get):
        o = ORDER[cyk]
        m, nt, b, n = build_matrix(only_before=o)
        if n < 50:
            print(f"  {cyk:16} {n:7}   (too few prior events, skipped)")
            continue
        df = score(cyk, m, nt, b, cand_before=o)
        if df.empty:
            continue
        ft.append(df.err.mean()); fw.append(len(df))
        print(f"  {cyk:16} {n:7} {df.err.mean():9.2f}")
    if ft:
        print(f"  {'WEIGHTED MEAN':16} {'':7} {np.average(ft, weights=fw):9.2f}")

    # restore
    stv.MATRIX, stv.NONTRANS, stv.BLOCM = base_m, base_nt, base_b
    print("\n  reported headline (matrix trained on all contests): 1.97")
    print(f"  A: matrix held out too                             : {a_mean:.2f}")
    if ft:
        print(f"  B: forward-only                                    : "
              f"{np.average(ft, weights=fw):.2f}")


if __name__ == '__main__':
    main()
