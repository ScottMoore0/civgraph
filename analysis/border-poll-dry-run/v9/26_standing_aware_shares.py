#!/usr/bin/env python3
"""v9 phase 26 — standing-aware shares: redistribute an absent party's vote by
AFFINITY rather than proportionally.

The problem. Phase 17 already knows which parties stood: the softmax is masked to
present parties. But masking a CLR score and renormalising spreads the absent
party's vote across the survivors *in proportion to their own predicted size*. That
is the wrong physics. When Sinn Féin stands aside in Belfast South (2019), its vote
does not spread proportionally over DUP/UUP/SDLP/Alliance — it goes overwhelmingly
to the SDLP. Proportional renormalisation handed too much to Alliance and the model
called the seat for Alliance when the SDLP won it by 32.5 points.

The fix. Predict shares as if every party stood, then reallocate each absent
party's predicted mass to the parties that ARE standing using empirical affinity
weights — the party-to-party transfer matrix estimated in phase 18 from real STV
counts, which is precisely a measurement of where a party's voters go when their
first choice is unavailable. Non-transferable fractions are dropped and the
remainder renormalised, so a stand-aside also depresses turnout-share slightly, as
it does in reality.

This matters most for Westminster, where pacts and stand-asides are common and
decide seats, but the correction is applied at the share level so it is available
to every contest type.

Compared here:
  A  proportional  current behaviour: mask + renormalise (phase 17)
  B  affinity      reallocate absent mass via the transfer matrix
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
PARTIES = pm.PARTIES

TM = json.load(open(os.path.join(HERE, 'transfer_matrix.json'), encoding='utf-8'))
MATRIX, NONTRANS, BLOCM = TM['matrix'], TM['nontransferable'], TM['bloc_matrix']
NAT = {'Sinn Féin', 'SDLP', 'Aontú'}
UNI = {'DUP', 'UUP', 'TUV'}


def bloc(p):
    return 'NAT' if p in NAT else ('UNI' if p in UNI else 'OTH')


def affinity(src, present):
    """Where src's vote goes among `present`, from the empirical transfer matrix."""
    row = MATRIX.get(src)
    if not row:
        b = BLOCM.get(bloc(src), {})
        row = {p: b.get(bloc(p), 0.0) for p in present}
    w = {p: row.get(p, 0.0) for p in present}
    tot = sum(w.values())
    if tot <= 0:
        # no measured affinity: fall back to bloc, then to proportional
        b = BLOCM.get(bloc(src), {})
        w = {p: b.get(bloc(p), 0.0) for p in present}
        tot = sum(w.values())
        if tot <= 0:
            return {p: 1.0 / len(present) for p in present} if present else {}
    return {p: v / tot for p, v in w.items()}


def redistribute(unrestricted, stood):
    """Affinity reallocation of absent parties' predicted vote. Rows sum to 100."""
    out = np.zeros_like(unrestricted)
    for i in range(unrestricted.shape[0]):
        present = [p for j, p in enumerate(PARTIES) if stood[i, j]]
        if not present:
            continue
        base = {p: unrestricted[i, j] for j, p in enumerate(PARTIES) if stood[i, j]}
        for j, p in enumerate(PARTIES):
            if stood[i, j]:
                continue
            mass = unrestricted[i, j]
            if mass <= 0:
                continue
            keep = 1.0 - float(NONTRANS.get(p, 0.15))
            for q, frac in affinity(p, present).items():
                base[q] += mass * keep * frac
        tot = sum(base.values())
        for j, p in enumerate(PARTIES):
            out[i, j] = 100.0 * base.get(p, 0.0) / tot if tot > 0 else 0.0
    return out


def standing_features(stood):
    """Describe the COMPETITIVE FIELD each party faces.

    Rather than imposing where an absent party's vote goes (method B, which the
    transfer matrix gets wrong because lower-preference behaviour is not the same
    as stand-aside behaviour), give the model the field itself and let it learn the
    response from data: which parties are standing, and how many rivals each bloc
    is running. A party facing no bloc rival absorbs that space; the size of the
    effect is estimated, not assumed.
    """
    n = stood.shape[0]
    uni = [PARTIES.index(p) for p in ['DUP', 'UUP', 'TUV']]
    nat = [PARTIES.index(p) for p in ['Sinn Féin', 'SDLP', 'Aontú']]
    oth = [i for i in range(len(PARTIES)) if i not in uni + nat]
    F = [stood.astype(float)]
    F.append(stood[:, uni].sum(axis=1, keepdims=True).astype(float))
    F.append(stood[:, nat].sum(axis=1, keepdims=True).astype(float))
    F.append(stood[:, oth].sum(axis=1, keepdims=True).astype(float))
    F.append(stood.sum(axis=1, keepdims=True).astype(float))
    return np.hstack(F)


def main():
    S, stood, X, meta, feats = pm.build('constituency')
    groups = meta.council.values
    # A — current: mask + proportional renormalisation
    A = pm.cv_share(S, stood, X, meta, groups)
    # B — unrestricted prediction, then affinity reallocation
    allmask = np.ones_like(stood, dtype=bool)
    U = pm.cv_share(S, stood, X, meta, groups, use_true_presence=False,
                    pres_pred=allmask)
    B = redistribute(U, stood)
    # C — give the model the competitive field as FEATURES and let it learn
    Xc = np.hstack([X, standing_features(stood)])
    C = pm.cv_share(S, stood, Xc, meta, groups)

    rows = []
    for i, m in enumerate(meta.itertuples()):
        act = dict(zip(PARTIES, S[i]))
        aw = max(act, key=act.get)
        for lab, P in [('A_proportional', A), ('B_affinity', B),
                       ('C_field_features', C)]:
            prd = dict(zip(PARTIES, P[i]))
            pw = max(prd, key=prd.get)
            rows.append({'contest': m.contest, 'year': m.year, 'area': m.area,
                         'method': lab, 'actual': aw, 'pred': pw,
                         'correct': int(aw == pw),
                         'tvd': 0.5 * np.abs(P[i] - S[i]).sum()})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, 'standing_aware_report.csv'), index=False)

    print("\n" + "=" * 70)
    print("STANDING-AWARE SHARES — absent parties reallocated by affinity")
    for scope, sub in [('WESTMINSTER (FPTP seats)', df[df.contest == 'westminster']),
                       ('ASSEMBLY (share quality)', df[df.contest == 'assembly'])]:
        print(f"\n  {scope}")
        print(f"    {'method':16} {'winner acc':>11} {'share TVD':>10}")
        for meth, g in sub.groupby('method'):
            print(f"    {meth:16} {100*g.correct.mean():10.1f}% {g.tvd.median():9.2f}")
    print("\n  Westminster winner accuracy by year:")
    w = df[df.contest == 'westminster']
    print(f"    {'year':6} {'A prop':>8} {'B affin':>9} {'C field':>9}")
    for y, g in w.groupby('year'):
        a = g[g.method == 'A_proportional'].correct.mean()
        b = g[g.method == 'B_affinity'].correct.mean()
        c = g[g.method == 'C_field_features'].correct.mean()
        print(f"    {y:<6} {100*a:7.1f}% {100*b:8.1f}% {100*c:8.1f}%")

    print("\n  seats changed by the field-feature model (A -> C):")
    piv = w.pivot_table(index=['year', 'area', 'actual'], columns='method',
                        values='pred', aggfunc='first')
    ch = piv[piv.A_proportional != piv.C_field_features]
    for (y, area, act), r in ch.iterrows():
        tag = "FIXED" if r.C_field_features == act else (
            "broke" if r.A_proportional == act else "changed")
        print(f"    {y} {area:30} actual {act:12} "
              f"A={r.A_proportional:12} C={r.C_field_features:12} [{tag}]")


if __name__ == '__main__':
    main()
