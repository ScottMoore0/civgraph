# Candidate attributes

Two fields on every individual candidacy in `test/metadata/elections-test2/*.json`:

```json
"party": "Aontú",
"alignment_label": ["nationalist", "pro-unity", "republican"],
"endorsed_by": []
```

Both are ordered arrays of zero or more strings, written explicitly — an empty array,
never a missing key — so "nothing recorded" is distinguishable from "not yet applied".

**They are not the same kind of fact, and that governs how each is populated.**

| | `alignment_label` | `endorsed_by` |
|---|---|---|
| kind | **derived** | **external claim** |
| source | a function of (party string, body, date) via `alignment_rules.json` | per-candidacy assertions in `endorsements.csv` |
| reproducible | yes — re-running regenerates it identically | no — each row is someone's claim |
| coverage | exhaustive, 49.8% labelled by rule | sparse by nature |
| a disagreement is | a disagreement about a rule | a disagreement about a fact |
| needs a citation | no | **yes** |

Nothing in an election result records who endorsed whom, so `endorsed_by` cannot be
derived from this data at any level of effort. That is why it has its own file, its own
`source` and `confidence` columns, and defaults to empty.

---

## `alignment_label`

A constitutional-alignment label per candidacy. Vocabulary: `unionist`, `pro-union`,
`nationalist`, `pro-unity`, `republican`, `other`.

### Current rules

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
python scripts/apply_candidate_attributes.py            # apply both fields
python scripts/apply_candidate_attributes.py --check    # report only, write nothing
python scripts/apply_candidate_attributes.py --leads    # refresh endorsement leads only
```

Idempotent. Re-run after any rebuild of `test/metadata/elections-test2/`.

**Why the field lives there and not upstream.** The upstream source
(`election-viewer-package/data/elections/<body>/<date>/<constituency>.json`) is raw
EONI-shaped count data — one row per candidate *per count* — so there is no single
object representing a candidacy to hang the field on. The test2 metadata is the form
where each candidacy is exactly one object, and it is what both the site and the
analysis read. `scripts/build-test2-election-manifest.mjs` copies candidates with an
object spread, so both fields survive a manifest regeneration; they do not survive a
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

---

## `endorsed_by`

Which **other** parties backed a candidacy. Currently 0 of 29,697 populated: the
mechanism is in place, the claims are not, because each one needs a source.

### What counts, and what deliberately does not

- **The candidate's own party is never listed.** That is what `party` is for.
  `endorsed_by` records backing by organisations *other than* the candidate's own.
- **A stand-aside is not an endorsement.** A party declining to contest a seat and a
  party actively backing someone are different facts. The UUP did not stand against
  Sylvia Hermon in North Down in 2015; it did not thereby endorse her. Treating the two
  as one would manufacture endorsements wholesale — so stand-asides, which *are*
  derivable from the results, go to `endorsement_leads.csv` and never into the field.
- **A joint ticket is not an endorsement, it is a party.** `UCUNF` (UUP + Conservative,
  2010) already exists as its own party string.
- **It attaches to a candidacy, not a person.** Hermon 2010 and Hermon 2017 are separate
  rows and may differ.
- **Empty means "no endorsement recorded", not "no endorsement existed."** Absence of
  evidence only.

### Adding one

```csv
election_key,constituency,candidate_id,candidate_name,party,endorsed_by,kind,source,confidence,note
house-of-commons-of-the-united-kingdom__2010-05-06,Fermanagh and South Tyrone,,Rodney Connor,Independent Unionist,DUP|UUP,agreed-candidate,<cite>,high,unionist unity candidate
```

Key is `election_key` + `constituency` + `candidate_id`, same as the alignment
overrides. `endorsed_by` is pipe-separated. `kind` distinguishes `endorsement` /
`joint-ticket` / `agreed-candidate`. `source` and `confidence` are not optional in
practice — an uncited endorsement is not usable.

The script warns if a row names the candidate's own party as an endorser.

### `endorsement_leads.csv` — triage, not data

Generated from the results: every constituency where a party contesting at least 60% of
that election's areas did **not** stand. 1,057 across 54 contests. This is evidence a
stand-aside happened; whether an endorsement accompanied it is exactly the external
question the file cannot answer.

It recovers every well-documented Westminster arrangement, which is the check that it
works:

| year | evidence in the data |
|---|---|
| 2010 | DUP absent in Fermanagh & South Tyrone — Rodney Connor, agreed unionist candidate |
| 2015 | UUP absent in Belfast East and Belfast North; DUP absent in Fermanagh & South Tyrone and Newry & Armagh — the four-seat pact |
| 2017 | UUP absent in Belfast North; DUP absent in Fermanagh & South Tyrone |
| 2019 | SDLP absent in Belfast North; SF absent in Belfast South, Belfast East and North Down |

It also contains plain noise, which the `absent_party_contested` column exposes: the
Green Party is "absent" from seven 2024 seats only because it stood in 11 of 18, and
Alliance from five 2005 seats because it stood in 13 of 18. Neither is a pact. Read that
column before treating a row as a lead.

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

---

## Files

| file | what it is |
|---|---|
| `alignment_rules.json` | authoritative alignment rules; edit here, then re-run |
| `alignment_overrides.csv` | per-candidacy alignment overrides, for independents |
| `endorsements.csv` | per-candidacy endorsement claims, with source and confidence |
| `alignment_review.csv` | generated — every unlabelled party string, for triage |
| `alignment_coverage.csv` | generated — what each labelled string received |
| `endorsement_leads.csv` | generated — stand-asides detected in the results |
