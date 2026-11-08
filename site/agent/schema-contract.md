# Civgraph tidy-data schema contract

One canonical shape for every statistical dataset on Civgraph — census, NIMDM,
and the NISRA data-portal cubes — so the whole corpus is queryable the same way.

## The schema

Each dataset is a **tidy long table**: one row per observation (cell).

```
Geography Code, Geography Label, [Time], <dimension columns…>, [Statistic], [Unit], Value
```

- **Geography Code / Label** — the area (or blank for non-geographic series).
- **Time** — the period (`2021`, `2024-Q1`, `2020-2022`). Present as a *column*
  only when it varies within the file; otherwise it is a file-level constant
  (see below).
- **dimension columns** — the categorical breakdowns (age, sex, tenure, domain…).
- **Statistic** — what is measured (`Count`, `Average price`, `Rank`,
  `Life expectancy at birth`…).
- **Unit** — the unit of `Value` (`persons`, `households`, `£`, `£m`, `%`,
  `index`, `years`, `rank`, `decile`…).
- **Value** — the single number.

The 2021 Census format (`Geography…, Category 1..k, Count`) is the **degenerate
profile** of this schema: Time = 2021, Statistic = Count, Unit = persons/
households — all constant, so historically omitted from the row.

## Constants live in the manifest; variables live in the rows

A dimension is written as a **row column** only when it **varies within the
file**. A dimension that is **constant for the whole file** is declared **once**
in the dataset's manifest entry, not repeated on every row:

```json
{ "file": "…", "time": "2021", "statistic": "Count", "unit": "persons",
  "dataset": "PEOPLE", "geography": "DZ21", … }
```

- **Census / NIMDM** — Time, Statistic and Unit are file constants → carried in
  the manifest; the lean CSVs are unchanged.
- **Data-portal cubes** — Time (and often a Statistic dimension) genuinely vary
  row to row → materialised as row columns.

To build a **single stacked table** across the whole corpus, join each lean
file to its manifest metadata and project the constants down onto the rows —
generated on demand rather than baked into hundreds of millions of static rows.

## Manifest metadata fields (every dataset declares these)

`time`, `statistic`, `unit`, `dataset` — plus the existing `geography`, `file`,
`url`. This is what makes census, NIMDM and portal cubes consistently queryable
without rewriting the bulk data.
