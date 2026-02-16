# ni_votes/data/loading.py
from __future__ import annotations

from typing import Iterable, Optional, Tuple, List, Dict
import os
import re

import numpy as np
import pandas as pd

try:
    from .. import config as _CONFIG  # type: ignore
except Exception:  # pragma: no cover - config may not be importable in tests
    _CONFIG = None

# -----------------------------
# Utilities
# -----------------------------
def _first_existing_sheet(xl: pd.ExcelFile, candidates: Iterable[str]) -> Optional[str]:
    names = {s.lower(): s for s in xl.sheet_names}
    for c in candidates:
        if c.lower() in names:
            return names[c.lower()]
    return None


def _coerce_numeric(df: pd.DataFrame, cols: Iterable[str]) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


def _to_datestr(v) -> str:
    dt = pd.to_datetime(v, errors="coerce")
    if pd.isna(dt):
        # keep as string if not parseable
        return str(v)
    return dt.strftime("%Y-%m-%d")


# -----------------------------
# Public loaders
# -----------------------------
def load_election_results(xl: pd.ExcelFile) -> pd.DataFrame:
    """
    Load the 'ElectionResults' worksheet (or a close variant) and normalise a few key columns:
      - ensure 'DateStr' exists (YYYY-MM-DD)
      - try to ensure candidate/result rows are accessible via:
          'ResultType' (e.g. 'Candidate', 'Party', 'Totals', 'Spoiled')
          'Name usually known by' (candidate display name / option label)
          'Party Name' (party label)
          'Votes1' (numeric votes column)
      - pass through other columns verbatim.
    """
    sheet = _first_existing_sheet(
        xl,
        [
            "ElectionResults",
            "Election Results",
            "Results",
            "ER",
        ],
    )
    if sheet is None:
        raise FileNotFoundError("Could not find an 'ElectionResults' sheet in the workbook.")

    df = xl.parse(sheet)
    # Normalise common columns
    if "DateStr" not in df.columns:
        date_col = "Date" if "Date" in df.columns else None
        if date_col:
            df["DateStr"] = df[date_col].apply(_to_datestr)
        else:
            # fallback: try to extract from any column named like 'Date*'
            date_like = next((c for c in df.columns if re.search(r"^date", str(c), flags=re.I)), None)
            df["DateStr"] = df[date_like].apply(_to_datestr) if date_like else ""

    # Standard numeric columns often used by the rest of the code
    numeric_candidates = [
        "Votes1", "Votes", "Electorate", "Electorate1",
        "TotalElectorate", "Spoiled", "Rejected", "Invalid",
    ]
    df = _coerce_numeric(df, numeric_candidates)

    # Make sure the fields we search against exist (string type)
    for cc in ["Event", "ElectedBody", "ResultType", "Constituency", "Name usually known by", "Party Name", "Party"]:
        if cc not in df.columns:
            df[cc] = ""
        df[cc] = df[cc].astype(str)

    # If 'PersonID' is missing, create a placeholder
    if "PersonID" not in df.columns:
        df["PersonID"] = np.nan

    return df


def _transfers_sheet_candidates() -> List[str]:
    """Return the preferred worksheet order for transfer data."""

    default = ["Transfers", "STV Transfers", "Counts", "Transfer"]

    if _CONFIG is not None:
        order = getattr(_CONFIG, "TRANSFERS_SHEET_ORDER", None)
        if order:
            seen: List[str] = []
            for name in order:
                if name and name not in seen:
                    seen.append(str(name))
            return seen
    # If no explicit order, prefer an adjusted sheet when present but fall back
    # to the historical names.
    candidates = ["AdjustedTransfers", *default, "Adjusted Transfers"]
    seen: List[str] = []
    for name in candidates:
        if name and name not in seen:
            seen.append(name)
    return seen


def load_transfers_sheet(xl: pd.ExcelFile) -> pd.DataFrame:
    """
    Load the 'Transfers' sheet (or close variant). Expected columns (with flexibility):
      - DateStr / Date
      - Constituency
      - ElectedBody
      - ResultType (Candidate / Party / etc.)
      - PersonID (for candidate rows)
      - Count (round number)
      - Transfers (signed amount; negative from donors, positive to recipients)
    Any missing fields are added with safe defaults.
    """
    sheet = _first_existing_sheet(xl, _transfers_sheet_candidates())
    if sheet is None:
        # Not all workbooks have transfers
        return pd.DataFrame()

    df = xl.parse(sheet)

    # Dates
    if "DateStr" not in df.columns:
        dcol = "Date" if "Date" in df.columns else None
        df["DateStr"] = df[dcol].apply(_to_datestr) if dcol else ""

    # Coerce numeric where appropriate
    for c in ["Count", "Transfers", "Votes1", "Votes"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # Ensure common string columns exist
    for c in ["ResultType", "Constituency", "ElectedBody", "Party", "Party Name"]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].astype(str)

    # PersonID
    if "PersonID" not in df.columns:
        df["PersonID"] = np.nan

    return df


def _normalise_endorsed(value: str) -> str:
    """
    Try to fold various free-text endorsements into a small, consistent set
    (e.g., 'Yes', 'No', 'Remain', 'Leave', 'Did not vote').
    """
    s = str(value or "").strip().lower()
    if s in {"yes", "y"}:
        return "Yes"
    if s in {"no", "n"}:
        return "No"
    if "remain" in s:
        return "Remain"
    if "leave" in s:
        return "Leave"
    if re.search(r"(did\s*not\s*vote|dnv|abstain)", s):
        return "Did not vote"
    # fall back to capitalised original
    return value if isinstance(value, str) else str(value)


def load_endorsements(xl: pd.ExcelFile) -> pd.DataFrame:
    """
    Load endorsements (if present). Expected flexible columns:
     - DateStr / Date
     - ElectedBody / ReferendumName / Body / PollName  (-> BodyKey)
     - Party
     - Endorsed (free text) -> EndorsedClean via rules above
    """
    sheet = _first_existing_sheet(
        xl,
        ["Endorsements", "Referendum Endorsements", "Endorsement"],
    )
    if sheet is None:
        return pd.DataFrame()

    df = xl.parse(sheet)

    # Date
    if "DateStr" not in df.columns:
        dcol = "Date" if "Date" in df.columns else None
        df["DateStr"] = df[dcol].apply(_to_datestr) if dcol else ""

    # BodyKey
    if "BodyKey" not in df.columns:
        body_col = None
        for c in ["ElectedBody", "ReferendumName", "Body", "PollName"]:
            if c in df.columns:
                body_col = c
                break
        df["BodyKey"] = df[body_col].astype(str) if body_col else ""

    # Standardise strings
    for c in ["Party", "Endorsed"]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].astype(str)

    df["EndorsedClean"] = df["Endorsed"].map(_normalise_endorsed)

    return df

# ---- ML table loaders (SourceGroups, EventEdges, LocalCompositions, CandidateSnapshots) ----

def _pick_sheet(xl: pd.ExcelFile, *candidates: str) -> Optional[str]:
    names = {s.lower(): s for s in xl.sheet_names}
    for c in candidates:
        if c.lower() in names:
            return names[c.lower()]
    return None

def load_ml_tables_from_excel(xl_path: str) -> Dict[str, pd.DataFrame]:
    # Ultra-fast cache check first
    from .excel_cache import get_cached_excel_data, cache_excel_data
    
    cached_data = get_cached_excel_data(xl_path)
    if cached_data is not None:
        # Return cached data instantly
        return cached_data
    
    # Not in cache - load and cache for future use
    xl = pd.ExcelFile(xl_path)
    out: Dict[str, pd.DataFrame] = {}
    sheet = _pick_sheet(xl, "SourceGroups", "Source Groups")
    if sheet:
        out["SourceGroups"] = xl.parse(sheet)
    sheet = _pick_sheet(xl, "EventEdges", "ProvenanceEdges", "Edges")
    if sheet:
        out["EventEdges"] = xl.parse(sheet)
    sheet = _pick_sheet(xl, "LocalCompositions", "Local Compositions")
    if sheet:
        out["LocalCompositions"] = xl.parse(sheet)
    sheet = _pick_sheet(xl, "CandidateSnapshots", "Candidate State Per Count", "Snapshots")
    if sheet:
        out["CandidateSnapshots"] = xl.parse(sheet)
    sheet = _pick_sheet(
        xl,
        "Transfers",
        "MLTransfers",
        "Transfers_with_SourcePersonID",
    )
    if sheet:
        out["Transfers"] = xl.parse(sheet)
    
    # Cache for ultra-fast future access
    cache_excel_data(xl_path, out)
    return out

def load_ml_tables_from_csv(
    sg_csv: str | None, ee_csv: str | None, lc_csv: str | None, cs_csv: str | None
) -> Dict[str, pd.DataFrame]:
    out: Dict[str, pd.DataFrame] = {}
    if sg_csv and os.path.exists(sg_csv): out["SourceGroups"] = pd.read_csv(sg_csv)
    if ee_csv and os.path.exists(ee_csv): out["EventEdges"] = pd.read_csv(ee_csv)
    if lc_csv and os.path.exists(lc_csv): out["LocalCompositions"] = pd.read_csv(lc_csv)
    if cs_csv and os.path.exists(cs_csv): out["CandidateSnapshots"] = pd.read_csv(cs_csv)
    return out

def load_ml_tables_any(xl_path: str | None, cfg) -> Dict[str, pd.DataFrame]:
    """
    Try CSV paths from config first; if missing, fall back to sheets in the workbook.
    """
    from .. import config as _CFG  # tolerant import style across your app
    try:
        sg = getattr(_CFG, "SOURCE_GROUPS_CSV", None)
        ee = getattr(_CFG, "EVENT_EDGES_CSV", None)
        lc = getattr(_CFG, "LOCAL_COMPOSITIONS_CSV", None)
        cs = getattr(_CFG, "CANDIDATE_SNAPSHOTS_CSV", None)
    except Exception:
        sg = ee = lc = cs = None

    got = load_ml_tables_from_csv(sg, ee, lc, cs)
    if got:
        return got

    if xl_path and os.path.exists(xl_path):
        tables = load_ml_tables_from_excel(xl_path)
        if tables:
            return tables

    # Allow an explicit workbook path (``ML_TABLE_XLSX``) or fall back to the
    # bundled transfers-with-source IDs workbook when present in the project.
    alt_path = getattr(cfg, "ML_TABLE_XLSX", None)
    candidates: List[str] = []
    if isinstance(alt_path, str) and alt_path:
        candidates.append(alt_path)
    pkg_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates.append(os.path.join(pkg_root, "Transfers_with_SourcePersonID.xlsx"))
    candidates.append(os.path.join(os.getcwd(), "Transfers_with_SourcePersonID.xlsx"))
    for path in candidates:
        if path and os.path.exists(path):
            tables = load_ml_tables_from_excel(path)
            if tables:
                return tables

    return {}
