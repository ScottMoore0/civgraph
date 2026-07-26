#!/usr/bin/env python3
"""v9 phase 42 — turnout and spoiled votes: the missing structural layers.

The pipeline predicts vote SHARES and runs a count. It has never modelled how many
people vote, or how many ballots are spoiled, so it cannot produce the full chain

    electorate -> turnout -> total poll -> spoiled -> valid poll -> votes per
    candidate -> transfers -> seats

Both quantities are in the data (`electorate`, `turnoutPct`, `totalPoll`, `spoiled`,
`validPoll`) and neither has been used.

Honest expectation, set before running. Turnout was flagged at the very start of this
work as the one axis that backtests well *everywhere*, because it is demographically
structured in a way vote choice is not. But for SEAT prediction it mostly does not
matter: seats depend on shares WITHIN an area, and scaling every candidate in an area
by the same turnout leaves shares unchanged. Turnout affects seats only through
DIFFERENTIAL turnout between communities inside the same area. So the expected gains
are:

    a genuine new deliverable        (the counts the chain needs)     LARGE
    better share/seat prediction     (via differential turnout only)  SMALL

Scored leave-one-contest-out against two baselines that must be beaten: the contest
mean, and that area's own turnout at other contests of the same type.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
p37 = _load('p37', '37_contest_type.py')
stv = _load('stv19', '19_stv_simulator.py')

CONTESTS = [('assembly', 2016, 'northern-ireland-assembly__2016-05-05.json'),
            ('assembly', 2017, 'northern-ireland-assembly__2017-03-02.json'),
            ('assembly', 2022, 'northern-ireland-assembly__2022-05-05.json'),
            ('local', 2014, 'local-government-local-government-districts__2014-05-22.json'),
            ('local', 2019, 'local-government-local-government-districts__2019-05-02.json'),
            ('local', 2023, 'local-government-local-government-districts__2023-05-18.json'),
            ('westminster', 2017, 'house-of-commons-of-the-united-kingdom__2017-06-08.json'),
            ('westminster', 2019, 'house-of-commons-of-the-united-kingdom__2019-12-12.json'),
            ('westminster', 2024, 'house-of-commons-of-the-united-kingdom__2024-07-04.json')]


def f(x):
    try:
        return float(str(x).replace(',', '').strip() or 0)
    except Exception:
        return 0.0


def load():
    rows = []
    for contest, year, fn in CONTESTS:
        p = os.path.join(META, fn)
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        seen = set()
        for r in d['results']:
            a = r['constituency']
            if a in seen:
                continue
            seen.add(a)
            el, tp = f(r.get('electorate')), f(r.get('totalPoll'))
            vp, sp = f(r.get('validPoll')), f(r.get('spoiled'))
            if el <= 0 or tp <= 0:
                continue
            rows.append({'contest': contest, 'year': year,
                         'cy': f"{contest}{year}",
                         'scale': 'dea' if contest == 'local' else 'constituency',
                         'area': a, 'electorate': el, 'total_poll': tp,
                         'valid_poll': vp if vp > 0 else tp - sp, 'spoiled': sp,
                         'turnout_pct': 100.0 * tp / el,
                         'spoiled_pct': 100.0 * sp / tp if tp > 0 else np.nan})
    return pd.DataFrame(rows)


def features(df, scale):
    cens = (pd.read_csv(os.path.join(HERE, 'dea_features.csv')).set_index('area')
            if scale == 'dea' else
            pd.read_csv(os.path.join(HERE, 'constituency_features.csv')).set_index('con'))
    if scale != 'dea':
        cens.index = cens.index.str.upper().str.strip()
    sub = df[df.scale == scale].copy()
    sub['akey'] = sub.area if scale == 'dea' else sub.area.str.upper().str.strip()
    sub = sub[sub.akey.isin(cens.index)]
    X = cens.loc[sub.akey].values.astype(float)
    return sub.reset_index(drop=True), X, cens.columns.tolist()


def evaluate(target, scale):
    df = load()
    sub, X, cols = features(df, scale)
    y = sub[target].values.astype(float)
    ok = np.isfinite(y)
    sub, X, y = sub[ok].reset_index(drop=True), X[ok], y[ok]
    cy = sub.cy.values
    # persistence: same area, other contests of the SAME type
    per = np.zeros(len(y))
    for i, r in sub.iterrows():
        m = ((sub.akey == r.akey) & (sub.cy != r.cy)
             & (sub.contest == r.contest)).values
        per[i] = y[m].mean() if m.any() else y.mean()
    # contest mean
    cm = np.array([y[cy == c].mean() for c in cy])
    # census ridge, leave-one-contest-out
    pred = np.zeros(len(y))
    for c in sorted(set(cy)):
        te = cy == c
        tr = ~te
        sc = StandardScaler().fit(X[tr])
        ctr = y[tr].mean()
        m = Ridge(alpha=pm.ALPHA).fit(sc.transform(X[tr]), y[tr] - ctr)
        pred[te] = m.predict(sc.transform(X[te])) + y[tr].mean()
    # census + persistence, simple average
    both = 0.5 * pred + 0.5 * per
    print(f"\n  {target} at {scale} (n={len(y)}, mean {y.mean():.2f})")
    print(f"    {'model':30} {'MAE':>7} {'R2':>7}")
    for lab, p in [('contest mean', cm), ('area persistence (same type)', per),
                   ('census ridge', pred), ('census + persistence', both)]:
        r2 = 1 - ((p - y) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        print(f"    {lab:30} {np.abs(p - y).mean():7.2f} {r2:+7.3f}")
    return sub, y, both


def main():
    print("=" * 72)
    print("TURNOUT AND SPOILED VOTES")
    df = load()
    print(f"  area-contests with electorate + poll data: {len(df)}")
    print(f"  turnout   mean {df.turnout_pct.mean():.1f}%  "
          f"range {df.turnout_pct.min():.1f}-{df.turnout_pct.max():.1f}")
    print(f"  spoiled   mean {df.spoiled_pct.mean():.2f}%  "
          f"range {df.spoiled_pct.min():.2f}-{df.spoiled_pct.max():.2f}")

    out = {}
    for target in ['turnout_pct', 'spoiled_pct']:
        for scale in ['dea', 'constituency']:
            sub, y, pred = evaluate(target, scale)
            out[(target, scale)] = (sub, y, pred)

    # assemble the full chain as a deliverable
    print("\n" + "=" * 72)
    print("FULL CHAIN per area (predicted), sample from local 2023")
    sub, y, tpred = out[('turnout_pct', 'dea')]
    sub2, y2, spred = out[('spoiled_pct', 'dea')]
    chain = sub[['cy', 'area', 'electorate']].copy()
    chain['turnout_pct'] = tpred
    chain['total_poll'] = chain.electorate * chain.turnout_pct / 100.0
    sp = pd.Series(spred, index=sub2.index)
    key = sub2.cy + '||' + sub2.area
    spmap = dict(zip(key, sp))
    chain['spoiled_pct'] = [spmap.get(f"{c}||{a}", np.nan)
                            for c, a in zip(chain.cy, chain.area)]
    chain['spoiled'] = chain.total_poll * chain.spoiled_pct / 100.0
    chain['valid_poll'] = chain.total_poll - chain.spoiled
    chain.to_csv(os.path.join(HERE, 'turnout_chain.csv'), index=False)
    s = chain[chain.cy == 'local2023'].head(6)
    print(s[['area', 'electorate', 'turnout_pct', 'total_poll',
             'spoiled', 'valid_poll']].to_string(index=False,
                                                 float_format=lambda v: f"{v:,.0f}"))
    print("\n  wrote turnout_chain.csv (electorate -> turnout -> poll -> spoiled -> valid)")

    # does predicted turnout help the SHARE model?
    print("\n" + "=" * 72)
    print("Does turnout help share prediction? (differential-turnout channel)")
    S, stood, X, meta, feats = pm.build('dea')
    tk = {f"{c}||{a}": v for c, a, v in zip(sub.cy, sub.area, tpred)}
    extra = np.array([[tk.get(k, np.nan)] for k in meta.index])
    good = np.isfinite(extra).ravel()
    print(f"  DEA rows with a turnout prediction: {good.sum()}/{len(meta)}")
    if good.sum() > 100:
        base = p37.run('dea', typed=False, blend_types=('local',))[0]
        Xa = np.hstack([X, np.nan_to_num(extra, nan=float(np.nanmean(extra)))])
        Sa, sta, _, ma, _ = pm.build('dea')
        import copy
        # rerun with the augmented matrix by monkey-patching build's output
        cy2 = ma.contest_year.values
        from sklearn.linear_model import Ridge as R2
        Y = pm.clr(Sa)
        P = np.zeros_like(Y)
        for c in sorted(set(cy2)):
            te = cy2 == c; tr = ~te
            sc = StandardScaler().fit(Xa[tr])
            for j in range(Y.shape[1]):
                ctr = pd.Series(Y[tr, j]).groupby(cy2[tr]).transform('mean').values
                mm = R2(alpha=pm.ALPHA).fit(sc.transform(Xa[tr]), Y[tr, j] - ctr)
                P[te, j] = mm.predict(sc.transform(Xa[te])) + Y[tr, j].mean()
        Paug = pm.inv_clr(P, sta)
        t0 = np.median(0.5 * np.abs(base - S).sum(axis=1))
        t1 = np.median(0.5 * np.abs(Paug - Sa).sum(axis=1))
        print(f"    share TVD median  without turnout {t0:.2f}   with turnout {t1:.2f}")


if __name__ == '__main__':
    main()
