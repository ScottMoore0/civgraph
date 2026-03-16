#!/usr/bin/env python3
"""Match local election candidates to person registry entries."""

import difflib
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


def extract_candidates_from_bundle(bundle_path: str, election_date: str):
    """Extract unique candidates from a _bundle.json file."""
    with open(bundle_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    candidates = []
    for const_name, const_data in data.get("constituencies", {}).items():
        cg = const_data.get("Constituency", {}).get("countGroup", [])
        seen_ids = set()
        for rec in cg:
            cid = rec.get("Candidate_Id", "")
            surname = rec.get("Surname", "").strip()
            if cid in seen_ids or not surname or surname == "Non-transferable":
                continue
            seen_ids.add(cid)
            first = rec.get("Firstname", "").strip()
            cname = rec.get("candidateName", "").strip()
            party = rec.get("Deduplicated Party Name", "") or rec.get("Party_Name", "")
            party = party.strip()
            candidates.append({
                "candidateId": cid,
                "candidateName": cname,
                "firstName": first,
                "lastName": surname,
                "party": party,
                "constituency": const_name,
                "electionDate": election_date,
                "body": "local-government",
            })
    return candidates


# Party equivalence for scoring
PARTY_ALIASES = {}
_alias_groups = [
    ["Sinn Féin", "Sinn Fein", "Provisional Sinn Féin", "Sinn Féin (Provisional)"],
    ["DUP", "Democratic Unionist Party"],
    ["UUP", "Ulster Unionist Party", "Official Unionist Party"],
    ["SDLP", "Social Democratic and Labour Party"],
    ["Alliance", "Alliance Party of Northern Ireland"],
    ["TUV", "Traditional Unionist Voice"],
    ["Green / Ecology", "Green Party Northern Ireland", "Green Party of Northern Ireland"],
    ["PUP", "Progressive Unionist Party"],
    ["Workers Party / Republican Clubs", "Workers Party", "Workers' Party"],
    ["People Before Profit Alliance", "People Before Profit"],
    ["UKIP", "United Kingdom Independence Party", "UK Independence Party"],
    ["Conservative", "Northern Ireland Conservatives", "Conservative and Unionist Party"],
    ["IRSP", "Irish Republican Socialist Party"],
    ["Aontú", "Aontu"],
]
for group in _alias_groups:
    canonical = group[0]
    for name in group:
        PARTY_ALIASES[normalize_name_for_match(name)] = canonical
        PARTY_ALIASES[name.lower()] = canonical


def normalize_party(party: str) -> str:
    key = normalize_name_for_match(party)
    if key in PARTY_ALIASES:
        return PARTY_ALIASES[key]
    lower = party.lower().strip()
    if lower in PARTY_ALIASES:
        return PARTY_ALIASES[lower]
    return party.strip()


def score_match(candidate, person):
    """Score how likely a candidate matches a registry person. 0-100."""
    cparty = normalize_party(candidate["party"])
    cdate = candidate["electionDate"][:4]
    cconst = candidate["constituency"].lower()
    ccouncil = candidate.get("council", "").lower()

    history = person.get("history", [])
    if not history:
        return {"total": 5, "party": 0, "geography": 0, "time": 0, "name": 5}

    # Party score (0-40)
    person_parties = set(normalize_party(h["party"]) for h in history)
    if cparty in person_parties:
        party_score = 40
    elif cparty == "Independent" and "Independent" in " ".join(person_parties):
        party_score = 20
    else:
        party_score = 0

    # Time score (0-20)
    person_years = [int(h["date"][:4]) for h in history if h["date"][:4].isdigit()]
    cyear = int(cdate) if cdate.isdigit() else 2020
    if person_years:
        min_gap = min(abs(cyear - y) for y in person_years)
        if min_gap <= 5:
            time_score = 20
        elif min_gap <= 10:
            time_score = 10
        elif min_gap <= 20:
            time_score = 5
        else:
            time_score = 0
    else:
        time_score = 0

    # Geography score (0-30)
    person_consts = set(h["constituency"].lower() for h in history)
    geo_score = 0
    if cconst in person_consts:
        geo_score = 30
    else:
        # Check for substring overlap (e.g. "Antrim" in "South Antrim")
        for pc in person_consts:
            if cconst in pc or pc in cconst:
                geo_score = max(geo_score, 15)
                break

    # Name quality score (0-10) — always 10 since we only call this for name matches
    name_score = 10

    total = party_score + time_score + geo_score + name_score
    return {
        "total": total,
        "party": party_score,
        "geography": geo_score,
        "time": time_score,
        "name": name_score,
    }


def main():
    base = Path("C:/Users/scomo/boundaries-website")
    registry_path = base / "scripts" / "person_registry.json"
    elections_base = base / "election-viewer-package" / "data" / "elections" / "local-government"

    if not registry_path.exists():
        print("ERROR: person_registry.json not found. Run build_person_registry.py first.")
        sys.exit(1)

    with open(registry_path, "r", encoding="utf-8") as f:
        registry = json.load(f)

    persons = registry["persons"]
    print(f"Registry: {len(persons)} persons")

    # Build match indices
    # matchKey -> list of personIds
    exact_index = {}
    for pid, p in persons.items():
        for mk in p.get("matchKeys", []):
            exact_index.setdefault(mk, []).append(pid)
        # Also index by canonical match key
        cmk = normalize_name_for_match(p["canonicalName"])
        if cmk not in exact_index or pid not in exact_index.get(cmk, []):
            exact_index.setdefault(cmk, []).append(pid)

    # surname index for fuzzy matching
    surname_index = {}
    for pid, p in persons.items():
        sn = normalize_name_for_match(p["lastName"])
        surname_index.setdefault(sn, []).append(pid)

    # Load local election candidates
    election_dates = ["2014-05-22", "2019-05-02", "2023-05-18"]
    # Also check for by-elections
    for d in sorted(os.listdir(elections_base)):
        if d not in election_dates and os.path.isdir(elections_base / d):
            bundle = elections_base / d / "_bundle.json"
            if bundle.exists():
                election_dates.append(d)
    election_dates = sorted(set(election_dates))

    all_candidates = []
    for date in election_dates:
        bundle_path = elections_base / date / "_bundle.json"
        if not bundle_path.exists():
            continue
        cands = extract_candidates_from_bundle(str(bundle_path), date)
        all_candidates.extend(cands)
        print(f"  {date}: {len(cands)} candidates")

    print(f"Total local candidates: {len(all_candidates)}")

    # Deduplicate candidates across elections by (candidateId, electionDate)
    # Actually, same person across elections will have different candidateIds
    # We want to match each unique (name, party, date, constituency) tuple

    auto_matched = []
    ambiguous = []
    new_persons = []
    case_id = 0

    # Track already-matched candidates to avoid duplicates in output
    # For candidates that match the same person across elections, group them
    already_assigned = {}  # (matchKey, party_norm, electionDate) -> personId

    for cand in all_candidates:
        mk = normalize_name_for_match(cand["candidateName"])
        if not mk:
            continue

        # Check if this candidate already has a genuine short PersonID
        cid = cand["candidateId"]
        if cid in persons:
            # Already a valid PersonID
            auto_matched.append({
                **cand,
                "matchedPersonId": int(cid),
                "matchMethod": "existing_person_id",
                "confidence": 1.0,
            })
            continue

        # Phase 1: Exact name match
        matches = exact_index.get(mk, [])

        if len(matches) == 1:
            pid = matches[0]
            sc = score_match(cand, persons[pid])
            auto_matched.append({
                **cand,
                "matchedPersonId": int(pid),
                "matchMethod": "exact_name",
                "confidence": min(sc["total"] / 100.0, 1.0),
                "score": sc,
            })
            continue

        if len(matches) > 1:
            # Ambiguous — multiple people with same name
            case_id += 1
            possible = []
            for pid in matches:
                sc = score_match(cand, persons[pid])
                possible.append({
                    "personId": int(pid),
                    "canonicalName": persons[pid]["canonicalName"],
                    "history": persons[pid]["history"][-10:],  # Last 10 entries
                    "nameVariants": persons[pid]["nameVariants"],
                    "score": sc["total"],
                    "scoreBreakdown": sc,
                })
            possible.sort(key=lambda x: -x["score"])

            # If top score >= 70 and clearly above second, auto-match
            if possible[0]["score"] >= 70 and (
                len(possible) == 1 or possible[0]["score"] - possible[1]["score"] >= 20
            ):
                pid = str(possible[0]["personId"])
                auto_matched.append({
                    **cand,
                    "matchedPersonId": possible[0]["personId"],
                    "matchMethod": "disambiguation_auto",
                    "confidence": possible[0]["score"] / 100.0,
                    "score": possible[0]["scoreBreakdown"],
                })
            else:
                ambiguous.append({
                    "caseId": f"amb_{case_id:04d}",
                    "candidate": cand,
                    "possibleMatches": possible,
                    "topRecommendation": possible[0]["personId"] if possible else None,
                })
            continue

        # Phase 2: Fuzzy matching by surname
        cand_surname = normalize_name_for_match(cand["lastName"])
        cand_fullmk = mk
        surname_matches = surname_index.get(cand_surname, [])

        best_fuzzy = None
        best_ratio = 0.0
        fuzzy_candidates = []

        for pid in surname_matches:
            p = persons[pid]
            for pmk in p.get("matchKeys", []):
                ratio = difflib.SequenceMatcher(None, cand_fullmk, pmk).ratio()
                if ratio >= 0.85:
                    sc = score_match(cand, p)
                    entry = {
                        "personId": int(pid),
                        "canonicalName": p["canonicalName"],
                        "history": p["history"][-10:],
                        "nameVariants": p["nameVariants"],
                        "score": sc["total"],
                        "scoreBreakdown": sc,
                        "nameRatio": round(ratio, 3),
                    }
                    fuzzy_candidates.append(entry)
                    if ratio > best_ratio:
                        best_ratio = ratio
                        best_fuzzy = entry
                    break  # One match per person is enough

        if len(fuzzy_candidates) == 1 and best_ratio >= 0.92:
            auto_matched.append({
                **cand,
                "matchedPersonId": best_fuzzy["personId"],
                "matchMethod": "fuzzy_name",
                "confidence": best_ratio,
                "score": best_fuzzy["scoreBreakdown"],
            })
        elif fuzzy_candidates:
            case_id += 1
            fuzzy_candidates.sort(key=lambda x: -x["score"])
            ambiguous.append({
                "caseId": f"amb_{case_id:04d}",
                "candidate": cand,
                "possibleMatches": fuzzy_candidates,
                "topRecommendation": fuzzy_candidates[0]["personId"],
                "matchType": "fuzzy",
            })
        else:
            # No match at all — new person
            new_persons.append(cand)

    print(f"\nResults:")
    print(f"  Auto-matched: {len(auto_matched)}")
    print(f"  Ambiguous (needs review): {len(ambiguous)}")
    print(f"  New persons (no match): {len(new_persons)}")

    # Write outputs
    out_dir = base / "scripts"

    results = {
        "autoMatched": auto_matched,
        "newPersons": new_persons,
    }
    with open(out_dir / "match_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"  Saved: match_results.json")

    ambiguous_out = {"cases": ambiguous}
    with open(out_dir / "ambiguous_cases.json", "w", encoding="utf-8") as f:
        json.dump(ambiguous_out, f, ensure_ascii=False, indent=2)
    print(f"  Saved: ambiguous_cases.json")

    # Stats on ambiguous
    if ambiguous:
        by_type = {}
        for a in ambiguous:
            mt = a.get("matchType", "exact_multi")
            by_type[mt] = by_type.get(mt, 0) + 1
        print(f"  Ambiguous breakdown: {by_type}")


if __name__ == "__main__":
    main()
