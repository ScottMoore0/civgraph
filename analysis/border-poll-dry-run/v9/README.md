# Border Poll projection — v9 (multi-scale spatial downscaling, learned on real results)

The architecture requested: **don't require attributes to be in both survey and
census.** Instead learn the **census-profile → actual-result** relationship, validate
it at every scale we can observe (**NI → LucidTalk regions → 18 constituencies → 80
DEAs**), then apply it to finer census geographies (Data Zone / Small Area) where
results are never reported. The LucidTalk/NILT poll supplies the *level and date* for a
given question (including Irish unity); the census profile supplies the *geographic
shape*. This yields (a) a DZ/SA projection and (b) a demographic breakdown.

Why this beats the MRP line: census attributes are **area features** (marginals,
published at every geography) — not poststratification cells — so the small-area-joint
disclosure wall does not apply and *all* census attributes can enter (regularised,
since they are highly collinear). It trains on **real ballots**, and the multi-scale
validation (1 → 80 units) is the strongest available guard against the ecological
fallacy short of a sub-DEA result (which does not exist — results stop at DEA/constituency).

## Phases

1. **Labelled results frame** ✅ `results_frame.csv` — NAT/UNI/OTH first-pref bloc share
   per area per contest at constituency (18) + DEA (80): 2016/17/22 Assembly, 2017/19/24
   Westminster, 2014/19/23 locals, + 2016 EU-ref Remain% by constituency (366 rows). NI
   aggregates reconcile with reality (2016 Assembly nat 37.0%, 2022 40.4%, …).
2. **Census profiles** (pending) — all/high-value attributes at constituency + DEA + DZ
   from the FTB corpus (DEA14, DZ21) and DZ→constituency aggregation.
3. **Regularised census→result model** (pending) — ridge/LASSO/PCA on the collinear
   census features; fit at constituency, predict DEA out-of-scale.
4. **Multi-scale validation** (pending) — coefficients/predictions stable NI→region→
   constituency→DEA; leave-one-contest-out.
5. **Poll integration + unity projection to DZ/SA + demographic breakdowns** (pending) —
   poll sets the level for the unity question/date; model sets the shape; 2011 attributes
   when the poll predates the 2021 Census, 2021 otherwise.

**Irreducible caveat (unchanged):** no unity referendum has ever been held, so the
poll→ballot mapping is learned on party/EU contests and transferred to the unity question.
