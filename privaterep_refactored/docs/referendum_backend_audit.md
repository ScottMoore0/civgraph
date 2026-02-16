# Referendum simulator backend audit

This document captures the behaviour we must preserve while replacing the
referendum simulator backend. The intent is to keep the web front-end,
existing API contracts, and neighbouring features untouched while we swap
out the modelling implementation in later tasks.

## High-level architecture

* **Web front-end** – Implemented in `ni_votes/web/routes.py` and the
  inline templates in `ni_votes/web/templates.py`. The referendum page
  posts a JSON payload to `/api/referendum_simulate` and renders the
  `result` object returned by that endpoint.
* **Simulation entry point** – The Flask handler builds a
  `ReferendumSimulationConfig` from the request body and calls
  `run_referendum_simulation` (defined in `ni_votes/simulate/
  referendum.py`). That function orchestrates feature construction,
  model inference, and aggregation.
* **Supporting modules** – Feature generation and inference live in
  `ni_votes/project/referendum.py` and `ni_votes/project/
  party_breakdown.py`, with endorsement helpers in
  `ni_votes/features/endorsements.py`. These modules expect Pandas data
  frames loaded from the workbook via `ni_votes/web/data_access.py`.

## Data dependencies that must remain available

* **Historic election workbook** – Loaded once per Flask process via
  `ni_votes/web/data_access.py`. The election results frame (key
  `CFG_ER_DF`) must include columns such as `Constituency`, `Date`,
  `ResultType`, `Party`, and electorate counts. The endorsements frame
  (`CFG_ENDORSEMENTS`) feeds the endorsement history builder.
* **Model artefacts** – `_load_referendum_model` in
  `ni_votes/web/routes.py` calls
  `ni_votes.models.resolve_referendum_model_and_meta` using paths from
  `ni_votes.config.CFG`. The metadata must expose `options`, `feat_cols`,
  `endorsement_profiles`, and `neutral_profile` keys. The model object is
  currently a scikit-learn estimator consumed by `predict_group_rows`.
* **Configuration knobs** – The Flask blueprint honours
  `include_northern_ireland_view`, `breakdown_event_type`, and
  `breakdown_elected_body` flags supplied by the UI. Any backend rewrite
  must continue to accept these parameters even if their internal use
  changes.

## `/api/referendum_simulate` request contract

The front-end sends a JSON object with the following fields (all strings
should be trimmed in the backend, mirroring `_safe`):

| Field | Type | Notes |
|-------|------|-------|
| `date` | string | Required `YYYY-MM-DD` projection date. |
| `body` / `body_key` | string | Required unless `custom_options` are provided. |
| `constituency` | string | Optional single constituency filter. Mutually exclusive with `constituencies`. |
| `constituencies` | array[string] | Optional list of constituencies; duplicates and blanks are discarded. |
| `include_northern_ireland_view` | bool | Defaults to `true` when omitted. |
| `custom_options` | array[string] | When present, must contain exactly two distinct labels; enables custom referendum mode. |
| `custom_endorsements` | object | Only honoured when `custom_options` is provided. Keys and values are strings. |
| `override_endorsements` | object | Party overrides for historic referendums; blank strings remove an endorsement. |
| `breakdown_event_type` | string | Optional election family constraint for the party breakdown. |
| `breakdown_elected_body` | string | Optional elected body constraint. |

The handler returns HTTP 400 for validation failures (missing date,
invalid custom options), HTTP 500 when the cached model cannot be loaded,
and HTTP 400 when the simulation pipeline raises a runtime error.

## Response schema consumed by the front-end

Successful responses contain `{ "ok": true, "result": ... }`, where the
result is the dataclass payload produced by `dataclasses.asdict` over a
`ReferendumSimulationResult`:

```
ReferendumSimulationResult
  areas: List[AreaResult]
  model_options: List[str]
  metadata: Dict[str, Any]

AreaResult
  constituency: str
  body: str
  projected_date: str
  original_date: str
  electorate: float | null
  turnout: float | null
  turnout_pct: float | null
  valid_votes: float | null
  spoiled: float | null
  did_not_vote: float | null
  options: List[OptionResult]
  table: Dict[str, Any]
  chart: Dict[str, Any]
  party_breakdown: Dict[str, Any]

OptionResult
  option: str
  count: float | null
  pct_electorate: float | null
  pct_valid: float | null
```

The templates assume the `areas` list always includes the requested
constituencies plus an optional “Northern Ireland” aggregate. The
`party_breakdown` dictionary is forwarded directly to charting helpers,
so its structure must remain stable until the frontend is updated. The
top-level `metadata` payload aggregates high-level context (constituency
list, bodies, event families, provenance elections, electorate totals,
and whether a Northern Ireland view was included) so the frontend and
CLI can show the same annotations without re-parsing every area result.
Party breakdown metadata now also exposes `baseline_turnout_share`, a
weighted view of historic turnout for the contributing elections, and
`non_participant_share`/`non_participant_label`, which describe how much
of the baseline electorate did not participate previously. These values
drive the pseudo “Non-voters (baseline)” group that appears alongside
real parties in the simulator output.

## Current modelling pipeline

1. `run_referendum_simulation` resolves the constituency list via
   `_resolve_constituencies`, ensuring the Northern Ireland aggregate is
   appended when requested.
2. For historic bodies it calls
   `build_referendum_features_for_group`, which merges the election
   results, endorsement histories, and overrides to produce feature rows.
   For custom referendums it uses `build_custom_two_option_features`.
3. The resulting feature frame, the model metadata, and contextual
   dictionaries are passed into `predict_group_rows`, which delegates to
   the cached scikit-learn model.
4. `predict_group_rows` returns row dictionaries that are assembled into
   a Pandas DataFrame. `_frame_to_area_results` then creates the dataclass
   structures expected by the templates and API clients.

## Constraints for the rewrite

* The new backend must continue to expose the same API request fields and
  response schema so the front-end remains untouched.
* Election workbook loading (`ni_votes/web/data_access.py`) and
  configuration keys must stay in place to avoid collateral changes in
  other routes.
* Any replacement model must still expose `model_options` in its metadata
  so the UI can label option bars and tables correctly.
* The frontend expects per-party breakdown metadata under
  `AreaResult.party_breakdown["metadata"]` with a `families` key. If the
  new modelling approach changes the structure, the frontend must be
  updated in a later task; until then the rewrite should reproduce the
  current fields.

Documenting these facets completes task 1 of the rewrite plan: we have a
reference for the interfaces and dependencies that must stay stable while
we rebuild the referendum modelling stack in subsequent tasks.

### Module inventory and responsibilities

The audit also needs a quick-reference list of the Python entry points that
today’s backend depends on. The rewrite must either preserve these call
sites or provide shims so the unchanged web layer keeps working.

| Module | Key call sites | Purpose |
| ------ | -------------- | ------- |
| `ni_votes/web/routes.py` | `_api_referendum_simulate` | Flask route that validates the request payload, resolves workbook data via `web.data_access`, and calls `run_referendum_simulation`. |
| `ni_votes/simulate/referendum.py` | `run_referendum_simulation`, `_resolve_constituencies`, `_frame_to_area_results` | Orchestrates feature construction, inference, Northern Ireland aggregation, and conversion to the dataclass response consumed by the templates. |
| `ni_votes/project/referendum.py` | `build_referendum_features_for_group`, `build_custom_two_option_features`, `predict_group_rows` | Prepares feature frames, invokes the bundled scikit-learn model, rescales totals (valid, spoiled, did-not-vote), and assembles per-party breakdown dictionaries. |
| `ni_votes/project/party_breakdown.py` | `build_party_breakdown`, `merge_party_breakdowns` | Creates the party-to-option matrices that underpin the front-end tables and charts, including the “Non-voters (baseline)” pseudo party. |
| `ni_votes/models/_referendum_model_loader.py` | `_joblib_load_with_compat`, `load_referendum_model_and_meta` | Reads the packaged Joblib artefact and metadata, applying MT19937 compatibility shims so NumPy 2.x environments can deserialize the legacy bundle. |
| `repair_environment.py` | `verify_referendum_loader` step | Automation that exercises `_joblib_load_with_compat`; a green run is required after we swap in the new backend so the desktop workflow still verifies deserialization. |

### Known limitations and review feedback

While auditing the existing implementation we captured the issues that drove
the rewrite request. These items mirror the latest review feedback and user
reports and must be resolved by the upcoming tasks:

* **Legacy model artefact dominates predictions.**
  `predict_group_rows` delegates to the cached estimator’s
  `predict_proba_rows` method and then rescales totals heuristically. The
  artefact ships with a single set of coefficients, so outputs drift toward
  constituency averages instead of reacting to endorsement shifts. The
  redesign needs a freshly trained model with richer features and proper
  calibration.
* **Endorsement encoding is overly simplistic.**
  `build_referendum_features_for_group` currently derives a limited set of
  dummy variables and relies on static endorsement profiles embedded in the
  metadata bundle. Neutral or blank endorsements (for example, Alliance in
  the reproduced scenario) therefore collapse toward 50/50 splits instead of
  following observed behaviour. A new feature pipeline must encode explicit
  support/oppose/spoil/abstain states and include temporal weighting.
* **Turnout and spoil rates are backfilled, not learned.**
  After probability prediction the helper rescales counts to match historic
  `valid_total`, `spoiled`, and `did_not_vote` inputs. Because these totals
  come straight from the workbook, the simulator cannot adjust turnout when
  endorsements or timing change. Task 3 of the rewrite will introduce
  dedicated turnout and spoil heads so the behaviour becomes data-driven.
* **Compatibility shim introduces fragile global patches.**
  `_joblib_load_with_compat` rewires `joblib.numpy_pickle.NumpyUnpickler` and
  `RandomState.__setstate__` at runtime. Reviewers flagged that the shim must
  remain confined to the loader and restore all globals after retrying. Any
  replacement loader must either drop the legacy artefact altogether or keep
  the retry surface minimal while the old model is still in play.
* **Repair workflow must stay green.**
  The `verify_referendum_loader` step in `repair_environment.py` mirrors the
  failure the user hit. Once the new artefact is produced, the workflow
  should succeed without relying on compatibility fallbacks, and the test
  suite needs to assert that behaviour.

This expanded audit closes the first task by documenting not just the public
interfaces but also the technical debt and open review concerns that the
upcoming tasks have to resolve.
