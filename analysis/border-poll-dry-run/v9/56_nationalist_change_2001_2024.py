#!/usr/bin/env python3
"""v9 phase 56 — where did the SF/SDLP/PBP/Aontú bloc grow between 2001 and 2024?

READ THIS FIRST. Northern Ireland counts votes centrally, not by ballot box. No party
result exists below DEA and none ever will. Everything below Data Zone / Small Area /
Output Area level in this file is an ALLOCATION raked to observed area totals, not a
measurement, and cannot be validated at that level by anyone. The observed layer is
reported first and separately for exactly that reason.

The question also contains a premise worth testing before answering it. NI-wide the
bloc did not grow much and in Westminster it shrank:

    Westminster  2001 42.67%  ->  2024 40.22%   (-2.45)
    Local        2001 40.27%  ->  2023 41.67%   (+1.40)

The bloc's internal composition changed enormously (SF +10.2 / SDLP -9.8 Westminster;
SF +10.2 / SDLP -10.8 local) but its total barely moved. So "greatest increase" is a
question about REDISTRIBUTION, and the interesting quantity is the spread, not the mean.

Construction, and why each endpoint sits on its own native geography:

    2001 endpoint   OA2001  + 2001 census, raked to observed DEA1993 local-2001 totals
    2023 endpoint   DZ2021  + 2021 census, raked to observed DEA2014 local-2023 totals

That is the payoff of phases 52/53. Previously the 2001 contest had to be modelled on
DZ2021 with 2021 demography and raked to DEA1993 through an approximate crosswalk;
now both endpoints are contemporaneous with their own census AND their own DEA
vintage. The two mosaics are then carried onto a common geography with the phase-52
areal weights and differenced.

ONE ridge fit is used for both endpoints (2023 DEA results on 2021 harmonised
features), so the two mosaics cannot differ because the model differs. The gradient it
supplies is "demography -> nationalist bloc", which is dominated by the Catholic share
and is stable across the period. Note this would NOT be defensible for the SF-vs-SDLP
split inside the bloc, which realigned completely; it is only used here for the bloc
total.

DECOMPOSITION. Building the 2001 mosaic a second time with 2021 demography, raked to
the same 2001 targets, isolates the two channels:

    total change  =  political swing (same demography, different votes)
                  +  demographic change (same votes, different demography)

Outputs: nat_change_{oa2001,sa2011,dz2021}.csv, nat_change_summary.json
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DER = os.path.join(REPO, 'data', 'census', 'derived')
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
dza = _load('dz25', '25_dz_party_allocation.py')
p54 = _load('p54', '54_vintage2001_test.py')

PARTIES = pm.PARTIES
HVARS = p54.HVARS
NAT = ['Sinn Féin', 'SDLP', 'PBP', 'Aontú']
NATIX = [PARTIES.index(p) for p in NAT if p in PARTIES]
IND = {'Independent', 'Independent Other', 'Independent Unionist',
       'Independent Nationalist'}
MAIN = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP', 'Aontú']


def cat(p):
    return 'Independent' if p in IND else (p if p in MAIN else 'Other')


def observed(fn, amap=None):
    """Observed party shares by area for one contest."""
    d = json.load(open(os.path.join(META, fn), encoding='utf-8'))
    acc = {}
    for r in d['results']:
        raw = str(r['constituency']).strip()
        key = amap.get(raw) if amap else raw.upper().strip()
        if not key:
            continue
        cs = r.get('candidates') or []
        tot = sum(float(c.get('firstPrefs') or 0) for c in cs)
        if tot <= 0:
            continue
        a = acc.setdefault(key, collections.defaultdict(float))
        for c in cs:
            a[cat((c.get('party') or '').strip())] += float(c.get('firstPrefs') or 0)
        a['_tot'] += tot
    rows = {k: {p: 100.0 * v.get(p, 0.0) / v['_tot'] for p in PARTIES}
            for k, v in acc.items()}
    return pd.DataFrame(rows).T.reindex(columns=PARTIES).fillna(0.0)


def harm_2001(path, idcol):
    """The eight harmonised variables from a phase-53 census table."""
    d = pd.read_csv(os.path.join(DER, path)).set_index(idcol)
    out = pd.DataFrame(index=d.index)
    out['catholic'] = d.rc_pct
    out['protestant'] = d.protestant_pct
    out['irish_speak'] = d.irish_speak_pct
    out['owner_occ'] = d.owner_occ_pct
    out['social_rent'] = d.social_rent_pct
    out['private_rent'] = d.private_rent_pct
    out['degree'] = d.degree_pct
    out['no_religion'] = (100.0 - out.catholic - out.protestant).clip(lower=0)
    out['_pop'] = d.total_pop.astype(float)
    return out[HVARS + ['_pop']]


def rake(shares, w, groups, target, iters=4000, tol=1e-3):
    """Scale shares so each group's population-weighted mean equals `target`.

    A tightening of phase 25's rake, not a fix to it. Phase 25 clips the per-party
    ratio to [0.2, 5.0] and stops at 60 sweeps; that was checked here against the
    unclipped 4,000-sweep version and it is adequate — worst DEA residual 0.0071pp,
    and no Data Zone's bloc share moves as much as 0.03pp between the two. This
    version simply removes the clip and iterates to 0.001pp so the constraint holds to
    numerical precision rather than to a tolerance that has to be re-argued.

    Returns the raked shares and the worst remaining residual, which the caller prints
    rather than assumes.
    """
    S = shares.copy()
    maxerr = np.inf
    for _ in range(iters):
        maxerr = 0.0
        for g, idx in groups.items():
            ww = w[idx]
            if ww.sum() <= 0:
                continue
            tgt = target.loc[g].values
            cur = np.average(S[idx], axis=0, weights=ww)
            ratio = np.where(cur > 1e-12, np.maximum(tgt, 0.0) / np.maximum(cur, 1e-12), 1.0)
            S[idx] = S[idx] * ratio
            rs = S[idx].sum(axis=1, keepdims=True)
            S[idx] = 100.0 * np.divide(S[idx], rs, out=np.zeros_like(S[idx]), where=rs > 1e-12)
            maxerr = max(maxerr, np.abs(np.average(S[idx], axis=0, weights=ww) - tgt).max())
        if maxerr < tol:
            break
    return S, maxerr


def mosaic(feat, groups, target, coef, sc, ctr):
    """Ridge -> softmax -> rake to observed area totals. Returns shares (n x parties)."""
    X = sc.transform(feat[HVARS].astype(float).values)
    P = X @ coef.T + ctr
    raw = pm.inv_clr(P, np.ones_like(P, dtype=bool))
    w = feat['_pop'].fillna(0.0).values
    tgt = target.loc[[g for g in groups if g in target.index]]
    gid = {g: i for g, i in groups.items() if g in tgt.index and len(i)}
    S, err = rake(raw, w, gid, tgt.loc[list(gid)])
    return S, err


def carry(vals, pop, wfile, sid, tid):
    """Population-weighted areal transfer of a per-unit series onto `tid`."""
    w = pd.read_csv(os.path.join(DER, wfile))
    w['pw'] = w.weight * w[sid].map(pop).fillna(0.0)
    w['v'] = w[sid].map(vals)
    w = w[(w.pw > 0) & w.v.notna()]
    g = w.groupby(tid)
    return (w.pw * w.v).groupby(w[tid]).sum() / g.pw.sum(), g.pw.sum()


def main():
    print("=" * 78)
    print("PHASE 56 — SF/SDLP/PBP/Aontú bloc change 2001 -> 2024, three geographies")

    # ---------------- layer 1: what was actually observed ----------------
    print("\n" + "-" * 78)
    print("OBSERVED (the only layer that is a measurement)")
    w01 = observed('house-of-commons-of-the-united-kingdom__2001-06-07.json')
    w24 = observed('house-of-commons-of-the-united-kingdom__2024-07-04.json')
    for lab, t in [('Westminster 2001', w01), ('Westminster 2024', w24)]:
        print(f"  {lab}: {len(t)} constituencies, bloc mean {t[NAT].sum(axis=1).mean():5.2f}%")

    amap01 = json.load(open(os.path.join(HERE, 'dea_map_2001.json'), encoding='utf-8'))
    l01 = observed('local-government-local-government-districts__2001-06-07.json', amap01)
    l23 = observed('local-government-local-government-districts__2023-05-18.json')
    print(f"  local 2001: {len(l01)} DEA1993   local 2023: {len(l23)} DEA2014")

    dz_dea = json.load(open(os.path.join(HERE, 'dz_dea.json'), encoding='utf-8'))
    dea14 = sorted(set(str(v).upper().strip() for v in dz_dea.values()))
    miss = [a for a in dea14 if a not in l23.index]
    print(f"  DEA2014 matched to local-2023 results: {len(dea14)-len(miss)}/{len(dea14)}"
          + (f"  MISSING {miss[:5]}" if miss else ""))

    # ---------------- the single shared ridge fit ----------------
    dz21 = p54.harmonised(2021)
    F = p54.agg_to(dz21, {k: str(v).upper().strip() for k, v in dz_dea.items()})
    common = [a for a in F.index if a in l23.index]
    Xf = F.loc[common, HVARS].astype(float).values
    Sf = l23.loc[common, PARTIES].values
    sc = StandardScaler().fit(Xf)
    Y = pm.clr(Sf)
    ctr = Y.mean(axis=0)
    coef = np.vstack([Ridge(alpha=pm.ALPHA).fit(sc.transform(Xf),
                                                Y[:, j] - ctr[j]).coef_
                      for j in range(Y.shape[1])])
    print(f"\n  ridge fit on {len(common)} DEA2014 / local-2023 rows, {len(HVARS)} features")

    # ---------------- endpoint mosaics, each on its native geography ----------------
    oa01 = harm_2001('oa2001-census-2001.csv', 'OA_CODE')
    x = pd.read_csv(os.path.join(DER, 'oa2001_to_deas.csv')).set_index('OA_CODE')
    oa01 = oa01.loc[[i for i in oa01.index if i in x.index]]
    oadea = x.dea_1993.reindex(oa01.index).astype(str).str.upper().str.strip()
    g01 = {a: np.where(oadea.values == a)[0] for a in sorted(set(oadea))}
    g01 = {a: i for a, i in g01.items() if len(i) and a in l01.index}
    M01, e01 = mosaic(oa01, g01, l01, coef, sc, ctr)
    print(f"  2001 mosaic: {len(oa01):,} Output Areas raked to "
          f"{len(g01)} observed DEA1993 totals (native vintage, native boundaries)"
          f"  max residual {e01:.4f}pp")

    dzdea = pd.Series({i: str(dz_dea.get(i, '')).upper().strip() for i in dz21.index})
    g23 = {a: np.where(dzdea.values == a)[0] for a in sorted(set(dzdea)) if a}
    g23 = {a: i for a, i in g23.items() if len(i) and a in l23.index}
    M23, e23 = mosaic(dz21, g23, l23, coef, sc, ctr)
    print(f"  2023 mosaic: {len(dz21):,} Data Zones raked to "
          f"{len(g23)} observed DEA2014 totals  max residual {e23:.4f}pp")

    # counterfactual: 2001 votes, 2021 demography -> isolates the political channel
    dzoa = pd.read_csv(os.path.join(DER, 'dz2021_to_oa2001_crosswalk.csv'))
    dzoa = dzoa.set_index(dzoa.columns[0])[dzoa.columns[1]]
    dz_to_dea93 = dzoa.map(x.dea_1993).astype(str).str.upper().str.strip()
    lab = pd.Series({i: dz_to_dea93.get(i, '') for i in dz21.index})
    gcf = {a: np.where(lab.values == a)[0] for a in sorted(set(lab)) if a}
    gcf = {a: i for a, i in gcf.items() if len(i) and a in l01.index}
    MCF, ecf = mosaic(dz21, gcf, l01, coef, sc, ctr)
    print(f"  counterfactual: 2001 votes on 2021 demography, {len(gcf)} DEA1993 groups"
          f"  max residual {ecf:.4f}pp")

    nat01 = pd.Series(M01[:, NATIX].sum(axis=1), index=oa01.index)
    nat23 = pd.Series(M23[:, NATIX].sum(axis=1), index=dz21.index)
    natcf = pd.Series(MCF[:, NATIX].sum(axis=1), index=dz21.index)
    pop01 = oa01['_pop']
    pop23 = dz21['_pop']
    print(f"\n  bloc, population-weighted NI mean: 2001 "
          f"{np.average(nat01, weights=pop01):5.2f}%  ->  2023 "
          f"{np.average(nat23, weights=pop23):5.2f}%")

    # ---------------- carry both endpoints onto all three geographies ----------------
    names = pd.read_csv(os.path.join(DER, 'dz21-census-2001.csv'),
                        usecols=['DZ2021_cd', 'DZ2021_nm']).set_index('DZ2021_cd').DZ2021_nm
    mast = pd.read_csv(os.path.join(DER, 'oa2001_master_crosswalk.csv'))

    GEOS = [('dz2021', 'DZ2021_cd', 3780), ('sa2011', 'SA2011', 4537),
            ('oa2001', 'OA_CODE', 5022)]
    summary = {}
    for tgt, tid, n in GEOS:
        if tgt == 'oa2001':
            a = nat01
            apop = pop01
        else:
            a, apop = carry(nat01, pop01, f'oa2001_to_{tgt}_weights.csv', 'OA_CODE', tid)
        if tgt == 'dz2021':
            b = nat23
            c = natcf
        else:
            b, _ = carry(nat23, pop23, f'dz2021_to_{tgt}_weights.csv', 'DZ2021_cd', tid)
            c, _ = carry(natcf, pop23, f'dz2021_to_{tgt}_weights.csv', 'DZ2021_cd', tid)
        D = pd.DataFrame({'nat_2001': a, 'nat_2023': b, 'nat_2001_on2021demog': c,
                          'pop': apop}).dropna(subset=['nat_2001', 'nat_2023'])
        D['change'] = D.nat_2023 - D.nat_2001
        D['swing_political'] = D.nat_2023 - D.nat_2001_on2021demog
        D['swing_demographic'] = D.change - D.swing_political
        # labels
        if tgt == 'dz2021':
            D['label'] = names.reindex(D.index)
            D['dea'] = pd.Series(dz_dea).reindex(D.index).astype(str).str.upper()
        else:
            key = 'SA2011' if tgt == 'sa2011' else 'OA_CODE'
            m = mast.dropna(subset=[key]).drop_duplicates(key).set_index(key)
            D['label'] = m.DZ2021_cd.reindex(D.index).map(names)
            D['dea'] = m.dea_2012.reindex(D.index).astype(str).str.upper()
        D.index.name = tid
        D.to_csv(os.path.join(HERE, f'nat_change_{tgt}.csv'))
        w = D['pop'].fillna(0.0)
        summary[tgt] = {
            'units': int(len(D)),
            'mean_change_popwt': float(np.average(D.change, weights=w)),
            'sd_change': float(D.change.std()),
            'p10': float(D.change.quantile(.1)), 'p90': float(D.change.quantile(.9)),
            'pct_rising': float(100 * (D.change > 0).mean()),
            'political_sd': float(D.swing_political.std()),
            'demographic_sd': float(D.swing_demographic.std()),
        }
        print(f"\n  {tgt}: {len(D):,}/{n} units -> nat_change_{tgt}.csv")
        s = summary[tgt]
        print(f"    change  mean {s['mean_change_popwt']:+.2f}  sd {s['sd_change']:.2f}"
              f"  p10 {s['p10']:+.1f}  p90 {s['p90']:+.1f}"
              f"  rising {s['pct_rising']:.0f}%")
        print(f"    channel sd: political {s['political_sd']:.2f}  "
              f"demographic {s['demographic_sd']:.2f}")

    # ---------------- the answer ----------------
    for tgt, tid, _ in GEOS:
        D = pd.read_csv(os.path.join(HERE, f'nat_change_{tgt}.csv')).set_index(tid)
        D = D[D['pop'] > 50]
        top = D.sort_values('change', ascending=False).head(15)
        print("\n" + "-" * 78)
        print(f"TOP 15 {tgt} by bloc increase 2001->2023")
        print(f"    {'unit':11} {'label':22} {'DEA':20} {'2001':>6} {'2023':>6} {'chg':>7}")
        for i, r in top.iterrows():
            print(f"    {str(i)[:11]:11} {str(r.label)[:22]:22} {str(r.dea)[:20]:20} "
                  f"{r.nat_2001:6.1f} {r.nat_2023:6.1f} {r.change:+7.1f}")

    # ---------------- is the growth in nationalist areas or unionist ones? ----------
    D = pd.read_csv(os.path.join(HERE, 'nat_change_dz2021.csv')).set_index('DZ2021_cd')
    c01 = pd.read_csv(os.path.join(DER, 'dz21-census-2001.csv')).set_index('DZ2021_cd')
    D['cath_2001'] = c01.rc_pct.reindex(D.index)
    D['cath_2021'] = dz21.catholic.reindex(D.index)
    D['d_cath'] = D.cath_2021 - D.cath_2001
    print("\n" + "-" * 78)
    print("WHERE the change lands, by 2001 starting level (Data Zones, decile of nat_2001)")
    D['dec'] = pd.qcut(D.nat_2001, 10, labels=False, duplicates='drop')
    t = D.groupby('dec').agg(nat_2001=('nat_2001', 'mean'), nat_2023=('nat_2023', 'mean'),
                             change=('change', 'mean'), pol=('swing_political', 'mean'),
                             dem=('swing_demographic', 'mean'),
                             dcath=('d_cath', 'mean'), n=('change', 'size'))
    print(f"    {'decile':7} {'2001':>7} {'2023':>7} {'change':>8} {'political':>10}"
          f" {'demog':>7} {'dCath':>7}")
    for i, r in t.iterrows():
        print(f"    {int(i)+1:<7} {r.nat_2001:7.1f} {r.nat_2023:7.1f} {r.change:+8.1f} "
              f"{r.pol:+10.1f} {r.dem:+7.1f} {r.dcath:+7.1f}")
    rr = np.corrcoef(D.nat_2001, D.change)[0, 1]
    print(f"    corr(2001 level, change) = {rr:+.3f}   "
          f"corr(change, change in Catholic share) = "
          f"{np.corrcoef(D.change, D.d_cath.fillna(0))[0,1]:+.3f}")
    summary['convergence'] = {'corr_level_change': float(rr),
                              'corr_change_dcath': float(np.corrcoef(
                                  D.change, D.d_cath.fillna(0))[0, 1])}

    print("\n  LARGEST DECREASES, Data Zones:")
    for i, r in D[D['pop'] > 50].sort_values('change').head(10).iterrows():
        print(f"    {str(r.label)[:22]:22} {str(r.dea)[:20]:20} "
              f"{r.nat_2001:6.1f} -> {r.nat_2023:6.1f}  {r.change:+6.1f}")

    # DEA-level observed comparison, for the layer that is real
    print("\n" + "-" * 78)
    print("OBSERVED DEA-level change (local 2001 on DEA1993 -> local 2023 on DEA2014,")
    print("via the phase-47 notional; 80 comparable areas)")
    nt = pd.read_csv(os.path.join(HERE, 'notional', 'local2001__onDEA2014.csv'),
                     index_col=0)
    both = [a for a in nt.index if a in l23.index]
    ch = (l23.loc[both, NAT].sum(axis=1) - nt.loc[both, NAT].sum(axis=1)).sort_values()
    print(f"  {len(both)} DEAs;  mean {ch.mean():+.2f}  sd {ch.std():.2f}")
    print("  largest INCREASES:")
    for a, v in ch.tail(10)[::-1].items():
        print(f"    {a[:26]:26} {nt.loc[a, NAT].sum():5.1f} -> "
              f"{l23.loc[a, NAT].sum():5.1f}  {v:+6.1f}")
    print("  largest DECREASES:")
    for a, v in ch.head(6).items():
        print(f"    {a[:26]:26} {nt.loc[a, NAT].sum():5.1f} -> "
              f"{l23.loc[a, NAT].sum():5.1f}  {v:+6.1f}")
    summary['observed_dea'] = {'n': len(both), 'mean': float(ch.mean()),
                               'sd': float(ch.std()),
                               'top': {a: float(v) for a, v in ch.tail(10).items()},
                               'bottom': {a: float(v) for a, v in ch.head(10).items()}}
    json.dump(summary, open(os.path.join(HERE, 'nat_change_summary.json'), 'w'),
              indent=1)
    print("\n  wrote nat_change_summary.json")


if __name__ == '__main__':
    main()
