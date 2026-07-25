# Phase 32 — DZ notional results, and a corrected diagnosis

## What it does

Takes the Data Zone allocation for a past contest and re-aggregates it
(population-weighted) onto a different boundary set — the standard notional-results
construction — so that "how did this area vote last time" exists even when the area
did not exist last time.

    DZ mosaic for contest X  ->  re-aggregate onto boundary set B  ->  notional

## Why it was needed

Persistence is one of the model's two strongest predictors and is **undefined
whenever boundaries change**. Westminster 2024 runs on the 2023 review, so none of
its constituencies existed at any prior contest: 2024 had **no persistence at all**,
and it was the worst Westminster year (winner accuracy 55.6%).

I previously attributed that entirely to pact-era overfitting in the competitive-field
features. **That diagnosis was wrong, or at best half the story.**

## The decisive test

Westminster 2024 winner accuracy, 18 seats:

| variant | winner accuracy |
|---|--:|
| census only (the model as it stood) | 55.6% |
| **notional persistence only** | **77.8%** |
| blend, w_census = 0.25 | 77.8% |
| blend, w_census = 0.50 | 72.2% |
| blend, w_census = 0.75 | 61.1% |

**55.6% → 77.8%.** That takes 2024 from the worst Westminster year to roughly level
with 2017 and 2019 (both 83.3%), and lifts the Westminster average from 74.1% to
about 81.5%.

Seats fixed: **Belfast South and Mid Down** (SDLP, was called Alliance), **Foyle**
(SDLP, was Sinn Féin), **Strangford** (DUP, was Alliance), **Upper Bann** (DUP, was
Sinn Féin).

That census adds nothing on top (w=0.25 ties, higher census weight is worse) is
consistent with the standing finding that persistence beats census for large
established parties — which is what decides FPTP seats.

## Validation

- **Identity check:** re-aggregating each mosaic onto its OWN boundaries reproduces
  the observed result to TVD ≤ 0.009. This is a plumbing check, exact by
  construction (the mosaic is raked to those totals), not evidence.
- **Provenance:** every 2023 seat retains 86.4–100% of its population from a single
  2008 predecessor (median 94.9%); only Foyle is fully unchanged.
  `notional/provenance_2008_to_2023.csv` records this per seat, so a notional built
  from fragments can be distrusted in proportion.

## What it inherits, stated plainly

The DZ mosaic is raked to the observed area totals of its own contest, so it is an
**allocation, not a measurement**. Re-aggregating onto different boundaries produces
genuinely new numbers, but their accuracy rests on the modelled within-area
distribution, which has no sub-DEA ground truth and never can — NI counts centrally.
Professional notionals make the same assumption for the same reason.

## The one seat it got wrong is instructive

**North Down**: actual Independent (Alex Easton), notional says DUP. The notional
faithfully carries Easton's 2017/2019 vote under the DUP label he then held. That is
exactly the defector problem — and it means the notional layer and the
independent/defector work interlock: `personId` history would let a notional follow
the *person* out of the party, not just the party.

## What this unlocks next

- persistence for **local 2014** (DEAs redrawn in the 2014 reorganisation)
- the **1997–2015 Westminster contests**, all present in the repo and all currently
  unused, which sit on the 1995 and 2008 boundary sets
- vintage-matched **backcasting**, which needs the same machinery
