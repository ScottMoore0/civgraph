#!/usr/bin/env python3
"""v9 phase 28 — party voting-intention polls as the NI LEVEL input.

The gap this closes. The party model takes each contest's NI level from the mean of
the TRAINING areas of that same contest. That is fine for backtesting, where the
contest is observed, but it means the model cannot forecast an election that has
not happened: it can produce the geographic shape and nothing about whether Sinn
Fein is nationally on 24% or 31%. The unity model solved this long ago -- surveys
set the level, census sets the geography, elections calibrate the house effect --
and the same ingredients exist here.

Source: the persisted LucidTalk corpus,
        data.civgraph.net/data/polling/lucidtalk/cleaned/  (36 polls, 2012-2026)
Selection rule (matching the corpus's own framing):
        the Assembly voting-intention tracker measure, Breakdown Dimension 'Total',
        Statistic 'percent', Base Type 'exc_DK' (decided voters) where published.

Calibration: per-party house effect estimated LEAVE-ONE-CONTEST-OUT against real
results, so no contest helps calibrate itself.

NOTE ON A PRIOR DEFECT: 8_backtest.py read v6/lucidtalk_vi_primary.json with no
encoding. On Windows that decodes UTF-8 as cp1252, turning "Sinn Fein" into
"Sinn FÃ©in" and "Aontu" into "AontÃº", so both lookups returned 0 and the
"nationalist bloc" was SDLP alone. It reported a house effect of -20.45 pts and
concluded the polls were unusable. The true figure is about -2.5. That is fixed;
this phase rests on the corrected reading.
"""
import os, io, csv, gzip, json, subprocess, sys
from collections import defaultdict
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://data.civgraph.net/data/polling/lucidtalk/cleaned"
CACHE = os.path.join(HERE, '_lt_cache')
os.makedirs(CACHE, exist_ok=True)

PARTIES = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP',
           'Aontú', 'Independent', 'Other']
ADMIN = ("don't know", "dont know", "not sure", "wouldn't vote", "wouldnt vote",
         "would not vote", "spoil", "none - i", "none  i", "none i wouldn",
         "refused", "will not vote", "undecided")
# 2022-01's published Total carries no Sinn Fein row at all in either base type --
# an incomplete extraction, not a real zero. Including it would invent a collapse.
EXCLUDE_POLLS = {'2022-01'}


def get(url):
    r = subprocess.run(["curl", "-fsSL", "--max-time", "120", url], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    return r.stdout


def canon(resp):
    r = (resp or '').lower().strip()
    if r == 'sf':
        return 'Sinn Féin'
    if r.startswith('dup') or 'democratic unionist' in r:
        return 'DUP'
    if 'sinn f' in r:
        return 'Sinn Féin'
    if r.startswith('uup') or 'ulster unionist' in r:
        return 'UUP'
    if r.startswith('sdlp') or 'social democratic' in r:
        return 'SDLP'
    if r.startswith('alliance'):
        return 'Alliance'
    if r.startswith('tuv') or 'traditional unionist' in r:
        return 'TUV'
    if 'green' in r:
        return 'Green'
    if 'people before profit' in r or r == 'pbp':
        return 'PBP'
    if 'aont' in r:
        return 'Aontú'
    if 'independent' in r or r == 'ind':
        return 'Independent'
    return 'Other'


def poll_vi(rows):
    """Decided-voter party VI from one poll, or None if it carries no VI question."""
    bym = defaultdict(list)
    for x in rows:
        bym[x.get('Measure', '')].append(x)
    cand = [m for m in bym
            if 'held tomorrow' in m.lower() and 'assembly' in m.lower()]
    if not cand:
        cand = [m for m in bym if 'assembly election voting intention' in m.lower()]
    if not cand:
        return None
    for m in sorted(cand, key=len):
        for base in ('exc_DK', None):
            tot = {}
            for x in bym[m]:
                if x.get('Breakdown Dimension') != 'Total':
                    continue
                if x.get('Statistic') != 'percent':
                    continue
                if base and x.get('Base Type') != base:
                    continue
                resp = (x.get('Response Label') or x.get('Response') or '').strip()
                if any(a in resp.lower() for a in ADMIN):
                    continue
                try:
                    v = float(x.get('Value'))
                except (TypeError, ValueError):
                    continue
                tot[canon(resp)] = tot.get(canon(resp), 0.0) + v
            if tot and sum(tot.values()) > 50 and tot.get('Sinn Féin', 0) > 0:
                s = sum(tot.values())
                return {p: 100.0 * tot.get(p, 0.0) / s for p in PARTIES}
    return None


def build_series():
    man = json.loads(get(f"{BASE}/manifest.json").decode('utf-8'))
    out = {}
    for p in man.get('polls', []):
        t = p.get('time')
        if not t or t in EXCLUDE_POLLS:
            continue
        base = p['file'][:-len('.csv.gz')] if p['file'].endswith('.csv.gz') else p['file']
        cf = os.path.join(CACHE, base + '.csv')
        if os.path.exists(cf):
            text = open(cf, encoding='utf-8').read()
        else:
            raw = get(f"{BASE}/{base}.csv.gz")
            if raw is None:
                continue
            text = gzip.decompress(raw).decode('utf-8')
            open(cf, 'w', encoding='utf-8').write(text)
        vi = poll_vi(list(csv.DictReader(io.StringIO(text))))
        if vi:
            out.setdefault(t, vi)
    return dict(sorted(out.items()))


CONTEST_DATE = {'assembly2016': '2016-05', 'assembly2017': '2017-03',
                'assembly2022': '2022-05', 'westminster2017': '2017-06',
                'westminster2019': '2019-12', 'westminster2024': '2024-07',
                'local2014': '2014-05', 'local2019': '2019-05', 'local2023': '2023-05'}


def nearest(series_dates, target):
    ty, tm = int(target[:4]), int(target[5:7])
    best, bd = None, 1e9
    for d in series_dates:
        y, m = int(d[:4]), int(d[5:7])
        dist = abs((y * 12 + m) - (ty * 12 + tm))
        if dist < bd:
            best, bd = d, dist
    return best, bd


def main():
    series = build_series()
    print(f"party VI recovered from {len(series)} polls: "
          f"{min(series)} .. {max(series)}")
    pd.DataFrame(series).T.to_csv(os.path.join(HERE, 'lucidtalk_party_vi.csv'))

    frame = pd.read_csv(os.path.join(HERE, 'party_results_frame.csv'))
    frame['cy'] = frame.contest + frame.year.astype(str)
    actual = {}
    for cy, g in frame.groupby('cy'):
        w = g.groupby('party').apply(
            lambda d: np.average(d.share_pct, weights=d.valid_poll),
            include_groups=False)
        actual[cy] = w.to_dict()

    print(f"\n{'contest':16} {'poll':8} {'gap':>4}  per-party |err| (uncalibrated)")
    rows = []
    for cy, tgt in CONTEST_DATE.items():
        if cy not in actual:
            continue
        pd_, gap = nearest(series, tgt)
        if pd_ is None or gap > 12:
            print(f"  {cy:16} no poll within 12 months")
            continue
        vi, act = series[pd_], actual[cy]
        errs = {p: vi.get(p, 0) - act.get(p, 0) for p in PARTIES}
        mae = np.mean([abs(v) for v in errs.values()])
        rows.append({'cy': cy, 'poll': pd_, 'gap': gap, **{f'e_{p}': errs[p] for p in PARTIES}})
        print(f"  {cy:16} {pd_:8} {gap:3}m  MAE={mae:5.2f}  "
              f"DUP{errs['DUP']:+5.1f} SF{errs['Sinn Féin']:+5.1f} "
              f"All{errs['Alliance']:+5.1f} UUP{errs['UUP']:+5.1f}")
    E = pd.DataFrame(rows).set_index('cy')
    E.to_csv(os.path.join(HERE, 'party_vi_house_effects.csv'))

    # ---- leave-one-contest-out calibration ----
    print("\nLEAVE-ONE-CONTEST-OUT: house effect from the OTHER contests only")
    print(f"  {'contest':16} {'raw MAE':>8} {'calibrated MAE':>15} {'persistence':>12}")
    raw_all, cal_all, per_all = [], [], []
    for cy in E.index:
        others = E.drop(index=cy)
        he = {p: others[f'e_{p}'].mean() for p in PARTIES}
        vi = series[E.loc[cy, 'poll']]
        act = actual[cy]
        raw = np.mean([abs(vi.get(p, 0) - act.get(p, 0)) for p in PARTIES])
        cal = np.mean([abs((vi.get(p, 0) - he[p]) - act.get(p, 0)) for p in PARTIES])
        # persistence baseline: NI level from the other contests of any type
        per = np.mean([abs(np.mean([actual[c].get(p, 0) for c in actual if c != cy])
                           - act.get(p, 0)) for p in PARTIES])
        raw_all.append(raw); cal_all.append(cal); per_all.append(per)
        print(f"  {cy:16} {raw:8.2f} {cal:15.2f} {per:12.2f}")
    print(f"  {'MEAN':16} {np.mean(raw_all):8.2f} {np.mean(cal_all):15.2f} "
          f"{np.mean(per_all):12.2f}")

    print("\nmean house effect by party (poll minus actual, all contests):")
    for p in PARTIES:
        print(f"  {p:12} {E[f'e_{p}'].mean():+6.2f}  (sd {E[f'e_{p}'].std():.2f})")
    json.dump({'house_effect': {p: float(E[f'e_{p}'].mean()) for p in PARTIES},
               'n_contests': int(len(E))},
              open(os.path.join(HERE, 'party_vi_calibration.json'), 'w'), indent=1)
    print("\nwrote lucidtalk_party_vi.csv, party_vi_house_effects.csv, "
          "party_vi_calibration.json")


if __name__ == '__main__':
    main()
