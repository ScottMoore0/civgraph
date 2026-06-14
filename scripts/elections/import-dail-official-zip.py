#!/usr/bin/env python3
"""Import compact public metadata from the official Dail election archive.

The source archive is kept outside the repository. This script reads it in
place, extracts only small structured facts needed by Civgraph, and writes a
stable JSON sidecar plus missing Dail by-election result stubs.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    from pypdf import PdfReader
except Exception as exc:  # pragma: no cover - local import guard
    raise SystemExit("pypdf is required to import official Dail PDFs") from exc


ROOT = Path.cwd()
DOWNLOADS = Path.home() / "Downloads"
OUT_PATH = ROOT / "data" / "elections" / "dail-official-results.json"
ELECTION_INDEX_PATH = ROOT / "election-viewer-package" / "data" / "elections_index.json"
DAIL_ROOT = ROOT / "election-viewer-package" / "data" / "elections" / "dail-eireann"
OIREACHTAS_DOWNLOAD_DIR = ROOT / "data" / "downloads" / "oireachtas-dail-pdfs"

OIREACHTAS_DAIL_PDFS = [
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/28thDail_June1997.pdf", "1997-06-06"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/27thDail_November1992.pdf", "1992-11-25"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/26thDail_June1989.pdf", "1989-06-15"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/25thDail_February1987_ByeElections24th_1982_1987.pdf", "1987-02-17"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/24thDail_Nov1982_ByeElections23rd.pdf", "1982-11-24"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/23rdDail_Feb1982_NoByeElections.pdf", "1982-02-18"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/22ndDail_June1981_ByeElections21st_1977_1981.pdf", "1981-06-11"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/21stDail_June1977_ByeElections20th_1973_1977.pdf", "1977-06-16"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/20thDail_February1973_ByeElections19th_1969_1973.pdf", "1973-02-28"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/19thDail_June1969_ByeElections18th_1965_1969.pdf", "1969-06-18"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/18thDail_April1965_ByeElections17th_1961_1965.pdf", "1965-04-07"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/17thDail_October1961_ByeElections16th.pdf", "1961-10-04"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/16thDail_March1957_ByeElections15thDail_1954_1957.pdf", "1957-03-05"),
    ("https://opac.oireachtas.ie/Data/Library3/Official%20Publications/pdf/15thDail_May1954_ByeElections14thDail_1951_1954.pdf", "1954-05-18"),
]

PARTY_ABBREVIATIONS_2024 = {
    "F.F.": "Fianna Fail",
    "FF": "Fianna Fail",
    "F.G.": "Fine Gael",
    "FG": "Fine Gael",
    "S.F.": "Sinn Fein",
    "SF": "Sinn Fein",
    "Ant": "Aontu",
    "Grn": "Green Party/An Comhaontas Glas",
    "P.B.P.": "People Before Profit-Solidarity",
    "PBP": "People Before Profit-Solidarity",
    "Lab": "The Labour Party",
    "Ind.I": "Independent Ireland",
    "SD": "Social Democrats",
    "S.D.": "Social Democrats",
    "T.I.P.": "The Irish People",
    "I.F.P.": "Irish Freedom Party (I.F.P.)",
    "IFP": "Irish Freedom Party (I.F.P.)",
    "T.N.P.": "The National Party - An Pairti Naisiunta",
    "LR": "Liberty Republic",
    "L.R.": "Liberty Republic",
    "C.P.O.I.": "Centre Party of Ireland",
    "I.4.C.": "Independents 4 Change",
    "P.A.W.": "Party for Animal Welfare",
    "R.M.L.": "Rabharta (Munster and Leinster)",
    "IF": "Ireland First",
    "I.F.": "Ireland First",
    "R.T.C.": "Right to Change",
    "100%.R.": "100% Redress",
    "Non-P": "Non-party",
    "Non-P.": "Non-party",
}

MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def ascii_fold(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(ch for ch in value if not unicodedata.combining(ch))


def slugify(value: str) -> str:
    value = ascii_fold(value).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value


def normalize_name(value: str) -> str:
    value = ascii_fold(value).lower()
    value = value.replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def parse_int(value):
    if value is None:
        return None
    text = str(value).replace(",", "").replace("%", "").strip()
    if not text or text in {"-", "—"}:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def parse_float(value):
    if value is None:
        return None
    text = str(value).replace(",", "").replace("%", "").strip()
    if not text or text in {"-", "—"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_constituency_name(value: str) -> str:
    text = str(value or "").replace("–", "-").replace("—", "-")
    text = re.sub(r"\s*-\s*", "-", text.strip())
    text = re.sub(r"\s+", " ", text)
    # Keep the repository's long-standing convention for Dail constituency names.
    text = text.replace("-", " ")
    return text.title().replace(" And ", " and ").replace(" Of ", " of ")


def clean_candidate_name(value: str) -> str:
    text = re.sub(r"^\*\s*", "", str(value or "").strip())
    text = re.sub(r"\s+", " ", text)
    if "," in text:
        surname, first = [part.strip() for part in text.split(",", 1)]
        if first:
            text = f"{first} {surname}"
    return text.title().replace(" Mc", " Mc").replace(" O'", " O'")


def read_zip_path(argv: list[str]) -> Path:
    if len(argv) > 1:
        path = Path(argv[1])
        if path.exists():
            return path
        raise SystemExit(f"Source ZIP not found: {path}")
    matches = list(DOWNLOADS.glob("D* Elections.zip"))
    if not matches:
        raise SystemExit("Could not find Dail Elections ZIP in Downloads")
    return matches[0]


def read_pdf_text(zf: zipfile.ZipFile, member: str) -> list[str]:
    reader = PdfReader(io.BytesIO(zf.read(member)))
    return [page.extract_text() or "" for page in reader.pages]


def read_pdf_file_text(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    return [page.extract_text() or "" for page in reader.pages]


def sidecar_for_date(data: dict, date: str, kind: str, source_file: str) -> dict:
    elections = data.setdefault("elections", {})
    election = elections.setdefault(date, {
        "date": date,
        "kind": kind,
        "sourceFiles": [],
        "constituencies": {},
    })
    if source_file not in election["sourceFiles"]:
        election["sourceFiles"].append(source_file)
    return election


def add_constituency_record(election: dict, constituency: str, source_file: str, **fields):
    slug = slugify(constituency)
    record = election["constituencies"].setdefault(slug, {
        "constituency": clean_constituency_name(constituency),
        "sourceFiles": [],
        "candidates": {},
    })
    if source_file not in record["sourceFiles"]:
        record["sourceFiles"].append(source_file)
    for key, value in fields.items():
        if value is not None and value != "":
            record[key] = value
    number = record.get("constituencyNumber")
    if number:
        record["constituencyId"] = f"dail-{election['date']}:{number}"
    elif not record.get("constituencyId"):
        record["constituencyId"] = f"dail-{election['date']}:{slug}"
    return record


def add_candidate_record(record: dict, name: str, party: str = "", **fields):
    if not name:
        return
    party = party or fields.get("party") or ""
    key = f"{normalize_name(name)}|{normalize_name(party)}"
    candidate = record["candidates"].setdefault(key, {
        "name": clean_candidate_name(name),
    })
    if party:
        candidate["party"] = party
    for field, value in fields.items():
        if value is not None and value != "":
            candidate[field] = value


def parse_csv_members(zf: zipfile.ZipFile, data: dict):
    for member in zf.namelist():
        if not member.endswith(".csv") or "schema" in member.lower():
            continue
        if "2016" in member:
            date = "2016-02-26"
        elif "2020" in member:
            date = "2020-02-08"
        else:
            continue
        election = sidecar_for_date(data, date, "general", member)
        rows = list(csv.DictReader(io.StringIO(zf.read(member).decode("cp1252"))))
        if "constituency-details" in member:
            for row in rows:
                name = row.get("Constituency Name")
                if not name or name.startswith("This is "):
                    continue
                total_poll = parse_int(row.get("Total Poll"))
                valid_poll = parse_int(row.get("Valid Poll"))
                electorate = parse_int(row.get("Total Electorate"))
                turnout = round(total_poll / electorate * 100, 2) if total_poll and electorate else None
                add_constituency_record(
                    election,
                    name,
                    member,
                    constituencyIrish=row.get("Constituency Ainm"),
                    constituencyNumber=str(row.get("Constituency Number") or "").strip(),
                    electorate=electorate,
                    totalPoll=total_poll,
                    spoiled=parse_int(row.get("Spoiled") or row.get("Invalid")),
                    validPoll=valid_poll,
                    turnoutPct=turnout,
                    seats=parse_int(row.get("Number of Seats") or row.get("SeatsinConstit") or row.get("Seats in Constituency")),
                    quota=parse_int(row.get("Quota")),
                    countCount=parse_int(row.get("Count Number")),
                    candidateCount=parse_int(row.get("Number Of Candidates")),
                )
        elif "candidate-details" in member:
            for row in rows:
                name = " ".join([str(row.get("Firstname") or row.get("First Name") or "").strip(), str(row.get("Surname") or "").strip()]).strip()
                constituency = row.get("Constituency")
                if not name or not constituency or name.startswith("This is "):
                    continue
                record = add_constituency_record(
                    election,
                    constituency,
                    member,
                    constituencyIrish=row.get("Constituency Ainm"),
                    constituencyNumber=str(row.get("Constituency Number") or "").strip(),
                )
                party = row.get("Party") or row.get("Party Id") or ""
                add_candidate_record(
                    record,
                    name,
                    party,
                    candidateId=str(row.get("Candidate Id") or "").strip(),
                    gender=str(row.get("Gender") or row.get("Gender Id") or "").strip(),
                    dailAbbreviation=str(row.get("Party Abbreviation") or "").strip(),
                    officialStatus=str(row.get("Result") or "").strip(),
                )


def parse_2024_general_pdf(zf: zipfile.ZipFile, data: dict):
    member = next((name for name in zf.namelist() if "34th-dail-general-election-results" in name), None)
    if not member:
        return
    election = sidecar_for_date(data, "2024-11-29", "general", member)
    pages = read_pdf_text(zf, member)
    stats_re = re.compile(
        r"^(.+?)\*?\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)%\s+([\d,]+)\s+[\d.]+%\s+([\d,]+)\s+([\d,]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$"
    )
    for page_text in pages:
        for line in page_text.splitlines():
            match = stats_re.match(line.strip())
            if not match:
                continue
            (
                constituency,
                seats,
                electorate,
                total_poll,
                turnout,
                spoiled,
                valid_poll,
                quota,
                candidate_count,
                women,
                men,
                count_count,
                lost_expenses,
            ) = match.groups()
            add_constituency_record(
                election,
                constituency,
                member,
                electorate=parse_int(electorate),
                totalPoll=parse_int(total_poll),
                spoiled=parse_int(spoiled),
                validPoll=parse_int(valid_poll),
                turnoutPct=parse_float(turnout),
                seats=parse_int(seats),
                quota=parse_int(quota),
                candidateCount=parse_int(candidate_count),
                womenCandidateCount=parse_int(women),
                menCandidateCount=parse_int(men),
                countCount=parse_int(count_count),
                lostExpenseCount=parse_int(lost_expenses),
            )

    current_constituency = ""
    candidate_re = re.compile(r"^\*?\s*(.+?)\s+\(([A-Za-z0-9.% .]+)\)\s+([MF])\s+([\d,]+)\b")
    for page_text in pages:
        title_match = re.search(r"Constituency of\s+(.+?)\s+Names Of Candidates", page_text, flags=re.I | re.S)
        if title_match:
            current_constituency = clean_constituency_name(title_match.group(1))
        if not current_constituency:
            continue
        record = add_constituency_record(election, current_constituency, member)
        for line in page_text.splitlines():
            match = candidate_re.match(line.strip())
            if not match:
                continue
            name, abbreviation, gender, _first_pref = match.groups()
            abbreviation = abbreviation.strip().replace(" ", "")
            party = PARTY_ABBREVIATIONS_2024.get(abbreviation, abbreviation)
            add_candidate_record(
                record,
                name,
                party,
                gender=gender,
                dailAbbreviation=abbreviation,
            )


def parse_older_general_pdf(zf: zipfile.ZipFile, data: dict, member_substring: str, date: str):
    member = next((name for name in zf.namelist() if member_substring in name and name.endswith(".pdf")), None)
    if not member:
        return
    election = sidecar_for_date(data, date, "general", member)
    pages = read_pdf_text(zf, member)
    known_constituencies = indexed_constituencies_for_date(date)
    stats_page_index = 0
    for page_text in pages:
        if "GENERAL ELECTION" not in page_text or "TOTAL ELECTORATE" not in page_text:
            continue
        electorate = parse_int(re.search(r"TOTAL ELECTORATE\s+([\d,]+)", page_text, flags=re.I).group(1)) if re.search(r"TOTAL ELECTORATE\s+([\d,]+)", page_text, flags=re.I) else None
        spoiled = parse_int(re.search(r"INVALID BALLOT\s+PAPERS\s+([\d,]+)", page_text, flags=re.I).group(1)) if re.search(r"INVALID BALLOT\s+PAPERS\s+([\d,]+)", page_text, flags=re.I) else None
        valid_poll = parse_int(re.search(r"VALID POLL\s+([\d,]+)", page_text, flags=re.I).group(1)) if re.search(r"VALID POLL\s+([\d,]+)", page_text, flags=re.I) else None
        seats = parse_int(re.search(r"NUMBER OF SEATS\s+(\d+)", page_text, flags=re.I).group(1)) if re.search(r"NUMBER OF SEATS\s+(\d+)", page_text, flags=re.I) else None
        quota = parse_int(re.search(r"QUOTA\s+([\d,]+)", page_text, flags=re.I).group(1)) if re.search(r"QUOTA\s+([\d,]+)", page_text, flags=re.I) else None
        constituency = constituency_after_quota(page_text)
        if not constituency and stats_page_index < len(known_constituencies):
            constituency = known_constituencies[stats_page_index]
        stats_page_index += 1
        if not constituency or not valid_poll:
            continue
        total_poll = valid_poll + (spoiled or 0)
        turnout = round(total_poll / electorate * 100, 2) if total_poll and electorate else None
        add_constituency_record(
            election,
            constituency,
            member,
            electorate=electorate,
            totalPoll=total_poll,
            spoiled=spoiled,
            validPoll=valid_poll,
            turnoutPct=turnout,
            seats=seats,
            quota=quota,
        )


def constituency_after_quota(page_text: str) -> str:
    lines = [line.strip() for line in page_text.splitlines()]
    for index, line in enumerate(lines):
        if "QUOTA" not in line.upper():
            continue
        for next_line in lines[index + 1:index + 12]:
            cleaned = re.sub(r"\s+", " ", next_line).strip()
            if not cleaned:
                continue
            upper = cleaned.upper()
            if any(token in upper for token in ["FIRST", "COUNT", "NAMES", "TRANSFER", "GENERAL", "TOTAL", "VALID", "NUMBER"]):
                continue
            if len(cleaned) <= 70 and re.search(r"[A-ZÁÉÍÓÚ]", cleaned) and upper == cleaned:
                return cleaned
    # Some older PDFs put the constituency between "CONSTITUENCY OF" and later headings.
    match = re.search(r"CONSTITUENCY OF\s+(?:VALID POLL\s+[\d,]+\s+)?(?:NUMBER OF SEATS\s+\d+\s+)?([A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ \-']+)\s+QUOTA", page_text)
    return match.group(1) if match else ""


def constituency_from_bye_page(page_text: str) -> str:
    constituency = constituency_after_quota(page_text)
    if constituency:
        return constituency
    match = re.search(r"CONSTITUENCY OF\s+(.+?)\s+Names of Candidates", page_text, flags=re.I | re.S)
    if match:
        return re.sub(r"\s+", " ", match.group(1)).strip()
    return ""


def indexed_constituencies_for_date(date: str) -> list[str]:
    if not ELECTION_INDEX_PATH.exists():
        return []
    try:
        index = json.loads(ELECTION_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    body = next((entry for entry in index.get("bodies", []) if entry.get("slug") == "dail-eireann"), None)
    if not body:
        return []
    entry = next((date_entry for date_entry in body.get("dates", []) if date_entry.get("date") == date), None)
    if not entry:
        return []
    return [clean_constituency_name(item) for item in entry.get("constituencies", [])]


def parse_human_date(value: str) -> str | None:
    text = ascii_fold(value).strip().lower()
    match = re.search(r"(\d{1,2})\s+([a-z]+)\s+(\d{4})", text)
    if not match:
        return None
    day, month, year = match.groups()
    month_number = MONTHS.get(month)
    if not month_number:
        return None
    return f"{int(year):04d}-{month_number:02d}-{int(day):02d}"


def parse_by_election_pdfs(zf: zipfile.ZipFile, data: dict):
    for member in zf.namelist():
        if not member.endswith(".pdf") or "bye-election" not in member:
            continue
        pages = read_pdf_text(zf, member)
        for page_text in pages:
            folded = ascii_fold(page_text).upper()
            if "BYE-ELECTION" not in folded and "BYE ELECTION" not in folded:
                continue
            date_match = re.search(r"BYE[\s-]*ELECTION\s*(?:[–—-])?\s*([0-9]{1,2}\s+[A-Z]+\s+[0-9]{4})", ascii_fold(page_text), flags=re.I)
            date = parse_human_date(date_match.group(1)) if date_match else None
            constituency = constituency_from_bye_page(page_text)
            if not date or not constituency:
                continue
            electorate_match = re.search(r"Total Electorate\s+([\d,]+)", page_text, flags=re.I)
            valid_match = re.search(r"Valid Poll\s+([\d,]+)", page_text, flags=re.I)
            spoiled_match = re.search(r"Invalid Ballot Papers\s+([\d,]+)", page_text, flags=re.I)
            seats_match = re.search(r"Number of Seats\s+(\d+)", page_text, flags=re.I)
            quota_match = re.search(r"Quota\s+([\d,]+)", page_text, flags=re.I)
            electorate = parse_int(electorate_match.group(1)) if electorate_match else None
            valid_poll = parse_int(valid_match.group(1)) if valid_match else None
            spoiled = parse_int(spoiled_match.group(1)) if spoiled_match else None
            total_poll = valid_poll + (spoiled or 0) if valid_poll is not None else None
            turnout = round(total_poll / electorate * 100, 2) if total_poll and electorate else None
            election = sidecar_for_date(data, date, "by-election", member)
            record = add_constituency_record(
                election,
                constituency,
                member,
                electorate=electorate,
                totalPoll=total_poll,
                spoiled=spoiled,
                validPoll=valid_poll,
                turnoutPct=turnout,
                seats=parse_int(seats_match.group(1)) if seats_match else 1,
                quota=parse_int(quota_match.group(1)) if quota_match else None,
            )
            candidates = parse_by_election_candidates(page_text)
            for candidate in candidates:
                add_candidate_record(record, **candidate)
            write_by_election_raw(date, record, member)


def parse_by_election_candidates(page_text: str) -> list[dict]:
    lines = [line.rstrip() for line in page_text.splitlines()]
    candidates = []
    candidate_re = re.compile(r"([*A-ZÁÉÍÓÚa-z][^()]{2,90})\s+\(([^)]+)\)(?:\s+([MF]))?")
    for index, line in enumerate(lines):
        if "Non-transferable" in line or "TOTAL" in line:
            continue
        match = candidate_re.search(line)
        if not match:
            continue
        name, party, gender = match.groups()
        name = re.sub(r"^[+\-\d,.\s]+", "", name).strip()
        if any(token in name.upper() for token in ["TRANSFER", "NAMES OF CANDIDATES", "NUMBER OF VOTES"]):
            continue
        tail = line[match.end():]
        vote_match = re.search(r"\b(\d[\d,]*)\b", tail)
        if not vote_match:
            for next_line in lines[index + 1:index + 4]:
                vote_match = re.search(r"\b(\d[\d,]*)\b", next_line)
                if vote_match:
                    break
        first_pref = parse_int(vote_match.group(1)) if vote_match else None
        if first_pref is None:
            continue
        candidates.append({
            "name": name,
            "party": PARTY_ABBREVIATIONS_2024.get(party.strip(), party.strip()),
            "gender": gender or "",
            "firstPref": first_pref,
        })
    return candidates


def write_by_election_raw(date: str, record: dict, source_file: str):
    out_dir = DAIL_ROOT / date
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{slugify(record['constituency'])}.json"
    if out_file.exists():
        return
    raw = {
        "meta": {
            "electorate": record.get("electorate"),
            "total_poll": record.get("totalPoll"),
            "spoiled": record.get("spoiled"),
            "valid_poll": record.get("validPoll"),
            "turnoutPct": record.get("turnoutPct"),
            "seats": record.get("seats") or 1,
            "quota": record.get("quota"),
        },
        "constituency": record["constituency"],
        "year": int(date[:4]),
        "kind": "by-election",
        "officialSourceFile": source_file,
        "candidates": [
            {
                "name": candidate.get("name"),
                "party": candidate.get("party") or "Unknown",
                "first_pref": candidate.get("firstPref") or 0,
                "counts": [candidate.get("firstPref") or 0],
                "status": "",
            }
            for candidate in record.get("candidates", {}).values()
        ],
    }
    out_file.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_election_index(data: dict):
    index = json.loads(ELECTION_INDEX_PATH.read_text(encoding="utf-8"))
    body = next((entry for entry in index.get("bodies", []) if entry.get("slug") == "dail-eireann"), None)
    if not body:
        return
    existing = {date_entry.get("date"): date_entry for date_entry in body.get("dates", [])}
    changed = False
    for date, election in sorted(data.get("elections", {}).items()):
        if election.get("kind") != "by-election":
            continue
        constituencies = sorted(record["constituency"] for record in election.get("constituencies", {}).values())
        if not constituencies:
            continue
        if date in existing:
            merged = sorted(set(existing[date].get("constituencies", [])) | set(constituencies))
            if merged != existing[date].get("constituencies", []):
                existing[date]["constituencies"] = merged
                changed = True
        else:
            body.setdefault("dates", []).append({
                "date": date,
                "kind": "by-election",
                "constituencies": constituencies,
            })
            changed = True
    if changed:
        body["dates"] = sorted(body.get("dates", []), key=lambda item: item.get("date", ""), reverse=True)
        ELECTION_INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cache_and_record_oireachtas_pdfs(data: dict):
    OIREACHTAS_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    embedded_text_count = 0
    for url, date in OIREACHTAS_DAIL_PDFS:
        filename = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        path = OIREACHTAS_DOWNLOAD_DIR / filename
        if not path.exists():
            with urllib.request.urlopen(url, timeout=45) as response:
                path.write_bytes(response.read())
        pages = read_pdf_file_text(path)
        embedded_text_chars = sum(len(page.strip()) for page in pages)
        if embedded_text_chars:
            embedded_text_count += 1
        records.append({
            "date": date,
            "url": url,
            "filename": filename,
            "localCache": str(path.relative_to(ROOT)).replace("\\", "/"),
            "pageCount": len(pages),
            "embeddedTextChars": embedded_text_chars,
            "status": "embedded-text-found" if embedded_text_chars else "ocr-required",
            "note": "" if embedded_text_chars else "Official PDF is an image-only scan; OCR is required before automated table extraction."
        })
    data.setdefault("source", {})["oireachtasOfficialPdfs"] = records
    data.setdefault("source", {})["oireachtasEmbeddedTextPdfCount"] = embedded_text_count


def write_stable_sidecar(data: dict):
    next_payload = json.loads(json.dumps(data, ensure_ascii=False, sort_keys=True))
    if OUT_PATH.exists():
        try:
            current_payload = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current_payload = None
        if isinstance(current_payload, dict):
            current_without_timestamp = dict(current_payload)
            next_without_timestamp = dict(next_payload)
            current_without_timestamp.pop("generatedAt", None)
            next_without_timestamp.pop("generatedAt", None)
            if current_without_timestamp == next_without_timestamp:
                next_payload["generatedAt"] = current_payload.get("generatedAt", next_payload["generatedAt"])
    OUT_PATH.write_text(json.dumps(next_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    source_zip = read_zip_path(argv)
    data = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "archiveName": source_zip.name,
            "archiveSize": source_zip.stat().st_size,
            "note": "Compact public metadata extracted from the official Dail election ZIP and cached official Oireachtas Dail PDFs. Raw PDFs/CSVs remain outside git.",
        },
        "partyAbbreviations": PARTY_ABBREVIATIONS_2024,
        "elections": {},
    }
    with zipfile.ZipFile(source_zip) as zf:
        parse_csv_members(zf, data)
        parse_2024_general_pdf(zf, data)
        parse_older_general_pdf(zf, data, "2011-05-23_dail-general-election-2011-results_en.pdf", "2011-02-25")
        parse_older_general_pdf(zf, data, "2007-10-23_dail-general-election-may-2007-results-and-transfer-of-votes_en.pdf", "2007-05-24")
        parse_older_general_pdf(zf, data, "2002-07-21_dail-general-election-may-2002-results-and-transfer-of-votes_en.pdf", "2002-05-17")
        parse_by_election_pdfs(zf, data)
    cache_and_record_oireachtas_pdfs(data)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_stable_sidecar(data)
    update_election_index(data)
    election_count = len(data["elections"])
    constituency_count = sum(len(election["constituencies"]) for election in data["elections"].values())
    print(f"Wrote {OUT_PATH} ({election_count} elections, {constituency_count} constituency records)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
