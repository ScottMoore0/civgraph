# Plan — a standardised format for STV election data

> **Status: ready to execute, and time-sensitive.** Written 2026-08-23.
> **Design the schema before adding more election data, not after.** Retro-fitting a
> standard across an accumulated corpus is the expensive version of this job, and the
> corpus is already 281 elections.

## What we hold

| Voting system | Contests | Transfer data expected |
|---|---|---|
| `fptp` | 134 | no |
| `stv-hare` | 57 | yes |
| `ordinal` | 47 | — |
| `stv-gregory` | 42 | yes |
| `party-list-dhondt` | 1 | no |

**99 STV contests**, split across two transfer rules, all flagged
`transferDataExpected: true`. Two rules in one corpus is exactly why an ad-hoc shape will
not hold: Hare and Gregory differ in how surpluses are distributed, and a format that
assumes one will quietly misrepresent the other.

## Why this matters beyond tidiness

STV counts are the only place where the *process* is the data. A first-preference table
discards the transfers, and the transfers are what make an STV result interpretable —
who transferred to whom, at what stage, and what that says about political alignment.
Nobody publishes this in a comparable form. **A standard here is a genuine contribution,
not internal hygiene**, and it is the piece that makes "analyse social and political
change" tractable rather than rhetorical.

## The model

An STV contest is a sequence of **counts**. Each count has an event (an exclusion, a
surplus distribution, or the first count), and a set of transfers into candidates.

```jsonc
{
  "contest": "dail-eireann__2020-02-08__dublin-central",
  "system": "stv-gregory",
  "seats": 4,
  "electorate": 60000,
  "validPoll": 38000,
  "quota": 7601,
  "candidates": [
    { "id": "cand:...", "name": "...", "party": "party:...", "elected": true, "electedAtCount": 5 }
  ],
  "counts": [
    {
      "n": 1,
      "event": { "type": "first-preference" },
      "totals": { "cand:a": 9000, "cand:b": 4200 }
    },
    {
      "n": 2,
      "event": { "type": "surplus", "from": "cand:a", "surplus": 1399, "transferValue": 0.155 },
      "transfers": { "cand:b": 400, "cand:c": 250, "nonTransferable": 749 },
      "totals": { "cand:b": 4600, "cand:c": 3250 }
    }
  ]
}
```

Four decisions worth making deliberately:

- **Totals AND transfers on every count.** Redundant, and that redundancy is the
  validator: totals must equal the previous totals plus transfers, every time. It catches
  transcription errors that a transfers-only format cannot.
- **`nonTransferable` is explicit**, never implied by a shortfall. Non-transferable votes
  are a real quantity people analyse.
- **`transferValue` recorded, not derived.** Gregory transfers at a fractional value;
  recording it makes the two systems distinguishable in the data rather than only in a
  label.
- **Candidates are entity ids**, not names. This is the join to the entity model — the
  same person across contests, decades and spelling variants.

## Steps

1. **Schema** — `data/schemas/stv-count.v1.json`, with the arithmetic invariants written
   as validator rules, not prose.
2. **Validator** — `scripts/validate-stv-counts.mjs`. Every contest must satisfy:
   quota consistent with seats and valid poll; totals reconcile across counts; elected
   candidates reach quota or survive to the final count; transfers sum to the surplus or
   the excluded candidate's total. Negative-control each rule.
3. **Convert one contest by hand** — a 2020 Dáil constituency with a known published
   count. Verify against the official result before writing any bulk converter.
4. **Converter** for whatever format the existing count data is held in, one body at a
   time, validating after each.
5. **Backfill 99 contests**, tracking coverage in a report so partial progress is visible.
6. **Expose it**: an API endpoint per contest and a CSV export, because the point is that
   other people can use it.

## Trap

Do not let the schema absorb FPTP and list systems "for consistency". They have no
counts, no quota and no transfers, and a union type that covers everything describes
nothing. **A separate, much simpler result format for non-STV contests is the right
answer**, sharing only the candidate and party entity ids.

## Definition of done

- One hand-verified contest matches its published count exactly.
- The validator fails on a deliberately corrupted transfer, a wrong quota, and a
  non-reconciling total.
- Coverage is reported as a number that can only go up.
