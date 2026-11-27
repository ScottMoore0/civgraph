#!/usr/bin/env python3
"""Render census report pages to images and read them with Tesseract (--psm 6, which keeps a
printed row on one line), caching both, for the 1937, 1951, 1961 and 1966 area tables.

The pages are listed in hist-census-pages.json (next to this script): year -> report -> table ->
pages (1-based PDF page numbers). Images and text go to <out>/ocr/<year>/<report>-p<NNN>.{png,txt};
an existing .txt is reused unless --force.

Usage: python scripts/ingest/census/hist_census_ocr.py --year 1937 [--reports DIR] [--out DIR] [--dpi 300] [--force]
Report PDFs: in --reports (default HIST_CENSUS_REPORTS). Tesseract: the TESSERACT env var, else
Tesseract-OCR under %ProgramFiles%, else on PATH.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_paths import OUT, REPORTS  # noqa: E402


def tesseract():
    pf = os.environ.get('ProgramFiles')
    for c in (os.environ.get('TESSERACT'), pf and os.path.join(pf, 'Tesseract-OCR', 'tesseract.exe'), shutil.which('tesseract')):
        if c and os.path.exists(c):
            return c
    raise SystemExit('tesseract not found (set TESSERACT)')


def pages_config():
    with open(os.path.join(HERE, 'hist-census-pages.json'), encoding='utf-8') as f:
        return json.load(f)


def page_files(out, year, report, page):
    stem = os.path.splitext(os.path.basename(report))[0]
    d = os.path.join(out, 'ocr', str(year))
    return os.path.join(d, f'{stem}-p{page:03d}.png'), os.path.join(d, f'{stem}-p{page:03d}.txt')


# Independent readings of each page: the parser takes, for each row, the first reading whose
# persons = males + females. '' is the main one (300 dpi, --psm 6); 'b' reads at 400 dpi; 'c'
# reads the 300 dpi image with --psm 4 (one column of variable-size text). 'p' is the PDF's own
# text layer, rebuilt into rows (text_layer_lines).
PASSES = {'': (300, 6), 'b': (400, 6), 'c': (300, 4)}


def pass_txt(txt, name):
    return txt if not name else f'{txt[:-4]}.{name}.txt'


def ocr_page(pdf, page, png, txt, dpi=300, psm=6, force=False):
    import pymupdf
    if os.path.exists(txt) and not force:
        return txt
    os.makedirs(os.path.dirname(png), exist_ok=True)
    doc = pymupdf.open(pdf)
    if dpi != 300:
        png = png[:-4] + f'.{dpi}.png'
    if force or not os.path.exists(png):
        doc[page - 1].get_pixmap(dpi=dpi).save(png)
    subprocess.run([tesseract(), png, txt[:-4], '--psm', str(psm), '-c', 'preserve_interword_spaces=1'],
                   check=True, capture_output=True)
    return txt


def text_layer_lines(pdf, page, tol=3.0):
    """The PDF's own text layer (the scan's embedded OCR, a different engine), rebuilt into
    printed rows: words grouped by the height of their middle, then ordered left to right."""
    import pymupdf
    doc = pymupdf.open(pdf)
    words = sorted(doc[page - 1].get_text('words'), key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    lines, cur, cy = [], [], None
    for w in words:
        y = (w[1] + w[3]) / 2
        if cy is None or abs(y - cy) <= tol:
            cur.append(w)
            cy = y if cy is None else (cy * (len(cur) - 1) + y) / len(cur)
        else:
            lines.append(cur)
            cur, cy = [w], y
    if cur:
        lines.append(cur)
    return [' '.join(w[4] for w in sorted(line, key=lambda w: w[0])) for line in lines]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', required=True)
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--reports', default=REPORTS, help='folder of the report PDFs (HIST_CENSUS_REPORTS)')
    ap.add_argument('--passes-for', default='T4', help='tables read three ways (comma list)')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    cfg = pages_config()[args.year]
    args.passes_for = args.passes_for.split(',')
    n = 0
    for report, spec in cfg['reports'].items():
        pdf = os.path.join(args.reports, report)
        for table, pages in spec['tables'].items():
            for page in pages:
                png, txt = page_files(args.out, args.year, report, page)
                for name, (dpi, psm) in PASSES.items():
                    if name and table not in args.passes_for:
                        continue
                    ocr_page(pdf, page, png, pass_txt(txt, name), dpi, psm, force=args.force)
                ptxt = pass_txt(txt, 'p')
                if args.force or not os.path.exists(ptxt):
                    with open(ptxt, 'w', encoding='utf-8') as f:
                        f.write('\n'.join(text_layer_lines(pdf, page)) + '\n')
                n += 1
    print(f'{args.year}: {n} pages read', file=sys.stderr)


if __name__ == '__main__':
    main()
