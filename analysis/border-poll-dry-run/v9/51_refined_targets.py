#!/usr/bin/env python3
"""v9 phase 51 — the refinement: rank WITHIN the target group by constitutional position.

Phase 50 applied one average switching rate per party, so every Alliance voter looked
equally movable. They are not. LucidTalk's VI question is also crossed by
ConstitutionalBloc, and the gradient is enormous -- pro-unity voting intention by
constitutional position runs from 97.7% to 0.7%, a 140-fold range:

    Strongly Nationalist          93.5 - 97.7%   pro-unity VI
    Nationalist / Slightly Nat    73.0 - 94.1%
    Constitutionally Neutral      10.1 - 25.7%     (61% of these vote Alliance)
    Mildly Unionist                2.2 -  4.4%     (28% of these vote Alliance)
    Strongly Unionist              0.7 -  2.5%

The consequence for targeting: an Alliance voter who is Constitutionally Neutral and
an Alliance voter who is Mildly Unionist are completely different propositions, and
phase 50 treated them identically.

Method
  1. harmonise the bloc labels (they vary across polls) onto a 5-point scale
  2. P(position | current party) from the same crosstab
  3. per-cell switching propensity: use each position's pro-unity VI rate as the
     RELATIVE propensity, rescaled so the party-weighted average reproduces that
     party's observed rate from the phase-48 switching matrix. That keeps the
     refinement anchored to measured behaviour rather than inventing levels.
  4. per Data Zone, estimate the position mix from census national identity, and
     re-rank the phase-50 target zones on refined yield.
"""
import os, sys, csv, io, glob, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


s48 = _load('s48', '48_softness.py')
BLOC = ['Sinn Féin', 'SDLP', 'PBP', 'Aontú']
SCALE = ['StrongNat', 'Nationalist', 'Neutral', 'MildUni', 'StrongUni']


def position(label):
    t = (label or '').upper().replace('/', ' ').replace('-', ' ')
    t = ' '.join(t.split())
    if 'STRONGLY NATIONALIST' in t or 'STRONGLY IRISH' in t:
        return 'StrongNat'
    if 'NATIONALIST' in t or 'REPUBLICAN' in t:
        return 'Nationalist'
    if 'NEUTRAL' in t:
        return 'Neutral'
    if 'STRONGLY UNIONIST' in t:
        return 'StrongUni'
    if 'UNIONIST' in t:
        return 'MildUni'
    return None


def crosstab():
    """counts[(position, party)] from the VI x ConstitutionalBloc crosstab."""
    num = collections.defaultdict(float)
    for f in sorted(glob.glob(os.path.join(HERE, '_lt_cache', '*.csv'))):
        rows = list(csv.DictReader(io.StringIO(open(f, encoding='utf-8').read())))
        meas = [x for x in {r['Measure'] for r in rows}
                if 'held tomorrow' in x.lower() and 'assembly' in x.lower()]
        if not meas:
            continue
        mm = sorted(meas, key=len)[0]
        for r in rows:
            if (r['Measure'] != mm or r['Breakdown Dimension'] != 'ConstitutionalBloc'
                    or r['Statistic'] != 'count'):
                continue
            pos = position(r['Breakdown Category'])
            if not pos:
                continue
            p = s48.canon_resp(r.get('Response Label') or r.get('Response'))
            try:
                num[(pos, p)] += float(r['Value'])
            except (TypeError, ValueError):
                pass
    return num


def main():
    num = crosstab()
    M = json.load(open(os.path.join(HERE, 'switching_matrix.json'), encoding='utf-8'))
    print("=" * 80)
    print("REFINEMENT — ranking within the target group by constitutional position")

    print(f"\n  {'position':14} {'n':>7} {'pro-unity VI':>13} {'Alliance':>9} {'DUP':>7}")
    purate = {}
    for pos in SCALE:
        t = sum(v for (p, _), v in num.items() if p == pos)
        if t < 50:
            continue
        pu = sum(v for (p, q), v in num.items() if p == pos and q in BLOC)
        al = sum(v for (p, q), v in num.items() if p == pos and q == 'Alliance')
        du = sum(v for (p, q), v in num.items() if p == pos and q == 'DUP')
        purate[pos] = pu / t
        print(f"  {pos:14} {t:7.0f} {100*pu/t:12.1f}% {100*al/t:8.1f}% {100*du/t:6.1f}%")

    # P(position | current party)
    print("\n  composition of each party's vote, by constitutional position:")
    print(f"  {'party':12}" + ''.join(f"{s:>12}" for s in SCALE))
    comp = {}
    for party in ['Alliance', 'Green', 'DUP', 'UUP']:
        tot = sum(v for (_, q), v in num.items() if q == party)
        if tot <= 0:
            continue
        comp[party] = {pos: sum(v for (p, q), v in num.items()
                                if p == pos and q == party) / tot for pos in SCALE}
        print(f"  {party:12}" + ''.join(f"{100*comp[party][s]:11.1f}%" for s in SCALE))

    # calibrated per-cell propensity: relative to each position's pro-unity rate,
    # rescaled so the party-weighted mean equals the observed party switch rate
    print("\n  CALIBRATED switch propensity per (party x position):")
    print(f"  {'party':12} {'party avg':>10}" + ''.join(f"{s:>12}" for s in SCALE))
    prop = {}
    for party in ['Alliance', 'Green']:
        pavg = sum(M.get(party, {}).get(b, 0) for b in BLOC)
        rel = {s: purate.get(s, 0.0) for s in SCALE}
        denom = sum(comp[party][s] * rel[s] for s in SCALE)
        k = pavg / denom if denom > 0 else 0
        prop[party] = {s: min(k * rel[s], 1.0) for s in SCALE}
        print(f"  {party:12} {100*pavg:9.1f}%"
              + ''.join(f"{100*prop[party][s]:11.1f}%" for s in SCALE))

    # ---- re-rank the phase-50 target Data Zones ----
    T = pd.read_csv(os.path.join(HERE, 'target_voters_dz.csv'))
    cens = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')
    # DZ constitutional mix, proxied by census national identity: Irish-only maps to
    # the nationalist end, British-only to the unionist end, Northern-Irish-only and
    # the mixed categories to the neutral middle. Stated as an assumption -- the
    # poll's own bloc question is not published below NI level.
    ir = cens.get('natid__Irish only', pd.Series(0, index=cens.index))
    br = cens.get('natid__British only', pd.Series(0, index=cens.index))
    ni = cens.get('natid__Northern Irish only', pd.Series(0, index=cens.index))
    tilt = ((ir - br) / (ir + br + ni).replace(0, np.nan)).fillna(0)
    T['tilt'] = T.dz.map(tilt)

    # a zone tilted nationalist has more of its Alliance/Green vote in the soft
    # (Neutral / Nationalist) positions; tilt shifts weight along the scale
    def refined_rate(party, t):
        w = np.array([comp[party][s] for s in SCALE], dtype=float)
        shift = np.array([1 + 2 * t, 1 + t, 1.0, 1 - t, 1 - 2 * t])
        w = np.clip(w * shift, 0, None)
        w = w / w.sum() if w.sum() > 0 else w
        return float(sum(w[i] * prop[party][s] for i, s in enumerate(SCALE)))

    T['p_alli'] = [refined_rate('Alliance', t) for t in T.tilt]
    T['p_green'] = [refined_rate('Green', t) for t in T.tilt]
    P_NV = sum(M.get('DidNotVote', {}).get(b, 0) for b in BLOC)
    T['yield_flat'] = T.gap_yield
    T['yield_refined'] = (2 * T.green * T.p_green + 2 * T.alliance * T.p_alli
                          + T.nonvoter * P_NV)
    T = T.sort_values('yield_refined', ascending=False).reset_index(drop=True)
    T.to_csv(os.path.join(HERE, 'target_voters_refined.csv'), index=False)

    print(f"\n  RE-RANKED {len(T)} target Data Zones")
    print(f"    total yield  flat {T.yield_flat.sum():,.0f}  ->  "
          f"refined {T.yield_refined.sum():,.0f}")
    r = T.yield_refined / T.yield_flat.replace(0, np.nan)
    print(f"    per-DZ refined/flat ratio: p10 {r.quantile(.1):.2f}  "
          f"median {r.median():.2f}  p90 {r.quantile(.9):.2f}")
    print(f"\n  TOP 10 Data Zones by REFINED yield:")
    print(f"    {'DZ':12} {'constituency':22} {'tilt':>6} {'p(Alli)':>8} "
          f"{'flat':>7} {'refined':>8}")
    for _, x in T.head(10).iterrows():
        print(f"    {x.dz:12} {x.con[:22]:22} {x.tilt:+6.2f} {100*x.p_alli:7.1f}% "
              f"{x.yield_flat:7.0f} {x.yield_refined:8.0f}")
    moved = set(T.head(50).dz) ^ set(T.nlargest(50, 'yield_flat').dz)
    print(f"\n    Data Zones entering/leaving the top 50 after refinement: {len(moved)}")

    print("\n  PRIORITY ORDER of voter segments (highest calibrated propensity first):")
    seg = []
    for party in ['Alliance', 'Green']:
        for s in SCALE:
            seg.append((f'{party}, {s}', prop[party][s], comp[party][s]))
    seg.append(('2022 non-voter (all)', P_NV, 1.0))
    for lab, p, share in sorted(seg, key=lambda r: -r[1])[:8]:
        print(f"    {lab:28} propensity {100*p:5.1f}%   "
              f"({100*share:4.1f}% of that party's vote)")


if __name__ == '__main__':
    main()
