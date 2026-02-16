# Referendum simulator

The referendum simulator now rides on a fully data-driven pipeline that
ingests every available historic Northern Ireland election and
referendum result. Constituency and NI-wide time series, endorsement
timelines, and recency-aware party baselines are all assembled through
the structured ingestion and temporal feature builders delivered in
tasks 1 and 2. Downstream components – training (task 3), per-party
breakdowns (task 4), metadata aggregation (task 5), and the validation
work in this task – sit on top of that shared foundation so the web and
CLI experiences expose consistent, provenance-rich projections.

## Prerequisites

- Install the Python dependencies listed in `requirements-dev.txt`. The
  simulator and its automated tests rely on `pandas`, `numpy`, and
  `scikit-learn`.
- Train or download a referendum model and metadata file. The CLI reads
  the model path configuration from `ni_votes/config.py`.
- For deployment, follow the operational runbook in
  [`docs/referendum_backend_operations.md`](referendum_backend_operations.md)
  to retrain models, publish artefacts, and roll out updates safely.

## Command-line usage

Run the simulator from the CLI by selecting the `predict_referendum`
mode:

```bash
python -m ni_votes.cli.main --mode predict_referendum \
    --date 2020-01-15 --body TestRef \
    --constituency "Belfast East" \
    --output referendum_projection.csv
```

Key options:

- `--date` (required): Date to project, formatted as `YYYY-MM-DD`.
- `--body`: Referendum body identifier. Matches the values displayed on
  the endorsements sheet (e.g., `EuropeReferendum`).
- `--constituency`: Limit the projection to a single constituency. You
  can pass a comma-separated list (e.g., `"Belfast East,Belfast West"`)
  to restrict the simulation to multiple constituencies. Omit the flag
  to simulate every constituency simultaneously.
- `--custom-options` and `--custom-endorsement`: Provide two custom
  options and map parties to them for an ad-hoc referendum. The model
  automatically maps these custom labels onto its internal option
  vocabulary.
- `--output`: Optional CSV path for the generated table.

The command prints a summary table to stdout and writes the detailed
rows to the specified CSV, including electorate, turnout, spoiled
ballots, and vote counts for each option.

## Web interface

The Flask application exposes a `/referendum-simulator` route. The page
lets you:

1. Choose a historic referendum or configure a custom contest.
2. Select the projection date and build the constituency list. You can
   add constituencies individually or import the set used in a historic
   election with one click. The endorsements table automatically shows
   parties that have stood in the five years preceding the chosen date;
   enable the toggle above the table to reveal inactive or historic
  parties when needed. Parties can endorse either referendum option,
  "Did not vote", or "Spoiled" for both predefined and custom polls.
  Selecting the blank placeholder clears an endorsement entirely so a
  party is treated as having no stated position.
3. Trigger the simulation and download the resulting CSV. The results
   include electorate totals, valid vote counts, spoiled ballots,
   turnout (including spoiled papers), and option percentages both of
   the electorate and of valid votes.

### Neutral endorsements at a glance

- Blank (or `?`) entries leave a party neutral; its baseline support is
  added to the `share_no_endorsement` feature rather than an option
  column.
- Selecting **Did not vote** or **Spoiled** explicitly models those
  behaviours instead of neutrality.
- The simulator normalises option labels before applying overrides, so
  variants like `leave`, `Spoilt`, or `Abstain` resolve to the canonical
  options.
- Command-line overrides follow the same rules: omit a party from
  `--override-endorsement` or pass an empty value to keep its supporters
  in the neutral pool.

The simulator reuses the shared model cache, so ensure the referendum
model and metadata files are available before starting the web server.

### Aggregated metadata

Every simulation response now includes a top-level `metadata` payload in
addition to the per-area structures. The metadata summarises the
constituencies included in the run, lists the bodies and event types that
fed the party breakdowns, merges provenance elections (with duplicates
removed), sums the baseline electorates, and indicates whether the
request produced a Northern Ireland aggregate. The UI uses this payload
to render the explanatory notes that accompany the party breakdown table
without re-parsing each constituency, and CLI callers can emit the same
annotations when exporting CSV files.

Two additional fields now accompany the breakdown metadata:

- `non_participant_share`/`non_participant_label` quantify the portion of
  the historic electorate that did not take part in the source elections.
  The simulator surfaces this cohort as the pseudo-party "Non-voters
  (baseline)" so that abstention baselines can be analysed alongside real
  parties.
- `baseline_turnout_share` reports the weighted turnout ratio used to
  derive that cohort, providing a quick consistency check between the
  baseline electorate and the generated abstention share.

## Quality checks

- `pytest ni_votes/tests/test_data_ingestion.py -q` verifies the
  structured ingestion container normalises workbook data and surfaces
  provenance metadata.
- `pytest ni_votes/tests/test_referendum_temporal_features.py -q`
  (requires `pandas`) covers the temporal feature assembly logic,
  including the election-family blending rules introduced in task 2.
- `pytest ni_votes/tests/test_referendum_prep.py -q` ensures the
  training dataset builder emits the expected matrices, options, and
  metadata for the ridge-based probability model.
- `pytest ni_votes/tests/test_party_breakdown.py -q` guards the
  constituency and NI aggregation helpers that expose per-party
  breakdowns to the simulator.
- `pytest ni_votes/tests/test_referendum_end_to_end.py -q` (added for
  task 6) stitches ingestion, feature engineering, model fitting,
  simulation, and the Flask API together to confirm the redesigned
  simulator returns detailed breakdowns and metadata in JSON responses.
- `pytest ni_votes/tests/test_referendum_simulator.py -q` exercises the
  projection pipeline against synthetic referendums to ensure tables,
  charts, and breakdown metadata remain stable.

## Manual validation

Run the following smoke tests whenever the workbook, endorsement
cleaning, or model artefacts change:

1. **CLI projection parity** – reproduce the Belfast East/West scenario
   to confirm constituency variation remains intact:

   ```bash
   python - <<'PY'
   import pandas as pd
   from ni_votes import config as CFG
   from ni_votes.data.loading import load_election_results, load_endorsements
   from ni_votes.models import load_referendum_model_and_meta
   from ni_votes.simulate import ReferendumSimulationConfig, run_referendum_simulation

   with pd.ExcelFile(CFG.INPUT_XLSX) as xl:
       er = load_election_results(xl)
       en = load_endorsements(xl)

   model, meta = load_referendum_model_and_meta()

   config = ReferendumSimulationConfig(
       date="2024-07-04",
       body_key="BorderReferendum",
       constituencies=["Belfast East", "Belfast West"],
       include_northern_ireland_view=False,
       breakdown_event_type="DevolvedElection",
       breakdown_elected_body="Northern Ireland Assembly",
   )

   result = run_referendum_simulation(er, en, model, meta, config)
   for area in result.areas:
       breakdown = area.party_breakdown.get("metadata", {})
       print(
           area.constituency,
           {opt.option: round(opt.count or 0, 1) for opt in area.options},
           breakdown.get("families"),
       )
   PY
   ```

   Expected behaviour: Belfast West should deliver a materially higher
   "Yes" tally than Belfast East; both constituencies should surface
   non-zero "Did not vote" and "Spoiled" counts with electorates that
   align with the workbook baseline; the printed `families` metadata
   should list the election families that fed the breakdown.

2. **API round-trip** – boot the Flask app (or use the test client) and
   POST to `/api/referendum_simulate` with a mix of constituencies and a
   custom breakdown configuration. Confirm the JSON payload returns
   `party_breakdown` sections that include `metadata.event_type`,
   `metadata.elected_body`, and a populated `parties` array for both
   constituency and NI-level entries.

3. **UI verification** – from the web simulator, pick a referendum,
   toggle the "Voter breakdown options" panel, and submit a run. Confirm
   the additional table and static graphic appear on both the overall and
   constituency cards, and that hovering the breakdown rows matches the
   counts reported in the CSV export.

## Known limitations

- The expanded training corpus now includes synthetic endorsement
  combinations that pit major party families against one another. This
  improves constituency variation, but projections are still point
  estimates and will not convey statistical uncertainty.
- Custom referendums currently support exactly two user-defined options
  plus the implicit "Did not vote" category.
- The model assumes the latest endorsement per party remains in force
  until a replacement is recorded. Verify endorsement timelines in the
  workbook before projecting historic scenarios.
- Results are point estimates. Consider sensitivity checks (e.g., by
  varying endorsement adherence rates) when communicating uncertainty to
  end users.
