# Projected NI Assembly election, 3 August 2026 — 2023 boundaries

Phase 60. Driven by the LucidTalk Summer 2026 tracker poll (2026-07), the 2022 Assembly
result re-expressed on 2023 boundaries, and the repo's transfer matrix and PR-STV engine.

## NI-wide

| | electors | turnout | total poll | spoiled | valid |
|---|---|---|---|---|---|
| projected | 1,363,961 | 63.6% | 867,574 | 11,007 (1.27%) | 856,566 |

| party | poll | house effect | corrected | first prefs | seats | vs 2022 |
|---|---|---|---|---|---|---|
| Sinn Féin | 21.65% | −3.82 | 25.65% | 219,682 | **25** | −2 |
| DUP | 15.32% | −3.04 | 18.33% | 157,025 | **21** | −4 |
| UUP | 16.14% | +1.43 | 14.75% | 126,323 | **15** | +6 |
| SDLP | 12.83% | +1.09 | 11.67% | 99,969 | **12** | +4 |
| Alliance | 10.11% | +0.41 | 9.71% | 83,157 | **10** | −7 |
| TUV | 12.19% | +1.11 | 11.06% | 94,702 | **5** | +4 |
| Green | 4.93% | +1.59 | 3.35% | 28,699 | **2** | +2 |
| Aontú | 2.62% | −0.24 | 2.84% | 24,304 | 0 | 0 |
| PBP | 2.35% | +0.75 | 1.52% | 12,978 | 0 | −1 |
| Ind/Other | 1.84% | — | 1.13% | 9,717 | 0 | −2 |

Run on the **full published poll tables**, not the rounded headline. LucidTalk publish
toplines on the news page and the complete crosstabs as a separate workbook; this uses the
latter, so the poll column carries the unrounded shares (SF 21.65 rather than 22, DUP 15.32
rather than 15). Everything downstream of the poll is unchanged.

**The house-effect correction is doing real work and moves against the headline.**
`e = poll − actual`, measured on the two Assembly contests polled at ~1 month's lead.
LucidTalk understated the DUP by 4.3 points and Sinn Féin by 5.0 in 2022. So a headline
of DUP 15.3 / SF 21.7 corrects to 18.3 / 25.7.

**Rounding was not harmless.** Moving from the rounded toplines to the published figures
shifts no party by more than 0.4 points, and still moves three seats: TUV 3 → 5, Sinn Féin
26 → 25, UUP 16 → 15. That is not instability in the poll, it is PR-STV — a fifth seat in a
five-seat constituency turns on the last transfer, so sub-point differences in first
preferences cross thresholds. It is the same sensitivity the TUV reservation below is about,
and it argues for reading the NI totals rather than any individual seat.

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

**The remaining reservation is TUV, and it is not fixable from this data.** TUV at 11.1%
is far outside anything observed (2022: 7.6%). The transfer matrix was estimated when
TUV polled 5–8% and was eliminated early almost everywhere; it says TUV→DUP 61% with
essentially no self-retention. Applying that at 11.1% assumes TUV is still eliminated
early, which is close to self-fulfilling. **TUV 5 seats is the least reliable number in
this table** — it sits 5.0 seats below proportionality, and if unionist transfer
behaviour toward a 12%-polling TUV differs from a 6%-polling TUV, it is wrong. That the
figure moved from 3 to 5 on a 0.19-point change in the poll is the point, not a
counter-argument: this number is on a knife edge either way.

**The poll now HAS crossbreaks, and this projection still does not use them.** That was
true when only the toplines were published; the full workbook breaks every question by
gender, age, social grade, NI region, 2022 past vote, constitutional bloc and community
background. The projection is unchanged by deliberate choice — it sets the NI level from
the poll and takes all geography from the 2022 notional, itself model output on boundaries
that have never hosted an Assembly election. The five-region crossbreak (Belfast, East,
North, South, West) is the obvious thing to test against the notional's implied regional
swing, and is not tested here.

**Other caveats.** Aontú on 2.8% takes no seat, which is plausible but sits on the edge.
Independents are structurally under-modelled (a known weakness: first-time independents
were largely missed in backtesting), and 2022 elected two.
