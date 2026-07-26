#!/usr/bin/env python3
"""v9 phase 53 — the 2001 census at Output Area level, carried onto DZ2021 and SA2011.

The 2001 census was the missing vintage. Phase 39 established that vintage-matching
changes results, then had to fit the 1997, 2001 AND 2005 Westminster contests with
1991 demography because that was the only pre-2011 feature set mapped to DZ2021. For
2001 and 2005 the correct vintage is 2001, and it was on disk the whole time:
NISRA's full 2001 release, including Key Statistics at OUTPUT AREA level (5,022 units,
matching OA2001.fgb exactly).

Source: `<Downloads>/Census 2001 Complete/census-2001-key-statistics-tables-
statistical-geographies.zip` -> `Key Statistics - Numerical - Output Area.zip`.
Catalogued in data/census/source-inventory/census-source-archives.json.

Variables are built to match the column schema of `dz21-census-1991.csv` exactly, so
the three vintages are drop-in interchangeable in phase 39's harmonisation.

One documented departure. At Output Area level NISRA published religion only as
KS07a, which merges "no religion" with "religion not stated" into a single column, and
released no religion-detail CAS table at OA level (disclosure control). 1991 and 2021
both split those two. Rather than silently compare a merged 2001 figure against split
figures elsewhere, this emits `none_or_notstated_pct` as the harmonisable quantity and
leaves `relig_notstated_pct` empty for 2001; phase 54 forms the same merged quantity
for 1991 and 2021 so all three are compared like for like.

Counts are apportioned by AREAL INTERPOLATION using the phase-52 weights: each OA's
counts are split across every DZ2021 (or SA2011) it intersects, summed, and only then
converted to percentages. Apportioning counts and dividing afterwards is correct;
averaging OA-level percentages would weight a 20-person OA the same as a 900-person one.
"""
import os, sys, io, csv, re, zipfile
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, 'data', 'census', 'derived')

SRC = os.environ.get('CENSUS2001_ZIP') or os.path.join(
    os.path.expanduser('~'), 'Downloads', 'Census 2001 Complete',
    'census-2001-key-statistics-tables-statistical-geographies.zip')

OACODE = re.compile(r'(\d{2}[A-Z]{2}\d{6})')

# table -> positional column indices. Positional, because KS17 carries a two-row
# header and the others one; the data columns line up regardless.
NEED = {
    'KS01':  {'pop': [1]},
    'KS02':  {'age_all': [1], 'adults18plus': list(range(8, 18))},
    'KS07a': {'rel_all': [1], 'rc': [2], 'prot': [3, 4, 5, 6],
              'rel_other': [7], 'none_or_ns': [8]},
    'KS07b': {'cb_all': [1], 'cb_cath': [2], 'cb_prot': [3]},
    'KS08':  {'h_all': [1], 'llti': [2]},
    'KS09a': {'ea_all': [1], 'econ_active': [2, 3, 4, 5, 6], 'unemployed': [5]},
    'KS13':  {'q_all': [1], 'noquals': [2], 'degree': [6, 7]},
    'KS17':  {'c_hh': [1], 'nocar': [2]},
    'KS18':  {'hh': [1], 'owner': [2, 3, 4], 'social': [5, 6], 'private': [7, 8]},
    'KS24':  {'ir_all': [1], 'irish_speak': [3, 4, 5]},
}


def num(x):
    """NISRA suppression/nil marker is '-'; thousands separators appear in some cells."""
    s = str(x).strip().replace(',', '')
    if s in ('', '-', '..', ':'):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def read_oa_tables():
    z = zipfile.ZipFile(SRC)
    inner = [x for x in z.namelist() if 'Numerical - Output Area' in x][0]
    zz = zipfile.ZipFile(io.BytesIO(z.read(inner)))
    frames = {}
    for tab, spec in NEED.items():
        nm = [x for x in zz.namelist() if f'TABLE {tab} ' in x]
        if not nm:
            print(f"    !! {tab} not found")
            continue
        raw = zz.read(nm[0]).decode('utf-8', errors='replace').splitlines()
        rows = {}
        for line in raw:
            try:
                rec = next(csv.reader([line]))
            except Exception:
                continue
            if not rec:
                continue
            m = OACODE.search(rec[0])
            if not m:
                continue
            vals = {}
            for field, idx in spec.items():
                vals[field] = sum(num(rec[i]) if i < len(rec) else 0.0 for i in idx)
            rows[m.group(1)] = vals
        frames[tab] = pd.DataFrame.from_dict(rows, orient='index')
        print(f"    {tab:6} {len(rows):5,} OAs  fields {list(spec)}")
    df = pd.concat(frames.values(), axis=1)
    df.index.name = 'OA_CODE'
    return df


def rates(c):
    """Counts -> the dz21-census-1991 percentage schema."""
    def pct(a, b):
        return 100.0 * a / b.replace(0, np.nan)
    out = pd.DataFrame(index=c.index)
    out['total_pop'] = c['pop']
    out['total_households'] = c['hh']
    out['adults18plus'] = c['adults18plus']
    out['rc_pct'] = pct(c['rc'], c['rel_all'])
    out['protestant_pct'] = pct(c['prot'], c['rel_all'])
    # 2001 OA religion is published as none+not-stated combined; see module docstring
    out['none_relig_pct'] = np.nan
    out['relig_notstated_pct'] = np.nan
    out['none_or_notstated_pct'] = pct(c['none_or_ns'], c['rel_all'])
    out['cb_catholic_pct'] = pct(c['cb_cath'], c['cb_all'])
    out['cb_protestant_pct'] = pct(c['cb_prot'], c['cb_all'])
    out['irish_speak_pct'] = pct(c['irish_speak'], c['ir_all'])
    out['econ_active_pct'] = pct(c['econ_active'], c['ea_all'])
    out['unemployment_pct'] = pct(c['unemployed'], c['econ_active'])
    out['owner_occ_pct'] = pct(c['owner'], c['hh'])
    out['social_rent_pct'] = pct(c['social'], c['hh'])
    out['private_rent_pct'] = pct(c['private'], c['hh'])
    out['no_car_pct'] = pct(c['nocar'], c['c_hh'])
    out['llti_pct'] = pct(c['llti'], c['h_all'])
    out['qualified_pct'] = pct(c['q_all'] - c['noquals'], c['q_all'])
    out['degree_pct'] = pct(c['degree'], c['q_all'])
    return out


COUNTS = ['pop', 'adults18plus', 'rel_all', 'rc', 'prot', 'rel_other', 'none_or_ns',
          'cb_all', 'cb_cath', 'cb_prot', 'h_all', 'llti', 'ea_all', 'econ_active',
          'unemployed', 'q_all', 'noquals', 'degree', 'c_hh', 'nocar', 'hh',
          'owner', 'social', 'private', 'ir_all', 'irish_speak']


def apportion(counts, wfile, src_id, tgt_id):
    w = pd.read_csv(os.path.join(OUT, wfile))
    m = w.merge(counts[COUNTS].reset_index(), left_on=src_id, right_on='OA_CODE',
                how='left')
    for c in COUNTS:
        m[c] = m[c].fillna(0.0) * m.weight
    g = m.groupby(tgt_id)[COUNTS].sum()
    return g


def main():
    print("=" * 78)
    print("PHASE 53 — 2001 census, Output Area level -> DZ2021 and SA2011")
    if not os.path.exists(SRC):
        print(f"  !! source archive not found: {SRC}")
        sys.exit(1)

    print(f"\n  reading Key Statistics at OA level")
    c = read_oa_tables()
    print(f"    combined {c.shape[0]:,} OAs x {c.shape[1]} count fields")
    print(f"    NI population from KS01: {c['pop'].sum():,.0f}  (published 1,685,267)")
    print(f"    NI households from KS18: {c['hh'].sum():,.0f}  (published   626,718)")

    oa = rates(c)
    oa.to_csv(os.path.join(OUT, 'oa2001-census-2001.csv'))
    print(f"\n  wrote oa2001-census-2001.csv  {oa.shape}")

    for wfile, sid, tid, stem, namesrc in [
        ('oa2001_to_dz2021_weights.csv', 'OA_CODE', 'DZ2021_cd', 'dz21-census-2001',
         'DZ2021'),
        ('oa2001_to_sa2011_weights.csv', 'OA_CODE', 'SA2011', 'sa2011-census-2001',
         None),
    ]:
        g = apportion(c, wfile, sid, tid)
        r = rates(g)
        r.index.name = tid
        r = r.reset_index()
        if namesrc == 'DZ2021':
            import geopandas as gpd
            nm = gpd.read_file(os.path.join(HERE, '_geo', 'DZ2021.fgb'))
            r = r.merge(nm[['DZ2021_cd', 'DZ2021_nm']], on='DZ2021_cd', how='left')
            cols = ['DZ2021_cd', 'DZ2021_nm'] + [x for x in r.columns
                                                 if x not in ('DZ2021_cd', 'DZ2021_nm')]
            r = r[cols]
        r.to_csv(os.path.join(OUT, f'{stem}.csv'), index=False)
        print(f"  wrote {stem}.csv  {r.shape}   "
              f"pop {r.total_pop.sum():,.0f}   "
              f"non-null rc_pct {r.rc_pct.notna().sum():,}")

    # ---- sanity: does the 2001 mosaic reproduce known NI-level values? ----
    print("\n  NI-level check (apportioned DZ2021 vs published 2001 figures)")
    d = pd.read_csv(os.path.join(OUT, 'dz21-census-2001.csv'))
    w = d.total_pop
    def wm(col, weights):
        v = d[col]
        ok = v.notna() & (weights > 0)
        return float(np.average(v[ok], weights=weights[ok]))
    for col, pub in [('rc_pct', 40.26), ('protestant_pct', 45.57),
                     ('none_or_notstated_pct', 13.88)]:
        print(f"    {col:24} {wm(col, w):6.2f}%   published {pub:6.2f}%")
    hh = d.total_households
    for col, pub in [('owner_occ_pct', 69.65), ('social_rent_pct', 20.85),
                     ('no_car_pct', 26.45)]:
        print(f"    {col:24} {wm(col, hh):6.2f}%   published {pub:6.2f}%")

    print("\n  comparison of the three vintages, NI-weighted mean")
    c91 = pd.read_csv(os.path.join(OUT, 'dz21-census-1991.csv'))
    print(f"    {'variable':24} {'1991':>8} {'2001':>8}")
    for col in ['rc_pct', 'protestant_pct', 'owner_occ_pct', 'social_rent_pct',
                'private_rent_pct', 'no_car_pct', 'degree_pct', 'unemployment_pct']:
        if col not in c91.columns:
            continue
        a = float(np.average(c91[col].fillna(0), weights=c91.total_pop.fillna(0)))
        b = wm(col, w if 'pct' in col and col.endswith('_pct') else w)
        print(f"    {col:24} {a:8.2f} {b:8.2f}")


if __name__ == '__main__':
    main()
