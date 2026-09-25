#!/usr/bin/env python3
"""Read the election tables out of B. M. Walker's two volumes of Irish election results.

    Parliamentary Election Results in Ireland, 1801-1922  (Royal Irish Academy, 1978)
    Parliamentary Election Results in Ireland, 1918-92    (Royal Irish Academy, 1992)

Both volumes are in copyright and are NOT part of this repository. This script reads
local scans whose location is given by WALKER_DIR; it extracts figures (facts, which carry
no copyright) and never reproduces the books' text. Nothing here writes to the site.

    WALKER_DIR=/path/to/scans python scripts/walker/extract.py <volume.pdf> 146 151

WHAT MAKES THESE PAGES HARD, and what each part below is for:

1. The rows are BOWED, not level. One line of the 1885 tables runs cy 1356 -> 1277 -> 1344
   from the left edge to the right: 79px of deviation against a 54px word height. That is
   page curl from a bound book, so no rotation removes it -- measured skew is 0.0 degrees
   -- and clustering words by their vertical centre either splits a bowed row or merges
   two straight ones. `bow_profile` measures the curve from the page itself and `flatten`
   subtracts it, after which ordinary grouping works.

2. The columns cannot be found from whitespace: candidate names fill the gaps, so the
   page has one continuous band of ink from x=0.08 to x=0.86. For the pre-1918 tables the
   printed HEADER gives the column centres exactly, per page, so nothing is assumed.

3. The elector count is not always comma'd -- Clare West 1885 is 9813, Cork city is
   14,569 -- so a column cannot be identified by number format. There are also THREE
   numeric columns, because the date carries a day of the month.

4. Long names wrap. A wrapped CONSTITUENCY continuation sits at roughly x 0.17-0.21 of the
   page width and a wrapped CANDIDATE continuation at roughly 0.55-0.67, which is what
   tells them apart. A wrapped candidate carries its vote on the second line.

5. Multi-member seats need no special case: Walker prints Cork city exactly like a
   single-member seat and states the exception in the page head -- "Each constituency
   returns one M.P., except Cork city and Dublin University with two each."
"""
import argparse
import io
import json
import os
import re
import statistics
import sys

try:
    import pytesseract
    from PIL import Image, ImageOps
    from pypdf import PdfReader
except ImportError as exc:  # pragma: no cover - dependency hint
    sys.exit(f"missing dependency: {exc}. Needs pypdf, pillow and pytesseract.")

# Both configurable: hardcoding either pins the script to one machine, which is what
# scripts/validate-local-paths.mjs exists to prevent.
TESSERACT = os.environ.get('TESSERACT_CMD')
if TESSERACT:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT
WALKER_DIR = os.environ.get('WALKER_DIR', '.')

PARTY_RE = re.compile(r"^[\[({]?(SF|IU|LU|APN|PN|HR|LRC|Nat|Conf|Loy|Ind|Lab|N|U|L|C|P|R)"
                      r"[.,]?(\.?U|\.?N|\.?C|\.?L)?(\((Ind|R|Lib|Con|C|L)\.?\)?)?"
                      r"[\])}]?[.,]?$", re.I)
NUM_RE = re.compile(r"^\d{1,3}[,.]\d{3}$|^\d{2,6}$")
MONTH_RE = re.compile(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[.,]?$", re.I)
SEATS_RE = re.compile(r"^\((\d{1,2})\)$")
HEAD_TOKENS = {'constituency': 'cons', 'date': 'date', 'electors': 'elec',
               'candidates': 'cand', 'aff': 'party', 'aff.': 'party', 'polled': 'votes'}
# Lines between contests that record why a seat changed hands: "T. P. O'Connor elects to
# sit for Liverpool Scotland". They are facts about the contest, not noise, so they are
# kept against it rather than discarded.
NOTE_RE = re.compile(r'\b(elects to sit|app\.|appointed|resigns?|created|death of|on death|'
                     r'unseated|petition|succeeded|declared|new writ|writ issued|void)(?=\W|$)', re.I)
SEATS_NOTE_RE = re.compile(r'except ([^.]+?) with two each', re.I)
YMD_RE = re.compile(r'\b(1[789]\d{2})\s+(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)'
                    r'[a-z]*\.?,?\s*(\d{1,2})\b', re.I)
TITLE_RE = re.compile(r'\b(Sir|Hon|Capt|Captain|Col|Major|Dr|Lord|Viscount|Earl|Rt|Gen)\b\.?')

def clean_name(text):
    """A stray mark left of the name column ("= FitzStephen French") is not part of it."""
    return re.sub(r"^[^A-Za-z]+", "", text).strip()


def clean_party(text):
    """Strip enclosing brackets only when they enclose the whole label: "L(Ind.)" keeps its own."""
    p = (text or '').strip(' .,')
    p = re.sub(r"^[\[({](.*)[\])}]$", r"\1", p)
    if '(' in p and ')' not in p:
        p += ')'
    return p or None


_readers = {}


def page_image(pdf_path, index):
    """The scanned image of one page, taken straight from the PDF.

    The reader is cached: constructing a PdfReader per page on a 2.9 GB file exhausts
    memory part way through a run and produces a trail of unexplained failures.
    """
    if pdf_path not in _readers:
        _readers[pdf_path] = PdfReader(pdf_path)
    page = _readers[pdf_path].pages[index]
    xo = page['/Resources']['/XObject'].get_object()
    for key in xo.keys():
        obj = xo[key].get_object()
        if obj.get('/Subtype') == '/Image':
            try:
                return obj.decode_as_image()
            except Exception:
                return Image.open(io.BytesIO(obj._data))
    raise RuntimeError(f'no image on page {index}')


def words_of(im, psm=6, scale=1.6, threshold=150):
    """OCR to words with positions. Rendering the PDF at higher dpi is pointless here:
    the page IS the embedded image and its mediabox equals that image's pixel size, so
    pdftoppm -r 400 upsamples a ~2000x3200 scan to ~198 megapixels for no new detail."""
    im = im.convert('L')
    w, h = im.size
    im = ImageOps.autocontrast(im.resize((int(w * scale), int(h * scale)), Image.LANCZOS), cutoff=1)
    if threshold:
        im = im.point(lambda p: 255 if p > threshold else 0, mode='1')
    data = pytesseract.image_to_data(im, config=f'--oem 1 --psm {psm} -l eng',
                                     output_type=pytesseract.Output.DICT)
    out = []
    for i, text in enumerate(data['text']):
        text = (text or '').strip()
        if not text:
            continue
        out.append({'text': text, 'x': data['left'][i], 'y': data['top'][i],
                    'w': data['width'][i], 'h': data['height'][i],
                    'cx': data['left'][i] + data['width'][i] / 2,
                    'cy': data['top'][i] + data['height'][i] / 2,
                    'line': (data['block_num'][i], data['par_num'][i], data['line_num'][i])})
    return out, im.size


def rows_by_line(words, page_h, top=0.0):
    """Rows as Tesseract read them. On a bowed page the flattened-baseline grouping in
    rows_of chains adjacent lines of the four-column tables together, whose rows are set
    tighter than the later ones; Tesseract's own line segmentation follows each line."""
    groups = {}
    for w in words:
        if w['cy'] > page_h * top:
            groups.setdefault(w['line'], []).append(w)
    rows = [sorted(g, key=lambda z: z['x']) for g in groups.values()]
    return sorted(rows, key=lambda r: statistics.median(w['cy'] for w in r))


def _rough_rows(words, tol_frac=0.75):
    """Rows grown left to right, following the page's curve. Used only to seed the bow
    measurement; the real grouping happens after flattening."""
    if not words:
        return []
    med_h = statistics.median(w['h'] for w in words) or 10
    tol = med_h * tol_frac
    rows = []
    for w in sorted(words, key=lambda z: z['x']):
        best, best_d = None, None
        for r in rows:
            if w['x'] - r['x'] > med_h * 40:
                continue
            d = abs(w['cy'] - (r['y'] + r['m'] * (w['x'] - r['x'])))
            if best_d is None or d < best_d:
                best, best_d = r, d
        if best is not None and best_d <= tol:
            if w['x'] != best['x']:
                m = (w['cy'] - best['y']) / (w['x'] - best['x'])
                best['m'] = 0.5 * best['m'] + 0.5 * max(-0.6, min(0.6, m))
            best['words'].append(w)
            best['y'], best['x'] = w['cy'], w['x']
        else:
            rows.append({'words': [w], 'y': w['cy'], 'x': w['x'], 'm': 0.0})
    return [sorted(r['words'], key=lambda z: z['x']) for r in rows]


def bow_profile(words, page_w, bins=24):
    """How far the baseline deviates from level, by x. Every row on a bound-book scan
    bows the same way, so this is a property of the page and can be measured once."""
    acc = [[] for _ in range(bins)]
    for r in _rough_rows(words):
        if len(r) < 4:
            continue
        if max(w['x'] for w in r) - min(w['x'] for w in r) < page_w * 0.35:
            continue
        mid = statistics.median(w['cy'] for w in r)
        for w in r:
            acc[min(bins - 1, max(0, int(w['cx'] / page_w * bins)))].append(w['cy'] - mid)
    prof = [statistics.median(v) if len(v) >= 3 else None for v in acc]
    known = [i for i, v in enumerate(prof) if v is not None]
    if not known:
        return [0.0] * bins
    return [prof[i] if prof[i] is not None
            else prof[min(known, key=lambda k: abs(k - i))] for i in range(bins)]


def flatten(words, page_w, prof):
    bins = len(prof)
    for w in words:
        w['cy_flat'] = w['cy'] - prof[min(bins - 1, max(0, int(w['cx'] / page_w * bins)))]
    return words


def rows_of(words, page_w, tol_frac=0.5, top=0.0, page_h=None):
    """Rows on the flattened page."""
    prof = bow_profile(words, page_w)
    flatten(words, page_w, prof)
    body = [w for w in words if page_h is None or w['cy'] > page_h * top]
    if not body:
        return []
    tol = (statistics.median(w['h'] for w in words) or 10) * tol_frac
    rows, cur = [], []
    for w in sorted(body, key=lambda z: z['cy_flat']):
        if cur and abs(w['cy_flat'] - cur[-1]['cy_flat']) > tol:
            rows.append(sorted(cur, key=lambda z: z['x']))
            cur = []
        cur.append(w)
    if cur:
        rows.append(sorted(cur, key=lambda z: z['x']))
    return rows


def header_columns(words, page_h):
    """Column centres from the header printed at the top of this page."""
    cols = {}
    for w in words:
        if w['cy'] > page_h * 0.22:
            continue
        key = HEAD_TOKENS.get(w['text'].strip('.,:').lower())
        if key and key not in cols:
            cols[key] = w['cx']
    return cols


def infer_columns(cols, words, page_w, page_h):
    """Fill in any column whose header word the OCR missed.

    Requiring a complete header threw away most of the volume: of twelve pages of the
    1886 tables only four had all six header words read, and the other eight returned
    nothing at all even though their columns were perfectly legible. The header is the
    best anchor when it is readable, but the content itself locates a column well enough
    when it is not -- party codes cluster within about two per cent of the page width,
    and the vote column is simply the figures to their right.
    """
    body = [w for w in words if w['cy'] > page_h * 0.22]
    if not body:
        return cols
    cols = dict(cols)
    parties = [w['cx'] for w in body if PARTY_RE.match(w['text'])]
    if 'party' not in cols and len(parties) >= 4:
        cols['party'] = statistics.median(parties)
    if 'party' not in cols:
        return cols                      # without it nothing else can be placed
    p = cols['party']
    right = [w['cx'] for w in body if NUM_RE.match(w['text']) and w['cx'] > p]
    if 'votes' not in cols and right:
        cols['votes'] = statistics.median(right)
    left_nums = [w['cx'] for w in body if NUM_RE.match(w['text']) and w['cx'] < p * 0.75]
    if 'elec' not in cols and left_nums:
        cols['elec'] = statistics.median(left_nums)
    months = [w['cx'] for w in body if MONTH_RE.match(w['text'])]
    if 'date' not in cols and months:
        cols['date'] = statistics.median(months)
    if 'cons' not in cols:
        anchor_x = min(x for x in (cols.get('date'), cols.get('elec'), p) if x is not None)
        leftmost = [w['cx'] for w in body if w['cx'] < anchor_x * 0.7]
        cols['cons'] = statistics.median(leftmost) if leftmost else page_w * 0.14
    if 'cand' not in cols:
        lo = max(x for x in (cols.get('elec'), cols.get('date'), cols['cons']) if x is not None)
        between = [w['cx'] for w in body if lo < w['cx'] < p and not NUM_RE.match(w['text'])]
        cols['cand'] = statistics.median(between) if between else (lo + p) / 2
    return cols


def two_member_seats(words, page_h):
    """Seats returning two members, from the page's own head note."""
    head = ' '.join(w['text'] for w in words if w['cy'] <= page_h * 0.22)
    m = SEATS_NOTE_RE.search(head)
    if not m:
        return set()
    return {p.strip().lower() for p in re.split(r'\band\b|,', m.group(1)) if p.strip()}


CONTINUED = '(continued from the previous page)'


def extract_unaffiliated_page(pdf_path, index):
    """Contest rows from a table with no electorate and no affiliation column.

    Before the Reform Act of 1832 Walker prints four columns -- constituency, date,
    candidates, votes polled -- because electorates were not recorded and parties are not
    assigned. extract_page anchors on the affiliation column, so every one of the 46 pages
    covering 1802-1831 came back empty. Here a candidate is any line in the candidates
    column; a line indented past the column's left edge continues the name above it
    ("Lord William Charles O'Brien / Fitzgerald"); votes are read where printed, and an
    unopposed return has none.
    """
    im = page_image(pdf_path, index)
    words, (pw, ph) = words_of(im)
    if not words:
        return [], {}
    cols = {k: v for k, v in header_columns(words, ph).items() if k in ('cons', 'date', 'cand', 'votes')}
    body = [w for w in words if w['cy'] > ph * 0.12]
    if 'votes' not in cols:
        right = [w['cx'] for w in body if NUM_RE.match(w['text']) and w['cx'] > pw * 0.8]
        if right:
            cols['votes'] = statistics.median(right)
    if 'date' not in cols:
        months = [w['cx'] for w in body if MONTH_RE.match(w['text'])]
        if months:
            cols['date'] = statistics.median(months)
    if 'date' not in cols:
        return [], {'reason': 'no date column could be located on this page'}
    cols.setdefault('votes', pw * 0.92)
    # The candidates column is wide and ranged left, so a word's nearest column CENTRE puts
    # first names in the date column. Columns are bounded by left edges instead; the
    # candidates' edge is where the names right of the dates start.
    votes_left = cols['votes'] - pw * 0.04
    date_left = cols['date'] - pw * 0.07
    firsts = []
    for r in rows_by_line(words, ph, top=0.12):
        names = [w for w in r if w['cx'] > cols['date'] + pw * 0.03 and w['cx'] < votes_left
                 and re.match(r"^[A-Z(“\"']", w['text']) and not MONTH_RE.match(w['text'])
                 and not re.match(r'^\d', w['text'])]
        if names:
            firsts.append(min(w['x'] for w in names))
    firsts.sort()
    if not firsts:
        return [], {'reason': 'no candidates column could be located on this page'}
    cand_left = firsts[len(firsts) // 10] - pw * 0.005

    def column(w):
        if w['cx'] >= votes_left and NUM_RE.match(w['text']):
            return 'votes'
        if w['x'] >= cand_left:
            return 'cand'
        if w['cx'] >= date_left:
            return 'date'
        return 'cons'

    rows = rows_by_line(words, ph, top=0.12)

    # Pass 1: each printed line, split into its columns.
    lines = []
    for r in rows:
        joined = ' '.join(w['text'] for w in r)
        if re.search(r'GENERAL ELECTION|BY-ELECTION|constituency|candidates|votes|polled'
                     r'|and reason|for election', joined, re.I):
            continue
        cells = {}
        for w in r:
            cells.setdefault(column(w), []).append(w)
        text = {k: ' '.join(x['text'] for x in v).strip(' .|,') for k, v in cells.items()}
        date_words = cells.get('date', [])
        ymd = YMD_RE.search(joined)
        # A date is a month, or a bare day figure where the month did not read ("t. 17").
        has_date = bool(ymd) or any(MONTH_RE.match(w['text']) for w in date_words) \
            or any(re.match(r'^\d{1,2}$', w['text']) for w in date_words)
        lines.append({'cells': cells, 'text': text, 'joined': joined, 'ymd': ymd, 'has_date': has_date})

    # Pass 2: a contest opens at each dated line. In the general-election lists the seat's
    # name is centred on its candidate lines, so it often sits on the SECOND line of the
    # contest while the date sits on the first; the name is therefore the first entry in the
    # constituency column anywhere in the contest, and what follows it there is the italic
    # note on why the seat fell vacant.
    blocks, cur = [], []
    for ln in lines:
        if ln['has_date'] and cur:
            blocks.append(cur)
            cur = []
        cur.append(ln)
    if cur:
        blocks.append(cur)

    out, notes = [], []
    for bi, block in enumerate(blocks):
        constituency, note_parts = None, []
        for ln in block:
            raw = ln['text'].get('cons', '')
            if not raw:
                continue
            cons = re.sub(r'\(?contd\)?', '', raw, flags=re.I).strip(' .|,“”"')
            # The gutter shadow on the inner margin reads as stray marks before the name:
            # "] publin city", "q Louth county", "‘ Tralee".
            cons = re.sub(r"^(?:[^A-Za-z]+|[A-Za-z](?=\s))\s*", '', cons).strip()
            cons = re.sub(r"^(?:[^A-Za-z]+|[A-Za-z](?=\s))\s*", '', cons).strip()
            if not cons or len(re.sub(r'[^A-Za-z]', '', cons)) < 3:
                continue
            if constituency is None and not NOTE_RE.search(cons) and not re.search(r'\bsucceeds\b|\belects\b', cons, re.I):
                constituency = cons
            else:
                note_parts.append(cons)
        if constituency is None and bi == 0:
            constituency = CONTINUED        # the last contest of the previous page runs on
        if note_parts:
            notes.append({'constituency': constituency, 'text': ' '.join(note_parts)})
        if constituency is None:
            continue
        head = block[0]
        date_year = int(head['ymd'].group(1)) if head['ymd'] else None
        if head['ymd']:
            date = f"{head['ymd'].group(2)[:3].title()}. {int(head['ymd'].group(3))}"
        else:
            d = head['text'].get('date', '')
            date = d if d and MONTH_RE.match(d.split()[0] if d.split() else '') else None
        contest = []
        for ln in block:
            cand_words = ln['cells'].get('cand', [])
            vw = next((w['text'] for w in ln['cells'].get('votes', []) if NUM_RE.match(w['text'])), None)
            votes = int(vw.replace(',', '').replace('.', '')) if vw else None
            if not cand_words:
                if votes is not None and contest and contest[-1]['votes'] is None:
                    contest[-1]['votes'] = votes
                continue
            name = clean_name(' '.join(w['text'] for w in cand_words).strip(' .|,»'))
            indented = min(w['x'] for w in cand_words) > cand_left + pw * 0.015
            if indented and contest:
                if name.startswith('(') or name.lower().startswith('afterwards'):
                    contest[-1].setdefault('aliases', []).append(name.strip('()'))
                else:
                    contest[-1]['candidate'] = f"{contest[-1]['candidate']} {name}".strip()
                    if votes is not None and contest[-1]['votes'] is None:
                        contest[-1]['votes'] = votes
                continue
            if len(re.sub(r'[^A-Za-z]', '', name)) < 3:
                continue
            titles = len(TITLE_RE.findall(name))
            contest.append({'constituency': constituency, 'electorate': None, 'date': date,
                            'dateYear': date_year, 'candidate': name, 'party': None, 'votes': votes,
                            'seats': None, 'suspectMerged': titles >= 2 or len(name.split()) > 7})
        out.extend(contest)
    return out, {'columns': cols, 'notes': notes, 'layout': 'unaffiliated'}


def extract_page(pdf_path, index):
    """Contest rows from one chronological table page. Returns (rows, meta)."""
    im = page_image(pdf_path, index)
    words, (pw, ph) = words_of(im)
    if not words:
        return [], {}
    cols = infer_columns(header_columns(words, ph), words, pw, ph)
    if 'party' not in cols or 'cand' not in cols:
        return [], {'reason': 'no party column could be located on this page'}
    two = two_member_seats(words, ph)

    def nearest(w):
        return min(cols, key=lambda k: abs(w['cx'] - cols[k]))

    out, notes = [], []
    county = constituency = date = None
    date_year = None
    electorate = None
    pending = ''
    for r in rows_of(words, pw, top=0.22, page_h=ph):
        joined = ' '.join(w['text'] for w in r)
        if re.search(r'GENERAL ELECTION|BY-ELECTION|constituency|electors|candidates'
                     r'|votes polled|pol\.', joined, re.I):
            continue
        cells = {}
        for w in r:
            cells.setdefault(nearest(w), []).append(w)
        text = {k: ' '.join(x['text'] for x in v).strip(' .|,') for k, v in cells.items()}
        # Walker sets the reason for a by-election in italics under the seat's name -- "Johnson
        # app. S.G.", "and new writ issued" -- often on the same line as the second candidate.
        # Read as a constituency, it renamed the contest mid-way and reset its by-election year;
        # dropping the whole row lost the candidate beside it. Take the note, keep the candidate.
        left = ' '.join(text.get(k, '') for k in ('cons', 'date', 'elec')).strip()
        if left and NOTE_RE.search(left):
            notes.append({'constituency': constituency, 'text': left})
            for k in ('cons', 'date', 'elec'):
                text.pop(k, None)
                cells.pop(k, None)
            if not text.get('cand'):
                continue
        elif NOTE_RE.search(joined) and not text.get('party') and not text.get('votes'):
            notes.append({'constituency': constituency, 'text': joined})
            continue

        # The elector cell routinely catches the first word of the candidate name, since
        # candidate text starts left of the header centre: "14,569 Charles". Reading the
        # cell as one string and matching an anchored number finds nothing, which is why
        # every electorate once came out empty. Take the first numeric WORD, and hand the
        # rest of the cell back to the candidate.
        elec_num = next((w['text'] for w in cells.get('elec', []) if NUM_RE.match(w['text'])), None)
        spill = [w['text'] for w in cells.get('elec', [])
                 if not NUM_RE.match(w['text']) and not MONTH_RE.match(w['text'])
                 and w['text'].strip(' .|,-—')]

        party = next((w['text'] for w in cells.get('party', []) if PARTY_RE.match(w['text'])), None)
        votes = None
        if party is None:
            # party and vote can set tight enough to OCR as one token: "C1401".
            for w in cells.get('votes', []) + cells.get('party', []):
                m = re.match(r'^([A-Za-z]{1,4}\.?)(\d{2,6})$', w['text'])
                if m and PARTY_RE.match(m.group(1)):
                    party, votes = m.group(1), int(m.group(2))
                    break

        name = text.get('cons', '')
        if name:
            if re.search(r'\bcount(y|ies)\b', name, re.I) and not party and not text.get('cand'):
                county = re.sub(r'\s*\bcount(y|ies)\b.*$', '', name, flags=re.I).strip()
                constituency = None
                continue
            divisional = re.match(r'^(North|South|East|West|Mid)\b', name, re.I)
            previous = constituency
            if divisional and county:
                constituency = f'{county} {name}'
            elif not divisional:
                constituency = name
                county = None
            # The elector count is printed once per contest and carried down its
            # candidate rows -- but it must NOT survive into the next contest. It did,
            # and all four Antrim divisions of 1918 came out sharing one electorate,
            # 8,821, which against their real vote totals then looked like evidence of
            # two-member seats.
            if constituency != previous:
                electorate = None
                date = date_year = None
                pending = ''
        # A by-election prints its YEAR in the date column -- "1875 Apr. 28", "1884 Feb. 23"
        # -- and a general election does not, because the whole table is one election.
        # That is the only reliable signal of which kind of contest a row belongs to: the
        # running head is unreadable on ~44% of pages, and a spot-check found 8 of 21
        # sampled 1802-1880 contests filed under the wrong election for want of it.
        ymd = YMD_RE.search(joined)
        if ymd:
            date_year = int(ymd.group(1))
            date = f'{ymd.group(2)[:3].title()}. {int(ymd.group(3))}'
        else:
            d = text.get('date', '')
            if d and MONTH_RE.match(d.split()[0] if d.split() else ''):
                date = d
        if elec_num:
            electorate = int(elec_num.replace(',', '').replace('.', ''))
        cand = ' '.join(spill + [text.get('cand', '')]).strip(' .|,')
        if not party:
            vw = next((w['text'] for w in cells.get('votes', []) if NUM_RE.match(w['text'])), None)
            if vw and cand and constituency:
                # A candidate whose party did not read -- "L(Ind.)", a speck -- is still a
                # candidate. Holding the name over as the first line of a wrapped name put
                # it in front of the NEXT candidate: a spot-check found 5 of 16 names
                # carrying the names printed above them.
                party, votes = '', int(vw.replace(',', '').replace('.', ''))
            else:
                # A name wraps onto at most one further line, and the party and votes are
                # printed on the last. Only the line immediately above can be its first half.
                if cand and not any(ch.isdigit() for ch in cand):
                    pending = cand
                continue
        if pending:
            cand = (pending + ' ' + cand).strip()
            pending = ''
        if votes is None:
            vw = next((w['text'] for w in cells.get('votes', []) if NUM_RE.match(w['text'])), None)
            votes = int(vw.replace(',', '').replace('.', '')) if vw else None
        if not constituency or len(cand) < 3:
            continue
        titles = len(TITLE_RE.findall(cand))
        out.append({'constituency': constituency, 'electorate': electorate, 'date': date,
                    'dateYear': date_year,
                    'candidate': clean_name(cand), 'party': clean_party(party), 'votes': votes,
                    'seats': 2 if constituency.lower() in two else 1,
                    # Two candidates' names read into one -- "Hon. Cecil John Lawless Thomas
                    # Henry Barton" -- is the other error class the spot-check found.
                    'suspectMerged': titles >= 2 or len(cand.split()) > 6})
    return out, {'columns': cols, 'notes': notes, 'twoMemberSeats': sorted(two)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('volume', help='PDF filename inside WALKER_DIR')
    ap.add_argument('first', type=int, help='first page index (0-based)')
    ap.add_argument('last', type=int, help='last page index (inclusive)')
    ap.add_argument('--json', action='store_true', help='emit JSON rather than a table')
    args = ap.parse_args()
    path = os.path.join(WALKER_DIR, args.volume)
    if not os.path.exists(path):
        sys.exit(f'not found: {path}\nSet WALKER_DIR to the folder holding the scans.')
    rows, notes = [], []
    for idx in range(args.first, args.last + 1):
        r, meta = extract_page(path, idx)
        rows += r
        notes += meta.get('notes', [])
    if args.json:
        print(json.dumps({'rows': rows, 'notes': notes}, indent=1))
        return
    for r in rows:
        print(f"{r['constituency'][:24]:24} {str(r['electorate'] or ''):>7} "
              f"{str(r['date'] or ''):9} {r['candidate'][:34]:34} {r['party']:<5} "
              f"{str(r['votes'] or ''):>6} seats={r['seats']}")
    print(f'\n{len(rows)} rows, {len(notes)} notes')


if __name__ == '__main__':
    main()
