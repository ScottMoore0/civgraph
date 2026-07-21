# Persuadable-middle map + area-specific uncertainty

A 5-band hardness typology per NILT respondent (2019–21, the waves with the identity-
STRENGTH item), band-mix computed by community background, poststratified to constituencies
and Data Zones. `persuadability.py` → `persuadability_constituency.csv`, `persuadability_dz.csv`.

## The hardness structure (band mix by community background, NILT 2019–21)

| | HARD union | SOFT union | UNDECIDED | SOFT unity | HARD unity |
|---|---|---|---|---|---|
| **Catholic** | 0.9 | 17.4 | 19.9 | 14.9 | **46.9** |
| **Protestant** | **62.0** | 18.8 | 13.7 | 5.0 | 0.6 |
| **No religion** | 16.5 | 28.5 | 28.4 | 17.2 | 9.3 |

This is exactly the softness gradient you wanted:
- **Catholics** — nearly half hard-Yes, but a **big soft tail** (~52% soft/undecided): the pro-
  unity core plus the movable Catholics who converted recently and could still drift.
- **Protestants** — 62% locked-No, but a **persuadable ~38% ring**: the "soft union" (19%) +
  undecided (14%) + soft-unity (5%) — *not pro-unity, but more movable than the hard 62%.*
  These are your persuadable-to-unity unionists.
- **No religion** — the genuinely volatile middle: **~74% soft/undecided**, split near-evenly.

## Three kinds of place

**Locked-No (unionist heartlands)** — Strangford, East Antrim, Lagan Valley, North Antrim:
40–44% hard-union, decided-Yes only 22–29%. Least persuadable.

**Yes-leaning but soft (nationalist heartlands)** — Belfast West (decided-Yes 64), Foyle (61):
high hard-Yes *and* a large soft-Catholic tail, so persuadable ~51% — pro-unity but not immovable.

**Genuine battlegrounds (soft AND balanced)** — **Newry & Armagh, Mid Ulster, South Down,
Belfast South, Upper Bann**: decided-Yes near 50, persuadable ~50%. These border/mixed seats
are where a border poll is actually won or lost.

## The persuadable segments you asked to isolate

- **Not pro-unity but switchable** (vs hardline unionists): the **SOFT union + UNDECIDED**
  bands — ~33% of the electorate, concentrated among Protestants' movable ring and the
  no-religion middle, geographically in the mixed suburbs and border seats.
- **Not pro-UK but switchable** (vs hardline nationalists): the **SOFT unity + UNDECIDED**
  bands — the soft-Catholic tail and no-religion middle, in the same battleground seats.

## The uncertainty payoff (the real point)

The persuadable share is **~48% almost everywhere.** So the honest area-level uncertainty is
not survey sampling error (the ±3 pt v11 bootstrap) — it is **which way a nearly-half-soft
electorate breaks**, a swing half-width of **~14 pt** per area. This reframes the projection:
the outcome is dominated by *persuasion of the soft middle*, not demographic point estimates,
and the uncertainty is now **area-specific** (a 62%-hard unionist seat is near-certain; a
50%-soft border seat is a coin-toss). That is a far more decision-relevant uncertainty model
than a uniform band.

## Caveats

- **Basis is 2019–21** (the last waves with the strength item `UNINATST`); refreshing to 2024
  needs it re-fielded, or a coarser UNINATID-only proxy. The *structure* of hardness is stable;
  the *direction* shares have since shifted a little further toward Yes.
- **Religion-only poststratification** (the census-observable axis); a religion × age × identity
  cell mix would sharpen it. Ecological and cross-sectional caveats carry over (distribution and
  location of hardness, not tracked individuals).
- Bands use identity-strength; the **acceptance items** (`FUTURE1/2` — would you accept the other
  outcome) and the **persuasion battery** (`UI*`, 2019) would refine "hard vs soft" further and
  are the natural enrichment.
