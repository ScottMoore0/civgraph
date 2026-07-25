#!/usr/bin/env python3
"""v9 phase 17 (stage 2) — compositional census -> party-share model + presence model.

Two parts, because a party that did not contest an area is an ABSENCE, not a
zero-share observation:

  PRESENCE  P(party stands | census)      logistic ridge, per party
  SHARE     share | party stands          compositional ridge (CLR + softmax)

Share model. Independent per-party regressions do not respect the simplex: they
neither sum to 100 nor stay non-negative. So shares are centred-log-ratio
transformed, a ridge is fit per CLR coordinate (per-contest level removed, exactly
as the incumbent bloc model does), and predictions are mapped back through a
softmax restricted to the parties present. Additive smoothing (eps) handles zeros;
sensitivity to eps is reported rather than assumed away.

Validation mirrors 3_fit_validate.py: leave-one-COUNCIL-out is the deciding design
(spatial blocking), with leave-one-contest-out shown as the weaker comparison.
Scored per party (MAE on share) and per area (total variation distance, i.e.
half the summed absolute error across parties -- the share of the electorate
allocated to the wrong party).

Baselines that matter:
  contest mean     each party's NI-wide share that contest (no geography)
  area persistence each party's mean share in THAT area across other contests
                   -- the bar a census model must clear, as in the bloc model.
"""
import os, json
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ALPHA = 50.0
EPS = float(os.environ.get('PARTY_EPS', '0.5'))
# competitive-field features (phase 26); set PARTY_FIELD_FEATURES=0 to disable
FIELD_FEATURES = os.environ.get('PARTY_FIELD_FEATURES', '1') != '0'

PARTIES = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP',
           'Aontú', 'Independent', 'Other']

frame = pd.read_csv(os.path.join(HERE, 'party_results_frame.csv'))
cens_dea = pd.read_csv(os.path.join(HERE, 'dea_features.csv')).set_index('area')
cens_con = pd.read_csv(os.path.join(HERE, 'constituency_features.csv')).set_index('con')
# constituency_features keys on uppercase names ('BELFAST EAST'); the results
# frame uses title case ('Belfast East'). Match case-insensitively.
cens_con.index = cens_con.index.str.upper().str.strip()
cens_con23 = pd.read_csv(os.path.join(HERE, 'constituency_features_2023.csv')).set_index('con')
cens_con23.index = cens_con23.index.str.upper().str.strip()
cens_con23 = cens_con23[cens_con.columns]  # identical feature order
lf = json.load(open(f"{REPO}/test/metadata/elections-test2/"
                    "local-government-local-government-districts__2023-05-18.json",
                    encoding='utf-8'))
dea2council = lf['localBodyByConstituency']


def r2(p, a):
    return 1 - ((p - a) ** 2).sum() / ((a - a.mean()) ** 2).sum()


def build(scale):
    """Wide matrices for one scale: shares, stood-mask, census X, fold keys."""
    f = frame[frame.scale == scale].copy()
    if scale != 'dea':
        f['area'] = f.area.str.upper().str.strip()
    # Boundary vintage per contest: the 2023 review applies to Westminster from
    # 2024. Everything earlier (and the 2022 Assembly) ran on the 2008 boundaries.
    # Matching 2024 against 2008-boundary features would be the wrong geography,
    # so each row is joined to the feature frame for ITS vintage.
    def cens_for(contest, year):
        if scale == 'dea':
            return cens_dea
        return cens_con23 if (contest == 'westminster' and year >= 2024) else cens_con
    keep, Xrows = [], []
    for idx, row in f.iterrows():
        c = cens_for(row.contest, row.year)
        if row.area in c.index:
            keep.append(idx)
    missing = sorted({(r.contest, r.year, r.area) for _, r in f.iterrows()
                      if _ not in keep})
    if missing:
        print(f"  ! {len(missing)} area-contests still unmatched: {missing[:3]}")
    f = f.loc[keep]
    f['key'] = f.contest + f.year.astype(str) + '||' + f.area
    share = f.pivot(index='key', columns='party', values='share_pct')[PARTIES]
    stood = f.pivot(index='key', columns='party', values='stood')[PARTIES].astype(bool)
    meta = (f[['key', 'contest', 'year', 'area', 'valid_poll']]
            .drop_duplicates('key').set_index('key').loc[share.index])
    stood = stood.loc[share.index]
    X = np.vstack([cens_for(c, y).loc[a].values.astype(float)
                   for c, y, a in zip(meta.contest, meta.year, meta.area)])
    if FIELD_FEATURES:
        # The competitive field: which parties are standing, and how many rivals
        # each bloc is running. Masking the softmax to present parties (below) only
        # spreads an absent party's vote in proportion to the survivors' own size,
        # which is the wrong physics for a pact -- when Sinn Fein stands aside the
        # vote goes to the SDLP, not proportionally to everyone. Supplying the field
        # as features lets the model ESTIMATE that response instead of assuming it.
        # Nominations close before polling, so this is known ex ante.
        st = stood.values if hasattr(stood, 'values') else stood
        uni = [PARTIES.index(p) for p in ['DUP', 'UUP', 'TUV']]
        nat = [PARTIES.index(p) for p in ['Sinn Féin', 'SDLP', 'Aontú']]
        oth = [i for i in range(len(PARTIES)) if i not in uni + nat]
        X = np.hstack([X, st.astype(float),
                       st[:, uni].sum(axis=1, keepdims=True).astype(float),
                       st[:, nat].sum(axis=1, keepdims=True).astype(float),
                       st[:, oth].sum(axis=1, keepdims=True).astype(float),
                       st.sum(axis=1, keepdims=True).astype(float)])
    meta['contest_year'] = meta.contest + meta.year.astype(str)
    meta['council'] = meta.area.map(dea2council) if scale == 'dea' else meta.area
    return share.values, stood.values, X, meta, cens_dea.columns.tolist()


def clr(S, eps=EPS):
    L = np.log(S + eps)
    return L - L.mean(axis=1, keepdims=True)


def inv_clr(Z, mask):
    """Softmax back to shares, restricted to present parties, summing to 100."""
    Z = np.where(mask, Z, -np.inf)
    Z = Z - np.nanmax(np.where(np.isfinite(Z), Z, -np.inf), axis=1, keepdims=True)
    E = np.where(np.isfinite(Z), np.exp(Z), 0.0)
    tot = E.sum(axis=1, keepdims=True)
    return 100.0 * np.divide(E, tot, out=np.zeros_like(E), where=tot > 0)


def cv_share(S, stood, X, meta, groups, use_true_presence=True, pres_pred=None):
    """Leave-one-group-out compositional prediction."""
    Y = clr(S)
    cy = meta.contest_year.values
    P = np.zeros_like(Y)
    for g in sorted(set(groups)):
        te = groups == g
        tr = ~te
        sc = StandardScaler().fit(X[tr])
        Xtr, Xte = sc.transform(X[tr]), sc.transform(X[te])
        for j in range(Y.shape[1]):
            ctr = pd.Series(Y[tr, j]).groupby(cy[tr]).transform('mean').values
            m = Ridge(alpha=ALPHA).fit(Xtr, Y[tr, j] - ctr)
            # level for the held-out rows: that contest's mean among TRAINING areas
            lvl = np.zeros(te.sum())
            for i, c in enumerate(cy[te]):
                src = tr & (cy == c)
                lvl[i] = Y[src, j].mean() if src.any() else Y[tr, j].mean()
            P[te, j] = m.predict(Xte) + lvl
    mask = stood if use_true_presence else pres_pred
    return inv_clr(P, mask)


def score(pred, S, meta, label):
    err = np.abs(pred - S)
    tvd = 0.5 * err.sum(axis=1)
    print(f"  {label:26} TVD med={np.median(tvd):5.2f}  mean={tvd.mean():5.2f} pts")
    return tvd


def baselines(S, stood, meta, groups):
    cy = meta.contest_year.values
    areas = meta.area.values
    # contest mean (weighted by valid poll)
    cm = np.zeros_like(S)
    for c in set(cy):
        sel = cy == c
        w = meta.valid_poll.values[sel]
        cm[sel] = np.average(S[sel], axis=0, weights=w)
    # area persistence: that area's mean share in OTHER contests
    ap = np.zeros_like(S)
    for i, (a, c) in enumerate(zip(areas, cy)):
        sel = (areas == a) & (cy != c)
        ap[i] = S[sel].mean(axis=0) if sel.any() else S.mean(axis=0)
    return cm, ap


def run(scale):
    print(f"\n{'=' * 72}\n{scale.upper()}  ", end='')
    S, stood, X, meta, feats = build(scale)
    print(f"{len(meta)} area-contests x {len(PARTIES)} parties, {X.shape[1]} census features")

    # ---------- presence model ----------
    print("\n  PRESENCE model (did the party stand?), leave-one-council-out:")
    groups = meta.council.values
    pres_pred = np.zeros_like(stood)
    for j, p in enumerate(PARTIES):
        y = stood[:, j].astype(int)
        if y.min() == y.max():
            pres_pred[:, j] = bool(y[0])
            print(f"    {p:12} always {'stands' if y[0] else 'absent'}")
            continue
        pr = np.zeros(len(y))
        for g in sorted(set(groups)):
            te = groups == g; tr = ~te
            if len(set(y[tr])) < 2:
                pr[te] = y[tr].mean()
                continue
            sc = StandardScaler().fit(X[tr])
            m = LogisticRegression(C=0.05, max_iter=2000).fit(sc.transform(X[tr]), y[tr])
            pr[te] = m.predict_proba(sc.transform(X[te]))[:, 1]
        pres_pred[:, j] = pr >= 0.5
        acc = (pres_pred[:, j] == stood[:, j]).mean()
        base = max(y.mean(), 1 - y.mean())
        print(f"    {p:12} acc={acc:.3f}  (majority-class baseline {base:.3f})  "
              f"stood {100*y.mean():.0f}%")
    print(f"    overall presence accuracy: {(pres_pred == stood).mean():.3f}")

    # ---------- share model ----------
    cm, ap = baselines(S, stood, meta, groups)
    print("\n  SHARE model — total variation distance (pts of electorate misallocated):")
    score(cm, S, meta, "contest mean (no model)")
    score(ap, S, meta, "area persistence")
    p_con = cv_share(S, stood, X, meta, meta.contest_year.values)
    score(p_con, S, meta, "census, LO-contest-out")
    p_cou = cv_share(S, stood, X, meta, groups)
    tv = score(p_cou, S, meta, "census, LO-COUNCIL-out")
    p_e2e = cv_share(S, stood, X, meta, groups, use_true_presence=False,
                     pres_pred=pres_pred)
    score(p_e2e, S, meta, "  ^ end-to-end (pred. presence)")

    print("\n  per-party MAE on share (leave-one-council-out):")
    print(f"    {'party':12} {'census':>8} {'persist':>8} {'cmean':>8}   {'mean share':>10}")
    for j, p in enumerate(PARTIES):
        print(f"    {p:12} {np.abs(p_cou[:, j]-S[:, j]).mean():8.2f} "
              f"{np.abs(ap[:, j]-S[:, j]).mean():8.2f} "
              f"{np.abs(cm[:, j]-S[:, j]).mean():8.2f}   {S[:, j].mean():10.2f}")

    # NI-wide aggregation, poll-weighted
    print("\n  NI-wide party share, actual vs predicted (LO-council-out):")
    w = meta.valid_poll.values
    for c in sorted(set(meta.contest_year.values)):
        sel = meta.contest_year.values == c
        a = np.average(S[sel], axis=0, weights=w[sel])
        q = np.average(p_cou[sel], axis=0, weights=w[sel])
        print(f"    {c:16} max|err|={np.abs(a-q).max():4.1f} pts  "
              f"mean|err|={np.abs(a-q).mean():4.2f} pts")
    return meta, S, p_cou, tv


if __name__ == '__main__':
    print(f"compositional party model  (CLR eps={EPS}, ridge alpha={ALPHA})")
    for sc in ['dea', 'constituency']:
        run(sc)
