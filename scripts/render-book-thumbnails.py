#!/usr/bin/env python3
"""Give every book in the catalogue a thumbnail.

    python scripts/render-book-thumbnails.py [--ids a,b]

A book with a PDF gets its first page. A book with none -- the NI Parliamentary Debates,
published as transcriptions only, and a report whose scan is withheld -- gets a plain title
cover instead: its title and year set on a coloured board, which stands for the book
without pretending to be a scan of it. Output matches the existing book thumbnails:
assets/thumbnails/book-<id>.png and .webp at 150x215, and book-<id>-60.webp.
"""
import json
import os
import re
import sys
import textwrap

import requests
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
THUMBS = os.path.join(ROOT, 'assets', 'thumbnails')
CACHE = os.path.join(ROOT, '.cache', 'book-pdfs')
W, H = 150, 215
# Serif faces from the system: Windows' Fonts folder, else the usual Linux and macOS ones.
FONT_DIRS = [os.path.join(os.environ.get('WINDIR', ''), 'Fonts'), '/usr/share/fonts/truetype/dejavu',
             '/usr/share/fonts/truetype/liberation', '/Library/Fonts']
# Board colours by chamber, else by category; text is set in a pale gold.
BOARDS = {'house of commons': (31, 77, 58), 'senate': (122, 31, 43)}
DEFAULT_BOARD = (30, 58, 95)
INK = (232, 214, 160)


def font(name, size):
    for candidate in (name, 'georgiab.ttf', 'timesbd.ttf', 'LiberationSerif-Bold.ttf', 'DejaVuSerif-Bold.ttf'):
        for folder in FONT_DIRS:
            path = os.path.join(folder, candidate)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def save(im, book_id):
    stem = os.path.join(THUMBS, f'book-{book_id}')
    im = im.convert('RGB')
    im.save(stem + '.png')
    im.save(stem + '.webp', 'WEBP', quality=82, method=6)
    im.resize((60, round(60 * im.height / im.width)), Image.LANCZOS).save(stem + '-60.webp', 'WEBP', quality=80, method=6)


def first_page(book):
    import fitz
    url = book['file'] if book['file'].startswith('http') else 'https://civgraph.net/' + book['file'].lstrip('/')
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9._-]', '_', os.path.basename(url)))
    if not os.path.exists(path):
        r = requests.get(url, timeout=300, headers={'User-Agent': 'civgraph-thumbnails/1.0'})
        r.raise_for_status()
        open(path, 'wb').write(r.content)
    with fitz.open(path) as doc:
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(W / page.rect.width * 2, W / page.rect.width * 2))
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    im = im.resize((W, round(W * im.height / im.width)), Image.LANCZOS)
    # Pad or crop to the shelf's portrait shape so every card lines up.
    out = Image.new('RGB', (W, H), (255, 255, 255))
    out.paste(im.crop((0, 0, W, min(H, im.height))), (0, 0))
    return out


def title_cover(book):
    title = book['title']
    m = re.match(r'Parliamentary Debates \((House of Commons|Senate)\)\s*(.*)$', title)
    board = BOARDS.get(m.group(1).lower(), DEFAULT_BOARD) if m else DEFAULT_BOARD
    im = Image.new('RGB', (W, H), board)
    d = ImageDraw.Draw(im)
    d.rectangle((6, 6, W - 7, H - 7), outline=INK, width=1)
    centre = lambda y, text, f: d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=INK)
    if m:
        centre(22, 'PARLIAMENTARY', font('georgiab.ttf', 12))
        centre(38, 'DEBATES', font('georgiab.ttf', 12))
        d.line((40, 60, W - 40, 60), fill=INK, width=1)
        chamber = 'HOUSE OF COMMONS' if m.group(1) == 'House of Commons' else 'SENATE'
        centre(70, chamber, font('georgia.ttf', 10))
        centre(86, 'NORTHERN IRELAND', font('georgia.ttf', 9))
        years = m.group(2) or book.get('dateDisplay') or ''
        size = 26 if len(years) <= 4 else 16
        centre(H - 70, years, font('georgiab.ttf', size))
    else:
        y = 24
        f = font('georgiab.ttf', 12)
        for line in textwrap.wrap(re.sub(r'\s*\(.*?\)\s*', ' ', title), 18)[:7]:
            centre(y, line, f)
            y += 17
        centre(H - 40, str(book.get('dateDisplay') or book.get('date') or ''), font('georgia.ttf', 11))
    return im


def main():
    books = json.load(open(os.path.join(ROOT, 'data', 'database', 'books.json'), encoding='utf-8'))['books']
    listed = set(json.load(open(os.path.join(THUMBS, 'manifest.json'), encoding='utf-8')))
    only = set(sys.argv[sys.argv.index('--ids') + 1].split(',')) if '--ids' in sys.argv else None
    todo = [b for b in books if (b['id'] in only if only else f"book-{b['id']}" not in listed)]
    print(f'{len(todo)} book thumbnail(s) to render')
    for b in todo:
        try:
            kind = 'first page' if b.get('file') else 'title cover'
            save(first_page(b) if b.get('file') else title_cover(b), b['id'])
            print(f"  {b['id']}: {kind}")
        except Exception as exc:
            print(f"  {b['id']}: FAILED {exc}")


if __name__ == '__main__':
    main()
