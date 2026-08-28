#!/usr/bin/env python3
"""
Cut the Statement of Persons Nominated out of a newspaper page, big enough to read.

WHY

These notices sit in one or two columns of a dense broadsheet -- the 1954 Armagh notice is
the top-right corner of a page otherwise given over to cattle-market advertising. Rendered
whole, the page is unreadable at any sane resolution; the notice is perhaps 6% of it.

OCR has been tried twice on these scans and both passes damage the text (see
docs/review/SPN-OCR-PROVENANCE.md). This exists so a human -- or a model that can look at
images -- can read the notice directly instead, which is the only method that resolves a
truncated surname or an assentor list the OCR interleaved.

HOW

Tesseract's word boxes locate the heading ("PERSONS NOMINATED", "NOMINATED", "ELECTION
AGENTS"), the matching columns are taken whole from the top of the page to the bottom of the
notice, and that region is rendered at high DPI. Column bounds come from the word boxes of
everything vertically aligned with the heading, so a notice spanning two columns is not cut
in half.

    python scripts/ocr/crop-spn-region.py --only BL_0000038_19541123
    python scripts/ocr/crop-spn-region.py --all --out <dir>
"""
import argparse
import glob
import os
import shutil
import sys

import fitz  # PyMuPDF
import numpy as np
import pytesseract
from pytesseract import Output
from PIL import Image

# Same resolution order as reocr-spn-columns.py: TESSERACT_CMD, then PATH, then the
# conventional Windows install directory built from %ProgramFiles% rather than pinned.
_default_windows = os.path.join(
    os.environ.get("ProgramFiles", os.sep.join(["C:", "Program Files"])),
    "Tesseract-OCR", "tesseract.exe")
for _candidate in (os.environ.get("TESSERACT_CMD"), shutil.which("tesseract"), _default_windows):
    if _candidate and os.path.exists(_candidate):
        pytesseract.pytesseract.tesseract_cmd = _candidate
        break

# Words that mark a nomination notice. "WITHDRAWN" is included deliberately: a page whose
# only marker is the withdrawal paragraph still carries nomination content, and those are
# the pages the join rate was worst on.
MARKERS = ("NOMINATED", "NOMINATION", "NOMINATIONS", "WITHDRAWN", "ASSENTORS", "SUBSCRIBERS")


def _save(array, path):
    Image.fromarray(array).save(path)


def page_image(page, dpi):
    pixmap = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width)


def find_region(gray, pad_frac=0.02):
    """Bounding box (left, top, right, bottom) of the nomination notice, or None."""
    data = pytesseract.image_to_data(gray, config="--psm 11 -l eng", output_type=Output.DICT)
    height, width = gray.shape

    hits = []
    for index, word in enumerate(data["text"]):
        token = "".join(ch for ch in word.upper() if ch.isalpha())
        if token in MARKERS:
            hits.append(index)
    if not hits:
        return None

    # Take the columns the markers sit in, full height, rather than a tight box round the
    # words: the candidate table runs well below its heading, and a tight box loses it.
    lefts = [data["left"][i] for i in hits]
    rights = [data["left"][i] + data["width"][i] for i in hits]
    tops = [data["top"][i] for i in hits]

    left = max(0, min(lefts) - int(width * 0.06))
    right = min(width, max(rights) + int(width * 0.14))
    top = max(0, min(tops) - int(height * 0.03))
    # Stop below the LAST marker rather than running to the foot of the page. Taking the
    # full column height produced a 1227x6957 strip -- the notice plus every classified ad
    # under it, unreadable at any zoom that fits on screen.
    bottom = min(height, max(tops) + int(height * 0.40))

    pad = int(width * pad_frac)
    return (max(0, left - pad), max(0, top - pad), min(width, right + pad), min(height, bottom))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=None)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--out", default="spn-crops")
    parser.add_argument("--dpi", type=int, default=600, help="render dpi for the crop")
    parser.add_argument("--find-dpi", type=int, default=200, help="dpi used only to locate")
    parser.add_argument("--tile", type=int, default=2400, help="max tile height in px")
    parser.add_argument("--overlap", type=int, default=200, help="tile overlap in px")
    args = parser.parse_args()

    pdfs = sorted(glob.glob("BL_*.pdf"))
    if args.only:
        pdfs = [p for p in pdfs if args.only in p]
    elif not args.all:
        print("Pass --only <stem> or --all.", file=sys.stderr)
        return 1
    if not pdfs:
        print("No matching BL_*.pdf.", file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)
    for pdf in pdfs:
        stem = os.path.splitext(os.path.basename(pdf))[0]
        document = fitz.open(pdf)
        for number, page in enumerate(document, 1):
            small = page_image(page, args.find_dpi)
            box = find_region(small)
            if not box:
                print(f"{stem} p{number}: no nomination marker found")
                continue
            scale = args.dpi / args.find_dpi
            clip = fitz.Rect(*[value * scale * 72.0 / args.dpi for value in box])
            pixmap = page.get_pixmap(dpi=args.dpi, clip=clip, colorspace=fitz.csGRAY)
            # A tall narrow strip is unreadable when scaled to fit, so slice it into
            # overlapping tiles. The overlap matters: a candidate's row runs several lines
            # deep and a clean cut would split a name from its agent.
            raw = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width)
            written = []
            if pixmap.height <= args.tile:
                target = os.path.join(args.out, f"{stem}_p{number}.png")
                _save(raw, target)
                written.append(target)
            else:
                step = args.tile - args.overlap
                for order, start in enumerate(range(0, pixmap.height, step), 1):
                    end = min(pixmap.height, start + args.tile)
                    if end - start < args.overlap:
                        break
                    target = os.path.join(args.out, f"{stem}_p{number}_t{order}.png")
                    _save(raw[start:end, :], target)
                    written.append(target)
                    if end >= pixmap.height:
                        break
            print(f"{stem} p{number}: {pixmap.width}x{pixmap.height} -> {len(written)} tile(s)")
        document.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
