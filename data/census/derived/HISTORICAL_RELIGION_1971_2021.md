# Long-run NI Catholic-share layer: 1971 → 2021

Catholic (Roman Catholic / community-background) share on a common frame across
five censuses, landed on every 2021 Data Zone and 2011 Small Area.

| year | source | resolution | NI (pop21-wtd) | note |
|---|---|---|---|---|
| 1971 | CAIN MMR3 App. 3.1 (retabulated) | 26 districts | 36.8% | community-style |
| 1981 | Census Table 8 (OCR, validated) | 26 districts | 28.3% | **boycott-depressed** |
| 1991 | Census religion (Nomis SAS / report) | ward / 26 districts | 38.4% | ~11% not-stated |
| 2021 | Census community background | Data Zone | 45.7% | belong / brought-up-in |

**1971 → 2021 shift: +8.9 pts.**

## Files

- `religion-1971-lgd.csv`, `religion-1981-lgd.csv` — district Catholic %.
- `dz21-religion-{1971,1981,1991}-lgd.csv`, `sa2011-religion-{1971,1981}-lgd.csv` — crosswalked.
- `dz21-catholic-timeseries.csv` — the combined 1971/1981/1991/2021 series per DZ (built by
  `scripts/build_catholic_timeseries_dz.py`).

## Caveats (why this is a trajectory, not one clean series)

- **1981 is boycott-depressed.** The religion question was voluntary and the census fell during the
  H-Block hunger strikes: 18.5% did not state a religion and ~19,000 households did not return, both
  concentrated in nationalist areas. So 1981 dips *below* 1971 and 1991 — an artefact of non-response,
  not a real fall in the Catholic population. Use 1981 with this caveat; the 28.3% is a floor.
- **Definitional drift.** 1971 (CAIN) is community-style; 1981/1991 are enumerated *stated* religion
  (with not-stated); 2021 is *community background*. Ranks and direction are robust across years; the
  absolute year-on-year deltas mix real change with these definitional shifts.
- **Resolution.** 1971/1981/1991 are carried at 26-district resolution (every DZ/SA inherits its
  district value); only 2011/2021 are natively sub-district. The historical layers add **time depth**,
  not sub-district texture.

## Sourcing notes

- **1981**: parsed from the in-repo OCR report (`data/census/census-1981.md`, Table 8), validated
  exactly against printed NI controls (total 1,481,959; Roman Catholic 414,532).
- **1971**: the in-repo OCR (pre-1973 County Reports) is too corrupt to parse safely — only 2 of ~7
  area blocks validate — so the authoritative CAIN retabulation onto modern districts is used instead.
- **No ward-level SAS exists** for 1971 or 1981 NI on Nomis (NM_66_1, 1981 SAS, is Great Britain only;
  there is no 1971 NI dataset). Ward/full-SAS depth like 1991 is therefore not available for these years.
