#!/usr/bin/env python3
"""v9 phase 57 — is the phase-56 answer an artefact of the independent vote?

Phase 56 ranked areas by the change in SF/SDLP/PBP/Aontú share of the VALID vote.
Inspecting the top movers shows that measure is contaminated, badly, at exactly the
places it ranks highest:

    THE GLENS   2001 Independent 48.8%  ->  2023 0.0%   (bloc 42.8 -> 70.6)
    MACEDON     2001 Independent 43.2%  ->  2023 6.8%   (bloc  4.8 -> 18.6)
    CROTLIEVE   2001 Independent 14.0%  ->  2023 22.8%  (bloc 76.3 -> 63.4)
    THE MOOR    2001 Independent  4.0%  ->  2023 25.3%  (bloc 94.8 -> 72.8)

NI-wide the Independent+Other share fell from 10.3% to 5.4% between the two local
contests. In a heavily Catholic DEA a nationalist-leaning independent standing in 2001
and not in 2023 shows up as bloc GROWTH with no voter having changed their mind; in
Derry, Gary Donnelly's 25% in The Moor in 2023 shows up as bloc COLLAPSE for the same
non-reason. Both directions of the phase-56 ranking are affected.

Fix: measure the bloc as a share of the PARTY-LABELLED vote, i.e. drop Independent and
Other from the denominator at both endpoints. That asks "of the voters who chose a
party, what fraction chose a nationalist one", which is invariant to whether an
independent stood. It is not a perfect fix — it silently reassigns independents in
proportion to the party vote around them — but it is the right direction and the gap
between the two measures bounds how much the independent vote is doing.

Everything else (geographies, census vintages, ridge fit, rake) is phase 56's, so any
difference is attributable to the measure alone.
"""
import os, sys, json, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


p56 = _load('p56', '56_nationalist_change_2001_2024.py')
pm, p54 = sys.modules['pm17'], sys.modules['p54']
DER, PARTIES, HVARS, NAT = p56.DER, p56.PARTIES, p56.HVARS, p56.NAT
NATIX = p56.NATIX
DROP = ['Independent', 'Other']


def reweight(t):
    """Renormalise each area's shares over the party-labelled vote only."""
    keep = [p for p in PARTIES if p not in DROP]
    s = t[keep].sum(axis=1)
    out = t.copy()
    out[keep] = 100.0 * t[keep].div(s.where(s > 0), axis=0)
    out[DROP] = 0.0
    return out.fillna(0.0)


def main():
    print("=" * 78)
    print("PHASE 57 — bloc change measured on the party-labelled vote only")

    amap = json.load(open(os.path.join(HERE, 'dea_map_2001.json'), encoding='utf-8'))
    l01 = p56.observed('local-government-local-government-districts__2001-06-07.json', amap)
    l23 = p56.observed('local-government-local-government-districts__2023-05-18.json')
    print(f"\n  NI-wide Independent+Other, mean over areas: "
          f"2001 {l01[DROP].sum(axis=1).mean():.2f}%  ->  "
          f"2023 {l23[DROP].sum(axis=1).mean():.2f}%")

    # ---------------- observed DEA layer, both measures ----------------
    nt = pd.read_csv(os.path.join(HERE, 'notional', 'local2001__onDEA2014.csv'),
                     index_col=0)
    both = [a for a in nt.index if a in l23.index]
    valid = (l23.loc[both, NAT].sum(axis=1) - nt.loc[both, NAT].sum(axis=1))
    party = (reweight(l23).loc[both, NAT].sum(axis=1)
             - reweight(nt).loc[both, NAT].sum(axis=1))
    dind = (l23.loc[both, DROP].sum(axis=1) - nt.loc[both, DROP].sum(axis=1))
    print(f"  observed DEA change: valid-vote mean {valid.mean():+.2f} sd {valid.std():.2f}"
          f" | party-vote mean {party.mean():+.2f} sd {party.std():.2f}")
    print(f"  corr(valid-vote change, change in Independent share) = "
          f"{np.corrcoef(valid, dind)[0,1]:+.3f}")
    print(f"  corr(party-vote change, change in Independent share) = "
          f"{np.corrcoef(party, dind)[0,1]:+.3f}")
    print(f"  rank correlation between the two measures = "
          f"{pd.Series(valid).corr(pd.Series(party), method='spearman'):+.3f}")

    print(f"\n  {'DEA':24} {'valid':>8} {'party':>8} {'dInd':>7}   how much was independents")
    show = valid.abs().sort_values(ascending=False).head(12).index
    for a in show:
        gap = valid[a] - party[a]
        print(f"  {a[:24]:24} {valid[a]:+8.1f} {party[a]:+8.1f} {dind[a]:+7.1f}"
              f"   {gap:+6.1f}pp of the valid-vote figure")

    print("\n  TOP 12 DEAs by bloc growth, party-labelled measure:")
    for a, v in party.sort_values(ascending=False).head(12).items():
        print(f"    {a[:26]:26} {reweight(nt).loc[a, NAT].sum():5.1f} -> "
              f"{reweight(l23).loc[a, NAT].sum():5.1f}  {v:+6.1f}"
              f"   (valid-vote measure {valid[a]:+.1f})")
    print("\n  BOTTOM 8:")
    for a, v in party.sort_values().head(8).items():
        print(f"    {a[:26]:26} {reweight(nt).loc[a, NAT].sum():5.1f} -> "
              f"{reweight(l23).loc[a, NAT].sum():5.1f}  {v:+6.1f}"
              f"   (valid-vote measure {valid[a]:+.1f})")

    # ---------------- rebuild the small-area mosaics on the party measure ----------
    R01, R23 = reweight(l01), reweight(l23)
    dz_dea = json.load(open(os.path.join(HERE, 'dz_dea.json'), encoding='utf-8'))
    dz21 = p54.harmonised(2021)
    F = p54.agg_to(dz21, {k: str(v).upper().strip() for k, v in dz_dea.items()})
    common = [a for a in F.index if a in R23.index]
    Xf = F.loc[common, HVARS].astype(float).values
    Sf = R23.loc[common, PARTIES].values
    sc = StandardScaler().fit(Xf)
    Y = pm.clr(Sf)
    ctr = Y.mean(axis=0)
    coef = np.vstack([Ridge(alpha=pm.ALPHA).fit(sc.transform(Xf), Y[:, j] - ctr[j]).coef_
                      for j in range(Y.shape[1])])

    oa01 = p56.harm_2001('oa2001-census-2001.csv', 'OA_CODE')
    x = pd.read_csv(os.path.join(DER, 'oa2001_to_deas.csv')).set_index('OA_CODE')
    oa01 = oa01.loc[[i for i in oa01.index if i in x.index]]
    oadea = x.dea_1993.reindex(oa01.index).astype(str).str.upper().str.strip()
    g01 = {a: np.where(oadea.values == a)[0] for a in sorted(set(oadea))}
    g01 = {a: i for a, i in g01.items() if len(i) and a in R01.index}
    M01, e1 = p56.mosaic(oa01, g01, R01, coef, sc, ctr)

    dzdea = pd.Series({i: str(dz_dea.get(i, '')).upper().strip() for i in dz21.index})
    g23 = {a: np.where(dzdea.values == a)[0] for a in sorted(set(dzdea)) if a}
    g23 = {a: i for a, i in g23.items() if len(i) and a in R23.index}
    M23, e2 = p56.mosaic(dz21, g23, R23, coef, sc, ctr)
    print(f"\n  mosaics rebuilt: max rake residual {max(e1, e2):.4f}pp")

    nat01 = pd.Series(M01[:, NATIX].sum(axis=1), index=oa01.index)
    nat23 = pd.Series(M23[:, NATIX].sum(axis=1), index=dz21.index)
    names = pd.read_csv(os.path.join(DER, 'dz21-census-2001.csv'),
                        usecols=['DZ2021_cd', 'DZ2021_nm']).set_index('DZ2021_cd').DZ2021_nm
    mast = pd.read_csv(os.path.join(DER, 'oa2001_master_crosswalk.csv'))
    c01 = pd.read_csv(os.path.join(DER, 'dz21-census-2001.csv')).set_index('DZ2021_cd')

    summary = {}
    for tgt, tid in [('dz2021', 'DZ2021_cd'), ('sa2011', 'SA2011'), ('oa2001', 'OA_CODE')]:
        if tgt == 'oa2001':
            a, apop = nat01, oa01['_pop']
        else:
            a, apop = p56.carry(nat01, oa01['_pop'],
                                f'oa2001_to_{tgt}_weights.csv', 'OA_CODE', tid)
        if tgt == 'dz2021':
            b = nat23
        else:
            b, _ = p56.carry(nat23, dz21['_pop'],
                             f'dz2021_to_{tgt}_weights.csv', 'DZ2021_cd', tid)
        D = pd.DataFrame({'nat_2001': a, 'nat_2023': b, 'pop': apop}).dropna(
            subset=['nat_2001', 'nat_2023'])
        D['change'] = D.nat_2023 - D.nat_2001
        if tgt == 'dz2021':
            D['label'] = names.reindex(D.index)
            D['dea'] = pd.Series(dz_dea).reindex(D.index).astype(str).str.upper()
        else:
            key = 'SA2011' if tgt == 'sa2011' else 'OA_CODE'
            m = mast.dropna(subset=[key]).drop_duplicates(key).set_index(key)
            D['label'] = m.DZ2021_cd.reindex(D.index).map(names)
            D['dea'] = m.dea_2012.reindex(D.index).astype(str).str.upper()
        D.index.name = tid
        D.to_csv(os.path.join(HERE, f'nat_change_{tgt}_partyvote.csv'))
        w = D['pop'].fillna(0.0)
        old = pd.read_csv(os.path.join(HERE, f'nat_change_{tgt}.csv')).set_index(tid)
        sp = D.change.corr(old.change.reindex(D.index), method='spearman')
        summary[tgt] = {'units': int(len(D)),
                        'mean': float(np.average(D.change, weights=w)),
                        'sd': float(D.change.std()),
                        'rising': float(100 * (D.change > 0).mean()),
                        'spearman_vs_validvote': float(sp)}
        print(f"\n  {tgt}: {len(D):,} units  mean {summary[tgt]['mean']:+.2f}  "
              f"sd {summary[tgt]['sd']:.2f}  rising {summary[tgt]['rising']:.0f}%  "
              f"rank-corr vs phase 56 {sp:+.3f}")
        top = D[D['pop'] > 50].sort_values('change', ascending=False).head(12)
        print(f"    {'label':22} {'DEA':20} {'2001':>6} {'2023':>6} {'chg':>7}")
        for i, r in top.iterrows():
            print(f"    {str(r.label)[:22]:22} {str(r.dea)[:20]:20} "
                  f"{r.nat_2001:6.1f} {r.nat_2023:6.1f} {r.change:+7.1f}")

    D = pd.read_csv(os.path.join(HERE, 'nat_change_dz2021_partyvote.csv')).set_index('DZ2021_cd')
    D['cath_2001'] = c01.rc_pct.reindex(D.index)
    print("\n" + "-" * 78)
    print("Convergence check on the party-labelled measure (Data Zones, bins of nat_2001)")
    D['dec'] = pd.qcut(D.nat_2001, 10, labels=False, duplicates='drop')
    t = D.groupby('dec').agg(a=('nat_2001', 'mean'), b=('nat_2023', 'mean'),
                             c=('change', 'mean'), n=('change', 'size'))
    for i, r in t.iterrows():
        print(f"    bin {int(i)+1:<2} {r.a:6.1f} -> {r.b:6.1f}   {r.c:+6.1f}   n={int(r.n)}")
    print(f"    corr(2001 level, change) = {np.corrcoef(D.nat_2001, D.change)[0,1]:+.3f}")
    summary['observed_dea'] = {
        'party_top': {a: float(v) for a, v in party.sort_values(ascending=False).head(12).items()},
        'party_bottom': {a: float(v) for a, v in party.sort_values().head(8).items()},
        'corr_valid_dind': float(np.corrcoef(valid, dind)[0, 1]),
        'corr_party_dind': float(np.corrcoef(party, dind)[0, 1])}
    json.dump(summary, open(os.path.join(HERE, 'nat_change_robustness.json'), 'w'), indent=1)
    print("\n  wrote nat_change_robustness.json")


if __name__ == '__main__':
    main()
