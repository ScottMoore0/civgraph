#!/usr/bin/env python3
"""v9 phase 43 — candidate-level first preferences and transfer splitting.

Two remaining engine assumptions, both crude, both now measurable.

(1) VOTE SPLITTING (+0.35 seats/area). The count divides a party's predicted vote
    EVENLY across its candidates. Real parties do not: incumbents outpoll newcomers
    and party machines manage the vote. `personId` gives each candidate's own prior
    first-preference share and whether they were elected -- the same machinery that
    just worked for independents in phase 41, applied to party candidates.

(2) TRANSFER SPLITTING. When party P's votes transfer to party Q, the engine splits
    them across Q's continuing candidates in proportion to current votes. Whether
    that is right is an empirical question the count data can answer directly: fit
    the concentration exponent alpha in

        share_i  proportional to  votes_i ** alpha

    alpha = 1 is the current proportional assumption; alpha > 1 means transfers
    concentrate on the leading continuing candidate more than their vote share
    implies (plausible for a party's last remaining runner); alpha < 1 means they
    spread more evenly.

Both are measured from the repo's own count data, then tested end to end.
"""
import os, sys, json, collections, importlib.util
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


pm = _load('pm17', '17_party_model.py')
p38 = _load('p38', '38_forecast_v4.py')
stv = _load('stv19', '19_stv_simulator.py')
tm18 = _load('tm18', '18_transfer_model.py')
ind34 = _load('ind34', '34_independents.py')
p41 = _load('p41', '41_independents_fix.py')
PARTIES = pm.PARTIES
IND = ind34.IND


# ------------------------------------------------- (2) transfer concentration --
def measure_alpha():
    """Fit the within-party transfer concentration exponent from the count data."""
    obs = []
    for contest, year, fn in tm18.CONTESTS:
        path = os.path.join(tm18.META, fn)
        if not os.path.exists(path):
            continue
        d = json.load(open(path, encoding='utf-8'))
        for r in d['results']:
            cg = (r.get('animationPayload') or {}).get('Constituency', {}).get('countGroup') or []
            if not cg:
                continue
            counts = sorted({str(x['Count_Number']) for x in cg}, key=int)
            party = {str(x['Candidate_Id']): (x.get('Party_Name') or '').strip()
                     for x in cg}
            prev_votes = {}
            for ci, c in enumerate(counts):
                rows = [x for x in cg if str(x['Count_Number']) == c]
                if ci > 0:
                    # destination candidates that GAINED, grouped by party
                    gains = collections.defaultdict(list)
                    for x in rows:
                        t = tm18.f(x.get('Transfers'))
                        cid = str(x['Candidate_Id'])
                        p = party.get(cid, '')
                        if t > 0 and p and not p.lower().startswith('non-transferable'):
                            gains[p].append((cid, t, prev_votes.get(cid, 0.0)))
                    for p, lst in gains.items():
                        if len(lst) < 2:
                            continue
                        v = np.array([x[2] for x in lst], dtype=float)
                        g = np.array([x[1] for x in lst], dtype=float)
                        if v.min() <= 0 or g.sum() <= 0 or len(v) > 6:
                            continue
                        obs.append((v / v.sum(), g / g.sum()))
                prev_votes = {str(x['Candidate_Id']): tm18.f(x.get('Total_Votes'))
                              for x in rows}
    if not obs:
        return 1.0, 0
    # grid search alpha minimising mean absolute error on the split
    best, ba = None, 1.0
    for a in np.arange(0.4, 2.61, 0.05):
        err = 0.0
        for v, g in obs:
            w = v ** a
            w = w / w.sum()
            err += np.abs(w - g).sum()
        err /= len(obs)
        if best is None or err < best:
            best, ba = err, a
    err1 = np.mean([np.abs(v - g).sum() for v, g in obs])
    print(f"  within-party transfer splits observed: {len(obs)}")
    print(f"    alpha=1.00 (proportional, current)  mean abs split error {err1:.4f}")
    print(f"    alpha={ba:.2f} (fitted)              mean abs split error {best:.4f}")
    return float(ba), len(obs)


# ------------------------------------------------------- (1) vote splitting ----
def candidate_weights():
    """(contest_key, area, name) -> relative weight within that candidate's party."""
    df = ind34.load()
    hist = collections.defaultdict(list)
    for r in df.sort_values('order').itertuples():
        hist[r.pid].append(r)
    out = {}
    for r in df.itertuples():
        prior = [h for h in hist[r.pid] if h.order < r.order]
        if prior:
            last = prior[-1]
            # an incumbent's own prior share, discounted if they were not elected
            w = last.share * (1.0 if last.elected else 0.75)
        else:
            w = np.nan          # no history -> fall back to the party average
        cyk = p41.ORD2CY.get(int(r.order))
        if cyk:
            out[(cyk, r.area, r.name)] = w
    return out


def run(alpha=1.0, split=False):
    cw = candidate_weights() if split else {}
    est_ind = p41.candidate_estimates()
    lut = {}
    for scale in ['dea', 'constituency']:
        P, S, meta = p38.predict(scale)
        d = {}
        for k, row in zip(meta.index, P):
            c, a = k.split('||')
            d[(c, a)] = dict(zip(PARTIES, row))
        lut[scale] = d
    stv.SPLIT_ALPHA = alpha
    rows = []
    for contest, year, fn in stv.CONTESTS:
        cyk = f"{contest}{year}"
        scale = 'dea' if contest == 'local' else 'constituency'
        for cd in stv.load_contest(contest, year, fn):
            ak = cd['area'] if scale == 'dea' else cd['area'].upper()
            ps = lut[scale].get((cyk, ak))
            if not ps:
                continue
            byparty = collections.defaultdict(list)
            for i, (nm, pty) in enumerate(zip(cd['names'], cd['parties'])):
                byparty[pty].append((i, nm))
            fp = [0.0] * len(cd['names'])
            for pty, members in byparty.items():
                if pty in IND:
                    for i, nm in members:
                        v = est_ind.get((cyk, cd['area'], nm), 3.0)
                        fp[i] = cd['valid'] * v / 100.0
                    continue
                tot = cd['valid'] * ps.get(pty, 0.0) / 100.0
                ws = np.array([cw.get((cyk, cd['area'], nm), np.nan)
                               for _, nm in members], dtype=float)
                if split and np.isfinite(ws).any():
                    fill = np.nanmean(ws[np.isfinite(ws)])
                    ws = np.where(np.isfinite(ws), ws, fill)
                    ws = np.clip(ws, 1e-6, None)
                    ws = ws / ws.sum()
                else:
                    ws = np.repeat(1.0 / len(members), len(members))
                for (i, _), w in zip(members, ws):
                    fp[i] = tot * w
            actual = collections.Counter(cd['parties'][i] for i in cd['actual'])
            el, _, _ = stv.run_stv(cd['names'], cd['parties'], fp, cd['seats'], cd['valid'])
            sim = collections.Counter(cd['parties'][i] for i in el)
            rows.append({'contest': contest, 'year': year, 'seats': cd['seats'],
                         'err': sum((actual - sim).values()) + sum((sim - actual).values()),
                         'cand_correct': len(set(el) & cd['actual'])})
    return pd.DataFrame(rows)


def main():
    print("=" * 72)
    print("CANDIDATE-LEVEL FIRST PREFERENCES AND TRANSFER SPLITTING")
    print("\n(2) transfer concentration, measured from the count data:")
    alpha, n = measure_alpha()

    print("\n(1)+(2) end to end:")
    print(f"  {'variant':44} {'seat err':>9} {'exact':>8} {'cand acc':>9}")
    base = None
    for lab, a, sp in [('even split, proportional transfers (now)', 1.0, False),
                       ('+ candidate-level vote splitting', 1.0, True),
                       (f'+ fitted transfer alpha={alpha:.2f}', alpha, False),
                       ('+ both', alpha, True)]:
        df = run(alpha=a, split=sp)
        acc = df.cand_correct.sum() / df.seats.sum()
        if base is None:
            base = df.err.mean()
        print(f"  {lab:44} {df.err.mean():9.2f} {100*(df.err==0).mean():7.1f}% "
              f"{100*acc:8.1f}%")
        df.to_csv(os.path.join(HERE, f'cand_level_{"both" if (a!=1 and sp) else ("split" if sp else ("alpha" if a!=1 else "base"))}.csv'),
                  index=False)


if __name__ == '__main__':
    main()
