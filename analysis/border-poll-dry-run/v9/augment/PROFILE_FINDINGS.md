# Profiling the three unity constituencies (always-Yes, always-No, converts)

NILT is repeated cross-sections, not a panel, so the "converts" (group c) are identified
as the *subgroups whose Yes-rate rose* over time, not tracked individuals. `voter_profile.py`
computes current Yes-of-decided (REFUNIFY, 2020-24) and the change on the constitutional
question (NIRELND2 reunify-of-decided, 2007-12 -> 2019-24).

## The numbers

| Dimension / group | Yes now % | early | late | change |
|---|---|---|---|---|
| **Unionist (self-ID)** | 2 | 2 | 2 | +0 — rock-solid No |
| **Nationalist (self-ID)** | 92 | 61 | 84 | +23 — soft nationalists hardened |
| **Neither** | 42 | 17 | 32 | +14 — the swing middle |
| **Catholic** | 83 | 46 | 71 | **+25** — the biggest numeric driver |
| **No religion** | 44 | 16 | 39 | +23 |
| **Protestant** | 8 | 4 | 7 | +4 — near-flat No |
| **SF/SDLP voters** | 87 | 46 | 79 | +33 |
| **Alliance/Green voters** | 46 | 11 | 40 | **+29** — the realignment bloc |
| **None/other party** | 31 | 16 | 23 | +7 |
| **DUP/UUP/TUV voters** | 2 | 2 | 2 | +0 |
| Age 18-24 | 54 | 28 | 47 | +19 |
| Age 65+ | 34 | 19 | 33 | +13 |

## The three profiles

**(a) Always-Yes** — Catholic, self-identifying Nationalist, SF/SDLP, Irish identity/passport.
Places: nationalist heartlands west of the Bann and along the border — West Belfast, Foyle,
Mid Ulster, Newry & Armagh, West Tyrone, South Down. High Catholic-background, high Irish-
language/passport; deprivation mixed (very deprived urban-nationalist *and* rural).

**(b) Always-No** — Protestant, self-identifying Unionist, DUP/UUP/TUV, British identity/
passport. Rock-solid 2-8% Yes, no movement. Places: Protestant heartlands of the rural east
and Antrim — North Antrim, East Antrim, Strangford, rural Upper Bann, Lagan Valley, the North
Down coast. High Protestant-background, older age structure, small-town/rural, mid-low NIMDM.

**(c) The converts** — TWO overlapping streams:
  1. **Soft Catholics hardening** (46->71->83) — the largest *numeric* driver; culturally
     Catholic voters who preferred status-quo/devolution/DK now backing unity (Brexit + the
     Protocol + demographic confidence).
  2. **The cross-cutting middle** — the "Neither"/Northern-Irish identifiers (17->42),
     **Alliance/Green voters (11->46)**, the no-religion secular bloc (16->44), and younger
     cohorts. Profile: younger, secular or soft-Catholic, "Northern Irish"/neither identity,
     Alliance/Green-voting, graduate/professional, owner-occupier, urban/commuter, mid-affluent.
  Places: the diversifying Greater-Belfast suburbs and city/university belt — **Belfast South,
  Belfast East, North Down, Lagan Valley, South Antrim** — the Alliance-surge seats, mid-NIMDM
  (not the most deprived), high "Northern Irish"/no-religion, rising Catholic-background.

## The synthesis

Groups (a) and (b) are the community-background poles the census nails (nationalist vote
correlates 0.997 with Catholic%). Group (c) is precisely the **cross-cutting middle the census
religion view cannot see** — which is why the party-vote lag, national-identity poststrat and
dynamic-demography features all helped, and all pointed at the **same seats** (North Down,
Belfast East, Lagan Valley — the +2-3pp Catholic-momentum, high-Alliance suburbs). The converts
are the demographic-realignment bloc the whole model was extended to capture.
