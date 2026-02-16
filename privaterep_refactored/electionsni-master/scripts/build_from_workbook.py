#!/usr/bin/env python3
"""Generate NICVA elections data artifacts from the canonical Excel workbook.

This script reads ``data/Full election tables.xlsx`` (or a workbook placed in the
repository root) and regenerates the JSON/CSV artefacts consumed by the legacy
front-end.  The goal is to match the historical structure closely enough that
existing pages continue to render without modification.

The Excel workbook shipped by NICVA contains a rich set of sheets.  For the
initial refactor we lean primarily on the ``ElectionResults`` sheet which
contains per-candidate results together with summary rows for quota and
turnout.  Some of the legacy derived data (for example the detailed transfer
matrices) require additional provenance tables that have not yet been mapped in
code; the scaffolding in this script has been designed so those capabilities can
be filled in incrementally without reshaping the public API.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd

from party_colours import PartyColourResolver
from workbook_seat_utils import (
    build_candidate_state_lookup,
    normalise_election_outcomes,
    seat_counts_by_year_constituency,
)

# Constituency metadata required by the existing site structure.
CONSTITUENCIES: Dict[str, Dict[str, object]] = {
    "Belfast East": {"directory": "belfast-east", "number": 2},
    "Belfast North": {"directory": "belfast-north", "number": 10},
    "Belfast South": {"directory": "belfast-south", "number": 13},
    "Belfast West": {"directory": "belfast-west", "number": 17},
    "East Antrim": {"directory": "east-antrim", "number": 1},
    "East Londonderry": {"directory": "east-londonderry", "number": 3},
    "Fermanagh and South Tyrone": {"directory": "fermanagh-south-tyrone", "number": 4},
    "Foyle": {"directory": "foyle", "number": 5},
    "Lagan Valley": {"directory": "lagan-valley", "number": 6},
    "Mid Ulster": {"directory": "mid-ulster", "number": 7},
    "Newry and Armagh": {"directory": "newry-armagh", "number": 8},
    "North Antrim": {"directory": "north-antrim", "number": 9},
    "North Down": {"directory": "north-down", "number": 11},
    "South Antrim": {"directory": "south-antrim", "number": 12},
    "South Down": {"directory": "south-down", "number": 14},
    "Strangford": {"directory": "strangford", "number": 15},
    "Upper Bann": {"directory": "upper-bann", "number": 16},
    "West Tyrone": {"directory": "west-tyrone", "number": 18},
}

PARTY_COLOUR_RESOLVER = PartyColourResolver()
MAX_COUNTS = 23


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def stringify(value) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if isinstance(value, (int,)):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def format_votes(value: float | int | None) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return f"{float(value):.2f}"


@dataclass(frozen=True)
class CandidateRecord:
    year: int
    constituency: str
    first_name: str
    last_name: str
    party_name: str
    person_id: str
    gender: str
    first_pref: str
    outcome: str
    counts: List[Tuple[int, str, str]]  # (count_number, transfer, total_votes)
    occurred_on_count: str

    @property
    def constituency_info(self) -> Dict[str, object]:
        meta = CONSTITUENCIES[self.constituency]
        return {
            "Constituency_Name": self.constituency,
            "Constituency_Number": stringify(meta["number"]),
            "Directory": meta["directory"],
        }

    def as_candidate_row(self, party_id: str) -> Dict[str, object]:
        base = self.constituency_info
        return {
            "Surname": self.last_name,
            "Firstname": self.first_name,
            "Gender": self.gender,
            "Twitter": "",
            "Constituency_Name": base["Constituency_Name"],
            "Constituency_Number": base["Constituency_Number"],
            "Party_Name": self.party_name,
            "Outgoing_Member": "0",
            "Candidate_Id": self.person_id,
            "Directory": base["Directory"],
            "Party_Id": party_id,
            "Email": "",
            "Photo_URL": "",
        }

    def as_elected_row(self) -> Dict[str, object]:
        base = self.constituency_info
        return {
            "Candidate_First_Pref_Votes": self.first_pref,
            "Status": self.outcome or "",
            "Occurred_On_Count": self.occurred_on_count,
            "Surname": self.last_name,
            "Firstname": self.first_name,
            "Constituency_Number": base["Constituency_Number"],
            "Party_Name": self.party_name,
            "Candidate_Id": self.person_id,
        }

    def as_elected_d3_row(self, colour: str) -> Dict[str, object]:
        row = self.as_elected_row()
        row.update(
            {
                "Colour": colour,
                "Constituency_Name": self.constituency,
            }
        )
        return row

    def iter_count_rows(self, colour: Optional[str] = None) -> Iterable[Dict[str, object]]:
        base = self.constituency_info
        colour_value = colour or ""
        for count_number, transfer, total in self.counts:
            yield {
                "Constituency_Number": base["Constituency_Number"],
                "Candidate_Id": self.person_id,
                "Count_Number": stringify(count_number),
                "Firstname": self.first_name,
                "Surname": self.last_name,
                "Candidate_First_Pref_Votes": self.first_pref,
                "Transfers": transfer,
                "Total_Votes": total,
                "Status": self.outcome if self.outcome else "",
                "Occurred_On_Count": self.occurred_on_count,
                "Party_Name": self.party_name,
                "Party_Colour": colour_value,
            }


def gender_slug(value: object) -> str:
    text = stringify(value).strip().lower()
    if text in {"male", "m"}:
        return "male"
    if text in {"female", "f"}:
        return "female"
    return ""


def locate_workbook() -> Path:
    candidates = [Path("data/Full election tables.xlsx"), Path("Full election tables.xlsx")]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Could not locate 'Full election tables.xlsx'. Place it in data/ or the repository root."
    )


def load_source_data() -> Tuple[pd.DataFrame, pd.DataFrame]:
    workbook = locate_workbook()
    xl = pd.ExcelFile(workbook)
    results = normalise_election_outcomes(xl.parse("ElectionResults"))
    candidate_state = xl.parse("CandidateStatePerCount_v2")
    return results, candidate_state


def extract_candidates(df: pd.DataFrame, target_years: Iterable[int]) -> List[CandidateRecord]:
    candidate_rows: List[CandidateRecord] = []
    filtered = df[
        (df["ResultType"] == "Candidate")
        & (df["Event"] == "DevolvedElection")
        & (df["ElectedBody"] == "Northern Ireland Assembly")
        & df["Date"].notna()
    ].copy()
    filtered["Year"] = filtered["Date"].dt.year
    target_years_set = set(int(y) for y in target_years)
    filtered = filtered[filtered["Year"].isin(target_years_set)]

    for _, row in filtered.iterrows():
        constituency = stringify(row["Constituency"])
        if constituency not in CONSTITUENCIES:
            continue
        year = int(row["Year"])
        counts: List[Tuple[int, str, str]] = []
        first_pref = format_votes(row.get("Votes1"))
        last_valid_count = ""
        for idx in range(1, MAX_COUNTS + 1):
            votes_key = f"Votes{idx}"
            transfers_key = f"Transfers{idx - 1}" if idx > 1 else None
            votes = row.get(votes_key)
            if pd.isna(votes):
                break
            transfer_value = "0.00"
            if transfers_key:
                transfer_value = format_votes(row.get(transfers_key)) or "0.00"
            counts.append((idx, transfer_value, format_votes(votes)))
            last_valid_count = stringify(idx)
        outcome = stringify(row.get("Outcome")).strip()
        occurred_on_count = last_valid_count if outcome else ""
        candidate_rows.append(
            CandidateRecord(
                year=year,
                constituency=constituency,
                first_name=stringify(row.get("First Name")),
                last_name=stringify(row.get("Last Name")),
                party_name=stringify(row.get("Party Name")),
                person_id=stringify(row.get("PersonID")) or stringify(row.get("TransferSubject9")),
                gender=gender_slug(row.get("Gender")),
                first_pref=first_pref,
                outcome=outcome,
                counts=counts,
                occurred_on_count=occurred_on_count,
            )
        )
    return candidate_rows


def build_non_transferable_counts(
    candidate_state_lookup: Dict[Tuple[int, str], pd.DataFrame],
    year: int,
    constituency: str,
) -> List[Dict[str, object]]:
    subset = candidate_state_lookup.get((year, constituency))
    if subset is None or subset.empty:
        return []
    mask = subset["CandidateName"].astype(str).str.strip().str.lower() == "nontransferable"
    target = subset[mask]
    if target.empty:
        return []

    rows: List[Dict[str, object]] = []
    constituency_meta = CONSTITUENCIES.get(constituency, {})
    constituency_number = stringify(constituency_meta.get("number", ""))
    for _, row in target.sort_values("Count").iterrows():
        count_value = row.get("Count")
        try:
            count_number = int(count_value)
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "Constituency_Number": constituency_number,
                "Candidate_Id": "nontransferable",
                "Count_Number": stringify(count_number),
                "Firstname": "Non-transferable",
                "Surname": "",
                "Candidate_First_Pref_Votes": "0.00",
                "Transfers": format_votes(row.get("IncomingVotesThisCount")) or "0.00",
                "Total_Votes": format_votes(row.get("TotalVotes")) or "0.00",
                "Status": "",
                "Occurred_On_Count": "",
                "Party_Name": "Non-transferable",
                "Party_Colour": "#666666",
            }
        )
    return rows


def partition_by_year(records: Iterable[CandidateRecord]) -> Dict[int, List[CandidateRecord]]:
    buckets: Dict[int, List[CandidateRecord]] = defaultdict(list)
    for record in records:
        buckets[record.year].append(record)
    return buckets


def party_identifier_factory(records: Iterable[CandidateRecord]) -> Dict[str, str]:
    parties = sorted({rec.party_name for rec in records if rec.party_name})
    mapping: Dict[str, str] = {}
    for idx, party in enumerate(parties, start=1):
        mapping[party] = stringify(idx)
    return mapping


def build_constituency_stats(
    df: pd.DataFrame,
    year: int,
    seat_counts: Dict[Tuple[int, str], int],
) -> Dict[str, Dict[str, object]]:
    summary_rows = df[
        (df["ResultType"] != "Candidate")
        & (df["Event"] == "DevolvedElection")
        & (df["ElectedBody"] == "Northern Ireland Assembly")
        & (df["Date"].dt.year == year)
    ]
    stats: Dict[str, Dict[str, object]] = {}
    for constituency, group in summary_rows.groupby("Constituency"):
        if constituency not in CONSTITUENCIES:
            continue
        records = {row["ResultType"]: row.get("Votes1") for _, row in group.iterrows()}
        electorate = records.get("Electorate")
        did_not_vote = records.get("Did not vote")
        spoiled = records.get("Spoiled")
        quota = records.get("Quota")
        total_poll = None
        valid_poll = None
        if electorate is not None and did_not_vote is not None:
            total_poll = float(electorate) - float(did_not_vote)
        if total_poll is not None and spoiled is not None:
            valid_poll = float(total_poll) - float(spoiled)
        seats = seat_counts.get((year, constituency))
        stats[constituency] = {
            "Constituency_Name": constituency,
            "Constituency_Number": stringify(CONSTITUENCIES[constituency]["number"]),
            "Directory": CONSTITUENCIES[constituency]["directory"],
            "Number_Of_Seats": stringify(seats) if seats is not None else "",
            "Quota": stringify(quota),
            "Total_Electorate": stringify(electorate),
            "Total_Poll": stringify(total_poll),
            "Valid_Poll": stringify(valid_poll),
            "Spoiled": stringify(spoiled),
            "Voting_Age_Pop": "",
        }
    return stats


def write_json(path: Path, payload) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=4, ensure_ascii=False)


def write_count_csv(path: Path, rows: Iterable[Dict[str, object]]) -> None:
    ensure_dir(path.parent)
    columns = [
        "Constituency_Number",
        "Candidate_Id",
        "Count_Number",
        "Firstname",
        "Surname",
        "Candidate_First_Pref_Votes",
        "Transfers",
        "Total_Votes",
        "Status",
        "Occurred_On_Count",
        "Party_Name",
    ]
    df = pd.DataFrame(rows, columns=columns)
    df.to_csv(path, index=False)


def build_year_outputs(
    year: int,
    candidates: List[CandidateRecord],
    party_ids: Dict[str, str],
    stats: Dict[str, Dict[str, object]],
    candidate_state_lookup: Dict[Tuple[int, str], pd.DataFrame],
    seat_counts: Dict[Tuple[int, str], int],
) -> List[Path]:
    written: List[Path] = []
    year_root = Path(str(year))
    ni_root = year_root / "NI"

    # all-candidates.json
    constituency_payload = []
    candidates_by_constituency: Dict[str, List[CandidateRecord]] = defaultdict(list)
    for record in candidates:
        candidates_by_constituency[record.constituency].append(record)
    for constituency, records in sorted(candidates_by_constituency.items()):
        meta = CONSTITUENCIES[constituency]
        entry = {
            "Constituency_Name": constituency,
            "Constituency_Number": stringify(meta["number"]),
            "Candidates": [rec.as_candidate_row(party_ids.get(rec.party_name, "")) for rec in records],
        }
        constituency_payload.append(entry)
    path = ni_root / "all-candidates.json"
    write_json(path, {"Constituencies": constituency_payload})
    written.append(path)

    # all-party-candidates.json
    party_payload = []
    candidates_by_party: Dict[str, List[CandidateRecord]] = defaultdict(list)
    for record in candidates:
        candidates_by_party[record.party_name].append(record)
    for party_name, records in sorted(candidates_by_party.items()):
        entry = {
            "Party_Name": party_name,
            "Party_Number": party_ids.get(party_name, ""),
            "Candidates": [rec.as_candidate_row(party_ids.get(rec.party_name, "")) for rec in records],
        }
        party_payload.append(entry)
    path = ni_root / "all-party-candidates.json"
    write_json(path, {"Parties": party_payload})
    written.append(path)

    # all-elected.json & all-elected-d3.json
    elected_by_constituency = []
    elected_flat = []
    for constituency, records in sorted(candidates_by_constituency.items()):
        elected = [rec for rec in records if rec.outcome.lower() == "elected"]
        entry = {
            "Constituency_Name": constituency,
            "Constituency_Number": stringify(CONSTITUENCIES[constituency]["number"]),
            "Elected": [rec.as_elected_row() for rec in elected],
        }
        elected_by_constituency.append(entry)
        for rec in elected:
            colour = PARTY_COLOUR_RESOLVER.colour_for(rec.party_name) or "#9E9E9E"
            elected_flat.append(rec.as_elected_d3_row(colour))
    path = ni_root / "all-elected.json"
    write_json(path, {"Constituencies": elected_by_constituency})
    written.append(path)

    path = ni_root / "all-elected-d3.json"
    write_json(path, elected_flat)
    written.append(path)

    # all-constituency-info.json
    info_payload = []
    for constituency, records in sorted(candidates_by_constituency.items()):
        fallback_seats = seat_counts.get((year, constituency))
        meta = stats.get(constituency, {
            "Constituency_Name": constituency,
            "Constituency_Number": stringify(CONSTITUENCIES[constituency]["number"]),
            "Directory": CONSTITUENCIES[constituency]["directory"],
            "Number_Of_Seats": stringify(fallback_seats) if fallback_seats is not None else "",
            "Quota": "",
            "Total_Electorate": "",
            "Total_Poll": "",
            "Valid_Poll": "",
            "Spoiled": "",
            "Voting_Age_Pop": "",
        })
        entry = {
            "Constituency_Name": constituency,
            "Constituency_Number": int(CONSTITUENCIES[constituency]["number"]),
            "Directory": meta["Directory"],
            "countInfo": {
                "Valid_Poll": meta["Valid_Poll"],
                "Number_Of_Seats": meta["Number_Of_Seats"],
                "Total_Poll": meta["Total_Poll"],
                "Voting_Age_Pop": meta["Voting_Age_Pop"],
                "Quota": meta["Quota"],
                "Constituency_Name": constituency,
                "Constituency_Number": meta["Constituency_Number"],
                "Total_Electorate": meta["Total_Electorate"],
                "Spoiled": meta["Spoiled"],
            },
        }
        info_payload.append(entry)
    path = ni_root / "all-constituency-info.json"
    write_json(path, {"Constituencies": info_payload})
    written.append(path)

    # party-transfers.json (best-effort placeholder for now)
    # The current implementation aggregates donor/recipient totals per count but
    # does not yet faithfully reproduce the historic dataset.  The stub keeps
    # the front-end tolerant by emitting an empty structure for each
    # constituency so that AJAX requests continue to resolve.
    transfer_payload = []
    for constituency in sorted(candidates_by_constituency.keys()):
        transfer_payload.append({"Constituency_Name": constituency, "Counts": []})
    path = ni_root / "party-transfers.json"
    write_json(path, transfer_payload)
    written.append(path)

    # constituency level CSV / JSON time series
    for constituency, records in sorted(candidates_by_constituency.items()):
        directory = CONSTITUENCIES[constituency]["directory"]
        const_dir = year_root / "constituency" / directory
        count_rows = []
        json_rows = []
        for idx, record in enumerate(records):
            colour = PARTY_COLOUR_RESOLVER.colour_for(record.party_name) or "#9E9E9E"
            for count_entry in record.iter_count_rows(colour):
                count_rows.append(count_entry)
                json_rows.append({
                    **count_entry,
                    "id": len(json_rows),
                })
        for extra in build_non_transferable_counts(candidate_state_lookup, year, constituency):
            count_rows.append(extra)
            json_rows.append({**extra, "id": len(json_rows)})
        write_count_csv(const_dir / "Count.csv", count_rows)
        written.append(const_dir / "Count.csv")
        write_json(
            const_dir / "ResultsJson.json",
            {"Constituency": {"countInfo": stats.get(constituency, {}), "countGroup": json_rows}},
        )
        written.append(const_dir / "ResultsJson.json")

    return written


def main() -> None:
    results_df, candidate_state_df = load_source_data()
    seat_counts = seat_counts_by_year_constituency(results_df)
    target_years = sorted({year for year, constituency in seat_counts.keys() if constituency in CONSTITUENCIES})
    if not target_years:
        assembly_mask = (
            (results_df["ResultType"] == "Candidate")
            & (results_df["Event"] == "DevolvedElection")
            & (results_df["ElectedBody"] == "Northern Ireland Assembly")
            & results_df["Date"].notna()
        )
        target_years = sorted(
            {
                int(year)
                for year in pd.to_datetime(results_df.loc[assembly_mask, "Date"], errors="coerce")
                .dt.year.dropna()
            }
        )
    candidates = extract_candidates(results_df, target_years)
    party_ids = party_identifier_factory(candidates)
    outputs: List[Path] = []
    candidate_state_lookup = build_candidate_state_lookup(candidate_state_df)
    candidates_by_year = partition_by_year(candidates)
    for year, records in sorted(candidates_by_year.items()):
        stats = build_constituency_stats(results_df, year, seat_counts)
        outputs.extend(
            build_year_outputs(
                year,
                records,
                party_ids,
                stats,
                candidate_state_lookup,
                seat_counts,
            )
        )
    print(f"Wrote {len(outputs)} files from workbook; first few: {[str(p) for p in outputs[:5]]}")


if __name__ == "__main__":
    main()
