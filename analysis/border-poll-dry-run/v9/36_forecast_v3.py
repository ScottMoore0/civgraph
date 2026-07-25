#!/usr/bin/env python3
"""v9 phase 36 — forecaster v3: every validated gain finally connected.

Phases 32, 33 and 34 each measured a real gain and each stayed a standalone
evaluation, so none of them reached a seat number. This connects all three, plus the
defector-aware persistence that phase 32's one miss pointed at.

    LEVEL        calibrated LucidTalk party VI            (28)
    SHAPE        census ridge + competitive field         (17, 26)
    PERSISTENCE  same-contest-type, notional-bridged      (32, 33)  NEW
                 + defector-aware: a person's prior vote follows the PERSON
                   out of their old party                 (34)      NEW
    BLEND        per-party census/persistence, BOTH scales (33)     NEW at constituency
    INDEPENDENTS candidate-level shares from history      (34)      NEW
    SEATS        nominations -> PR-STV count              (21, 19)

Defector-aware persistence, and why it matters. Phase 32's single notional miss was
North Down: actual Independent (Alex Easton), notional said DUP, because it carried
his 2017/2019 vote under the label he then held. Persistence should follow the
PERSON. Where someone stood under party A at the source contest and party B at the
target, their source vote is relabelled A -> B before persistence is formed.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd

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
bl = _load('bl29', '29_blend_census_persistence.py')
p33 = _load('p33', '33_persistence_v2.py')
fc = _load('fc31', '31_forecast.py')
stv = _load('stv19', '19_stv_simulator.py')
ind34 = _load('ind34', '34_independents.py')
PARTIES = pm.PARTIES
IND_LABELS = ind34.IND


# ---------------------------------------------------------------- defectors --
def person_moves():
    """(pid) -> {contest_year: (area, party, share)} across all NI contests."""
    df = ind34.load()
    out = collections.defaultdict(dict)
    for r in df.itertuples():
        cyk = f"{r.contest}{r.year}"
        out[r.pid][cyk] = (r.area, r.party, r.share)
    return out


def defector_adjustment(source_cy, target_cy, moves, areas_src):
    """Per source area, share to move from the old party to the new one."""
    adj = collections.defaultdict(lambda: collections.Counter())
    n = 0
    for pid, hist in moves.items():
        if source_cy not in hist or target_cy not in hist:
            continue
        sa, sp, sh = hist[source_cy]
        ta, tp, _ = hist[target_cy]
        if sp == tp or sh <= 0:
            continue
        sp_c = 'Independent' if sp in IND_LABELS else sp
        tp_c = 'Independent' if tp in IND_LABELS else tp
        if sp_c == tp_c or sp_c not in PARTIES or tp_c not in PARTIES:
            continue
        adj[sa][sp_c] -= sh
        adj[sa][tp_c] += sh
        n += 1
    return adj, n


# ------------------------------------------------------------------ predict --
def predict(scale, use_poll=True, blend=True, defector=True, independents=True):
    S, stood, X, meta, feats = pm.build(scale)
    cy = meta.contest_year.values
    contests = sorted(set(cy))
    moves = person_moves() if defector else {}
    P = np.zeros_like(S)
    for c in contests:
        sel = cy == c
        C = bl.census_loco(S, stood, X, meta, c)
        if use_poll:
            pv = fc.calibrated_poll(c)
            if pv is not None:
                cur = np.average(C[sel], axis=0, weights=meta.valid_poll.values[sel])
                tgt = np.array([pv[p] for p in PARTIES])
                C = C.copy()
                C[sel] = bl.renorm(C[sel] * np.where(cur > 1e-6,
                                                     tgt / np.maximum(cur, 1e-6), 1.0))
        pred = C[sel]
        if blend:
            Pp, srcs = p33.persistence_v2(scale, S, stood, meta, c)
            Pv = Pp.values.copy()
            if defector and srcs:
                areas = list(Pp.index)
                aidx = {a: i for i, a in enumerate(areas)}
                tot = 0
                for s in srcs:
                    adj, n = defector_adjustment(s, c, moves, areas)
                    tot += n
                    for a, delta in adj.items():
                        k = aidx.get(a if scale == 'dea' else str(a).upper().strip())
                        if k is None:
                            continue
                        for p, d in delta.items():
                            Pv[k, PARTIES.index(p)] += d / len(srcs)
                Pv = np.clip(Pv, 0, None)
            w = bl.fit_weights(S, stood, X, meta, [t for t in contests if t != c])
            pred = bl.renorm(np.clip(w * pred + (1 - w) * Pv, 0, None))
        P[sel] = pred
    return P, S, stood, meta


def tvd(P, S):
    return 0.5 * np.abs(P - S).sum(axis=1)


def seats(scale_pred, ind_pred=None):
    """End-to-end seats over the STV contests, optionally with candidate-level inds."""
    rows = []
    for contest, year, fn in stv.CONTESTS:
        cyk = f"{contest}{year}"
        scale = 'dea' if contest == 'local' else 'constituency'
        lut = scale_pred.get(scale, {})
        for cd in stv.load_contest(contest, year, fn):
            ak = cd['area'] if scale == 'dea' else cd['area'].upper()
            ps = lut.get((cyk, ak))
            if not ps:
                continue
            actual = collections.Counter(cd['parties'][i] for i in cd['actual'])
            per = collections.Counter(cd['parties'])
            fp = []
            for nm, pty in zip(cd['names'], cd['parties']):
                v = None
                if ind_pred is not None and pty in IND_LABELS:
                    v = ind_pred.get((cyk, cd['area'], nm))
                if v is None:
                    v = ps.get(pty, 0.0) / per[pty]
                fp.append(cd['valid'] * v / 100.0)
            el, _, _ = stv.run_stv(cd['names'], cd['parties'], fp, cd['seats'], cd['valid'])
            sim = collections.Counter(cd['parties'][i] for i in el)
            rows.append({'contest': contest, 'year': year, 'seats': cd['seats'],
                         'err': sum((actual - sim).values()) + sum((sim - actual).values()),
                         'ind_act': sum(v for k, v in actual.items() if 'Independent' in k),
                         'ind_sim': sum(v for k, v in sim.items() if 'Independent' in k)})
    return pd.DataFrame(rows)


def main():
    print("=" * 76)
    print("FORECASTER v3 — poll level + census shape + notional/defector persistence")
    variants = [('v1  poll + census (phase 31)', dict(blend=False, defector=False)),
                ('v2  + blend, persistence v2', dict(blend=True, defector=False)),
                ('v3  + defector-aware persistence', dict(blend=True, defector=True))]
    store = {}
    for scale in ['dea', 'constituency']:
        print(f"\n{scale.upper()}   {'variant':38} {'TVD med':>8} {'TVD mean':>9}")
        for lab, kw in variants:
            P, S, stood, meta = predict(scale, **kw)
            t = tvd(P, S)
            print(f"{'':10} {lab:38} {np.median(t):8.2f} {t.mean():9.2f}")
            store[(scale, lab)] = (P, meta)

    # best variant -> seats
    best = 'v3  + defector-aware persistence'
    lut = {}
    for scale in ['dea', 'constituency']:
        P, meta = store[(scale, best)]
        d = {}
        for k, row in zip(meta.index, P):
            c, a = k.split('||')
            d[(c, a)] = dict(zip(PARTIES, row))
        lut[scale] = d
    F = pd.read_csv(os.path.join(HERE, 'independent_candidates.csv'))
    ORD2CY = {2011: 'assembly2011', 2014: 'local2014', 2016: 'assembly2016',
              2017: 'assembly2017', 2019: 'local2019', 2022: 'assembly2022',
              2023: 'local2023'}
    ind_pred = {}
    for r in F.itertuples():
        cyk = ORD2CY.get(int(r.order))
        if cyk:
            ind_pred[(cyk, r.area, getattr(r, 'name'))] = r.pred

    print("\n" + "=" * 76)
    print("SEATS (STV contests)")
    for lab, ip in [('party-level independents', None),
                    ('candidate-level independents', ind_pred)]:
        df = seats(lut, ip)
        print(f"\n  {lab}: areas {len(df)}  seats {int(df.seats.sum())}  "
              f"mean err {df.err.mean():.2f}  exact {100*(df.err==0).mean():.1f}%")
        print(f"    independents: actual {int(df.ind_act.sum())} "
              f"projected {int(df.ind_sim.sum())}")
        for (c, y), g in df.groupby(['contest', 'year']):
            print(f"      {c+str(y):16} {g.err.mean():6.2f}")
        df.to_csv(os.path.join(HERE, f'forecast_v3_seats_{"cand" if ip else "party"}.csv'),
                  index=False)


if __name__ == '__main__':
    main()
