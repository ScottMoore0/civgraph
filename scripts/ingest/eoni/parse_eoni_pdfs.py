#!/usr/bin/env python
"""Parse all downloaded EONI SPN and Agent PDFs to determine coverage."""

import json
import re
from collections import defaultdict
from pathlib import Path

from PyPDF2 import PdfReader


def extract_text(pdf_path: Path) -> str:
    try:
        reader = PdfReader(str(pdf_path))
        text = ""
        for page in reader.pages[:4]:
            text += (page.extract_text() or "") + "\n"
        return text
    except Exception as e:
        return f"PARSE_ERROR: {e}"


def parse_spn(text: str, filename: str) -> dict:
    """Extract election metadata from SPN text."""
    if text.startswith("PARSE_ERROR"):
        return {"status": "error", "error": text}

    # Election type
    if "Northern Ireland Assembly" in text:
        etype = "Assembly"
    elif "House of Commons" in text or "UK Parliament" in text or "Parliamentary" in text:
        etype = "Westminster"
    elif "local council" in text.lower() or "Local Government" in text:
        etype = "Local Govt"
    elif "European" in text:
        etype = "European"
    elif "By-Election" in text or "by-election" in text:
        etype = "By-election"
    else:
        etype = "Unknown"

    # Constituency
    const = "Unknown"
    # Pattern: "for the\nBELFAST EAST Constituency"
    m = re.search(r"for\s+the\s*\n?\s*([A-Z][A-Z\s,&'\-]+?)(?:\s*Constituency|\s*Electoral|\s*Local\s*Government)", text)
    if m:
        const = m.group(1).strip()
    else:
        m2 = re.search(r"for the\s+([A-Z][A-Z\s,&'\-]+?)(?:\s+constituency|\s+electoral)", text, re.I)
        if m2:
            const = m2.group(1).strip()

    # Poll date
    poll_date = ""
    m = re.search(r"(?:poll|election)\s+will\s+be\s+held\s+on\s+\w+\s+(\d{1,2}\s+\w+\s+\d{4})", text, re.I)
    if m:
        poll_date = m.group(1)
    else:
        m2 = re.search(r"Dated:?\s*\w+\s+(\d{1,2}\s+\w+\s+\d{4})", text)
        if m2:
            poll_date = m2.group(1)

    # Count candidates: look for SURNAME/OTHER NAMES table entries
    # Each candidate has a surname followed by other names
    candidates = []
    # Split into lines and look for table rows
    lines = text.split("\n")
    in_table = False
    for line in lines:
        if "SURNAME" in line and "OTHER NAMES" in line:
            in_table = True
            continue
        if in_table and ("The poll" in line or "Dated:" in line or "The number" in line):
            break
        if in_table:
            # A candidate line typically starts with a capitalized name
            # followed by other names, address, party
            stripped = line.strip()
            if stripped and not stripped.startswith("(") and not stripped.startswith("SURNAME"):
                # Check if it looks like a surname (starts with letter, short-ish)
                parts = stripped.split()
                if parts and parts[0][0].isupper() and len(parts[0]) >= 2:
                    # Could be a candidate surname or continuation
                    # If the word is all caps or title case and not a common continuation word
                    first = parts[0]
                    if first not in ("SUBSCRIBERS", "ADDRESS", "DESCRIPTION", "Party",
                                     "Democratic", "Ulster", "Sinn", "SDLP", "Alliance",
                                     "Traditional", "Progressive", "Green", "Cross-Community",
                                     "Workers", "People", "Independent", "Conservatives",
                                     "Labour", "Northern"):
                        candidates.append(stripped[:50])

    # Better approach: count unique surname entries
    # In the PDF, candidates appear as "Surname OtherNames Address Party Subscribers"
    # The most reliable signal is counting entries between SURNAME header and footer

    return {
        "status": "ok",
        "etype": etype,
        "const": const,
        "poll_date": poll_date,
        "candidate_count": len(candidates),
        "raw_candidates": candidates[:20],
    }


def main():
    all_results = []

    for base_dir, doc_type in [(Path("_tmp_eoni_spn"), "spn"), (Path("_tmp_eoni_agents"), "agent")]:
        for pdf in sorted(base_dir.rglob("*.pdf")):
            text = extract_text(pdf)
            info = parse_spn(text, pdf.name)
            info["file"] = str(pdf)
            info["dir"] = pdf.parent.name
            info["fname"] = pdf.name
            info["doc_type"] = doc_type
            info["text_preview"] = text[:200] if not text.startswith("PARSE_ERROR") else text
            all_results.append(info)

    # Group by election
    elections = defaultdict(list)
    errors = []
    for r in all_results:
        if r.get("status") == "error":
            errors.append(r)
            continue
        key = (r["poll_date"], r["etype"], r["doc_type"])
        elections[key].append(r)

    print(f"Total PDFs: {len(all_results)}")
    print(f"Parse errors: {len(errors)}")
    print()

    print("=" * 80)
    print("COVERAGE BY ELECTION")
    print("=" * 80)

    for key in sorted(elections.keys(), key=lambda k: (k[0] or "9999", k[1], k[2])):
        poll_date, etype, doc_type = key
        items = elections[key]
        consts = sorted(set(r["const"] for r in items))
        label = f"{poll_date or 'UNDATED'} {etype} ({doc_type.upper()})"
        print(f"\n{label}: {len(items)} PDFs, {len(consts)} constituencies")
        for r in sorted(items, key=lambda x: x["const"]):
            cand_str = f", {r['candidate_count']} candidates" if r["candidate_count"] else ""
            print(f"  {r['const']}{cand_str}")

    if errors:
        print(f"\n{'='*80}")
        print(f"PARSE ERRORS: {len(errors)}")
        print(f"{'='*80}")
        for e in errors:
            print(f"  {e['fname']}: {e.get('error', '')[:100]}")

    # Save
    json.dump(all_results, open("_tmp_eoni_pdf_analysis.json", "w", encoding="utf-8"),
              indent=2, ensure_ascii=False, default=str)
    print(f"\nSaved analysis to _tmp_eoni_pdf_analysis.json")


if __name__ == "__main__":
    main()
