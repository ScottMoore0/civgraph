#!/usr/bin/env python3
"""Refresh one poll's row in v9/lucidtalk_party_vi.csv from a cleaned poll CSV.

WHY THIS EXISTS. Phase 28 builds the party voting-intention series from the LucidTalk
corpus on R2, driven by that corpus's manifest. A poll that has been scraped locally but
not published to R2 is absent from the manifest, so phase 28 cannot see it and the
projection keeps running on whatever placeholder is in the row -- for 2026-07 that was the
rounded headline (DUP 15, SF 22, UUP 16 ...) taken off the news page before the full
tables existed.

WHY NOT JUST EDIT THE CSV. The row has to be built the way every other row was built, or
the series stops being comparable with itself. So phase 28's own canon() and poll_vi() are
imported and applied here -- same measure selection ('held tomorrow' + 'assembly'), same
preference for the exc_DK base, same party canonicalisation, same renormalisation to 100.
Nothing about the method is reimplemented; only the source of the rows differs.

WHY NOT RE-RUN PHASE 28. It would rebuild the whole series and the house-effect table from
the network for all 36 polls, risking drift in rows that are not supposed to change. This
touches exactly one row and prints the before/after so the change is auditable.

Usage:
    python scripts/polls/refresh_lucidtalk_vi_row.py 2026-07
    python scripts/polls/refresh_lucidtalk_vi_row.py 2026-07 --check
"""
import os, csv, sys, argparse, importlib.util

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
V9 = os.path.join(REPO, 'analysis', 'border-poll-dry-run', 'v9')
VI = os.path.join(V9, 'lucidtalk_party_vi.csv')


def phase28():
    p = os.path.join(V9, '28_party_vi_level.py')
    spec = importlib.util.spec_from_file_location('phase28', p)
    m = importlib.util.module_from_spec(spec)
    sys.modules['phase28'] = m
    spec.loader.exec_module(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('code', help='poll code as it appears in the VI index, e.g. 2026-07')
    ap.add_argument('--source', default=None,
                    help='cleaned poll CSV (default: v9/_lt_cache/<code>-spreadsheet.csv)')
    ap.add_argument('--check', action='store_true', help='report, write nothing')
    a = ap.parse_args()

    src = a.source or os.path.join(V9, '_lt_cache', f'{a.code}-spreadsheet.csv')
    if not os.path.exists(src):
        raise SystemExit(f'  no cleaned poll at {src}')

    m = phase28()
    rows = list(csv.DictReader(open(src, encoding='utf-8')))
    vi = m.poll_vi(rows)
    if not vi:
        raise SystemExit('  phase 28 found no Assembly voting-intention question in that file')

    df = pd.read_csv(VI, index_col=0)
    known = a.code in df.index
    print(f'  {os.path.basename(src)} -> row {a.code} ({"replacing" if known else "new"})')
    print(f"    {'party':12} {'before':>9} {'after':>9} {'delta':>8}")
    for p in m.PARTIES:
        new = vi[p]
        old = float(df.loc[a.code, p]) if known and p in df.columns else float('nan')
        d = new - old if known else float('nan')
        print(f'    {p:12} {old:9.2f} {new:9.2f} {d:+8.2f}')
    tot = sum(vi.values())
    print(f"    {'SUM':12} {'':>9} {tot:9.2f}")
    if abs(tot - 100) > 0.01:
        raise SystemExit(f'  refusing to write: shares sum to {tot:.4f}, not 100')

    if a.check:
        print('\n  --check: nothing written')
        return
    for p in m.PARTIES:
        df.loc[a.code, p] = vi[p]
    df.sort_index().to_csv(VI)
    print(f'\n  wrote {VI}')
    print('  NEXT: re-run 60_assembly_2026_projection.py then 61_assembly_2026_map.py')


if __name__ == '__main__':
    main()
