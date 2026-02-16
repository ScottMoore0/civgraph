from __future__ import annotations
import json
from typing import List, Dict, Any, Optional
from pathlib import Path

import pandas as pd
from flask import Flask

# Config import — tolerate both styles
try:
    from ..config import CFG, REFERENDUM_TYPES
except Exception:
    from .. import config as CFG            # type: ignore
    REFERENDUM_TYPES = getattr(CFG, "REFERENDUM_TYPES", ["Referendum", "RecallPetition"])

from ..data.loading import load_ml_tables_any
from .transfer_data import build_transfer_event_lookup

from ..data_loading import load_endorsements
from ..project.referendum import (
    filter_referendum_rows,
    infer_body_options,
)
from ..features.endorsements import build_endorsement_history, normalize_party_key
from ..utils import to_date_str

# Data loaders — keep names matching your repo
try:
    from ..data.loading import load_election_results, load_transfers_sheet
except Exception:
    from ..data.load import load_election_results  # fallback
    def load_transfers_sheet(xl) -> pd.DataFrame:
        order = getattr(CFG, "TRANSFERS_SHEET_ORDER", ("Transfers",))
        for sheet in order:
            try:
                return pd.read_excel(xl, sheet)
            except Exception:
                continue
        # Fallback to legacy name variants
        for sheet in ("AdjustedTransfers", "Transfers", "STV Transfers", "Counts", "Transfer"):
            try:
                return pd.read_excel(xl, sheet)
            except Exception:
                continue
        return pd.DataFrame()

# Keys for app.config
CFG_ER_DF = "ER_DF"
CFG_TR_DF = "TR_DF"
CFG_CONSTS = "CONST_ITEMS"
CFG_PARTIES = "PARTIES"
CFG_PARTY_METADATA = "PARTY_METADATA"
CFG_CANDIDATES = "CANDIDATES"
CFG_IMPORT_KEYS = "IMPORT_KEYS"
CFG_ELECTION_TYPES = "ELECTION_TYPES"
CFG_ELECTED_BODIES = "ELECTED_BODIES"
CFG_TR_EVENTS = "TR_EVENTS"
CFG_TR_DEST = "TR_DESTINATIONS"
CFG_TR_SOURCES = "TR_SOURCES"
CFG_TR_LOOKUP = "TR_LOOKUP"
CFG_TRANSFER_WORKBOOK = "TRANSFER_WORKBOOK"
CFG_TRANSFER_WORKBOOK_ERROR = "TRANSFER_WORKBOOK_ERROR"
CFG_ENDORSEMENTS = "ENDORSEMENTS"
CFG_ENDORSEMENT_HISTORY = "ENDORSEMENT_HISTORY"
CFG_REFERENDUM_BODIES = "REFERENDUM_BODIES"


def _pick_sheet(xl: pd.ExcelFile, *candidates: str) -> str | None:
    if not isinstance(xl, pd.ExcelFile):
        return None
    names = {str(name).strip().casefold(): name for name in xl.sheet_names}
    for candidate in candidates:
        if not candidate:
            continue
        key = str(candidate).strip().casefold()
        if key in names:
            return names[key]
    return None

def _list_constituencies(df: pd.DataFrame) -> List[str]:
    if df is None or df.empty:
        return []
    cons = sorted(set(str(c).strip() for c in df.get("Constituency", [])))
    return [c for c in cons if c]

def _list_parties(df: pd.DataFrame) -> List[str]:
    if df is None or df.empty:
        return []
    src = df.get("Party Name", None)
    if src is None:
        src = df.get("Party", [])
    parties = sorted(set(str(c).strip() for c in src))
    return [p for p in parties if p]


def _build_party_metadata(er_df: pd.DataFrame, endorsements: Optional[pd.DataFrame]) -> List[Dict[str, Any]]:
    meta: Dict[str, Dict[str, Any]] = {}

    if isinstance(er_df, pd.DataFrame) and not er_df.empty:
        df = er_df.copy()
        if "DateStr" not in df.columns:
            df["DateStr"] = pd.to_datetime(df.get("Date", ""), errors="coerce").dt.strftime("%Y-%m-%d")
        df["DateTS"] = pd.to_datetime(df.get("DateStr"), errors="coerce")
        party_col = "Party Name" if "Party Name" in df.columns else ("Party" if "Party" in df.columns else None)
        if party_col:
            candidates = df[df.get("ResultType", "").astype(str).str.lower().eq("candidate")].copy()
            if not candidates.empty:
                candidates = candidates[[party_col, "DateTS"]].dropna(subset=[party_col])
                for _, row in candidates.iterrows():
                    name = str(row.get(party_col, "")).strip()
                    if not name:
                        continue
                    key = normalize_party_key(name)
                    entry = meta.setdefault(key, {"name": name, "last_active": None})
                    ts = row.get("DateTS")
                    if isinstance(ts, pd.Timestamp) and not pd.isna(ts):
                        date_str = ts.strftime("%Y-%m-%d")
                        if entry["last_active"] is None or date_str > entry["last_active"]:
                            entry["last_active"] = date_str
                            entry["name"] = name

    if isinstance(endorsements, pd.DataFrame) and not endorsements.empty:
        en = endorsements.copy()
        en["DateStr"] = en.get("DateStr", en.get("Date", pd.Series("", index=en.index))).apply(to_date_str)
        en["DateTS"] = pd.to_datetime(en["DateStr"], errors="coerce")
        for _, row in en.iterrows():
            name = str(row.get("Party", "")).strip()
            if not name:
                continue
            key = normalize_party_key(name)
            entry = meta.setdefault(key, {"name": name, "last_active": None})
            ts = row.get("DateTS")
            if isinstance(ts, pd.Timestamp) and not pd.isna(ts):
                date_str = ts.strftime("%Y-%m-%d")
                if entry["last_active"] is None or date_str > entry["last_active"]:
                    entry["last_active"] = date_str
                    entry["name"] = name

    ordered = sorted(meta.values(), key=lambda item: item["name"].lower())
    return ordered


def _list_elected_bodies(df: pd.DataFrame) -> List[str]:
    if df is None or df.empty:
        return []
    bodies = sorted(set(str(c).strip() for c in df.get("ElectedBody", [])))
    return [b for b in bodies if b]

def _list_candidates(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Unique candidates by PersonID (exclude rows with missing PersonID)."""
    if df is None or df.empty:
        return []
    cand = df[df.get("ResultType", "").astype(str).str.lower().eq("candidate")].copy()
    if cand.empty or "PersonID" not in cand.columns:
        return []
    cand["PersonID"] = pd.to_numeric(cand["PersonID"], errors="coerce")
    cand = cand[cand["PersonID"].notna()].copy()
    # Prefer nicer columns when available
    name_col = "Name usually known by" if "Name usually known by" in cand.columns else ("Name" if "Name" in cand.columns else None)
    party_col = "Party Name" if "Party Name" in cand.columns else ("Party" if "Party" in cand.columns else None)
    if name_col is None:
        name_col = "Name"; cand["Name"] = cand.get("Name", "").astype(str)
    if party_col is None:
        party_col = "Party"; cand["Party"] = cand.get("Party", "").astype(str)
    # De-dup by PersonID
    cand = cand.sort_values(["PersonID"]).drop_duplicates(subset=["PersonID"], keep="first")
    out: List[Dict[str, Any]] = []
    for _, r in cand.iterrows():
        out.append({
            "id": int(r["PersonID"]),
            "name": str(r.get(name_col, "")).strip(),
            "party": str(r.get(party_col, "")).strip(),
        })
    return out


def _list_election_types(df: pd.DataFrame) -> List[str]:
    """Return distinct election types, preferring EventType column; else infer from ElectedBody."""
    if df is None or df.empty:
        return []
    types: List[str] = []
    if "EventType" in df.columns:
        vals = df["EventType"].astype(str).str.strip()
        types = sorted({v for v in vals if v})
    else:
        def infer(s: str) -> str:
            sl = str(s or "").lower()
            if "assembly" in sl: return "Assembly"
            if "house of commons" in sl or "westminster" in sl: return "Westminster"
            if "european" in sl: return "European Parliament"
            if "council" in sl or "local" in sl: return "Local"
            return "Other"
        vals = df.get("ElectedBody", pd.Series([], dtype="object")).astype(str)
        types = sorted({infer(x) for x in vals})
    return [t for t in types if t]

def _list_import_keys(er_df: pd.DataFrame) -> List[Dict[str, str]]:
    """
    Return a simplified list of constituency sets based on specific historical eras.
    """
    if er_df is None or er_df.empty:
        return []
        
    # Define the target eras and their reference elections
    targets = [
        {
            "label": "2024- (18 constituencies)",
            "criteria": {"Constituency": "West Tyrone", "DateStr": "2024-07-04"} 
        },
        {
            "label": "1995-2024 (18 constituencies)",
            "criteria": {"Constituency": "West Tyrone", "DateStr": "2022-05-05"}
        },
        {
            "label": "1983-1995 (17 constituencies)",
            "criteria": {"Constituency": "Mid Ulster", "DateStr": "1983-06-09"}
        },
        {
            "label": "1950-1983 (12 constituencies)",
            "criteria": {"Constituency": "Mid Ulster", "DateStr": "1979-05-03"}
        }
    ]
    
    df = er_df.copy()
    if "DateStr" not in df.columns:
        df["DateStr"] = pd.to_datetime(df.get("Date", ""), errors="coerce").dt.strftime("%Y-%m-%d")
        
    rows = []
    for target in targets:
        # Find a matching row to get the exact Body and Date
        mask = pd.Series(True, index=df.index)
        for col, val in target["criteria"].items():
            mask &= (df[col].astype(str) == val)
            
        match = df[mask]
        if not match.empty:
            row = match.iloc[0]
            key = {
                "date": str(row["DateStr"]),
                "constituency": str(row["Constituency"]),
                "elected_body": str(row["ElectedBody"])
            }
            rows.append({"value": json.dumps(key), "label": target["label"]})
            
    return rows


def _list_referendums(er_df: pd.DataFrame, endorsements: pd.DataFrame) -> List[Dict[str, Any]]:
    """Return metadata for referendum-style bodies present in results or endorsements."""

    items: Dict[str, Dict[str, Any]] = {}

    def _normalise(value: Any) -> str:
        text = str(value or "").strip()
        return text

    def _touch(body_key: str, label: str, date: str | None) -> None:
        if not body_key:
            return
        entry = items.setdefault(
            body_key,
            {"body_key": body_key, "label": label or body_key, "dates": set()},
        )
        if label and not entry.get("label"):
            entry["label"] = label
        if date:
            entry["dates"].add(date)

    if isinstance(er_df, pd.DataFrame) and not er_df.empty:
        try:
            ref_df = filter_referendum_rows(er_df)
        except Exception:
            ref_df = pd.DataFrame()
        if not ref_df.empty:
            for _, row in ref_df.iterrows():
                body = _normalise(
                    row.get("GroupBody")
                    or row.get("ElectedBody")
                    or row.get("Event")
                )
                label = _normalise(row.get("ElectedBody") or row.get("Event") or body)
                date = _normalise(row.get("DateStr") or row.get("Date"))
                _touch(body, label, date)

    if isinstance(endorsements, pd.DataFrame) and not endorsements.empty:
        en = endorsements.copy()
        if "BodyKey" not in en.columns:
            body_col = None
            for candidate in ["ElectedBody", "ReferendumName", "Body", "PollName"]:
                if candidate in en.columns:
                    body_col = candidate
                    break
            en["BodyKey"] = en[body_col].astype(str) if body_col else ""
        if "DateStr" not in en.columns:
            if "Date" in en.columns:
                en["DateStr"] = pd.to_datetime(en["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
            else:
                en["DateStr"] = ""
        for _, row in en.iterrows():
            body = _normalise(row.get("BodyKey"))
            label = _normalise(
                row.get("ElectedBody")
                or row.get("Body")
                or row.get("PollName")
                or body
            )
            date = _normalise(row.get("DateStr"))
            _touch(body, label, date)

    output: List[Dict[str, Any]] = []
    for body_key, entry in items.items():
        dates_sorted = sorted(entry.get("dates", []))
        try:
            options = infer_body_options(er_df, endorsements, body_key)
        except Exception:
            options = []
        output.append(
            {
                "body_key": body_key,
                "label": entry.get("label") or body_key,
                "dates": dates_sorted,
                "date_min": dates_sorted[0] if dates_sorted else None,
                "date_max": dates_sorted[-1] if dates_sorted else None,
                "options": options,
            }
        )

    output.sort(key=lambda row: (row["label"].lower(), row["body_key"].lower()))
    return output

def init_data(app: Flask) -> None:
    """Load workbook once; cache useful lists in app.config."""
    print("Loading workbook for web app...", flush=True)
    
    # Ultra-fast Excel preloading
    cached_data = None
    try:
        from ..data.excel_cache import preload_excel_data, get_cached_excel_data
        
        # Preload the main Excel file for ultra-fast access
        if hasattr(CFG, 'INPUT_XLSX') and CFG.INPUT_XLSX:
            # print("[Ultra-Fast Cache] Preloading Excel data...", flush=True)
            preload_excel_data([CFG.INPUT_XLSX])
            cached_data = get_cached_excel_data(CFG.INPUT_XLSX)
            # print("[Ultra-Fast Cache] Excel data preloaded")
    except Exception as e:
        print(f"[Ultra-Fast Cache] Preloading failed: {e}")
    
    if cached_data:
        # Use cached dataframes directly
        er_df = load_election_results_from_cache(cached_data)
        tr_df = load_transfers_sheet_from_cache(cached_data)
        en_df = load_endorsements_from_cache(cached_data)
        
        def get_sheet(name):
            for k in cached_data.keys():
                if k.lower() == name.lower():
                    return cached_data[k]
            return pd.DataFrame()

        tr_events = get_sheet("TransferEvents") 
        if tr_events.empty: tr_events = get_sheet("Transfer Events")
        
        tr_dest = get_sheet("TransferDestinations")
        if tr_dest.empty: tr_dest = get_sheet("Transfer Destinations")
        
        tr_sources = get_sheet("TransferSources")
        if tr_sources.empty: tr_sources = get_sheet("Transfer Sources")
    else:
        # Fallback to slow load
        with pd.ExcelFile(CFG.INPUT_XLSX) as xl:
            er_df = load_election_results(xl)
            tr_df = load_transfers_sheet(xl)
            en_df = load_endorsements(xl)
            events_sheet = _pick_sheet(xl, "TransferEvents", "Transfer Events")
            dest_sheet = _pick_sheet(xl, "TransferDestinations", "Transfer Destinations")
            sources_sheet = _pick_sheet(xl, "TransferSources", "Transfer Sources")
            tr_events = xl.parse(events_sheet) if events_sheet else pd.DataFrame()
            tr_dest = xl.parse(dest_sheet) if dest_sheet else pd.DataFrame()
            tr_sources = xl.parse(sources_sheet) if sources_sheet else pd.DataFrame()

    app.config[CFG_ER_DF] = er_df
    app.config[CFG_TR_DF] = tr_df
    app.config[CFG_ENDORSEMENTS] = en_df
    app.config[CFG_TR_EVENTS] = tr_events
    app.config[CFG_TR_DEST] = tr_dest
    app.config[CFG_TR_SOURCES] = tr_sources
    try:
        transfer_lookup = build_transfer_event_lookup(tr_df)
    except Exception:
        transfer_lookup = {}
    app.config[CFG_TR_LOOKUP] = transfer_lookup
    workbook_path = Path(getattr(CFG, "INPUT_XLSX", "Full election tables.xlsx")).resolve()
    app.config[CFG_TRANSFER_WORKBOOK] = None
    app.config[CFG_TRANSFER_WORKBOOK_ERROR] = None
    app.config.setdefault("TRANSFER_WORKBOOK_PATH", workbook_path)
    # Optional: load ML tables into the app config for routes/UI
    try:
        ml = load_ml_tables_any(getattr(CFG, "INPUT_XLSX", None), CFG)
    except Exception:
        ml = {}
    app.config["ML_TABLES"] = ml  # keys: SourceGroups, EventEdges, LocalCompositions, CandidateSnapshots
    consts = _list_constituencies(er_df)
    if "Northern Ireland" not in consts:
        consts.append("Northern Ireland")
    app.config[CFG_CONSTS] = consts
    app.config[CFG_PARTIES] = _list_parties(er_df)
    app.config[CFG_PARTY_METADATA] = _build_party_metadata(er_df, en_df)
    app.config[CFG_CANDIDATES] = _list_candidates(er_df)
    app.config[CFG_IMPORT_KEYS] = _list_import_keys(er_df)
    app.config[CFG_ELECTION_TYPES] = _list_election_types(er_df)
    bodies = _list_elected_bodies(er_df)
    if "CustomBody" not in bodies:
        bodies.append("CustomBody")
    app.config[CFG_ELECTED_BODIES] = bodies
    try:
        history = build_endorsement_history(en_df) if isinstance(en_df, pd.DataFrame) else {}
    except Exception:
        history = {}
    app.config[CFG_ENDORSEMENT_HISTORY] = history
    app.config[CFG_REFERENDUM_BODIES] = _list_referendums(er_df, en_df)

# --- Cache Helpers ---
def load_election_results_from_cache(data_dict):
    # Mimics load_election_results logic but with pre-loaded dfs
    import re
    import numpy as np
    
    sheet = None
    for k in ["ElectionResults", "Election Results", "Results", "ER"]:
        for key in data_dict.keys():
            if k.lower() == key.lower():
                sheet = key
                break
        if sheet: break
            
    if not sheet: return pd.DataFrame()
    
    df = data_dict[sheet].copy()
    # Normalise logic (simplified from loading.py)
    if "DateStr" not in df.columns:
        date_col = "Date" if "Date" in df.columns else None
        if date_col:
            df["DateStr"] = pd.to_datetime(df[date_col], errors="coerce").dt.strftime("%Y-%m-%d")
            
    numeric_candidates = [
        "Votes1", "Votes", "Electorate", "Electorate1",
        "TotalElectorate", "Spoiled", "Rejected", "Invalid",
    ]
    for c in numeric_candidates:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
            
    for cc in ["Event", "ElectedBody", "ResultType", "Constituency", "Name usually known by", "Party Name", "Party"]:
        if cc not in df.columns: df[cc] = ""
        df[cc] = df[cc].astype(str)
        
    if "PersonID" not in df.columns: df["PersonID"] = np.nan
    return df

def load_transfers_sheet_from_cache(data_dict):
    # Mimics load_transfers_sheet
    import numpy as np
    candidates = ["AdjustedTransfers", "Transfers", "STV Transfers", "Counts", "Transfer", "Adjusted Transfers"]
    sheet = None
    for c in candidates:
        for key in data_dict.keys():
            if c.lower() == key.lower():
                sheet = key
                break
        if sheet: break
        
    if not sheet: return pd.DataFrame()
    
    df = data_dict[sheet].copy()
    if "DateStr" not in df.columns:
        dcol = "Date" if "Date" in df.columns else None
        if dcol: df["DateStr"] = pd.to_datetime(df[dcol], errors="coerce").dt.strftime("%Y-%m-%d")
        
    for c in ["Count", "Transfers", "Votes1", "Votes"]:
        if c in df.columns: df[c] = pd.to_numeric(df[c], errors="coerce")
        
    for c in ["ResultType", "Constituency", "ElectedBody", "Party", "Party Name"]:
        if c not in df.columns: df[c] = ""
        df[c] = df[c].astype(str)
        
    if "PersonID" not in df.columns: df["PersonID"] = np.nan
    return df

def load_endorsements_from_cache(data_dict):
    sheet = None
    for c in ["Endorsements", "Referendum Endorsements", "Endorsement"]:
        for key in data_dict.keys():
            if c.lower() == key.lower():
                sheet = key
                break
        if sheet: break
    
    if not sheet: return pd.DataFrame()
    
    df = data_dict[sheet].copy()
    if "DateStr" not in df.columns:
        dcol = "Date" if "Date" in df.columns else None
        if dcol: df["DateStr"] = pd.to_datetime(df[dcol], errors="coerce").dt.strftime("%Y-%m-%d")
        
    if "BodyKey" not in df.columns:
        body_col = None
        for c in ["ElectedBody", "ReferendumName", "Body", "PollName"]:
            if c in df.columns: body_col = c; break
        df["BodyKey"] = df[body_col].astype(str) if body_col else ""
        
    for c in ["Party", "Endorsed"]:
        if c not in df.columns: df[c] = ""
        df[c] = df[c].astype(str)
        
    # _normalise_endorsed logic inline
    def norm(s):
        s = str(s or "").strip().lower()
        if s in {"yes", "y"}: return "Yes"
        if s in {"no", "n"}: return "No"
        if "remain" in s: return "Remain"
        if "leave" in s: return "Leave"
        if "did not vote" in s or "dnv" in s: return "Did not vote"
        return str(s)
        
    df["EndorsedClean"] = df["Endorsed"].apply(norm)
    return df
