"""Party-space utilities for transfer provenance features."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .base import _TOPK_PARTIES, _clean_party, _party_col

__all__ = ["PartySpace"]


class PartySpace:
    """Compact representation of the top-K parties appearing in an election."""

    def __init__(self, top: List[str]):
        self.top = [str(x) for x in top]
        self.index = {p: i for i, p in enumerate(self.top)}
        # Learned NT priors can be attached dynamically by training.
        self.nt_rate_by_party: Dict[str, float] | None = None
        self.nt_rate_global: float | None = None

    @staticmethod
    def from_er(er_df: pd.DataFrame, k: int = _TOPK_PARTIES) -> "PartySpace":
        pcol = _party_col(er_df)
        df = er_df.copy()
        if "ResultType" in df.columns:
            df = df[df["ResultType"].astype(str).str.contains("cand", case=False, na=False)].copy()
        df[pcol] = df[pcol].astype(str).apply(_clean_party)
        df = df[df[pcol].astype(str).str.strip() != ""]
        if "Votes1" in df.columns:
            fpcol = "Votes1"
        else:
            fpcol = "Votes" if "Votes" in df.columns else None
        if fpcol is None:
            top = list(df[pcol].astype(str).value_counts().head(k).index)
        else:
            top = list(
                df.groupby(pcol)[fpcol]
                .sum()
                .sort_values(ascending=False)
                .head(k)
                .index.astype(str)
            )
        return PartySpace(top)

    def vec(self, party: str, amount: float, kdim: Optional[int] = None) -> np.ndarray:
        Pk = kdim if kdim is not None else len(self.top) + 1
        v = np.zeros(Pk, dtype=float)
        i = self.index.get(_clean_party(party), -1)
        if i >= 0:
            v[i] = float(amount)
        else:
            v[-1] = float(amount)
        return v

    def exhaust_rate(self, elim_idx: int, ctx: Dict[str, Any]) -> float:
        """Return the NonTransferable probability for a donor in the cached prior."""
        try:
            parties = list(ctx.get("party", []))
            donor_party = _clean_party(str(parties[elim_idx] if elim_idx < len(parties) else ""))
        except Exception:
            donor_party = ""

        if self.nt_rate_by_party and donor_party in self.nt_rate_by_party:
            r = float(self.nt_rate_by_party[donor_party])
            if r > 0:
                return max(0.0, min(0.95, r))

        if self.nt_rate_global is not None and float(self.nt_rate_global) > 0.0:
            r = float(self.nt_rate_global)
            return max(0.0, min(0.95, r))

        return 0.02
