# ni_votes/models_transfers.py

from __future__ import annotations

from typing import List, Dict, Optional, Tuple
import numpy as np
import pandas as pd

from sklearn.preprocessing import OneHotEncoder, LabelEncoder
from sklearn.decomposition import TruncatedSVD
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import log_loss, accuracy_score


# ---- Config (with safe defaults if some fields are missing) ----
from .config import RANDOM_SEED
try:
    from .config import (
        OHE_HANDLE_UNKNOWN,
        OHE_MIN_FREQUENCY,
        TOPK_SOURCE_PID,

        TRANSFERS_CV_FOLDS,
        TRANSFERS_CV_SHUFFLE,
    )
except Exception:
    # sensible fallbacks
    OHE_HANDLE_UNKNOWN = "infrequent_if_exist"
    OHE_MIN_FREQUENCY = 5
    TOPK_SOURCE_PID = 200

    TRANSFERS_CV_FOLDS = 5
    TRANSFERS_CV_SHUFFLE = True

# ---- Canonical schema (we'll down-select to what exists) ----
_CANON_CAT_COLS = ["DateStr", "Constituency", "SourceParty", "SourcePersonID"]
_CANON_NUM_COLS = [
    "SourceStillIn", "DestStillIn", "SourcePartyStillIn", "DestPartyStillIn",
    "NumRemainingCands", "NumRemainingParties",
    "don_first_share", "don_transfer_share", "rec_first_share", "rec_transfer_share",
]
_LABEL_COL = "DestParty"
_WEIGHT_COL = "Weight"


# ---------- helpers ----------
def _cap_source_personid_cardinality(df: pd.DataFrame, top_k: int = TOPK_SOURCE_PID) -> pd.DataFrame:
    """Limit SourcePersonID to top-k most frequent values; all others -> 'OTHER'."""
    if "SourcePersonID" not in df.columns:
        return df
    df = df.copy()
    freq = df["SourcePersonID"].astype(str).value_counts(dropna=False)
    keep = set(freq.head(top_k).index.tolist())
    df["SourcePersonID"] = df["SourcePersonID"].astype(str).apply(lambda x: x if x in keep else "OTHER")
    return df


def _safe_prob_vector(vec: np.ndarray) -> Optional[np.ndarray]:
    v = np.nan_to_num(vec.astype(float), nan=0.0, posinf=0.0, neginf=0.0)
    v[v < 0] = 0.0
    s = v.sum()
    if s <= 0.0:
        return None
    return v / s


def _present_columns(df: pd.DataFrame, wanted: List[str]) -> List[str]:
    """Return the subset of wanted columns that exist in df, preserving order."""
    have = set(df.columns)
    return [c for c in wanted if c in have]


def _num_block(df: pd.DataFrame, wanted: List[str]) -> Tuple[pd.DataFrame, List[str]]:
    """
    Return (values_df_as_float32, used_columns). Missing wanted columns are created as zeros.
    """
    cols = list(wanted)  # keep order
    for c in cols:
        if c not in df.columns:
            df[c] = 0.0
    return df[cols].astype(np.float32), cols


def _cat_block(df: pd.DataFrame, wanted: List[str]) -> Tuple[pd.DataFrame, List[str]]:
    """
    Return (categorical_df_as_str, used_columns). Missing wanted columns are created as empty string.
    """
    cols = list(wanted)
    for c in cols:
        if c not in df.columns:
            df[c] = ""
    return df[cols].astype(str), cols


# ---------- Picklable wrappers (shared interface) ----------
class _TransferWrapperBase:
    def __init__(self, enc: OneHotEncoder, svd: Optional[TruncatedSVD],
                 num_cols: List[str], cat_cols: List[str], label_encoder: LabelEncoder):
        self.enc = enc
        self.svd = svd
        self.num_cols = num_cols
        self.cat_cols = cat_cols
        self.le = label_encoder
        self.classes_ = self.le.classes_

    def _transform(self, X_df: pd.DataFrame) -> np.ndarray:
        # Ensure missing columns are added at inference time as well
        X_cat_df, cat_cols = _cat_block(X_df.copy(), self.cat_cols)
        X_cat_ohe = self.enc.transform(X_cat_df)
        if self.svd is not None:
            X_cat_red = self.svd.transform(X_cat_ohe)
        else:
            X_cat_red = X_cat_ohe.toarray()

        # Numeric block: ensure we match training set columns
        X_num_df, _ = _num_block(X_df.copy(), self.num_cols)

        return np.hstack([X_cat_red.astype(np.float32), X_num_df.values])





# ---------- Encoder + (optional) SVD ----------
def _fit_coders(X_cat: pd.DataFrame) -> Tuple[OneHotEncoder, Optional[TruncatedSVD], np.ndarray]:
    enc = OneHotEncoder(
        handle_unknown=OHE_HANDLE_UNKNOWN,
        min_frequency=OHE_MIN_FREQUENCY,
        sparse_output=True,
        dtype=np.float32
    )
    X_cat_ohe = enc.fit_transform(X_cat)

    n_features = X_cat_ohe.shape[1]
    if n_features > 1:
        svd_components = min(1024, max(1, n_features - 1))
        svd = TruncatedSVD(n_components=svd_components, random_state=RANDOM_SEED)
        X_cat_red = svd.fit_transform(X_cat_ohe)
    else:
        svd = None
        X_cat_red = X_cat_ohe.toarray()

    return enc, svd, X_cat_red


# ---------- LightGBM backend ----------
def _fit_transfer_lgb_core(X_all: np.ndarray, y_enc: np.ndarray, w: np.ndarray, n_classes: int):
    """LightGBM backend removed - using hierarchical statistical models instead."""
    raise NotImplementedError("LightGBM backend has been removed. Use hierarchical statistical models.")


def fit_lgb_transfer(train_df: pd.DataFrame):
    if train_df.empty:
        raise ValueError("No transfer training data provided to LightGBM fit.")

    df = _cap_source_personid_cardinality(train_df.copy())

    # Build categorical / numeric blocks robustly
    X_cat, cat_cols = _cat_block(df, _CANON_CAT_COLS)
    X_num, num_cols = _num_block(df, _CANON_NUM_COLS)

    if _LABEL_COL not in df.columns:
        raise ValueError(f"Training data missing label column '{_LABEL_COL}'.")

    y_str = df[_LABEL_COL].astype(str)
    w = df[_WEIGHT_COL].astype(np.float32) if _WEIGHT_COL in df.columns else pd.Series(1.0, index=df.index)

    enc, svd, X_cat_red = _fit_coders(X_cat)
    X_all = np.hstack([X_cat_red.astype(np.float32), X_num.values.astype(np.float32)])

    le = LabelEncoder()
    y_enc = le.fit_transform(y_str.values)
    n_classes = int(len(le.classes_))

# LightGBM and Neural Network models removed - using hierarchical statistical models instead
    return None, [], list(cat_cols), list(num_cols)


def cross_validate_transfers(train_df: pd.DataFrame, folds: int = TRANSFERS_CV_FOLDS) -> Dict[str, float]:
    """
    CV for transfer models - LightGBM backend removed, using statistical models instead.
    """
    print("[Transfers CV] LightGBM backend removed - using hierarchical statistical models", flush=True)
    return {"mean_log_loss": float("nan"), "mean_accuracy": float("nan")}


# ---------- Neural backend ----------
def fit_nn_transfer(train_df: pd.DataFrame):
    """Neural Network backend removed - using hierarchical statistical models instead."""
    raise NotImplementedError("Neural Network backend has been removed. Use hierarchical statistical models.")


def cross_validate_transfers_nn(train_df: pd.DataFrame, folds: int = TRANSFERS_CV_FOLDS) -> Dict[str, float]:
    if train_df.empty:
        print("[Transfers CV/NN] Empty training set; skipping.", flush=True)
        return {"mean_log_loss": float("nan"), "mean_accuracy": float("nan")}

    df_all = _cap_source_personid_cardinality(train_df.copy())

    X_cat_all, cat_cols_all = _cat_block(df_all, _CANON_CAT_COLS)
    X_num_all, num_cols_all = _num_block(df_all, _CANON_NUM_COLS)

    if _LABEL_COL not in df_all.columns:
        print(f"[Transfers CV/NN] Missing label column '{_LABEL_COL}'; skipping.", flush=True)
        return {"mean_log_loss": float("nan"), "mean_accuracy": float("nan")}

    y_all = df_all[_LABEL_COL].astype(str)
    w_all = df_all[_WEIGHT_COL].astype(np.float32) if _WEIGHT_COL in df_all.columns else pd.Series(1.0, index=df_all.index)

    skf = StratifiedKFold(n_splits=folds, shuffle=TRANSFERS_CV_SHUFFLE, random_state=RANDOM_SEED)

    fold_metrics = []
    for i, (tr_idx, va_idx) in enumerate(skf.split(X_cat_all, y_all), start=1):
        tr_df = df_all.iloc[tr_idx].copy()
        va_df = df_all.iloc[va_idx].copy()

        Xc_tr, cat_cols_tr = _cat_block(tr_df, cat_cols_all)
        Xn_tr, num_cols_tr = _num_block(tr_df, num_cols_all)
        enc, svd, Xcat_tr = _fit_coders(Xc_tr)
        X_tr = np.hstack([Xcat_tr.astype(np.float32), Xn_tr.values.astype(np.float32)])

        le = LabelEncoder()
        y_tr_enc = le.fit_transform(tr_df[_LABEL_COL].astype(str).values)
        classes_ = list(le.classes_)
        n_classes = len(classes_)

        w_tr = tr_df[_WEIGHT_COL].astype(np.float32) if _WEIGHT_COL in tr_df.columns else pd.Series(1.0, index=tr_df.index)

        mlp = MLPClassifier(
            hidden_layer_sizes=NN_HIDDEN,
            activation="relu",
            alpha=NN_ALPHA,
            batch_size=NN_BATCH_SIZE,
            learning_rate_init=NN_LR,
            max_iter=NN_MAX_ITER,
            early_stopping=False,
            random_state=RANDOM_SEED,
            verbose=False,
        )
        mlp.fit(X_tr.astype(np.float64), y_tr_enc, sample_weight=w_tr.values.astype(np.float32))

        # transform validation with SAME enc/svd and SAME column set
        Xc_va, _ = _cat_block(va_df, cat_cols_tr)
        Xcat_va = enc.transform(Xc_va)
        Xcat_va = svd.transform(Xcat_va) if svd is not None else Xcat_va.toarray()
        Xn_va, _ = _num_block(va_df, num_cols_tr)
        X_va = np.hstack([Xcat_va.astype(np.float32), Xn_va.values.astype(np.float32)])

        seen = set(classes_)
        mask_seen = va_df[_LABEL_COL].astype(str).isin(seen)
        skipped = int((~mask_seen).sum())
        if skipped > 0:
            print(f"[Transfers CV/NN] Fold {i}: skipping {skipped} val rows with unseen label(s).")

        if mask_seen.any():
            class_to_idx = {c: j for j, c in enumerate(classes_)}
            y_idx = va_df.loc[mask_seen, _LABEL_COL].astype(str).map(class_to_idx).values
            proba = mlp.predict_proba(X_va[mask_seen.values].astype(np.float64))
            proba = np.clip(proba, 1e-12, 1.0)
            proba = proba / np.clip(proba.sum(axis=1, keepdims=True), 1e-12, None)
            ll = log_loss(y_idx, proba, labels=np.arange(n_classes))
            y_pred_idx = np.argmax(proba, axis=1)
            acc = accuracy_score(y_idx, y_pred_idx)
        else:
            ll, acc = np.nan, np.nan

        fold_metrics.append((ll, acc))

    arr = np.array([[a if np.isfinite(a) else np.nan, b if np.isfinite(b) else np.nan] for a, b in fold_metrics])
    mean_ll = float(np.nanmean(arr[:, 0]))
    mean_acc = float(np.nanmean(arr[:, 1]))
    print(f"[Transfers CV/NN] {folds}-fold mean log_loss: {mean_ll:0.4f} | mean accuracy: {mean_acc:0.4f}")
    return {"mean_log_loss": mean_ll, "mean_accuracy": mean_acc}
