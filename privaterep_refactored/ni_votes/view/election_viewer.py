# ni_votes/view/election_viewer.py

from __future__ import annotations
from typing import Optional, Dict, List, Tuple
import math
import re

import numpy as np
import pandas as pd

from ..utils import to_date_str, normalize_constituency_name


# -------------------------
# Small helpers / formatters
# -------------------------

def _num(v) -> float:
    try:
        return float(v)
    except Exception:
        return 0.0


def _fmt_int(x: float | int | None) -> str:
    if x is None or (isinstance(x, float) and (not math.isfinite(x))):
        return "-"
    return f"{int(round(x)):,}"


def _fmt_2dp(x: float | int | None) -> str:
    if x is None or (isinstance(x, float) and (not math.isfinite(x))):
        return "-"
    return f"{float(x):,.2f}"


def _fmt_delta_2dp(x: float | int | None) -> str:
    if x is None or (isinstance(x, float) and (not math.isfinite(x))):
        return ""
    x = float(x)
    if abs(x) < 0.005:  # show +0.00/-0.00 as 0.00 for neatness
        return "0.00"
    s = "+" if x > 0 else ""
    return f"{s}{x:,.2f}"


def _fmt_pct(x: float | None) -> str:
    if x is None or (isinstance(x, float) and (not math.isfinite(x))):
        return "–"
    return f"{x*100:0.2f}%"


def _name_party(row: pd.Series) -> Tuple[str, str]:
    nm = str(row.get("Name usually known by", row.get("Name", "")) or "").strip()
    party = str(row.get("Party Name", row.get("Party", "")) or "").strip()
    return nm, party


def _truthy(val) -> bool:
    s = str(val).strip().lower()
    return s in {"1", "true", "t", "yes", "y", "elected"}


def _ceil_next_int(x: float) -> int:
    # "next whole integer after the resulting number"
    # e.g. 100.00 -> 101, 100.01 -> 101, 100.9 -> 101, 0 -> 0
    if not math.isfinite(x) or x <= 0:
        return 0
    i = int(x)
    return i if i == x else i + 1


def _droop_quota(valid_votes: float, seats: int) -> int:
    if seats <= 0 or valid_votes <= 0:
        return 0
    return _ceil_next_int(valid_votes / (seats + 1))


# -------------------------
# Data extraction utilities
# -------------------------

def _first_pref_block(er_group: pd.DataFrame) -> Tuple[List[int], Dict[int, str], Dict[int, str],
                                                       Dict[int, float], float, Dict[int, bool], int]:
    """
    Returns:
      - pids: list of candidate PersonIDs
      - pid2name, pid2party
      - firsts: PersonID -> first pref votes (numeric)
      - first_total: sum of first prefs for the group
      - pid_is_elected: PersonID -> True/False
      - seats: number of elected (fallback 0)
    """
    cand = er_group[er_group["ResultType"] == "Candidate"].copy()
    if cand.empty:
        return [], {}, {}, {}, 0.0, {}, 0

    # Vote column for first preferences
    vote_col = "Votes1" if "Votes1" in cand.columns else ("Votes" if "Votes" in cand.columns else None)
    if not vote_col:
        return [], {}, {}, {}, 0.0, {}, 0

    cand[vote_col] = pd.to_numeric(cand[vote_col], errors="coerce").fillna(0.0)

    # map IDs
    pid2name: Dict[int, str] = {}
    pid2party: Dict[int, str] = {}
    pid_is_elected: Dict[int, bool] = {}
    pids: List[int] = []

    # detect elected flag from any reasonable column
    elect_cols = [c for c in cand.columns if re.search(r"(elect|elected|status|result|outcome)", str(c), re.I)]

    for _, r in cand.iterrows():
        pid = r.get("PersonID")
        if pd.isna(pid):
            continue
        pid = int(pid)
        pids.append(pid)
        nm, py = _name_party(r)
        pid2name[pid] = nm
        pid2party[pid] = py

        elected = False
        for c in elect_cols:
            if _truthy(r.get(c)):
                elected = True
                break
        pid_is_elected[pid] = elected

    total = float(cand[vote_col].sum())
    firsts = {
        int(r["PersonID"]): float(r[vote_col])
        for _, r in cand.dropna(subset=["PersonID"]).iterrows()
    }

    seats = int(sum(1 for v in pid_is_elected.values() if v))
    # Fallback: try known seat-count columns if no elected flags found
    if seats == 0:
        for c in ["Seats", "Members to be elected", "Members", "SeatsAvailable"]:
            if c in er_group.columns:
                try:
                    seats = int(pd.to_numeric(er_group[c], errors="coerce").dropna().iloc[0])
                    break
                except Exception:
                    pass

    return pids, pid2name, pid2party, firsts, total, pid_is_elected, seats


def _collect_rounds(tr_group: pd.DataFrame,
                    pid2name: Dict[int, str],
                    pid2party: Dict[int, str]) -> Tuple[List[int], Dict[int, Dict[int, float]], Dict[int, str]]:
    """
    Return:
      - sorted list of rounds that exist in transfer sheet,
      - deltas[round][pid] = net change in that round for candidate pid,
      - headers[round] = "from A (Party), B (Party)" derived from negative 'Candidate' rows.
    """
    if tr_group is None or tr_group.empty:
        return [], {}, {}

    g = tr_group.copy()
    g["Count"] = pd.to_numeric(g["Count"], errors="coerce")
    g["Transfers"] = pd.to_numeric(g["Transfers"], errors="coerce").fillna(0.0)
    g = g.dropna(subset=["Count"])
    if g.empty:
        return [], {}, {}

    rounds = sorted(int(c) for c in g["Count"].unique().tolist())

    deltas: Dict[int, Dict[int, float]] = {r: {} for r in rounds}
    headers: Dict[int, str] = {}

    for r in rounds:
        sub = g[g["Count"] == r]

        # 1) Header donors (candidate rows with negative Transfers)
        donors = []
        cand_neg = sub[(sub["ResultType"] == "Candidate") & (sub["Transfers"] < 0)]
        for _, row in cand_neg.iterrows():
            pid = row.get("PersonID")
            if not pd.isna(pid):
                pid = int(pid)
                nm = pid2name.get(pid, f"PID{pid}")
                py = pid2party.get(pid, str(row.get("Party", "")))
                donors.append(f"{nm} ({py})")
        donors = list(dict.fromkeys(donors))  # de-dupe preserve order
        headers[r] = "from " + ", ".join(donors) if donors else "transfers"

        # 2) Per-candidate delta (sum all rows for that candidate in this round)
        for _, row in sub.dropna(subset=["PersonID"]).iterrows():
            pid = int(row["PersonID"])
            deltas[r][pid] = deltas[r].get(pid, 0.0) + float(row["Transfers"])

    return rounds, deltas, headers


def _build_round_totals(pids: List[int],
                        firsts: Dict[int, float],
                        rounds: List[int],
                        deltas: Dict[int, Dict[int, float]]) -> Tuple[List[int], Dict[int, Dict[int, float]], Dict[int, Dict[int, float]]]:
    """
    Ensure Count 1 exists (first preferences).
    Returns:
      rounds_all: [1, 2, ..., N]
      cumulative[r][pid] = total votes at end of round r
      change[r][pid]     = delta in round r (NET change in that round)
    """
    rounds_all = sorted(rounds)
    if 1 not in rounds_all:
        rounds_all = [1] + rounds_all

    cumulative: Dict[int, Dict[int, float]] = {}
    change: Dict[int, Dict[int, float]] = {}

    # Round 1: first preferences
    change[1] = {pid: 0.0 for pid in pids}
    cumulative[1] = {pid: float(firsts.get(pid, 0.0)) for pid in pids}

    # Subsequent rounds apply deltas cumulatively
    prev_totals = dict(cumulative[1])
    for r in rounds_all:
        if r == 1:
            continue
        dlt_r = {pid: float(deltas.get(r, {}).get(pid, 0.0)) for pid in pids}
        change[r] = dlt_r
        totals_r = {pid: prev_totals.get(pid, 0.0) + dlt_r.get(pid, 0.0) for pid in pids}
        cumulative[r] = totals_r
        prev_totals = totals_r

    return rounds_all, cumulative, change


# -------------------------
# Console printer
# -------------------------

def _render_group_table_console(date_str: str,
                                constituency: str,
                                body: str,
                                pids: List[int],
                                pid2name: Dict[int, str],
                                pid2party: Dict[int, str],
                                pid_is_elected: Dict[int, bool],
                                firsts: Dict[int, float],
                                first_total: float,
                                rounds_all: List[int],
                                headers: Dict[int, str],
                                cumulative: Dict[int, Dict[int, float]],
                                change: Dict[int, Dict[int, float]],
                                seats: int) -> None:
    """
    Wikipedia-ish block for console:
      Candidate | Party | 1st Pref % | Count 1 | Δ1 | Count 2 | Δ2 | ...
    Count 1 totals are integers; all later counts & deltas are 2 dp.
    Elected candidates printed **in bold** using asterisks.
    """
    quota = _droop_quota(first_total, seats)
    title = f"{date_str} — {constituency} — {body}"
    print("\n" + title)
    print("-" * len(title))
    print(f"Seats: {seats} | Valid votes: {int(round(first_total)):,} | Quota (Droop): {quota:,}")

    # Build column headers
    cols = ["Candidate", "Party", "1st Pref %"]
    for r in rounds_all:
        head = f"Count {r}"
        sub = "(first preferences)" if r == 1 else f"({headers.get(r, 'transfers')})"
        cols.append(f"{head} {sub}")
        cols.append(f"Δ{r}")

    # Column widths (rough)
    widths = [30, 12, 11] + sum(([14, 10] for _ in rounds_all), [])
    # header row
    print(
        f"{cols[0]:{widths[0]}}  {cols[1]:{widths[1]}}  {cols[2]:>{widths[2]}}  " +
        "  ".join(
            f"{cols[3+2*i]:>{widths[3+2*i]}}  {cols[4+2*i]:>{widths[4+2*i]}}"
            for i in range(len(rounds_all))
        )
    )

    # Data rows sorted by first preference
    pids_sorted = sorted(pids, key=lambda pid: firsts.get(pid, 0.0), reverse=True)
    for pid in pids_sorted:
        nm = pid2name.get(pid, f"PID{pid}")
        if pid_is_elected.get(pid, False):
            nm = f"**{nm}**"
        py = pid2party.get(pid, "")
        fpct = (firsts.get(pid, 0.0) / first_total) if first_total > 0 else 0.0

        cells = [nm, py, _fmt_pct(fpct)]
        for r in rounds_all:
            v = cumulative.get(r, {}).get(pid, 0.0)
            d = change.get(r, {}).get(pid, 0.0)
            # Count 1 integer; later rounds 2 dp
            cells.append(_fmt_int(v) if r == 1 else _fmt_2dp(v))
            cells.append(_fmt_delta_2dp(d))
        # print row
        print(
            f"{cells[0]:{widths[0]}}  {cells[1]:{widths[1]}}  {cells[2]:>{widths[2]}}  " +
            "  ".join(
                f"{cells[3+2*i]:>{widths[3+2*i]}}  {cells[4+2*i]:>{widths[4+2*i]}}"
                for i in range(len(rounds_all))
            )
        )


def print_election_view(
    er: pd.DataFrame,
    tr: Optional[pd.DataFrame] = None,
    *,
    date: Optional[str] = None,
    year: Optional[int] = None,
    constituency: Optional[str] = None,
    event_substr: Optional[str] = None,
    body_substr: Optional[str] = None,
    limit: Optional[int] = None,
) -> None:
    """
    Console 'election viewer'.
    """
    df = er.copy()
    df["DateStr"] = df.get("DateStr", df.get("Date", "")).apply(to_date_str)
    if constituency:
        cons_norm = normalize_constituency_name(constituency)
        df = df[df["Constituency"].astype(str).str.strip().str.casefold() == cons_norm.casefold()]
    if date:
        d = to_date_str(date)
        df = df[df["DateStr"] == d]
    if year:
        df["Year"] = pd.to_datetime(df["DateStr"], errors="coerce").dt.year
        df = df[df["Year"] == int(year)]
    if event_substr:
        pat = str(event_substr)
        df = df[df.get("Event", "").astype(str).str.contains(pat, case=False, na=False)]
    if body_substr:
        pat = str(body_substr)
        df = df[df.get("ElectedBody", "").astype(str).str.contains(pat, case=False, na=False)]

    groups = list(df.groupby(["DateStr", "Constituency", "ElectedBody"]))
    if limit:
        groups = groups[: int(limit)]

    if not groups:
        print("No matching elections.")
        return

    # transfers DataFrame prepared once
    if tr is not None and not tr.empty:
        tr = tr.copy()
        tr["DateStr"] = tr.get("DateStr", tr.get("Date", "")).apply(to_date_str)
        tr["Count"] = pd.to_numeric(tr.get("Count"), errors="coerce")

    printed = 0
    for (date_str, cons, body), er_group in groups:
        pids, pid2name, pid2party, firsts, first_total, pid_is_elected, seats = _first_pref_block(er_group)
        if not pids:
            title = f"{date_str} — {cons} — {body}"
            print("\n" + title)
            print("-" * len(title))
            print("(No candidate rows found.)")
            continue

        # filter transfers for this group
        if tr is not None and not tr.empty:
            mask = (
                (tr["DateStr"] == date_str)
                & (tr.get("Constituency", "").astype(str) == str(cons))
                & (tr.get("ElectedBody", "").astype(str) == str(body))
            )
            tr_group = tr[mask]
        else:
            tr_group = None

        rounds, deltas, headers = _collect_rounds(tr_group, pid2name, pid2party)
        rounds_all, cumulative, change = _build_round_totals(pids, firsts, rounds, deltas)

        _render_group_table_console(
            date_str,
            str(cons),
            str(body),
            pids,
            pid2name,
            pid2party,
            pid_is_elected,
            firsts,
            first_total,
            rounds_all,
            headers,
            cumulative,
            change,
            seats,
        )
        printed += 1

    if printed:
        print(f"\nPrinted {printed} election(s).")


# -------------------------
# Web (UI) data builder
# -------------------------

def get_election_view_data(
    er: pd.DataFrame,
    tr: Optional[pd.DataFrame] = None,
    *,
    date: Optional[str] = None,
    year: Optional[int] = None,
    constituency: Optional[str] = None,
    event_substr: Optional[str] = None,
    body_substr: Optional[str] = None,
    limit: Optional[int] = None,
    html_headers: bool = True,
    html_safe: bool = True,
):
    """
    Build structured table models for UI rendering.

    Returns a list of objects:
      {
        "title": "YYYY-MM-DD — Constituency — Body",
        "meta_html": "<div>Seats: … | Valid votes: … | Quota: …</div>",
        "columns": [ "Candidate", "Party", "1st Pref %", "Count 1 — (first preferences)", "Δ1", "Count 2 — from …", "Δ2", ... ],
        "rows": [ [cells...], ... ]
      }
    """
    df = er.copy()
    df["DateStr"] = df.get("DateStr", df.get("Date", "")).apply(to_date_str)
    if constituency:
        cons_norm = normalize_constituency_name(constituency)
        df = df[df["Constituency"].astype(str).str.strip().str.casefold() == cons_norm.casefold()]
    if date:
        d = to_date_str(date)
        df = df[df["DateStr"] == d]
    if year:
        df["Year"] = pd.to_datetime(df["DateStr"], errors="coerce").dt.year
        df = df[df["Year"] == int(year)]
    if event_substr:
        pat = str(event_substr)
        df = df[df.get("Event", "").astype(str).str.contains(pat, case=False, na=False)]
    if body_substr:
        pat = str(body_substr)
        df = df[df.get("ElectedBody", "").astype(str).str.contains(pat, case=False, na=False)]

    groups = list(df.groupby(["DateStr", "Constituency", "ElectedBody"]))
    if limit:
        groups = groups[: int(limit)]

    # Prepare transfers
    if tr is not None and not tr.empty:
        tr = tr.copy()
        tr["DateStr"] = tr.get("DateStr", tr.get("Date", "")).apply(to_date_str)
        tr["Count"] = pd.to_numeric(tr.get("Count"), errors="coerce")

    out = []
    for (date_str, cons, body), er_group in groups:
        pids, pid2name, pid2party, firsts, first_total, pid_is_elected, seats = _first_pref_block(er_group)
        title = f"{date_str} — {cons} — {body}"
        if not pids:
            out.append({
                "title": title,
                "meta_html": "",
                "columns": ["Candidate", "Party", "1st Pref %"],
                "rows": [["(No candidate rows found.)", "", ""]],
            })
            continue

        # local transfers for group
        if tr is not None and not tr.empty:
            mask = (
                (tr["DateStr"] == date_str)
                & (tr.get("Constituency", "").astype(str) == str(cons))
                & (tr.get("ElectedBody", "").astype(str) == str(body))
            )
            tr_group = tr[mask]
        else:
            tr_group = None

        rounds, deltas, headers = _collect_rounds(tr_group, pid2name, pid2party)
        rounds_all, cumulative, change = _build_round_totals(pids, firsts, rounds, deltas)

        # --- Meta banner (Seats, Valid, Quota) ---
        quota = _droop_quota(first_total, seats)
        meta_html = (
            f"<div class='muted'><strong>Seats:</strong> {seats} "
            f"| <strong>Valid votes:</strong> {int(round(first_total)):,} "
            f"| <strong>Quota (Droop):</strong> {quota:,}</div>"
        )

        # --- Columns (Count 1 first preferences; others with donor info) ---
        columns = ["Candidate", "Party", "1st Pref %"]
        for r in rounds_all:
            hdr = "(first preferences)" if r == 1 else (f"from {headers.get(r, 'transfers')}" if html_headers else "")
            col = f"Count {r}" + (f" — {hdr}" if hdr else "")
            columns.append(col)
            columns.append(f"Δ{r}")

        # --- Rows ---
        pids_sorted = sorted(pids, key=lambda pid: firsts.get(pid, 0.0), reverse=True)
        rows = []
        for pid in pids_sorted:
            nm = pid2name.get(pid, f"PID{pid}")
            if html_safe and pid_is_elected.get(pid, False):
                nm = f"<strong>{nm}</strong>"
            elif (not html_safe) and pid_is_elected.get(pid, False):
                nm = f"**{nm}**"
            py = pid2party.get(pid, "")
            fpct = (firsts.get(pid, 0.0) / first_total) if first_total > 0 else 0.0

            row_cells = [nm, py, f"{fpct*100:0.2f}%"]
            for r in rounds_all:
                v = cumulative.get(r, {}).get(pid, 0.0)
                d = change.get(r, {}).get(pid, 0.0)
                # Count 1 integer; later rounds 2 dp
                row_cells.append(_fmt_int(v) if r == 1 else _fmt_2dp(v))
                row_cells.append(_fmt_delta_2dp(d))
            rows.append(row_cells)

        out.append({
            "title": title,
            "meta_html": meta_html,
            "columns": columns,
            "rows": rows,
        })
    return out
