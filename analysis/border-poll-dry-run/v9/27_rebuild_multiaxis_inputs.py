#!/usr/bin/env python3
"""v9 phase 27 — rebuild the multiaxis poll inputs (sp_<date>.csv).

6_multiaxis_temporal.py reads sp_<date>.csv for four poll dates and pulls the
border-poll question's subgroup rates from them. Those files were transient
scratchpad copies in the environment where 6_ was written; they exist nowhere in
the repo, so 6_ could not be re-run and summary_multiaxis.json / areas_multiaxis/
were committed outputs with no reproducible source.

Reading 6_'s parser shows what they actually were: **the tidy LucidTalk poll CSV
itself**, in the canonical schema (Measure, Response, Statistic, Breakdown
Dimension, Breakdown Category, Value). That is exactly what the persisted corpus
on R2 holds, so the inputs are recoverable rather than lost.

This fetches the four polls from
  https://data.civgraph.net/data/polling/lucidtalk/cleaned/
resolving each date through the corpus manifest (not a hardcoded filename), and
writes v9/sp_<date>.csv.

Verification, so a silently wrong file cannot pass:
  * required columns present
  * a border-poll measure exists (a response set containing both United Ireland
    and a UK-only option), using the same rule as v3/build_unity_rates_from_r2.py
  * all five dimensions 6_ needs (Religion, Age, Gender, SocialGrade, Region)
    yield at least one usable decided rate
"""
import os, csv, io, gzip, json, subprocess, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://data.civgraph.net/data/polling/lucidtalk/cleaned"
DATES = ['2021-01', '2022-08', '2024-02', '2025-02']
NEEDED = ['Measure', 'Response', 'Statistic', 'Breakdown Dimension',
          'Breakdown Category', 'Value']


def get(url):
    r = subprocess.run(["curl", "-fsSL", "--max-time", "120", url],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise SystemExit(f"fetch failed: {url}")
    return r.stdout


def is_ui(s):
    return 'united ireland' in s.lower()


def is_uk(s):
    # exclusive of United Ireland: the unity option is often phrased "LEAVE the
    # UNITED KINGDOM and become part of a UNITED IRELAND" and names both.
    t = s.lower()
    return 'united kingdom' in t and 'united ireland' not in t


def resolve():
    """date -> corpus basename, from the manifest rather than a hardcoded list."""
    man = json.loads(get(f"{BASE}/manifest.json").decode('utf-8'))
    out = {}
    for p in man.get('polls', []):
        t = p.get('time')
        if t in DATES:
            base = p['file'][:-len('.csv.gz')] if p['file'].endswith('.csv.gz') else p['file']
            # prefer the spreadsheet extraction (full crosstabs) when a month has
            # more than one poll file
            if t not in out or 'spreadsheet' in base:
                out[t] = base
    return out


def verify(rows, date):
    cols = set(rows[0].keys())
    missing = [c for c in NEEDED if c not in cols]
    if missing:
        return f"missing columns {missing}"
    resp = defaultdict(set)
    for x in rows:
        resp[x['Measure']].add(x['Response'])
    cands = [m for m, rs in resp.items()
             if any(is_ui(s) for s in rs) and any(is_uk(s) for s in rs)]
    if not cands:
        return "no border-poll measure (no measure offers both UI and UK-only)"
    m = sorted(cands, key=len)[0]
    # Apply the SAME normalisation 6_ does before checking coverage, otherwise the
    # verifier is stricter than the consumer. Corpus defect: in the 2024-02 and
    # 2025-02 extractions the region categories (BELFAST/EAST/NORTH/SOUTH/WEST) are
    # mis-filed under the Age dimension, together with stray party names. 6_ remaps
    # any category named for a region into Region -- that line exists precisely
    # because of this defect -- and its coarse_age() drops the non-numeric strays.
    REG = {'belfast', 'east', 'north', 'south', 'west'}
    dims = defaultdict(set)
    for x in rows:
        if x['Measure'] == m and x['Statistic'] == 'percent':
            dim, cat = x['Breakdown Dimension'], x['Breakdown Category']
            if (cat or '').strip().lower() in REG:
                dim = 'Region'
            dims[dim].add(cat)
    have = {d for d in dims}
    want = {'Religion', 'Age', 'Gender', 'SocialGrade', 'Region'}
    absent = sorted(want - have)
    note = f"measure='{m[:60]}...'  dims={sorted(have)}"
    if absent:
        return f"MISSING DIMENSIONS {absent}  ({note})"
    return None, note


def main():
    idx = resolve()
    print(f"resolved {len(idx)}/{len(DATES)} dates from the corpus manifest")
    for d in DATES:
        if d not in idx:
            raise SystemExit(f"no corpus poll for {d}")
    ok = True
    for d in DATES:
        name = idx[d]
        raw = get(f"{BASE}/{name}.csv.gz")
        text = gzip.decompress(raw).decode('utf-8')
        rows = list(csv.DictReader(io.StringIO(text)))
        res = verify(rows, d)
        if isinstance(res, str):
            print(f"  {d}  {name}  -> FAILED: {res}")
            ok = False
            continue
        _, note = res
        out = os.path.join(HERE, f'sp_{d}.csv')
        with open(out, 'w', encoding='utf-8', newline='') as fh:
            fh.write(text)
        print(f"  {d}  {name}")
        print(f"        rows={len(rows):,}  wrote sp_{d}.csv")
        print(f"        {note}")
    if not ok:
        sys.exit("one or more polls failed verification; sp_*.csv not fully rebuilt")
    print("\nall four multiaxis inputs rebuilt and verified")


if __name__ == '__main__':
    main()
