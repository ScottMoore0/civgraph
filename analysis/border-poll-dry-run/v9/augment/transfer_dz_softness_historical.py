#!/usr/bin/env python3
"""Land the 1973-2023 DEA-level transfer-OPENNESS series onto every 2021 Data Zone.

The transfer softness covariate previously reached the Data Zones only at
CONSTITUENCY resolution (18 units, broadcast) and only from the 2014-2023 locals
+ 1998-2022 Assembly. The DEA<->census crosswalk built earlier this session
(data/census/derived/dz2021_to_deas.csv: every DZ -> dea_1972/1984/1993/2012)
lets the full digitised local series carry onto the DZ frame at DEA resolution
(80-101 units) AND with time depth back to 1973.

Method
------
For each historical local STV contest we extract unionist/nationalist transfer
openness per DEA (single-source eliminations, non-transferable removed -- the
same extraction as transfer_covariates_dea.py), keyed by the DEA vintage that
contest was fought on:

    1973/1977/1981  -> dea_1972      1985/1989       -> dea_1984
    1993/1997/2001/2005/2011 -> dea_1993   2014/2019/2023 -> dea_2012

Parcels are pooled per DEA within a vintage (so a DEA's ratio rests on a real
transferable base, not one noisy count), openness is computed on the pooled
totals, then joined onto the Data Zones through the matching crosswalk column.
Each DZ therefore gets its DEA's openness in every vintage it has data for, plus
an all-vintage mean -- a per-DZ historical transfer-softness surface with genuine
sub-constituency texture, honestly flagged where a DEA's base is too thin.
"""
import json, glob, os, collections, re
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BASE = f"{REPO}/render/metadata/elections-test2"
XWALK = f"{REPO}/data/census/derived/dz2021_to_deas.csv"
MIN_BASE = 500.0                                    # pooled transferable base per DEA

YEAR_VINTAGE = {1973: 'dea_1972', 1977: 'dea_1972', 1981: 'dea_1972',
                1985: 'dea_1984', 1989: 'dea_1984',
                1993: 'dea_1993', 1997: 'dea_1993', 2001: 'dea_1993',
                2005: 'dea_1993', 2011: 'dea_1993',
                2014: 'dea_2012', 2019: 'dea_2012', 2023: 'dea_2012'}
VINTAGES = ['dea_1972', 'dea_1984', 'dea_1993', 'dea_2012']


def norm(s):
    """Uppercase + collapse whitespace/punctuation for a robust label join."""
    return re.sub(r'[^A-Z0-9]+', ' ', (s or '').upper()).strip()


def bloc(p):
    p = (p or '').lower()
    if any(k in p for k in ['dup', 'democratic unionist', 'uup', 'ulster unionist',
                            'progressive unionist', 'traditional unionist', 'uk unionist',
                            'ukup', 'independent unionist', 'united unionist', 'vanguard',
                            'ulster democ']):
        return 'U'
    if any(k in p for k in ['sdlp', 'social democratic', 'sinn', 'aont',
                            'independent nationalist', 'irsp']):
        return 'N'
    if 'alliance' in p or 'green' in p or 'women' in p:
        return 'C'
    return 'O'


def elim_flows(res):
    """Single-source elimination parcels: (source_bloc, {dst_bloc: amount},
    nontransferable, parcel_size). Mirrors transfer_covariates.py."""
    party = {c['name']: c['party'] for c in res.get('candidates', [])}
    perc = collections.defaultdict(lambda: {'src': [], 'dst': []})
    for c in res.get('candidates', []):
        for ct in c.get('counts', []):
            t = ct.get('transfers') or 0
            n = ct.get('count')
            if t < -0.5:
                perc[n]['src'].append((c['name'], t, ct.get('status')))
            elif t > 0.5:
                perc[n]['dst'].append((c['name'], t))
    out = []
    for n in sorted(perc):
        s = perc[n]['src']
        if len(s) != 1:
            continue
        name, tr, status = s[0]
        if status == 'Elected':
            continue
        dst = collections.defaultdict(float)
        for dn, a in perc[n]['dst']:
            dst[bloc(party[dn])] += a
        recv = sum(dst.values())
        if -tr > 0 and recv <= -tr * 1.02:
            out.append((bloc(party[name]), dict(dst), max(0.0, -tr - recv), -tr))
    return out


def openness_by_dea():
    """{vintage: {norm(DEA): (u_open, n_open, u_base, n_base, n_contests)}}"""
    # accumulate parcels per (vintage, DEA)
    acc = collections.defaultdict(lambda: collections.defaultdict(float))
    contests = collections.defaultdict(set)
    for f in sorted(glob.glob(f"{BASE}/local-government-local-government-districts__*.json")):
        yr = int(os.path.basename(f).split('__')[1][:4])
        vint = YEAR_VINTAGE.get(yr)
        if vint is None:
            continue
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        for res in d.get('results', []):
            key = (vint, norm(res.get('constituency')))
            contests[key].add(yr)
            for sb, dst, nt, parcel in elim_flows(res):
                if sb not in ('U', 'N'):
                    continue
                a = acc[key]
                a[f'{sb}_parcel'] += parcel
                a[f'{sb}_nt'] += nt
                for db, amt in dst.items():
                    tgt = 'U' if db == 'U' else 'N' if db == 'N' else 'C'
                    a[f'{sb}_to_{tgt}'] += amt
    out = collections.defaultdict(dict)
    for (vint, dea), a in acc.items():
        def op(b):
            other = 'N' if b == 'U' else 'U'
            tr = a.get(f'{b}_parcel', 0) - a.get(f'{b}_nt', 0)
            cross = a.get(f'{b}_to_C', 0) + a.get(f'{b}_to_{other}', 0)
            base = a.get(f'{b}_parcel', 0)
            return (round(min(100, 100 * cross / tr), 1) if base >= MIN_BASE and tr > 0 else np.nan), base
        uo, ub = op('U')
        no, nb = op('N')
        out[vint][dea] = (uo, no, int(ub), int(nb), len(contests[(vint, dea)]))
    return out


def main():
    ob = openness_by_dea()
    xw = pd.read_csv(XWALK)
    print("coverage by vintage (election-feed DEA names vs crosswalk geometry names):")
    for v in VINTAGES:
        n_u = sum(1 for t in ob.get(v, {}).values() if t[0] == t[0])
        xw_keys = {norm(x) for x in xw[v].dropna().unique()}
        matched = xw_keys & set(ob.get(v, {}).keys())
        print(f"  {v}: {n_u} DEAs with unionist base >= {MIN_BASE:.0f}; "
              f"crosswalk labels matched {len(matched)}/{len(xw_keys)} "
              f"({100 * len(matched) / len(xw_keys):.0f}%)")
    print("  (dea_2012 = current geometry, matches fully; pre-2014 vintages lose 18-30% to "
          "election-feed<->geometry label drift -- those DEAs fall back to their other vintages.)")

    dz_rows = []
    for _, row in xw.iterrows():
        rec = {'DZ21': row['DZ2021_cd'], 'DEA2014': row.get('DEA2014_nm')}
        u_vals, n_vals = [], []
        for v in VINTAGES:
            lab = norm(row.get(v))
            t = ob.get(v, {}).get(lab)
            uo = no = np.nan
            if t is not None:
                uo, no = t[0], t[1]
            rec[f'u_open_{v[4:]}'] = uo
            rec[f'n_open_{v[4:]}'] = no
            if uo == uo:
                u_vals.append(uo)
            if no == no:
                n_vals.append(no)
        rec['u_open_mean'] = round(float(np.mean(u_vals)), 1) if u_vals else np.nan
        rec['n_open_mean'] = round(float(np.mean(n_vals)), 1) if n_vals else np.nan
        rec['n_vintages_u'] = len(u_vals)
        dz_rows.append(rec)
    dz = pd.DataFrame(dz_rows)
    out = f"{HERE}/transfer_dz_softness_historical.csv"
    dz.to_csv(out, index=False)

    cov_u = (dz['u_open_mean'].notna()).mean() * 100
    cov_n = (dz['n_open_mean'].notna()).mean() * 100
    print(f"\nwrote {os.path.basename(out)}: {len(dz)} Data Zones")
    print(f"  unionist openness present for {cov_u:.0f}% of DZs (mean over "
          f"{dz['n_vintages_u'].mean():.1f} vintages); nationalist for {cov_n:.0f}%")
    print(f"  NI mean unionist openness {dz['u_open_mean'].mean():.1f}%, "
          f"nationalist {dz['n_open_mean'].mean():.1f}%")
    # sanity: softest / hardest unionist DEAs by mean openness, at DZ resolution
    by_dea = dz.dropna(subset=['u_open_mean']).groupby('DEA2014')['u_open_mean'].mean().sort_values()
    print("  hardest-unionist DEA2014 (lowest mean openness):",
          ", ".join(f"{k} {v:.1f}" for k, v in by_dea.head(3).items()))
    print("  softest-unionist DEA2014:",
          ", ".join(f"{k} {v:.1f}" for k, v in by_dea.tail(3).items()))


if __name__ == "__main__":
    main()
