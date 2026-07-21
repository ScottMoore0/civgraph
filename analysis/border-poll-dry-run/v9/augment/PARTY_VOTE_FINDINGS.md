# Enriching with party votes and lagged election results — findings

Tested whether adding **party first-preference shares** (incl. Alliance, Green, TUV and
Independent categories) from the most recent prior election helps predict the 2016 EU
referendum, using the 2016 Assembly (5 May 2016) shares. Scripts: `party_test.py`,
`party_partial_corr.py`, `party_lean_test.py`.

## The mechanism is real and strong (partial correlations, controlling for Catholic%)

| Party share (2016 Assembly) | raw r with Remain | partial r (holding Catholic% fixed) |
|---|---|---|
| Alliance | −0.36 | **+0.70** |
| Green | −0.06 | **+0.74** |
| Alliance+Green+Ind combined | −0.27 | **+0.80** |
| DUP | −0.90 | −0.64 |
| TUV | −0.57 | −0.56 |
| Sinn Féin | +0.66 | −0.53 |
| SDLP | +0.67 | +0.29 |

The moderate/liberal vote is a **strong** Remain predictor once community background is held
constant — the raw negative correlation was pure confounding (Alliance is strong in
lower-Catholic seats, and Catholic% dominates the raw signal). North Down (13% Catholic but
**34%** Alliance+Green+Ind) voted 52% Remain; Strangford (17% Catholic, 14% moderate) voted 44%.
This is exactly the affluent-unionist-Remain axis the census struggled with.

## But it's redundant with the census — it substitutes, doesn't add

Leave-one-area-out, EU-ref Remain:

| Model | R² | MAE |
|---|---|---|
| Catholic % only | 0.573 | 5.84 |
| Catholic % + moderate-vote share | 0.667 | 4.88 |
| Catholic % + all party shares (13 feats) | **0.833** | 3.86 |
| full census 88 | 0.858 | 3.40 |
| census 88 + party shares | 0.826 | 3.73 |

Party composition alone (13 features) predicts Remain almost as well as the entire 88-feature
census — because party vote *is* the political expression of those demographics plus an
attitudinal layer. But it does **not exceed** the census, and stacking both on 18 constituencies
slightly overfits. For the EU-ref the census already carries this signal (via NS-SEC /
qualifications / national identity).

Independent Unionists specifically (Hermon, Sugden) were weak here (partial r +0.10) — Hermon sat
at Westminster not the Assembly, Sugden is one seat — so the workhorse of the moderate signal is
the Alliance/Green vote, not the independents.

## Verdict by use-case

- **(a) Lagged results to anchor ELECTION predictions** — yes, and date-aware (encode the gap to
  each prior contest). For the nationalist bloc it is near-trivial autoregression (the vote is
  stable → R² ≈ 0.99) so it barely beats the census's 0.98; the real value is volatile/other-bloc
  and turnout-swing contests. Transferable. Caveats: boundary-vintage matching (2024 Westminster,
  pre-2014 councils) and a strict "prior-to-date" guard against leakage. No "previous referendum"
  exists to anchor a first-ever unity vote, so this helps elections, not the unity *level*.
- **(b) Party votes for the EU-ref** — mechanism real (+0.80 partial) but redundant with the
  census; no net gain on the full model. Worth it only as a compact proxy or at finer geography.
- **(c) Party votes → UNITY referendum** — the genuinely valuable use. Census religion is a strong
  unity proxy, but the decisive uncertain bloc in a border poll is the **middle ground** (Alliance
  voters, "neither" identifiers) whose unity preference is NOT fixed by demographics. Party vote
  locates that bloc where the census only sees "Protestant/None". Calibrating party → unity via
  NILT (which records party support and unity preference jointly) would let the model express how
  an area's political composition — including Alliance and independents — bears on unity, exactly
  as proposed. Not validatable against a referendum (none exists), but the party→unity association
  is directly observable in NILT.
