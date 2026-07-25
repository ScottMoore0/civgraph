# Phases 35–36: schema sweep, frame expansion, and the wiring batch

## 35 — schema-consistency sweep ✅

A reusable guard against the failure mode this codebase demonstrably has: a field
that exists in both file formats but **means** something different. Four such
defects occurred in this workstream, three of them producing plausible-but-wrong
output silently.

Findings:

- **B. Fields that vary per count in one type and are constant in another** —
  `Status` varies in Assembly files, **CONSTANT in local**. This is the sibling of
  the `Occurred_On_Count` defect already fixed in phase 18. Westminster is constant
  throughout because FPTP has a single count.
- **A. Fields present in only one type** — local carries `dea`, `district`,
  `localBody`, `Deduplicated Party Name`, `Wikipedia Party Name`, and usefully
  **`countGroup.PersonId`**, which makes candidate-level transfer attribution
  possible for local contests.
- **C. Pseudo-candidate rows** — `Non-transferable` × 1,462, local only (handled).
- **D. Encodings** — `v3/lucidtalk_unity_rates.json` is **not UTF-8**. Recorded with
  the warning that adding `encoding="utf-8"` to its readers would *break* them; it
  needs normalising, not annotating.

## 36 — frame expansion and the wiring batch

### Frame

Added Westminster **2010 and 2015** (both on the 2008 boundaries, so they match
`constituency_features.csv` exactly). Constituency scale **108 → 144** area-contests.
1997/2001/2005 were left out deliberately: they ran on the 1995 boundaries *and* sit
16–24 years before the 2021 census, so they need vintage-matched features rather
than 2021 demography bolted on.

**Defect found:** Westminster 2010 carries a **duplicated "Newry and Armagh"** row
(identical, 6 candidates, valid poll 44,906). Left in it would double-count the seat
and skew every NI-wide aggregate. Now dropped with a warning.

### The wiring — and gains that do not compose

All three previously-stranded gains are now connected. The honest result is mixed.

| scale | v1 poll+census | v2 +blend/persistence v2 | v3 +defector-aware |
|---|--:|--:|--:|
| DEA | 14.56 | **13.97** | 13.99 |
| constituency | **12.62** | 12.88 | 12.82 |

**The DEA blend delivers** (14.56 → 13.97). **The constituency blend does not** — and
that contradicts phase 33, which measured it winning at 12.74 vs 13.53.

The reason is instructive: **phase 33 measured against a census with the
TRAIN-derived level; here the level already comes from the poll.** Poll level and
persistence are substantially *substitutes*, not complements — both carry "where the
parties stand nationally now". Once the poll supplies it, persistence adds much less,
and at constituency it slightly hurts.

**A gain measured against a weaker baseline can shrink or reverse against a stronger
one.** That is the general lesson, and it applies to every isolated evaluation in
this workstream.

### But phase 32's headline survives, and it is contest-type specific

Westminster winner accuracy, under the poll level:

| variant | 2017 | 2019 | 2024 |
|---|--:|--:|--:|
| poll + census (no persistence) | **94.4%** | 83.3% | 55.6% |
| + persistence v2 (notional) | 88.9% | 83.3% | **77.8%** |
| + defector-aware | 88.9% | 83.3% | **77.8%** |

**2024: 55.6% → 77.8% confirmed**, exactly as phase 32 predicted, and it survives the
stronger baseline. It costs 2017 (94.4 → 88.9), but the three-contest mean rises
**77.8% → 83.3%**.

So persistence helps where boundaries changed and pacts matter (Westminster) and
slightly hurts where the poll level already does the work (Assembly). **The blend
should be applied per contest type, not per scale** — that is the refinement this
batch surfaces and does not yet implement.

### Seats

Best configuration (blend at DEA, defector-aware): **mean party-seat error 2.06,
exact 23.8%** over 294 areas / 1,674 seats. Assembly 2022 back to **1.00**.

Against the previous headline of 2.00 this is *nominally worse*, but not comparably
measured: the constituency training set changed with 2010/2015, which feeds Assembly
predictions. Adding those two contests appears to cost a little on Assembly seats —
a different contest type pooled into the same model.

### Independents

Candidate-level independent shares **helped local 2023 in isolation** (0 → 4 seats)
but **hurt in the full pipeline**: 13 projected across all STV contests at party
level versus 9 at candidate level, against 62 actual. Another gain that does not
compose. Party-level is retained as the default.
