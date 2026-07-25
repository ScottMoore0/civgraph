#!/usr/bin/env python3
"""v9 phase 25 (stage 5) — party shares allocated to every Data Zone.

Produces a party-share mosaic for all 3,780 Data Zones, constrained to reproduce
the observed DEA totals.

What this is, precisely: an ALLOCATION consistent with observed results, not a
measurement. NI counts votes centrally, not by ballot box, so no party result
exists below DEA and none ever will. The DZ numbers therefore cannot be validated
at DZ level by anyone, ever.

What CAN be validated, and is, is that the allocation is coherent when aggregated
back to the scales where results do exist:
    DZ -> DEA (80)            local contests
    DZ -> constituency (18)   assembly contests
    DZ -> NI (1)

Method
  1. compositional model (phase 17) fit on DEA results, leave-one-council-out
  2. applied to the 3,780 DZ census feature rows -> raw DZ CLR scores -> softmax
  3. RAKING: within each DEA, DZ shares are scaled so the population-weighted mean
     reproduces the DEA target exactly, iterating over parties until the simplex
     constraint and the marginal both hold. Aggregation consistency is then exact
     at DEA by construction -- so the honest tests are the scales ABOVE the raking
     level (constituency, NI) and the unraked model's own DEA accuracy.

Weights are DZ usual residents (ms-a01-dz.csv). Electorate would be better; the
census population is what exists at DZ level.

Output: areas_party/<contest><year>_DZ21.csv  (one row per DZ, one column per party)
"""
import os, sys, json, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(HERE, 'areas_party')
os.makedirs(OUT, exist_ok=True)


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
PARTIES = pm.PARTIES
ALPHA = pm.ALPHA

dzf = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'ms-a01-dz.csv'))
pop = pop.set_index('GeographyCode').AllUsualResidents.astype(float)
dz_dea = json.load(open(os.path.join(HERE, 'dz_dea.json'), encoding='utf-8'))
dz_con = json.load(open(os.path.join(HERE, 'dz_constituency.json'), encoding='utf-8'))


def rake(dzshares, dzw, groups, target):
    """Scale DZ shares so each group's population-weighted mean equals `target`.

    Multiplicative on the simplex: multiply by the ratio the group needs, then
    renormalise rows to 100, and iterate -- renormalisation perturbs the marginal,
    so a single pass does not converge.
    """
    S = dzshares.copy()
    for _ in range(60):
        maxerr = 0.0
        for g, idx in groups.items():
            if g not in target.index:
                continue
            w = dzw[idx]
            if w.sum() <= 0:
                continue
            cur = np.average(S[idx], axis=0, weights=w)
            tgt = target.loc[g].values
            with np.errstate(divide='ignore', invalid='ignore'):
                ratio = np.where(cur > 1e-9, tgt / np.maximum(cur, 1e-9), 1.0)
            ratio = np.clip(ratio, 0.2, 5.0)
            S[idx] = S[idx] * ratio
            rs = S[idx].sum(axis=1, keepdims=True)
            S[idx] = 100.0 * np.divide(S[idx], rs, out=np.zeros_like(S[idx]), where=rs > 0)
            maxerr = max(maxerr, np.abs(np.average(S[idx], axis=0, weights=w) - tgt).max())
        if maxerr < 0.01:
            break
    return S


def main():
    S, stood, X, meta, feats = pm.build('dea')
    groups = meta.council.values
    cy = meta.contest_year.values
    Y = pm.clr(S)

    dzX_census = dzf[feats].values.astype(float)
    dzids = dzf.index.tolist()
    dzw = pop.reindex(dzids).fillna(0.0).values
    n_field = X.shape[1] - dzX_census.shape[1]  # 0 if PARTY_FIELD_FEATURES=0

    # DZ -> DEA / constituency index maps
    # dz_dea.json / dz_constituency.json key DEA and constituency names in
    # UPPERCASE ('DUNSILLY'); dea_features.csv and the results frame use title
    # case ('Dunsilly'). Match on a normalised key or nothing joins at all.
    def _n(x):
        return str(x).upper().strip()
    dz2dea = np.array([_n(dz_dea.get(i, '')) for i in dzids])
    dz2con = np.array([_n(dz_con.get(i, '')) for i in dzids])
    gidx_dea = {d: np.where(dz2dea == d)[0] for d in sorted(set(dz2dea)) if d}
    gidx_con = {c: np.where(dz2con == c)[0] for c in sorted(set(dz2con)) if c}

    print(f"DZ rows {len(dzids)}, DEAs covered {len(gidx_dea)}, "
          f"constituencies {len(gidx_con)}")

    report = []
    for contest_year in sorted(set(cy)):
        sel = cy == contest_year
        # A Data Zone has no candidate field of its own -- its voters receive the
        # ballot of the DEA containing them. So each DZ inherits its parent DEA's
        # competitive-field features for THIS contest. Without this the DZ matrix
        # is 88 wide while the fitted model expects 103.
        if n_field:
            fld_by_dea = {}
            for i in np.where(sel)[0]:
                fld_by_dea[_n(meta.area.values[i])] = X[i, -n_field:]
            default = np.mean(list(fld_by_dea.values()), axis=0)
            dzfield = np.vstack([fld_by_dea.get(d, default) for d in dz2dea])
            dzX = np.hstack([dzX_census, dzfield])
        else:
            dzX = dzX_census
        # leave-one-council-out DZ scores: for each council, train on other councils
        dzP = np.zeros((len(dzids), len(PARTIES)))
        for council in sorted(set(groups)):
            tr = sel & (groups != council)
            if tr.sum() < 10:
                tr = sel
            sc = StandardScaler().fit(X[tr])
            dzsc = sc.transform(dzX)
            hold = dz2dea
            # which DZs belong to this council's DEAs
            deas_in = {_n(a) for a, c in zip(meta.area[sel], groups[sel]) if c == council}
            mask = np.isin(hold, list(deas_in))
            if not mask.any():
                continue
            for j in range(len(PARTIES)):
                ctr = Y[tr, j].mean()
                m = Ridge(alpha=ALPHA).fit(sc.transform(X[tr]), Y[tr, j] - ctr)
                dzP[mask, j] = m.predict(dzsc[mask]) + ctr
        raw = pm.inv_clr(dzP, np.ones_like(dzP, dtype=bool))

        # target = actual DEA shares for that contest
        tgt = pd.DataFrame(S[sel], index=[_n(a) for a in meta.area[sel].values],
                           columns=PARTIES)
        tgt = tgt[~tgt.index.duplicated()]
        raked = rake(raw, dzw, gidx_dea, tgt)

        df = pd.DataFrame(raked, index=dzids, columns=PARTIES)
        df.index.name = 'DZ21'
        df.insert(0, 'population', dzw)
        df.to_csv(os.path.join(OUT, f'{contest_year}_DZ21.csv'))

        # ---- validation by aggregation ----
        def agg(idxmap, M):
            out = {}
            for g, idx in idxmap.items():
                w = dzw[idx]
                if w.sum() > 0:
                    out[g] = np.average(M[idx], axis=0, weights=w)
            return pd.DataFrame(out).T
        a_dea_raw = agg(gidx_dea, raw).reindex(tgt.index)
        a_dea_rak = agg(gidx_dea, raked).reindex(tgt.index)
        tvd_raw = 0.5 * np.abs(a_dea_raw.values - tgt.values).sum(axis=1)
        tvd_rak = 0.5 * np.abs(a_dea_rak.values - tgt.values).sum(axis=1)
        ni_raw = np.average(raw, axis=0, weights=dzw)
        ni_rak = np.average(raked, axis=0, weights=dzw)
        ni_act = np.average(S[sel], axis=0, weights=meta.valid_poll.values[sel])
        report.append({'contest': contest_year,
                       'DEA_TVD_unraked': np.median(tvd_raw),
                       'DEA_TVD_raked': np.median(tvd_rak),
                       'NI_maxerr_unraked': np.abs(ni_raw - ni_act).max(),
                       'NI_maxerr_raked': np.abs(ni_rak - ni_act).max()})
        print(f"\n{contest_year}: wrote areas_party/{contest_year}_DZ21.csv")
        print(f"  DZ->DEA  median TVD  unraked {np.median(tvd_raw):5.2f} -> "
              f"raked {np.median(tvd_rak):5.2f}  (raking targets DEA, so ~0 expected)")
        print(f"  DZ->NI   max party err  unraked {np.abs(ni_raw-ni_act).max():5.2f} -> "
              f"raked {np.abs(ni_rak-ni_act).max():5.2f} pts")
        top = pd.Series(ni_rak, index=PARTIES).sort_values(ascending=False).head(5)
        print("  NI party shares from the DZ mosaic: "
              + ", ".join(f"{k} {v:.1f}" for k, v in top.items()))

    pd.DataFrame(report).to_csv(os.path.join(HERE, 'dz_party_validation.csv'), index=False)

    # cross-scale check: DZ mosaic -> CONSTITUENCY vs actual assembly results
    print("\n" + "=" * 66)
    print("CROSS-SCALE CHECK — DZ mosaic aggregated to constituency (18)")
    Scon, stcon, Xcon, mcon, _ = pm.build('constituency')
    latest = 'local2023'
    M = pd.read_csv(os.path.join(OUT, f'{latest}_DZ21.csv')).set_index('DZ21')
    W = M.population.values
    Mv = M[PARTIES].values
    con_pred = {}
    for c, idx in gidx_con.items():
        con_pred[c] = np.average(Mv[idx], axis=0, weights=W[idx])
    for target_cy in ['assembly2022']:
        seln = mcon.contest_year.values == target_cy
        act = pd.DataFrame(Scon[seln], index=mcon.area[seln].values, columns=PARTIES)
        errs = []
        act.index = [str(i).upper().strip() for i in act.index]
        for c in act.index:
            if c in con_pred:
                errs.append(0.5 * np.abs(con_pred[c] - act.loc[c].values).sum())
        print(f"  {latest} mosaic vs {target_cy} actual: "
              f"median TVD {np.median(errs):.2f} pts over {len(errs)} constituencies")
        print("  (different contests, so this measures geographic coherence, "
              "not forecast accuracy)")


if __name__ == '__main__':
    main()
