# Continuous hardness score — folding in acceptance + persuasion items

`hardness_continuous.py` builds a per-respondent hardness score in **[0 = soft … 1 = hard]**
from NILT 2019 (the wave carrying every relevant item), combining four graded signals:

| Signal | Item(s) | Mapping |
|---|---|---|
| Identity strength | `UNINATST` | very=1, fairly=.66, not-very=.33, neither=0 |
| **Acceptance of the other outcome** | `FUTURE1` (accept UI, for No) / `FUTURE2` (accept UK, for Yes) | almost impossible=1, could live with=.5, happily accept=0 |
| **Persuasion resistance** | `UIHCARE`/`UIEU`/`UIECON` | share answering "no difference" (unmovable) |
| Brexit resistance | `UNIRFAV` | "no difference"=1, moved=0 |

Score = weighted mean of the available signals (.35/.35/.20/.10).

## What the fold-in adds

**The acceptance item is the sharpest new signal.** Among No / pro-UK voters it cleanly
stratifies a bloc that identity-strength alone treated as one lump:

| Acceptance of a united Ireland | share of No voters | mean hardness |
|---|---|---|
| "would find it almost impossible" | **41%** | 0.81 — the true hard core |
| "would not like it, but could live with it" | 34% | 0.53 |
| "would happily accept the majority's wish" | 12% | 0.22 — genuinely reconcilable |

So **~45% of pro-UK voters are reconcilable** — the "not pro-unity but switchable" segment,
now measured directly rather than inferred. (The same battery does the mirror job for Yes
voters via `FUTURE2`.)

**Key finding — the Yes bloc is softer than the No bloc.** Mean hardness: **No 0.60,
Undecided 0.42, Yes 0.37.** Pro-unity support is, on average, *less locked-in* than pro-UK
support — consistent with a Yes side grown recently from soft converts and a No side that is
the older, harder unionist core. A Yes majority built on soft voters is more reversible than
a No majority built on hard ones — a materially important asymmetry for any projection.

By community (continuous): Catholic 0.40, Protestant 0.60, No religion 0.47.

## Feasibility of a *continuous* attribute (vs 5 bins)

**It is not only feasible — it is the more natural representation, and it's what I built.**
The underlying items are already graded (strength has 3 levels, acceptance 3, persuasion per
lever), so the 5 bins *discard information*; the continuous score is a weighted composite of
the same signals, and the bins are simply its quantiles crossed with direction.

Advantages realised here:
- **No arbitrary cut-points**; people are *ordered within* what were flat bins (the 62%
  "hard-union" bin splits into 0.22 → 0.81).
- **Poststratifies to a smooth area-softness surface** (mean hardness by community → per
  constituency/DZ), instead of five step-changes.
- **Feeds area-specific uncertainty as a smooth function** — interval width ∝ softness,
  continuously, rather than in jumps.
- Enables **elasticity / tipping-point analysis** — how far each area moves per unit of
  persuasion.

The principled upgrade (documented, not yet built): treat the indicators (strength,
acceptance, persuasion-responsiveness, DK-propensity) as noisy measurements of a **latent
"constitutional hardness" trait** and estimate it with **factor analysis / item-response
theory** — which *learns* the item weights from their covariance instead of fixing them, and
yields a per-person score with a standard error. That's the rigorous continuous model; the
weighted composite here is its transparent first-order approximation.

## Caveats

- **Weights are a choice** (fixed .35/.35/.20/.10); an IRT/factor model would estimate them.
- **Coverage** — the acceptance and persuasion items are 2019-mainly (periodic), so a
  continuous score for other years uses fewer components (strength + DK), i.e. is coarser.
- **Validation** — hardness ideally validated against actual volatility (needs panel data,
  which NILT lacks) or against subgroup wave-to-wave variance; here it's a within-wave
  attitude composite, not observed switching.
- **Area poststratification is religion-only** here, so Protestant-heavy seats read as "hard"
  even where their Protestants are the soft/Alliance kind (North Down) — a religion×identity
  cell mix (available in the census) is the fix.
