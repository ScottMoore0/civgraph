# Party registry and lifespans

## `party_registry.json` — stable ids

Every party and independent label now has a **curated id, independent of its display
name**, and every one of the 29,697 candidacies carries `party_id` pointing at it.

```json
"party": "Green",
"party_id": "green-ni",
```

Why it was needed: nothing in the data identified a party. A candidacy carried only a
free-text string, and the browse registry's `id` is the name slugified — `id ==
"party:" + slug` in 773/773 entries, `slug == slugify(canonicalName)` in 761/773 — so it
cannot tell two same-named organisations apart and splits one organisation across
spelling variants. Hence 773 entries for far fewer real parties, 76% of them linked to
no election at all.

**224 entities, 38 curated and 186 provisional.** Resolution is by string, optionally
narrowed by `bodies` and by a half-open date window, plus the entity's own lifespan.
That is what separates same-named organisations:

| string | scope | id |
|---|---|---|
| `Nationalist Party` | NI bodies | `nationalist-party-ni` |
| `Nationalist Party` | Dáil | `irish-parliamentary-party` |
| `Green` | NI bodies | `green-ni` |
| `Green` | Republic | `green-ie` |
| `Green / Ecology` | before 1990-02-12 | `ecology-party-ni` |
| `Green / Ecology` | from 1990-02-12 | `green-party-ni` |
| `Progressive Unionist` | 1938 | `progressive-unionist-1938` |
| `PUP` | 1979– | `pup` |
| `Vanguard Unionist Progressive Party` | 1972–78 | `vanguard` |
| `Vanguard Unionist Progressive Party` | 1982–87 | `vanguard-1982` |

The two Vanguard entities carry an **identical `name`** and differ only by id — the case
the scheme exists for. They share one alias string and are separated by their lifespans
alone, which are disjoint.

And it merges what should be merged: `UKUP` with `UK Unionist Party`, `Workers' Party`
with `Workers Party`, `Protestant Unionist` with `Protestant Unionist Party`.

**Types matter as much as ids.** Not everything with a `party` string is a party, and
conflating them is how `Independent` ends up looking like the sixth-largest party in
Northern Ireland:

| type | n | examples |
|---|---|---|
| `party` | 200 | `uup`, `green-ni`, `ecology-party-ni` |
| `independent-label` | 18 | `ind`, `ind-unionist`, `ind-named` |
| `banner` | 2 | `unity`, `anti-h-block` |
| `joint-ticket` | 2 | `ucunf`, `solidarity-pbp` |
| `referendum-option` | 2 | `ref-yes`, `ref-no` |

**Resolution is complete**: 29,691 of 29,697 candidacies resolve cleanly, 6 resolve to an
entity but fall outside its lifespan (the back-labelling cases), 0 unresolved, 0
ambiguous.

`provisional: true` marks the 186 auto-generated entities — one observed string each, id
slugged from the name, no source, no lifespan. They give complete coverage while staying
visibly unreviewed. Curating one means confirming its alias set, type, dates and source.

**Ids are permanent.** Renaming an organisation changes `name`, never `id`.

### Two sources of truth, for now

`party_lifespans.json` remains the curated lifespan input and is what
`validate_party_lifespans.py` checks. `build_party_registry.py` copies those lifespans
into the registry at bootstrap. **Editing `party_lifespans.json` after bootstrap does not
propagate** — the registry would need rebuilding with `--force`, which discards hand
edits. The clean fix is to migrate the validator onto the registry and retire the
lifespans file; until then, treat lifespan edits as needing both files updated.

---

# Lifespans

Explicit founding and dissolution dates for political parties, asserted as facts about
the organisations rather than inferred from their presence in election results.

```json
{
  "id": "ni21", "shortName": "NI21",
  "founded": "2013-06-06", "foundedPrecision": "day",
  "dissolved": "2016-11-03", "status": "dissolved",
  "partyStrings": ["NI21"],
  "source": "supplied by repository owner, 2026-07-26", "confidence": "high"
}
```

## Why this file exists

The party registry at `data/browse/details/parties/` carries `firstYear` and `lastYear`,
which look like a lifespan and are not. They are **exactly** the minimum and maximum year
of each party's linked elections — verified on all 185 entries that have them, with zero
exceptions — so they are a summary of contest history. As founding dates they are simply
wrong (UUP 1921 against an actual 1905; DUP 1973 against 1971; Alliance and SDLP 1973
against 1970), and only 24% of the 773 registry entries have them at all.

`lastYear` is the worse of the two, because it collapses four different situations that
no consumer can then tell apart: the party dissolved, the party exists but has not
contested recently, the party exists and the dataset merely stops in 2024, and the label
outlived the organisation. Vanguard shows `1973–1982` but dissolved in 1978 — those 1982
entries are three candidates still using a dead party's label.

## The field that fixes it

`status` is the load-bearing part of the schema:

| status | meaning | `dissolved` |
|---|---|---|
| `active` | the party still exists — a null `dissolved` is a **positive fact** | must be null |
| `dissolved` | the party ceased to exist | must be a date |
| `unknown` | no dissolution date recorded and **none should be inferred** | null |

A party that stopped contesting has not thereby been dissolved, and a party whose label
appears after its dissolution is not thereby still alive. Without `status`, a null
`dissolved` cannot distinguish "still going" from "we don't know".

`foundedPrecision` (`day` / `month` / `year`) exists so a party known only to a year can
be recorded as `YYYY-01-01` with precision `year`, rather than inventing a false exact
date. Every entry so far is `day`.

## Current entries

| party | founded | status | dissolved | candidacies | first contest | gap |
|---|---|---|---|---|---|---|
| UUP | 1905-03-03 | active | — | 4,108 | 1921-05-24 | 16y 2m |
| Sinn Féin | 1905-11-28 | active | — | 2,505 | 1918-12-14 | 13y 0m |
| Alliance | 1970-04-21 | active | — | 1,757 | 1973-05-30 | 3y 1m |
| SDLP | 1970-08-21 | active | — | 2,438 | 1973-05-30 | 2y 9m |
| DUP | 1971-09-30 | active | — | 2,752 | 1973-05-30 | 1y 8m |
| Vanguard | 1972-02-09 | dissolved | 1978-02-20 | 92 | 1973-05-30 | 1y 3m |
| Vanguard (1982) | 1982-08-30 | dissolved | 1987-05-27 | 3 | 1982-10-20 | 0y 1m |
| Ecology (NI) | 1981-05-20 | **dissolved** | 1990-02-12 | 13 | 1981-05-20 | 0y 0m |
| Green (NI) | 1990-02-12 | active | — | 263 | 1990-05-17 | 0y 3m |
| UKUP | 1996-04-20 | dissolved | 2008-09-04 | 74 | 1996-05-30 | 0y 1m |
| NIUP | 1999-01-15 | dissolved | 2008-03-10 | 12 | 2001-06-07 | 2y 4m |
| PBP | 2005-10-21 | active | — | 108 | 2007-03-07 | 1y 4m |
| TUV | 2007-12-07 | active | — | 264 | 2009-06-04 | 1y 6m |
| NI21 | 2013-06-06 | dissolved | 2016-11-03 | 49 | 2014-05-22 | 0y 11m |

14,435 of 23,920 party candidacies (60.3%) now belong to a party with a recorded
lifespan. A further 5,777 of the 29,697 total are not party candidacies at all —
independents, referendum Yes/No rows, and the non-party banners.

The UUP and Sinn Féin gaps are large for ordinary reasons: there was no Northern Ireland
parliament to contest before 1921, and the dataset's earliest contest is 1918.

## Succession versus split

These are different relationships and the schema keeps them apart, because conflating
them asserts something false.

| field | meaning | what the registry enforces |
|---|---|---|
| `predecessor` / `successor` | a **succession** — the predecessor ends, the successor begins | the two dates must match **exactly** |
| `splitFrom` | a **split** — the parent **continues**, the child branches off | only that the parent existed on the child's founding date |
| `revivalOf` | a **revival** — a dissolved name taken up again after a **gap** | the earlier entity must be dissolved on or before this one's founding |

Ecology → Green is a succession: Ecology dissolved on 1990-02-12 and Green was founded
the same day. NIUP is a **split** from the UKUP: the UKUP carried on and contested until
2007, so recording it as a succession would wrongly assert the UKUP ended in 1999.

Both checks are live rather than decorative — moving NIUP's founding to 1994 makes the
validator report *"niup splitFrom ukup: parent did not exist on 1994-01-15 (parent
window [1996-04-20..—))"*.

The parent and the splinter both wound up in 2008, six months apart — NIUP on 10 March,
the UKUP on 4 September — which the `splitFrom` link now makes visible as a single
story rather than two unrelated rows.

Both also show why `status` matters. NIUP's last candidacy is 2003-11-26, more than four
years before it dissolved; the UKUP's is 2007-03-07, eighteen months before. The derived
`lastYear` would have reported those parties as ending in 2003 and 2007.

## Strings shared between two parties

Membership is the **half-open interval `[founded, dissolved)`**. A candidacy dated
exactly on a dissolution date belongs to the **successor**, so a same-day handover —
Ecology dissolving on 1990-02-12, Green founded on 1990-02-12 — has neither a gap nor an
overlap. The registry checks that `predecessor`/`successor` pairs line up on the day.

A party string **may be claimed by two parties** provided their windows are disjoint.
That is what makes succession expressible, and the Ecology/Green case needs it:

| string | used by | spans | resolves to |
|---|---|---|---|
| `Ecology` | Assembly, Westminster, European | 1982–1984 | Ecology only |
| `Green / Ecology` | **local-government only** | 1981–2011 | **split by date** — 9 to Ecology, 49 to Green |
| `Green` | NI bodies | 1987–2024 | Green (NI) |
| `Green` | `dail-eireann`, `ireland-european` | 1984–2024 | **deliberately unattributed** |

`Green / Ecology` is not a contemporary party name — it appears on 58 candidacies, all
of them in the local-government dataset, spanning thirty years across both
organisations, while the same era's Assembly and Westminster contests use `Ecology` and
then `Green`. It is a compiler's merged label, and only the date can resolve it.

The `Green` string is scoped by body because it carries **264 candidacies in
`dail-eireann` and `ireland-european`** that belong to the Green Party in the Republic —
a separate organisation, with no dates supplied here. Those are left unattributed rather
than silently folded into the NI party.

**`PBP` is deliberately not scoped that way**, and the contrast is the point. Its 108
candidacies split 75 on NI bodies and 33 in `dail-eireann` / `ireland-european`, but
People Before Profit organises across both jurisdictions as one party, so both are
attributed to the single entry. Cross-jurisdiction usage of a string is therefore not by
itself a reason to split — whether the organisations are the same is. If PBP should in
fact be two entries, it needs splitting the way Green does.

`Solidarity-PBP` (86 candidacies, 2019–2024, `dail-eireann` and `ireland-european` only)
is **not** included in the PBP entry: it is the joint ticket registered with Solidarity,
and a joint ticket is its own registration rather than the component party — the same
treatment `UCUNF` gets, and consistent with how `endorsed_by` treats joint tickets.

## Validating

```
python scripts/validate_party_lifespans.py
python scripts/validate_party_lifespans.py --wanted 40
```

Four checks:

1. **Contradiction** — the string is claimed for that body, but no party's window covers
   the date. Currently **3**, all of one kind.

   **Before founding — the label applied retrospectively:**

   | date | contest | candidate | string | founded | early by |
   |---|---|---|---|---|---|
   | 1987-06-11 | Westminster, East Londonderry | Malcolm Samuel | `Green` | 1990-02-12 | 2y 8m |
   | 1989-06-15 | European, Northern Ireland | Malcolm Samuel | `Green` | 1990-02-12 | 8m |
   | 1995-06-15 | Westminster by-el., North Down | Robert McCartney | `UKUP` | 1996-04-20 | 10m |

   McCartney won North Down in 1995 before the UK Unionist Party existed; Samuel stood
   under the Ecology label before the Green Party was founded. The compiler has applied
   the later party name backwards — the same behaviour visible in `Green / Ecology`, a
   merged label spanning two organisations.

   **After dissolution — resolved.** The three 1982 Vanguard candidacies (William Craig
   in Belfast East, John Dunlop and Robert Overend in Mid Ulster) were contradictions
   until the revived party was recorded as `vanguard-1982` (1982-08-30 – 1987-05-27).
   They now resolve to it, which is what a second entity under the same name is for.

   **A `party` string is not reliable evidence of what a candidate stood as at the
   time.** It has erred in both directions here — too early for parties that later formed
   (these three), too late for one that had dissolved (Vanguard, until the revival was
   recorded). Any analysis treating the string as contemporaneous will overstate a
   party's active span. None of this is visible without explicit dates: the derived
   `firstYear`/`lastYear` would have reported 1987–2024 for Green and 1973–1982 for
   Vanguard without comment.

2. **Ambiguity** — more than one party's window covers a candidacy. A registry bug, not
   a data finding. Currently 0.
3. **Gap** — founding to first recorded contest. A very large gap suggests the string is
   matched too broadly, or that early contests are missing.
4. **Unrecorded** — party strings with candidacies and no entry, ranked by volume, in
   `lifespan_wanted.csv`. Strings that are not organisations (`Yes`, `No`,
   `Independent*`, `Unity`, `Anti H-Block`) are excluded — asking for a founding date for
   a referendum option would be a category error.

The validator never *infers* a lifespan from the contest record. That is what the derived
`firstYear`/`lastYear` already do, and the entire point of this file is to not do it.

## Relationship to the alignment rules

`data/elections/alignment/alignment_rules.json` has `from` / `until` bounds on some
rules. Those are **rule validity windows, not party lifespans**. The Alliance rule
changes at 1998-06-25 because the party's designation changed, not because anything
happened to the party. Keep the two separate: a designation change and an organisational
death are different events.

Two things this file is now the right home for, currently recorded only as prose in rule
comments: that the 1938 `Progressive Unionist` is a different organisation from the PUP
founded in 1979, and that Vanguard ceased to exist before its label stopped appearing.

## Not denormalised onto candidacies

Unlike `alignment_label` and `endorsed_by`, the lifespan is a property of the *party*,
not of the candidacy, so it is not copied onto all 29,697 candidate records. Join on the
`party` string via `partyStrings`.

## Files

| file | what it is |
|---|---|
| `party_lifespans.json` | the registry; edit here |
| `lifespan_wanted.csv` | generated — party strings with no entry, by volume |
| `lifespan_contradictions.csv` | generated — only written when contradictions exist |
