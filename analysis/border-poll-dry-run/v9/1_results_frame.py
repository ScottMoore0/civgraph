#!/usr/bin/env python3
"""v9 phase 1 — labelled multi-scale results frame (the target variable).
Nationalist / Unionist / Other first-preference bloc shares per area per contest,
at constituency (18) and DEA (80) scale, plus EU-ref Remain% by constituency.
Source: test/metadata/elections-test2/*.json (mainLikeCandidateSummary / results).
Blocs: NAT = SF, SDLP, Aontú, Ind Nationalist, Workers' Party, IRSP; UNI = DUP,
UUP, TUV, PUP, Ind Unionist, UKIP, Conservative; OTH = Alliance, Green, PBP, others.
Output: results_frame.csv (contest, scale, year, area, nat/uni/oth_pct, remain_pct, total).
"""
# (assembly/westminster/local + EU-ref extraction; see git history for full body)
