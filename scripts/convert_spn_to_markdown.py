#!/usr/bin/env python
"""Convert all EONI SPN and Agent PDFs to structured Markdown."""

import json
import re
from collections import defaultdict
from pathlib import Path

from PyPDF2 import PdfReader

OUT_DIR = Path("_tmp_eoni_markdown")
OUT_DIR.mkdir(exist_ok=True)


def extract_full_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    text = ""
    for page in reader.pages:
        text += (page.extract_text() or "") + "\n---PAGE_BREAK---\n"
    return text


def parse_date(text: str) -> str:
    """Extract poll date from SPN text."""
    m = re.search(
        r"poll.*?will be held on\s+\w+\s+(\d{1,2}\s+\w+\s+\d{4})",
        text, re.I | re.S,
    )
    if m:
        return m.group(1).strip()
    m2 = re.search(r"Dated:?\s*\w+day\s+(\d{1,2}\s+\w+\s+\d{4})", text)
    if m2:
        return m2.group(1).strip()
    return ""


def parse_election_type(text: str) -> str:
    if "Northern Ireland Assembly" in text:
        return "NI Assembly"
    if "House of Commons" in text or "UK Parliament" in text:
        return "Westminster"
    if "European" in text:
        return "European Parliament"
    if "local council" in text.lower() or "Local Government" in text:
        return "Local Government"
    return "Unknown"


def parse_seats(text: str) -> str:
    m = re.search(r"number of (?:members|candidates) to be elected is\s+(\w+)", text, re.I)
    if m:
        return m.group(1)
    return ""


def parse_returning_officer(text: str) -> str:
    m = re.search(r"(Deputy |Chief )?Returning Officer\s*\n?\s*(.+?)(?:\n|Area Electoral)", text)
    if m:
        return m.group(2).strip() if m.group(2).strip() else ""
    # Try: name appears right before "Returning Officer"
    m2 = re.search(r"([A-Z][a-z]+ [A-Z][a-z]+)\s*\n\s*(?:Deputy |Chief )?Returning Officer", text)
    if m2:
        return m2.group(1).strip()
    return ""


def split_constituencies(text: str) -> list[tuple[str, str]]:
    """Split a combined PDF into per-constituency sections.
    Returns list of (constituency_name, section_text)."""

    # Pattern: "for the\n CONSTITUENCY NAME Constituency"
    # or "for the\n CONSTITUENCY NAME \n Constituency"
    pattern = re.compile(
        r"(?:Election of.*?for\s+the\s*\n?\s*)"
        r"([A-Z][A-Z\s,&'\-]+?)"
        r"\s*(?:Constituency|Electoral Area|Local Government District)",
        re.S,
    )

    matches = list(pattern.finditer(text))
    if not matches:
        # Try alternative: "for the BELFAST EAST Constituency" on one line
        pattern2 = re.compile(
            r"for the\s+([A-Z][A-Z\s,&'\-]+?)\s+(?:Constituency|Electoral)",
            re.I,
        )
        matches = list(pattern2.finditer(text))

    if not matches:
        # Single constituency document — extract name differently
        m = re.search(
            r"for\s+the\s*\n?\s*([A-Z][A-Z\s,&'\-]+?)\s*\n?\s*(?:Constituency|Electoral)",
            text, re.I,
        )
        const = m.group(1).strip() if m else "Unknown"
        return [(const, text)]

    sections = []
    for i, match in enumerate(matches):
        const = match.group(1).strip()
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section = text[start:end]
        sections.append((const, section))

    return sections


def parse_candidates(section_text: str) -> list[dict]:
    """Parse candidate entries from a section of SPN text."""
    candidates = []

    # Find the table area between "SURNAME" header and "The poll" / "Dated:"
    table_match = re.search(
        r"SURNAME\s+OTHER\s+NAMES.*?(?=The poll|The number|Dated:|Published and printed)",
        section_text,
        re.S | re.I,
    )
    if not table_match:
        return candidates

    table_text = table_match.group(0)

    # Strategy: The table is extracted as flowing text. Each candidate entry
    # follows the pattern: Surname  OtherNames  Address  Party  Subscribers
    # We need to identify where each new candidate starts.
    #
    # A new candidate starts with a line that has a capitalized word at the
    # start that is NOT a continuation of the previous entry's subscribers
    # or address.
    #
    # Best heuristic: split on lines that match "Surname OtherNames" pattern
    # where Surname is title-case and OtherNames follows.

    lines = table_text.split("\n")
    # Remove header lines
    start_idx = 0
    for i, line in enumerate(lines):
        if "SUBSCRIBERS" in line or "(if any)" in line:
            start_idx = i + 1
            break

    # Collect all text after header
    body = "\n".join(lines[start_idx:])

    # Try to split by candidate entries.
    # Each row in the original table has: Surname | Other Names | Address | Description | Subscribers
    # In the extracted text, these flow together.
    # The most reliable marker is that subscriber names are ALL CAPS
    # and candidate surnames are Title Case (or sometimes ALL CAPS in older docs).

    # Approach: find all "Surname OtherNames" pairs where:
    # - The word appears at or near the start of a logical entry
    # - Followed by "(address in the..." or a real address

    # Simplified: extract using the address pattern as delimiter
    # Each candidate has either "(address in the X Constituency)" or a real address
    entries = re.split(
        r"(?=\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+[A-Z][a-z]+\s+(?:\(address|\d+\s))",
        body,
    )

    # Alternative simpler approach: just extract surname + other names pairs
    # Pattern: TitleCase word(s) followed by more TitleCase words, then address
    name_pattern = re.compile(
        r"^([A-Za-z'\-]+(?:\s+[A-Za-z'\-]+)?)\s+"  # Surname (1-2 words)
        r"([A-Za-z'\-éáíóú\s]+?)\s+"  # Other names
        r"(?:\(address|(?:\d+\s))",  # Address start
        re.M,
    )

    for m in name_pattern.finditer(body):
        surname = m.group(1).strip()
        other_names = m.group(2).strip()
        # Skip if it looks like a subscriber name (ALL CAPS) or party name
        if surname.isupper() and len(surname) > 3:
            continue
        if surname in ("SURNAME", "OTHER", "ADDRESS", "DESCRIPTION", "SUBSCRIBERS"):
            continue
        candidates.append({
            "surname": surname,
            "other_names": other_names,
        })

    # If regex approach got nothing, try a cruder approach
    if not candidates:
        # Look for "Surname OtherNames (address" pattern more loosely
        crude = re.findall(
            r"([A-Z][a-z'\-]+(?:\s+[a-z][a-z'\-]+)?)\s+"
            r"([A-Z][a-záéíóú'\-\s]+?)\s+"
            r"\(?address",
            body,
        )
        for surname, other in crude:
            candidates.append({"surname": surname.strip(), "other_names": other.strip()})

    # Even cruder: just find lines that start with title-case words
    # followed by more names before an address or party
    if not candidates:
        for line in body.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Check for "Surname OtherNames" at start
            m = re.match(r"^([A-Z][a-z'\-]+)\s+([A-Z][a-záéíóú'\-]+(?:\s+[A-Z][a-záéíóú'\-]+)*)", line)
            if m:
                surname = m.group(1)
                other = m.group(2)
                if surname not in ("The", "Published", "Dated", "Electoral", "Election"):
                    candidates.append({"surname": surname, "other_names": other})

    return candidates


def parse_subscribers(section_text: str) -> dict[str, list[str]]:
    """Extract subscriber lists per candidate. Returns {candidate_name: [subscribers]}."""
    # Subscribers are ALL CAPS names, comma-separated, in the SUBSCRIBERS column
    # This is hard to associate with specific candidates from flowing text
    # For now, just extract all ALL-CAPS name sequences
    all_subs = re.findall(
        r"([A-Z][A-Z\s'\-]+(?:,\s*[A-Z][A-Z\s'\-]+)+)",
        section_text,
    )
    return {"all_subscribers": all_subs}


def section_to_markdown(const: str, section: str, election_type: str, poll_date: str,
                         source_file: str) -> str:
    """Convert a constituency section to Markdown."""
    candidates = parse_candidates(section)
    seats = parse_seats(section) or parse_seats(section.replace("\n", " "))
    ro = parse_returning_officer(section)

    md = []
    md.append(f"# Statement of Persons Nominated")
    md.append(f"")
    md.append(f"**Election:** {election_type}")
    md.append(f"**Constituency:** {const}")
    md.append(f"**Poll Date:** {poll_date}")
    if seats:
        md.append(f"**Seats:** {seats}")
    if ro:
        md.append(f"**Returning Officer:** {ro}")
    md.append(f"**Source:** `{source_file}`")
    md.append(f"")
    md.append(f"## Candidates")
    md.append(f"")
    md.append(f"| Surname | Other Names |")
    md.append(f"|---------|-------------|")

    seen = set()
    for c in candidates:
        key = (c["surname"].lower(), c["other_names"].lower())
        if key in seen:
            continue
        seen.add(key)
        md.append(f"| {c['surname']} | {c['other_names']} |")

    if not candidates:
        md.append(f"| *(could not parse candidates from PDF)* | |")

    md.append(f"")

    # Extract raw candidate block for manual review
    table_match = re.search(
        r"(SURNAME\s+OTHER\s+NAMES.*?)(?=The poll|The number|Dated:|Published and printed)",
        section,
        re.S | re.I,
    )
    if table_match:
        raw = table_match.group(1).strip()
        # Clean up
        raw_lines = [l.strip() for l in raw.split("\n") if l.strip()]
        md.append(f"## Raw Table Text")
        md.append(f"")
        md.append(f"```")
        for line in raw_lines[:100]:
            md.append(line)
        md.append(f"```")
        md.append(f"")

    return "\n".join(md)


def main():
    pdf_dirs = [Path("_tmp_eoni_spn"), Path("_tmp_eoni_agents")]
    total_md = 0
    total_const = 0

    for base in pdf_dirs:
        for pdf in sorted(base.rglob("*.pdf")):
            print(f"Processing {pdf}...")
            try:
                text = extract_full_text(pdf)
            except Exception as e:
                print(f"  ERROR reading PDF: {e}")
                continue

            election_type = parse_election_type(text)
            poll_date = parse_date(text)

            # Determine if this is an SPN or Agent document
            is_agent = "agent" in str(pdf).lower() or "appointment" in text.lower()[:500]
            doc_type = "agent" if is_agent else "spn"

            # Split into constituencies
            sections = split_constituencies(text)

            for const, section in sections:
                const_clean = const.strip().title()
                if not const_clean or const_clean == "Unknown":
                    # Try harder
                    m = re.search(r"for the\s+(.+?)\s+(?:Constituency|Electoral)", section, re.I)
                    if m:
                        const_clean = m.group(1).strip().title()

                # Generate Markdown
                md = section_to_markdown(
                    const_clean, section, election_type, poll_date, pdf.name,
                )

                # Output path
                date_slug = re.sub(r"\s+", "-", poll_date) if poll_date else "undated"
                const_slug = re.sub(r"[^a-zA-Z0-9]+", "-", const_clean).strip("-").lower()
                if not const_slug:
                    const_slug = "unknown"

                out_subdir = OUT_DIR / f"{date_slug}_{election_type.replace(' ', '-')}" / doc_type
                out_subdir.mkdir(parents=True, exist_ok=True)
                out_path = out_subdir / f"{const_slug}.md"

                # Avoid overwriting with worse content
                if out_path.exists():
                    existing = out_path.read_text(encoding="utf-8")
                    if len(md) <= len(existing):
                        continue

                out_path.write_text(md, encoding="utf-8")
                total_md += 1
                total_const += 1

    # Summary
    print(f"\nGenerated {total_md} Markdown files in {OUT_DIR}")
    for subdir in sorted(OUT_DIR.iterdir()):
        if subdir.is_dir():
            for doc_subdir in sorted(subdir.iterdir()):
                if doc_subdir.is_dir():
                    count = sum(1 for _ in doc_subdir.glob("*.md"))
                    print(f"  {subdir.name}/{doc_subdir.name}: {count} files")


if __name__ == "__main__":
    main()
