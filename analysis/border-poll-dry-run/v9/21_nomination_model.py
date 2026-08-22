#!/usr/bin/env python3
"""v9 phase 21 — nomination model: how many candidates does each party run?

This closes the last open link in the seat pipeline. Phases 19-20 needed the real
candidate list as an input, so they could only score a contest after nominations
closed. With this, the chain runs ex ante:

    census -> party share -> NOMINATIONS -> STV count -> seats

Why it is tractable at all: nominations are not free choices, they are quota
arithmetic. A party contesting a district of M seats with share s expects
s*(M+1)/100 quotas and nominates about that many, rounded up. On the repo's own
data that rule alone, with nothing fitted, matches the true candidate count in
78.3% of party-area cases (r = 0.780).

Model
-----
target    number of candidates the party nominated in that area
features  expected quotas (from share), seats available, the party's candidate
          count and share in the SAME area at the previous contest of the same
          type (nominations are sticky), party identity, and the census block
validated leave-one-council-out, against two baselines that must be beaten:
            ceil(expected quotas)     -- pure arithmetic, no fitting
            lag                       -- what the party ran there last time

Two input regimes are reported, because they bound the honest answer:
  TRUE share      an upper bound: what nomination prediction can do if the vote
                  share were known perfectly
  PREDICTED share the realistic ex-ante case, using phase 17's leave-one-council-out
                  shares -- share error propagates into nomination error

Output: nomination_frame.csv, nomination_report.txt
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

CONTESTS = [
    ('assembly', 'constituency', 2016, 'northern-ireland-assembly__2016-05-05.json'),
    ('assembly', 'constituency', 2017, 'northern-ireland-assembly__2017-03-02.json'),
    ('assembly', 'constituency', 2022, 'northern-ireland-assembly__2022-05-05.json'),
    ('local', 'dea', 2014, 'local-government-local-government-districts__2014-05-22.json'),
    ('local', 'dea', 2019, 'local-government-local-government-districts__2019-05-02.json'),
    ('local', 'dea', 2023, 'local-government-local-government-districts__2023-05-18.json'),
]
IND = {'Independent', 'Independent Other', 'Independent Unionist', 'Independent Nationalist'}
MAIN = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP', 'Aontú']
PARTIES = MAIN + ['Independent', 'Other']


def cat(p):
    return 'Independent' if p in IND else (p if p in MAIN else 'Other')


def build_frame():
    rows = []
    for contest, scale, year, fn in CONTESTS:
        d = json.load(open(os.path.join(META, fn), encoding='utf-8'))
        for r in d['results']:
            cs = r.get('candidates') or []
            if not cs:
                continue
            n = collections.Counter()
            v = collections.defaultdict(float)
            for c in cs:
                p = cat((c.get('party') or '').strip())
                n[p] += 1
                v[p] += float(c.get('firstPrefs') or 0)
            tot = sum(v.values())
            if tot <= 0:
                continue
            seats = int(r.get('seatsTotal') or 1)
            for p in PARTIES:
                rows.append({'contest': contest, 'scale': scale, 'year': year,
                             'area': r['constituency'], 'party': p,
                             'n_cand': n.get(p, 0),
                             'share': 100.0 * v.get(p, 0.0) / tot,
                             'seats': seats})
    df = pd.DataFrame(rows)
    # lag: same area + party + contest type, previous year
    df = df.sort_values(['contest', 'area', 'party', 'year'])
    g = df.groupby(['contest', 'area', 'party'])
    df['lag_n'] = g.n_cand.shift(1)
    df['lag_share'] = g.share.shift(1)
    df['exp_quotas'] = df.share * (df.seats + 1) / 100.0
    df['lag_exp_quotas'] = df.lag_share * (df.seats + 1) / 100.0
    return df


def councils():
    lf = json.load(open(f"{REPO}/render/metadata/elections-test2/"
                        "local-government-local-government-districts__2023-05-18.json",
                        encoding='utf-8'))
    return lf['localBodyByConstituency']


def evaluate(df, share_col, label, out):
    """Leave-one-council-out evaluation using `share_col` as the share input."""
    d = df.dropna(subset=['lag_n']).copy()
    d['exp_q'] = d[share_col] * (d.seats + 1) / 100.0
    d2c = councils()
    d['council'] = d.area.map(d2c).fillna(d.area)
    pf = pd.get_dummies(d.party, prefix='p')
    X = pd.concat([d[['exp_q', 'seats', 'lag_n', 'lag_exp_quotas']].fillna(0), pf],
                  axis=1).values.astype(float)
    y = d.n_cand.values.astype(float)
    groups = d.council.values
    pred = np.zeros(len(y))
    for g in sorted(set(groups)):
        te = groups == g
        tr = ~te
        sc = StandardScaler().fit(X[tr])
        m = GradientBoostingRegressor(n_estimators=200, max_depth=3, random_state=0)
        m.fit(sc.transform(X[tr]), y[tr])
        pred[te] = m.predict(sc.transform(X[te]))
    pr = np.clip(np.round(pred), 0, None)
    # baselines
    b_arith = np.where(d.exp_q.values > 0, np.ceil(d.exp_q.values), 0)
    b_lag = d.lag_n.values
    def rep(name, p):
        p = np.asarray(p, dtype=float)
        return (f"    {name:34} exact={100*np.mean(p == y):5.1f}%  "
                f"MAE={np.mean(np.abs(p - y)):.3f}  "
                f"total-cand err={abs(p.sum()-y.sum())/y.sum()*100:4.1f}%")
    out.append(f"  {label}  (n={len(y)})")
    out.append(rep("baseline: ceil(expected quotas)", b_arith))
    out.append(rep("baseline: lag (last time)", b_lag))
    out.append(rep("MODEL (GBM, LO-council-out)", pr))
    # per-party
    out.append(f"    {'party':14} {'exact':>7} {'MAE':>7} {'mean n':>7}")
    for p in PARTIES:
        s = d.party.values == p
        if s.sum() == 0:
            continue
        out.append(f"    {p:14} {100*np.mean(pr[s]==y[s]):6.1f}% "
                   f"{np.mean(np.abs(pr[s]-y[s])):7.3f} {y[s].mean():7.2f}")
    return d, pr, y


def main():
    df = build_frame()
    df.to_csv(os.path.join(HERE, 'nomination_frame.csv'), index=False)
    out = ["NOMINATION MODEL — candidates per party per area", ""]
    out.append(f"frame: {len(df)} party-area-contest rows, "
               f"{int((df.n_cand>0).sum())} with the party standing")
    out.append("")

    # --- regime 1: true share (upper bound) ---
    evaluate(df, 'share', "REGIME 1 — TRUE share (upper bound)", out)
    out.append("")

    # --- regime 2: predicted share (realistic, ex ante) ---
    spec = importlib.util.spec_from_file_location('pm17', os.path.join(HERE, '17_party_model.py'))
    pm = importlib.util.module_from_spec(spec)
    sys.modules['pm17'] = pm
    spec.loader.exec_module(pm)
    pred_share = {}
    for scale in ['dea', 'constituency']:
        S, stood, X, meta, feats = pm.build(scale)
        P = pm.cv_share(S, stood, X, meta, meta.council.values)
        for k, row in zip(meta.index, P):
            cy, area = k.split('||')
            for p, v in zip(pm.PARTIES, row):
                pred_share[(cy, area, p)] = v
    df['cy'] = df.contest + df.year.astype(str)
    df['area_key'] = np.where(df.scale == 'dea', df.area, df.area.str.upper())
    df['pred_share'] = [pred_share.get((a, b, c), np.nan)
                        for a, b, c in zip(df.cy, df.area_key, df.party)]
    cov = df.pred_share.notna().mean()
    out.append(f"REGIME 2 — PREDICTED share  (coverage {100*cov:.1f}% of rows)")
    d2 = df.dropna(subset=['pred_share'])
    evaluate(d2, 'pred_share', "REGIME 2 — PREDICTED share (ex ante)", out)

    txt = "\n".join(out)
    print(txt)
    open(os.path.join(HERE, 'nomination_report.txt'), 'w', encoding='utf-8').write(txt)


if __name__ == '__main__':
    main()
