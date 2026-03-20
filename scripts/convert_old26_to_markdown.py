"""Convert old-council SPN and Agent PDFs/DOCs to markdown for text extraction."""
import fitz
import os
import json
from pathlib import Path

BASE = Path("C:/Users/scomo/boundaries-website")
OUT_BASE = BASE / "_tmp_gazette_markdown" / "old26_councils"
OUT_BASE.mkdir(parents=True, exist_ok=True)

source_dirs = []
for parent in [BASE / "_tmp_eoni_spn", BASE / "_tmp_eoni_agents"]:
    if not parent.exists():
        continue
    for d in sorted(parent.iterdir()):
        if d.is_dir() and "old26" in d.name:
            source_dirs.append(d)

index = []
total_ok = 0
total_fail = 0

for src_dir in source_dirs:
    category = src_dir.parent.name.replace("_tmp_eoni_", "")  # "spn" or "agents"
    dir_label = f"{category}_{src_dir.name}"
    out_dir = OUT_BASE / dir_label
    out_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(src_dir.iterdir())
    for f in files:
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext not in (".pdf", ".doc"):
            continue

        file_size = f.stat().st_size
        md_name = f.stem + ".md"
        md_path = out_dir / md_name

        entry = {
            "source": str(f),
            "output": str(md_path),
            "dir": dir_label,
            "filename": f.name,
            "extension": ext,
            "file_size_bytes": file_size,
            "status": "ok",
            "pages": 0,
            "error": None
        }

        if ext == ".pdf":
            try:
                doc = fitz.open(str(f))
                page_count = doc.page_count
                entry["pages"] = page_count

                lines = []
                lines.append(f"# {f.stem}")
                lines.append("")
                lines.append("## Metadata")
                lines.append(f"- **Source**: `{f}`")
                lines.append(f"- **File size**: {file_size:,} bytes")
                lines.append(f"- **Pages**: {page_count}")
                lines.append(f"- **Format**: PDF")
                lines.append("")
                lines.append("---")
                lines.append("")

                for i in range(page_count):
                    page = doc[i]
                    text = page.get_text()
                    if page_count > 1:
                        lines.append(f"## Page {i+1}")
                        lines.append("")
                    lines.append(text.strip())
                    lines.append("")

                doc.close()
                md_path.write_text("\n".join(lines), encoding="utf-8")
                total_ok += 1

            except Exception as e:
                entry["status"] = "error"
                entry["error"] = str(e)
                total_fail += 1
                md_path.write_text(
                    f"# {f.stem}\n\n## Metadata\n- **Source**: `{f}`\n- **File size**: {file_size:,} bytes\n- **Format**: PDF\n\n---\n\n**ERROR**: Failed to extract text: {e}\n",
                    encoding="utf-8"
                )

        elif ext == ".doc":
            try:
                doc = fitz.open(str(f))
                page_count = doc.page_count
                entry["pages"] = page_count

                lines = []
                lines.append(f"# {f.stem}")
                lines.append("")
                lines.append("## Metadata")
                lines.append(f"- **Source**: `{f}`")
                lines.append(f"- **File size**: {file_size:,} bytes")
                lines.append(f"- **Pages**: {page_count}")
                lines.append(f"- **Format**: DOC (converted via PyMuPDF)")
                lines.append("")
                lines.append("---")
                lines.append("")

                for i in range(page_count):
                    page = doc[i]
                    text = page.get_text()
                    if page_count > 1:
                        lines.append(f"## Page {i+1}")
                        lines.append("")
                    lines.append(text.strip())
                    lines.append("")

                doc.close()
                md_path.write_text("\n".join(lines), encoding="utf-8")
                total_ok += 1

            except Exception as e:
                entry["status"] = "needs_manual"
                entry["error"] = f"DOC format, needs manual conversion: {e}"
                total_fail += 1
                md_path.write_text(
                    f"# {f.stem}\n\n## Metadata\n- **Source**: `{f}`\n- **File size**: {file_size:,} bytes\n- **Format**: DOC\n\n---\n\n**NOTE**: DOC format, needs manual conversion. PyMuPDF error: {e}\n",
                    encoding="utf-8"
                )

        index.append(entry)

# Write index
index_path = OUT_BASE / "index.json"
with open(index_path, "w", encoding="utf-8") as fp:
    json.dump({
        "generated": "2026-03-20",
        "total_files": len(index),
        "successful": total_ok,
        "failed": total_fail,
        "files": index
    }, fp, indent=2)

print(f"Processed {len(index)} files: {total_ok} OK, {total_fail} failed")
print(f"Index written to: {index_path}")

for e in index:
    if e["status"] != "ok":
        print(f"  FAIL: {e['filename']} -> {e['error']}")
