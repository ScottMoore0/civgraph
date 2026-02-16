"""End-to-end training workflow for the referendum simulator backend."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import json
import time

import joblib
import pandas as pd

from ..data import StructuredElectionData, ingest_election_data
from ..models_referendum import (
    build_referendum_training_real,
    cross_validate_referendums,
    fit_referendum_model,
)


@dataclass
class ReferendumTrainingConfig:
    """Configuration for the referendum training pipeline."""

    cv_folds: int = 5
    calibration_holdout: float = 0.2
    random_state: int = 42
    feature_version: str = "temporal-v1"
    source_label: str = "training"


def train_referendum_pipeline(
    election_results: StructuredElectionData | pd.DataFrame,
    *,
    endorsements: Optional[pd.DataFrame] = None,
    config: ReferendumTrainingConfig,
    output_model: Optional[Path] = None,
    output_meta: Optional[Path] = None,
    source_workbook: Optional[str] = None,
) -> Dict[str, Any]:
    """Train the referendum model and optionally serialise artefacts."""

    training_set = build_referendum_training_real(election_results, endorsements)
    if training_set.empty:
        raise ValueError("No referendum training rows were generated.")

    metrics = cross_validate_referendums(
        training_set,
        folds=max(2, config.cv_folds),
        random_state=config.random_state,
    )

    model, meta = fit_referendum_model(
        training_set,
        calibration_holdout=config.calibration_holdout,
        random_state=config.random_state,
    )

    meta = dict(meta)
    meta["feature_version"] = config.feature_version
    meta["cv_metrics"] = metrics
    meta["training_config"] = asdict(config)
    meta["trained_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if source_workbook is not None:
        meta["source_workbook"] = str(source_workbook)

    if output_model is not None:
        output_model.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, output_model)

    if output_meta is not None:
        output_meta.parent.mkdir(parents=True, exist_ok=True)
        with output_meta.open("w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2, sort_keys=True)

    return {
        "rows": int(len(training_set.features)),
        "metrics": metrics,
        "model_path": str(output_model) if output_model is not None else None,
        "meta_path": str(output_meta) if output_meta is not None else None,
        "options": list(training_set.options),
    }


def train_referendum_from_workbook(
    workbook: Path | str,
    *,
    config: ReferendumTrainingConfig,
    output_model: Optional[Path] = None,
    output_meta: Optional[Path] = None,
) -> Dict[str, Any]:
    """Convenience wrapper that loads data from a workbook path."""

    start = time.time()
    structured = ingest_election_data(workbook, source=config.source_label)
    summary = train_referendum_pipeline(
        structured,
        config=config,
        output_model=output_model,
        output_meta=output_meta,
        source_workbook=str(workbook),
    )
    summary["elapsed_seconds"] = time.time() - start
    return summary


__all__ = [
    "ReferendumTrainingConfig",
    "train_referendum_pipeline",
    "train_referendum_from_workbook",
]
