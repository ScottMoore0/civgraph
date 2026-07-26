# Phases 41–42: independents fixed, turnout/spoiled added

## 41 — independents ✅ improves every metric

Candidate-level personal-vote estimates from `personId` history, using **prior share
and incumbency** rather than a learned model (phase 34: the simple estimator beats a
GBM, which overfits on 289 rows), with the vote **concentrated at candidate level**
rather than split evenly across a party's independents.

| variant | seat error | exact | independents |
|---|--:|--:|--:|
| baseline (party share, even split) | 2.04 | 24.1% | 14 / 62 |
| **fix (candidate history, concentrated)** | **1.99** | **25.5%** | **20 / 62** |

Best seat error recorded. By contest:

| contest | independents projected / actual |
|---|--:|
| local 2023 | **12 / 19** |
| local 2019 | 7 / 24 |
| local 2014 | **0 / 15** |
| assembly 2022 | 1 / 2 |

**local 2014 gets zero, and that is expected**: candidate history only reaches back
to the 2011 Assembly, so 2014's independents have no prior candidacy to draw on. The
fix works exactly where history exists and not at all where it does not — which is
the honest signature of the mechanism rather than a tuning artefact.

Still 20 of 62. The remaining gap is first-time independents, which stay
unmodellable; they need a scenario input.

## 42 — turnout and spoiled votes ✅ delivered, ❌ no seat gain (as predicted)

Both were in the data (`electorate`, `turnoutPct`, `totalPoll`, `spoiled`,
`validPoll`) and neither had ever been used.

**Turnout, leave-one-contest-out:**

| scale | contest mean | persistence | census | census+persistence |
|---|--:|--:|--:|--:|
| DEA (n=240) | 5.33 | 2.44 | 2.68 | **2.42** (R²=0.805) |
| constituency (n=107) | **3.07** (R²=0.526) | 5.31 | 4.42 | 4.83 |

At DEA turnout is well predicted — **MAE 2.4 pp on a 53% mean, R²=0.81**. At
constituency the **contest mean wins** and area persistence is actively bad
(R²=−0.295): constituency turnout is dominated by *which election it is* (Assembly
vs Westminster, and the national mood that year), not by area characteristics.

**Spoiled votes:** MAE 0.25 pp at DEA (mean 1.40%), 0.14 pp at constituency
(mean 0.86%). Low variance, easily predicted, negligible for seats.

**The full chain is now produced** — `turnout_chain.csv`:
electorate → turnout% → total poll → spoiled → valid poll, per area.

### The seat gain is nil, exactly as pre-registered

    share TVD median   without turnout 13.97   with turnout 15.42

Adding predicted turnout as a share-model feature makes it **worse**. This was stated
in advance and is structural, not a failure: seats depend on shares *within* an area,
and scaling every candidate in an area by the same turnout leaves shares unchanged.
Turnout can only affect seats through **differential** turnout between communities
inside one area, which an area-level turnout figure does not capture.

So turnout is a genuine new deliverable and a near-zero contributor to seat accuracy.
Capturing the differential channel would need turnout modelled *by demographic group*,
which the published data does not support below area level.
