# Group-B test — dynamic (inter-censal) demography as a model feature

Tests the one NISRA-derived axis predicted to add signal beyond the static census: **how
areas are changing**. Two engineered, low-dimensional features per constituency, from the
2011→2021 census deltas (the *net* effect of births, deaths and migration):

- `dyn__pop_growth` — % population change 2011→2021
- `dyn__cath_moment` — Catholic-background % 2021 minus 2011 (composition momentum)

Same discipline as the party-vote lag: inner-CV guard (adopt the block only on a robust
≥3% held-out improvement, else recover the census baseline exactly); elections
leave-one-contest-out, EU-ref leave-one-area-out. Scripts: `dynamic_backtest.py`.

## Result — it clears the bar (on the EU-ref), never regresses

| Contest | Scheme | Guard chose | Base R²/MAE | Final R²/MAE |
|---|---|---|---|---|
| Assembly 2016/2017/2022 | LOCO | census | 0.977–0.988 | unchanged |
| Westminster 2017/2019 | LOCO | census | 0.937–0.983 | unchanged |
| **EU-ref 2016** | LOAO | **+ dynamic** | 0.836 / 3.62 | **0.862 / 3.35** |

Elections pooled MAE 2.709 → 2.709 (declined — the nationalist vote *shape* is already
census-saturated). The EU-ref improves, and no contest regresses.

## It is *partially additive* with the party-vote lag — not the same signal

| EU-ref (LOAO) | R² | MAE |
|---|---|---|
| census 88 | 0.837 | 3.57 |
| census + dynamic | 0.860 | 3.35 |
| census + party-lag | 0.855 | 3.33 |
| **census + dynamic + party-lag** | **0.872** | 3.23 |

The two correlate (`corr(cath_moment, moderate-vote) = +0.69`) — both flag the same
**diversifying affluent suburbs** — but each carries a slice the other doesn't, so together
they reach 0.872 (vs 0.837 baseline; MAE 3.57 → 3.23). Dynamic demography is the *change*
route to that axis; party vote is the *behaviour* route.

## Why it helps — interpretable

`cath_moment` is highest in the growing, mixing, traditionally-unionist suburbs —
**Lagan Valley +3.1, Belfast East +2.3, North Down +1.3 pp** — which are exactly the
affluent pro-Remain seats. So the momentum feature re-flags the cross-cutting axis the
static census resolves only partly, from a different direction (population/composition
trajectory rather than class or party).

## Verdict — confirms the feasibility triage

This is the concrete payoff of the earlier feasibility framing:
- **Static NISRA blocks (NIMDM, and by extension population/labour/health) → null.**
- **Dynamic demography → real, small, worth including** — it clears the guard, adds
  beyond the party-vote lag, and is interpretable. It is the *only* NISRA-derived block
  so far to beat the census baseline out-of-sample.

## Caveats (kept explicit)

1. **Temporal leakage for pre-2021 targets.** The 2011→2021 delta partly postdates the
   2016–19 contests, so for those this is a momentum-*association* test. Its leakage-clean
   home is **forward unity projection** — using the latest measured momentum to project a
   future border poll is exactly correct and non-leaky. Assembly 2022 is the one backtest
   target for which the momentum is genuinely prior.
2. **Magnitude and N.** ~+0.03 R² on 18 constituencies — a refinement, not a
   transformation, and noisy at this sample size. The guard is what makes it safe.
3. **Community-background momentum is the derived net signal**, not the underlying
   births/deaths/migration by religion (NISRA doesn't publish those cross-tabbed
   sub-nationally) — so it captures the *net* trajectory, not its components.
4. **Declined on the nationalist-vote elections** — no lift there; the value is confined to
   the cross-cutting (EU-ref-like, and prospectively unity) geography.

## Recommended use

Fold the dynamic block into the unity projection **as a forward-projection input** (where
it is leakage-clean and most defensible), guarded and combined with the party-vote lag
(they are additive). Do **not** bulk-integrate the static NISRA mirror — the triage holds:
dynamic demography earns its place; static area statistics do not.
