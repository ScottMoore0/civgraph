#!/usr/bin/env python3
"""Full level x shape backtest for the pre-NILT era (1989/93/97 local elections, 26 councils).
SHAPE = 1991 census Catholic% gradient (validated in backtest_councils_1989: R2~0.89).
LEVEL = NISA 1989-96 (the only survey for the era) -- but NISA measures CONSTITUTIONAL PREFERENCE
(% reunify), not vote. This test asks whether NISA can anchor the NI-wide nationalist VOTE level, and
scores the combined pipeline (NISA level + census shape) against the actual council results."""
import json, numpy as np, pandas as pd
H="analysis/border-poll-dry-run/v9/hist"
d=pd.read_csv(f"{H}/backtest_councils_1989.csv")           # year,district,cath91,nat_pct,votes
nisa=pd.read_csv(f"{H}/nisa_reunify.csv")                  # year,reunify_overall,...
# match each election to its nearest NISA year (NISA ends 1996)
NISA_YEAR={1989:1989,1993:1993,1997:1996}
nisa_ov=dict(zip(nisa['year'],nisa['reunify_overall']))

# actual NI-wide nationalist vote (vote-weighted mean of council nat_pct)
ni=d.groupby('year').apply(lambda g:np.average(g['nat_pct'],weights=g['votes']),include_groups=False)
print("="*68); print("LEVEL: NISA constitutional preference vs actual nationalist VOTE"); print("="*68)
print(f"{'election':<10}{'NISA reunify%':<16}{'actual NAT vote%':<18}{'gap (vote - reunify)'}")
gaps={}
for yr in sorted(d['year'].unique()):
    rov=nisa_ov[NISA_YEAR[yr]]; act=ni[yr]; gaps[yr]=act-rov
    print(f"{yr:<10}{rov:<16.0f}{act:<18.1f}{act-rov:+.1f}")
print(f"\n  NISA reunify is roughly FLAT (~20-27%) while the nationalist vote RISES {ni.min():.0f}->{ni.max():.0f}%")
print(f"  the reunify->vote gap is large (~{np.mean(list(gaps.values())):.0f}pts) and NOT constant")
print(f"  -> NISA anchors the CONSTITUTIONAL-PREFERENCE level, not the partisan-VOTE level in this era")

# SHAPE slope (pooled, per Catholic-pt) and combined pipeline scored leave-one-contest-out
print("\n"+"="*68); print("COMBINED: NISA level (offset-calibrated, LOO) x census shape"); print("="*68)
cath_ni=38.4   # 1991 census NI Catholic %
def fit_shape(train): return np.polyfit(train['cath91'],train['nat_pct'],1)  # [slope,intercept]
maes={}
for mode,label in [('nisa','NISA-anchored level'),('leaked','actual-NI-level (upper bound)')]:
    preds=[]
    for yr in sorted(d['year'].unique()):
        tr=d[d.year!=yr]; te=d[d.year==yr].copy()
        slope,_=fit_shape(tr)                              # shape slope from OTHER contests (no leak)
        if mode=='leaked':
            lvl=ni[yr]                                     # perfect level (upper bound on skill)
        else:
            # NISA level -> vote level via the reunify->vote offset learned on OTHER contests only
            off=np.mean([gaps[o] for o in gaps if o!=yr])
            lvl=nisa_ov[NISA_YEAR[yr]]+off
        te['pred']=lvl+slope*(te['cath91']-cath_ni)
        preds.append(te)
    P=pd.concat(preds); mae=np.mean(np.abs(P['nat_pct']-P['pred'])); r2=1-((P['nat_pct']-P['pred'])**2).sum()/((P['nat_pct']-P['nat_pct'].mean())**2).sum()
    maes[mode]=mae
    print(f"  {label:32s} MAE={mae:.1f}pts  R2={r2:.3f}  (n={len(P)})")
print(f"\n  shape adds most of the skill; the NISA level penalty vs a perfect level is "
      f"{maes['nisa']-maes['leaked']:+.1f}pts MAE -- the cost of having only a constitutional-")
print("  preference survey (not a vote/party survey) for the pre-NILT era.")
print("\nInterpretation: pre-NILT the SHAPE half is strong (R2~0.89) but the LEVEL half is weak,")
print("because NISA measures reunify aspiration, which in 1989-97 sat far below and moved")
print("independently of the nationalist vote. A party-ID/vote-intention survey would fix the level;")
print("NISA alone cannot. This is the model's honest capability boundary going back in time.")
