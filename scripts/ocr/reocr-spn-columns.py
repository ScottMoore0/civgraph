#!/usr/bin/env python3
"""
Re-OCR the Statement of Persons Nominated newspaper scans with column-aware segmentation.

WHY

The first pass over these scans (whatever produced ocr_output/) read each page as one block
running left to right across the full width. On a newspaper page that interleaves adjacent
columns. The clearest case: the 1954 Armagh notice prints the candidate as "Arms|trong" with
the break falling between columns, so ocr_output/ contains "trong" and no "Armstrong"
anywhere on the page. Measured in docs/review/SPN-OCR-PROVENANCE.md, that class of damage
left 252 of 822 extracted candidates carrying a surname Civgraph has never seen.

The LLM extraction that read this text was NOT at fault -- every name it produced traces
back to the text it was given -- so better matching cannot recover the missing letters. The
damage is in the OCR, which is what this replaces.

WHAT WAS TRIED AND ABANDONED

Detecting column gutters by ink density, then OCRing each strip with --psm 6. It found ONE
column on the 1954 page and so changed nothing: these are dense classified pages where the
columns are separated by printed rules, not white space, and the whitespace profile has no
gaps to find. Recorded because it is the obvious approach and it does not work here.

WHAT WORKS

Tesseract's own --psm 4 ("a single column of text of variable sizes"), which segments the
page itself. On the 1954 page it recovers ARMSTRONG, CHRISTOPHER and FAIRLEY, none of which
appear anywhere in the old text. --psm 11 ("sparse text") is run as a second pass and
appended: it finds more fragments but in no reliable order, so it supplements the ordered
psm 4 text rather than replacing it.

WHAT THIS CANNOT FIX

Some of these scans are physically CROPPED mid-column, and no OCR setting recovers pixels
that are not in the image. On BL_0000960_19850425_239_0043 the surname column is cut off at
the left edge, so the page itself reads "ARPER | Patrick Francis" -- the candidate is Harper,
which his own seconder "Mary A. Harper" confirms two columns away. "LIGAN" is the tail of
Milligan and "HIRE" of Maguire, on the same page, for the same reason. Those need a better
scan from the British Newspaper Archive, not a better OCR pass.

    python scripts/ocr/reocr-spn-columns.py                    # all PDFs -> archive/ocr/text-v2/
    python scripts/ocr/reocr-spn-columns.py --only BL_0000038  # one stem
    python scripts/ocr/reocr-spn-columns.py --dpi 300
"""
import argparse
import glob
import os
import shutil
import sys

import fitz  # PyMuPDF
import numpy as np
import pytesseract

# Find Tesseract: TESSERACT_CMD wins, then PATH, then the usual Windows install location.
# Not hardcoded to one machine -- check:local-paths rejects that, rightly, since a pinned
# path runs nowhere else and in a public repo it also discloses local layout.
_default_windows = os.path.join(
    os.environ.get("ProgramFiles", r"C:\Program Files"), "Tesseract-OCR", "tesseract.exe")
for _candidate in (os.environ.get("TESSERACT_CMD"), shutil.which("tesseract"), _default_windows):
    if _candidate and os.path.exists(_candidate):
        pytesseract.pytesseract.tesseract_cmd = _candidate
        break

OUT_DIR = "archive/ocr/text-v2"


def page_image(page, dpi):
    """Render one PDF page to a grayscale numpy array."""
    pixmap = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width)


def process(job):
    """One PDF, start to finish. Top level so it can be sent to a worker process."""
    pdf, out_dir, dpi, overwrite = job
    stem = os.path.splitext(os.path.basename(pdf))[0]
    target = os.path.join(out_dir, f"{stem}.txt")
    if os.path.exists(target) and not overwrite:
        return f"{stem}: exists, skipping"
    try:
        document = fitz.open(pdf)
    except Exception as error:
        return f"{stem}: cannot open ({error})"

    chunks = []
    for number, page in enumerate(document, 1):
        gray = page_image(page, dpi)
        ordered = pytesseract.image_to_string(gray, config="--psm 4 -l eng")
        sparse = pytesseract.image_to_string(gray, config="--psm 11 -l eng")
        chunks.append(f"=== PAGE {number} (psm 4, column-segmented) ===")
        chunks.append(ordered.strip())
        chunks.append(f"=== PAGE {number} (psm 11, sparse -- unordered supplement) ===")
        chunks.append(sparse.strip())
    document.close()

    text = "\n".join(chunks)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text + "\n")
    return f"{stem}: {len(text)} chars"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--only", default=None, help="substring of the stem to process")
    parser.add_argument("--out", default=OUT_DIR)
    parser.add_argument("--overwrite", action="store_true")
    # Tesseract is single-threaded per call, and each page is independent, so this is
    # embarrassingly parallel. Run serially it is roughly ten hours for 77 scans; the only
    # reason to keep --jobs 1 is debugging.
    parser.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) // 4))
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    pdfs = sorted(glob.glob("BL_*.pdf"))
    if args.only:
        pdfs = [p for p in pdfs if args.only in p]
    if not pdfs:
        print("No BL_*.pdf found in the working directory.", file=sys.stderr)
        return 1

    jobs = [(pdf, args.out, args.dpi, args.overwrite) for pdf in pdfs]
    print(f"{len(pdfs)} PDF(s) -> {args.out}/ at {args.dpi} dpi, {args.jobs} worker(s)", flush=True)

    if args.jobs <= 1:
        for index, job in enumerate(jobs, 1):
            print(f"  [{index}/{len(jobs)}] {process(job)}", flush=True)
        return 0

    from concurrent.futures import ProcessPoolExecutor, as_completed
    done = 0
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(process, job): job[0] for job in jobs}
        for future in as_completed(futures):
            done += 1
            try:
                line = future.result()
            except Exception as error:
                line = f"{os.path.basename(futures[future])}: FAILED ({error})"
            print(f"  [{done}/{len(jobs)}] {line}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
