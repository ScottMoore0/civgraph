"""Model wrappers and runtime probability helpers for transfers."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.decomposition import TruncatedSVD
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder

from .base import (
    _SHARE_BIN_COUNT,
    _clean_party,
    _infer_type_from_body,
    _share_combo_key,
)
from .party_space import PartySpace

try:
    from sklearn.cluster import SpectralClustering  # type: ignore

    _HAS_SPECTRAL = True
except Exception:  # pragma: no cover - optional dependency
    _HAS_SPECTRAL = False
try:
    from sklearn.neighbors import NearestNeighbors  # type: ignore

    _HAS_KNN = True
except Exception:  # pragma: no cover - optional dependency
    _HAS_KNN = False

__all__ = ["_Encoders", "TransferModel", "_HAS_KNN", "_HAS_SPECTRAL"]


class _Encoders:
    def __init__(self, ohe: OneHotEncoder, svd: Optional[TruncatedSVD], cat_cols: List[str], num_cols: List[str]):
        self.ohe = ohe
        self.svd = svd
        self.cat_cols = cat_cols
        self.num_cols = num_cols

    def transform(self, df_pairs: pd.DataFrame) -> np.ndarray:
        if df_pairs.empty:
            return np.zeros((0, len(self.num_cols)), dtype=np.float32)
        # Ensure missing num cols exist
        for c in self.num_cols:
            if c not in df_pairs.columns:
                df_pairs[c] = 0.0
        Xc = df_pairs[self.cat_cols].astype(str)
        Xn = (
            df_pairs[self.num_cols].astype(float).to_numpy(dtype=np.float32)
            if self.num_cols
            else np.zeros((len(df_pairs), 0), dtype=np.float32)
        )
        Xo = self.ohe.transform(Xc)
        Xo = self.svd.transform(Xo) if self.svd is not None else Xo.toarray()
        return np.hstack([Xo.astype(np.float32), Xn])


class TransferModel:
    def __init__(self, enc: _Encoders, est: Any):
        self.enc = enc
        self.est = est
        if hasattr(est, "classes_"):
            self.classes_ = [str(c) for c in getattr(est, "classes_", [])]
        else:
            self.classes_ = None
        self.class_index: Dict[str, int] = (
            {str(c): i for i, c in enumerate(self.classes_)} if self.classes_ else {}
        )
        self.donor_models: Dict[str, Any] = {}
        self.donor_classes: Dict[str, List[str]] = {}
        self.body_models: Dict[str, Any] = {}
        self.body_classes: Dict[str, List[str]] = {}
        self.donor_body_models: Dict[Tuple[str, str], Any] = {}
        self.donor_body_classes: Dict[Tuple[str, str], List[str]] = {}
        self.party_prior: Dict[str, Dict[str, float]] = {}
        self.priors_by_type_body: Dict[Tuple[str, str], Dict[str, Dict[str, float]]] = {}
        self.priors_by_type_body_stage: Dict[Tuple[str, str, str], Dict[str, Dict[str, float]]] = {}
        self.stage_thresholds: Dict[Tuple[str, str], float] = {}
        self.bloc_of_party: Dict[str, int] = {}
        self.prior_bloc: Dict[int, Dict[int, float]] = {}
        self.knn_models: Dict[str, Any] = {}
        self.knn_ctx: Dict[str, np.ndarray] = {}
        self.knn_distrib: Dict[str, List[Dict[str, float]]] = {}
        self.knn_cols: List[str] = []
        self.nt_prior_party: Dict[str, float] = {}
        self.nt_prior_type_body: Dict[Tuple[str, str], Dict[str, float]] = {}
        self.nt_prior_type_body_stage: Dict[Tuple[str, str, str], Dict[str, float]] = {}
        self.pspace: Optional[PartySpace] = None
        self._last_debug: Dict[str, Any] = {}
        self.nt_rate_by_party: Dict[str, float] = {}
        self.nt_rate_global: float = 0.0
        self._share_nt_cache: Dict[str, float] = {}
        self._share_nt_global: Optional[float] = None
        self.counts_type_body_stage: Dict[Tuple[str, str, str], Dict[str, Dict[str, float]]] = {}
        self.counts_type_body: Dict[Tuple[str, str], Dict[str, Dict[str, float]]] = {}
        self.counts_type: Dict[str, Dict[str, Dict[str, float]]] = {}
        self.counts_stage: Dict[str, Dict[str, Dict[str, float]]] = {}
        self.counts_party: Dict[str, Dict[str, float]] = {}
        self.counts_global: Dict[str, float] = {}
        self.counts_confidence_type_body: Dict[Tuple[str, str], Dict[str, float]] = {}
        self.counts_confidence_party: Dict[str, float] = {}
        self.counts_confidence_global: float = 0.0
        self.donor_strength: Dict[str, float] = {}
        self.model_strength: float = 0.0
        self.max_pair_share: Dict[Tuple[str, str], float] = {}
        self.share_prior: Dict[str, Dict[str, Tuple[Dict[str, float], float]]] = {}
        self.share_prior_global: Dict[str, Tuple[Dict[str, float], float]] = {}
        self.share_bins: int = _SHARE_BIN_COUNT
        self.fallback_confidence: Optional[float] = None
        self.fallback_context: Optional[str] = None
        self.blend_confidence_threshold: Optional[float] = None
        self.blend_entropy_threshold: Optional[float] = None
        self.min_counts_weight: float = 0.0

    def _apply_party_compat(
        self,
        donor_party: str,
        recip_parties: List[str],
        donor_first_share: float,
        donor_transfer_share: float,
        stage: Optional[str],
        probs: np.ndarray,
    ) -> np.ndarray:
        """Return probabilities without heuristic bloc adjustments."""
        return probs

    def _apply_caps(
        self,
        donor_party: str,
        recip_parties: List[str],
        probs: np.ndarray,
    ) -> np.ndarray:
        if probs.size == 0:
            return probs
        donor_key = self._norm_key(donor_party)
        capped = probs.astype(float, copy=True)
        changed = False
        for idx, rp in enumerate(recip_parties):
            cap = self.max_pair_share.get((donor_key, self._norm_key(rp)))
            if cap is None:
                continue
            cap_val = max(0.0, float(cap))
            if capped[idx] > cap_val:
                capped[idx] = cap_val
                changed = True
        if changed and self._last_debug is not None:
            self._last_debug.setdefault("caps_applied", True)
        return capped

    def _blend_with_nt_prior(
        self,
        donor_party: str,
        vector: np.ndarray,
        confidence: float,
    ) -> np.ndarray:
        """Blend the predicted distribution with historic NT rates."""

        if vector.size == 0:
            return vector

        donor_key = self._norm_key(donor_party)
        nt_target = None
        if hasattr(self, "nt_rate_by_party"):
            nt_target = getattr(self, "nt_rate_by_party", {}).get(donor_key)
        if (nt_target is None or nt_target <= 0) and getattr(self, "nt_rate_global", 0.0) > 0:
            nt_target = float(getattr(self, "nt_rate_global", 0.0))

        if nt_target is None or nt_target <= 0:
            share_nt = self._share_nt_rate(donor_key)
            if share_nt is not None and share_nt > 0:
                nt_target = share_nt

        if nt_target is None or nt_target <= 0:
            return vector

        nt_target = float(np.clip(nt_target, 1e-6, 0.95))

        surv = vector[:-1]
        nt_val = float(vector[-1])

        # If the current prediction is already close to the empirical NT rate,
        # avoid extra smoothing.
        if abs(nt_val - nt_target) <= max(0.05 * nt_target, 1e-6):
            return vector

        # Build a target distribution that honours the empirical NT rate while
        # preserving the relative survivor ratios when possible.
        if surv.size > 0:
            surv_total = float(surv.sum())
            if surv_total <= 0:
                surv_ratio = np.full_like(surv, 1.0 / float(max(len(surv), 1)))
            else:
                surv_ratio = surv / surv_total
            target_surv = surv_ratio * (1.0 - nt_target)
        else:
            target_surv = surv

        target_vec = np.concatenate([
            target_surv,
            np.asarray([nt_target], dtype=float),
        ])

        # Confidence is in [0, 1]; scale the effective sample size so that
        # confident predictions resist the shrinkage while uncertain ones lean
        # heavily on the empirical prior.
        prior_mass = 2.5
        base_mass = max(confidence * 10.0, 1e-6)
        
        # Ensure dimensions match for blending
        if vector.size != target_vec.size:
            # If dimensions don't match, return original vector without blending
            if self._last_debug is not None:
                self._last_debug["nt_dimension_mismatch"] = True
                self._last_debug["vector_size"] = vector.size
                self._last_debug["target_vec_size"] = target_vec.size
            return vector
        
        blended = (vector * base_mass + target_vec * prior_mass) / (base_mass + prior_mass)

        if self._last_debug is not None:
            self._last_debug.setdefault("nt_prior", nt_target)
            self._last_debug.setdefault("nt_prior_mass", prior_mass)

        return blended

    def _share_nt_rate(self, donor_key: str) -> Optional[float]:
        """Return NT rate derived from share priors when available."""

        if not getattr(self, "share_prior", None):
            return None

        if donor_key in self._share_nt_cache:
            cached = self._share_nt_cache[donor_key]
            return cached if cached > 0 else None

        nt_num = 0.0
        nt_den = 0.0
        entries = self.share_prior.get(donor_key, {}) if isinstance(self.share_prior, dict) else {}
        for counts, total in entries.values():
            try:
                total_f = float(total)
            except (TypeError, ValueError):
                continue
            if total_f <= 0:
                continue
            nt_num += float(counts.get("NonTransferable", 0.0))
            nt_den += total_f

        rate = None
        if nt_den > 0:
            rate = max(0.0, min(0.95, nt_num / nt_den))
        else:
            if self._share_nt_global is None:
                nt_g = 0.0
                den_g = 0.0
                if isinstance(self.share_prior_global, dict):
                    for counts, total in self.share_prior_global.values():
                        try:
                            total_f = float(total)
                        except (TypeError, ValueError):
                            continue
                        if total_f <= 0:
                            continue
                        nt_g += float(counts.get("NonTransferable", 0.0))
                        den_g += total_f
                self._share_nt_global = (
                    max(0.0, min(0.95, nt_g / den_g)) if den_g > 0 else 0.0
                )
            if self._share_nt_global and self._share_nt_global > 0:
                rate = float(self._share_nt_global)

        self._share_nt_cache[donor_key] = float(rate) if rate is not None else 0.0
        return rate

    @staticmethod
    def _norm_key(value: Optional[str]) -> str:
        if value is None:
            return ""
        return str(value)

    def _pick_counts_row(
        self,
        donor_party: str,
        recip_parties: List[str],
        etype: Optional[str],
        body: Optional[str],
        stage: Optional[str],
        include_stage_only: bool = True,
    ) -> Tuple[Optional[np.ndarray], float, str]:
        """Return the best available historic count vector for the given context."""

        donor_key = self._norm_key(donor_party)
        et_key = self._norm_key(etype)
        body_key = self._norm_key(body)
        stage_key = self._norm_key(stage)

        contexts: List[Tuple[str, Optional[Dict[str, float]]]] = []
        if stage_key:
            contexts.append(
                (
                    "type_body_stage",
                    self.counts_type_body_stage
                    .get((et_key, body_key, stage_key), {})
                    .get(donor_key),
                )
            )
        contexts.append(
            (
                "type_body",
                self.counts_type_body.get((et_key, body_key), {}).get(donor_key),
            )
        )
        if stage_key and include_stage_only:
            contexts.append(
                (
                    "type_stage",
                    self.counts_stage.get(stage_key, {}).get(donor_key),
                )
            )
        contexts.append(("type", self.counts_type.get(et_key, {}).get(donor_key)))
        contexts.append(("party", self.counts_party.get(donor_key)))
        contexts.append(("global", self.counts_global or None))

        stage_sparse_threshold = 0.7
        stage_contexts = {"type_body_stage", "type_stage"}

        def _coerce_counts(values: Optional[Dict[str, float]]) -> Dict[str, float]:
            mapping: Dict[str, float] = {}
            if not values:
                return mapping
            if isinstance(values, dict):
                source_iter = values.items()
            else:
                try:
                    source_iter = dict(values).items()
                except Exception:
                    source_iter = []
            for dest, val in source_iter:
                key = str(dest)
                try:
                    mapping[key] = float(val)
                except (TypeError, ValueError):
                    continue
            return mapping

        def _sum_survivors(values: Dict[str, float]) -> float:
            return float(sum(float(values.get(rp, 0.0)) for rp in recip_parties))

        def _log_sparse_skip(
            context: str,
            coverage: float,
            survivor_total: float,
            donor_total: float,
            *,
            reason: Optional[str] = None,
            reference_context: Optional[str] = None,
            reference_total: Optional[float] = None,
        ) -> None:
            if self._last_debug is None:
                return
            entry = {
                "context": context,
                "coverage": float(coverage),
                "survivor_total": float(survivor_total),
                "donor_total": float(donor_total),
            }
            if reason:
                entry["reason"] = reason
            if reference_context:
                entry["reference_context"] = reference_context
            if reference_total is not None:
                entry["reference_survivor_total"] = float(reference_total)
                if reference_total > 0:
                    entry["reference_ratio"] = float(survivor_total / reference_total)
            skipped = self._last_debug.setdefault("counts_sparse_skipped", [])
            skipped.append(entry)
            if reference_context:
                ref_log = self._last_debug.setdefault("counts_sparse_reference", [])
                ref_log.append(entry.copy())

        for name, row in contexts:
            if not row:
                continue
            mapping = _coerce_counts(row)

            vec = np.asarray([float(mapping.get(rp, 0.0)) for rp in recip_parties], dtype=float)
            total = float(vec.sum())
            donor_total = float(sum(mapping.values())) if mapping else 0.0
            if donor_total > 0:
                coverage = float(total / donor_total)
                coverage = float(max(0.0, min(1.0, coverage)))
            else:
                coverage = 1.0 if total > 0 else 0.0

            if (
                name in stage_contexts
                and donor_total > 0
                and coverage < stage_sparse_threshold
            ):
                _log_sparse_skip(
                    name,
                    coverage,
                    total,
                    donor_total,
                    reason="low_stage_coverage",
                )
                continue

            if name == "type_body_stage":
                reference_name = "type_body"
                reference_row = self.counts_type_body.get((et_key, body_key), {}).get(donor_key)
            elif name == "type_stage":
                reference_name = ""
                reference_row = None
                if et_key:
                    reference_row = self.counts_type.get(et_key, {}).get(donor_key)
                    reference_name = "type" if reference_row else ""
                if not reference_row:
                    reference_row = self.counts_party.get(donor_key)
                    if reference_row:
                        reference_name = "party"
            else:
                reference_name = ""
                reference_row = None

            if name in stage_contexts and reference_row:
                ref_mapping = _coerce_counts(reference_row)
                reference_total = _sum_survivors(ref_mapping)
                if (
                    reference_total > 0
                    and total < stage_sparse_threshold * float(reference_total)
                ):
                    _log_sparse_skip(
                        name,
                        coverage,
                        total,
                        donor_total,
                        reason="low_relative_survivor_mass",
                        reference_context=reference_name,
                        reference_total=reference_total,
                    )
                    continue

            if total > 0:
                if self._last_debug is not None:
                    self._last_debug["counts_coverage"] = float(coverage)
                    if donor_total > 0:
                        self._last_debug.setdefault("counts_donor_total", float(donor_total))
                return vec, total, name
        return None, 0.0, ""

    def _lookup_share_prior(
        self,
        donor_party: str,
        recip_parties: List[str],
        first_share: float,
        transfer_share: float,
    ) -> Tuple[Optional[np.ndarray], float, str]:
        bins = getattr(self, "share_bins", _SHARE_BIN_COUNT) or _SHARE_BIN_COUNT
        key = _share_combo_key(first_share, transfer_share, bins=bins)
        if not key:
            return None, 0.0, ""

        donor_dict = self.share_prior.get(self._norm_key(donor_party), {})
        entry = donor_dict.get(key)
        ctx_name = "share_donor" if entry is not None else ""
        if entry is None:
            entry = self.share_prior_global.get(key)
            if entry is not None:
                ctx_name = "share_global"
        if entry is None:
            return None, 0.0, ""
        counts_map, total = entry
        total = float(total)
        if total <= 0:
            return None, 0.0, ""
        vec = np.asarray([float(counts_map.get(rp, 0.0)) for rp in recip_parties], dtype=float)
        if float(vec.sum()) <= 0:
            return None, 0.0, ""
        return vec, total, ctx_name

    def _blend_with_counts(
        self,
        donor_party: str,
        recip_parties: List[str],
        etype: Optional[str],
        body: Optional[str],
        stage: Optional[str],
        donor_first_share: float,
        donor_transfer_share: float,
        base_probs: np.ndarray,
        prior_weight: float,
    ) -> Tuple[np.ndarray, float, Optional[np.ndarray]]:
        """Blend model probabilities with historic count priors.

        Parameters
        ----------
        donor_party, recip_parties, etype, body, stage
            Context identifiers used to locate historic count tables.
        base_probs
            Probability vector produced by the ML model (already normalised and
            optionally including a NonTransferable bucket).
        prior_weight
            Blending weight in ``[0, 1]`` controlling how much mass the historic
            priors contribute.  A value of ``0`` keeps ``base_probs`` unchanged
            while ``1`` fully replaces it with the prior distribution.

        Returns
        -------
        tuple
            ``(blended, lambda, prior_vector)`` where ``lambda`` is the final
            effective prior weight applied after taking donor-strength into
            account and ``prior_vector`` is the normalised prior (``None`` when
            no prior was available).
        """

        if base_probs.size == 0:
            return base_probs, 0.0, None

        counts_vec, total_counts, ctx_name = self._pick_counts_row(
            donor_party, recip_parties, etype, body, stage
        )
        share_vec, share_total, share_ctx = self._lookup_share_prior(
            donor_party, recip_parties, donor_first_share, donor_transfer_share
        )

        if share_vec is not None and share_total > 0:
            if counts_vec is None or total_counts <= 0:
                counts_vec = share_vec
                total_counts = share_total
                ctx_name = share_ctx or ctx_name
            else:
                counts_vec = counts_vec + share_vec
                total_counts = float(total_counts + share_total)
                if share_ctx:
                    ctx_name = f"{ctx_name}+{share_ctx}" if ctx_name else share_ctx
            if self._last_debug is not None and share_ctx:
                self._last_debug.setdefault("share_context", share_ctx)
                self._last_debug.setdefault("share_total", float(share_total))

        if counts_vec is None or total_counts <= 0:
            if self._last_debug is not None:
                if ctx_name:
                    self._last_debug.setdefault("counts_context", ctx_name)
                self._last_debug.setdefault("counts_total", float(total_counts))
                self._last_debug.setdefault("lambda", 0.0)
            return base_probs, 0.0, None

        counts_dist = counts_vec / float(total_counts)
        donor_key = self._norm_key(donor_party)
        et_key = self._norm_key(etype)
        body_key = self._norm_key(body)

        base_sum = float(counts_dist.size and base_probs.sum())
        if base_sum > 0:
            base_dist = base_probs / base_sum
        else:
            base_dist = np.full(
                (base_probs.size,),
                1.0 / float(max(base_probs.size, 1)),
                dtype=float,
            )
        safe_base = np.clip(base_dist.astype(float), 1e-12, 1.0)
        entropy = float(-(safe_base * np.log(safe_base)).sum()) if safe_base.size else 0.0
        max_entropy = float(np.log(safe_base.size)) if safe_base.size > 1 else 0.0
        norm_entropy = 0.0 if max_entropy <= 0 else float(max(0.0, min(1.0, entropy / max_entropy)))
        confidence = float(max(0.0, min(1.0, 1.0 - prior_weight)))

        donor_strength = float(self.donor_strength.get(donor_key, 0.0))
        model_strength = float(getattr(self, "model_strength", 0.0) or 0.0)
        if model_strength <= 0 and donor_strength <= 0:
            model_strength = 1.0
        base_mass = max(model_strength, donor_strength, 1.0)
        automatic_weight = float(total_counts) / float(total_counts + base_mass)
        effective_prior = prior_weight + (1.0 - prior_weight) * automatic_weight
        lam_base = float(np.clip(effective_prior, 0.0, 1.0))

        # When donors have extensive historic coverage we want the workbook priors
        # to dominate regardless of the instantaneous model confidence.  Use a
        # smooth floor that approaches ``1`` as either the contextual counts or
        # the donor's global strength increases.
        count_floor = 0.0
        if total_counts > 0:
            count_floor = 1.0 - float(np.exp(-float(total_counts) / 300.0))
        donor_floor = 0.0
        if donor_strength > 0:
            donor_floor = 1.0 - float(np.exp(-float(donor_strength) / 800.0))
        lambda_floor = max(count_floor, donor_floor)

        if self._last_debug is not None:
            self._last_debug["counts_context"] = ctx_name
            self._last_debug["counts_total"] = float(total_counts)
            self._last_debug.setdefault("counts_vector", counts_dist.tolist())

        conf_thresh = getattr(self, "blend_confidence_threshold", None)
        try:
            conf_thresh_val = float(conf_thresh) if conf_thresh is not None else None
        except (TypeError, ValueError):
            conf_thresh_val = None

        if conf_thresh_val is not None and confidence >= conf_thresh_val:
            if self._last_debug is not None:
                self._last_debug["counts_blend_skipped"] = True
                self._last_debug["counts_confidence"] = confidence
                self._last_debug["counts_entropy"] = norm_entropy
                self._last_debug["lambda"] = 0.0
            return base_probs, 0.0, counts_dist

        ent_thresh = getattr(self, "blend_entropy_threshold", None)
        try:
            ent_thresh_val = float(ent_thresh) if ent_thresh is not None else None
        except (TypeError, ValueError):
            ent_thresh_val = None

        if ent_thresh_val is not None and norm_entropy <= ent_thresh_val:
            if self._last_debug is not None:
                self._last_debug["counts_entropy_skip"] = True
                self._last_debug["counts_confidence"] = confidence
                self._last_debug["counts_entropy"] = norm_entropy
                self._last_debug["lambda"] = 0.0
            return base_probs, 0.0, counts_dist

        confidence_cap = None
        conf_tb = getattr(self, "counts_confidence_type_body", None)
        if isinstance(conf_tb, dict):
            entry = conf_tb.get((et_key, body_key))
            if isinstance(entry, dict):
                confidence_cap = entry.get(donor_key)
        if confidence_cap is None:
            conf_party = getattr(self, "counts_confidence_party", None)
            if isinstance(conf_party, dict):
                confidence_cap = conf_party.get(donor_key)
        if confidence_cap is None:
            conf_global = getattr(self, "counts_confidence_global", None)
            try:
                conf_global_val = float(conf_global) if conf_global is not None else None
            except (TypeError, ValueError):
                conf_global_val = None
            if conf_global_val is not None and conf_global_val > 0:
                confidence_cap = conf_global_val

        lam = max(lam_base, lambda_floor)

        if confidence_cap is not None:
            try:
                cap_val = float(np.clip(confidence_cap, 0.0, 1.0))
            except (TypeError, ValueError):
                cap_val = None
            if cap_val is not None:
                lam = min(lam, cap_val)
                if self._last_debug is not None:
                    self._last_debug["lambda_cap"] = cap_val
                    self._last_debug["counts_confidence_cap"] = cap_val

        min_weight = getattr(self, "min_counts_weight", 0.0) or 0.0
        try:
            min_weight_val = float(np.clip(min_weight, 0.0, 1.0))
        except (TypeError, ValueError):
            min_weight_val = 0.0
        if min_weight_val > 0:
            lam = max(lam, min_weight_val)

        lam = float(np.clip(lam, 0.0, 1.0))
        
        # Ensure dimensions match for blending
        if base_probs.size != counts_dist.size:
            # If dimensions don't match, fall back to base_probs without blending
            if self._last_debug is not None:
                self._last_debug["dimension_mismatch"] = True
                self._last_debug["base_probs_size"] = base_probs.size
                self._last_debug["counts_dist_size"] = counts_dist.size
            return base_probs, 0.0, counts_dist
        
        blended = (1.0 - lam) * base_probs + lam * counts_dist

        if self._last_debug is not None:
            self._last_debug.setdefault("auto_weight", float(automatic_weight))
            self._last_debug["lambda_base"] = lam_base
            self._last_debug["lambda_floor_counts"] = float(count_floor)
            self._last_debug["lambda_floor_donor"] = float(donor_floor)
            self._last_debug["lambda_floor"] = float(lambda_floor)
            self._last_debug["donor_strength"] = donor_strength
            self._last_debug["lambda"] = lam
            self._last_debug["counts_confidence"] = confidence
            self._last_debug["counts_entropy"] = norm_entropy
            self._last_debug["counts_vector"] = counts_dist.tolist()

        return blended, lam, counts_dist

    def expect_proba(self, elim_idx: int, surv_idx: np.ndarray, ctx: Dict[str, Any]) -> np.ndarray:
        self._last_debug = {}
        if surv_idx.size == 0:
            return np.zeros((0,), dtype=float)
        parties = list(ctx.get("party", []))
        donor_party = _clean_party(str(parties[elim_idx] if elim_idx < len(parties) else ""))
        donor_key = self._norm_key(donor_party)
        donor_key = self._norm_key(donor_party)
        constituency = ctx.get("constituency", "")
        body = ctx.get("body", "")
        etype = ctx.get("election_type") or _infer_type_from_body(body)
        count = int(ctx.get("count", 0))
        is_elim = int(ctx.get("is_elimination", 0))
        is_surplus = int(ctx.get("is_surplus", 0))
        prov = ctx.get("prov", None)
        tallies_ctx = ctx.get("tallies", None)
        initial_first = ctx.get("initial_first", None)
        ignore_priors = bool(ctx.get("ignore_priors"))

        thr = None
        try:
            thr = self.stage_thresholds.get((str(etype), str(body)))
        except Exception:
            thr = None
        stage: Optional[str] = None
        if thr is not None:
            try:
                stage = "early" if float(count) <= float(thr) else "late"
            except Exception:
                stage = None

        donor_total = 0.0
        donor_first_share = 0.0
        donor_transfer_share = 0.0
        if isinstance(tallies_ctx, np.ndarray) and tallies_ctx.shape[0] > elim_idx:
            donor_total = float(tallies_ctx[elim_idx])
        if isinstance(initial_first, np.ndarray) and initial_first.shape[0] > elim_idx:
            donor_first = float(initial_first[elim_idx])
            base = donor_total if donor_total > 0 else donor_first
            if base > 0:
                donor_first_share = float(np.clip(donor_first / base, 0.0, 1.0))
                donor_transfer_share = float(max(0.0, 1.0 - donor_first_share))

        rows: List[Dict[str, Any]] = []
        recip_parties: List[str] = []
        don_src = None
        if isinstance(prov, np.ndarray) and prov.ndim == 2 and elim_idx < prov.shape[0]:
            v = prov[elim_idx, :].astype(float)
            vs = float(v.sum()) or 1.0
            don_src = v / vs
        for j in surv_idx.tolist():
            rp = _clean_party(str(parties[j] if j < len(parties) else ""))
            recip_parties.append(rp)
            row = {
                "donor_party": donor_party,
                "recipient_party": rp,
                "constituency": constituency,
                "body": body,
                "etype": etype,
                "count": count,
                "is_elimination": is_elim,
                "is_surplus": is_surplus,
                "bias": 1.0,
            }
            row["don_first_share"] = float(donor_first_share)
            row["don_transfer_share"] = float(donor_transfer_share)

            rec_first_share = 0.0
            rec_transfer_share = 0.0
            if isinstance(tallies_ctx, np.ndarray) and tallies_ctx.shape[0] > j:
                recip_total = float(tallies_ctx[j])
            else:
                recip_total = 0.0
            if isinstance(initial_first, np.ndarray) and initial_first.shape[0] > j:
                recip_first = float(initial_first[j])
            else:
                recip_first = 0.0
            base_rec = recip_total if recip_total > 0 else recip_first
            if base_rec > 0:
                rec_first_share = float(np.clip(recip_first / base_rec, 0.0, 1.0))
                rec_transfer_share = float(max(0.0, 1.0 - rec_first_share))
            row["rec_first_share"] = rec_first_share
            row["rec_transfer_share"] = rec_transfer_share
            row["_rec_total"] = float(recip_total)
            row["_rec_first"] = float(recip_first)
            if don_src is not None and self.pspace is not None:
                for k, p in enumerate(self.pspace.top):
                    row[f"don_src::{p}"] = float(don_src[k])
                row["don_src::OTHER"] = float(don_src[-1])
                alive_mask = ctx.get("alive")
                surv_has = {p: 0 for p in self.pspace.top}
                if isinstance(alive_mask, np.ndarray) and alive_mask.size == len(parties):
                    for i, ap in enumerate(parties):
                        if i == elim_idx:
                            continue
                        if bool(alive_mask[i]):
                            apc = _clean_party(str(ap))
                            if apc in self.pspace.index:
                                surv_has[apc] = 1
                for p in self.pspace.top:
                    row[f"surv_has::{p}"] = int(surv_has.get(p, 0))
            rows.append(row)

        df_rt = pd.DataFrame(rows)

        if hasattr(self.est, "set_context"):
            try:
                self.est.set_context(
                    {
                        "etype": etype,
                        "body": body,
                        "donor_party": donor_party,
                        "stage": stage,
                        "recipients": recip_parties,
                    }
                )
            except Exception:
                pass

        def _apply_party_prior(probs: np.ndarray) -> np.ndarray:
            return self._apply_party_compat(
                donor_party,
                recip_parties,
                donor_first_share,
                donor_transfer_share,
                stage,
                probs,
            )

        def _entropy_confidence(vec: np.ndarray) -> Tuple[float, float]:
            if vec.size == 0:
                return 0.0, 0.0
            if vec.size == 1:
                return 0.0, 1.0
            safe = np.clip(vec.astype(float), 1e-12, 1.0)
            entropy = float(-(safe * np.log(safe)).sum())
            max_entropy = float(np.log(vec.size)) if vec.size > 1 else 0.0
            confidence = 0.0 if max_entropy <= 0 else max(0.0, min(1.0, 1.0 - entropy / max_entropy))
            return entropy, confidence

        self._last_model_source = ""
        self.fallback_confidence = None
        self.fallback_context = None

        score = None
        try:
            dm = self.donor_models.get(donor_party)
            if dm is not None and hasattr(dm, "predict_proba"):
                proba = np.asarray(dm.predict_proba(self.enc.transform(df_rt)), dtype=float)
                rp_series = df_rt["recipient_party"].astype(str).tolist()
                classes = self.donor_classes.get(donor_party, [])
                class_to_idx = {c: i for i, c in enumerate(classes)}
                vals = []
                for i, rp in enumerate(rp_series):
                    j = class_to_idx.get(rp, -1)
                    vals.append(proba[i, j] if (j >= 0 and j < proba.shape[1]) else 0.0)
                score = np.asarray(vals, dtype=float)
                self._last_model_source = "donor_model"
        except Exception:
            score = None

        if score is None:
            try:
                body_key = self._norm_key(body)
                donor_body_key = (body_key, donor_party)
                db_model = self.donor_body_models.get(donor_body_key)
                if db_model is not None and hasattr(db_model, "predict_proba"):
                    proba = np.asarray(db_model.predict_proba(self.enc.transform(df_rt)), dtype=float)
                    rp_series = df_rt["recipient_party"].astype(str).tolist()
                    classes = self.donor_body_classes.get(donor_body_key, [])
                    class_to_idx = {c: i for i, c in enumerate(classes)}
                    vals = []
                    for i, rp in enumerate(rp_series):
                        j = class_to_idx.get(rp, -1)
                        vals.append(proba[i, j] if (j >= 0 and j < proba.shape[1]) else 0.0)
                    score = np.asarray(vals, dtype=float)
                    self._last_model_source = "donor_body_model"
            except Exception:
                score = None

        if score is None:
            try:
                body_key = self._norm_key(body)
                b_model = self.body_models.get(body_key)
                if b_model is not None and hasattr(b_model, "predict_proba"):
                    proba = np.asarray(b_model.predict_proba(self.enc.transform(df_rt)), dtype=float)
                    rp_series = df_rt["recipient_party"].astype(str).tolist()
                    classes = self.body_classes.get(body_key, [])
                    class_to_idx = {c: i for i, c in enumerate(classes)}
                    vals = []
                    for i, rp in enumerate(rp_series):
                        j = class_to_idx.get(rp, -1)
                        vals.append(proba[i, j] if (j >= 0 and j < proba.shape[1]) else 0.0)
                    score = np.asarray(vals, dtype=float)
                    self._last_model_source = "body_model"
            except Exception:
                score = None

        if score is None and hasattr(self.est, "predict_proba") and self.classes_:
            try:
                # Check if we have separate surplus/elimination models
                if hasattr(self.est, 'get_surplus_model') and hasattr(self.est, 'get_elimination_model'):
                    # Use context-aware model selection
                    is_surplus = int(ctx.get("is_surplus", 0))
                    is_elimination = int(ctx.get("is_elimination", 0))
                    
                    if is_surplus and self.est.get_surplus_model() is not None:
                        # Use surplus-specific model
                        proba = np.asarray(self.est.get_surplus_model().predict_proba(self.enc.transform(df_rt)), dtype=float)
                        self._last_model_source = "surplus_model"
                    elif is_elimination and self.est.get_elimination_model() is not None:
                        # Use elimination-specific model
                        proba = np.asarray(self.est.get_elimination_model().predict_proba(self.enc.transform(df_rt)), dtype=float)
                        self._last_model_source = "elimination_model"
                    else:
                        # Fallback to combined model
                        proba = np.asarray(self.est.predict_proba(self.enc.transform(df_rt)), dtype=float)
                        self._last_model_source = "global_model"
                else:
                    # Use regular combined model
                    proba = np.asarray(self.est.predict_proba(self.enc.transform(df_rt)), dtype=float)
                    self._last_model_source = "global_model"
                
                rp_series = df_rt["recipient_party"].astype(str).tolist()
                cols = self.class_index
                vals = []
                for i, rp in enumerate(rp_series):
                    j = cols.get(rp, -1)
                    vals.append(proba[i, j] if (j >= 0 and j < proba.shape[1]) else 0.0)
                score = np.asarray(vals, dtype=float)
                
                if hasattr(self.est, "last_confidence"):
                    try:
                        self.fallback_confidence = float(getattr(self.est, "last_confidence"))
                    except Exception:
                        self.fallback_confidence = None
                if hasattr(self.est, "last_context"):
                    try:
                        self.fallback_context = str(getattr(self.est, "last_context"))
                    except Exception:
                        self.fallback_context = None
            except Exception:
                score = None

        if score is None:
            score = np.asarray(self.est.predict(self.enc.transform(df_rt)), dtype=float)
            self._last_model_source = "global_model"
            if hasattr(self.est, "last_confidence"):
                try:
                    self.fallback_confidence = float(getattr(self.est, "last_confidence"))
                except Exception:
                    self.fallback_confidence = None
            if hasattr(self.est, "last_context"):
                try:
                    self.fallback_context = str(getattr(self.est, "last_context"))
                except Exception:
                    self.fallback_context = None

        score = np.clip(score, 0.0, None)
        s = float(score.sum())
        labels = recip_parties.copy()

        def _weights_from_prior(prior_row: Dict[str, float]) -> np.ndarray:
            buckets: Dict[str, List[int]] = {}
            for idx, rp in enumerate(recip_parties):
                buckets.setdefault(rp, []).append(idx)
            probs = np.zeros(len(rows), dtype=float)
            for rp, idxs in buckets.items():
                if not idxs:
                    continue
                p_val = float(prior_row.get(rp, 0.0))
                if p_val <= 0:
                    continue
                share = p_val / float(len(idxs))
                probs[idxs] = share
            return probs

        def _select_prior() -> Tuple[Optional[np.ndarray], str]:
            candidates: List[Tuple[str, Dict[str, float]]] = []
            if stage:
                prior_tbs = self.priors_by_type_body_stage.get((str(etype), str(body), stage))
                if prior_tbs:
                    row = prior_tbs.get(donor_party)
                    if row:
                        candidates.append(("prior_type_body_stage", row))
            prior_tb = self.priors_by_type_body.get((str(etype), str(body)))
            if prior_tb:
                row = prior_tb.get(donor_party)
                if row:
                    candidates.append(("prior_type_body", row))
            prior_t = getattr(self, "priors_by_type", None)
            if isinstance(prior_t, dict):
                pr = prior_t.get(str(etype))
                if pr:
                    row = pr.get(donor_party)
                    if row:
                        candidates.append(("prior_type", row))
            if self.bloc_of_party and self.prior_bloc:
                b_from = self.bloc_of_party.get(donor_party, -1)
                if b_from >= 0:
                    rowb = self.prior_bloc.get(b_from, {})
                    tmp: Dict[str, float] = {}
                    for rp in recip_parties:
                        bt = self.bloc_of_party.get(rp, -1)
                        if bt >= 0:
                            tmp[rp] = rowb.get(bt, 0.0)
                    candidates.append(("prior_bloc", tmp))
            if self.party_prior:
                row = self.party_prior.get(donor_party)
                if row:
                    candidates.append(("prior_party", row))
            for name, prior_row in candidates:
                if not prior_row:
                    continue
                weights = _weights_from_prior(prior_row)
                total_w = float(weights.sum())
                if total_w > 0:
                    return weights / total_w, name
            return None, ""

        prior_vec: Optional[np.ndarray] = None
        prior_name: str = ""
        if not ignore_priors:
            prior_vec, prior_name = _select_prior()

        if s <= 0.0:
            if rows and donor_party in self.knn_models and self.knn_cols:
                try:
                    base_row = rows[0]
                    ctx_vec = np.asarray(
                        [float(base_row.get(col, 0.0)) for col in self.knn_cols], dtype=float
                    ).reshape(1, -1)
                    if np.isfinite(ctx_vec).all():
                        neigh = self.knn_models[donor_party]
                        distances, indices = neigh.kneighbors(ctx_vec, return_distance=True)
                        dists = distances[0]
                        idxs = indices[0]
                        weights = []
                        for d in dists:
                            if not np.isfinite(d):
                                continue
                            weights.append(1.0 / max(d, 1e-6))
                        if weights:
                            agg: Dict[str, float] = {}
                            for w, idx in zip(weights, idxs):
                                if idx >= len(self.knn_distrib.get(donor_party, [])):
                                    continue
                                for rp, val in self.knn_distrib[donor_party][idx].items():
                                    agg[rp] = agg.get(rp, 0.0) + float(w) * float(val)
                            total_w = float(sum(agg.values()))
                            if total_w > 0:
                                knn_vec = np.asarray(
                                    [float(agg.get(rp, 0.0)) for rp in recip_parties], dtype=float
                                )
                                if knn_vec.sum() > 0:
                                    knn_vec = knn_vec / float(knn_vec.sum())
                                    probs = _apply_party_prior(knn_vec)
                                    entropy, confidence = _entropy_confidence(probs)
                                    self._last_debug = {
                                        "donor_party": donor_party,
                                        "stage": stage,
                                        "entropy": entropy,
                                        "confidence": confidence,
                                        "prior": "knn",
                                        "lambda": 0.0,
                                        "labels": labels,
                                        "base_vector": probs.tolist(),
                                        "final_vector": probs.tolist(),
                                    }
                                    return probs
                except Exception:
                    pass
            if (not ignore_priors) and prior_vec is not None and len(prior_vec):
                probs = _apply_party_prior(prior_vec)
                entropy, confidence = _entropy_confidence(probs)
                self._last_debug = {
                    "donor_party": donor_party,
                    "stage": stage,
                    "entropy": entropy,
                    "confidence": confidence,
                    "prior": prior_name or "prior",
                    "lambda": 1.0,
                    "labels": labels,
                    "base_vector": probs.tolist(),
                    "prior_vector": prior_vec.tolist(),
                    "final_vector": probs.tolist(),
                }
                return probs
            if not ignore_priors:
                counts_vec, total_counts, ctx_name = self._pick_counts_row(
                    donor_party,
                    recip_parties,
                    etype,
                    body,
                    stage,
                )
                if counts_vec is not None and total_counts > 0:
                    distrib = counts_vec / float(total_counts)
                    probs = _apply_party_prior(distrib)
                    entropy, confidence = _entropy_confidence(probs)
                    self._last_debug = {
                        "donor_party": donor_party,
                        "stage": stage,
                        "entropy": entropy,
                        "confidence": confidence,
                        "prior": ctx_name,
                        "lambda": 1.0,
                        "labels": labels,
                        "base_vector": probs.tolist(),
                        "prior_vector": distrib.tolist(),
                        "counts_total": float(total_counts),
                        "final_vector": probs.tolist(),
                    }
                    return probs
            if rows:
                k = float(len(rows))
                uniform = np.full((len(rows),), 1.0 / max(k, 1.0), dtype=float)
                probs = _apply_party_prior(uniform)
                entropy, confidence = _entropy_confidence(probs)
                self._last_debug = {
                    "donor_party": donor_party,
                    "stage": stage,
                    "entropy": entropy,
                    "confidence": confidence,
                    "prior": "uniform",
                    "lambda": 0.0,
                    "labels": labels,
                    "base_vector": probs.tolist(),
                    "final_vector": probs.tolist(),
                }
                return probs
            self._last_debug = {
                "donor_party": donor_party,
                "stage": stage,
                "entropy": 0.0,
                "confidence": 0.0,
                "prior": prior_name or "",
                "lambda": 0.0,
                "labels": labels,
            }
            return np.zeros((0,), dtype=float)

        base_surv = score / s if s > 0 else np.zeros_like(score)
        base_surv = _apply_party_prior(base_surv)
        entropy, confidence = _entropy_confidence(base_surv)
        prior_weight = float(np.clip(1.0 - confidence, 0.0, 1.0))
        self._last_debug = {
            "donor_party": donor_party,
            "stage": stage,
            "entropy": entropy,
            "confidence": confidence,
            "labels": labels,
            "base_vector": base_surv.tolist(),
        }
        if self.fallback_context:
            self._last_debug.setdefault("prior", self.fallback_context)
        if self.fallback_confidence is not None:
            self._last_debug.setdefault("fallback_confidence", float(self.fallback_confidence))

        if ignore_priors:
            self._last_debug.setdefault("raw_vector", base_surv.tolist())
            share_vec: Optional[np.ndarray] = None
            share_total: float = 0.0
            share_ctx: str = ""
            try:
                share_vec, share_total, share_ctx = self._lookup_share_prior(
                    donor_party,
                    recip_parties,
                    donor_first_share,
                    donor_transfer_share,
                )
            except Exception:
                share_vec, share_total, share_ctx = None, 0.0, ""

            if share_vec is not None and share_total > 0:
                # Dirichlet-style shrinkage: treat the learned prior counts as
                # pseudo-observations and blend them with the model output using
                # the entropy-derived confidence as the model strength.  This
                # keeps the behaviour data-driven even when explicit historic
                # priors are disabled.
                prior_mass = float(min(share_total, 25.0))
                if prior_mass > 0:
                    base_mass = float(max(confidence * prior_mass, 1e-6))
                    share_dist = share_vec / float(share_vec.sum() or 1.0)
                    
                    # Ensure dimensions match for blending
                    if base_surv.size != share_dist.size:
                        # If dimensions don't match, skip this blending
                        if self._last_debug is not None:
                            self._last_debug["share_dimension_mismatch"] = True
                            self._last_debug["base_surv_size"] = base_surv.size
                            self._last_debug["share_dist_size"] = share_dist.size
                    else:
                        base_surv = (
                            base_surv * base_mass + share_dist * prior_mass
                        ) / float(base_mass + prior_mass)
                    if share_ctx:
                        self._last_debug.setdefault("share_context", share_ctx)
                        self._last_debug.setdefault("smoothing", share_ctx)
                    self._last_debug.setdefault("share_total", float(share_total))

            self._last_debug.setdefault("lambda", 0.0)
            self._last_debug.setdefault("prior", "")
            p_surv_blended = self._apply_caps(donor_party, recip_parties, base_surv)
            self._last_debug["final_vector"] = p_surv_blended.tolist()
            return p_surv_blended

        blended, lam, counts_vec = self._blend_with_counts(
            donor_party,
            recip_parties,
            etype,
            body,
            stage,
            donor_first_share,
            donor_transfer_share,
            base_surv,
            prior_weight,
        )
        if counts_vec is not None:
            self._last_debug["prior_vector"] = counts_vec.tolist()
            self._last_debug.setdefault("prior", self._last_debug.get("counts_context", ""))
        self._last_debug.setdefault("lambda", lam)

        p_surv_blended = self._apply_caps(donor_party, recip_parties, blended)
        self._last_debug["final_vector"] = p_surv_blended.tolist()
        return p_surv_blended

    def expect_proba_with_nt(self, elim_idx: int, surv_idx: np.ndarray, ctx: Dict[str, Any]) -> Tuple[np.ndarray, float]:
        self._last_debug = {}
        parties = list(ctx.get("party", []))
        donor_party = _clean_party(str(parties[elim_idx] if elim_idx < len(parties) else ""))
        donor_key = self._norm_key(donor_party)

        rows, recip_parties = [], []
        prov = ctx.get("prov", None)
        don_src = None
        if isinstance(prov, np.ndarray) and prov.ndim == 2 and elim_idx < prov.shape[0]:
            v = prov[elim_idx, :].astype(float)
            vs = float(v.sum()) or 1.0
            don_src = v / vs

        constituency = ctx.get("constituency", "")
        body = ctx.get("body", "")
        etype = ctx.get("election_type") or _infer_type_from_body(body)
        count = int(ctx.get("count", 0))
        is_elim = int(ctx.get("is_elimination", 0))
        is_surplus = int(ctx.get("is_surplus", 0))

        tallies_ctx = ctx.get("tallies", None)
        initial_first = ctx.get("initial_first", None)
        ignore_priors = bool(ctx.get("ignore_priors"))

        thr = None
        try:
            thr = self.stage_thresholds.get((str(etype), str(body)))
        except Exception:
            thr = None
        stage: Optional[str] = None
        if thr is not None:
            try:
                stage = "early" if float(count) <= float(thr) else "late"
            except Exception:
                stage = None

        donor_total = 0.0
        donor_first_share = 0.0
        donor_transfer_share = 0.0
        if isinstance(tallies_ctx, np.ndarray) and tallies_ctx.shape[0] > elim_idx:
            donor_total = float(tallies_ctx[elim_idx])
        donor_first = 0.0
        if isinstance(initial_first, np.ndarray) and initial_first.shape[0] > elim_idx:
            donor_first = float(initial_first[elim_idx])
        base_d = donor_total if donor_total > 0 else donor_first
        if base_d > 0:
            donor_first_share = float(np.clip(donor_first / base_d, 0.0, 1.0))
            donor_transfer_share = float(max(0.0, 1.0 - donor_first_share))

        for j in surv_idx.tolist():
            rp = _clean_party(str(parties[j] if j < len(parties) else ""))
            recip_parties.append(rp)
            row = {
                "donor_party": donor_party,
                "recipient_party": rp,
                "constituency": constituency,
                "body": body,
                "etype": etype,
                "count": count,
                "is_elimination": is_elim,
                "is_surplus": is_surplus,
                "bias": 1.0,
            }
            row["don_first_share"] = float(donor_first_share)
            row["don_transfer_share"] = float(donor_transfer_share)

            rec_first_share = 0.0
            rec_transfer_share = 0.0
            if isinstance(tallies_ctx, np.ndarray) and tallies_ctx.shape[0] > j:
                recip_total = float(tallies_ctx[j])
            else:
                recip_total = 0.0
            if isinstance(initial_first, np.ndarray) and initial_first.shape[0] > j:
                recip_first = float(initial_first[j])
            else:
                recip_first = 0.0
            base_rec = recip_total if recip_total > 0 else recip_first
            if base_rec > 0:
                rec_first_share = float(np.clip(recip_first / base_rec, 0.0, 1.0))
                rec_transfer_share = float(max(0.0, 1.0 - rec_first_share))
            row["rec_first_share"] = rec_first_share
            row["rec_transfer_share"] = rec_transfer_share
            if don_src is not None and self.pspace is not None:
                for k, p in enumerate(self.pspace.top):
                    row[f"don_src::{p}"] = float(don_src[k])
                row["don_src::OTHER"] = float(don_src[-1])
                alive_mask = ctx.get("alive")
                surv_has = {p: 0 for p in self.pspace.top}
                if isinstance(alive_mask, np.ndarray) and alive_mask.size == len(parties):
                    for i, ap in enumerate(parties):
                        if i == elim_idx:
                            continue
                        if bool(alive_mask[i]):
                            apc = _clean_party(str(ap))
                            if apc in self.pspace.index:
                                surv_has[apc] = 1
                for p in self.pspace.top:
                    row[f"surv_has::{p}"] = int(surv_has.get(p, 0))
            rows.append(row)

        row_nt = {
            "donor_party": donor_party,
            "recipient_party": "NonTransferable",
            "constituency": constituency,
            "body": body,
            "etype": etype,
            "count": count,
            "is_elimination": is_elim,
            "is_surplus": is_surplus,
            "bias": 1.0,
        }
        row_nt["don_first_share"] = float(donor_first_share)
        row_nt["don_transfer_share"] = float(donor_transfer_share)
        row_nt["rec_first_share"] = 0.0
        row_nt["rec_transfer_share"] = 0.0
        if don_src is not None and self.pspace is not None:
            for k, p in enumerate(self.pspace.top):
                row_nt[f"don_src::{p}"] = float(don_src[k])
            row_nt["don_src::OTHER"] = float(don_src[-1])
            alive_mask = ctx.get("alive")
            surv_has = {p: 0 for p in self.pspace.top}
            if isinstance(alive_mask, np.ndarray) and alive_mask.size == len(parties):
                for i, ap in enumerate(parties):
                    if i == elim_idx:
                        continue
                    if bool(alive_mask[i]):
                        apc = _clean_party(str(ap))
                        if apc in self.pspace.index:
                            surv_has[apc] = 1
            for p in self.pspace.top:
                row_nt[f"surv_has::{p}"] = int(surv_has.get(p, 0))

        def _augment_dyn(rows_block: List[Dict[str, Any]]):
            if not rows_block or self.pspace is None:
                return rows_block
            alive_mask = ctx.get("alive")
            parts = parties
            if isinstance(alive_mask, np.ndarray) and alive_mask.size == len(parts):
                surv_count = {p: 0 for p in self.pspace.top}
                total_surv = 0
                for i, ap in enumerate(parts):
                    if i == elim_idx:
                        continue
                    if bool(alive_mask[i]):
                        total_surv += 1
                        apc = _clean_party(str(ap))
                        if apc in self.pspace.index:
                            surv_count[apc] = surv_count.get(apc, 0) + 1
                total_surv = max(1, total_surv)
                surv_top_share = {p: 0.0 for p in self.pspace.top}
                try:
                    tall = ctx.get("tallies", None)
                    if isinstance(tall, np.ndarray) and tall.size == len(parts):
                        total_alive_tally = float(tall[np.where(alive_mask)[0]].sum())
                        if total_alive_tally <= 0:
                            total_alive_tally = 1.0
                        for p in self.pspace.top:
                            idxs = [
                                ii
                                for ii in range(len(parts))
                                if (ii != elim_idx)
                                and bool(alive_mask[ii])
                                and _clean_party(str(parts[ii])) == p
                            ]
                            top_val = max((float(tall[ii]) for ii in idxs), default=0.0)
                            surv_top_share[p] = float(top_val) / float(total_alive_tally)
                except Exception:
                    pass
                for r in rows_block:
                    for p in self.pspace.top:
                        r[f"surv_count::{p}"] = float(min(3, surv_count.get(p, 0)))
                        r[f"surv_share::{p}"] = float(surv_count.get(p, 0)) / float(total_surv)
                        r[f"surv_top_share::{p}"] = float(surv_top_share.get(p, 0.0))
            return rows_block

        rows = _augment_dyn(rows)
        rows_nt = _augment_dyn([row_nt])

        df_surv = pd.DataFrame(rows)
        df_nt = pd.DataFrame(rows_nt)

        Xs = (
            self.enc.transform(df_surv)
            if len(df_surv)
            else np.zeros((0, len(self.enc.num_cols)), dtype=np.float32)
        )
        Xn = self.enc.transform(df_nt)

        def _predict_block(Xb, df_block):
            if df_block.empty:
                return np.zeros((0,), dtype=float)

            rp = df_block["recipient_party"].astype(str).tolist()

            expected_width: Optional[int] = None
            try:
                n_features = getattr(self.est, "n_features_in_", None)
                if n_features is not None:
                    expected_width = int(n_features)
            except Exception:
                expected_width = None

            if expected_width is None:
                coef = getattr(self.est, "coef_", None)
                if coef is not None:
                    try:
                        expected_width = int(np.asarray(coef).shape[-1])
                    except Exception:
                        expected_width = None

            X_use = Xb
            if (
                expected_width is not None
                and expected_width >= 0
                and Xb.shape[1] != expected_width
            ):
                if Xb.shape[1] > expected_width:
                    X_use = Xb[:, :expected_width]
                else:
                    pad_width = int(expected_width - Xb.shape[1])
                    if pad_width > 0:
                        pad = np.zeros((Xb.shape[0], pad_width), dtype=Xb.dtype)
                        X_use = np.hstack([Xb, pad])

            try:
                if hasattr(self.est, "predict_proba") and hasattr(self, "classes_") and self.classes_:
                    proba = np.asarray(self.est.predict_proba(X_use), dtype=float)
                    cols = self.class_index
                    vals = []
                    for i, lab in enumerate(rp):
                        j = cols.get(lab, -1)
                        vals.append(proba[i, j] if (j >= 0 and j < proba.shape[1]) else 0.0)
                    return np.asarray(vals, dtype=float)
                return np.asarray(self.est.predict(X_use), dtype=float)
            except ValueError as exc:
                logging.getLogger(__name__).warning(
                    "TransferModel prediction failed for %s: %s",
                    donor_party,
                    exc,
                )
                if self._last_debug is not None:
                    self._last_debug.setdefault("model_error", str(exc))

                share_vec_fb: Optional[np.ndarray]
                share_total_fb: float
                share_ctx_fb: str
                try:
                    share_vec_fb, share_total_fb, share_ctx_fb = self._lookup_share_prior(
                        donor_party,
                        recip_parties + ["NonTransferable"],
                        donor_first_share,
                        donor_transfer_share,
                    )
                except Exception:
                    share_vec_fb, share_total_fb, share_ctx_fb = None, 0.0, ""

                labels_all = recip_parties + ["NonTransferable"]
                if share_vec_fb is None or share_total_fb <= 0:
                    share_vec_arr = np.full((len(labels_all),), 1.0 / float(max(len(labels_all), 1)), dtype=float)
                else:
                    share_vec_arr = np.asarray(share_vec_fb, dtype=float)
                    total_fb = float(share_vec_arr.sum()) or 1.0
                    share_vec_arr = share_vec_arr / total_fb

                share_vec_arr = self._blend_with_nt_prior(donor_party, share_vec_arr, 0.0)
                if share_ctx_fb:
                    self._last_debug.setdefault("share_context", share_ctx_fb)
                if share_total_fb > 0:
                    self._last_debug.setdefault("share_total", float(share_total_fb))

                label_index = {lab: idx for idx, lab in enumerate(labels_all)}
                return np.asarray(
                    [
                        share_vec_arr[label_index[lab]]
                        if lab in label_index
                        else 0.0
                        for lab in rp
                    ],
                    dtype=float,
                )

        surv_scores = _predict_block(Xs, df_surv) if len(df_surv) else np.zeros((0,), dtype=float)
        nt_score = float(_predict_block(Xn, df_nt)[0]) if len(df_nt) else 0.0

        surv_scores = np.clip(surv_scores, 0.0, None)
        nt_score = max(0.0, nt_score)
        total = float(nt_score + surv_scores.sum())

        labels = recip_parties + ["NonTransferable"]

        def _entropy_confidence(vec: np.ndarray) -> Tuple[float, float]:
            if vec.size == 0:
                return 0.0, 0.0
            if vec.size == 1:
                return 0.0, 1.0
            safe = np.clip(vec.astype(float), 1e-12, 1.0)
            entropy = float(-(safe * np.log(safe)).sum())
            max_entropy = float(np.log(vec.size)) if vec.size > 1 else 0.0
            confidence = 0.0 if max_entropy <= 0 else max(0.0, min(1.0, 1.0 - entropy / max_entropy))
            return entropy, confidence

        if total <= 0:
            if not ignore_priors:
                counts_vec, total_counts, ctx_name = self._pick_counts_row(
                    donor_party,
                    recip_parties + ["NonTransferable"],
                    etype,
                    body,
                    stage,
                )
                if counts_vec is not None and total_counts > 0:
                    distrib = counts_vec / float(total_counts)
                    entropy, confidence = _entropy_confidence(distrib)
                    self._last_debug = {
                        "donor_party": donor_party,
                        "stage": stage,
                        "entropy": entropy,
                        "confidence": confidence,
                        "prior": ctx_name,
                        "lambda": 1.0,
                        "labels": labels,
                        "base_vector": distrib.tolist(),
                        "counts_total": float(total_counts),
                        "final_vector": distrib.tolist(),
                    }
                    return distrib[:-1], float(distrib[-1])
            k = float(len(labels))
            uniform = np.full((len(labels),), 1.0 / max(k, 1.0), dtype=float)
            p_surv = uniform[:-1]
            p_surv = self._apply_party_compat(
                donor_party,
                recip_parties,
                donor_first_share,
                donor_transfer_share,
                stage,
                p_surv,
            )
            vec = np.concatenate([p_surv, np.asarray([uniform[-1]], dtype=float)])
            entropy, confidence = _entropy_confidence(vec)
            self._last_debug = {
                "donor_party": donor_party,
                "stage": stage,
                "entropy": entropy,
                "confidence": confidence,
                "prior": "uniform",
                "lambda": 0.0,
                "labels": labels,
                "base_vector": vec.tolist(),
                "final_vector": vec.tolist(),
            }
            return vec[:-1], float(vec[-1])

        p_nt = nt_score / total
        p_surv = (surv_scores / total) if surv_scores.sum() > 0 else np.zeros_like(surv_scores)
        p_surv = self._apply_party_compat(
            donor_party,
            recip_parties,
            donor_first_share,
            donor_transfer_share,
            stage,
            p_surv,
        )
        base_vec = np.concatenate([p_surv, np.asarray([p_nt], dtype=float)])
        entropy, confidence = _entropy_confidence(base_vec)
        prior_weight = float(np.clip(1.0 - confidence, 0.0, 1.0))
        self._last_debug = {
            "donor_party": donor_party,
            "stage": stage,
            "entropy": entropy,
            "confidence": confidence,
            "labels": labels,
            "base_vector": base_vec.tolist(),
        }

        if ignore_priors:
            # Even when historic priors are disabled, reuse the donor/party share
            # tables captured during training as a data-driven shrinkage target so
            # the NonTransferable bucket retains realistic mass.
            share_vec_nt: Optional[np.ndarray] = None
            share_total_nt: float = 0.0
            share_ctx_nt: str = ""
            try:
                share_vec_nt, share_total_nt, share_ctx_nt = self._lookup_share_prior(
                    donor_party,
                    recip_parties + ["NonTransferable"],
                    donor_first_share,
                    donor_transfer_share,
                )
            except Exception:
                share_vec_nt, share_total_nt, share_ctx_nt = None, 0.0, ""

            if share_vec_nt is not None and share_total_nt > 0:
                prior_mass = float(min(share_total_nt, 25.0))
                if prior_mass > 0:
                    share_dist_nt = share_vec_nt / float(share_vec_nt.sum() or 1.0)
                    base_mass = float(max(confidence * prior_mass, 1e-6))
                    
                    # Ensure dimensions match for blending
                    if base_vec.size != share_dist_nt.size:
                        # If dimensions don't match, skip this blending
                        if self._last_debug is not None:
                            self._last_debug["share_nt_dimension_mismatch"] = True
                            self._last_debug["base_vec_size"] = base_vec.size
                            self._last_debug["share_dist_nt_size"] = share_dist_nt.size
                    else:
                        base_vec = (
                            base_vec * base_mass + share_dist_nt * prior_mass
                        ) / float(base_mass + prior_mass)
                    if share_ctx_nt:
                        self._last_debug.setdefault("share_context", share_ctx_nt)
                    self._last_debug.setdefault("share_total", float(share_total_nt))

            base_vec = self._blend_with_nt_prior(donor_party, base_vec, confidence)
            self._last_debug.setdefault("lambda", 0.0)
            self._last_debug.setdefault("prior", "")
            p_surv_blended = self._apply_caps(donor_party, recip_parties, base_vec[:-1])
            p_nt_blended = float(base_vec[-1])
        else:
            blended, lam, counts_vec = self._blend_with_counts(
                donor_party,
                recip_parties + ["NonTransferable"],
                etype,
                body,
                stage,
                donor_first_share,
                donor_transfer_share,
                base_vec,
                prior_weight,
            )
            if counts_vec is not None:
                self._last_debug["prior_vector"] = counts_vec.tolist()
                self._last_debug.setdefault("prior", self._last_debug.get("counts_context", ""))
            self._last_debug.setdefault("lambda", lam)

            blended = self._blend_with_nt_prior(donor_party, blended, confidence)
            p_surv_blended = self._apply_caps(donor_party, recip_parties, blended[:-1])
            p_nt_blended = float(blended[-1])
        nt_cap = self.max_pair_share.get((donor_key, "NonTransferable"))
        if nt_cap is not None:
            p_nt_blended = min(p_nt_blended, max(0.0, float(nt_cap)))
        total_final = float(p_surv_blended.sum() + p_nt_blended)
        if total_final > 1.0 + 1e-9:
            scale = 1.0 / total_final
            p_surv_blended = p_surv_blended * scale
            p_nt_blended = p_nt_blended * scale

        if p_nt_blended <= 0.0:
            fallback_nt: Optional[float] = None
            try:
                fallback_nt = getattr(self, "nt_rate_by_party", {}).get(donor_key)
            except Exception:
                fallback_nt = None
            if (fallback_nt is None or fallback_nt <= 0) and getattr(self, "nt_rate_global", 0.0) > 0:
                fallback_nt = float(getattr(self, "nt_rate_global", 0.0))
            if fallback_nt is None or fallback_nt <= 0:
                share_nt = self._share_nt_rate(donor_key)
                if share_nt is not None and share_nt > 0:
                    fallback_nt = share_nt
            if fallback_nt is None or fallback_nt <= 0:
                try:
                    pspace = getattr(self, "pspace", None)
                    if pspace is not None and hasattr(pspace, "exhaust_rate"):
                        fallback_nt = float(pspace.exhaust_rate(elim_idx, ctx))
                except Exception:
                    fallback_nt = None

            if fallback_nt is None or fallback_nt <= 0:
                fallback_nt = 0.02

            if fallback_nt is not None and fallback_nt > 0:
                fallback_nt = float(np.clip(fallback_nt, 1e-6, 0.95))
                surv_sum = float(p_surv_blended.sum())
                target_surv_sum = max(0.0, 1.0 - fallback_nt)
                if p_surv_blended.size > 0:
                    if surv_sum <= 0 and target_surv_sum > 0:
                        p_surv_blended = np.full_like(
                            p_surv_blended,
                            target_surv_sum / float(max(p_surv_blended.size, 1)),
                        )
                    elif surv_sum > 0:
                        p_surv_blended = p_surv_blended * (target_surv_sum / surv_sum)
                p_nt_blended = fallback_nt
                if self._last_debug is not None:
                    self._last_debug.setdefault("nt_fallback", float(fallback_nt))

        self._last_debug["final_vector"] = np.concatenate([p_surv_blended, np.asarray([p_nt_blended])]).tolist()
        return p_surv_blended, p_nt_blended
