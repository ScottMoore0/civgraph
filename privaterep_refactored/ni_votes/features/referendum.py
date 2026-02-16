"""
Shim module so callers can do:
    from ni_votes.features.referendum import (...)
even though the implementations live under project/ and models_*.py.
"""

# --- Symbols that are feature / projection oriented live here ---
try:
    from ..project.referendum import (
        filter_referendum_rows,
        infer_body_options,
        build_referendum_features_for_group,
        build_custom_two_option_features,
        project_referendum,
    )
except Exception as e:
    raise ImportError(
        "Failed to import from ni_votes.project.referendum. "
        "Ensure ni_votes/project/referendum.py exists."
    ) from e

# --- Symbols that are training / modeling oriented live here ---
try:
    from ..models_referendum import (
        build_referendum_training_real,
        build_referendum_training_calibration,
        build_referendum_training_pseudo,
        fit_referendum_model_with_pseudo,
        prepare_referendum_training_matrices,
        turnout_prior as _turnout_prior_models,              # optional
        compute_constituency_totals as _compute_totals_models # optional
    )
except Exception:
    try:
        from ..models_referendum import (
            build_referendum_training_real,
            build_referendum_training_calibration,
            build_referendum_training_pseudo,
            fit_referendum_model_with_pseudo,
            prepare_referendum_training_matrices,
        )
        _turnout_prior_models = None
        _compute_totals_models = None
    except Exception as ee:
        raise ImportError(
            "Failed to import referendum training functions from ni_votes.models_referendum. "
            "Ensure ni_votes/models_referendum.py defines "
            "build_referendum_training_real, build_referendum_training_pseudo, fit_referendum_model_with_pseudo."
        ) from ee

# --- Provide turnout_prior / compute_constituency_totals if main expects them ---
if _turnout_prior_models is not None and _compute_totals_models is not None:
    turnout_prior = _turnout_prior_models
    compute_constituency_totals = _compute_totals_models
else:
    try:
        from ..project.referendum import turnout_prior, compute_constituency_totals
    except Exception:
        def turnout_prior(er, constituency, date_str):
            return 0.65

        def compute_constituency_totals(er_group, event, elected_body):
            return {
                "electorate": float("nan"),
                "valid_total": float("nan"),
                "spoiled": 0.0,
                "did_not_vote": float("nan"),
            }
