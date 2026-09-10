# Persons index: entries that are not people

> **Status: mostly resolved — 2026-09-10.** 10 records remain flagged, both kinds being
> modelling questions rather than junk. The original 2026-08-26 findings are kept below
> unchanged; this section records what has happened since.

## Update, 2026-09-10

**Step 1 is answered: the names are NOT recoverable.** The source rows in
`data/elections-source/data/elections/local-government/` already carry `"Firstname": ""`
with the party fragment sitting in `Surname`, so the real candidate name is absent rather
than mangled. The defect predates this repo's ingest and nothing held locally can recover
it. The `Candidate_Id` survives, so recovery would mean an external lookup against EONI.

That changes the shape of the fix. These are real candidacies with real votes, several of
them winning ones, and only the name is missing. Deleting the rows would discard genuine
results, so the candidate rows are left exactly as they are and only the **person** is
suppressed.

**Step 2 is done.** `scripts/validate-candidate-name-party.mjs` implements the rule this
document asked for and is wired into `npm run check` as `check:candidate-name-party`. It
pins the known artefacts and fails on new ones, so the defect cannot grow. Note it reads
the source bundles (19,199 rows), a different and smaller population than the published
metadata (29,697 candidacies).

**New: the persons index no longer mints people from these names.** The rule now lives in
`scripts/lib/person-name-artefacts.mjs`, shared by `buildPersons` and the audit so the two
cannot disagree, and the build reports what it skipped:

```
- persons: skipped 67 candidacy row(s) whose name is not a person:
  Party (47), Ireland (7), Voice (5), (politician) (3), Féin (3), NI21 (1), UKIP (1)
```

**NI21 and UKIP are decided.** Both were left open below. Both are single rows in the 2014
local government election, both `name` exactly equal to `party`, both elected. Same defect
family as the fragments, so both are suppressed as non-people.

**The count moved twice, for reasons worth recording.** Stamping real person ids onto
candidacies split the artefacts apart: one merged "Party" person carrying 47 elections
became 47 separate people, and the flagged total went from 14 to 76. Name-slugging had
been concealing the scale by collapsing every occurrence into a single record. Suppression
now takes it to **10**. The affected elections are 2014, 2019 and **2023**, one more than
recorded below.

**What is left, both needing a decision rather than a cleanup:** the 4 candidate lists and
the 6 Wikipedia disambiguators, exactly as analysed in the two sections below. Neither is
junk and neither should be deleted.

---

> **Original findings, 2026-08-26. NOTHING HAD BEEN CHANGED at that point.** Prepared at
> your request rather than rolled into production. `scripts/review/audit-person-name-artefacts.mjs`
> reproduces every number here and is not wired into `build` or `check`.

## What was found

`buildPersons()` mints a person from every candidate name it sees. That is right for
candidates and wrong for anything else that reaches the name field. Two classes had
already got in; one was fixed on 25 August, the other is below.

**14 of 11,960 records are not people**, in five distinct kinds:

| Kind | Count | Examples |
|---|---:|---|
| party-name fragment | 4 | **Party** (47 elections), **Ireland** (7), **Voice** (5), **Féin** (3) |
| candidate list | 4 | *Independent (Alan Chambers) list* (19), *Independent (Oliver McMuIlan) list* (6) |
| Wikipedia disambiguator | 3 | *Frederick Thompson (Northern Irish politician)* |
| name is a party | 2 | **NI21**, **UKIP** |
| bare disambiguator | 1 | **(politician)** (3) |

## The cause, traced rather than guessed

The fragments come from the candidate rows themselves. Queried in `civgraph-elections`:

```
name="Party"  party="SDLP"       local-government-…__2014-05-22   11 rows
name="Party"  party="DUP"        local-government-…__2019-05-02   10 rows
name="Party"  party="UUP"        local-government-…__2014-05-22    7 rows
name="Voice"  party="TUV"        local-government-…__2014-05-22    4 rows
name="Féin"   party="Sinn Féin"  local-government-…__2014-05-22    3 rows
```

Read those against the full party names and the mechanism is plain:

- **Party** ← Social Democratic and Labour **Party**, Democratic Unionist **Party**, Ulster Unionist **Party**
- **Voice** ← Traditional Unionist **Voice**
- **Féin** ← Sinn **Féin**
- **Ireland** ← …of Northern **Ireland**

Something splitting a *"Name, Party"* string took the tail of the party as the name. It is
**confined to Northern Ireland local government, 2014 and 2019** — 47 rows across 2
elections for "Party", 3 elections for "Ireland".

**So the defect is in the ingest, not in `buildPersons`.** That decides where to fix it:
cleaning it in `buildPersons` would tidy the persons index and leave the candidate rows
wrong — and those rows are what the election panes, the semantic graph and any future
analysis all read. The persons index is where you *notice* it, not where it is.

## What I deliberately did not do

**No blanket rule.** Two candidate rules look tempting and are both wrong:

- *"reject single-word names"* would delete real people. Bare surnames appear
  legitimately in older sources.
- *"reject anyone who stood for 4+ parties"* matches **155 records**, including Éamon de
  Valera (4 parties), Patrick Hogan (6) and Seán T. O'Kelly (4). Those are real careers
  spanning decades, not artefacts.

Any rule aggressive enough to catch these 14 automatically would take real people with
them. The set is small enough to decide individually, and that is the recommendation.

## The five kinds need three different decisions

**1. Party-name fragments (4) and bare disambiguator (1) — delete, and fix the ingest.**
These are not people under any reading. The 47 "Party" rows should have carried real
candidate names; whether those names are recoverable from the source depends on what the
ingest still has. If they are not recoverable, the rows are incomplete data and should be
marked as such rather than silently dropped.

**2. Candidate lists (4) — a modelling question, not a cleanup.**
*"Independent (Alan Chambers) list"* is a real thing that stood in a real election; it is
just not a person. It wants an entity type of its own, or to be attached to the person it
is named for. Deleting it would lose 19 elections' worth of genuine data.

**3. Wikipedia disambiguators (3) — real people, wrong names.**
*Frederick Thompson (Northern Irish politician)* is a person; the qualifier is scaffolding
from the source. Strip the parenthetical, then check for a collision — the qualifier
exists precisely because more than one Frederick Thompson does, so removing it may merge
two people who should stay separate. That check matters more than the strip.

**NI21 and UKIP (2)** sit between kinds 1 and 3: each has exactly one election, so they
may be a party standing where a candidate was expected, or a genuine mis-key. Worth
looking at the two source rows before deciding.

## Suggested order

1. Confirm whether the 47 "Party" rows have recoverable candidate names in the source.
2. Fix the ingest so the fragment cannot recur, and add a validator: a candidate name that
   is a word of its own party's name is always wrong.
3. Decide the modelling question for candidate lists.
4. Strip the Wikipedia qualifiers, checking for collisions first.

Steps 1 and 2 are the ones that stop it growing. The rest is cleanup of 11 records.
