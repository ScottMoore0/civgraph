# Referendum backend operations guide

This guide explains how to retrain the referendum simulator model, publish the
resulting artefacts, and deploy the backend without changing the existing web
frontend. It complements the redesign blueprint by covering the hands-on steps
you need to perform on your workstation or deployment host.

## 1. Preparing your environment

1. **Select the interpreter** that runs the simulator in production (for
   example the PyCharm project interpreter, a dedicated virtual environment, or
   a Docker image build context).
2. **Synchronise the repository** so it contains the latest backend changes and
   compatibility shims:
   ```bash
   git pull
   ```
3. **Install Python dependencies** into the active interpreter:
   ```bash
   python -m pip install -r requirements-dev.txt
   ```
   You can skip this step during subsequent runs if the command reports that all
   requirements are already satisfied.

## 2. Retraining the model

The module `ni_votes.training.referendum` encapsulates the end-to-end workflow.
You can point it at an elections workbook or pass pre-loaded data frames. The
examples below assume the canonical workbook `Full election tables.xlsx`.

### 2.1 Quick start (from the default workbook)

```bash
python -m ni_votes.training.referendum \
    --workbook "Full election tables.xlsx" \
    --output-model ni_votes/models/NI-referendum-model.joblib \
    --output-meta ni_votes/models/NI-referendum-model.meta.json
```

The helper parses the workbook, constructs the training rows, performs grouped
cross-validation, fits the calibrated model, and saves both the Joblib bundle
and refreshed metadata. The JSON metadata automatically records the feature
version, cross-validation scores, calibration settings, and source workbook for
traceability.

### 2.2 Advanced configuration

If you need to adjust cross-validation folds, calibration holdout size, or
random seeds, create a simple configuration file and pass it via environment
variables or command-line flags:

```bash
python -m ni_votes.training.referendum \
    --workbook data/custom_workbook.xlsx \
    --cv-folds 6 \
    --calibration-holdout 0.25 \
    --random-state 1337 \
    --feature-version temporal-v2
```

See `ni_votes/training/referendum.py` for the full list of options surfaced by
`ReferendumTrainingConfig`.

### 2.3 Verifying the trained artefacts

After training completes, inspect the console summary or the metadata file for:

* The number of feature rows used.
* Cross-validation metrics (MAE, RMSE, Brier score).
* Calibration details and training timestamp.

Commit the refreshed `NI-referendum-model.meta.json` alongside the Joblib model
if you intend to ship the new artefact. The metadata drives runtime compatibility
checks in the Flask backend and the automated repair workflow.

## 3. Publishing artefacts

1. Copy the new `.joblib` file into `ni_votes/models/` (or your deployment
   storage location) and ensure the filename matches the loader expectation.
2. Replace the existing metadata JSON with the one emitted by the trainer.
3. Run the regression suite that touches the referendum simulator to confirm the
   new artefacts remain readable:
   ```bash
   pytest tests/test_referendum_model_loader.py \
          tests/test_referendum_api.py \
          ni_votes/tests/test_referendum_end_to_end.py
   ```
   These tests are marked as slow and require optional dependencies (NumPy,
   pandas, scikit-learn, joblib). When they are unavailable the suite will skip
   them; run the checks in an environment that mirrors production before
   publishing the artefacts.

## 4. Deployment checklist

Perform these steps on every machine that serves the simulator (development
workstation, staging, and production):

1. **Pull the merged branch or release build** so the new backend code and
   artefacts are present.
2. **Install/update dependencies** inside the runtime interpreter (see section
   1). This ensures the compatibility shim and training pipeline are available.
3. **Run the repair workflow** to validate the environment:
   ```bash
   python -m repair_environment --skip-install
   ```
   The script reinstalls requirements if needed, clears stale bytecode caches,
   and attempts to load the referendum model. If any step fails open
   `repair_environment.log` for diagnostics.
4. **Restart long-lived services** that import the simulator (Flask dev server,
   Gunicorn workers, Docker containers, scheduled jobs). Fresh processes pick up
   the updated loader and artefacts.
5. **Smoke-test the API/UI** by launching the web interface, running a sample
   referendum scenario, and confirming the results and party breakdown render
   without errors.

## 5. Post-deployment verification

* Monitor application logs for entries emitted by the referendum loader. The
  metadata block attached to each response (`result.model_metadata`) should show
  the expected `feature_version` and training timestamp.
* If issues surface, re-run `python -m repair_environment` to capture a fresh
  log and verify the Joblib bundle still deserialises correctly.
* Keep the previous model artefact until the new deployment is signed off, so
  you can roll back quickly by restoring the older files.

## 6. Operational tips

* **Neutral or missing endorsements** – The backend treats blank endorsement
  cells as neutral inputs. If you expect a party to remain neutral, leave the
  field blank; otherwise provide an explicit override via the frontend or the
  endorsements sheet.
* **Spoil or abstain endorsements** – When parties endorse not voting or
  spoiling a ballot, the feature pipeline marks those classes explicitly so the
  turnout and spoil heads can respond. The resulting party breakdown will show
  separate rows for referendum non-participation and spoiled ballots.
* **Retraining cadence** – Re-run the training pipeline whenever a new election
  or referendum is added to the historic workbook, or when you adjust the
  feature schema. Commit both the code changes and the refreshed metadata so the
  compatibility checks remain meaningful.
* **Backups** – Store the exported Joblib and JSON metadata in your release
  archives. The repair workflow expects the metadata to match the packaged
  bundle; mismatched files trigger compatibility warnings.

By following this operational checklist you ensure the redesigned referendum
backend remains reproducible, data-driven, and easy to deploy without modifying the web frontend.
