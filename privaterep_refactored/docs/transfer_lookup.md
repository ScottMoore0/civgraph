# Transfer event lookup schema

The election viewer will consume authoritative transfer dictionaries
exposed by the web API. The helper introduced in
`ni_votes/web/transfer_data.py` reshapes the workbook's `Transfers`
worksheet into the following structure:

```python
{
    (date, event, constituency, elected_body): {
        count_number: [
            {
                "count": 2,
                "subject_signature": "subject:100,200",
                "total_transferred": 500.0,
                "source": {
                    "label": "Alice Example, Bob Example",
                    "party": "Party Mix",
                    "classification": "combination",
                    "total_transferred": 500.0,
                    "components": [
                        {
                            "label": "Alice Example",
                            "party": "Party A",
                            "person_id": 100,
                            "contribution": 300.0,
                            "loss": 300.0,
                            "breakdown": [
                                {"destination": "Charlie Recipient", "amount": 180.0},
                                {"destination": "Non-transferable votes", "amount": 120.0},
                            ],
                        },
                        {
                            "label": "Bob Example",
                            "party": "Party B",
                            "person_id": 200,
                            "contribution": 200.0,
                            "loss": 200.0,
                            "breakdown": [
                                {"destination": "Charlie Recipient", "amount": 150.0},
                                {"destination": "Dana Recipient", "amount": 50.0},
                            ],
                        },
                    ],
                    "subject_ids": [100, 200],
                    "subject_signature": "subject:100,200",
                    "person_ids": [100, 200],
                    "is_surplus": False,
                    "is_exclusion": True,
                    "raw_subject": "100,200",
                },
                "destinations": [
                    {
                        "name": "Charlie Recipient",
                        "party": "Party C",
                        "amount": 330.0,
                        "type": "candidate",
                        "person_id": 300,
                        "breakdown": [
                            {"source_label": "Alice Example", "amount": 180.0},
                            {"source_label": "Bob Example", "amount": 150.0},
                        ],
                    },
                    {
                        "name": "Dana Recipient",
                        "party": "Party D",
                        "amount": 50.0,
                        "type": "candidate",
                        "person_id": 400,
                        "breakdown": [{"source_label": "Bob Example", "amount": 50.0}],
                    },
                    {
                        "name": "Non-transferable votes",
                        "party": None,
                        "amount": 120.0,
                        "type": "non_transferable",
                        "person_id": None,
                        "breakdown": [{"source_label": "Alice Example", "amount": 120.0}],
                    },
                ],
            },
            # Additional events for the count…
        ],
        # Additional counts for the election…
    },
    # Additional elections…
}
```

Key points:

* **Election key** – rows are grouped by `(Date, Event, Constituency,
  ElectedBody)` so the lookup can be joined with existing election
  payloads.
* **Subject signature** – the helper collapses `TransferSubject` into a
  stable token (e.g. `subject:100,200`) so counts and components can be
  matched reliably even when donor labels vary between individual
  destination rows.
* **Source summary** – the donor retains the workbook's combined label.
  Components expose both the total contributions and their per-destination
  breakdown so the animation can stage combined rectangles before
  splitting them into individual segments.
* **Destinations** – each candidate (and the non-transferable pile)
  captures the total received plus the component-level breakdown for
  smooth animation sequencing.

This schema is JSON-serialisable, deterministic, and backwards compatible
with the existing election search payloads because it lives under a new
configuration key (`TR_LOOKUP`). Downstream steps can now lift the
pre-computed dictionaries into `/api/search_elections` without needing to
revisit the raw workbook.

## API payload integration

The `/api/import_election` and `/api/search_elections` responses now include
two additional fields derived from the cached lookup:

* `authoritative_transfer_lookup` – a `{count: [TransferEvent, …]}` mapping
  for the requested election. Counts are emitted as integers so consumers can
  address specific stages directly.
* `authoritative_transfer_events` – a list of `{count, events}` objects sorted
  by count to provide a stable, JSON-friendly iteration order. Each entry
  exposes the same `TransferEvent` payload found in the lookup map.

These properties supplement the existing `transfer_events` heuristics without
altering them, allowing the front end to adopt the richer workbook data at its
own pace.

## Testing

Run `pytest tests/test_routes_authoritative_transfer_payload.py` to exercise the
integration point that injects the authoritative lookup into the election
payload. For manual QA steps that cover the API response and browser animation,
refer to `docs/animation_manual_testing.md`.
