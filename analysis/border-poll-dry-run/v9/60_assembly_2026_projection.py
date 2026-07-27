#!/usr/bin/env python3
"""v9 phase 60 — projected NI Assembly election, 2026-08-03, on the 2023 boundaries.

Inputs: the LucidTalk Summer 2026 tracker poll (2026-07), the 2022 Assembly result
re-expressed on 2023 boundaries (phase 32 notional), 2023-boundary electorates from the
2024 Westminster file, the measured poll house effects (phase 28) and the transfer
matrix + PR-STV engine (phases 18-19).

THE CHAIN, and where each link's number actually comes from:

    poll (10 numbers)
      -> house-effect correction        measured, Assembly contests at ~1 month lead
      -> NI-wide first preferences
      -> proportional swing from the 2022 notional     <- ALL geography enters here
      -> constituency first-preference shares
      -> electorate x turnout -> total poll -> spoiled -> valid poll
      -> nominations (quota arithmetic)
      -> PR-STV count with the estimated transfer matrix
      -> seats

HOUSE EFFECTS. e = poll - actual, verified against 2022 (LucidTalk had DUP 17.0 against
an actual 21.3, and e_DUP is -4.33). So the correction is actual = poll - e. Only the
two Assembly contests polled at a ~1 month lead are used, because that matches a
one-week horizon; assembly2016 was polled 8 months out and is reported as sensitivity
only. LucidTalk systematically UNDERSTATES DUP and Sinn Fein at Assembly elections,
which is why the corrected figures move against the headline.

WHY PROPORTIONAL SWING FROM THE NOTIONAL. The forward-only holdout showed persistence
is the strongest single predictor and that its absence is what collapsed the 2024
Westminster projection (94.4% -> 55.6% winner accuracy on new boundaries). The 2022
Assembly notional is the only Assembly-shaped persistence available on 2023 boundaries.
Swing is applied multiplicatively and renormalised, not additively, so no constituency
can be driven negative.

WHAT THIS CANNOT DO, stated before the numbers. The poll carries no crossbreaks, so it
sets the NI level and contributes nothing geographic. Per-constituency seat error in the
forward-only holdout was 0.89-1.89 seats on Assembly contests. TUV at 12% and Green at
5% are outside the range the model has ever observed. Treat constituency seat counts as
indicative and the NI totals as the defensible output.
"""
import os, sys, json, importlib.util, collections
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
SEATS = 5          # every Assembly constituency returns 5 members
POLL = '2026-07'
ELECTION_DATE = '2026-08-03'


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
stv = _load('stv19', '19_stv_simulator.py')
PARTIES = pm.PARTIES


def ni_wide():
    """Poll -> house-effect-corrected NI first preferences."""
    vi = pd.read_csv(os.path.join(HERE, 'lucidtalk_party_vi.csv'), index_col=0)
    poll = vi.loc[POLL]
    he = pd.read_csv(os.path.join(HERE, 'party_vi_house_effects.csv'))
    asm = he[he.cy.str.startswith('assembly') & (he.gap <= 1)]
    eff = {p: float(asm[f'e_{p}'].mean()) if f'e_{p}' in asm.columns else 0.0
           for p in PARTIES}
    # The poll reports "Independents & others" as ONE figure, so Independent and Other
    # cannot carry separate house effects -- doing so invents an Independent vote out of
    # a zero and drives Other negative. They are corrected as a single bucket and then
    # split on the 2022 notional's own ratio.
    BUCKET = ['Independent', 'Other']
    corrected = {p: max(poll.get(p, 0.0) - eff[p], 0.0)
                 for p in PARTIES if p not in BUCKET}
    b_poll = sum(poll.get(p, 0.0) for p in BUCKET)
    b_eff = sum(eff[p] for p in BUCKET)
    b_corr = max(b_poll - b_eff, 0.0)
    n = pd.read_csv(os.path.join(HERE, 'notional', 'assembly2022__on2023.csv'), index_col=0)
    b_base = {p: float(n[p].mean()) if p in n.columns else 0.0 for p in BUCKET}
    b_sum = sum(b_base.values()) or 1.0
    for p in BUCKET:
        corrected[p] = b_corr * b_base[p] / b_sum
    tot = sum(corrected.values())
    corrected = {p: 100.0 * corrected[p] / tot for p in PARTIES}
    eff['__bucket__'] = b_eff
    return poll, eff, corrected, len(asm)


def constituency_shares(corrected):
    """2022 notional on 2023 boundaries, swung proportionally to the new NI level."""
    n = pd.read_csv(os.path.join(HERE, 'notional', 'assembly2022__on2023.csv'), index_col=0)
    n = n.reindex(columns=PARTIES).fillna(0.0)
    # the notional's own NI level, weighted by each seat's electorate
    el = electorates()
    w = pd.Series({a: el.get(a, {}).get('electorate', 0) for a in n.index}, dtype=float)
    base = {p: float(np.average(n[p], weights=w)) for p in PARTIES}
    swing = {p: (corrected[p] / base[p] if base[p] > 0.01 else
                 (corrected[p] / 0.5 if corrected[p] > 0 else 0.0)) for p in PARTIES}
    out = n.copy()
    for p in PARTIES:
        out[p] = out[p] * swing[p]
    out = 100.0 * out.div(out.sum(axis=1), axis=0)
    # rake so the electorate-weighted NI total reproduces the corrected poll exactly
    for _ in range(200):
        cur = {p: float(np.average(out[p], weights=w)) for p in PARTIES}
        err = max(abs(cur[p] - corrected[p]) for p in PARTIES)
        if err < 0.01:
            break
        for p in PARTIES:
            if cur[p] > 1e-9:
                out[p] = out[p] * (corrected[p] / cur[p])
        out = 100.0 * out.div(out.sum(axis=1), axis=0)
    return out, base, swing, w


def electorates():
    """2023-boundary electorate, turnout and spoiled rate, from the 2024 Westminster file."""
    d = json.load(open(os.path.join(
        META, 'house-of-commons-of-the-united-kingdom__2024-07-04.json'), encoding='utf-8'))
    out = {}
    for r in d['results']:
        a = str(r['constituency']).upper().strip()
        elec = float(r.get('electorate') or 0)
        poll_ = float(r.get('totalPoll') or 0)
        sp = float(r.get('spoiled') or 0)
        out[a] = {'electorate': elec,
                  'w_turnout': 100.0 * poll_ / elec if elec else 0.0,
                  'w_spoiled_pct': 100.0 * sp / poll_ if poll_ else 0.0}
    return out


def assembly_levels():
    """NI-level Assembly vs Westminster turnout and spoiled, to scale 2024 onto Assembly."""
    a = json.load(open(os.path.join(META, 'northern-ireland-assembly__2022-05-05.json'),
                       encoding='utf-8'))
    e = sum(float(r.get('electorate') or 0) for r in a['results'])
    tp = sum(float(r.get('totalPoll') or 0) for r in a['results'])
    sp = sum(float(r.get('spoiled') or 0) for r in a['results'])
    w = json.load(open(os.path.join(
        META, 'house-of-commons-of-the-united-kingdom__2024-07-04.json'), encoding='utf-8'))
    we = sum(float(r.get('electorate') or 0) for r in w['results'])
    wtp = sum(float(r.get('totalPoll') or 0) for r in w['results'])
    wsp = sum(float(r.get('spoiled') or 0) for r in w['results'])
    return {'a_turnout': 100 * tp / e, 'w_turnout': 100 * wtp / we,
            'a_spoiled': 100 * sp / tp, 'w_spoiled': 100 * wsp / wtp}


def nominations(share, seats):
    """Phase 21's validated baseline: CEIL of expected quotas.

    A party on share s in an M-seat area expects s*(M+1)/100 quotas and nominates about
    that many, rounded UP -- parties over-nominate to leave room for transfers. Rounding
    to nearest instead produced 7.8 candidates per constituency against the 13.3 actually
    nominated in 2022, and with only ~8 candidates for 5 seats the count elects nearly
    everyone, handing seats to parties that could not win them.
    """
    if share <= 0:
        return 0
    q = share * (seats + 1) / 100.0
    # Ceil alone is wrong here and produced a demonstrable impossibility: TUV on 17.1%
    # in Strangford (1.03 quotas) was given 2 candidates, split into 8.6% each, and won
    # NOTHING -- despite 17.1% exceeding the 16.7% quota, which elects on the first
    # count. It happens because the transfer matrix has no TUV->TUV retention (TUV has
    # never run two candidates anywhere, so none was ever observed), so the eliminated
    # running mate leaks 61% to the DUP instead of to their own party.
    # A party only splits when it can sustain the split: the second candidate needs a
    # real fraction of a quota behind them, not a rounding artefact.
    return max(1, min(int(np.floor(q + 0.7)), seats))


def main():
    print("=" * 92)
    print(f"PROJECTED NI ASSEMBLY ELECTION — {ELECTION_DATE}, 2023 boundaries, 18 x 5 = 90 seats")

    poll, eff, corrected, n_asm = ni_wide()
    print(f"\n  NI-wide first preferences  (house effects from {n_asm} Assembly contests "
          f"polled at <=1 month)")
    print(f"    {'party':12} {'poll':>7} {'house eff':>10} {'corrected':>10}")
    for p in PARTIES:
        if poll.get(p, 0) or corrected[p]:
            print(f"    {p:12} {poll.get(p,0):6.1f}% {eff[p]:+10.2f} {corrected[p]:9.1f}%")

    shares, base, swing, w = constituency_shares(corrected)
    lv = assembly_levels()
    el = electorates()
    t_ratio = lv['a_turnout'] / lv['w_turnout']
    s_ratio = lv['a_spoiled'] / lv['w_spoiled']
    print(f"\n  turnout: 2022 Assembly {lv['a_turnout']:.1f}% vs 2024 Westminster "
          f"{lv['w_turnout']:.1f}%  -> ratio {t_ratio:.3f} applied to 2024 per-seat turnout")
    print(f"  spoiled: 2022 Assembly {lv['a_spoiled']:.2f}% vs 2024 Westminster "
          f"{lv['w_spoiled']:.2f}%  -> ratio {s_ratio:.3f}")

    rows, seat_tot = [], collections.Counter()
    for area in shares.index:
        e = el.get(area)
        if not e:
            print(f"    WARNING no electorate for {area}")
            continue
        turnout = e['w_turnout'] * t_ratio
        total_poll = e['electorate'] * turnout / 100.0
        sp_pct = e['w_spoiled_pct'] * s_ratio
        spoiled = total_poll * sp_pct / 100.0
        valid = total_poll - spoiled
        sh = shares.loc[area]
        names, parties, fps = [], [], []
        for p in PARTIES:
            k = nominations(float(sh[p]), SEATS)
            for i in range(k):
                names.append(f'{p} {i+1}')
                parties.append(p)
                fps.append(valid * float(sh[p]) / 100.0 / k)
        # run_stv returns (elected indices, quota, final votes)
        elected, quota, _fv = stv.run_stv(names, parties, fps, SEATS, valid=valid)
        won = collections.Counter(parties[i] for i in elected)
        for p, c in won.items():
            seat_tot[p] += c
        rows.append({'constituency': area, 'electorate': int(round(e['electorate'])),
                     'turnout_pct': round(turnout, 2),
                     'total_poll': int(round(total_poll)),
                     'spoiled': int(round(spoiled)), 'valid_poll': int(round(valid)),
                     'candidates': len(names), 'seats': SEATS,
                     **{f'fp_{p}': int(round(valid * float(sh[p]) / 100.0)) for p in PARTIES},
                     **{f'pct_{p}': round(float(sh[p]), 2) for p in PARTIES},
                     **{f'seats_{p}': won.get(p, 0) for p in PARTIES}})

    df = pd.DataFrame(rows).set_index('constituency')
    df.to_csv(os.path.join(HERE, 'assembly2026_projection.csv'))

    print(f"\n  {'constituency':28} {'electors':>9} {'turn%':>6} {'valid':>8}  seats")
    for a, r in df.iterrows():
        s = ' '.join(f"{p.split()[0][:3]}{r[f'seats_{p}']}" for p in PARTIES
                     if r[f'seats_{p}'])
        print(f"  {a[:28]:28} {r.electorate:9,} {r.turnout_pct:6.1f} {r.valid_poll:8,}  {s}")

    tot_e = df.electorate.sum(); tot_p = df.total_poll.sum()
    tot_s = df.spoiled.sum(); tot_v = df.valid_poll.sum()
    print(f"\n  NI TOTALS   electors {tot_e:,}   turnout {100*tot_p/tot_e:.1f}%   "
          f"poll {tot_p:,}   spoiled {tot_s:,} ({100*tot_s/tot_p:.2f}%)   valid {tot_v:,}")
    print(f"\n  {'party':12} {'first prefs':>12} {'share':>7} {'seats':>6}   2022 seats")
    a22 = {'Sinn Féin': 27, 'DUP': 25, 'Alliance': 17, 'UUP': 9, 'SDLP': 8,
           'TUV': 1, 'PBP': 1, 'Independent': 2, 'Green': 0, 'Aontú': 0, 'Other': 0}
    for p in PARTIES:
        fp = df[f'fp_{p}'].sum()
        if fp or seat_tot[p]:
            print(f"    {p:12} {fp:12,} {100*fp/tot_v:6.1f}% {seat_tot[p]:6}   "
                  f"{a22.get(p,0):+d} -> {seat_tot[p]-a22.get(p,0):+d}")
    print(f"    {'TOTAL':12} {tot_v:12,} {100:6.1f}% {sum(seat_tot.values()):6}")
    print(f"\n  wrote assembly2026_projection.csv")


if __name__ == '__main__':
    main()
