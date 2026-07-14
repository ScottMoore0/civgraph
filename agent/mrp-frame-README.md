# MRP poststratification frame — Northern Ireland (2011 Census, Small Area)

Inputs for building a multilevel-regression-and-poststratification (MRP) frame
at NI Small-Area (SA2011) level. All files are static CSVs under
`https://civgraph.net/data/census/derived/`.

## Published joint margins (from NISRA 2011 Local Characteristics, Small Area)

- [`joint-2011-age-religion-sa.csv`](https://civgraph.net/data/census/derived/joint-2011-age-religion-sa.csv)
  — tidy: `SA2011, age_band {0-24,25-44,45+}, religion_brought_up_in {Catholic, Protestant and Other Christian, Other religions and none}, count`. (NISRA LC2110.)
- [`joint-2011-sex-religion-sa.csv`](https://civgraph.net/data/census/derived/joint-2011-sex-religion-sa.csv)
  — tidy: `SA2011, sex {Male,Female}, religion_brought_up_in{…}, count`. (NISRA LC2112.)

## Marginals (already on the site as data-entry overlays)

- Sex, age band, median age, Catholic community background, NS-SeC 1–3 (ABC1 proxy):
  [`census-2011-sa.csv`](https://civgraph.net/data/census/derived/census-2011-sa.csv).
- Deprivation (NIMDM 2017 rank/decile): [`nimdm-2017-sa.csv`](https://civgraph.net/data/census/derived/nimdm-2017-sa.csv).

## Building the full age × sex × religion × NS-SeC frame

NISRA does **not** publish the full 4-way joint at Small-Area level (statistical
disclosure control), so it must be **synthesised by iterative proportional
fitting (raking)** from the margins above:

1. Harmonise categories (the LC tables use different age bands — LC2110 uses
   0–24 / 25–44 / 45+; reconcile to a common set before raking).
2. Seed a uniform 4-way table per Small Area; rake to the observed margins
   (age×religion, sex×religion, and the sex, age, NS-SeC marginals from
   `census-2011-sa.csv` / KS611) until convergence.
3. The result is a synthetic per-Small-Area joint frame — the poststratification
   table an MRP model's cell predictions are weighted against.

This raking step is deliberately left to the analyst: the assumptions (which
margins, how to harmonise age bands, independence residuals) are modelling
choices that belong with the study, not baked into the data.

## Note on vote (2022 Assembly)

Vote is not a census variable and cannot be a poststratification cell. Use
area-level 2022 vote share (by ward/DEA) as an area covariate in the model
instead.
