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

### Tier 2 — 1998–2011 (NILT before LucidTalk) — **BUILT** → `hist/TIER2_3.md`
Built on the **2011 NISRA census** at the 18 constituencies (ASSEMBLY AREAS geography,
118 %-features) and the NILT constitutional-preference item (`nireland`/`NIRELAND`/
`NIRELND2`, weighted — the durable series; `REFUNIFY` proper only arrives 2020). Results:
* **Geographic gradient** (census → nationalist vote shape), leave-one-contest-out across
  Assembly 1998/2003/2007 + Westminster 1997/2001/2005/2010: **R² 0.982, MAE 2.39 pts** —
  as strong as the modern era. End-to-end absolute MAE 2.90 pts.
* **Level**: the NILT reunify series exists 1998–2010 but runs ~15 pts below the (near-
  stationary) nationalist vote, doesn't track it, and — the key finding — has **no era
  outcome to validate against**. The 1998 GFA referendum (71% Yes) turned out to be
  reported **NI-wide only**, so it is a level reference, not a geographic target. The
  unity *level* is survey-only and unbacktestable in this era too.

### Tier 3 — 1989–1998 — **BUILT (gradient); level blocked** → `hist/TIER2_3.md`
No 1991 census tables are held (only 2011/2021 are machine-readable here), and NISA
(1989–96) microdata is absent, so the plan was adapted honestly:
* **Gradient stability** — the census gradient trained on 1997–2010 predicts the 1990s
  nationalist vote *shape*: Westminster 1997 (18-seat) **R² 0.984, corr +0.994**;
  Westminster 1992 (17-seat, 1983 boundaries, name-matched) **R² 0.964, corr +0.982**.
  The geographic relationship holds across a two-decade gap and a boundary change.
* **Level leg — unblocked via ARK SOL (no login).** The UKDS NISA microdata is
  Safeguarded, but ARK's SOL tabulations publish NISA's `NIRELAND` constitutional-
  preference question as weighted marginals **by community background** (Catholic /
  Protestant / None) for all seven years (no 1992 survey). `hist/harvest_nisa.py` scrapes
  them; `hist/backtest_t3_level.py` poststratifies onto census religion to build a real
  **1989–1996 unity projection** (NI reunify 26–31%) that meets NILT's 1998 reading
  continuously. Caveat: 2011 census stands in for 1991 (composition drift → ~3.8 pt
  over-estimate), SOL gives marginals only, and there is no 1990s referendum to validate
  the level against. UKDS microdata + 1991 census tables would tighten it, but the era is
  no longer a blank.

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
