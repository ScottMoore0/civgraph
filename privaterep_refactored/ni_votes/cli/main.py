# ni_votes/cli/main.py
from __future__ import annotations

import argparse
import json
from time import perf_counter
from pathlib import Path
from typing import List

import joblib
import pandas as pd

# --- Config ---
from .. import config as CFG
from ..models import resolve_referendum_model_and_meta

# --- Data loaders ---
from ..data.loading import (
    load_election_results,
    load_transfers_sheet,
    load_endorsements,
)


from ..features.transfers import build_training_from_ml_tables

from ..data.loading import load_ml_tables_any

# --- Transfer training data builder ---
from ..features.transfers import build_training_from_transfers_with_context

# --- Transfer model(s) ---
from ..models_transfers import cross_validate_transfers  # Statistical model CV

# --- Referendum model(s) ---
from ..models_referendum import (
    build_referendum_training_real,
    cross_validate_referendums,
    fit_referendum_model,
)


def _parse_pairs(pairs):
    if not pairs:
        return None

    mapping = {}
    for item in pairs:
        if item is None:
            continue
        if "=" not in item:
            raise SystemExit(f"Invalid mapping '{item}'. Expected format KEY=VALUE.")
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not value:
            raise SystemExit(f"Invalid mapping '{item}'. Both key and value are required.")
        mapping[key] = value

    return mapping or None


def do_train() -> None:
    """
    Original pipeline training:
      - Transfer model (hierarchical statistical models)
      - Referendum model (logistic regression)
    Uses paths and settings from config.py (CFG).
    """
    t0 = perf_counter()
    print("Loading workbook...", flush=True)
    with pd.ExcelFile(CFG.INPUT_XLSX) as xl:
        er = load_election_results(xl)
        tr = load_transfers_sheet(xl)
        en = load_endorsements(xl)

    # ---------- TRANSFERS ----------
    print("Building transfer training set (all constituencies, RAW rows)...", flush=True)
    if tr is None or tr.empty:
        raise SystemExit("Transfers sheet missing or empty. Cannot train transfer model.")
    train_transfers = build_training_from_transfers_with_context(tr, er)
    print(f"Transfer training rows (raw): {len(train_transfers):,}", flush=True)

    print("Fitting transfer model (hierarchical statistical models)...", flush=True)

    # Use hierarchical statistical models - LightGBM and Neural Network backends removed
    _ = cross_validate_transfers(
        train_transfers,
        folds=getattr(CFG, "TRANSFERS_CV_FOLDS", 5),
    )
    
    # For now, create a placeholder model - the actual model will be built by the hierarchical system
    from ..features.transfers import get_transfer_model
    t_model = get_transfer_model(er, tr)  # This will use the hierarchical statistical approach
    classes = []  # Will be populated by the hierarchical model
    cat_cols = [] 
    num_cols = []

    joblib.dump(t_model, CFG.TRANSFER_MODEL_PATH)
    with open(CFG.TRANSFER_META_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "classes": classes,
                "cat_cols": cat_cols,
                "num_cols": num_cols,
                "backend": "hierarchical_statistical",
            },
            f,
            indent=2,
        )
    print(f"Transfer model saved to: {CFG.TRANSFER_MODEL_PATH}", flush=True)

    # ---------- REFERENDUMS ----------
    print("Building referendum training set (temporal dataset)...", flush=True)
    training_set = build_referendum_training_real(er, en)
    if not training_set.options:
        raise SystemExit("No referendum options detected. Cannot train referendum model.")

    print(f"Referendum training rows: {len(training_set.features):,}", flush=True)

    # Cross-validate & fit
    cross_validate_referendums(
        training_set, folds=getattr(CFG, "REF_CV_FOLDS", 5)
    )
    r_model, r_meta = fit_referendum_model(training_set)

    joblib.dump(r_model, CFG.REFERENDUM_MODEL_PATH)
    with open(CFG.REFERENDUM_META_PATH, "w", encoding="utf-8") as f:
        json.dump(r_meta, f, indent=2)
    print(f"Referendum model saved to: {CFG.REFERENDUM_MODEL_PATH}", flush=True)

    print(f"Training complete (elapsed {perf_counter() - t0:0.1f}s).", flush=True)


def do_election_viewer(args) -> None:
    """
    Console election viewer (older console mode).
    """
    print("Loading workbook...", flush=True)
    with pd.ExcelFile(CFG.INPUT_XLSX) as xl:
        er = load_election_results(xl)

    # Lazy import to avoid Flask / web deps here
    from ..view.election_viewer import print_election_view

    print_election_view(
        er=er,
        date=args.date,
        year=args.year,
        constituency=args.constituency,
        event_substr=args.event,
        body_substr=args.body,
        limit=args.limit,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="ni_votes CLI")
    parser.add_argument(
        "--mode",
        choices=[
            "train",             # original pipeline (transfers + referendum)
            "train_scenario",    # NEW: scenario-driven STV model
            "predict_transfers",
            "predict_referendum",
            "election_viewer",
            "train_transfers_from_ml"
        ],
        default="train",
    )
    # viewer-only args (ignored by other modes)
    parser.add_argument("--date", type=str, default=None, help="Exact date (YYYY-MM-DD) to filter by.")
    parser.add_argument("--year", type=int, default=None, help="Year to filter by (e.g., 2022).")
    parser.add_argument("--constituency", type=str, default=None, help="Constituency name to filter by.")
    parser.add_argument("--event", type=str, default=None, help="Substring match on Event.")
    parser.add_argument("--body", type=str, default=None, help="Substring match on ElectedBody.")
    parser.add_argument("--limit", type=int, default=None, help="Only print the first N groups.")
    parser.add_argument(
        "--custom-options",
        nargs=2,
        metavar=("OPTION_A", "OPTION_B"),
        help="Two custom option labels for ad-hoc referendums.",
    )
    parser.add_argument(
        "--custom-endorsement",
        action="append",
        default=None,
        metavar="PARTY=OPTION",
        help="Map a party to one of the custom options (can repeat).",
    )
    parser.add_argument(
        "--override-endorsement",
        action="append",
        default=None,
        metavar="PARTY=OPTION",
        help="Override an existing endorsement for a predefined referendum.",
    )

    args = parser.parse_args()

    if args.mode == "train":
        do_train()

    elif args.mode == "train_scenario":
        # New scenario-based engine lives under simulate/
        from ..simulate import train_scenario_model
        train_scenario_model()

    elif args.mode == "election_viewer":
        do_election_viewer(args)

    elif args.mode == "predict_transfers":
        raise SystemExit(
            "predict_transfers: Use your existing app script (exports to Excel). "
            "CLI support can be added on request."
        )

    elif args.mode == "predict_referendum":
        if not args.date:
            raise SystemExit("--date is required for predict_referendum mode.")

        if not args.custom_options and not args.body:
            raise SystemExit("Specify --body for known referendums or --custom-options for ad-hoc simulations.")

        custom_opts = args.custom_options
        if custom_opts and len(custom_opts) != 2:
            raise SystemExit("--custom-options requires exactly two labels.")

        with pd.ExcelFile(CFG.INPUT_XLSX) as xl:
            er = load_election_results(xl)
            en = load_endorsements(xl)

        model, meta = resolve_referendum_model_and_meta(
            Path(CFG.REFERENDUM_MODEL_PATH),
            Path(CFG.REFERENDUM_META_PATH),
        )

        from dataclasses import asdict
        from ..simulate import (
            ReferendumSimulationConfig,
            run_referendum_simulation,
        )

        const_list: List[str] = []
        if args.constituency:
            const_list = [part.strip() for part in str(args.constituency).split(",") if part.strip()]

        config = ReferendumSimulationConfig(
            date=args.date,
            body_key=args.body,
            constituency=(const_list[0] if len(const_list) == 1 else args.constituency),
            constituencies=(const_list if len(const_list) > 1 else None),
            custom_options=custom_opts,
            custom_endorsements=_parse_pairs(args.custom_endorsement),
            override_endorsements=_parse_pairs(args.override_endorsement),
        )

        result = run_referendum_simulation(er, en, model, meta, config)
        print(json.dumps(asdict(result), indent=2))

    elif args.mode == "train_transfers_from_ml":
        er_df = load_election_results(CFG.INPUT_XLSX)
        ml = load_ml_tables_any(CFG.INPUT_XLSX, CFG)
        if not ml:
            raise SystemExit("No ML tables found (CSV or workbook sheets).")
        train_df = build_training_from_ml_tables(er_df, ml)
        if train_df.empty:
            raise SystemExit("Training frame from ML tables is empty.")
        # LightGBM backend removed - using hierarchical statistical models instead
        from ..features.transfers import get_transfer_model
        model = get_transfer_model(er_df, tr_df)  # This will use the hierarchical statistical approach
        import joblib, json
        joblib.dump(model, CFG.TRANSFER_MODEL_PATH)
        meta = {"source": "ml_tables", "rows": int(len(train_df))}
        with open(CFG.TRANSFER_META_PATH, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        print(f"Saved: {CFG.TRANSFER_MODEL_PATH}")


    else:
        raise SystemExit(f"Unknown mode: {args.mode}")


if __name__ == "__main__":
    main()
