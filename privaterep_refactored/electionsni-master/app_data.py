"""Utilities for serving election data from the NICVA workbook."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from functools import cached_property
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from pandas.errors import OutOfBoundsDatetime

from party_colours import PartyColourResolver
from workbook_seat_utils import normalise_election_outcomes

MAX_COUNTS = 23


@dataclass
class ElectionSelection:
    """Key identifying a single election contest."""

    elected_body: str
    date: str  # ISO formatted date (YYYY-MM-DD)
    constituency: str


class WorkbookData:
    """Accessor for the NICVA ``Full election tables`` workbook."""

    def __init__(
        self,
        workbook_path: Path,
        colour_resolver: Optional[PartyColourResolver] = None,
    ):
        self.workbook_path = workbook_path
        self._colour_resolver = colour_resolver or PartyColourResolver()

    @cached_property
    def _workbook(self) -> Dict[str, pd.DataFrame]:
        if not self.workbook_path.exists():
            raise FileNotFoundError(
                f"Workbook not found at {self.workbook_path}. Did you download the NICVA data?"
            )
        excel = pd.ExcelFile(self.workbook_path)
        results = normalise_election_outcomes(excel.parse("ElectionResults"))
        transfers = excel.parse("Transfers")
        candidate_state = excel.parse("CandidateStatePerCount_v2")
        # Normalise dates to ISO strings for easier comparisons.
        results["Date"] = pd.to_datetime(results["Date"]).dt.date
        transfers["Date"] = pd.to_datetime(transfers["Date"]).dt.date
        return {
            "results": results,
            "transfers": transfers,
            "candidate_state": candidate_state,
        }

    @property
    def results(self) -> pd.DataFrame:
        return self._workbook["results"].copy()

    @property
    def transfers(self) -> pd.DataFrame:
        return self._workbook["transfers"].copy()

    @property
    def candidate_state(self) -> pd.DataFrame:
        return self._workbook["candidate_state"].copy()

    def constituencies(self) -> List[str]:
        frame = self.results
        names = frame["Constituency"].dropna().unique().tolist()
        return sorted(names)

    def elections(self) -> List[Dict[str, str]]:
        frame = self.results
        subset = frame[["ElectedBody", "Date"]].dropna()
        subset = subset.drop_duplicates()
        subset = subset.sort_values(by=["Date", "ElectedBody"], ascending=[False, True])
        elections: List[Dict[str, str]] = []
        for _, row in subset.iterrows():
            date = row["Date"]
            elections.append(
                {
                    "elected_body": str(row["ElectedBody"]),
                    "date": date.isoformat(),
                }
            )
        return elections

    def available_pairs(self) -> List[Dict[str, str]]:
        frame = self.results
        subset = frame[
            frame["First Name"].notna()
            & frame["Constituency"].notna()
            & frame["ElectedBody"].notna()
            & frame["Date"].notna()
        ][["Constituency", "ElectedBody", "Date"]]
        subset = subset.drop_duplicates()
        subset = subset.sort_values(
            by=["Constituency", "Date", "ElectedBody"],
            ascending=[True, True, True],
        )
        pairs: List[Dict[str, str]] = []
        for _, row in subset.iterrows():
            pairs.append(
                {
                    "constituency": str(row["Constituency"]),
                    "elected_body": str(row["ElectedBody"]),
                    "date": row["Date"].isoformat(),
                }
            )
        return pairs

    def build_results_payload(self, selection: ElectionSelection) -> Optional[Dict[str, Any]]:
        frame = self.results
        target_date = self._coerce_date(selection.date)
        mask = (
            (frame["ElectedBody"] == selection.elected_body)
            & (frame["Date"] == target_date)
            & (frame["Constituency"] == selection.constituency)
        )
        subset = frame[mask]
        if subset.empty:
            return None

        first_names = _normalise_series(subset, "First Name")
        last_names = _normalise_series(subset, "Last Name")
        known_by_names = _normalise_series(subset, "Name usually known by")

        has_split_name = (first_names != "") | (last_names != "")
        has_known_by = known_by_names != ""
        candidate_mask = has_split_name | has_known_by

        candidate_rows = subset[candidate_mask].copy()
        if candidate_rows.empty:
            return None

        summary_rows = subset[~candidate_mask].copy()
        stats = self._extract_stats(summary_rows)
        seats = int(candidate_rows[candidate_rows["Outcome"] == "Elected"].shape[0])
        stats.setdefault("Number_Of_Seats", str(seats))
        stats.setdefault("Constituency_Name", selection.constituency)
        stats.setdefault("Constituency_Number", "")

        selection_transfers = self._build_transfer_lookup(selection)
        state_lookup = self._build_candidate_state_lookup(candidate_rows, selection)
        status_events = self._determine_candidate_events(
            candidate_rows=candidate_rows,
            transfer_lookup=selection_transfers,
            state_lookup=state_lookup,
        )

        count_group: List[Dict[str, Any]] = []
        entry_id = 0
        event_name = None
        for _, row in candidate_rows.iterrows():
            person_id = row.get("PersonID")
            if pd.isna(person_id):
                continue
            candidate_id = str(int(round(person_id)))
            first_pref = row.get("Votes1")
            outcome = str(row.get("Outcome") or "")
            event_meta = status_events.get(candidate_id, {})
            status_label = event_meta.get("status", "")
            occurred_on = event_meta.get("count")
            for count in range(1, MAX_COUNTS + 1):
                votes_key = f"Votes{count}"
                transfers_key = f"Transfers{count - 1}" if count > 1 else None
                votes_val = row.get(votes_key)
                transfers_val = row.get(transfers_key) if transfers_key else 0
                has_votes = not pd.isna(votes_val)
                has_transfers = (
                    transfers_key is not None and not pd.isna(transfers_val)
                )
                if not has_votes and not has_transfers:
                    continue
                party_name = str(row.get("Party Name") or "")
                if event_name is None:
                    raw_event = row.get("Event")
                    if isinstance(raw_event, str) and raw_event:
                        event_name = raw_event
                party_colour = self._colour_resolver.colour_for(party_name)
                first_name, last_name, candidate_name = _extract_candidate_name(row)

                count_group.append(
                    {
                        "Candidate_First_Pref_Votes": _format_int(first_pref),
                        "Status": status_label if occurred_on and count >= occurred_on else "",
                        "Occurred_On_Count": str(occurred_on) if occurred_on else "",
                        "Surname": last_name,
                        "Firstname": first_name,
                        "candidateName": candidate_name,
                        "Constituency_Number": stats.get("Constituency_Number", ""),
                        "Party_Name": party_name,
                        "Party_Colour": party_colour or "",
                        "Candidate_Id": candidate_id,
                        "Count_Number": str(count),
                        "Transfers": _format_votes(transfers_val),
                        "id": entry_id,
                        "Total_Votes": _format_votes(votes_val),
                    }
                )
                entry_id += 1
        count_group.extend(
            self._build_non_transferable_rows(
                selection=selection,
                event_name=event_name,
                starting_entry_id=entry_id,
            )
        )
        if not count_group:
            return None

        return {"Constituency": {"countInfo": stats, "countGroup": count_group}}

    def _build_non_transferable_rows(
        self,
        selection: ElectionSelection,
        event_name: Optional[str],
        starting_entry_id: int,
    ) -> List[Dict[str, Any]]:
        if not event_name:
            return []

        key = f"{selection.date}|{event_name}|{selection.constituency}"
        frame = self.candidate_state
        subset = frame[frame["ElectionKey"] == key]
        if subset.empty:
            return []

        name_mask = subset["CandidateName"].astype(str).str.strip().str.lower() == "nontransferable"
        non_transferable = subset[name_mask]
        if non_transferable.empty:
            return []

        prepared_rows: List[Dict[str, Any]] = []
        seen_first_count = False
        for _, row in non_transferable.sort_values("Count").iterrows():
            count_number = row.get("Count")
            try:
                count_int = int(count_number)
            except (TypeError, ValueError):
                continue
            total_votes = row.get("TotalVotes")
            incoming = row.get("IncomingVotesThisCount")
            if count_int == 1:
                total_votes = 0
                incoming = 0
                seen_first_count = True
            prepared_rows.append(
                    {
                        "Candidate_First_Pref_Votes": "0.00",
                        "Status": "",
                        "Occurred_On_Count": "",
                        "Surname": "",
                        "Firstname": "Non-transferable",
                        "candidateName": "Non-transferable",
                        "Constituency_Number": "",
                        "Party_Name": "Non-transferable",
                        "Party_Colour": "#666666",
                        "Candidate_Id": "nontransferable",
                        "Count_Number": str(count_int),
                    "Transfers": _format_votes(incoming),
                    "Total_Votes": _format_votes(total_votes),
                }
            )
        if not seen_first_count:
            prepared_rows.insert(
                0,
                {
                    "Candidate_First_Pref_Votes": "0.00",
                    "Status": "",
                    "Occurred_On_Count": "",
                    "Surname": "",
                    "Firstname": "Non-transferable",
                    "candidateName": "Non-transferable",
                    "Constituency_Number": "",
                    "Party_Name": "Non-transferable",
                    "Party_Colour": "#666666",
                    "Candidate_Id": "nontransferable",
                    "Count_Number": "1",
                    "Transfers": _format_votes(0),
                    "Total_Votes": _format_votes(0),
                },
            )

        rows: List[Dict[str, Any]] = []
        entry_id = starting_entry_id
        for prepared in prepared_rows:
            prepared_with_id = dict(prepared)
            prepared_with_id["id"] = entry_id
            rows.append(prepared_with_id)
            entry_id += 1
        return rows

    def _build_transfer_lookup(self, selection: ElectionSelection) -> Dict[str, Dict[str, int]]:
        frame = self.transfers
        target_date = self._coerce_date(selection.date)
        mask = (
            (frame["ElectedBody"] == selection.elected_body)
            & (frame["Date"] == target_date)
            & (frame["Constituency"] == selection.constituency)
        )
        subset = frame[mask]
        lookup: Dict[str, Dict[str, int]] = {}
        if subset.empty:
            return lookup

        for _, row in subset.iterrows():
            person_id = row.get("PersonID")
            if pd.isna(person_id):
                continue
            candidate_id = str(int(round(person_id)))
            count_number = row.get("Count")
            if pd.isna(count_number):
                continue
            count_int = int(count_number)
            entry = lookup.setdefault(candidate_id, {})
            if _truthy(row.get("ElectedThisRound")) and "elected" not in entry:
                entry["elected"] = count_int
            if _truthy(row.get("EliminatedThisRound")) and "eliminated" not in entry:
                entry["eliminated"] = count_int
        return lookup

    def _build_candidate_state_lookup(
        self,
        candidate_rows: pd.DataFrame,
        selection: ElectionSelection,
    ) -> Dict[str, Dict[int, Any]]:
        """Map candidate ids to per-count state totals for the election."""

        frame = self.candidate_state
        keys: List[str] = []
        if "ElectionKey" in candidate_rows.columns:
            raw_keys = candidate_rows["ElectionKey"].dropna().astype(str).unique().tolist()
            keys.extend(raw_keys)
        if "Event" in candidate_rows.columns:
            events = candidate_rows["Event"].dropna().astype(str).unique().tolist()
            for event in events:
                keys.append(f"{selection.date}|{event}|{selection.constituency}")
        keys.append(f"{selection.date}|{selection.elected_body}|{selection.constituency}")

        state_lookup: Dict[str, Dict[int, Any]] = {}
        seen_keys = set()
        for key in keys:
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            subset = frame[frame["ElectionKey"] == key]
            if subset.empty:
                continue
            for candidate_id, group in subset.groupby("CandidateID"):
                candidate_key = _candidate_id_from_value(candidate_id)
                if not candidate_key:
                    continue
                counts = state_lookup.setdefault(candidate_key, {})
                for _, record in group.iterrows():
                    count_value = record.get("Count")
                    if pd.isna(count_value):
                        continue
                    try:
                        count_int = int(count_value)
                    except (TypeError, ValueError):
                        continue
                    counts[count_int] = record.get("TotalVotes")
        return state_lookup

    def _determine_candidate_events(
        self,
        candidate_rows: pd.DataFrame,
        transfer_lookup: Dict[str, Dict[str, int]],
        state_lookup: Dict[str, Dict[int, Any]],
    ) -> Dict[str, Dict[str, Optional[int]]]:
        """Determine the resolved status and count for each candidate row."""

        events: Dict[str, Dict[str, Optional[int]]] = {}
        for _, row in candidate_rows.iterrows():
            candidate_key = _candidate_id_from_value(row.get("PersonID"))
            if not candidate_key:
                continue
            status_label = _status_from_outcome(str(row.get("Outcome") or ""))
            if not status_label:
                continue

            occurred_on = self._resolve_event_count(candidate_key, status_label, transfer_lookup)
            if occurred_on is None:
                occurred_on = _event_count_from_transfer_subjects(row, candidate_key)
            state_totals = state_lookup.get(candidate_key, {})
            if occurred_on is None:
                occurred_on = _event_count_from_votes(row, status_label, state_totals)
            if occurred_on is None:
                occurred_on = _event_count_from_candidate_state(state_totals, status_label)

            events[candidate_key] = {"status": status_label, "count": occurred_on}
        return events

    def _resolve_event_count(
        self,
        candidate_id: str,
        status: str,
        lookup: Dict[str, Dict[str, int]],
    ) -> Optional[int]:
        if not status:
            return None
        events = lookup.get(candidate_id, {})
        if status == "Elected":
            return events.get("elected")
        if status == "Excluded":
            return events.get("eliminated")
        return None

    def _extract_stats(self, rows: pd.DataFrame) -> Dict[str, str]:
        stats: Dict[str, str] = {}
        if rows.empty or "ResultType" not in rows or "Votes1" not in rows:
            return stats

        def _first_numeric(series: pd.Series) -> Optional[float]:
            cleaned = series.dropna()
            if cleaned.empty:
                return None
            value = cleaned.iloc[0]
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        summary = (
            rows.dropna(subset=["ResultType"])
            .groupby("ResultType", sort=False)["Votes1"]
            .apply(_first_numeric)
        )
        summary_map = summary.to_dict()

        electorate = summary_map.get("Electorate")
        quota = summary_map.get("Quota")
        spoiled = summary_map.get("Spoiled")
        abstained = summary_map.get("Did not vote")

        if electorate is not None:
            stats["Total_Electorate"] = _format_int(electorate)
        if quota is not None:
            stats["Quota"] = _format_int(quota)
        if spoiled is not None:
            stats["Spoiled"] = _format_int(spoiled)
        if electorate is not None and abstained is not None:
            total_poll = electorate - abstained
            stats["Total_Poll"] = _format_int(total_poll)
            if spoiled is not None:
                valid_poll = total_poll - spoiled
                stats["Valid_Poll"] = _format_int(valid_poll)
        return stats

    def _coerce_date(self, value: str) -> date:
        try:
            parsed = pd.to_datetime(value)
        except (TypeError, ValueError, OutOfBoundsDatetime) as exc:
            raise ValueError(f"Invalid date value: {value!r}") from exc
        if pd.isna(parsed):
            raise ValueError(f"Invalid date value: {value!r}")
        return parsed.date()


def _normalise_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series("", index=frame.index, dtype="object")
    series = frame[column]
    return series.apply(_clean_cell)


def _extract_candidate_name(row: pd.Series) -> tuple[str, str, str]:
    first_name = _clean_cell(row.get("First Name"))
    last_name = _clean_cell(row.get("Last Name"))
    known_by = _clean_cell(row.get("Name usually known by"))

    if not first_name and not last_name and known_by:
        candidate_name = known_by
    else:
        candidate_name = " ".join(part for part in [first_name, last_name] if part)

    return first_name, last_name, candidate_name


def _clean_cell(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except TypeError:
        pass
    return str(value).strip()


def _format_votes(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return "0.00"
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return "0.00"
    return f"{numeric:.2f}"


def _format_int(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return ""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return ""
    if numeric.is_integer():
        return str(int(numeric))
    return f"{numeric:.0f}"


def _status_from_outcome(outcome: str) -> str:
    outcome = outcome.strip().lower()
    if outcome == "elected":
        return "Elected"
    if outcome in {"eliminated", "not elected", "not successful"}:
        return "Excluded"
    return ""


def _candidate_id_from_value(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            numeric = float(cleaned)
        except ValueError:
            return cleaned
        if pd.isna(numeric):
            return None
        return str(int(round(numeric)))
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(numeric):
        return None
    return str(int(round(numeric)))


def _coerce_float(value: Any) -> Optional[float]:
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(numeric):
        return None
    return numeric


def _extract_subject_tokens(value: Any) -> List[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
        return []
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        candidate = _candidate_id_from_value(value)
        return [candidate] if candidate else []
    if not isinstance(value, str):
        return []
    cleaned = value.replace("/", ",")
    tokens = []
    for token in cleaned.split(","):
        stripped = token.strip()
        if not stripped:
            continue
        normalised = _candidate_id_from_value(stripped)
        if normalised:
            tokens.append(normalised)
    return tokens


def _event_count_from_transfer_subjects(row: pd.Series, candidate_id: str) -> Optional[int]:
    for count in range(1, MAX_COUNTS + 1):
        subject = row.get(f"TransferSubject{count}")
        if not subject:
            continue
        tokens = _extract_subject_tokens(subject)
        if candidate_id in tokens:
            return count
    return None


def _event_count_from_votes(
    row: pd.Series,
    status_label: str,
    state_totals: Dict[int, Any],
) -> Optional[int]:
    status_label = (status_label or "").strip()
    if not status_label:
        return None
    for count in range(1, MAX_COUNTS):
        transfer_val = _coerce_float(row.get(f"Transfers{count}"))
        if transfer_val is None or transfer_val >= 0:
            continue
        votes_current = _coerce_float(row.get(f"Votes{count}"))
        if votes_current is None:
            continue
        next_votes = _coerce_float(row.get(f"Votes{count + 1}"))
        if next_votes is None:
            next_votes = _coerce_float(state_totals.get(count + 1))
        if status_label == "Excluded":
            if next_votes is not None and next_votes <= 1e-6:
                return count
            if abs(transfer_val) >= votes_current - 1e-6:
                return count
        elif status_label == "Elected":
            if next_votes is not None and next_votes > 0 and votes_current - next_votes > 1e-6:
                return count
    return None


def _event_count_from_candidate_state(
    state_totals: Dict[int, Any],
    status_label: str,
) -> Optional[int]:
    if not state_totals:
        return None
    sorted_counts = sorted(state_totals.items())
    previous_total: Optional[float] = None
    previous_count: Optional[int] = None
    for count, total in sorted_counts:
        current_total = _coerce_float(total)
        if current_total is None:
            continue
        if previous_total is not None:
            if status_label == "Elected" and current_total > 0 and previous_total - current_total > 1e-6:
                return previous_count
            if status_label == "Excluded" and current_total <= 1e-6 and previous_total > 1e-6:
                if previous_count and previous_count > 0:
                    return previous_count
                return count
        previous_total = current_total
        previous_count = count
    if status_label == "Excluded" and previous_total is not None and previous_total <= 1e-6:
        return previous_count
    return None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"true", "t", "1", "yes", "y"}
    return False
