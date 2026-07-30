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

### Common-basis layer (added for the 1981 boycott question)

- `religion-1981-notstated.csv` — Table 8A: the not-stated split out of Table 8's lumped
  "Other and not stated" column. NI **274,584**, Belfast **60,672**. Validated three ways:
  totals match Table 8, males+females match persons, and both areas reproduce the RG's printed
  non-response rates (18.5% NI, 20.6% Belfast).
- `religion-1971-counts.csv` — 1971 County Report counts. **Tyrone only.** 1 of 7 reports survives
  parsing, confirming the verdict recorded above; no national row is written, because a partial
  sum labelled "NORTHERN IRELAND" would be treated downstream as a control total.
- `religion-common-basis-{ni,lgd}.csv` — the three years on the stated-religion basis
  (equivalently, the pro-rata community basis), plus the residual.

**Headline.** On the stated basis 1981 reads 34.3%, not 27.97% — most of the apparent collapse was
the denominator. A real gap survives: against a 1971→1991 midpoint of 39.11%, reconciling 1981 needs
**60.1%** of its not-stated pool to have been Catholic. Belfast, computed independently, needs
**59.3%**. Both are bounded well inside [0, 100%], and they agree to within 1.2 points.

**Ceiling.** Table 8A splits the not-stated for **NI and Belfast only** — Table 8 lumps it by
district — so the stated basis is computable for 2 areas, not 26. District rows carry an explicit
blank rather than an apportioned guess, since non-response was geographically concentrated and a
pro-rata split would erase the pattern being measured.

**1971 NI is 36.82%** here — CAIN districts weighted by their own 1971 populations, which sum to
1,536,065, the printed control. The 36.8% quoted in the table above is the same data weighted by
2021 population.

## Caveats (why this is a trajectory, not one clean series)

- **1981 is boycott-depressed.** The religion question was voluntary and the census fell during the
  H-Block hunger strikes. So 1981 dips *below* 1971 and 1991 — an artefact of non-response, not a real
  fall in the Catholic population. Use the raw 1981 figure as a floor only; the common-basis table
  below is the comparable series. Two distinct failures, now separated from source:
  - **non-response** to the voluntary religion question: **274,584** people, 18.5% (Table 8A,
    `parse_1981_table8a.py`). The Registrar General states 18.5% in the report text; the parsed
    count gives 18.53%.
  - **non-enumeration** — households missed entirely: the RG puts the population effect at
    **19,664**, being 1.3% of estimated total households. *An earlier version of this note said
    "~19,000 households did not return". That was a misreading: 19,664 is the effect in **persons**,
    roughly a third of what that wording implied.*
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
