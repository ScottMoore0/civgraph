#!/usr/bin/env python
"""Build comprehensive election workbook from all available election data sources.

Reads:
  1. election-viewer-package/data/elections/ — JSON constituency files
     (Westminster 1970+, Assembly 1973+, European 1979+, Convention, Forum,
      Local Govt 2014+)
  2. _tmp_{year}_lgov/bundle/ — scraped 1973–2005 local election data
  3. _tmp_2011_lgov/bundle/ — scraped 2011 local election data (if available)

Produces:
  Full election tables.xlsx — workbook with ElectionResults and Transfers sheets
  matching the column structure of the existing workbook.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import openpyxl

# ── Column headers (must match build_stv_workbook.py exactly) ─────────────

ELECTION_RESULTS_HEADERS: list[str] = [
    "Date",
    "Event",
    "EventType",
    "ElectedBody",
    "Source Party Name",
    "Deduplicated Party Name",
    "Wikipedia Party Name",
    "ResultType",
    "Party Name",
    "Source Name",
    "Name usually known by",
    "First Name",
    "Last Name",
    "Constituency",
    "Council",
]

for _i in range(1, 24):
    ELECTION_RESULTS_HEADERS.extend([
        f"Votes{_i}",
        f"Transfers{_i}",
        f"TransferSubject{_i}",
        f"TransferName{_i}",
        f"TransferParty{_i}",
    ])

ELECTION_RESULTS_HEADERS.extend([
    "Outcome",
    "%ValidShare",
    "%ElectorateShare",
    "PersonID",
    "DevolvedInstance",
    "WMInstance",
    "EUInstance",
    "TotalInstance",
    "Gender",
    "ElectionKey",
])

TRANSFERS_HEADERS: list[str] = [
    "Date",
    "Event",
    "Constituency",
    "Council",
    "ElectedBody",
    "ResultType",
    "PersonID",
    "Name",
    "Party",
    "Deduplicated Party Name",
    "Wikipedia Party Name",
    "Count",
    "Votes",
    "Transfers",
    "TransferSubject",
    "TransferName",
    "TransferParty",
    "TransferPct",
    "EliminatedThisRound",
    "ElectedThisRound",
    "TransferPartyRelation",
    "RemainingCandidateIDsDesc",
    "RemainingCandidateNamesInIDOrder",
    "RemainingCandidatePartiesAZ",
    "RemainingCandidatePartiesInIDOrder",
    "SourcePersonID",
]

# ── Mappings ──────────────────────────────────────────────────────────────

BODY_SLUG_TO_NAME: dict[str, str] = {
    "house-of-commons-of-the-united-kingdom": "House of Commons of the United Kingdom",
    "northern-ireland-assembly": "Northern Ireland Assembly",
    "european-parliament": "European Parliament",
    "local-government": "Local Government",
    "northern-ireland-constitutional-convention": "Northern Ireland Constitutional Convention",
    "northern-ireland-forum-for-political-dialogue": "Northern Ireland Forum for Political Dialogue",
    "parliament-of-northern-ireland": "Parliament of Northern Ireland",
}

BODY_SLUG_TO_EVENT: dict[str, str] = {
    "house-of-commons-of-the-united-kingdom": "WestminsterElection",
    "northern-ireland-assembly": "DevolvedElection",
    "european-parliament": "EuropeanElection",
    "local-government": "LocalGovernmentElection",
    "northern-ireland-constitutional-convention": "DevolvedElection",
    "northern-ireland-forum-for-political-dialogue": "DevolvedElection",
    "parliament-of-northern-ireland": "StormontElection",
}

# Known by-election dates per body (from the election-viewer data)
BY_ELECTION_THRESHOLD: dict[str, int] = {
    "house-of-commons-of-the-united-kingdom": 5,
    "northern-ireland-assembly": 5,
    "local-government": 10,
}


# ── Helpers ───────────────────────────────────────────────────────────────

def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "—", "–", ""}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value: Any) -> int | None:
    f = parse_float(value)
    return int(f) if f is not None else None


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def slug_to_display(slug: str) -> str:
    """Convert kebab-case slug to display name: 'belfast-east' -> 'Belfast East'."""
    return normalize_space(slug.replace("-", " ").replace("_", " ")).title()


# ── Data loading ──────────────────────────────────────────────────────────

def load_elections_index(base_dir: Path) -> dict[str, dict[str, list[str]]]:
    """Load elections_index.json and build a DEA-slug→council lookup for local govt."""
    index_path = base_dir / "elections_index.json"
    if not index_path.exists():
        return {}
    with index_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    # Build lookup: (date, dea_slug) -> council_name
    lookup: dict[tuple[str, str], str] = {}
    for body in data.get("bodies", []):
        if body.get("bodyGroup") != "local-government":
            continue
        council_name = body["name"]
        for date_entry in body.get("dates", []):
            date_str = date_entry["date"]
            for constituency in date_entry.get("constituencies", []):
                dea_slug = re.sub(r"\s+", "-", constituency.strip().lower())
                lookup[(date_str, dea_slug)] = council_name
    return lookup


def discover_election_viewer_data(base_dir: Path) -> list[dict]:
    """Discover all constituency JSON files from the election-viewer-package."""
    elections_dir = base_dir / "election-viewer-package" / "data" / "elections"
    if not elections_dir.exists():
        print(f"  Warning: {elections_dir} not found")
        return []

    dea_council_lookup = load_elections_index(elections_dir.parent)
    entries: list[dict] = []

    for body_dir in sorted(elections_dir.iterdir()):
        if not body_dir.is_dir():
            continue
        body_slug = body_dir.name
        if body_slug not in BODY_SLUG_TO_NAME:
            continue

        for date_dir in sorted(body_dir.iterdir()):
            if not date_dir.is_dir():
                continue
            date_str = date_dir.name

            constituency_files = sorted(
                p for p in date_dir.iterdir()
                if p.suffix == ".json" and not p.name.startswith("_")
            )

            for cfile in constituency_files:
                constituency_slug = cfile.stem

                # Determine council for local government
                council = None
                if body_slug == "local-government":
                    council = dea_council_lookup.get((date_str, constituency_slug))

                entries.append({
                    "body_slug": body_slug,
                    "date": date_str,
                    "constituency_slug": constituency_slug,
                    "file_path": cfile,
                    "council": council,
                    "source": "election-viewer",
                })

    return entries


def discover_scraped_old_lgov(base_dir: Path) -> list[dict]:
    """Discover scraped 1973–2011 local election bundle data."""
    entries: list[dict] = []
    old_years = [1973, 1977, 1981, 1985, 1989, 1993, 1997, 2001, 2005, 2011]

    for year in old_years:
        bundle_dir = base_dir / f"_tmp_{year}_lgov" / "bundle"
        if not bundle_dir.exists():
            continue

        for bundle_file in sorted(bundle_dir.glob("*_bundle.json")):
            if bundle_file.name == "_combined_bundle.json":
                continue
            entries.append({
                "body_slug": "local-government",
                "year": year,
                "file_path": bundle_file,
                "source": "scraped-old-lgov",
            })

    return entries


def discover_scraped_parliamentary(base_dir: Path) -> list[dict]:
    """Discover scraped pre-1970 parliamentary election bundle data.

    The parliamentary scraper outputs to _tmp_{year}_{body}/bundle/_bundle.json
    where body is 'stormont' or 'westminster'.
    """
    entries: list[dict] = []

    # Stormont elections 1921-1969
    stormont_years = [1921, 1925, 1929, 1933, 1938, 1945, 1949, 1953, 1958, 1962, 1965, 1969]
    for year in stormont_years:
        bundle_file = base_dir / f"_tmp_{year}_stormont" / "bundle" / "_bundle.json"
        if bundle_file.exists():
            entries.append({
                "body_slug": "parliament-of-northern-ireland",
                "year": year,
                "file_path": bundle_file,
                "source": "scraped-parliamentary",
            })

    # Westminster elections 1922-1966
    westminster_years = [1922, 1923, 1924, 1929, 1931, 1935, 1945, 1950, 1951, 1955, 1959, 1964, 1966]
    for year in westminster_years:
        bundle_file = base_dir / f"_tmp_{year}_westminster" / "bundle" / "_bundle.json"
        if bundle_file.exists():
            entries.append({
                "body_slug": "house-of-commons-of-the-united-kingdom",
                "year": year,
                "file_path": bundle_file,
                "source": "scraped-parliamentary",
            })

    return entries


# ── Core processing ───────────────────────────────────────────────────────

def determine_event_type(body_slug: str, date: str, constituency_count: int) -> str:
    """Determine if an election date is a general election or by-election."""
    threshold = BY_ELECTION_THRESHOLD.get(body_slug, 5)
    if constituency_count < threshold:
        return "ByElection"
    return "GeneralElection"


def group_by_candidate(count_group: list[dict]) -> dict[str, list[dict]]:
    """Group countGroup rows by candidate, sorted by count number."""
    candidates: dict[str, list[dict]] = defaultdict(list)
    for row in count_group:
        cid = row.get("Candidate_Id", row.get("candidateName", "unknown"))
        candidates[cid].append(row)
    for cid in candidates:
        candidates[cid].sort(key=lambda r: int(r.get("Count_Number", 1)))
    return dict(candidates)


def compute_donors_per_stage(
    candidates_by_id: dict[str, list[dict]],
    max_count: int,
) -> dict[int, list[dict]]:
    """For each count stage > 1, find candidates with negative transfers (donors)."""
    donors: dict[int, list[dict]] = {}
    for stage in range(2, max_count + 1):
        stage_donors: list[dict] = []
        for cid, rows in candidates_by_id.items():
            for r in rows:
                if int(r.get("Count_Number", 0)) == stage:
                    transfers = parse_float(r.get("Transfers", 0)) or 0
                    if transfers < 0:
                        stage_donors.append(r)
        donors[stage] = stage_donors
    return donors


def process_constituency_json(
    data: dict,
    body_slug: str,
    date: str,
    constituency_name: str,
    council: str | None,
    event: str,
    event_type: str,
    elected_body: str,
) -> tuple[list[dict], list[dict]]:
    """Convert a constituency JSON into ElectionResults and Transfers rows."""
    constituency_data = data.get("Constituency", data)
    count_info = constituency_data.get("countInfo", {})
    count_group = constituency_data.get("countGroup", [])

    if not count_group:
        return [], []

    # Use Constituency_Name from countInfo if available
    display_name = count_info.get("Constituency_Name") or slug_to_display(constituency_name)
    valid_poll = parse_float(count_info.get("Valid_Poll"))
    electorate = parse_float(count_info.get("Total_Electorate"))
    total_poll = parse_float(count_info.get("Total_Poll"))
    spoiled = parse_float(count_info.get("Spoiled"))
    quota = parse_float(count_info.get("Quota"))
    seats = parse_int(count_info.get("Number_Of_Seats"))

    election_key = f"{date}|{elected_body}|{display_name}"

    # Group by candidate
    candidates_by_id = group_by_candidate(count_group)
    max_count = max(
        (int(r.get("Count_Number", 1)) for r in count_group),
        default=1,
    )

    # Compute donors
    donors_per_stage = compute_donors_per_stage(candidates_by_id, max_count)

    election_rows: list[dict] = []
    transfer_rows: list[dict] = []

    for cid, cand_rows in candidates_by_id.items():
        first_row = cand_rows[0]
        candidate_name = first_row.get("candidateName", "")
        firstname = first_row.get("Firstname", "")
        surname = first_row.get("Surname", "")
        party_name = first_row.get("Party_Name", "")
        dedup_party = first_row.get("Deduplicated Party Name")
        wiki_party = first_row.get("Wikipedia Party Name")
        person_id = first_row.get("Candidate_Id")

        # Determine if this is a non-transferable entry
        is_nt = "nontransferable" in candidate_name.lower().replace(" ", "").replace("-", "")

        # Determine outcome — look at all count rows for final status
        outcome = None
        for r in cand_rows:
            status = r.get("Status", "")
            if status == "Elected":
                outcome = "Elected"
                break
            elif status == "Excluded":
                outcome = "Excluded"

        # Build Votes/Transfers columns
        row: dict[str, Any] = {h: None for h in ELECTION_RESULTS_HEADERS}
        row.update({
            "Date": date,
            "Event": event,
            "EventType": event_type,
            "ElectedBody": elected_body,
            "Source Party Name": party_name or None,
            "Deduplicated Party Name": dedup_party,
            "Wikipedia Party Name": wiki_party,
            "ResultType": "NonTransferable" if is_nt else "Candidate",
            "Party Name": party_name or None,
            "Source Name": candidate_name if not is_nt else None,
            "Name usually known by": candidate_name if not is_nt else None,
            "First Name": firstname if not is_nt else None,
            "Last Name": surname if not is_nt else None,
            "Constituency": display_name,
            "Council": council,
            "Outcome": outcome,
            "PersonID": person_id if not is_nt else None,
            "ElectionKey": election_key,
        })

        # Fill Votes/Transfers columns from count data
        # Build a map of count_number -> (total_votes, transfers)
        count_data: dict[int, tuple[float, float]] = {}
        for r in cand_rows:
            cn = int(r.get("Count_Number", 1))
            total = parse_float(r.get("Total_Votes")) or 0
            transfers = parse_float(r.get("Transfers")) or 0
            count_data[cn] = (total, transfers)

        first_pref = parse_float(first_row.get("Candidate_First_Pref_Votes")) or 0
        row["Votes1"] = first_pref

        for stage in range(2, min(max_count + 1, 24)):
            stage_idx = stage  # 1-based
            if stage in count_data:
                total_votes, transfers = count_data[stage]
                row[f"Transfers{stage - 1}"] = transfers

                # Donor info
                stage_donors = donors_per_stage.get(stage, [])
                if stage_donors:
                    donor_ids = ",".join(
                        str(d.get("Candidate_Id", ""))
                        for d in stage_donors
                    )
                    donor_names = ", ".join(
                        d.get("candidateName", "")
                        for d in stage_donors
                    )
                    donor_parties = ", ".join(
                        d.get("Party_Name", "")
                        for d in stage_donors
                    )
                    row[f"TransferSubject{stage - 1}"] = donor_ids or None
                    row[f"TransferName{stage - 1}"] = donor_names or None
                    row[f"TransferParty{stage - 1}"] = donor_parties or None

                if stage <= 23:
                    row[f"Votes{stage}"] = total_votes

        # Compute share percentages
        if not is_nt and valid_poll and first_pref:
            row["%ValidShare"] = round(first_pref / valid_poll * 100, 12)
        if not is_nt and electorate and first_pref:
            row["%ElectorateShare"] = round(first_pref / electorate * 100, 12)

        election_rows.append(row)

        # Build transfer rows (one per candidate per stage)
        prev_total = first_pref
        for stage in range(2, min(max_count + 1, 24)):
            if stage not in count_data:
                continue
            total_votes, transfers = count_data[stage]

            stage_donors = donors_per_stage.get(stage, [])
            donor_ids = ",".join(str(d.get("Candidate_Id", "")) for d in stage_donors) if stage_donors else None
            donor_names = ", ".join(d.get("candidateName", "") for d in stage_donors) if stage_donors else None
            donor_parties = ", ".join(d.get("Party_Name", "") for d in stage_donors) if stage_donors else None
            donor_total = sum(abs(parse_float(d.get("Transfers", 0)) or 0) for d in stage_donors)

            # Determine transfer relation
            relation = "NonTransferable" if is_nt else "Different party"
            if not is_nt:
                if transfers < 0:
                    relation = "Outgoing"
                elif donor_parties and len({p.strip() for p in donor_parties.split(",") if p.strip()}) == 1:
                    if donor_parties.split(",")[0].strip() == party_name:
                        relation = "Same party"

            transfer_pct = None
            if donor_total > 0 and transfers is not None:
                transfer_pct = round(abs(transfers) / donor_total * 100, 12)

            source_person_id = None
            if len(stage_donors) == 1:
                source_person_id = stage_donors[0].get("Candidate_Id")

            trow: dict[str, Any] = {h: None for h in TRANSFERS_HEADERS}
            trow.update({
                "Date": date,
                "Event": event,
                "Constituency": display_name,
                "Council": council,
                "ElectedBody": elected_body,
                "ResultType": "NonTransferable" if is_nt else "Candidate",
                "PersonID": person_id if not is_nt else None,
                "Name": candidate_name if not is_nt else None,
                "Party": party_name or None,
                "Deduplicated Party Name": dedup_party,
                "Wikipedia Party Name": wiki_party,
                "Count": stage - 1,
                "Votes": prev_total,
                "Transfers": transfers,
                "TransferSubject": donor_ids,
                "TransferName": donor_names,
                "TransferParty": donor_parties,
                "TransferPct": transfer_pct,
                "EliminatedThisRound": bool(transfers < 0 and not is_nt and outcome == "Excluded"),
                "ElectedThisRound": bool(transfers < 0 and not is_nt and outcome == "Elected"),
                "TransferPartyRelation": relation,
                "SourcePersonID": source_person_id,
            })
            transfer_rows.append(trow)
            prev_total = total_votes

    # Summary rows (Electorate, Quota, Spoiled, Did not vote)
    summary_items = [
        ("Electorate", electorate),
        ("Quota", quota),
        ("Spoiled", spoiled),
        ("Did not vote", (electorate - total_poll) if electorate is not None and total_poll is not None else None),
    ]
    for result_type, value in summary_items:
        if value is None:
            continue
        srow: dict[str, Any] = {h: None for h in ELECTION_RESULTS_HEADERS}
        srow.update({
            "Date": date,
            "Event": event,
            "EventType": event_type,
            "ElectedBody": elected_body,
            "ResultType": result_type,
            "Constituency": display_name,
            "Council": council,
            "Votes1": value,
            "ElectionKey": election_key,
        })
        election_rows.append(srow)

    return election_rows, transfer_rows


def process_forum_json(
    data: dict,
    date: str,
    constituency_slug: str,
    event: str,
    event_type: str,
    elected_body: str,
) -> list[dict]:
    """Convert NI Forum d'Hondt party-list JSON into ElectionResults rows."""
    constituency_data = data.get("Constituency", data)
    count_info = constituency_data.get("countInfo", {})
    forum_data = constituency_data.get("forum", {})

    display_name = count_info.get("Constituency_Name") or slug_to_display(constituency_slug)
    valid_poll = parse_float(count_info.get("Valid_Poll"))
    electorate = parse_float(count_info.get("Total_Electorate"))
    total_poll = parse_float(count_info.get("Total_Poll"))
    spoiled = parse_float(count_info.get("Spoiled"))
    election_key = f"{date}|{elected_body}|{display_name}"

    election_rows: list[dict] = []

    for party_entry in forum_data.get("rows", []):
        party_name = party_entry.get("party", "")
        party_votes = parse_float(party_entry.get("votes"))

        for cand in party_entry.get("list_candidates", []):
            cand_name = cand.get("name", "")
            person_id = cand.get("person_id")
            outcome_raw = cand.get("outcome", "")
            outcome = "Elected" if "Elected" in outcome_raw else None

            # Split name
            parts = cand_name.strip().split()
            firstname = " ".join(parts[:-1]) if len(parts) > 1 else ""
            surname = parts[-1] if parts else ""

            row: dict[str, Any] = {h: None for h in ELECTION_RESULTS_HEADERS}
            row.update({
                "Date": date,
                "Event": event,
                "EventType": event_type,
                "ElectedBody": elected_body,
                "Source Party Name": party_name or None,
                "ResultType": "Candidate",
                "Party Name": party_name or None,
                "Source Name": cand_name,
                "Name usually known by": cand_name,
                "First Name": firstname,
                "Last Name": surname,
                "Constituency": display_name,
                "Outcome": outcome,
                "PersonID": person_id,
                "ElectionKey": election_key,
                "Votes1": party_votes,
            })

            if valid_poll and party_votes:
                row["%ValidShare"] = round(party_votes / valid_poll * 100, 12)
            if electorate and party_votes:
                row["%ElectorateShare"] = round(party_votes / electorate * 100, 12)

            election_rows.append(row)

    # Summary rows
    summary_items = [
        ("Electorate", electorate),
        ("Spoiled", spoiled),
        ("Did not vote", (electorate - total_poll) if electorate is not None and total_poll is not None else None),
    ]
    for result_type, value in summary_items:
        if value is None:
            continue
        srow: dict[str, Any] = {h: None for h in ELECTION_RESULTS_HEADERS}
        srow.update({
            "Date": date,
            "Event": event,
            "EventType": event_type,
            "ElectedBody": elected_body,
            "ResultType": result_type,
            "Constituency": display_name,
            "Votes1": value,
            "ElectionKey": election_key,
        })
        election_rows.append(srow)

    return election_rows


# ── Main orchestration ────────────────────────────────────────────────────

def process_election_viewer_entries(entries: list[dict]) -> tuple[list[dict], list[dict]]:
    """Process all election-viewer constituency files."""
    all_election_rows: list[dict] = []
    all_transfer_rows: list[dict] = []

    # Count constituencies per body/date for event type detection
    constituency_counts: dict[tuple[str, str], int] = defaultdict(int)
    for entry in entries:
        key = (entry["body_slug"], entry["date"])
        constituency_counts[key] += 1

    for entry in entries:
        body_slug = entry["body_slug"]
        date = entry["date"]
        constituency_slug = entry["constituency_slug"]
        file_path = entry["file_path"]
        council = entry.get("council")

        elected_body = BODY_SLUG_TO_NAME[body_slug]
        event = BODY_SLUG_TO_EVENT[body_slug]
        count = constituency_counts[(body_slug, date)]
        event_type = determine_event_type(body_slug, date, count)

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  Warning: failed to read {file_path}: {exc}")
            continue

        # Forum uses d'Hondt party-list format, not STV
        if body_slug == "northern-ireland-forum-for-political-dialogue":
            e_rows = process_forum_json(
                data, date, constituency_slug, event, event_type, elected_body,
            )
            all_election_rows.extend(e_rows)
        else:
            e_rows, t_rows = process_constituency_json(
                data, body_slug, date, constituency_slug,
                council, event, event_type, elected_body,
            )
            all_election_rows.extend(e_rows)
            all_transfer_rows.extend(t_rows)

    return all_election_rows, all_transfer_rows


def process_scraped_old_lgov(entries: list[dict]) -> tuple[list[dict], list[dict]]:
    """Process scraped old local government bundle files."""
    all_election_rows: list[dict] = []
    all_transfer_rows: list[dict] = []

    elected_body = "Local Government"
    event = "LocalGovernmentElection"
    event_type = "GeneralElection"

    for entry in entries:
        file_path = entry["file_path"]
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                bundle = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  Warning: failed to read {file_path}: {exc}")
            continue

        date = bundle.get("date", "")
        council = bundle.get("council", "")

        constituencies = bundle.get("constituencies", {})
        for dea_name, dea_data in constituencies.items():
            e_rows, t_rows = process_constituency_json(
                dea_data, "local-government", date, dea_name,
                council, event, event_type, elected_body,
            )
            all_election_rows.extend(e_rows)
            all_transfer_rows.extend(t_rows)

    return all_election_rows, all_transfer_rows


def process_scraped_parliamentary(entries: list[dict]) -> tuple[list[dict], list[dict]]:
    """Process scraped pre-1970 parliamentary bundle files (Stormont + Westminster)."""
    all_election_rows: list[dict] = []
    all_transfer_rows: list[dict] = []

    for entry in entries:
        file_path = entry["file_path"]
        body_slug = entry["body_slug"]
        elected_body = BODY_SLUG_TO_NAME[body_slug]
        event = BODY_SLUG_TO_EVENT[body_slug]
        event_type = "GeneralElection"

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                bundle = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  Warning: failed to read {file_path}: {exc}")
            continue

        date = bundle.get("date", "")
        constituencies = bundle.get("constituencies", {})

        for constituency_name, const_data in constituencies.items():
            e_rows, t_rows = process_constituency_json(
                const_data, body_slug, date, constituency_name,
                None, event, event_type, elected_body,
            )
            all_election_rows.extend(e_rows)
            all_transfer_rows.extend(t_rows)

    return all_election_rows, all_transfer_rows


def write_workbook(
    election_rows: list[dict],
    transfer_rows: list[dict],
    output_path: Path,
) -> None:
    """Write the workbook with ElectionResults and Transfers sheets."""
    wb = openpyxl.Workbook()
    ws_results = wb.active
    ws_results.title = "ElectionResults"
    ws_results.append(ELECTION_RESULTS_HEADERS)
    for row in election_rows:
        ws_results.append([row.get(h) for h in ELECTION_RESULTS_HEADERS])

    ws_transfers = wb.create_sheet("Transfers")
    ws_transfers.append(TRANSFERS_HEADERS)
    for row in transfer_rows:
        ws_transfers.append([row.get(h) for h in TRANSFERS_HEADERS])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build comprehensive election workbook from all data sources",
    )
    parser.add_argument(
        "--base-dir",
        default=".",
        help="Project root directory (default: current directory)",
    )
    parser.add_argument(
        "--output",
        default="Full election tables.xlsx",
        help="Output XLSX path (default: 'Full election tables.xlsx')",
    )
    args = parser.parse_args()

    base_dir = Path(args.base_dir).resolve()
    output_path = base_dir / args.output

    print("Discovering election data sources...")

    # 1. Election-viewer data
    print("\n  [1/3] Election-viewer package...")
    ev_entries = discover_election_viewer_data(base_dir)
    body_date_counts: dict[str, int] = defaultdict(int)
    for e in ev_entries:
        body_date_counts[e["body_slug"]] += 1
    for body, count in sorted(body_date_counts.items()):
        print(f"    {BODY_SLUG_TO_NAME.get(body, body)}: {count} constituency files")

    # 2. Scraped old local government data
    print("\n  [2/3] Scraped old local government data...")
    lgov_entries = discover_scraped_old_lgov(base_dir)
    if lgov_entries:
        years_found = sorted({e["year"] for e in lgov_entries})
        print(f"    Found {len(lgov_entries)} council bundles for years: {years_found}")
    else:
        print("    No scraped old local government data found")

    # 3. Scraped pre-1970 parliamentary data
    print("\n  [3/3] Scraped pre-1970 parliamentary data...")
    parl_entries = discover_scraped_parliamentary(base_dir)
    if parl_entries:
        stormont_years = sorted({e["year"] for e in parl_entries if e["body_slug"] == "parliament-of-northern-ireland"})
        westminster_years = sorted({e["year"] for e in parl_entries if e["body_slug"] == "house-of-commons-of-the-united-kingdom"})
        if stormont_years:
            print(f"    Parliament of NI (Stormont): {len(stormont_years)} elections — {stormont_years}")
        if westminster_years:
            print(f"    Westminster (pre-1970): {len(westminster_years)} elections — {westminster_years}")
    else:
        print("    No scraped parliamentary data found")

    # Process
    print("\nProcessing election-viewer data...")
    ev_election_rows, ev_transfer_rows = process_election_viewer_entries(ev_entries)
    print(f"  -> {len(ev_election_rows)} election rows, {len(ev_transfer_rows)} transfer rows")

    print("Processing scraped old local government data...")
    lgov_election_rows, lgov_transfer_rows = process_scraped_old_lgov(lgov_entries)
    print(f"  -> {len(lgov_election_rows)} election rows, {len(lgov_transfer_rows)} transfer rows")

    print("Processing scraped parliamentary data...")
    parl_election_rows, parl_transfer_rows = process_scraped_parliamentary(parl_entries)
    print(f"  -> {len(parl_election_rows)} election rows, {len(parl_transfer_rows)} transfer rows")

    # Combine and sort
    all_election_rows = ev_election_rows + lgov_election_rows + parl_election_rows
    all_transfer_rows = ev_transfer_rows + lgov_transfer_rows + parl_transfer_rows

    # Sort by date, then elected body, then constituency
    all_election_rows.sort(key=lambda r: (r.get("Date") or "", r.get("ElectedBody") or "", r.get("Constituency") or "", r.get("ResultType", "") != "Candidate", r.get("Source Name") or ""))
    all_transfer_rows.sort(key=lambda r: (r.get("Date") or "", r.get("ElectedBody") or "", r.get("Constituency") or "", r.get("Name") or "", r.get("Count") or 0))

    # Write
    print(f"\nWriting workbook to {output_path}...")
    write_workbook(all_election_rows, all_transfer_rows, output_path)

    # Summary
    unique_elections = {(r["Date"], r["ElectedBody"]) for r in all_election_rows if r.get("ResultType") == "Candidate"}
    unique_bodies = {r["ElectedBody"] for r in all_election_rows if r.get("ResultType") == "Candidate"}

    print(f"\n{'='*60}")
    print(f"  SUMMARY")
    print(f"{'='*60}")
    print(f"  Total election rows: {len(all_election_rows)}")
    print(f"  Total transfer rows: {len(all_transfer_rows)}")
    print(f"  Unique election dates: {len(unique_elections)}")
    print(f"  Elected bodies: {len(unique_bodies)}")
    for body in sorted(unique_bodies):
        body_elections = sorted({r["Date"] for r in all_election_rows if r.get("ElectedBody") == body and r.get("ResultType") == "Candidate"})
        candidates = sum(1 for r in all_election_rows if r.get("ElectedBody") == body and r.get("ResultType") == "Candidate")
        print(f"    {body}: {len(body_elections)} elections, {candidates} candidacies")
        if body_elections:
            print(f"      Date range: {body_elections[0]} to {body_elections[-1]}")
    print(f"\n  Output: {output_path}")
    print(f"  Size: {output_path.stat().st_size / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
