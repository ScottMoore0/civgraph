#!/usr/bin/env python3
"""v9 phase 47 — pre-2014 local elections: notionals on modern DEAs, tiered.

Phase 46 built DZ2021 -> DEA1993 (3,780/3,780) and matched election-area names to
those boundaries: 2011 100%, 2005 99%, 2001 97%, 1997 97%, 1993 98%, 1989/1985 91%.
1973/1977/1981 matched 0% -- they use a lettered "Antrim Area A/B/C" scheme that the
1993 boundary set does not represent, so they are OUT until a lettered-DEA boundary
source is found.

Method: each pre-2014 contest's results are allocated to Data Zones (raked to its own
observed DEA1993 totals) and re-aggregated onto the modern 80 DEAs -- the phase-32
notional construction, applied across the 2014 reorganisation.

CIRCULARITY, STATED UP FRONT. The DZ allocation uses the census ridge, so a notional
embeds that model's assumptions about within-area distribution. Training the share
model on notionals is therefore partly training on its own output. What limits the
damage is the raking: the mosaic is forced to reproduce the OBSERVED old-DEA totals
exactly, so the real aggregate information is preserved and only the within-old-DEA
split is modelled. Provenance is reported per modern DEA so seats stitched from
fragments can be discounted.

Tiers, tested rather than assumed:
  1  add 2011                      -- modern party system, one crosswalk
  2  add 2005 and 2001             -- extends into the UUP->DUP realignment
  3  1985-1997                     -- volatility and floors only, NOT pooled
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
dza = _load('dz25', '25_dz_party_allocation.py')
PARTIES = pm.PARTIES
IND = {'Independent', 'Independent Other', 'Independent Unionist',
       'Independent Nationalist'}
MAIN = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP', 'Aontú']

YEARS = {'2011': '2011-05-05', '2005': '2005-05-05', '2001': '2001-06-07',
         '1997': '1997-05-21', '1993': '1993-05-19', '1989': '1989-05-17',
         '1985': '1985-05-15', '1981': '1981-05-20', '1977': '1977-05-18',
         '1973': '1973-05-30'}
# each contest was fought on its own DEA vintage; all four are on Civgraph R2
VINTAGE_OF = {'1973': '1972', '1977': '1972', '1981': '1972',
              '1985': '1984', '1989': '1984',
              '1993': '1993', '1997': '1993', '2001': '1993',
              '2005': '1993', '2011': '1993'}
DZMAPS = {v: json.load(open(os.path.join(HERE, f'dz_dea{v}.json'), encoding='utf-8'))
          for v in ['1972', '1984', '1993']}

DZDEA = json.load(open(os.path.join(HERE, 'dz_dea.json'), encoding='utf-8'))
pop = pd.read_csv(os.path.join(REPO, 'data', 'census', 'derived', 'ms-a01-dz.csv'))
pop = pop.set_index('GeographyCode').AllUsualResidents.astype(float)


def cat(p):
    return 'Independent' if p in IND else (p if p in MAIN else 'Other')


def contest_shares(year):
    """Observed party shares by DEA1993 key for one pre-2014 local contest."""
    amap = json.load(open(os.path.join(HERE, f'dea_map_{year}.json'), encoding='utf-8'))
    d = json.load(open(os.path.join(META,
                  f'local-government-local-government-districts__{YEARS[year]}.json'),
                  encoding='utf-8'))
    rows = {}
    for r in d['results']:
        key = amap.get(r['constituency'])
        if not key:
            continue
        cs = r.get('candidates') or []
        tot = sum(float(c.get('firstPrefs') or 0) for c in cs)
        if tot <= 0:
            continue
        v = collections.defaultdict(float)
        for c in cs:
            v[cat((c.get('party') or '').strip())] += float(c.get('firstPrefs') or 0)
        rows[key] = {p: 100.0 * v.get(p, 0.0) / tot for p in PARTIES}
    return pd.DataFrame(rows).T.reindex(columns=PARTIES)


def notional(year, dzf, feats, Xref, Sref, metaref):
    """Express one pre-2014 contest on the modern 80 DEAs."""
    tgt = contest_shares(year)
    dzids = dzf.index.tolist()
    dzmap = DZMAPS[VINTAGE_OF[year]]
    old = np.array([str(dzmap.get(i, '')).upper().strip() for i in dzids])
    new = np.array([str(DZDEA.get(i, '')).upper().strip() for i in dzids])
    w = pop.reindex(dzids).fillna(0.0).values
    # census shape at DZ, fit on the modern contests (the only labelled data)
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    Y = pm.clr(Sref)
    sc = StandardScaler().fit(Xref)
    dzX = dzf[feats].values.astype(float)
    nfield = Xref.shape[1] - dzX.shape[1]
    if nfield:
        dzX = np.hstack([dzX, np.tile(Xref[:, -nfield:].mean(axis=0), (len(dzX), 1))])
    dzP = np.zeros((len(dzids), len(PARTIES)))
    for j in range(len(PARTIES)):
        ctr = Y[:, j].mean()
        m = Ridge(alpha=pm.ALPHA).fit(sc.transform(Xref), Y[:, j] - ctr)
        dzP[:, j] = m.predict(sc.transform(dzX)) + ctr
    raw = pm.inv_clr(dzP, np.ones_like(dzP, dtype=bool))
    tgt = tgt[~tgt.index.duplicated()]
    gidx = {a: np.where(old == a)[0] for a in tgt.index}
    gidx = {a: i for a, i in gidx.items() if len(i)}
    raked = dza.rake(raw, w, gidx, tgt.loc[list(gidx)])
    # aggregate to modern DEAs
    rows, names = [], []
    for a in sorted(set(new)):
        if not a:
            continue
        idx = np.where(new == a)[0]
        if w[idx].sum() > 0:
            rows.append(np.average(raked[idx], axis=0, weights=w[idx]))
            names.append(a)
    return pd.DataFrame(rows, index=names, columns=PARTIES)


def provenance():
    """For each modern DEA: share of population from its main DEA1993 predecessor."""
    rows = []
    for dz, new in DZDEA.items():
        rows.append((str(new).upper().strip(),
                     str(DZMAPS['1993'].get(dz, '')).upper().strip(),
                     float(pop.get(dz, 0.0))))
    df = pd.DataFrame(rows, columns=['new', 'old', 'pop'])
    out = []
    for new, g in df.groupby('new'):
        s = g.groupby('old')['pop'].sum().sort_values(ascending=False)
        out.append({'dea': new, 'main_src': s.index[0],
                    'pct_from_main': 100 * s.iloc[0] / s.sum(), 'n_src': len(s)})
    return pd.DataFrame(out).set_index('dea')


def main():
    print("=" * 74)
    print("PRE-2014 LOCAL ELECTIONS -> modern DEAs")
    prov = provenance()
    prov.to_csv(os.path.join(HERE, 'dea_provenance_1993_to_2014.csv'))
    print(f"  modern DEA provenance from DEA1993: median "
          f"{prov.pct_from_main.median():.1f}% from one predecessor; "
          f"{(prov.pct_from_main > 90).sum()} of {len(prov)} above 90%")
    print(f"  (2014 was a wholesale redraw, so this is far messier than the "
          f"2008->2023 Westminster review)")

    S, stood, X, meta, feats = pm.build('dea')
    dzf = pd.read_csv(os.path.join(HERE, 'dz_features.csv')).set_index('area')

    notionals = {}
    for y in ['2011', '2005', '2001', '1997', '1993', '1989', '1985',
              '1981', '1977', '1973']:
        try:
            n = notional(y, dzf, feats, X, S, meta)
            notionals[y] = n
            n.to_csv(os.path.join(HERE, 'notional', f'local{y}__onDEA2014.csv'))
            print(f"  {y}: notional built for {len(n)} modern DEAs")
        except Exception as e:
            print(f"  {y}: FAILED ({type(e).__name__}: {e})")

    # ---------------- Tier 3: volatility / floors ----------------
    print("\n" + "=" * 74)
    print("TIER 3 — volatility and floors from the long series (NOT pooled)")
    hist = {y: n for y, n in notionals.items()}
    cur = {}
    cy = meta.contest_year.values
    for c in sorted(set(cy)):
        sel = cy == c
        cur[c.replace('local', '')] = pd.DataFrame(
            S[sel], index=[str(a).upper().strip() for a in meta.area.values[sel]],
            columns=PARTIES)
    allser = {**{f'notional{y}': v for y, v in hist.items()},
              **{f'actual{y}': v for y, v in cur.items()}}
    areas = sorted(set.intersection(*[set(v.index) for v in allser.values()]))
    print(f"  contests in the series: {len(allser)}   DEAs common to all: {len(areas)}")
    vol = {}
    for p in PARTIES:
        M = np.vstack([allser[k].loc[areas, p].values for k in sorted(allser)])
        vol[p] = pd.Series(M.std(axis=0), index=areas)
    V = pd.DataFrame(vol)
    V.to_csv(os.path.join(HERE, 'dea_party_volatility.csv'))
    print(f"\n  per-DEA per-party volatility over {len(allser)} contests "
          f"(vs 3 previously):")
    print(f"    {'party':12} {'median sd':>10} {'p10':>7} {'p90':>7}")
    for p in ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance']:
        s = V[p]
        print(f"    {p:12} {s.median():10.2f} {s.quantile(.1):7.2f} {s.quantile(.9):7.2f}")
    # floors
    print("\n  observed FLOOR (min share across the series), top/bottom DEAs:")
    for p in ['DUP', 'Sinn Féin']:
        M = pd.DataFrame({k: allser[k].loc[areas, p] for k in sorted(allser)})
        fl = M.min(axis=1).sort_values(ascending=False)
        print(f"    {p:12} highest floor {fl.index[0][:22]:22} {fl.iloc[0]:5.1f}%   "
              f"lowest {fl.index[-1][:18]:18} {fl.iloc[-1]:4.1f}%")


if __name__ == '__main__':
    main()
