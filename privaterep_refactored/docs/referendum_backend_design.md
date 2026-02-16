# Referendum backend redesign: modelling blueprint

This document defines the machine-learning architecture that will replace the
existing referendum simulator backend while leaving the web UI untouched. It is
intended to serve as the implementation contract for Task 3 and later work.

## Goals

* Predict referendum outcomes (valid votes per option, spoiled ballots, and
  non-participation) at both Northern Ireland–wide and constituency levels.
* Produce party-level participation matrices so the frontend can display how
  each party's voters split across referendum options, abstentions, and
  spoiled ballots.
* Leverage historic election data, referendum endorsements, and temporal
  proximity between past elections and the target referendum date.
* Support both catalogue referendums (known body/date combinations) and custom
  two-option scenarios with user-supplied endorsements.

## Data foundations

### Source tables

| Dataset | Origin | Purpose |
|---------|--------|---------|
| `election_results` | Historic workbook (`CFG_ER_DF`) | Vote totals, electorate counts, turnout, and party-level participation for Assembly, Westminster, Council, and EU elections. |
| `endorsements` | Workbook (`CFG_ENDORSEMENTS`) | Party endorsements of referendum options, including explicit support for abstention or spoiled ballots. |
| `referendum_results` | Derived from workbook referendum sheets | Ground-truth referendum outcomes to train and validate the model. |
| `party_metadata` | Static CSV (`ni_votes/data/party_metadata.csv`) | Party families, ideology groupings, colour assignments, and participation flags used for feature enrichment. |
| `constituency_lookup` | Workbook or shapefile metadata | Maps each polling district or election result row to a constituency and NI-wide aggregate. |
| `turnout_history` | Derived helper table | Stores per-constituency turnout residuals and abstention cohorts across elections to inform non-voter modelling. |

### Feature-engineering pipeline design

The new backend emits a feature row for every `(constituency, party,
referendum)` triple. Each row carries five signal groups plus metadata that the
training pipeline persists with the model artefacts.

1. **Temporal alignment**
   * `days_since_{event}` – Elapsed days between the simulation date and the
     most recent Assembly/Westminster/Council/EU election.
   * `decay_weight_{event}` – Exponential decay coefficient (configurable
     half-life per event type) derived from `days_since_{event}`.
   * `seasonal_phase` – Encodes month and quarter offsets between the source
     election and referendum to capture turnout seasonality.

2. **Endorsement encoding**
   * `endorsement_class` – Categorical label in `{support_A, support_B,
     neutral, abstain, spoil}` selected from the endorsements sheet with
     validity-window filtering.
   * One-hot indicators for each class, a binary `is_override` flag when the
     user provides a manual override, and `effective_endorsement_source` to
     trace data provenance.
   * `family_endorsement_ratio_{class}` – Share of the party’s family (e.g.,
     nationalist, unionist, cross-community) endorsing each class so the model
     can learn peer effects.
   * Neutral endorsements use a learned prior derived from historic
     referendums, preventing the model from defaulting to 50/50 splits when the
     party historically leans one way.

3. **Turnout propensity**
   * `turnout_last` and `turnout_trend` – Most recent turnout for the party and
     the slope over the previous five elections of the chosen type.
   * `abstention_baseline` – Long-run abstention share at the constituency level
     blended with NI-wide residuals to support sparse parties.
   * `mobilisation_signal` – Difference between the latest vote share and the
     trailing moving average, capturing momentum that may drive turnout changes.

4. **Baseline vote distribution**
   * `share_{event}` – Vote share in each election type multiplied by the decay
     weight to emphasise recent results.
   * `swing_against_ref_baseline` – Delta from the party’s last referendum
     performance (if available) to encode constituency-specific shifts.
   * `non_voter_share` and `spoil_share` – Historic proportions of the party’s
     electorate that abstained or spoiled ballots in elections; these feed the
     abstention/spoil heads.

5. **Constituency context and interactions**
   * Latent factors produced via PCA or an autoencoder over constituency-level
     metrics (unionist vs nationalist vote balance, deprivation proxies).
   * `constituency_cluster` – Discrete cluster label used for hierarchical
     smoothing when data are sparse.
   * Interaction features such as `endorsement_class * decay_weight` and
     `mobilisation_signal * family_endorsement_ratio_support_A` so the model can
     learn compounded effects.

6. **Custom referendum handling**
   * When the referendum options are user-defined, synthesise neutral
     endorsements first, then layer user overrides before feature extraction.
   * Parties endorsing “do not vote” or “spoil” are tagged via dedicated binary
     features so the turnout and spoil heads can respond directly.

The builder returns both the engineered feature matrix and a metadata payload
enumerating the election rows, endorsement sources, and decay parameters used
for each `(constituency, party)` pair. This metadata travels with the trained
artefacts to guarantee reproducibility and aids the repair workflow when
validating model compatibility.

## Modelling architecture

### Targets

The model predicts three complementary quantities for each constituency:

1. Probability distribution over {Option A, Option B, Spoiled} for each party's
   voters.
2. Probability that a voter abstains entirely.
3. Electorate size (provided as input) to derive turnout counts.

From these, deterministic post-processing computes NI-wide aggregates and
per-option totals.

### Proposed model family

* **Primary estimator** – Gradient-boosted decision trees (LightGBM or XGBoost)
  trained on party-level feature rows. They handle mixed numeric/categorical
  features and provide calibrated probabilities via logistic objective.
* **Abstention head** – Separate binary classifier predicting voter turnout vs
  abstention. This head shares engineered features but is trained on turnout
  outcomes from historic elections mapped to referendums.
* **Spoiled ballot head** – Conditional multinomial regression predicting the
  spoil rate among participants; implemented as a softmax layer trained on
  referendum spoil data.
* **Calibration layer** – Use isotonic regression or Platt scaling on a held
  out validation set to ensure probabilities sum to observed totals.

### Training workflow

1. Construct training rows by pairing each historic referendum with the most
   recent elections of each type prior to that referendum.
2. For each party, compute the observed distribution of referendum choices
   (option support, spoil, abstain) using ballot-box data where available or
   estimated splits otherwise.
3. Train the abstention and participation models using cross-validation grouped
   by referendum date to avoid leakage.
4. Evaluate on hold-out referendums using metrics: MAE on option vote share,
   RMSE on turnout, and Brier score for per-party distributions.
5. Persist trained models and calibration parameters via Joblib along with
   metadata describing feature schema and expected inputs.

## Serving-time pipeline (new backend)

1. **Input normalisation** – Validate request payload, resolve constituency
   list, and fetch endorsement profiles identical to the current frontend
   contract.
2. **Feature assembly** – Using the same feature builders as training,
   construct a feature frame for each (constituency, party) combination.
3. **Model inference** –
   * Run the abstention classifier to obtain turnout probability per party.
   * For voters predicted to participate, run the multinomial estimator to
     split votes between option A, option B, and spoiled.
4. **Aggregation** – Multiply probabilities by electorate * party vote shares
   to obtain counts. Sum across parties for constituency totals, then add
   NI-wide aggregates if requested.
5. **Party breakdown matrix** – Emit the per-party distribution used by the
   frontend charts. Include both percentages and raw counts for each outcome
   (option A, option B, spoiled, abstained). The serving layer should also
   synthesise a "Non-voters (baseline)" cohort using the weighted turnout
   history so analysts can see how historic abstainers are projected to split
   across referendum options.
6. **Result packaging** – Convert aggregates into `ReferendumSimulationResult`
   dataclasses so the web UI continues to function without changes.

## Migration considerations

* Maintain backward compatibility with model metadata keys (`options`,
  `endorsement_profiles`, `neutral_profile`, `model_options`).
* Provide a feature version identifier so cached models can be invalidated when
  the schema changes.
* Include deterministic random seeds for reproducible training and inference.
* Record training provenance (referendum dates used, election datasets
  included) inside the metadata for auditability.

## Open questions for future tasks

* Should we incorporate demographic data beyond election returns (e.g., census
  statistics)? If so, extend the data ingestion layer accordingly.
* Do we retrain models periodically as new referendums occur? Define a
  retraining pipeline and CI hook.
* How to handle parties with sparse historic data? Possible solutions include
  hierarchical shrinkage or clustering similar parties.

This blueprint completes Task 2 by specifying the machine-learning approach we
will implement in the subsequent pipeline build tasks.
