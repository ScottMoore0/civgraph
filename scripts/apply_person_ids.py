#!/usr/bin/env python3
"""Apply matched PersonIDs back into local election data files and update the registry.

Reads:
  - person_registry.json (current registry)
  - match_results.json (auto-matched candidates)
  - review_decisions.json (human decisions on ambiguous cases, from HTML review tool)

Writes:
  - Updated _aggregates.json files (personId field on each candidate)
  - Updated _bundle.json files (PersonId field on countGroup records)
  - Updated person_registry.json (new persons added, name variants updated)
"""

import json
import os
import re
import sys
import unicodedata
from pathlib import Path


def normalize_space(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name_for_match(value: str) -> str:
    text = normalize_space(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("\u2019", "'").replace("\u2018", "'")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def main():
    base = Path("C:/Users/scomo/boundaries-website")
    scripts = base / "scripts"
    elections_base = base / "election-viewer-package" / "data" / "elections" / "local-government"

    # Load inputs
    registry_path = scripts / "person_registry.json"
    match_results_path = scripts / "match_results.json"
    review_decisions_path = scripts / "review_decisions.json"

    if not registry_path.exists():
        print("ERROR: person_registry.json not found.")
        sys.exit(1)
    if not match_results_path.exists():
        print("ERROR: match_results.json not found. Run match_candidates.py first.")
        sys.exit(1)

    with open(registry_path, "r", encoding="utf-8") as f:
        registry = json.load(f)
    with open(match_results_path, "r", encoding="utf-8") as f:
        match_results = json.load(f)

    # Review decisions are optional — may not exist yet
    review_decisions = {}
    if review_decisions_path.exists():
        with open(review_decisions_path, "r", encoding="utf-8") as f:
            rd = json.load(f)
        # Expect format: { "decisions": { "amb_0001": { "action": "match"|"new", "personId": 123 }, ... } }
        # or list format from HTML tool: [ { "caseId": "amb_0001", "decision": "match", "selectedPersonId": 123 }, ... ]
        if isinstance(rd, dict) and "decisions" in rd:
            review_decisions = rd["decisions"]
        elif isinstance(rd, list):
            for item in rd:
                cid = item.get("caseId", "")
                decision = item.get("decision", "")
                if decision == "match" and item.get("selectedPersonId"):
                    review_decisions[cid] = {
                        "action": "match",
                        "personId": item["selectedPersonId"],
                    }
                elif decision in ("new", "create_new"):
                    review_decisions[cid] = {"action": "new"}
                elif decision == "skip":
                    review_decisions[cid] = {"action": "skip"}
        print(f"Review decisions loaded: {len(review_decisions)}")
    else:
        print("No review_decisions.json found — only auto-matched IDs will be applied.")

    persons = registry["persons"]
    next_id = registry["meta"]["nextId"]

    # Build the mapping: (candidateId, electionDate) -> personId
    id_map = {}  # (candidateId, electionDate) -> int personId

    # 1. Auto-matched candidates
    for m in match_results.get("autoMatched", []):
        cid = m["candidateId"]
        date = m["electionDate"]
        pid = m["matchedPersonId"]
        id_map[(cid, date)] = int(pid)

    print(f"Auto-matched entries: {len(id_map)}")

    # 2. Review decisions (ambiguous cases)
    ambiguous_path = scripts / "ambiguous_cases.json"
    ambiguous_applied = 0
    new_from_review = 0
    if ambiguous_path.exists() and review_decisions:
        with open(ambiguous_path, "r", encoding="utf-8") as f:
            ambiguous = json.load(f)
        for case in ambiguous.get("cases", []):
            case_id = case["caseId"]
            cand = case["candidate"]
            decision = review_decisions.get(case_id)
            if not decision:
                continue
            if decision["action"] == "match":
                pid = int(decision["personId"])
                id_map[(cand["candidateId"], cand["electionDate"])] = pid
                ambiguous_applied += 1
            elif decision["action"] == "new":
                # Create new person
                pid = next_id
                next_id += 1
                id_map[(cand["candidateId"], cand["electionDate"])] = pid
                persons[str(pid)] = {
                    "personId": pid,
                    "canonicalName": cand["candidateName"],
                    "firstName": cand["firstName"],
                    "lastName": cand["lastName"],
                    "gender": "",
                    "nameVariants": [cand["candidateName"]],
                    "matchKeys": [normalize_name_for_match(cand["candidateName"])],
                    "history": [{
                        "date": cand["electionDate"],
                        "body": "local-government",
                        "party": cand["party"],
                        "constituency": cand["constituency"],
                    }],
                }
                new_from_review += 1

    print(f"Ambiguous resolved: {ambiguous_applied} matched, {new_from_review} new persons")

    # 3. New persons from match_results (no match found at all)
    new_from_unmatched = 0
    for cand in match_results.get("newPersons", []):
        cid = cand["candidateId"]
        date = cand["electionDate"]
        if (cid, date) in id_map:
            continue  # Already handled
        pid = next_id
        next_id += 1
        id_map[(cid, date)] = pid
        persons[str(pid)] = {
            "personId": pid,
            "canonicalName": cand["candidateName"],
            "firstName": cand["firstName"],
            "lastName": cand["lastName"],
            "gender": "",
            "nameVariants": [cand["candidateName"]],
            "matchKeys": [normalize_name_for_match(cand["candidateName"])],
            "history": [{
                "date": cand["electionDate"],
                "body": "local-government",
                "party": cand["party"],
                "constituency": cand["constituency"],
            }],
        }
        new_from_unmatched += 1

    print(f"New persons from unmatched: {new_from_unmatched}")
    print(f"Total ID mappings: {len(id_map)}")
    print(f"Next PersonID: {next_id}")

    # Also build a name-based lookup for candidates that appear in multiple
    # count records (same candidate appears once per count in _bundle.json)
    # Key: (candidateId) -> personId (across all elections)
    cid_to_pid = {}
    for (cid, date), pid in id_map.items():
        cid_to_pid[cid] = pid  # Last one wins, but should be consistent

    # ========================================================
    # Apply to _aggregates.json files
    # ========================================================
    agg_updated = 0
    agg_files = 0
    for date_dir in sorted(os.listdir(elections_base)):
        agg_path = elections_base / date_dir / "_aggregates.json"
        if not agg_path.exists():
            continue

        with open(agg_path, "r", encoding="utf-8") as f:
            agg = json.load(f)

        changed = False
        for council_name, council_data in agg.get("councils", {}).items():
            for cand in council_data.get("candidates", []):
                old_pid = str(cand.get("personId", "")).strip()
                # Look up by the old personId field (which is actually Candidate_Id)
                # Try mapping by (old_pid, date_dir)
                new_pid = id_map.get((old_pid, date_dir))
                if new_pid is None:
                    # Try by candidateId alone
                    new_pid = cid_to_pid.get(old_pid)
                if new_pid is not None:
                    cand["personId"] = str(new_pid)
                    agg_updated += 1
                    changed = True

        if changed:
            agg_files += 1
            with open(agg_path, "w", encoding="utf-8") as f:
                json.dump(agg, f, ensure_ascii=False, indent=4)

    print(f"\n_aggregates.json: {agg_updated} candidates updated across {agg_files} files")

    # ========================================================
    # Apply to _bundle.json files
    # ========================================================
    bundle_updated = 0
    bundle_files = 0
    for date_dir in sorted(os.listdir(elections_base)):
        bundle_path = elections_base / date_dir / "_bundle.json"
        if not bundle_path.exists():
            continue

        with open(bundle_path, "r", encoding="utf-8") as f:
            bundle = json.load(f)

        changed = False
        for const_name, const_data in bundle.get("constituencies", {}).items():
            cg = const_data.get("Constituency", {}).get("countGroup", [])
            for rec in cg:
                cid = rec.get("Candidate_Id", "")
                new_pid = id_map.get((cid, date_dir))
                if new_pid is None:
                    new_pid = cid_to_pid.get(cid)
                if new_pid is not None:
                    rec["PersonId"] = str(new_pid)
                    bundle_updated += 1
                    changed = True

        if changed:
            bundle_files += 1
            with open(bundle_path, "w", encoding="utf-8") as f:
                json.dump(bundle, f, ensure_ascii=False, indent=2)

    print(f"_bundle.json: {bundle_updated} records updated across {bundle_files} files")

    # ========================================================
    # Also apply to individual DEA JSON files
    # ========================================================
    dea_updated = 0
    dea_files = 0
    for date_dir in sorted(os.listdir(elections_base)):
        date_path = elections_base / date_dir
        if not date_path.is_dir():
            continue
        for fname in sorted(os.listdir(date_path)):
            if not fname.endswith(".json") or fname.startswith("_"):
                continue
            fpath = date_path / fname
            with open(fpath, "r", encoding="utf-8") as f:
                dea_data = json.load(f)

            cg = dea_data.get("Constituency", {}).get("countGroup", [])
            if not cg:
                continue

            changed = False
            for rec in cg:
                cid = rec.get("Candidate_Id", "")
                new_pid = id_map.get((cid, date_dir))
                if new_pid is None:
                    new_pid = cid_to_pid.get(cid)
                if new_pid is not None:
                    rec["PersonId"] = str(new_pid)
                    dea_updated += 1
                    changed = True

            if changed:
                dea_files += 1
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump(dea_data, f, ensure_ascii=False, indent=2)

    print(f"Individual DEA files: {dea_updated} records updated across {dea_files} files")

    # ========================================================
    # Update registry
    # ========================================================
    registry["meta"]["nextId"] = next_id
    registry["meta"]["totalPersons"] = len(persons)
    registry["persons"] = {str(pid): data for pid, data in sorted(
        ((int(k), v) for k, v in persons.items()),
        key=lambda x: x[0]
    )}

    with open(registry_path, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)

    print(f"\nRegistry updated: {len(persons)} persons, next ID: {next_id}")
    print("Done.")


if __name__ == "__main__":
    main()
