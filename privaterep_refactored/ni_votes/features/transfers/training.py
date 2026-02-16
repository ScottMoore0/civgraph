"""Model training entry points and caching for transfer predictions."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.decomposition import TruncatedSVD
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder

from ...data.loading import load_ml_tables_any
from ... import config as CFG
from .base import (
    _DEF_KEY_BODY,
    _DEF_KEY_CONS,
    _DEF_KEY_DATE,
    _SHARE_BIN_COUNT,
    _df_fingerprint,
    _share_combo_key,
)
from .encoders import _Encoders, TransferModel, _HAS_KNN, _HAS_SPECTRAL
from .ml_tables import (
    _canonical_body_for_model,
    _canonical_event,
    _canonical_event_for_model,
    build_training_from_ml_tables,
)
from .pairs import _build_pairs_stateful, _compute_nt_rate_by_party
from .party_space import PartySpace

try:  # Optional imports used when available
    from sklearn.cluster import SpectralClustering  # type: ignore
except Exception:  # pragma: no cover
    SpectralClustering = None  # type: ignore
try:
    from sklearn.neighbors import NearestNeighbors  # type: ignore
except Exception:  # pragma: no cover
    NearestNeighbors = None  # type: ignore

__all__ = ["get_transfer_model", "_MODEL_CACHE", "_MODEL_CACHE_KEY", "_HierarchicalFallback"]

_MODEL_CACHE_KEY: Tuple[Tuple[int, int], Optional[Tuple[str, str, str]]] | None = None
_MODEL_CACHE: TransferModel | None = None


class _HierarchicalFallback:
    """Simple Dirichlet-style fallback for donor probabilities."""

    def __init__(
        self,
        base_counts: Dict[str, float],
        contexts: Dict[str, Dict[Any, Tuple[Dict[str, float], float]]],
        *,
        alpha_mass: float = 1.0,
    ) -> None:
        self.base_counts = {str(k): float(v) for k, v in (base_counts or {}).items()}
        self.contexts = contexts or {}
        self.alpha_mass = max(float(alpha_mass), 0.0)
        if self.base_counts:
            self.classes_ = list(self.base_counts.keys())
        else:
            self.classes_ = []
        self._ctx: Dict[str, Any] = {}
        total_base = float(sum(v for v in self.base_counts.values() if np.isfinite(v)))
        n_classes = len(self.base_counts)
        if total_base <= 0 and n_classes > 0:
            total_base = float(n_classes)
            self.base_counts = {k: 1.0 for k in self.classes_}
        self._alpha_prior = {}
        if n_classes > 0:
            for key, value in self.base_counts.items():
                self._alpha_prior[key] = (
                    self.alpha_mass * float(value) / float(total_base)
                    if total_base > 0
                    else self.alpha_mass / float(n_classes)
                )
        self.last_context: Optional[str] = None
        self.last_confidence: Optional[float] = None

    def set_context(self, ctx: Dict[str, Any]) -> None:
        self._ctx = ctx or {}

    def _lookup_context(self) -> Tuple[Dict[str, float], float, str]:
        etype = str(self._ctx.get("etype", "") or "")
        body = str(self._ctx.get("body", "") or "")
        donor = str(self._ctx.get("donor_party", "") or "")
        stage = str(self._ctx.get("stage", "") or "")

        order = [
            ("type_body_stage_donor", (etype, body, stage, donor)),
            ("type_body_donor", (etype, body, donor)),
            ("body_stage_donor", (body, stage, donor)),
            ("body_donor", (body, donor)),
            ("type_stage_donor", (etype, stage, donor)),
            ("type_donor", (etype, donor)),
            ("stage_donor", (stage, donor)),
            ("donor", donor),
            ("type_body", (etype, body)),
            ("body", body),
            ("type", etype),
            ("stage", stage),
        ]

        for key, lookup_key in order:
            table = self.contexts.get(key)
            if not table:
                continue
            entry = table.get(lookup_key)
            if entry:
                counts_map, total = entry
                return {str(k): float(v) for k, v in counts_map.items()}, float(total), key

        global_entry = self.contexts.get("global")
        if isinstance(global_entry, tuple):
            counts_map, total = global_entry
            return {str(k): float(v) for k, v in counts_map.items()}, float(total), "global"

        return {}, 0.0, "global"

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        recipients = [str(r) for r in self._ctx.get("recipients", [])]
        n_rows = len(recipients)
        n_classes = len(self.classes_)
        if n_rows == 0 or n_classes == 0:
            return np.zeros((n_rows, n_classes), dtype=float)

        counts_map, total, ctx_name = self._lookup_context()
        dirichlet = {}
        for cls in self.classes_:
            dirichlet[cls] = max(0.0, counts_map.get(cls, 0.0)) + self._alpha_prior.get(cls, 0.0)
        denom = float(sum(dirichlet.values()))
        if denom <= 0:
            dist = np.full((n_classes,), 1.0 / float(n_classes), dtype=float)
            confidence = 0.0
        else:
            dist = np.asarray([dirichlet.get(cls, 0.0) / denom for cls in self.classes_], dtype=float)
            confidence = 0.0
            if total + self.alpha_mass > 0:
                confidence = float(max(0.0, min(1.0, total / (total + self.alpha_mass))))

        self.last_context = ctx_name
        self.last_confidence = confidence

        mat = np.tile(dist, (n_rows, 1))
        return mat

    def predict(self, X: np.ndarray) -> np.ndarray:
        proba = self.predict_proba(X)
        return proba

def get_transfer_model(
    er_df: pd.DataFrame,
    tr_df: pd.DataFrame,
    *,
    scenario_dict: Optional[Dict[str, Any]] = None,
    refit_if_changed: bool = False,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> TransferModel:
    global _MODEL_CACHE, _MODEL_CACHE_KEY

    k1 = _df_fingerprint(er_df if er_df is not None else pd.DataFrame())
    k2 = _df_fingerprint(tr_df if tr_df is not None else pd.DataFrame())
    key = (k1, k2)

    scen_sig = None
    try:
        if isinstance(scenario_dict, dict):
            eb = str(scenario_dict.get("elected_body", "") or "")
            et = str(scenario_dict.get("election_type", "") or "")
            yr = str(scenario_dict.get("date", "") or "")[:4]
            scen_sig = (et, eb, yr)
    except Exception:
        scen_sig = None

    cache_key = (key, scen_sig)
    if not refit_if_changed and _MODEL_CACHE is not None and _MODEL_CACHE_KEY == cache_key:
        return _MODEL_CACHE

    try:
        use_ml = bool(getattr(CFG, "USE_ML_TABLES", True))
    except Exception:
        use_ml = True

    def _derive_filters(scen: Optional[Dict[str, Any]]) -> Tuple[Optional[set], Optional[set]]:
        if not isinstance(scen, dict):
            return None, None

        event_raw = scen.get("event", "")
        etype_raw = scen.get("election_type", "")
        event_token = _canonical_event_for_model(event_raw)
        etype_token = _canonical_event_for_model(etype_raw)
        if not event_token and etype_token:
            event_token = etype_token
        body_raw = str(scen.get("elected_body", "") or "").strip()
        body = body_raw.casefold()
        body_token = _canonical_body_for_model(body_raw)
        ev = None
        if event_token:
            if event_token == "CustomElection":
                ev = {"RegionalElection"}
            else:
                ev = {event_token}
        if ev:
            ev = {
                _canonical_event_for_model(token)
                for token in ev
                if _canonical_event_for_model(token)
            }
            
            # Special handling for Northern Ireland Assembly with DevolvedElection
            if (body == "northern ireland assembly" and 
                "Regionalelection" in ev and
                (scen.get("include_constitutional_convention") or scen.get("include_european_parliament"))):
                
                # Add Constitutional Convention elections if requested
                if scen.get("include_constitutional_convention"):
                    ev.add("AssemblyElection")  # Constitutional Convention maps to AssemblyElection
                
                # Add European Parliament elections if requested
                if scen.get("include_european_parliament"):
                    ev.add("EuropeanElection")
        
        bodies = None
        if body:
            if body == "custombody":
                bodies = {"regionalbody"}
            else:
                if body_token:
                    bodies = {body_token.casefold()}
        return ev, bodies

    allowed_events, allowed_bodies_cf = _derive_filters(scenario_dict)
    allowed_events_cf = (
        {event.casefold() for event in allowed_events} if allowed_events else None
    )

    train_df = pd.DataFrame()
    ml_tables: Dict[str, pd.DataFrame] = {}
    if use_ml:
        try:
            ml_tables = load_ml_tables_any(getattr(CFG, "INPUT_XLSX", None), CFG)
        except Exception:
            ml_tables = {}

    fallback_info: Optional[Dict[str, Any]] = None
    if use_ml and ml_tables:
        try:
            train_df = build_training_from_ml_tables(er_df, ml_tables, scenario_dict=scenario_dict)
            if not train_df.empty:
                pooled_mask = None
                if "pooled_source" in train_df.columns:
                    pooled_mask = train_df["pooled_source"].astype(str).str.len() > 0

                if allowed_events_cf and "EType" in train_df.columns:
                    events_cf = (
                        train_df["EType"].map(_canonical_event_for_model)
                        .astype(str)
                        .str.casefold()
                    )
                    mask = events_cf.isin(allowed_events_cf)
                    if pooled_mask is not None:
                        mask = mask | pooled_mask
                    train_df = train_df[mask]
                elif allowed_events and "EType" in train_df.columns:
                    events = train_df["EType"].map(_canonical_event_for_model)
                    mask = events.isin(allowed_events)
                    if pooled_mask is not None:
                        mask = mask | pooled_mask
                    train_df = train_df[mask]
                if allowed_bodies_cf:
                    bodies_cf = train_df.get("Body", "").astype(str).str.casefold()
                    mask = bodies_cf.isin(allowed_bodies_cf)
                    if pooled_mask is not None:
                        mask = mask | pooled_mask
                    train_df = train_df[mask]
                if hasattr(train_df, "attrs"):
                    fallback_info = train_df.attrs.get("fallback_info")
        except Exception:
            train_df = pd.DataFrame()
            fallback_info = None

        def _apply_ml_prior_metadata(model: TransferModel, info: Dict[str, Any]) -> None:
            if not info:
                return
            model.stage_thresholds = {
                tuple(str(k) for k in key): float(val)
                for key, val in (info.get("stage_thresholds") or {}).items()
            }
            model.priors_by_type_body_stage = info.get("counts_type_body_stage", {})
            model.priors_by_type_body = info.get("counts_type_body", {})
            model.counts_type_body_stage = info.get("counts_type_body_stage", {})
            model.counts_type_body = info.get("counts_type_body", {})
            model.counts_type = info.get("counts_type", {})
            model.counts_stage = info.get("counts_stage", {})
            model.counts_party = info.get("counts_party", {})
            model.counts_global = info.get("counts_global", {})
            model.party_prior = info.get("party_prior", {})
            model.donor_strength = info.get("donor_strength", {})
            model.model_strength = float(info.get("model_strength", model.model_strength or 1.0))
            model.nt_rate_by_party = info.get("nt_rate_by_party", {})
            model.nt_rate_global = float(info.get("nt_rate_global", model.nt_rate_global or 0.0))
            model._share_nt_global = model.nt_rate_global
            try:
                model.pooled_sources = info.get("pooled_sources", {})
            except Exception:
                pass

        def _build_fallback_model(info: Dict[str, Any]) -> Optional[TransferModel]:
            if not info:
                return None
            cat_cols = info.get(
                "cat_cols",
                ["donor_party", "recipient_party", "constituency", "body", "etype"],
            )
            num_cols = info.get(
                "num_cols",
                [
                    "count",
                    "is_elimination",
                    "is_surplus",
                    "don_first_share",
                    "don_transfer_share",
                    "rec_first_share",
                    "rec_transfer_share",
                ],
            )
            try:
                cat_fit = info.get("cat_fit_df")
                if cat_fit is None or cat_fit.empty:
                    cat_fit = pd.DataFrame({c: [""] for c in cat_cols})
                cat_fit = cat_fit[cat_cols].astype(str)
                ohe = OneHotEncoder(handle_unknown="ignore")
                ohe.fit(cat_fit)
                enc = _Encoders(ohe, None, cat_cols, num_cols)
                base_counts = info.get("base_counts", {})
                contexts = info.get("contexts", {})
                fallback = _HierarchicalFallback(base_counts, contexts, alpha_mass=5.0)
                model_fb = TransferModel(enc, fallback)
                classes = info.get("classes")
                if classes:
                    model_fb.classes_ = [str(c) for c in classes]
                    model_fb.class_index = {str(c): i for i, c in enumerate(model_fb.classes_)}
                _apply_ml_prior_metadata(model_fb, info)
                model_fb.pspace = PartySpace.from_er(er_df)
                return model_fb
            except Exception:
                return None

        if not train_df.empty:
            # LightGBM backend removed - using hierarchical statistical models instead
            print("[Transfer Model] LightGBM backend removed - falling back to hierarchical statistical models", flush=True)

        if fallback_info:
            fb_model = _build_fallback_model(fallback_info)
            if fb_model is not None:
                _MODEL_CACHE = fb_model
                _MODEL_CACHE_KEY = cache_key
                return fb_model

    pairs, pspace = _build_pairs_stateful(er_df, tr_df, progress_callback=progress_callback)
    if not pairs.empty:
        if allowed_events_cf:
            if "etype" in pairs.columns:
                etype_cf = (
                    pairs["etype"].map(_canonical_event_for_model).astype(str).str.casefold()
                )
            else:
                etype_cf = pd.Series("", index=pairs.index)
            pairs = pairs[etype_cf.isin(allowed_events_cf)]
        if allowed_bodies_cf:
            pairs = pairs[pairs.get("body", "").astype(str).str.casefold().isin(allowed_bodies_cf)]

    if pairs.empty:
        ohe = OneHotEncoder(handle_unknown="ignore")
        cat_cols = ["donor_party"]
        ohe.fit(pd.DataFrame({"donor_party": [""]}))
        enc = _Encoders(ohe=ohe, svd=None, cat_cols=cat_cols, num_cols=["count"])

        class _ZeroEstimator:
            classes_ = np.asarray(["NonTransferable"], dtype=str)

            def predict_proba(self, X):
                return np.zeros((len(X), len(self.classes_)), dtype=float)

        est = _ZeroEstimator()
        _MODEL_CACHE = TransferModel(enc, est)
        _MODEL_CACHE.pspace = pspace
        _MODEL_CACHE_KEY = cache_key
        return _MODEL_CACHE

    cat_cols = ["donor_party", "recipient_party", "constituency", "body", "etype"]
    dyn_don = [c for c in pairs.columns if c.startswith("don_src::")]
    dyn_surv = [c for c in pairs.columns if c.startswith("surv_has::")]
    dyn_surv_count = [c for c in pairs.columns if c.startswith("surv_count::")]
    dyn_surv_share = [c for c in pairs.columns if c.startswith("surv_share::")]
    dyn_surv_top_share = [c for c in pairs.columns if c.startswith("surv_top_share::")]

    pairs["bias"] = 1.0
    vote_share_cols = [
        "don_first_share",
        "don_transfer_share",
        "rec_first_share",
        "rec_transfer_share",
    ]
    num_cols = (
        ["count", "is_elimination", "is_surplus", "bias"]
        + dyn_don
        + dyn_surv
        + dyn_surv_count
        + dyn_surv_share
        + dyn_surv_top_share
        + vote_share_cols
    )

    ohe = OneHotEncoder(handle_unknown="ignore")
    ohe.fit(pairs[cat_cols].astype(str))
    Xc = ohe.transform(pairs[cat_cols])

    svd: Optional[TruncatedSVD] = None
    try:
        if Xc.shape[1] > 512:
            svd = TruncatedSVD(n_components=min(256, Xc.shape[1] - 1), random_state=0)
            Xo = svd.fit_transform(Xc)
        else:
            Xo = Xc.toarray()
    except Exception:
        Xo = Xc.toarray()
        svd = None

    for c in num_cols:
        if c not in pairs.columns:
            pairs[c] = 0.0
    Xn = pairs[num_cols].astype(float).to_numpy(dtype=np.float32)
    X = np.hstack([Xo.astype(np.float32), Xn]) if Xn.size else Xo.astype(np.float32)

    y = pairs["y_share"].astype(float).clip(0.0, 1.0).to_numpy()
    vote_weight = (
        pd.to_numeric(pairs.get("weight", 1.0), errors="coerce").fillna(0.0).astype(float)
        * pairs["y_share"].astype(float).clip(0.0, 1.0)
    )

    est: Any = None
    y_classes = pairs["recipient_party"].astype(str).to_numpy()
    mask = (vote_weight.to_numpy(dtype=float) > 0) & (y_classes != "")
    unique_classes = np.unique(y_classes[mask]) if mask.any() else np.array([])

    if mask.any() and unique_classes.size >= 2:
        try:
            clf = LogisticRegression(max_iter=500, multi_class="multinomial", solver="lbfgs")
            clf.fit(
                X[mask].astype(np.float64),
                y_classes[mask],
                sample_weight=vote_weight.to_numpy(dtype=float)[mask],
            )
            est = clf
        except Exception:
            est = None

    if est is None:
        vote_totals = (
            pd.DataFrame(
                {
                    "recipient_party": pairs["recipient_party"].astype(str),
                    "__votes": vote_weight.replace(0.0, np.nan),
                }
            )
            .groupby("recipient_party", dropna=False)["__votes"].sum()
            .replace({np.nan: 0.0})
        )
        vote_totals = vote_totals[vote_totals > 0]
        if vote_totals.empty:
            recipients = sorted({str(r) for r in pairs["recipient_party"].astype(str) if r})
            if not recipients:
                recipients = ["NonTransferable"]
            uniform = {rec: 1.0 / len(recipients) for rec in recipients}
            vote_totals = pd.Series(uniform, dtype=float)

        class _ConstantEstimator:
            def __init__(self, dist: pd.Series):
                probs = dist.astype(float)
                probs = probs[probs >= 0]
                total = float(probs.sum())
                if total <= 0:
                    raise ValueError("constant estimator requires positive mass")
                self.classes_ = np.asarray([str(idx) for idx in probs.index], dtype=str)
                self._probs = (probs / total).to_numpy(dtype=float)

            def predict_proba(self, X):
                return np.tile(self._probs, (len(X), 1))

        est = _ConstantEstimator(vote_totals)

    enc = _Encoders(ohe=ohe, svd=svd, cat_cols=cat_cols, num_cols=num_cols)
    model = TransferModel(enc, est)
    model.pspace = pspace
    try:
        nt_map, nt_global = _compute_nt_rate_by_party(er_df, tr_df)
        model.nt_rate_by_party = nt_map
        model.nt_rate_global = float(nt_global)
    except Exception:
        model.nt_rate_by_party = {}
        model.nt_rate_global = 0.0

    try:
        for dp, g in pairs.groupby("donor_party", dropna=False):
            dp = str(dp)
            sub = g.copy()
            classes = sorted(set(sub["recipient_party"].astype(str)))
            if len(classes) < 2 or len(sub) < 5:
                continue
            Xc_dp = ohe.transform(sub[cat_cols].astype(str))
            Xc_dp = svd.transform(Xc_dp) if svd is not None else Xc_dp.toarray()
            for c in num_cols:
                if c not in sub.columns:
                    sub[c] = 0.0
            Xn_dp = sub[num_cols].astype(float).to_numpy(dtype=np.float32)
            X_dp = np.hstack([Xc_dp.astype(np.float32), Xn_dp]) if Xn_dp.size else Xc_dp.astype(np.float32)
            y_dp = sub["recipient_party"].astype(str).values
            w_dp = (
                pd.to_numeric(sub.get("weight", 1.0), errors="coerce").fillna(1.0).astype(float)
                * sub["y_share"].astype(float).clip(0.0, 1.0)
            ).values
            mask_dp = (w_dp > 0) & (sub["recipient_party"].astype(str) != "")
            try:
                if mask_dp.any() and len(np.unique(y_dp[mask_dp])) >= 2:
                    clf = LogisticRegression(max_iter=500, multi_class="auto")
                    clf.fit(
                        X_dp[mask_dp].astype(np.float64),
                        y_dp[mask_dp],
                        sample_weight=w_dp[mask_dp],
                    )
                    model.donor_models[dp] = clf
                    model.donor_classes[dp] = [str(c) for c in getattr(clf, "classes_", [])]
            except Exception:
                pass
    except Exception:
        pass

    try:
        tmp = pairs[["donor_party", "recipient_party", "y_share", "weight"]].copy()
        tmp["weight"] = pd.to_numeric(tmp["weight"], errors="coerce").fillna(1.0)
        tmp["ws"] = tmp["y_share"].astype(float) * tmp["weight"].astype(float)
        grp = tmp.groupby(["donor_party", "recipient_party"], dropna=False)["ws"].sum().reset_index()
        prior: Dict[str, Dict[str, float]] = {}
        for dp, g in grp.groupby("donor_party", dropna=False):
            total = float(g["ws"].sum())
            if total <= 0:
                continue
            row = {str(r["recipient_party"]): float(r["ws"]) / total for _, r in g.iterrows() if float(r["ws"]) > 0}
            prior[str(dp)] = row
        model.party_prior = prior
    except Exception:
        model.party_prior = {}

    try:
        share_df = pairs[
            ["donor_party", "recipient_party", "don_first_share", "don_transfer_share", "y_share", "weight"]
        ].copy()
        share_df["weight"] = pd.to_numeric(share_df["weight"], errors="coerce").fillna(1.0)
        share_df["ws"] = share_df["y_share"].astype(float).clip(0.0, 1.0) * share_df["weight"].astype(float)
        share_df["share_key"] = [
            _share_combo_key(f, t, bins=_SHARE_BIN_COUNT)
            for f, t in zip(share_df["don_first_share"], share_df["don_transfer_share"])
        ]
        share_df = share_df[share_df["share_key"] != ""].copy()

        donor_share: Dict[str, Dict[str, Tuple[Dict[str, float], float]]] = {}
        global_share: Dict[str, Tuple[Dict[str, float], float]] = {}

        for (dp, skey), sub in share_df.groupby(["donor_party", "share_key"], dropna=False):
            total = float(sub["ws"].sum())
            if total <= 0:
                continue
            agg = sub.groupby("recipient_party", dropna=False)["ws"].sum()
            donor_share.setdefault(str(dp), {})[str(skey)] = (
                {str(idx): float(val) for idx, val in agg.items() if float(val) > 0},
                total,
            )

        for skey, sub in share_df.groupby("share_key", dropna=False):
            total = float(sub["ws"].sum())
            if total <= 0:
                continue
            agg = sub.groupby("recipient_party", dropna=False)["ws"].sum()
            global_share[str(skey)] = (
                {str(idx): float(val) for idx, val in agg.items() if float(val) > 0},
                total,
            )

        model.share_prior = donor_share
        model.share_prior_global = global_share
        model.share_bins = _SHARE_BIN_COUNT
    except Exception:
        model.share_prior = {}
        model.share_prior_global = {}
        model.share_bins = _SHARE_BIN_COUNT

    try:
        max_pairs = pairs[["donor_party", "recipient_party", "y_share"]].copy()
        max_pairs["donor_party"] = max_pairs["donor_party"].astype(str)
        max_pairs["recipient_party"] = max_pairs["recipient_party"].astype(str)
        agg_max = (
            max_pairs.groupby(["donor_party", "recipient_party"], dropna=False)["y_share"].max()
        )
        model.max_pair_share = {
            (str(dp), str(rp)): float(val)
            for (dp, rp), val in agg_max.items()
            if np.isfinite(val)
        }
    except Exception:
        model.max_pair_share = {}

    try:
        tmp2 = pairs[[
            "etype",
            "body",
            "donor_party",
            "recipient_party",
            "y_share",
            "weight",
            "date",
            "constituency",
            "count",
        ]].copy()
        tmp2["weight"] = pd.to_numeric(tmp2["weight"], errors="coerce").fillna(1.0)
        tmp2["ws"] = tmp2["y_share"].astype(float) * tmp2["weight"].astype(float)

        med_thr: Dict[Tuple[str, str], float] = {}
        for (et, bo), group in tmp2.groupby(["etype", "body"], dropna=False):
            meds = []
            for _, gk in group.groupby(["date", "constituency"], dropna=False):
                if not gk["count"].empty:
                    meds.append(float(gk["count"].median()))
            if meds:
                med_thr[(str(et), str(bo))] = float(np.median(np.asarray(meds)))
        model.stage_thresholds = med_thr

        def _stage_row(r):
            thr = med_thr.get((str(r["etype"]), str(r["body"])), None)
            if thr is None:
                return "early"
            return "early" if float(r["count"]) <= float(thr) else "late"

        tmp2["stage"] = tmp2.apply(_stage_row, axis=1)

        def _collect_counts(df: pd.DataFrame, key_cols: List[str]) -> Dict[Tuple[str, ...], Dict[str, Dict[str, float]]]:
            result: Dict[Tuple[str, ...], Dict[str, Dict[str, float]]] = {}
            if df.empty:
                return result
            group_cols = key_cols + ["donor_party"]
            for keys, sub_df in df.groupby(group_cols, dropna=False):
                if not isinstance(keys, tuple):
                    keys = (keys,)
                ctx_key = tuple(str(k) for k in keys[:-1])
                donor_key = str(keys[-1])
                dest = result.setdefault(ctx_key, {})
                agg = sub_df.groupby("recipient_party", dropna=False)["ws"].sum()
                row = {str(rec): float(val) for rec, val in agg.items() if float(val) > 0}
                if row:
                    dest[donor_key] = row
            return result

        counts_tbs = _collect_counts(tmp2, ["etype", "body", "stage"])
        counts_tb = _collect_counts(tmp2, ["etype", "body"])
        raw_counts_type = _collect_counts(tmp2, ["etype"])
        raw_counts_stage = _collect_counts(tmp2, ["stage"])
        counts_type = { (key[0] if len(key) == 1 else key): donors for key, donors in raw_counts_type.items() }
        counts_stage = { (key[0] if len(key) == 1 else key): donors for key, donors in raw_counts_stage.items() }

        def _normalise(src: Dict[Tuple[str, ...], Dict[str, Dict[str, float]]]) -> Dict[Tuple[str, ...], Dict[str, Dict[str, float]]]:
            out: Dict[Tuple[str, ...], Dict[str, Dict[str, float]]] = {}
            for key, donors in src.items():
                norm_block: Dict[str, Dict[str, float]] = {}
                for donor, counts in donors.items():
                    total = float(sum(counts.values()))
                    if total <= 0:
                        continue
                    norm_block[donor] = {rp: float(val) / total for rp, val in counts.items() if float(val) > 0}
                if norm_block:
                    out[key] = norm_block
            return out

        model.priors_by_type_body_stage = _normalise(counts_tbs)
        model.priors_by_type_body = _normalise(counts_tb)

        party_counts: Dict[str, Dict[str, float]] = {}
        for dp, g in tmp2.groupby("donor_party", dropna=False):
            agg = g.groupby("recipient_party", dropna=False)["ws"].sum()
            row = {str(rec): float(val) for rec, val in agg.items() if float(val) > 0}
            if row:
                party_counts[str(dp)] = row
        total_map = {dp: float(sum(row.values())) for dp, row in party_counts.items()}
        model.party_prior = {
            dp: {rp: val / total_map[dp] for rp, val in row.items() if total_map[dp] > 0}
            for dp, row in party_counts.items()
            if total_map.get(dp, 0.0) > 0
        }

        model.counts_type_body_stage = counts_tbs
        model.counts_type_body = counts_tb
        model.counts_type = counts_type
        model.counts_stage = counts_stage
        model.counts_party = party_counts
        model.counts_global = {
            str(rec): float(val)
            for rec, val in tmp2.groupby("recipient_party", dropna=False)["ws"].sum().items()
            if float(val) > 0
        }
        model.donor_strength = {
            str(dp): float(g["ws"].sum())
            for dp, g in tmp2.groupby("donor_party", dropna=False)
        }

        strengths: List[float] = []
        for ctx in (
            counts_tbs.values(),
            counts_tb.values(),
            counts_type.values(),
            counts_stage.values(),
        ):
            for donors in ctx:
                for counts in donors.values():
                    total = float(sum(counts.values()))
                    if total > 0:
                        strengths.append(total)
        if strengths:
            model.model_strength = float(np.median(np.asarray(strengths)))
        else:
            model.model_strength = float(max(tmp2["ws"].median(), 1.0)) if not tmp2.empty else 1.0
    except Exception:
        model.priors_by_type_body = {}
        model.priors_by_type_body_stage = {}
        model.stage_thresholds = {}
        model.counts_type_body_stage = {}
        model.counts_type_body = {}
        model.counts_type = {}
        model.counts_stage = {}
        model.counts_party = {}
        model.counts_global = {}
        model.donor_strength = {}
        model.model_strength = 1.0

    try:
        if _HAS_SPECTRAL and SpectralClustering is not None and not pairs.empty:
            parties_all = sorted(set(pairs["donor_party"].astype(str)) | set(pairs["recipient_party"].astype(str)))
            p_index = {p: i for i, p in enumerate(parties_all)}
            M = np.zeros((len(parties_all), len(parties_all)), dtype=float)
            tmpP = pairs[["donor_party", "recipient_party", "y_share", "weight"]].copy()
            tmpP["ws"] = tmpP["y_share"].astype(float) * pd.to_numeric(tmpP["weight"], errors="coerce").fillna(1.0)
            for _, r in tmpP.iterrows():
                i = p_index[str(r["donor_party"])]
                j = p_index[str(r["recipient_party"])]
                M[i, j] += float(r["ws"])
            W = 0.5 * (M + M.T)
            n_clusters = 3 if len(parties_all) >= 3 else max(1, len(parties_all))
            labels = SpectralClustering(
                n_clusters=n_clusters, affinity="precomputed", assign_labels="kmeans", random_state=0
            ).fit_predict(W)
            bloc_of = {p: int(labels[p_index[p]]) for p in parties_all}
            model.bloc_of_party = bloc_of
            bloc_prior: Dict[int, Dict[int, float]] = {}
            for dp, g in tmpP.groupby("donor_party", dropna=False):
                b_from = bloc_of.get(str(dp), -1)
                if b_from < 0:
                    continue
                ws_by_rec = g.groupby("recipient_party", dropna=False)["ws"].sum().to_dict()
                agg: Dict[int, float] = {}
                for rp, ws in ws_by_rec.items():
                    b_to = bloc_of.get(str(rp), -1)
                    if b_to < 0:
                        continue
                    agg[b_to] = agg.get(b_to, 0.0) + float(ws)
                total = sum(agg.values())
                if total > 0:
                    bloc_prior[b_from] = {bt: val / total for bt, val in agg.items()}
            model.prior_bloc = bloc_prior
    except Exception:
        pass

    try:
        if _HAS_KNN and NearestNeighbors is not None:
            dyn_cols_ctx = [
                c
                for c in pairs.columns
                if c.startswith("don_src::") or c.startswith("surv_has::") or c.startswith("surv_share::")
            ]
            if dyn_cols_ctx:
                pairs_ctx = pairs[[
                    "date",
                    "constituency",
                    "body",
                    "etype",
                    "count",
                    "donor_party",
                    "recipient_party",
                    "y_share",
                    "weight",
                ] + dyn_cols_ctx].copy()
                pairs_ctx["ws"] = pairs_ctx["y_share"].astype(float) * pd.to_numeric(
                    pairs_ctx["weight"], errors="coerce"
                ).fillna(1.0)
                grp_cols = ["date", "constituency", "body", "etype", "count", "donor_party"]
                ctx_sum = pairs_ctx.groupby(grp_cols, dropna=False)[dyn_cols_ctx].mean().reset_index()
                dist = (
                    pairs_ctx.groupby(grp_cols + ["recipient_party"], dropna=False)["ws"].sum().reset_index()
                )
                for dp, gctx in ctx_sum.groupby("donor_party", dropna=False):
                    dp = str(dp)
                    Xctx = gctx[dyn_cols_ctx].astype(float).to_numpy(dtype=np.float32)
                    key_to_idx = {tuple(r[c] for c in grp_cols): i for i, (_, r) in enumerate(gctx.iterrows())}
                    distrib_list: List[Dict[str, float]] = [{} for _ in range(len(gctx))]
                    sub = dist[dist["donor_party"].astype(str) == dp]
                    from collections import defaultdict

                    group_totals: Dict[Tuple[Any, ...], float] = defaultdict(float)
                    for _, r in sub.iterrows():
                        k = (
                            r["date"],
                            r["constituency"],
                            r["body"],
                            r["etype"],
                            r["count"],
                            dp,
                        )
                        group_totals[k] += float(r["ws"])
                    for _, r in sub.iterrows():
                        k = (
                            r["date"],
                            r["constituency"],
                            r["body"],
                            r["etype"],
                            r["count"],
                            dp,
                        )
                        tot = group_totals.get(k, 0.0)
                        if tot <= 0:
                            continue
                        idx = key_to_idx.get(k)
                        if idx is None:
                            continue
                        rp = str(r["recipient_party"])
                        distrib_list[idx][rp] = distrib_list[idx].get(rp, 0.0) + float(r["ws"]) / float(tot)
                    if len(Xctx) >= 5 and NearestNeighbors is not None:
                        neigh = NearestNeighbors(n_neighbors=min(10, len(Xctx)), metric="cosine")
                        neigh.fit(Xctx)
                        model.knn_models[dp] = neigh
                        model.knn_ctx[dp] = Xctx
                        model.knn_distrib[dp] = distrib_list
                        model.knn_cols = dyn_cols_ctx
    except Exception:
        pass

    _MODEL_CACHE = model
    _MODEL_CACHE_KEY = cache_key
    return _MODEL_CACHE
