# `alignment_label`

A constitutional-alignment field on every individual candidacy in
`test/metadata/elections-test2/*.json`.

```json
"party": "Aontú",
"alignment_label": ["nationalist", "pro-unity", "republican"]
```

The value is an **ordered array of zero or more strings** — a tuple. An empty array
means no rule matched and no label has been set. It is written explicitly rather than
omitted, so "this candidacy has no alignment" is distinguishable from "the field has
not been applied yet".

Vocabulary: `unionist`, `pro-union`, `nationalist`, `pro-unity`, `republican`, `other`.

## Current rules

| labels | parties |
|---|---|
| `unionist`, `pro-union` | DUP, UUP, TUV, PUP, UKUP *(also as `UK Unionist Party`)*, NI Unionist Party *(also as `Northern Ireland Unionist Party`)*, Vanguard Unionist Progressive Party, Ulster Popular Unionist Party, Unionist Party of Northern Ireland, UUUP, Protestant Unionist *(also as `Protestant Unionist Party`)*, Unionist, and four records with a corrupted party field |
| `nationalist`, `pro-unity` | SDLP, Nationalist Party *(NI bodies only)* |
| `nationalist`, `pro-unity`, `republican` | Sinn Féin, Aontú |
| `pro-unity`, `republican` | PBP |
| `other` | Alliance, from the 1998 Assembly election (1998-06-25) onward |
| `pro-union` | Alliance, before 1998-06-25 |

14,777 of 29,697 candidacies are labelled (49.8%). The unlabelled remainder is mostly
parties in the Republic, referendum Yes/No rows, and independents.

## Applying it

```
python scripts/apply_alignment_labels.py            # apply
python scripts/apply_alignment_labels.py --check    # report only, write nothing
```

Idempotent. Re-run after any rebuild of `test/metadata/elections-test2/`.

**Why the field lives there and not upstream.** The upstream source
(`election-viewer-package/data/elections/<body>/<date>/<constituency>.json`) is raw
EONI-shaped count data — one row per candidate *per count* — so there is no single
object representing a candidacy to hang the field on. The test2 metadata is the form
where each candidacy is exactly one object, and it is what both the site and the
analysis read. `scripts/build-test2-election-manifest.mjs` copies candidates with an
object spread, so the field survives a manifest regeneration; it does not survive a
rebuild that discards the files, hence the re-run note above.

## Setting independents case-by-case

Add a row to `alignment_overrides.csv`. An override beats any party rule.

```csv
election_key,constituency,candidate_id,candidate_name,party,alignment_label,note
northern-ireland-assembly__2022-05-05,North Down,12345,Alex Easton,Independent Unionist,unionist|pro-union,sat as an independent unionist
```

- Key is `election_key` + `constituency` + `candidate_id`; `candidate_name`, `party`
  and `note` are for your reference and are not matched on.
- `alignment_label` is pipe-separated. Leave it empty to force no labels.

## What was deliberately *not* labelled

Party strings are matched **exactly**. Near-misses are never folded in silently —
`alignment_review.csv` lists all 210 unlabelled strings with candidacy counts, bodies
and a suggested action, 41 of them flagged as needing a decision. The judgement calls
worth knowing about:

- **`Progressive Unionist`** (10 candidacies, 1938 Stormont only) is *not* the PUP,
  which was founded in 1979, and remains unlabelled.
- **`Nationalist Party`** on 59 `dail-eireann` candidacies (1918–22) is the Irish
  Parliamentary Party, a different organisation from the NI Nationalist Party — hence
  the NI-body scope on that rule.
- **`Pro-Treaty Sinn Féin`**, **`Anti-Treaty Sinn Féin`**, **`Republican Sinn Féin`**
  and **`Sinn Féin Workers'`** are distinct parties from Sinn Féin.
- **`Solidarity-PBP`** (86, 2019–24) is the separate joint ticket registered in the
  Republic, not PBP.
- `Ind. Unionist Party`, `Unofficial Unionist`, `South Belfast Unionists`,
  `Labour Unionist`, `Irish Unionist` — minor or one-off labels, not in the list.

## Files

| file | what it is |
|---|---|
| `alignment_rules.json` | the authoritative rules; edit here, then re-run |
| `alignment_overrides.csv` | per-candidacy overrides, for independents and anything else |
| `alignment_review.csv` | generated — every unlabelled party string, for triage |
| `alignment_coverage.csv` | generated — what each labelled string received |

## Labelled despite a corrupted source field

Four records carry something other than a party in the `party` field and are labelled
`unionist` + `pro-union` by the `unionist-corrupted-strings` rule. The underlying field
is deliberately left uncorrected, so the rule labels around the defect rather than
hiding it:

| party string | contest | candidate | actual party |
|---|---|---|---|
| `Shopkeeper, Ulster Unionist` | 1989 Ballymoney Town | James Johnston McKeown | UUP |
| `Businssman Ulster Unionist` *(sic)* | 1989 Ballymoney Town | James Simpson | UUP |
| `DUP Civil Servant (Retired)` | 1989 Ballymoney Town | Samuel McConaghie | DUP |
| `United Loy DUP` | 1977 Larne Area A | Samuel J. Martin | DUP |

Ian Paisley appears under both `Protestant Unionist` (1969 Stormont, Bannside) and
`Protestant Unionist Party` (1970 Westminster, North Antrim), which is why both strings
are treated as the same party.
