#!/usr/bin/env python3
"""v9 phase 16 (stage 1) — party-wise results frame.

The existing results_frame.csv is BLOC-level only (nat/uni/oth). This builds the
party-level equivalent from the same source, so a per-party model can be trained
and validated on the same folds.

Source : test/metadata/elections-test2/*.json  (9 NI contests)
           assembly    2016, 2017, 2022     18 constituencies
           westminster 2017, 2019, 2024     18 constituencies
           local       2014, 2019, 2023     80 DEAs
Output : party_results_frame.csv  (long: one row per area x contest x party)
         party_frame_check.csv    (bloc reconstruction vs results_frame.csv)

Every row carries votes, share, seats won and seats available, plus a `stood`
flag -- a party that did not contest an area is NOT a zero-share observation, it
is an absence, and the stage-2 model must treat the two differently.

Self-check: re-aggregating the party shares into the v9 blocs must reproduce
results_frame.csv. Any drift means the extraction diverges from the incumbent
frame and the two models would not be comparable.
"""
import os, json, glob
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

CONTESTS = [
    ('assembly', 'constituency', 2016, 'northern-ireland-assembly__2016-05-05.json'),
    ('assembly', 'constituency', 2017, 'northern-ireland-assembly__2017-03-02.json'),
    ('assembly', 'constituency', 2022, 'northern-ireland-assembly__2022-05-05.json'),
    ('westminster', 'constituency', 2017, 'house-of-commons-of-the-united-kingdom__2017-06-08.json'),
    ('westminster', 'constituency', 2019, 'house-of-commons-of-the-united-kingdom__2019-12-12.json'),
    ('westminster', 'constituency', 2024, 'house-of-commons-of-the-united-kingdom__2024-07-04.json'),
    ('local', 'dea', 2014, 'local-government-local-government-districts__2014-05-22.json'),
    ('local', 'dea', 2019, 'local-government-local-government-districts__2019-05-02.json'),
    ('local', 'dea', 2023, 'local-government-local-government-districts__2023-05-18.json'),
]

# Modelled categories. Independents are pooled: their vote is a personal/candidate
# effect rather than an area-demographic one, so the sub-labels (Ind Unionist /
# Ind Nationalist / Ind Other) are kept only for the bloc cross-check.
IND = {'Independent', 'Independent Other', 'Independent Unionist', 'Independent Nationalist'}
MAIN = ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP', 'Aontú']
PARTIES = MAIN + ['Independent', 'Other']

# v9 bloc definitions, from 1_results_frame.py's docstring -- used ONLY to verify
# this extraction reproduces the incumbent frame.
NAT = {'Sinn Féin', 'SDLP', 'Aontú', 'Independent Nationalist', "Workers' Party", 'IRSP'}
UNI = {'DUP', 'UUP', 'TUV', 'PUP', 'Independent Unionist', 'UKIP', 'Conservative'}


def category(p):
    if p in IND:
        return 'Independent'
    return p if p in MAIN else 'Other'


def bloc(p):
    if p in NAT:
        return 'nat'
    if p in UNI:
        return 'uni'
    return 'oth'


def main():
    rows, blocrows = [], []
    for contest, scale, year, fname in CONTESTS:
        path = os.path.join(META, fname)
        if not os.path.exists(path):
            raise SystemExit(f"missing contest file: {path}")
        d = json.load(open(path, encoding='utf-8'))
        for r in d['results']:
            area = r.get('constituency')
            cands = r.get('candidates') or []
            if not cands:
                continue
            votes, seats, bl = {}, {}, {'nat': 0.0, 'uni': 0.0, 'oth': 0.0}
            for c in cands:
                p = (c.get('party') or '').strip()
                v = float(c.get('firstPrefs') or 0)
                cat = category(p)
                votes[cat] = votes.get(cat, 0.0) + v
                if c.get('elected'):
                    seats[cat] = seats.get(cat, 0) + 1
                bl[bloc(p)] += v
            tot = sum(votes.values())
            if tot <= 0:
                continue
            seats_total = r.get('seatsTotal') or r.get('seatsWon') or 1
            for p in PARTIES:
                stood = p in votes
                rows.append({
                    'contest': contest, 'scale': scale, 'year': year, 'area': area,
                    'party': p,
                    'votes': votes.get(p, 0.0),
                    'share_pct': 100.0 * votes.get(p, 0.0) / tot,
                    'seats_won': seats.get(p, 0),
                    'seats_total': seats_total,
                    'stood': stood,
                    'valid_poll': tot,
                    'electorate': r.get('electorate'),
                    'turnout_pct': r.get('turnoutPct'),
                })
            blocrows.append({'contest': contest, 'scale': scale, 'year': year,
                             'area': area, 'total': tot,
                             **{f'{k}_pct': 100.0 * v / tot for k, v in bl.items()}})

    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, 'party_results_frame.csv'), index=False)
    print(f"wrote party_results_frame.csv  "
          f"({len(df):,} rows = {df.area.nunique()} areas x {len(CONTESTS)} contests "
          f"x {len(PARTIES)} parties)")

    # ---- coverage summary ----
    print("\nparty presence (share of area-contests where the party stood):")
    pres = df.groupby('party').stood.mean().sort_values(ascending=False)
    for p, v in pres.items():
        mn = df[(df.party == p) & df.stood].share_pct.mean()
        print(f"  {p:12} stood in {100*v:5.1f}%   mean share where stood {mn:5.1f}%")

    print("\nseats won (all 9 contests):")
    s = df.groupby('party').seats_won.sum().sort_values(ascending=False)
    print("  " + "  ".join(f"{p}={int(n)}" for p, n in s.items() if n))

    # ---- self-check against the incumbent bloc frame ----
    chk = pd.DataFrame(blocrows)
    old = pd.read_csv(os.path.join(HERE, 'results_frame.csv'))
    old = old[old.contest != 'euref']
    m = chk.merge(old, on=['contest', 'scale', 'year', 'area'],
                  suffixes=('_new', '_old'))
    print(f"\nbloc cross-check vs results_frame.csv: matched {len(m)}/{len(old)} rows")
    for b in ['nat', 'uni', 'oth']:
        d_ = (m[f'{b}_pct_new'] - m[f'{b}_pct_old']).abs()
        print(f"  {b}_pct  max|diff|={d_.max():.3f}  mean|diff|={d_.mean():.4f}")
    dt = (m.total_new - m.total_old).abs()
    print(f"  total   max|diff|={dt.max():.1f}")
    print("  by contest (mean |nat diff|):")
    m['_d'] = (m.nat_pct_new - m.nat_pct_old).abs()
    for (c, y), g in m.groupby(['contest', 'year']):
        flag = "  <-- DIVERGES" if g._d.mean() > 0.01 else ""
        print(f"    {c:12}{y}  mean={g._d.mean():.4f}  max={g._d.max():.3f}{flag}")
    m.drop(columns='_d').to_csv(os.path.join(HERE, 'party_frame_check.csv'), index=False)

    # ---- DEFECT FOUND IN THE INCUMBENT FRAME ----
    # assembly (x3), westminster (x3) and local 2023 reproduce to <=0.005 pt, i.e.
    # rounding. local 2014 and local 2019 do NOT: results_frame.csv carries vote
    # totals that match neither validPoll, nor totalVotes, nor the sum of
    # firstPrefs in the source file (e.g. Bangor Central 2019: source 7,357 on all
    # three measures, incumbent frame 6,479). Because bloc shares are computed
    # over that understated denominator, the labels are distorted too -- up to
    # 20 pts on nat_pct (The Mournes 2019: 52.2 actual vs 72.5 in the frame).
    #
    # This matters beyond the party work: 2 of the 3 local contests the v9 bloc
    # model TRAINS on are affected, so the published 4.94 LOCO MAE rests partly on
    # bad labels. A corrected bloc frame is emitted here for that comparison; it is
    # written alongside rather than over results_frame.csv so the incumbent model
    # is not silently changed.
    corrected = chk[['contest', 'scale', 'year', 'area', 'nat_pct', 'uni_pct',
                     'oth_pct', 'total']].copy()
    euref = pd.read_csv(os.path.join(HERE, 'results_frame.csv'))
    euref = euref[euref.contest == 'euref']
    corrected = pd.concat([corrected, euref], ignore_index=True)
    corrected.to_csv(os.path.join(HERE, 'results_frame_corrected.csv'), index=False)
    bad = m[m._d.abs() > 2] if '_d' in m else None
    print(f"\nwrote results_frame_corrected.csv "
          f"(rebuilt from source; {int((m.total_new != m.total_old).sum())} of "
          f"{len(m)} rows had a wrong vote total in the incumbent frame)")


if __name__ == '__main__':
    main()
