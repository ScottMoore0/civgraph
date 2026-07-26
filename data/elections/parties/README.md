# Party lifespans

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
| Ecology (NI) | 1981-05-20 | **dissolved** | 1990-02-12 | 13 | 1981-05-20 | 0y 0m |
| Green (NI) | 1990-02-12 | active | — | 263 | 1990-05-17 | 0y 3m |
| UKUP | 1996-04-20 | dissolved | 2008-09-04 | 74 | 1996-05-30 | 0y 1m |
| NIUP | 1999-01-15 | dissolved | 2008-03-10 | 12 | 2001-06-07 | 2y 4m |
| PBP | 2005-10-21 | active | — | 108 | 2007-03-07 | 1y 4m |
| TUV | 2007-12-07 | active | — | 264 | 2009-06-04 | 1y 6m |
| NI21 | 2013-06-06 | dissolved | 2016-11-03 | 49 | 2014-05-22 | 0y 11m |

14,343 of 23,920 party candidacies (60.0%) now belong to a party with a recorded
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
   the date. Currently **3**, and they turn out to be one phenomenon:

   | date | contest | candidate | string | founded | early by |
   |---|---|---|---|---|---|
   | 1987-06-11 | Westminster, East Londonderry | Malcolm Samuel | `Green` | 1990-02-12 | 2y 8m |
   | 1989-06-15 | European, Northern Ireland | Malcolm Samuel | `Green` | 1990-02-12 | 8m |
   | 1995-06-15 | Westminster by-election, North Down | Robert McCartney | `UKUP` | 1996-04-20 | 10m |

   **The dataset back-labels candidacies with the party a candidate later belonged to.**
   McCartney won the 1995 North Down by-election before the UK Unionist Party existed;
   Samuel stood under the Ecology label before the Green Party was founded. In both cases
   the compiler has applied the later party name retrospectively — the same behaviour
   already visible in `Green / Ecology`, a merged label spanning two organisations.

   This matters beyond these three rows: it means a `party` string is **not** reliable
   evidence of what a candidate stood as at the time, and any analysis treating it that
   way will date party activity too early. These contradictions are only visible because
   the founding dates are explicit; the derived `firstYear` would simply have reported
   1987 and 1995 as the parties' first years and no one would have noticed.

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
