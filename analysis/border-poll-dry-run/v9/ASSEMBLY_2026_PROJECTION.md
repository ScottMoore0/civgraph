# Projected NI Assembly election, 3 August 2026 — 2023 boundaries

Phase 60. Driven by the LucidTalk Summer 2026 tracker poll (2026-07), the 2022 Assembly
result re-expressed on 2023 boundaries, and the repo's transfer matrix and PR-STV engine.

## NI-wide

| | electors | turnout | total poll | spoiled | valid |
|---|---|---|---|---|---|
| projected | 1,363,961 | 63.6% | 867,574 | 11,007 (1.27%) | 856,566 |

| party | poll | house effect | corrected | first prefs | seats | vs 2022 |
|---|---|---|---|---|---|---|
| Sinn Féin | 22% | −3.82 | 26.0% | 222,603 | **26** | −1 |
| DUP | 15% | −3.04 | 18.0% | 154,248 | **21** | −4 |
| UUP | 16% | +1.43 | 14.6% | 125,078 | **16** | +7 |
| SDLP | 13% | +1.09 | 11.8% | 101,376 | **12** | +4 |
| Alliance | 10% | +0.41 | 9.6% | 82,192 | **10** | −7 |
| TUV | 12% | +1.11 | 10.9% | 93,038 | **3** | +2 |
| Green | 5% | +1.59 | 3.4% | 29,294 | **2** | +2 |
| Aontú | 3% | −0.24 | 3.2% | 27,521 | 0 | 0 |
| PBP | 2% | +0.75 | 1.2% | 10,125 | 0 | −1 |
| Ind/Other | 2% | — | 1.3% | 11,092 | 0 | −2 |

**The house-effect correction is doing real work and moves against the headline.**
`e = poll − actual`, measured on the two Assembly contests polled at ~1 month's lead.
LucidTalk understated the DUP by 4.3 points and Sinn Féin by 5.0 in 2022. So a headline
of DUP 15 / SF 22 corrects to 18.0 / 25.8.

## Per constituency

Full table in `assembly2026_projection.csv` — electors, turnout, total poll, spoiled,
valid, first preferences and seats per party for all 18.

## What is trustworthy here, and what is not

**Trust the chain down to first preferences.** Electorate is observed (2024 register on
2023 boundaries). Turnout is 2024 per-seat turnout scaled by the measured
Assembly/Westminster ratio (63.6/57.5 = 1.107); spoiled likewise (2.51×, Assembly
spoils far more than Westminster because of PR-STV). Those are structural and stable.

**Treat constituency seat counts as indicative.** The forward-only holdout puts
per-constituency seat error at 0.89–1.89 on Assembly contests. On a 5-seat seat that is
about one seat wrong.

**Two defects were found and fixed during this run, both by checking rather than
assuming:**

1. *Nominations.* Rounding expected quotas to nearest gave 7.8 candidates per
   constituency against 13.3 actually nominated in 2022. With ~8 candidates for 5 seats
   the count elects nearly everyone and hands seats to parties that cannot win them.
2. *Over-splitting.* Plain `ceil` then produced a demonstrable impossibility — TUV on
   **17.1% in Strangford winning zero seats**, despite 17.1% exceeding the 16.7% quota
   and electing on the first count. Cause: 1.03 quotas → two candidates → 8.6% each, and
   the transfer matrix has **no TUV→TUV retention**, because TUV has never run two
   candidates anywhere, so the eliminated running mate leaks 61% to the DUP. Now a party
   splits only with a real fraction of a quota behind the second candidate. After the
   fix: 12.7 candidates per constituency, and no above-quota party wins nothing.

**The remaining reservation is TUV, and it is not fixable from this data.** TUV at 10.9%
is far outside anything observed (2022: 7.6%). The transfer matrix was estimated when
TUV polled 5–8% and was eliminated early almost everywhere; it says TUV→DUP 61% with
essentially no self-retention. Applying that at 10.9% assumes TUV is still eliminated
early, which is close to self-fulfilling. **TUV 3 seats is the least reliable number in
this table** — it sits 6.8 seats below proportionality, and if unionist transfer
behaviour toward a 12%-polling TUV differs from a 6%-polling TUV, it is wrong.

**Other caveats.** The poll has no crossbreaks, so it sets the NI level and contributes
nothing geographic — all distribution comes from the 2022 notional, itself model output
on boundaries that have never hosted an Assembly election. Aontú on 3.2% takes no seat,
which is plausible but sits on the edge. Independents are structurally under-modelled
(a known weakness: first-time independents were largely missed in backtesting), and 2022
elected two.
