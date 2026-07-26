# Phase 45 — the ten 2022 Assembly seats closest to an SF/SDLP/PBP/Aontú 46-seat majority

## Baseline

Actual 2022: **Sinn Féin 27, SDLP 8, PBP 1, Aontú 0 = 36 of 90.** A 46/90 majority
needs **ten more**, taken from unionist (DUP/UUP/TUV/PUP/Ind Unionist) or non-aligned
(Alliance/Green) winners.

## Method

For every constituency, for every pairing of a non-bloc winner (donor) and a bloc
candidate who lost (challenger), binary-search the smallest transfer of first
preferences from donor to challenger that flips the seat when the full PR-STV count
is re-run. Cheapest flip per constituency = that seat's distance from the bloc.

## Result (13 of 18 constituencies)

| # | constituency | swing | votes | seat taken from | won by |
|--:|---|--:|--:|---|---|
| 1 | Strangford | 0.11% | **46** | Nick Mathison (Alliance) | Conor Houston (SDLP) |
| 2 | Lagan Valley | 0.61% | 312 | Paul Givan (DUP) | Pat Catney (SDLP) |
| 3 | Fermanagh & South Tyrone | 0.74% | 400 | Deborah Erskine (DUP) | Adam Gannon (SDLP) |
| 4 | Belfast North | 0.81% | 374 | Nuala McAllister (Alliance) | Nichola Mallon (SDLP) |
| 5 | South Antrim | 1.59% | 728 | Trevor Clarke (DUP) | Roisin Lynch (SDLP) |
| 6 | East Antrim | 2.87% | 1,154 | Danny Donnelly (Alliance) | Oliver McMullan (SF) |
| 7 | Belfast South | 3.78% | 1,772 | Kate Nicholl (Alliance) | Elsie Trainor (SDLP) |
| 8 | South Down | 4.18% | 2,295 | Patrick Brown (Alliance) | Karen McKevitt (SDLP) |
| 9 | North Down | 6.11% | 2,551 | Connie Egan (Alliance) | Deirdre Vaughan (SDLP) |
| 10 | Belfast East | 6.89% | 2,978 | Peter McReynolds (Alliance) | Charlotte Carson (SDLP) |
| 11 | West Tyrone | 9.62% | 4,425 | Tom Buchanan (DUP) | Carol Gallagher (PBP) |
| 12 | Newry & Armagh | 11.40% | 6,712 | William Irwin (DUP) | Daniel Connolly (Aontú) |
| 13 | Mid Ulster | 12.47% | 6,443 | Keith Buchanan (DUP) | Alixandra Halliday (Aontú) |

**Ten cheapest: 12,611 votes across ten constituencies**, largest swing 6.89%.

- seats taken from: **Alliance 7, DUP 3**
- seats gained by: **SDLP 9, Sinn Féin 1**

## The headline finding

The route to 46 runs **through Alliance, not through unionism**, and the beneficiary
is overwhelmingly **the SDLP, not Sinn Féin**. Seven of the ten cheapest gains come
from Alliance seats, and nine of ten go to the SDLP. Sinn Féin — already at 27, near
its ceiling in the seats it contests — supplies only one of the ten.

Strangford is the extreme case: **46 votes** separated Alliance's Nick Mathison from
the SDLP's Conor Houston.

## ⚠️ The ranking is provisional — five constituencies are excluded

The count engine reproduces the real elected set exactly in 13 of 18 constituencies
(72.2% exact-set accuracy). A counterfactual on a baseline the engine gets wrong is
meaningless, so **Belfast West, East Londonderry, Foyle, North Antrim and Upper Bann
are excluded.**

Checking those five by final-count margin instead:

| constituency | bloc holds | nearest miss |
|---|--:|---|
| Belfast West | 5/5 | no gain available |
| **Upper Bann** | 1/5 | **376 votes** (Eóin Tennyson, Alliance vs Liam Mackle, SF) |
| **Foyle** | 4/5 | **466 votes** (Gary Middleton, DUP vs Shaun Harkin, PBP) |
| East Londonderry | 2/5 | 2,583 votes |
| North Antrim | 1/5 | 5,361 votes |

**Upper Bann (376) and Foyle (466) are cheaper than six of the ten listed above.**
They almost certainly belong in the top ten, displacing North Down (2,551) and
Belfast East (2,978).

These margins are final-count gaps, not the first-preference swing metric used in the
table, so they are indicative rather than directly comparable. But the conclusion is
robust: **the ten cheapest almost certainly include Upper Bann and Foyle.** Settling
it requires the count engine to reproduce those five baselines exactly.

Note both additions reinforce the headline: Upper Bann is another Alliance seat, and
Foyle would go to PBP.
