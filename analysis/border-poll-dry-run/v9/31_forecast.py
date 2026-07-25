#!/usr/bin/env python3
"""v9 phase 31 — the wired-up forecaster: poll level + census shape + DEA blend.

Phases 28 and 29 measured two gains but left them as standalone evaluations, so
neither reached a seat number and the model still could not project an unheld
election. This wires both in and scores the result end to end.

Architecture (now the same shape as the unity model's, which solved this first):

    LEVEL      calibrated LucidTalk party VI      <- phase 28, NEW
    SHAPE      census ridge + competitive field   <- phases 17, 26
    BLEND      per-party census/persistence       <- phase 29, NEW (DEA only)
    SEATS      nominations -> PR-STV count        <- phases 21, 19

How the level is imposed. The share model works in CLR space and adds back a
per-contest level. Previously that level was the mean over the TRAINING AREAS of
the same contest -- which requires the contest to have happened. Now it can instead
be the CLR of the calibrated poll vector, which requires only a poll. That single
substitution is what makes the model forecast rather than backtest.

Blend applies at DEA only: phase 29 found it wins there (14.22 vs 15.46) and loses
at constituency (14.19 vs 13.53), because the constituency set mixes Assembly and
Westminster and cross-contest-type persistence is weak.

Scored four ways so each addition is separable:
    A  train level + census      the model as it stood
    B  train level + blend
    C  poll  level + census
    D  poll  level + blend       the true ex-ante forecaster
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
bl = _load('bl29', '29_blend_census_persistence.py')
PARTIES = pm.PARTIES

VI = pd.read_csv(os.path.join(HERE, 'lucidtalk_party_vi.csv'), index_col=0)
HE = json.load(open(os.path.join(HERE, 'party_vi_calibration.json'),
                    encoding='utf-8'))['house_effect']
CONTEST_DATE = {'assembly2016': '2016-05', 'assembly2017': '2017-03',
                'assembly2022': '2022-05', 'westminster2017': '2017-06',
                'westminster2019': '2019-12', 'westminster2024': '2024-07',
                'local2014': '2014-05', 'local2019': '2019-05', 'local2023': '2023-05'}


def calibrated_poll(contest_year, max_gap=12):
    """Calibrated NI party shares from the nearest poll, or None if none in range."""
    tgt = CONTEST_DATE.get(contest_year)
    if tgt is None:
        return None
    ty, tm = int(tgt[:4]), int(tgt[5:7])
    best, bd = None, 1e9
    for d in VI.index:
        y, m = int(str(d)[:4]), int(str(d)[5:7])
        dist = abs((y * 12 + m) - (ty * 12 + tm))
        if dist < bd:
            best, bd = d, dist
    if best is None or bd > max_gap:
        return None
    row = VI.loc[best]
    out = {p: float(row.get(p, 0.0)) - float(HE.get(p, 0.0)) for p in PARTIES}
    out = {p: max(v, 0.01) for p, v in out.items()}
    s = sum(out.values())
    return {p: 100.0 * v / s for p, v in out.items()}


def predict(scale, level='train', blend=False):
    """Leave-one-contest-out predictions under the chosen level source."""
    S, stood, X, meta, feats = pm.build(scale)
    cy = meta.contest_year.values
    contests = sorted(set(cy))
    P = np.zeros_like(S)
    used_poll = {}
    for c in contests:
        sel = cy == c
        C = bl.census_loco(S, stood, X, meta, c)          # census shape, level=train
        if level == 'poll':
            pv = calibrated_poll(c)
            used_poll[c] = pv is not None
            if pv is not None:
                # replace the contest level: re-impose the poll's composition on the
                # predicted shape by rescaling each party and renormalising
                cur = np.average(C[sel], axis=0, weights=meta.valid_poll.values[sel])
                tgt = np.array([pv[p] for p in PARTIES])
                ratio = np.where(cur > 1e-6, tgt / np.maximum(cur, 1e-6), 1.0)
                C = C.copy()
                C[sel] = bl.renorm(C[sel] * ratio)
        if blend and scale == 'dea':
            Pp = bl.persistence(S, meta, exclude_cy=c)
            w = bl.fit_weights(S, stood, X, meta, [t for t in contests if t != c])
            C = C.copy()
            C[sel] = bl.renorm(np.clip(w * C[sel] + (1 - w) * Pp[sel], 0, None))
        P[sel] = C[sel]
    return P, S, stood, meta, used_poll


def tvd(P, S):
    return 0.5 * np.abs(P - S).sum(axis=1)


def main():
    print("=" * 74)
    print("WIRED FORECASTER — poll level + census shape + DEA blend")
    for scale in ['dea', 'constituency']:
        print(f"\n{scale.upper()}")
        print(f"  {'variant':34} {'TVD med':>8} {'TVD mean':>9}")
        res = {}
        for lab, lvl, bnd in [('A  train level + census', 'train', False),
                              ('B  train level + blend', 'train', True),
                              ('C  poll  level + census', 'poll', False),
                              ('D  poll  level + blend  (EX ANTE)', 'poll', True)]:
            P, S, stood, meta, up = predict(scale, lvl, bnd)
            res[lab] = (P, S, meta)
            t = tvd(P, S)
            print(f"  {lab:34} {np.median(t):8.2f} {t.mean():9.2f}")
        # poll coverage
        P, S, stood, meta, up = predict(scale, 'poll', False)
        miss = [c for c, ok in up.items() if not ok]
        if miss:
            print(f"  (no poll within 12 months, level falls back to observed: {miss})")

        # NI-wide level accuracy under each level source
        print(f"\n  NI-wide mean |error| per party:")
        for lab in ['A  train level + census', 'D  poll  level + blend  (EX ANTE)']:
            Pp, Ss, mm = res[lab]
            errs = []
            for c in sorted(set(mm.contest_year.values)):
                s = mm.contest_year.values == c
                w = mm.valid_poll.values[s]
                errs.append(np.abs(np.average(Pp[s], axis=0, weights=w)
                                   - np.average(Ss[s], axis=0, weights=w)).mean())
            print(f"    {lab:34} {np.mean(errs):.2f} pts")

    # ---------- seats, end to end, with the ex-ante shares ----------
    stv = _load('stv19', '19_stv_simulator.py')
    print("\n" + "=" * 74)
    print("SEATS from the ex-ante shares (poll level + blend), STV contests")
    P, S, stood, meta, _ = predict('dea', 'poll', True)
    lookup = {}
    for k, row in zip(meta.index, P):
        c, a = k.split('||')
        lookup[(c, a)] = dict(zip(PARTIES, row))
    Pc, Sc, stc, mc, _ = predict('constituency', 'poll', False)
    for k, row in zip(mc.index, Pc):
        c, a = k.split('||')
        lookup[(c, a)] = dict(zip(PARTIES, row))

    rows = []
    for contest, year, fn in stv.CONTESTS:
        cyk = f"{contest}{year}"
        scale = 'dea' if contest == 'local' else 'constituency'
        for cd in stv.load_contest(contest, year, fn):
            ak = cd['area'] if scale == 'dea' else cd['area'].upper()
            ps = lookup.get((cyk, ak))
            if not ps:
                continue
            actual = collections.Counter(cd['parties'][i] for i in cd['actual'])
            el, _, _ = stv.project_seats(cd['names'], cd['parties'], ps,
                                         cd['seats'], cd['valid'])
            sim = collections.Counter(cd['parties'][i] for i in el)
            err = sum((actual - sim).values()) + sum((sim - actual).values())
            rows.append({'contest': contest, 'year': year, 'seats': cd['seats'],
                         'err': err})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, 'forecast_seats_report.csv'), index=False)
    print(f"  areas {len(df)}  seats {int(df.seats.sum())}  "
          f"mean party-seat error {df.err.mean():.2f}  exact {100*(df.err==0).mean():.1f}%")
    print(f"\n  {'contest':16} {'mean err':>9}")
    for (c, y), g in df.groupby(['contest', 'year']):
        print(f"  {c+str(y):16} {g.err.mean():9.2f}")


if __name__ == '__main__':
    main()
