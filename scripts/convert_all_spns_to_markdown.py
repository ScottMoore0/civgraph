#!/usr/bin/env python
"""Convert ALL SPN and Agent PDFs/DOCX to Markdown — handles both EONI and council formats."""

import json
import re
from collections import defaultdict
from pathlib import Path

from PyPDF2 import PdfReader

OUT_DIR = Path("_tmp_eoni_markdown")
OUT_DIR.mkdir(exist_ok=True)


def extract_pdf_text(pdf_path: Path) -> str:
    try:
        reader = PdfReader(str(pdf_path))
        text = ""
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n"
        return text
    except Exception as e:
        return f"PARSE_ERROR: {e}"


def extract_docx_text(docx_path: Path) -> str:
    """Extract text from a .docx file."""
    import zipfile
    import xml.etree.ElementTree as ET
    try:
        with zipfile.ZipFile(str(docx_path)) as z:
            xml_content = z.read("word/document.xml")
        tree = ET.fromstring(xml_content)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = []
        for p in tree.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
            texts = [t.text for t in p.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t") if t.text]
            if texts:
                paragraphs.append(" ".join(texts))
        return "\n".join(paragraphs)
    except Exception as e:
        return f"PARSE_ERROR: {e}"


def parse_metadata(text: str, source_dir: str, filename: str) -> dict:
    """Extract election metadata from SPN text, with fallbacks from directory/filename."""
    meta = {
        "election_type": "Unknown",
        "constituency": "Unknown",
        "poll_date": "",
        "seats": "",
        "returning_officer": "",
    }

    # Election type from text
    if "Northern Ireland Assembly" in text:
        meta["election_type"] = "NI Assembly"
    elif "House of Commons" in text or "Member of Parliament" in text:
        meta["election_type"] = "Westminster"
    elif "European" in text:
        meta["election_type"] = "European Parliament"
    elif "local council" in text.lower() or "Local Government" in text or "council" in text.lower():
        meta["election_type"] = "Local Government"
    elif "By-Election" in text or "by-election" in text:
        meta["election_type"] = "By-election"

    # Fallback from directory name
    if meta["election_type"] == "Unknown":
        if "assembly" in source_dir:
            meta["election_type"] = "NI Assembly"
        elif "westminster" in source_dir:
            meta["election_type"] = "Westminster"
        elif "local" in source_dir:
            meta["election_type"] = "Local Government"
        elif "european" in source_dir:
            meta["election_type"] = "European Parliament"

    # Constituency from text
    # Pattern 1: "for the\n CONSTITUENCY NAME Constituency"
    m = re.search(r"for\s+the\s*\n?\s*([A-Z][A-Z\s,&'\-]+?)(?:\s*Constituency|\s*Electoral|\s*District|\s*Local)",
                  text, re.S)
    if m:
        meta["constituency"] = m.group(1).strip()
    else:
        # Pattern 2: "District Electoral Area of CONSTITUENCY"
        m2 = re.search(r"(?:District Electoral Area|DEA)\s+(?:of\s+)?([A-Z][A-Za-z\s,&'\-]+?)(?:\s*\n|\s*The|\s*Statement)", text)
        if m2:
            meta["constituency"] = m2.group(1).strip()

    # Fallback from filename
    if meta["constituency"] == "Unknown":
        # Try extracting DEA name from filename
        fname = filename.replace(".pdf", "").replace(".docx", "").replace(".aspx", "")
        # Remove common prefixes
        for prefix in ["spn-", "SPN-", "Statement-of-Persons-Nominated-and-Notice-of-Poll-",
                        "Statement-of-Persons-Nominated-", "Statement_of_Persons_Nominated_and_Notice_of_Poll_-_",
                        "Statement_of_Persons_Nominated_and_Notice_of_Poll_",
                        "Local-Council-Elections-Statement-of-Persons-Nominated-and-Notice-of-Poll-",
                        "Signed-", "SOPN-and-Notice-of-Poll"]:
            fname = fname.replace(prefix, "")
        # Remove suffixes
        for suffix in ["-DEA", "_DEA", "-Final", "_Final", "-A3-1-copy", "_1", "(1)", "(2)", "-Signed"]:
            fname = fname.replace(suffix, "")
        fname = fname.strip("-_ ")
        if fname and len(fname) > 2:
            meta["constituency"] = fname.replace("-", " ").replace("_", " ").strip().title()

    # Poll date
    m = re.search(r"poll.*?will be held on\s+\w+\s+(\d{1,2}\s+\w+\s+\d{4})", text, re.I | re.S)
    if m:
        meta["poll_date"] = m.group(1).strip()
    else:
        m2 = re.search(r"Dated:?\s*\w+day\s+(\d{1,2}\s+\w+\s+\d{4})", text)
        if m2:
            meta["poll_date"] = m2.group(1).strip()
        else:
            # Fallback from directory
            dm = re.search(r"(20\d{2})", source_dir)
            if dm:
                meta["poll_date"] = dm.group(1)

    # Seats
    m = re.search(r"number of (?:members|councillors|candidates) to be elected is\s+(\w+)", text, re.I)
    if m:
        meta["seats"] = m.group(1)

    return meta


def text_to_markdown(text: str, meta: dict, source_file: str) -> str:
    """Convert extracted text + metadata to Markdown."""
    md = []
    md.append(f"# Statement of Persons Nominated")
    md.append(f"")
    md.append(f"**Election:** {meta['election_type']}")
    md.append(f"**Constituency:** {meta['constituency']}")
    md.append(f"**Poll Date:** {meta['poll_date']}")
    if meta["seats"]:
        md.append(f"**Seats:** {meta['seats']}")
    md.append(f"**Source:** `{source_file}`")
    md.append(f"")

    # Extract raw table text
    table_match = re.search(
        r"(SURNAME\s+OTHER\s+NAMES.*?)(?=The poll|The number|Dated:|Published and printed|$)",
        text, re.S | re.I,
    )
    if table_match:
        raw = table_match.group(1).strip()
    else:
        # For council SPNs the header might be different
        table_match2 = re.search(r"(SURNAME.*?)(?=The poll|The number|Dated|Published|$)", text, re.S | re.I)
        raw = table_match2.group(1).strip() if table_match2 else text[:3000]

    md.append(f"## Raw Table Text")
    md.append(f"")
    md.append(f"```")
    for line in raw.split("\n")[:150]:
        md.append(line.rstrip())
    md.append(f"```")
    md.append(f"")

    return "\n".join(md)


def main():
    source_dirs = [Path("_tmp_eoni_spn"), Path("_tmp_eoni_agents")]
    total = 0
    skipped = 0

    for base in source_dirs:
        for src_file in sorted(base.rglob("*")):
            if src_file.suffix.lower() not in (".pdf", ".docx"):
                continue
            if src_file.stat().st_size < 1000:
                continue

            source_dir = src_file.parent.name
            filename = src_file.name

            # Determine doc type
            is_agent = "agent" in str(src_file).lower() or "appointment" in filename.lower()
            doc_type = "agent" if is_agent else "spn"

            # Extract text
            if src_file.suffix.lower() == ".docx":
                text = extract_docx_text(src_file)
            else:
                text = extract_pdf_text(src_file)

            if text.startswith("PARSE_ERROR"):
                continue

            # Parse metadata
            meta = parse_metadata(text, source_dir, filename)

            # Build output path
            date_slug = re.sub(r"\s+", "-", meta["poll_date"]) if meta["poll_date"] else "undated"
            # Use source directory year if date is just a year
            if re.match(r"^\d{4}$", date_slug):
                date_slug = f"{date_slug}"

            etype_slug = meta["election_type"].replace(" ", "-")
            const_slug = re.sub(r"[^a-zA-Z0-9]+", "-", meta["constituency"]).strip("-").lower()
            if not const_slug or const_slug == "unknown":
                const_slug = re.sub(r"[^a-zA-Z0-9]+", "-", filename).strip("-").lower()[:50]

            out_dir = OUT_DIR / f"{date_slug}_{etype_slug}" / doc_type
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{const_slug}.md"

            # Skip if already exists and is larger (don't overwrite better versions)
            if out_path.exists():
                existing_size = out_path.stat().st_size
                new_content = text_to_markdown(text, meta, filename)
                if len(new_content) <= existing_size:
                    skipped += 1
                    continue
            else:
                new_content = text_to_markdown(text, meta, filename)

            out_path.write_text(new_content, encoding="utf-8")
            total += 1

    print(f"Generated {total} Markdown files, skipped {skipped} (already exist)")
    print()

    # Summary
    for subdir in sorted(OUT_DIR.iterdir()):
        if subdir.is_dir():
            for doc_subdir in sorted(subdir.iterdir()):
                if doc_subdir.is_dir():
                    count = sum(1 for _ in doc_subdir.glob("*.md"))
                    if count:
                        print(f"  {subdir.name}/{doc_subdir.name}: {count}")


if __name__ == "__main__":
    main()
