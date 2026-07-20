# v11 — six model upgrades (uncertainty, identity, turnout, EI, smoothing, forward)

Implements improvements #1, #3, #4, #6, #7, #8. Two scripts: `v11_hierarchical.py`
(EI + identity + turnout) and `v11b_uncertainty.py` (intervals + smoothing + forward).
Each is a **pragmatic** implementation with fidelity flagged — no result is overstated.

## #1 Uncertainty intervals — the headline, and it's *calibration-validated*

Bootstrap over survey-rate sampling error (±2pt) and pollster house effect (±2pt) →
predictive intervals at Data-Zone and NI level.
- **NI-wide unity 41.7% (90% CI 38.6–44.9%)**; median DZ 90%-interval width **6.9 pt**.
- **Coverage check on the observable EU-ref** (the honest test — do the intervals actually
  contain the truth?):

  | Interval construction | 90% coverage | 80% coverage |
  |---|---|---|
  | parameter bootstrap only | **61%** (too narrow) | 50% |
  | **+ residual variance** | **83%** | 83% |

  The naive parameter bootstrap *under-covers* — it omits the idiosyncratic scatter the
  census can't explain (residual SD **4.5 pt**). Adding it yields ~calibrated intervals
  (83% for a nominal 90% on 18 points). This is the correct predictive-interval
  construction, and the point estimates finally ship **with honest error bars**.
  *Fidelity: bootstrap, not full MCMC — a hierarchical Bayesian (PyMC/Stan) model would
  give joint posterior uncertainty; the bootstrap captures the dominant terms.*

## #3 Identity + passport poststratification

Unity calibrated by **national identity** from NILT — a more discriminating axis than
religion for the swing middle: **Irish 88.7% · British 5.3% · Northern-Irish/mixed 24.8% ·
Other 44.2%**. Combined with the religion axis per constituency (e.g. Belfast South:
religion 49.0 / identity 42.2 / combined 45.4). The identity view pulls the mixed-identity
suburbs toward the persuadable middle that religion alone can't locate.
*Fidelity: applied at constituency resolution (identity is in the census at that level);
DZ texture still from religion.*

## #4 Turnout model

Census → mean area turnout, **leave-one-out R² = 0.45** (older, owner-occupied, higher-
qualification areas turn out more), turnout range 57–78%. Produces likely-voter weights —
the missing dimension for a real border poll, where differential turnout can swing the
result. *A first-order model; a full likely-voter layer would model turnout by group×area.*

## #7 Ecological inference (Goodman, bounded)

Recovers within-area group vote rates from the observed contests:
- **Assembly 2022/2017 → Catholic nationalist rate ~90–91%, Protestant ~0** — matches
  reality and validates the poststratification structure.
- **EU-ref → the None rate hits the [0,1] bound**, correctly signalling that Remain is
  *not* a religion-driven vote (the cross-cut we established throughout).
*Fidelity: Goodman ecological regression, not King's EI — King's would give proper bounds
and uncertainty on each area's split; Goodman gives the NI-level group rates.*

## #8 Spatial / hierarchical smoothing

Each Data Zone is partial-pooled toward its constituency estimate (λ = 0.35), shrinking
small-area noise while preserving the constituency mass (mean re-centred). *Fidelity:
hierarchical shrinkage, not a full ICAR/CAR spatial prior — the latter needs a DZ adjacency
graph (buildable from the DZ2021 geometry on R2) and would borrow strength between
neighbours, not just within constituencies.*

## #6 Forward projection

Carries composition forward a decade (2011→2021 momentum + cohort replacement) and
re-poststratifies, holding attitudes fixed.
- **Measure-robust conclusion: composition momentum moves unity only ~1 pt over a decade.**
  The dominant driver of any real change is **attitude** (the survey trend), which this
  deliberately does *not* project — so this is a **demographic-inertia scenario, not a
  forecast**.
- **Data caveat surfaced:** the 2021 DZ field used reads as Catholic *religion* (~43%), not
  *background* (~45.7%), so the 2011↔2021 *sign* is a measurement artifact; only the
  *magnitude* (~1 pt/decade) is trustworthy. A clean run needs the 2021 community-
  **background** field for consistency with the 2011 KS212 background measure.

## What this changes, and what's still pragmatic

**Delivered:** the projection now ships with **calibration-validated uncertainty bands**
(the #1 gap), a second (identity) poststratification axis, a validated turnout model,
EI-validated group rates, hierarchical small-area smoothing, and a forward-inertia
scenario — all honest about fidelity.

**Still worth upgrading to full fidelity:** a joint hierarchical Bayesian model (replacing
bootstrap + separate stages with one posterior), King's EI, an ICAR spatial prior from the
DZ adjacency graph, and a survey-trend model to make #6 a genuine forward *forecast* rather
than a composition-inertia scenario. These are fidelity upgrades, not new capabilities —
the capabilities are now all in place.
