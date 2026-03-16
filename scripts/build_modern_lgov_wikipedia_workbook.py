#!/usr/bin/env python
"""Build a modern NI local-election workbook from 2014/2019/2023 Wikipedia raw wikitext."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Any

from build_stv_workbook import (
    ELECTION_RESULTS_HEADERS,
    TRANSFERS_HEADERS,
    PersonRegistry,
    split_name,
    write_workbook,
)
from modern_lgov_wikipedia_common import COUNCIL_DISPLAY_BY_KEY, parse_count_tables


DATE_BY_YEAR = {
    "2014": "2014-05-22",
    "2019": "2019-05-02",
    "2023": "2023-05-18",
}


def normalize_party(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def last_non_null_count_index(counts: list[float | None]) -> int | None:
    for idx in range(len(counts) - 1, -1, -1):
        if counts[idx] is not None:
            return idx + 1
    return None


def determine_distribution_schedule(analyzed: list[dict[str, Any]], district: dict[str, Any]) -> None:
    """Assign distribution_stage to each elected candidate with a surplus.

    Wikipedia blanks elected candidates immediately after their election count,
    regardless of when their surplus is actually distributed.  This function
    uses the delta sums between consecutive Wikipedia count columns to determine
    which stage each surplus is really distributed at.

    Each stage has exactly one event: either a surplus distribution or an
    elimination.  Eliminations are identified by a candidate with that
    exit_count who is not elected.  The remaining stages are matched to
    surplus distributions by comparing the positive delta sum to the surplus
    amount (closest match where surplus >= delta_sum).
    """
    numcounts = district.get("numcounts") or 0

    # Default: distribution_stage = exit_count
    for entry in analyzed:
        entry["distribution_stage"] = entry["exit_count"]

    # All elected candidates with surpluses
    surplus_candidates = [
        entry for entry in analyzed
        if entry["status"] == "Elected"
        and entry["exit_transfer"] is not None
        and entry["exit_count"] is not None
    ]
    if len(surplus_candidates) <= 1:
        return  # No ambiguity with 0 or 1 surplus

    # Identify stages that are elimination events (non-elected candidate goes blank)
    elimination_stages: set[int] = set()
    for entry in analyzed:
        if entry["status"] in ("Eliminated",) and entry["exit_count"] is not None:
            elimination_stages.add(entry["exit_count"])

    # Compute positive delta sums for each stage
    stage_deltas: dict[int, float] = {}
    for stage in range(1, numcounts):
        delta_sum = 0.0
        for entry in analyzed:
            counts = entry.get("counts", [])
            ec = entry["exit_count"] or 0
            # Need counts[stage] and counts[stage-1] both non-null (stage < ec)
            if stage < ec and stage < len(counts) and stage - 1 < len(counts):
                prev_val = counts[stage - 1]
                curr_val = counts[stage]
                if prev_val is not None and curr_val is not None:
                    delta = curr_val - prev_val
                    if delta > 0:
                        delta_sum += delta
        stage_deltas[stage] = delta_sum

    # Surplus events can only happen on non-elimination stages.
    surplus_stages = [
        stage
        for stage in range(1, numcounts)
        if stage not in elimination_stages and stage_deltas.get(stage, 0) >= 0.01
    ]
    used_stages: set[int] = set()

    # Stage-first greedy assignment with hard constraints:
    # 1) one surplus donor per stage,
    # 2) donor cannot distribute before being elected (distribution_stage >= exit_count).
    remaining = list(surplus_candidates)
    for stage in surplus_stages:
        eligible = [entry for entry in remaining if (entry["exit_count"] or 0) <= stage]
        if not eligible:
            continue
        delta = stage_deltas.get(stage, 0.0)
        best_match = None
        best_score = float("inf")
        for entry in eligible:
            surplus = abs(entry["exit_transfer"])
            # Prefer plausible fits (surplus >= delta), but still allow fallback if data is noisy.
            deficit_penalty = 0.0 if surplus >= (delta - 0.5) else 10_000.0
            score = deficit_penalty + abs(surplus - delta)
            if score < best_score:
                best_score = score
                best_match = entry
        if best_match is None:
            continue
        best_match["distribution_stage"] = stage
        used_stages.add(stage)
        remaining.remove(best_match)

    # Deterministic fallback for any unmatched surplus donors.
    # If there is no valid stage slot, treat the candidate as elected without
    # a redistributed surplus (deemed elected / terminal count close).
    for entry in list(remaining):
        exit_count = entry["exit_count"] or 1
        preferred = [
            stage for stage in range(exit_count, numcounts)
            if stage not in elimination_stages and stage not in used_stages
        ]
        if preferred:
            chosen = preferred[0]
            entry["distribution_stage"] = chosen
            used_stages.add(chosen)
            remaining.remove(entry)
            continue
        # No legal redistribution stage exists; clear surplus transfer.
        entry["distribution_stage"] = None
        entry["exit_transfer"] = None
        entry["post_exit_total"] = entry.get("last_total")


def validate_distribution_schedule(
    analyzed: list[dict[str, Any]],
    district: dict[str, Any],
) -> None:
    """Fail fast when stage assignment violates STV event invariants."""
    numcounts = district.get("numcounts") or 0
    if numcounts <= 1:
        return

    elimination_stages: dict[int, list[str]] = {}
    for entry in analyzed:
        if entry.get("status") == "Eliminated" and entry.get("exit_transfer") is not None:
            stage = entry.get("exit_count")
            if stage:
                elimination_stages.setdefault(stage, []).append(entry.get("display_name") or entry.get("candidate") or "?")

    surplus_stages: dict[int, list[str]] = {}
    for entry in analyzed:
        if entry.get("status") != "Elected" or entry.get("exit_transfer") is None:
            continue
        stage = entry.get("distribution_stage")
        exit_count = entry.get("exit_count") or 0
        if not stage:
            continue
        if stage < exit_count:
            raise ValueError(
                f"Invalid distribution stage in {district.get('dea_name')}: "
                f"{entry.get('display_name')} has distribution_stage={stage} < exit_count={exit_count}"
            )
        surplus_stages.setdefault(stage, []).append(entry.get("display_name") or entry.get("candidate") or "?")

    for stage, names in surplus_stages.items():
        if len(names) > 1:
            raise ValueError(
                f"Combined surplus stage in {district.get('dea_name')} stage {stage}: {', '.join(names)}"
            )
        if stage in elimination_stages:
            raise ValueError(
                f"Mixed elimination/surplus stage in {district.get('dea_name')} stage {stage}: "
                f"surplus={', '.join(names)} elimination={', '.join(elimination_stages[stage])}"
            )


def analyze_district(district: dict[str, Any], person_registry: PersonRegistry) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    seats = district.get("seats") or 0
    quota = district.get("quota")
    numcounts = district.get("numcounts") or 0
    analyzed: list[dict[str, Any]] = []

    for candidate in district["candidates"]:
        display_name, _, _ = split_name(candidate["candidate"])
        person_id = person_registry.get(display_name or candidate["candidate"])
        counts = candidate.get("counts", [])
        exit_count = last_non_null_count_index(counts)
        last_total = counts[exit_count - 1] if exit_count else None
        explicit_elected = candidate.get("outcome") == "Elected"
        quota_elected = quota is not None and last_total is not None and last_total >= quota
        analyzed.append(
            {
                **candidate,
                "display_name": display_name or candidate["candidate"],
                "person_id": person_id,
                "exit_count": exit_count,
                "last_total": last_total,
                "status": "Elected" if explicit_elected or quota_elected else None,
                "numcounts": numcounts,
            }
        )

    max_exit = max((entry["exit_count"] or 0) for entry in analyzed) if analyzed else 0
    elected_so_far = sum(1 for entry in analyzed if entry["status"] == "Elected")
    unresolved_final = [entry for entry in analyzed if entry["status"] is None and entry["exit_count"] == max_exit]
    seats_remaining = max(0, seats - elected_so_far)
    unresolved_final.sort(key=lambda entry: ((entry["last_total"] or 0), entry["display_name"]), reverse=True)
    for index, entry in enumerate(unresolved_final):
        entry["status"] = "Elected" if index < seats_remaining else "Not Elected"
    for entry in analyzed:
        if entry["status"] is None:
            entry["status"] = "Eliminated" if (entry["exit_count"] or 0) < max_exit else "Not Elected"

        exit_count = entry["exit_count"] or 0
        last_total = entry["last_total"] or 0.0
        exit_transfer = None
        post_exit_total = last_total
        if exit_count:
            if entry["status"] == "Elected" and quota is not None and last_total > quota:
                exit_transfer = round(-(last_total - quota), 2)
                post_exit_total = quota
            elif entry["status"] == "Eliminated":
                exit_transfer = round(-last_total, 2)
                post_exit_total = 0.0
        entry["exit_transfer"] = exit_transfer
        entry["post_exit_total"] = post_exit_total

    # Determine and validate distribution stages for surplus transfers.
    determine_distribution_schedule(analyzed, district)
    validate_distribution_schedule(analyzed, district)

    donor_bundles: dict[int, dict[str, Any]] = {}
    for stage in range(1, numcounts + 1):
        donors = [entry for entry in analyzed if entry["distribution_stage"] == stage and entry["exit_transfer"] is not None]
        if not donors:
            continue
        donor_bundles[stage] = {
            "ids": ",".join(str(entry["person_id"]) for entry in donors if entry["person_id"] is not None) or None,
            "names": ", ".join(entry["display_name"] for entry in donors) or None,
            "parties": ", ".join(normalize_party(entry.get("party")) or "" for entry in donors).strip(", ") or None,
        }
    return analyzed, donor_bundles


def build_candidate_timeline(candidate: dict[str, Any], donor_bundles: dict[int, dict[str, Any]]) -> tuple[list[float | None], list[float | None], list[str | None], list[str | None], list[str | None]]:
    numcounts = candidate["numcounts"]
    exit_count = candidate["exit_count"] or 0
    distribution_stage = candidate.get("distribution_stage") or exit_count
    counts = candidate.get("counts", [])
    current = counts[0] if counts else None

    votes: list[float | None] = [None] * 23
    transfers: list[float | None] = [None] * 23
    transfer_subjects: list[str | None] = [None] * 23
    transfer_names: list[str | None] = [None] * 23
    transfer_parties: list[str | None] = [None] * 23
    if current is not None:
        votes[0] = current

    for stage in range(1, min(23, numcounts) + 1):
        if current is None:
            break
        if stage == distribution_stage and candidate["exit_transfer"] is not None:
            # Surplus deduction happens at distribution_stage (may differ from exit_count).
            transfer_value = candidate["exit_transfer"]
            transfer_subjects[stage - 1] = str(candidate["person_id"]) if candidate["person_id"] is not None else None
            transfer_names[stage - 1] = candidate["display_name"]
            transfer_parties[stage - 1] = normalize_party(candidate.get("party"))
            current = candidate["post_exit_total"]
        elif stage < exit_count:
            next_total = counts[stage] if stage < len(counts) else current
            transfer_value = None if next_total is None else round(next_total - current, 2)
            if transfer_value is not None and transfer_value < 0:
                # Non-donor rows should not emit negative transfer events.
                # Keep vote continuity from source counts, but suppress synthetic
                # negative redistribution markers outside donor stages.
                transfer_value = 0.0
            bundle = donor_bundles.get(stage)
            if bundle:
                transfer_subjects[stage - 1] = bundle["ids"]
                transfer_names[stage - 1] = bundle["names"]
                transfer_parties[stage - 1] = bundle["parties"]
            current = next_total
        elif stage >= exit_count and exit_count:
            # Between exit_count and distribution_stage, or after distribution:
            # candidate sits at their current total, receiving 0 transfer
            transfer_value = 0.0
            bundle = donor_bundles.get(stage)
            if bundle:
                transfer_subjects[stage - 1] = bundle["ids"]
                transfer_names[stage - 1] = bundle["names"]
                transfer_parties[stage - 1] = bundle["parties"]
        else:
            transfer_value = None
        transfers[stage - 1] = transfer_value
        if stage < 23:
            votes[stage] = current

    return votes, transfers, transfer_subjects, transfer_names, transfer_parties


def make_candidate_row(
    *,
    date: str,
    election_key: str,
    council: str,
    dea_name: str,
    electorate: float | None,
    candidate: dict[str, Any],
    donor_bundles: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    row: dict[str, Any] = {header: None for header in ELECTION_RESULTS_HEADERS}
    display_name, first_name, last_name = split_name(candidate["candidate"])
    source_party = normalize_party(candidate.get("party"))
    votes, transfers, transfer_subjects, transfer_names, transfer_parties = build_candidate_timeline(candidate, donor_bundles)
    row.update(
        {
            "Date": date,
            "Event": "LocalGovernmentElection",
            "EventType": "GeneralElection",
            "ElectedBody": "Local Government",
            "Source Party Name": source_party,
            "Deduplicated Party Name": source_party,
            "Wikipedia Party Name": source_party,
            "ResultType": "Candidate",
            "Party Name": source_party,
            "Source Name": candidate["candidate"],
            "Name usually known by": display_name,
            "First Name": first_name,
            "Last Name": last_name,
            "Constituency": dea_name,
            "Council": council,
            "Outcome": candidate["status"],
            "%ValidShare": candidate.get("percentage"),
            "%ElectorateShare": None if electorate in (None, 0) or votes[0] is None else round(votes[0] / electorate * 100, 12),
            "PersonID": candidate["person_id"],
            "ElectionKey": election_key,
        }
    )
    for idx, value in enumerate(votes, start=1):
        row[f"Votes{idx}"] = value
    for idx, value in enumerate(transfers, start=1):
        row[f"Transfers{idx}"] = value
        row[f"TransferSubject{idx}"] = transfer_subjects[idx - 1]
        row[f"TransferName{idx}"] = transfer_names[idx - 1]
        row[f"TransferParty{idx}"] = transfer_parties[idx - 1]
    return row


def make_summary_row(
    *,
    date: str,
    election_key: str,
    council: str,
    dea_name: str,
    result_type: str,
    value: float | None,
) -> dict[str, Any] | None:
    if value is None:
        return None
    row: dict[str, Any] = {header: None for header in ELECTION_RESULTS_HEADERS}
    row.update(
        {
            "Date": date,
            "Event": "LocalGovernmentElection",
            "EventType": "GeneralElection",
            "ElectedBody": "Local Government",
            "ResultType": result_type,
            "Constituency": dea_name,
            "Council": council,
            "Votes1": value,
            "ElectionKey": election_key,
        }
    )
    return row


def build_transfer_rows(
    *,
    date: str,
    council: str,
    dea_name: str,
    candidates: list[dict[str, Any]],
    donor_bundles: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for candidate in candidates:
        source_party = normalize_party(candidate.get("party"))
        votes, transfers, transfer_subjects, transfer_names, transfer_parties = build_candidate_timeline(candidate, donor_bundles)
        for count_idx in range(1, min(23, candidate["numcounts"]) + 1):
            current = votes[count_idx - 1]
            if current is None:
                continue
            row = {header: None for header in TRANSFERS_HEADERS}
            row.update(
                {
                    "Date": date,
                    "Event": "LocalGovernmentElection",
                    "Constituency": dea_name,
                    "Council": council,
                    "ElectedBody": "Local Government",
                    "ResultType": "Candidate",
                    "PersonID": candidate["person_id"],
                    "Name": candidate["display_name"],
                    "Party": source_party,
                    "Deduplicated Party Name": source_party,
                    "Wikipedia Party Name": source_party,
                    "Count": count_idx,
                    "Votes": current,
                    "Transfers": transfers[count_idx - 1],
                    "TransferSubject": transfer_subjects[count_idx - 1],
                    "TransferName": transfer_names[count_idx - 1],
                    "TransferParty": transfer_parties[count_idx - 1],
                    "EliminatedThisRound": candidate["status"] == "Eliminated" and candidate["exit_count"] == count_idx,
                    "ElectedThisRound": candidate["status"] == "Elected" and candidate["exit_count"] == count_idx,
                    "SourcePersonID": candidate["person_id"] if candidate.get("distribution_stage", candidate["exit_count"]) == count_idx and candidate["exit_transfer"] is not None else None,
                }
            )
            rows.append(row)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default="_tmp_xls2rar_extract/out/wiki_lgov_modern")
    parser.add_argument("--output", default="_tmp_xls2rar_extract/out/wiki_lgov_modern/lgov-modern-wikipedia.xlsx")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    manifest_path = input_dir / "manifest.csv"
    raw_dir = input_dir / "raw"
    output_path = Path(args.output)

    manifest_rows = [row for row in csv.DictReader(manifest_path.open(encoding="utf-8")) if row["found"] == "yes"]
    election_rows: list[dict[str, Any]] = []
    transfer_rows: list[dict[str, Any]] = []
    person_registry = PersonRegistry()

    for manifest_row in manifest_rows:
        year = manifest_row["year"]
        council_key = manifest_row["council_key"]
        council = COUNCIL_DISPLAY_BY_KEY[council_key]
        date = DATE_BY_YEAR[year]
        election_key = f"local-government-{year}-{council_key}"
        raw_path = raw_dir / f"{year}-{council_key}.wiki"
        wikitext = raw_path.read_text(encoding="utf-8")
        parsed = parse_count_tables(manifest_row["resolved_title"], wikitext)
        for district in parsed["districts"]:
            dea_name = district["dea_name"]
            analyzed_candidates, donor_bundles = analyze_district(district, person_registry)
            for candidate in analyzed_candidates:
                election_rows.append(
                    make_candidate_row(
                        date=date,
                        election_key=election_key,
                        council=council,
                        dea_name=dea_name,
                        electorate=district.get("electorate"),
                        candidate=candidate,
                        donor_bundles=donor_bundles,
                    )
                )
            for result_type, value in (
                ("Electorate", district.get("electorate")),
                ("Quota", district.get("quota")),
                ("Spoiled", district.get("spoilt")),
                ("Did not vote", None if district.get("electorate") is None or district.get("turnout") is None else district["electorate"] - district["turnout"]),
            ):
                summary_row = make_summary_row(
                    date=date,
                    election_key=election_key,
                    council=council,
                    dea_name=dea_name,
                    result_type=result_type,
                    value=value,
                )
                if summary_row:
                    election_rows.append(summary_row)
            transfer_rows.extend(
                build_transfer_rows(
                    date=date,
                    council=council,
                    dea_name=dea_name,
                    candidates=analyzed_candidates,
                    donor_bundles=donor_bundles,
                )
            )

    write_workbook(election_rows, transfer_rows, output_path)


if __name__ == "__main__":
    main()
