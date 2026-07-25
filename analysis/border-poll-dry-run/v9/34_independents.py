#!/usr/bin/env python3
"""v9 phase 34 — independents from candidate history, not demography.

The failure this addresses: 19 independent councillors were elected in local 2023
and the model projected ZERO. Presence accuracy was 0.479, below the 0.517
majority-class baseline -- worse than always guessing "nobody stands".

Why the census cannot do this. Census features describe the ELECTORATE; an
independent's vote is a property of the CANDIDATE. Two demographically identical
DEAs diverge entirely on whether a long-serving councillor or a party defector
happens to be standing. No census variable encodes that.

But the repo's own metadata does. `personId` is stable across contests, so a
candidate's history is recoverable directly -- no Statement of Persons Nominated
scraping needed. Across six sampled contests, 545 people appear more than once and
17 stood both under a party label and as an Independent, including the canonical
case:

    Alex Easton  DUP (Assembly 2016, WON) -> DUP (Westminster 2019, lost)
                 -> Independent Unionist (Assembly 2022, WON)
                 -> Independent Unionist (Westminster 2024, WON)

That separates the two populations cleanly: ex-party independents with a built-up
personal vote, versus first-time independents who mostly poll derisory shares. The
model does not need to predict a Kieran Deeny; it needs to get the defectors right
and not pretend it can do the rest.

Features per independent candidate, all from strictly EARLIER contests:
    prior_share      their most recent prior first-preference share
    prior_elected    were they elected at that prior candidacy
    was_party        did they previously stand under a PARTY label (defector)
    ex_party_here    is that former party also standing in this area now
    n_ind            how many independents are in this field (a crowded
                     independent field is the signature of no-hopers)
    prior_same_area  was the prior candidacy in this same area
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

# chronological, so "prior" is well defined
CONTESTS = [
    (2011, 'assembly', 'northern-ireland-assembly__2011-05-05.json'),
    (2014, 'local', 'local-government-local-government-districts__2014-05-22.json'),
    (2015, 'westminster', 'house-of-commons-of-the-united-kingdom__2015-05-07.json'),
    (2016, 'assembly', 'northern-ireland-assembly__2016-05-05.json'),
    (2017, 'assembly', 'northern-ireland-assembly__2017-03-02.json'),
    (2017.5, 'westminster', 'house-of-commons-of-the-united-kingdom__2017-06-08.json'),
    (2019, 'local', 'local-government-local-government-districts__2019-05-02.json'),
    (2019.5, 'westminster', 'house-of-commons-of-the-united-kingdom__2019-12-12.json'),
    (2022, 'assembly', 'northern-ireland-assembly__2022-05-05.json'),
    (2023, 'local', 'local-government-local-government-districts__2023-05-18.json'),
    (2024, 'westminster', 'house-of-commons-of-the-united-kingdom__2024-07-04.json'),
]
IND = {'Independent', 'Independent Other', 'Independent Unionist',
       'Independent Nationalist'}


def load():
    rows = []
    for order, contest, fn in CONTESTS:
        p = os.path.join(META, fn)
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        for r in d['results']:
            cs = r.get('candidates') or []
            tot = sum(float(c.get('firstPrefs') or 0) for c in cs)
            if tot <= 0:
                continue
            for c in cs:
                pid = str(c.get('personId') or c.get('id') or '')
                party = (c.get('party') or '').strip()
                rows.append({'order': order, 'contest': contest,
                             'year': int(order), 'area': r['constituency'],
                             'pid': pid, 'name': c.get('name'), 'party': party,
                             'is_ind': party in IND,
                             'share': 100.0 * float(c.get('firstPrefs') or 0) / tot,
                             'elected': bool(c.get('elected'))})
    return pd.DataFrame(rows)


def build_features(df):
    """One row per independent candidacy, with strictly-prior history."""
    hist = collections.defaultdict(list)
    for r in df.sort_values('order').itertuples():
        hist[r.pid].append(r)
    out = []
    for r in df[df.is_ind].itertuples():
        prior = [h for h in hist[r.pid] if h.order < r.order]
        field = df[(df.order == r.order) & (df.area == r.area)]
        n_ind = int(field.is_ind.sum())
        if prior:
            last = prior[-1]
            was_party = not last.is_ind
            ex_here = bool(was_party and (field.party == last.party).any())
            out.append({'order': r.order, 'contest': r.contest, 'area': r.area,
                        'pid': r.pid, 'name': r.name, 'y': r.share,
                        'prior_share': last.share,
                        'prior_elected': int(last.elected),
                        'was_party': int(was_party),
                        'ex_party_here': int(ex_here),
                        'prior_same_area': int(last.area == r.area),
                        'n_prior': len(prior), 'n_ind': n_ind,
                        'has_prior': 1})
        else:
            out.append({'order': r.order, 'contest': r.contest, 'area': r.area,
                        'pid': r.pid, 'name': r.name, 'y': r.share,
                        'prior_share': 0.0, 'prior_elected': 0, 'was_party': 0,
                        'ex_party_here': 0, 'prior_same_area': 0,
                        'n_prior': 0, 'n_ind': n_ind, 'has_prior': 0})
    return pd.DataFrame(out)


FEATS = ['prior_share', 'prior_elected', 'was_party', 'ex_party_here',
         'prior_same_area', 'n_prior', 'n_ind', 'has_prior']


def main():
    df = load()
    print(f"candidacies loaded: {len(df):,} across {df.order.nunique()} contests")
    F = build_features(df)
    print(f"independent candidacies: {len(F):,}")
    print(f"  with prior electoral history : {int(F.has_prior.sum()):,} "
          f"({100*F.has_prior.mean():.1f}%)")
    print(f"  ex-party (defectors)         : {int(F.was_party.sum()):,}")
    print(f"  previously elected           : {int(F.prior_elected.sum()):,}")

    print("\nmean share by history class:")
    for lab, s in [('no prior history', F[F.has_prior == 0]),
                   ('prior, never elected', F[(F.has_prior == 1) & (F.prior_elected == 0)]),
                   ('prior, was elected', F[F.prior_elected == 1]),
                   ('  of which ex-party', F[(F.prior_elected == 1) & (F.was_party == 1)])]:
        if len(s):
            print(f"  {lab:24} n={len(s):4}  mean share {s.y.mean():5.2f}  "
                  f"max {s.y.max():5.1f}")

    # leave-one-contest-out: history is strictly prior, so no leakage by construction
    print("\nleave-one-contest-out prediction of an independent's share:")
    pred = np.zeros(len(F))
    for o in sorted(F.order.unique()):
        te = (F.order == o).values
        tr = (F.order < o).values          # train only on EARLIER contests
        if tr.sum() < 30:
            pred[te] = F.y[tr].mean() if tr.sum() else F.y.mean()
            continue
        m = GradientBoostingRegressor(n_estimators=200, max_depth=3, random_state=0)
        m.fit(F.loc[tr, FEATS].values, F.y[tr].values)
        pred[te] = np.clip(m.predict(F.loc[te, FEATS].values), 0, None)
    F['pred'] = pred
    base = F.y.mean()
    print(f"  {'model':28} {'MAE':>7} {'corr':>7}")
    print(f"  {'constant (mean share)':28} {np.abs(base-F.y).mean():7.2f} {'--':>7}")
    print(f"  {'prior_share only':28} {np.abs(F.prior_share-F.y).mean():7.2f} "
          f"{np.corrcoef(F.prior_share, F.y)[0,1]:7.3f}")
    print(f"  {'GBM on history features':28} {np.abs(F.pred-F.y).mean():7.2f} "
          f"{np.corrcoef(F.pred, F.y)[0,1]:7.3f}")

    # area-level independent share, vs the census model's
    print("\narea-level Independent share (local 2023), candidate-history vs census:")
    a = F[F.order == 2023].groupby('area').agg(pred=('pred', 'sum'), act=('y', 'sum'))
    pm = importlib.util.spec_from_file_location('pm17', os.path.join(HERE, '17_party_model.py'))
    mod = importlib.util.module_from_spec(pm); sys.modules['pm17'] = mod
    pm.loader.exec_module(mod)
    S, stood, X, meta, feats = mod.build('dea')
    P = mod.cv_share(S, stood, X, meta, meta.council.values)
    j = mod.PARTIES.index('Independent')
    sel = meta.contest_year.values == 'local2023'
    cens = pd.Series(P[sel, j], index=list(meta.area.values[sel]))
    a['census'] = cens.reindex(a.index)
    a = a.dropna()
    print(f"  areas {len(a)}")
    print(f"  MAE  candidate-history {np.abs(a.pred-a.act).mean():.2f}   "
          f"census {np.abs(a.census-a.act).mean():.2f}")
    print(f"  areas where independents actually polled >15%: "
          f"{(a.act>15).sum()};  history flags {(a.pred>15).sum()}, "
          f"census flags {(a.census>15).sum()}")
    F.to_csv(os.path.join(HERE, 'independent_candidates.csv'), index=False)
    a.to_csv(os.path.join(HERE, 'independent_area_shares_2023.csv'))
    print("\nwrote independent_candidates.csv, independent_area_shares_2023.csv")


if __name__ == '__main__':
    main()
