#!/usr/bin/env python3
"""v9 phase 49 — mixed-channel flip cost: conversion, demobilisation, mobilisation.

Phase 48 was under-specified in three ways, all of them real:

  1. It forced every needed vote through ONE donor party to ONE challenger party.
     Actual movement is a mixture drawn from whichever sources are cheapest first.
  2. It ignored DEMOBILISATION entirely -- a pro-union or Alliance voter who simply
     stops voting also narrows the gap, and never appears as a switcher.
  3. It ignored MOBILISATION of non-voters, despite non-voters having the highest
     observed transition rate of any group (22.4% to the pro-unity bloc).

It also applied each party's AVERAGE switching rate, which treats every DUP voter as
equally hard. In reality there is a distribution, and a campaign recruits the most
persuadable first -- so the marginal cost rises as a channel is drawn down. That is
modelled here as a hard pool limit per channel rather than a rising curve, which is
the conservative simplification.

Efficiency per lever, from the pooled LucidTalk switching matrix. A CONVERSION moves
a vote off the rival and onto the bloc, closing two votes of gap; demobilisation and
mobilisation each close one:

    Green    -> pro-unity   12.9%   3.9 voters per vote of gap
    Alliance -> pro-unity   11.4%   4.4
    non-voter-> pro-unity   22.4%   4.5      <- as cheap as Alliance, far bigger pool
    UUP      -> pro-unity    1.6%  31.6
    DUP      -> pro-unity    1.3%  37.5
    DUP      -> stops voting 1.9%  53.6      <- demobilisation is REAL but inefficient
    TUV      -> pro-unity    0.3% 154.6

The headline consequence: converting a DUP voter is CHEAPER than demobilising one,
despite the lower rate, because conversion is worth double. Demobilisation is a
genuine channel, not a free one.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


stv = _load('stv19', '19_stv_simulator.py')
c45 = _load('c45', '45_counterfactual_46.py')
M = json.load(open(os.path.join(HERE, 'switching_matrix.json'), encoding='utf-8'))
BLOC = ['Sinn Féin', 'SDLP', 'PBP', 'Aontú']
NONBLOC = ['DUP', 'UUP', 'TUV', 'Alliance', 'Green']


def levers():
    """(label, source, voters-per-vote-of-gap) sorted cheapest first."""
    out = []
    for s in NONBLOC:
        p = sum(M.get(s, {}).get(b, 0) for b in BLOC)
        if p > 0:
            out.append((f'{s}->bloc', s, 1.0 / (2 * p), 'convert', p))
        q = M.get(s, {}).get('DidNotVote', 0)
        if q > 0:
            out.append((f'{s}->abstain', s, 1.0 / q, 'demob', q))
    p = sum(M.get('DidNotVote', {}).get(b, 0) for b in BLOC)
    if p > 0:
        out.append(('nonvoter->bloc', 'DidNotVote', 1.0 / p, 'mobilise', p))
    return sorted(out, key=lambda r: r[2])


def main():
    L = levers()
    print("=" * 78)
    print("MIXED-CHANNEL FLIP COST — cheapest combination, pools respected")

    contests = stv.load_contest('assembly', 2022, c45.FILE)
    rows = []
    for cd in contests:
        el, quota, _ = stv.run_stv(cd['names'], cd['parties'], cd['fp'],
                                   cd['seats'], cd['valid'])
        donors = [i for i in cd['actual'] if i in el
                  and cd['parties'][i] in c45.UNIONIST | c45.NONALIGNED]
        chall = [i for i in range(len(cd['names']))
                 if i not in cd['actual'] and i not in el
                 and cd['parties'][i] in c45.BLOC]
        best = None
        for d in donors:
            for c in chall:
                x = c45.flips_needed(cd, d, c)
                if x is None:
                    continue
                if best is None or x < best[0]:
                    best = (x, d, c)
        if best is None:
            continue
        x, d, c = best
        # gap to close, in "vote units": a pure donor->challenger conversion of V
        # votes flips the seat, and each such vote is worth two, so G = 2V
        V = x * cd['valid']
        G = 2 * V
        # pools, in votes
        pv = collections.defaultdict(float)
        for i, p in enumerate(cd['parties']):
            pv[p] += cd['fp'][i]
        electorate = float(cd.get('valid') or 0)
        # non-voter pool: electorate is not in load_contest, so approximate from
        # the observed turnout shortfall using the contest's own electorate field
        pool = {'DidNotVote': np.nan}
        for s in NONBLOC:
            pool[s] = pv.get(s, 0.0)
        rows.append({'area': cd['area'], 'gap': G, 'conv_votes': V,
                     'donor': cd['parties'][d], 'gain': cd['parties'][c],
                     **{f'pool_{s}': pool[s] for s in NONBLOC}})
    df = pd.DataFrame(rows)

    # attach electorate / non-voter pool from the raw file
    raw = json.load(open(os.path.join(stv.META, c45.FILE), encoding='utf-8'))
    elec = {r['constituency']: (float(r.get('electorate') or 0),
                                float(r.get('validPoll') or 0))
            for r in raw['results']}
    df['electorate'] = df.area.map(lambda a: elec.get(a, (0, 0))[0])
    df['valid'] = df.area.map(lambda a: elec.get(a, (0, 0))[1])
    df['pool_DidNotVote'] = (df.electorate - df.valid).clip(lower=0)

    def cheapest(row):
        need, cost, used = row.gap, 0.0, []
        for lab, src, per, kind, p in L:
            if need <= 0:
                break
            avail = row.get(f'pool_{src}', 0.0)
            if not np.isfinite(avail) or avail <= 0:
                continue
            # a conversion closes 2 gap per voter moved; others close 1
            gap_per_vote = 2.0 if kind == 'convert' else 1.0
            # CEILING: only p of that pool will EVER make this transition, so the
            # votes obtainable are pool*p, not pool. Capping on votes moved instead
            # of voters available lets a channel yield more than it contains.
            take_votes = min(avail * p, need / gap_per_vote)
            if take_votes <= 0:
                continue
            need -= take_votes * gap_per_vote
            cost += take_votes * (per * gap_per_vote)
            used.append(f"{lab}:{take_votes:,.0f}")
        return pd.Series({'reach': cost if need <= 1e-6 else np.inf,
                          'mix': ' + '.join(used[:3])})

    df = pd.concat([df, df.apply(cheapest, axis=1)], axis=1)
    df = df.sort_values('reach').reset_index(drop=True)
    df.to_csv(os.path.join(HERE, 'mixed_channel_seats.csv'), index=False)

    print(f"\n  {'#':>2} {'constituency':26} {'gap':>7} {'reach':>9}  cheapest mixture")
    for i, r in df.iterrows():
        print(f"  {i+1:2} {r.area:26} {r.gap:7.0f} {r.reach:9.0f}  {r.mix}")

    top = df.head(10)
    print(f"\n  TOP TEN total voters to reach: {top.reach.sum():,.0f}")
    print(f"  (phase 48, single-channel: 283,200 -- the mixture is "
          f"{100*(1-top.reach.sum()/283200):.0f}% cheaper)")
    print("\n  channel usage across the top ten:")
    cnt = collections.Counter()
    for m in top.mix:
        for part in m.split(' + '):
            cnt[part.split(':')[0]] += 1
    for k, v in cnt.most_common():
        print(f"    {k:24} used in {v} of 10")


if __name__ == '__main__':
    main()
