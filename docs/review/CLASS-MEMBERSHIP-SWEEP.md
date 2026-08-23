# Layers sitting outside their own class

> **Status: swept and resolved, 2026-08-23.** Ten layers added to four classes, four left
> out deliberately. Prompted by one pinned test failure that turned out to be the visible
> corner of a wider pattern.

## What a class is, and why this mattered

`data/database/maps.json` has a `classes` array. A class is what the catalogue renders as
a single grouped card — a time series of one boundary type — and its `maps` array is the
membership list. `timeSeriesChains` also resolves through `classIds`, so a layer missing
from its class is missing from the series that class represents.

The trigger: `catalogue-metadata.spec.js` had a `test.fail()` pin recording that
`flat-provinces` contained `provinces-1955` and `provinces-1899` but not `provinces`
(Provinces of Ireland 2019). Its own note said this was "either a catalogue grouping
regression or a deliberate restructure, and I could not tell which".

**It was neither.** The class simply listed two of the three layers. Category and
`parentId` — the two things previously inspected — were never the mechanism.

## Which way it should go

The comparable case is decisive:

| | modern layer | `featured` | in its class |
|---|---|---|---|
| Counties | `counties-ireland` (1977) | yes | **yes** — with 1915, 1922, 1927, 1955, 1957 |
| Provinces | `provinces` (2019) | yes | **no** — 1899 and 1955 grouped without it |

Provinces was the only category whose modern vintage sat outside its own class, and it
shares provider `["OSI", "Phelim Birch"]` with `provinces-1955`. Same lineage, split for
no recorded reason.

## The sweep

Grouping every map by its id family stem and comparing against class membership found
five classes with orphans. Each was judged individually rather than bulk-added — the two
`ni-pcs` orphans are exactly the case that would have made a bulk fix wrong.

### Added (10)

| Class | Added | Why |
|---|---|---|
| `ireland-provinces` | `provinces` (2019) | the finding above |
| `ni-county-eds` | `county-ed-1957-04-01` | a single gap in a dense run — 1956-04-01 and 1958-04-01 are both members |
| `eds-historic` | `eds-roi-1921-06-28`, `-1941`, `-1942`, `-1943`, `-1946`, `-1953`, `-1955`, `-1985` | identical in kind, provider and scope to the 26 existing members, which already include adjacent years |

Members are ordered descending by date, matching the existing convention. No date
collides with an existing member.

### Left out on purpose (4)

| Class | Not added | Why |
|---|---|---|
| `ni-pcs` | `pc-1884`, `pc-1918` | both are titled "**pre-partition**" and the class is scoped Northern Ireland, which did not exist before 1921. Correctly excluded |
| `ni-lgds` | `lgd-1966` | "Rural and Urban Districts" is a **different entity** from post-1973 Local Government Districts. It may belong in the pre-1972 class the `local-govt` chain points at — worth a look, but it is not an `ni-lgds` member |
| `eds-historic` | `eds-roi-1971-04-15` | **date collision**: `eds-1971` is already a member at the identical date 1971-04-15, and this record has an empty `provider`. Suspected duplicate record, not an omission — folding it in would put two entries on one date |

## Follow-ups this raised

- **`eds-roi-1971-04-15` vs `eds-1971`** — same date, one with no provider. Decide whether
  it is a duplicate to remove or a distinct record to describe.
- **`lgd-1966`** — probably belongs in the pre-1972 local-government class rather than
  nowhere.
- **`render/src/time-series-controller.js:12`** reads `chain.maps` / `chain.layers`, but
  the chains in `maps.json` carry `segments[].classIds`. That consumer therefore resolves
  nothing for **any** chain. Unrelated to membership, found while checking what class
  membership affects, and worth its own investigation.

## Guard

`catalogue-metadata.spec.js` asserts the provinces case directly and is no longer pinned.
There is no validator for the general shape; the sweep above is a one-off query, and
re-running it is the cheap way to check nothing has drifted.
