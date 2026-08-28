# Classes with no time-series chain: a proposal

> **Status: proposal for review — 2026-08-28. NOTHING HAS BEEN CHANGED.**
> Research is complete and every uncertainty is named below. No decision has been taken
> and no file has been edited.

## First, a correction to the count

It is **16**, not 17. I previously said 17 and included `pre-1921-pcs`. That class **is** in
a chain — it is the declared `predecessor` of the `parliamentary` chain, and
`build-render-time-series-chains.mjs` already reports it as deliberately unattached to any
column. Counting it as an orphan double-counts a decision that has already been made and
documented.

So: **44 classes, 28 in a chain, 16 not.**

## The finding that changes the recommendation

I previously said "mostly leave them — a hills dataset isn't a boundary succession." Having
now read all 16 with their map counts and date spans, that is right for most and **wrong for
four**: three are genuine successions with no chain yet, and the fourth is not an orphan at
all but a **duplicate class** that should be merged away. That last one I only found by
checking an uncertainty instead of acting on my own recommendation — building it a chain, as
I first proposed, would have entrenched the duplication.

## All 16, grouped by what they actually are

### Group A — genuine successions, currently missing a chain (3)

These have multiple maps at different dates, in the same series. They are omissions.

| Class | Maps | Span | Why it is a succession |
|---|---:|---|---|
| `roi-lea` — Local Electoral Areas | 3 | 2008 – 2019 | LEAs were redrawn for 2014 and again for 2019. Three snapshots of one evolving thing. |
| `ireland-local-authorities-pre-partition` | 4 | 1915 – 1920-10-04 | Four dated states in five years, ending the month before partition. |
| `ni-elb` — Education and Library Boards | 2 | 1984, 1993 | A redraw. **But the class is `hidden: true`** — see uncertainties. |

### Group B — single snapshot, no succession possible (5)

One map each. A chain of one is a layer, and `emit()` already refuses to write one.

`roi-municipal-districts` (2019) · `roi-dublin-electoral-counties` (1985) · `polity-ni` (1921) ·
`polity-roi` (1921) · `roi-gaeltacht` (1982)

### Group C — a set, not a series (3)

Several maps sharing one date. They vary by *kind*, not by *time*.

| Class | Maps | Date |
|---|---:|---|
| `roi-garda-areas` | 4 | all 2011 |
| `roi-legal-towns` | 1 | 2011 |
| `ireland-civil-parishes` | 1 | **undated**, and `hidden: true` |

### Group E — a duplicate class that should not exist (1)

**This was found by checking uncertainty 4, and it changes the recommendation for
`ni-stormont` from "build a chain" to "delete the class".**

The Devolved NI column of the `parliamentary` chain contains `ni-parliament`. That is a
*different class id* from the orphan `ni-stormont`, and the two hold the same maps:

| Class | Maps | In a chain? |
|---|---|---|
| `ni-parliament` — "NI Parliament" | `stormont-1920`, `stormont-1929`, **`stormont-1969`** | yes, Devolved NI |
| `ni-stormont` — "Parliament of Northern Ireland Constituencies" | `stormont-1920`, `stormont-1929` | no |

Same `category` (`devolved`), same `scope` (Northern Ireland), and `ni-stormont`'s maps are a
**strict subset** — it is missing 1969. Building it a chain would give the `/render/` picker
two routes to the same layers, one of which silently omits a decade.

I then checked every other orphan for the same pattern. **`ni-stormont` is the only one**:
the other 15 classes share no map with any chained class. So this is a single, contained
defect rather than a systemic one.

The action is to merge `ni-stormont` away and repoint anything referencing it at
`ni-parliament` — but that needs a reference sweep first, because a class id can be cited
from the catalogue, the render metadata, or the graph.

### Group D — reference datasets, not boundaries at all (4)

The four DoBIH hill classes: `dobih-britain-ireland-…`, `dobih-ireland-…`,
`dobih-england-wales-…`, `dobih-scotland-…`. 26 maps between them, all dated 2026-06-22/24 —
that is the **publication date of DoBIH v18.4**, not a boundary date. A hill does not succeed
another hill. These should never have a chain, and the date field means something different
here from everywhere else in the catalogue.

## The proposal

### 1. Add an explicit `chain` field to every class

Today "no chain" is silence, and silence is unreadable: it cannot be distinguished from an
omission. Every class gets one of:

```jsonc
{ "id": "counties",        "chain": "counties" }              // in a chain
{ "id": "roi-gaeltacht",   "chain": null,
  "chainNote": "single-snapshot: one map, 1982. A chain needs two dated states." }
```

The vocabulary for `chainNote` should be a small closed set, so it can be validated rather
than free-texted:

| Reason | Meaning | Classes |
|---|---|---|
| `single-snapshot` | one dated map; a chain of one is a layer | 5 (Group B) |
| `set-not-series` | several maps, one date; they vary by kind | 3 (Group C) |
| `not-a-boundary-series` | a reference dataset whose `date` is a publication date | 4 (Group D) |
| `pending` | a genuine succession with no chain built yet | 3 (Group A) |
| `duplicate-class` | the class duplicates a chained one and should be merged away | 1 (`ni-stormont`) |

`pending` is the important one: it is the difference between "we decided" and "we have not
got to it", and it is what makes this list shrink over time rather than being frozen.

### 2. Build the Group A chains

Concretely, following the existing single-segment shape:

```jsonc
{ "id": "roi-lea", "name": "Local Electoral Areas (Republic of Ireland)",
  "segments": [{ "classIds": ["roi-lea"] }] }

{ "id": "ireland-local-authorities-pre-partition",
  "name": "Local Authorities (pre-partition Ireland)",
  "segments": [{ "classIds": ["ireland-local-authorities-pre-partition"] }] }
```

Each is a one-line addition to `timeSeriesChains` in `data/database/maps.json`. The generator
and the `/render/` picker then pick them up with no code change, because they read one shape.

### 3. Add `check:class-chain-coverage`

Offline, so it belongs in `check:`. It should fail when a class has neither a chain nor a
`chainNote`, and when a `chainNote` is not in the closed vocabulary. That converts this from
a thing someone has to remember into a thing the build enforces — the same move as
`check:render-time-series`, which exists because the chains sat empty and unnoticed for
months.

## Uncertainties — named rather than resolved

These are the reasons this is a proposal and not a commit.

1. **`ni-elb` is `hidden: true`.** Should a hidden class get a chain at all? A chain would
   surface it in the `/render/` picker, which may be exactly what `hidden` is there to
   prevent. **This needs your decision**, and it is the only Group A item I would not just
   build.

2. **`ireland-civil-parishes` has one map with NO date.** `toEntry()` drops undated maps
   deliberately — an undated chain entry renders `<option value>` of `undefined`. So it
   cannot be chained even if wanted. Is the missing date a data gap worth filling, or are
   civil parishes genuinely undated in this catalogue?

3. **`ireland-local-authorities-pre-partition` may belong with the NI/RoI local government
   chains rather than standing alone.** It ends 1920-10-04; NI local government begins after
   partition. That is either a two-segment chain crossing partition, or two separate series
   that should not be joined. **This is an editorial judgement about whether partition breaks
   a succession**, and the same question `pre-1921-pcs` already raised for parliamentary
   constituencies — where the answer taken was *do not attach it*. Consistency argues for
   leaving this one standalone too, but the cases are not identical.

4. ~~`ni-stormont` overlaps the Devolved NI column.~~ **RESOLVED — see Group E. It does not
   need a decision from you, it needs a deletion.**

5. **The DoBIH `date` field means something different.** All 26 maps carry the dataset's
   publication date. Anything that reasons about dates across the whole catalogue — the
   chain builder, any future timeline — will treat 2026-06-22 as a boundary date for a
   mountain. Worth a separate look; out of scope here.

## Effort

| Step | Effort | Risk |
|---|---|---|
| Add `chain`/`chainNote` to 44 classes | ~1 hour, mechanical | Low |
| Build 2 Group A chains (excluding `ni-elb`) | ~20 min | Low — additive, generator already handles it |
| Merge `ni-stormont` into `ni-parliament` | ~1 hour | **Medium** — needs a reference sweep first |
| `check:class-chain-coverage` | ~1 hour | Low |
| Resolve uncertainties 1, 3, 4 | Discussion, not code | These are the actual work |

**Recommendation: do steps 1 and 3 now** — they are pure legibility and enforcement and carry
no editorial judgement.

**Step 2 is now two chains, not three.** `roi-lea` and
`ireland-local-authorities-pre-partition` are safe and additive. `ni-stormont` is not a
missing chain at all; it is a duplicate class, and building it a chain would have entrenched
the duplication rather than exposing it. That is the single most useful thing this research
turned up, and it came from checking an uncertainty rather than acting on the original
recommendation.

**Two decisions are genuinely yours**: whether a `hidden` class (`ni-elb`) should be
chainable at all, and whether partition breaks a succession for
`ireland-local-authorities-pre-partition`. Everything else is now determined.
