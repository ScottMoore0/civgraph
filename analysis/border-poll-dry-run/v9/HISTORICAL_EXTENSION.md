# Extending the backtest backwards — how far, and what breaks

The backtest (`BACKTEST.md`) covers **2011–2024**: the era where all three inputs exist
together — 2011/2021 NISRA census, dense NILT, and LucidTalk border-poll polling. The
question here is how much further back the same "NISRA + NILT + poll → result" design can
go, in principle down to the first **1973 border poll**, and exactly where each input
stops carrying signal.

The design is `result = level × shape`. The two halves fail backward at **different
rates**, so the honest answer is not a single cut-off but a set of tiers.

---

## What each input's history actually is

**Election / referendum targets** (these go back furthest — the outcomes are recorded):
Westminster every contest from 1974; Assembly 1973, 1982, 1998→; local government 1973,
1977, 1981, …, 2023; European Parliament 1979–2019. Referendums: **1973 border poll**,
**1975 EEC**, **1998 Good Friday Agreement**, **2016 EU**.

**NISRA census** (drives *shape*): 1971, 1981, 1991, 2001, 2011, 2021. But the usable
*feature set* collapses going back:
* national identity, passports held — **2011 onward only**;
* "religion brought up in" (which rescues non-responders) — **2001 onward**;
* before 2001 you have religion (raw, with heavy non-response), age, sex, tenure,
  economic activity — roughly **8–15 features, not 88**;
* **1981 religion is unreliable** — the census was partially boycotted in nationalist
  areas during the hunger-strike period, undercounting Catholics exactly where it
  matters;
* small-area geography (DZ2021 / SA2011) exists **only from ~2001/2011**. Before that the
  finest census grain is the ward / enumeration district, so DZ-level projection is
  impossible pre-2001 — the floor rises to ward, then constituency.

**Survey level signal** (drives *level*):
* **LucidTalk** border-poll polling — ~2012 onward. This is the only source that has ever
  asked the unity question at polling scale.
* **NILT** — 1998 onward (`REFUNIFY` / `NIRELND2` constitutional-preference items).
* **NI Social Attitudes (NISA)** — 1989–1996, a different constitutional-preference
  wording that can be bridged to NILT on no overlap (they don't co-occur), only by
  assumption.
* Before 1989 — no consistent attitude series; Rose's 1968 *Loyalty Survey* and a handful
  of academic one-offs, not a harmonisable time series.

---

## Feasibility tiers

### Tier 1 — 2011–2024 (LucidTalk era) — **done**
Full 88-feature gradient + poll level. This is the backtest: geography R² ≈ 0.96–0.98
out of sample, level poll-limited to ~2 pt house effect, end-to-end MAE ~3.4 pts.

### Tier 2 — 1998–2011 (NILT before LucidTalk) — **very feasible; highest-value**
No border-poll polling, but **NILT `REFUNIFY` runs from 1998**, so the level comes from
NILT alone (annual, higher variance, its own house effect). Geography from the 2001 and
2011 censuses — but drop national-identity/passport features before 2011, so a **reduced
~40-feature gradient**. Targets: Assembly 1998/2003/2007, local 2001/2005, Westminster
1997–2010, and the single most valuable backward target of all — the **1998 Good Friday
Agreement referendum** (81% turnout, 71% Yes, a *genuine* high-participation constitutional
vote, unlike 1973). Validating "NILT + 2001 census → 1998 GFA Yes vote by constituency"
would be the strongest possible out-of-era test of the whole approach. **Recommended next
build.**

### Tier 3 — 1989–1998 (NISA + 1991 census) — **feasible, thinner, bridged**
Level from **NISA** constitutional preference, harmonised to the NILT scale via an
estimated offset (unverifiable — the two surveys never overlap, so this is the weak
joint). Geography from the **1991 census**: religion + basic demographics only, ward
level, no small area. Targets: Westminster 1992/1997, local 1993/1997, EP 1989/1994.
Feasible as a *geographic-gradient* test; the *level* leg rests on the NISA→NILT bridge
assumption and should be reported with that caveat foregrounded.

### Tier 4 — 1973–1989 — **geographic gradient only; no valid level**
1971/1981 census (1981 religion unreliable per above), **no consistent survey**, so the
poll-driven level cannot be reconstructed — you can only test whether census religion
predicts the *shape* of the nationalist vote. Even that is compromised:
* the **1973 border poll was boycotted by nationalists** (58.7% turnout, 98.9% for the
  UK) — its "Unity" number is not a measure of unity *preference* and is useless as a
  supervised target; it is only a study of unionist turnout;
* **1975 EEC referendum** predates small-area census and sits on 1971 geography;
* early nationalist politics (abstentionism, SF not contesting, SDLP ≠ full bloc) means
  the "nationalist vote" target itself is ill-defined before ~1998.
So Tier 4 answers a narrower question — *"did the 1971/1981 religious geography already
predict the nationalist vote pattern?"* — and can suggest the gradient is long-stable, but
it **cannot** be an end-to-end unity backtest.

---

## Summary — the two halves fail at different depths

| Era | Census features | Finest geography | Level source | End-to-end unity backtest? |
|---|---|---|---|---|
| 2011–2024 | 88 (full) | Data Zone / Small Area | LucidTalk + NILT | **Yes** (Tier 1, done) |
| 1998–2011 | ~40 | ward → constituency | NILT | **Yes** — incl. 1998 GFA ref (Tier 2) |
| 1989–1998 | ~15 | ward | NISA (bridged) | Level bridged, caveat-heavy (Tier 3) |
| 1973–1989 | ~8 (1981 unreliable) | ward / ED | none consistent | **No** — shape only (Tier 4) |

* The **geographic gradient extends cleanly to ~1973** — the religion→nationalist-vote
  shape is a stable relationship you can keep testing, just with fewer features and
  coarser geography, and with the 1981-census and abstentionism caveats in the deep past.
* The **poll-driven level does not**: it reaches 2012 on LucidTalk, 1998 on NILT, ~1989 on
  a bridged NISA, and nothing usable before. The two best deep-history referendum targets
  are respectively boycott-contaminated (1973) and pre-small-area-census (1975).

**Practical recommendation:** build **Tier 2** next. It is a clean, high-value extension —
real inputs, a genuine constitutional referendum (1998 GFA) as the target — and it doubles
the out-of-era evidence for the pipeline without leaning on any unverifiable survey bridge.
Tiers 3–4 are worth doing as *gradient-stability* studies but should never be presented as
unity backtests.
