#!/usr/bin/env python
"""Identify which elections the undated markdown files belong to."""
import re
from pathlib import Path

dirs_to_check = [
    Path("_tmp_eoni_markdown/undated_NI-Assembly/spn"),
    Path("_tmp_eoni_markdown/undated_NI-Assembly/agent"),
    Path("_tmp_eoni_markdown/undated_Unknown/spn"),
    Path("_tmp_eoni_markdown/undated_Unknown/agent"),
    Path("_tmp_eoni_markdown/undated_European-Parliament/spn"),
    Path("_tmp_eoni_markdown/undated_European-Parliament/agent"),
]

for d in dirs_to_check:
    if not d.exists():
        continue
    print(f"\n=== {d} ===")
    for md in sorted(d.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        # Extract poll date
        dm = re.search(r"\*\*Poll Date:\*\*\s*(.+)", text)
        poll_date = dm.group(1).strip() if dm else "NO DATE FOUND"
        # Extract constituency
        cm = re.search(r"\*\*Constituency:\*\*\s*(.+)", text)
        const = cm.group(1).strip() if cm else "?"
        # Extract election type
        em = re.search(r"\*\*Election:\*\*\s*(.+)", text)
        etype = em.group(1).strip() if em else "?"
        # Get candidate count
        seat_m = re.search(r"\*\*Seats:\*\*\s*(.+)", text)
        seats = seat_m.group(1).strip() if seat_m else "?"

        print(f"  {md.name}: date={poll_date}, type={etype}, const={const}, seats={seats}")
