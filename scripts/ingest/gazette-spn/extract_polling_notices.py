#!/usr/bin/env python
"""Find Belfast Gazette notices that list polling districts, polling places and polling stations.

Reads the crawler's database READ-ONLY (and, for schedules laid out as tables, the issue PDFs) and
writes, in <out> (default <CIVGRAPH_GAZETTE_DIR>/extracted):

  polling-notices.jsonl          one record per line (see below)
  polling-notices-summary.json   counts by record type, decade and body; unmatched records; skipped pages
  polling-districts-by-year.csv  one row per polling district, by year of notice
  polling-notices-cache.sqlite   per-issue cache (makes reruns incremental)

Records ("record" field):
  polling-district    one row of a printed schedule: polling district (name and/or number), the area
                      it covers as printed (district electoral divisions, wards, townlands or streets),
                      the polling place or station, the county/borough/constituency the schedule is
                      for, the elections it serves, the notice date and the citation
  polling-schedule    the notice the rows came from (or a schedule whose rows could not be read)
  polling-instrument  a notice of an Order, Regulations or Scheme about polling districts, places or
                      stations (polling station schemes) without a printed list

Pages that mention polling districts/places/stations only inside Acts, Rules or blank statutory forms
are not records; they are listed in the summary as skipped pages with the reason.

Privacy: facts only. A polling place is kept when it is a public building (school, hall, courthouse,
church hall, office ...) or a locality name; anything that reads as an individual's house (a house
number with a street, "residence of", "house of Mr") is dropped and counted, never stored.

Civgraph hooks: each record lists the Civgraph contests at the first election after the notice in the
bodies it serves (civgraph_keys; civgraph_file is the first), matched on the schedule's county,
borough or constituency (and, for ward-based schedules, the ward contest); unmatched records are
listed in the summary.

  CIVGRAPH_GAZETTE_DIR=<data folder> python scripts/ingest/gazette-spn/extract_polling_notices.py [--full]
         [--issues 30-400] [--no-compare] [--db <dir>/gazette.sqlite] [--out <dir>/extracted]

Rerun at any time while the crawl runs: only new, refetched or re-dated issues are parsed. Bump
PARSER_VERSION after changing the rules.
"""
import collections, csv, datetime, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gazette_notice_common as G  # noqa: E402

PARSER_VERSION = 1
FTS_PREFILTER = "poll* OR p0ll* OR pol1* OR po1l* OR po11*"

# OCR-tolerant gate: "Polling District(s)/Place(s)/Station(s)", also split over a line ("Poll-\ning").
_P = r'P\W{0,2}[o0]\W{0,2}[l1I]\W{0,3}[l1I]\W{0,4}[i1l]\W{0,2}n\W{0,2}g'
GATE = re.compile(_P + r'\W{1,4}(?:D\W{0,2}i\W{0,2}s\W{0,2}t|P\W{0,2}l\W{0,2}a\W{0,2}c|S\W{0,2}t\W{0,2}a\W{0,2}t|Sta\w*\s+Schemes?)', re.I)

COUNTIES = ['Antrim', 'Armagh', 'Down', 'Fermanagh', 'Londonderry', 'Tyrone']
SCOPE_RE = re.compile(
    r'(?:COUNTY|County)\s+BOROUGH\s+OF\s+(BELFAST|LONDONDERRY)|County\s+Borough\s+of\s+(Belfast|Londonderry)|'
    r'(BELFAST|Belfast|LONDONDERRY|Londonderry)\s+County\s+Borough|'
    r'(?:ADMINISTRATIVE\s+)?COUNTY\s+(?:OF\s+)?(ANTRIM|ARMAGH|DOWN|FERMANAGH|LONDONDERRY|TYRONE)\b|'
    r'County\s+(?:of\s+)?(Antrim|Armagh|Down|Fermanagh|Londonderry|Tyrone)\b|'
    r'(?:Constituency|CONSTITUENCY|Division|DIVISION)\s+of\s+(?:the\s+)?([A-Z][A-Za-z\'. ]{2,40}?)(?=[,.;:\n]|\s+(?:and|in|is|shall|for)\b)|'
    r'(?:Borough|BOROUGH|Urban\s+District|URBAN\s+DISTRICT|Rural\s+District|RURAL\s+DISTRICT)\s+of\s+([A-Z][A-Za-z\'. ]{2,30}?)(?=[,.;:\n]|\s+(?:and|in|is|shall)\b)')

PARLIAMENTARY = ['house-of-commons-of-the-united-kingdom', 'parliament-of-northern-ireland']
INSTR_RE = re.compile(r"((?:The\s+)?(?:[A-Z][A-Za-z'&.,]*\s+|\(\s*|\)\s*|of\s+|and\s+){0,10}"
                      r"(?:[A-Za-z(]*\s*)?Poll\W{0,3}ing\s+(?:Station|District|Place)s?[A-Za-z()&,.' ]{0,70}?"
                      r"(?:Regulations|Order|Scheme|Rules)(?:\s*\((?:Northern\s+Ire\W*land|N\.\s?I\.)\))?,?\s*(?:19|20)\d\d)")
SR_RE = re.compile(r'S\.\s?R\.?\s*(?:&|and)?\s*(?:O\.)?\s*,?\s*(?:\(N\.I\.\)\s*)?(19\d\d|20\d\d),?\s*No\.?\s*(\d{1,4})')

HEADER_ROLE = [
    ('area', re.compile(r'comprising|Ward|Townland|Street|Electoral|Area|Division|contained|Description|Boundar', re.I)),
    ('place', re.compile(r'Plac|Station|Situation|Building|Premises', re.I)),
    ('district', re.compile(r'Polling\s+District|District|Number|No\.|Letter|Polling\W*$', re.I)),
]
HEADER_VOCAB = re.compile(r'Polling|District|Ward|Electoral|Divisions?|comprising|Townlands?|Streets?|Number|Letter|Places?|Placed|'
                          r'Stations?|contained|Area|Description|Situation|Premises', re.I)
STOP_LINE = re.compile(r'^(?:Given|Dated|Sealed|Signed|Note|NOTE|Made|By\s+Order|GOD\s+SAVE|TIMETABLE)', re.I)


# ---------------------------------------------------------------------------------------------
# Schedules from the PDF layout

def _lines(page):
    """pymupdf (block, line) groups: [(x0, y0, x1, y1, text, words)]."""
    groups = collections.defaultdict(list)
    for w in page.get_text('words'):
        groups[(w[5], w[6])].append(w)
    out = []
    for ws in groups.values():
        ws.sort(key=lambda w: w[0])
        out.append((min(w[0] for w in ws), min(w[1] for w in ws), max(w[2] for w in ws), max(w[3] for w in ws),
                    ' '.join(w[4] for w in ws), ws))
    out.sort(key=lambda l: (l[1], l[0]))
    return out


def _role(text):
    for role, rx in HEADER_ROLE:
        if rx.search(text):
            return role
    return None


def header_cells(lines, width):
    """Short header lines merged into cells (a heading may wrap over three lines)."""
    short = [l for l in lines if (l[2] - l[0]) < width * 0.3 and len(l[4].split()) <= 5 and HEADER_VOCAB.search(l[4])
             and not re.search(r'\d{3,}', l[4])]
    cells = []
    for l in short:
        for c in cells:
            if l[0] < c['x1'] + 2 and l[2] > c['x0'] - 2 and -8 <= l[1] - c['y1'] < 12:
                c.update(x0=min(c['x0'], l[0]), x1=max(c['x1'], l[2]), y1=max(c['y1'], l[3]), text=c['text'] + ' ' + l[4])
                break
        else:
            cells.append({'x0': l[0], 'x1': l[2], 'y0': l[1], 'y1': l[3], 'text': l[4]})
    for c in cells:
        c['role'] = _role(c['text'])
    return [c for c in cells if c['role'] and re.search(r'Polling|Ward|Electoral|Townland|Street|comprising|contained|Number|Plac|Station', c['text'], re.I)]


def tables_from_cells(cells, width):
    """Group header cells into tables: cells on one band, left to right, a new table when a role repeats."""
    cells = sorted(cells, key=lambda c: (round(c['y0'] / 30), c['x0']))
    bands = []
    for c in sorted(cells, key=lambda c: c['y0']):
        for b in bands:
            if abs(b[0]['y0'] - c['y0']) < 26:
                b.append(c)
                break
        else:
            bands.append([c])
    tables = []
    for b in bands:
        b.sort(key=lambda c: c['x0'])
        cur = []
        for c in b:
            if any(x['role'] == c['role'] for x in cur):
                tables.append(cur)
                cur = []
            cur.append(c)
        if cur:
            tables.append(cur)
    good = []
    for t in tables:
        roles = {c['role'] for c in t}
        if 'district' in roles and roles & {'area', 'place'} and any(re.search(r'Polling', c['text'], re.I) for c in t):
            good.append(t)
        elif roles >= {'area', 'place'} and any(re.search(r'Polling', c['text'], re.I) for c in t):
            good.append(t)
    # Horizontal extent of each table: from its first column to the next table on the same band.
    for t in good:
        t.sort(key=lambda c: c['x0'])
    metas = []
    for t in good:
        nxt = [u[0]['x0'] - 14 for u in good if u is not t and u[0]['x0'] > t[-1]['x0']]
        for c in t:
            c['col_x0'] = c['x0'] - 8
        # A table ends at the next table to its right, or a little past its last heading (so a
        # two-column page's other column is not read into it).
        metas.append({'x0': t[0]['x0'] - 14, 'x1': min(nxt + [t[-1]['x1'] + 30, width]), 'top': max(c['y1'] for c in t)})
    return [[m] + t for m, t in zip(metas, good)]


def junk(text):
    return len(re.sub(r'[^A-Za-z0-9]', '', text)) < 2 or not re.search(r'[A-Za-z]{3,}|\d', text)


def rows_from_table(lines, table, page_h):
    """Rows of a schedule. Works word by word (an OCR line may run across columns): each word goes to
    its column, words of one column on one baseline make a cell; a polling-district cell starts a row,
    area cells join the row at or above them, and a place cell joins the row nearest its baseline."""
    meta, cols = table[0], table[1:]
    width = meta['x1'] - meta['x0']
    bottom = page_h
    body = [l for l in lines if l[1] > meta['top'] + 1 and l[0] < meta['x1'] and l[2] > meta['x0']]
    for l in body:
        inside = [w for w in l[5] if meta['x0'] <= w[0] < meta['x1']]
        if not inside:
            continue
        span = max(w[2] for w in inside) - min(w[0] for w in inside)
        words = len([w for w in inside if re.search(r'[A-Za-z]{2,}', w[4])])
        if STOP_LINE.search(l[4].strip()) or (span > width * 0.75 and words >= 5):
            bottom = l[1]
            break
    cells = collections.defaultdict(list)  # (role index, y bucket) -> words
    for l in body:
        if l[1] >= bottom:
            break
        for w in l[5]:
            if not (meta['x0'] <= w[0] < meta['x1']):
                continue
            ci = 0
            for k, c in enumerate(cols):
                if w[0] + 3 >= c['col_x0']:
                    ci = k
            cells[(ci, round(w[1] / 2))].append(w)
    merged = []  # (y, column index, text)
    for (ci, _), ws in sorted(cells.items(), key=lambda kv: (min(w[1] for w in kv[1]), kv[0][0])):
        ws.sort(key=lambda w: w[0])
        y = min(w[1] for w in ws)
        if merged and merged[-1][1] == ci and abs(merged[-1][0] - y) < 2.5:
            merged[-1] = (merged[-1][0], ci, merged[-1][2] + ' ' + ' '.join(w[4] for w in ws))
        else:
            merged.append((y, ci, ' '.join(w[4] for w in ws)))
    rows = []
    pending = []
    for y, ci, raw in merged:
        role = cols[ci]['role']
        text = G.clean_ws(re.sub(r"[^\w\s'().,&/-]|_", ' ', raw)).strip(" .,'-")
        text = re.sub(r'(?:\s*\.){2,}.*$', '', text).strip(" .,'-")
        if junk(text):
            continue
        if role == 'district':
            rows.append({'y': y, 'district': text, 'area': [], 'place': []})
        else:
            pending.append((y, role, text))
    if not rows:
        return rows, bottom
    for y, role, text in pending:
        if role == 'place':
            r = min(rows, key=lambda r: abs(r['y'] - y))
            if abs(r['y'] - y) > 12:
                above = [r for r in rows if r['y'] <= y + 4]
                r = above[-1] if above else r
            r['place'].append(text)
        else:
            above = [r for r in rows if r['y'] <= y + 4]
            (above[-1] if above else rows[0])['area'].append(text)
    return rows, bottom


FORM_PAGE = re.compile(r'Signature\s+of\s+(?:Proposer|Seconder|Candidate)|Instructions\s+for\s+Filling|Place\s+of\s+Abode', re.I)
FORM_HEAD = re.compile(r'Abode|Signature|Surname|Burgess|Proposer|Seconder|\bElectors?\b|\bRegister\b', re.I)


def list_like(rows):
    """A printed list (short names or numbers per row), not prose from an Act laid out in columns."""
    if len(rows) < 2:
        return False
    long = sum(1 for r in rows if len(r['district'].split()) > 4 or len(r['district']) > 34 or FORM_HEAD.search(r['district']))
    return long <= len(rows) * 0.2


def schedule_from_pdf(pdf_path, page_index):
    try:
        import pymupdf
        page = pymupdf.open(pdf_path)[page_index]
    except Exception:
        return None
    lines = _lines(page)
    cells = header_cells(lines, page.rect.width)
    tables = tables_from_cells(cells, page.rect.width)
    out = []
    for t in tables:
        if any(FORM_HEAD.search(c['text']) for c in t[1:]):
            continue
        rows, bottom = rows_from_table(lines, t, page.rect.height)
        if not list_like(rows):
            continue
        if len(rows) >= 2:
            out.append({'columns': [c['text'] for c in t[1:]], 'roles': [c['role'] for c in t[1:]], 'rows': rows,
                        'reaches_page_foot': bottom >= page.rect.height - 60})
    return out


def text_only_schedule(text):
    """Without the PDF: the lists under each printed heading, unpaired."""
    lists = collections.OrderedDict()
    cur = None
    for line in text.split('\n'):
        s = line.strip()
        role = _role(s) if (HEADER_VOCAB.search(s) and len(s.split()) <= 5) else None
        if role and re.search(r'Polling|Ward|comprising|Plac', s, re.I):
            cur = role
            lists.setdefault(cur, [])
            continue
        if cur and not junk(s):
            lists[cur].append(G.clean_ws(re.sub(r'[^\w\'(). -]', ' ', s)).strip(' .'))
    return lists


# ---------------------------------------------------------------------------------------------
# Notice context

def scope_of(window):
    """The county / county borough / constituency / district a schedule is for (last named before it)."""
    best = None
    for m in SCOPE_RE.finditer(window):
        g = [x for x in m.groups() if x]
        if not g:
            continue
        name = G.clean_ws(g[0]).title().replace("'S", "'s")
        txt = m.group(0)
        kind = ('county-borough' if re.search(r'Borough', txt, re.I) and name in ('Belfast', 'Londonderry') and re.search(r'County', txt, re.I)
                else 'county' if re.search(r'COUNTY|County', txt) and name in COUNTIES
                else 'constituency' if re.search(r'Constituency|Division', txt, re.I)
                else 'district')
        best = {'name': name, 'kind': kind}
    return best


def elections_served(window, scope, roles_text):
    w = window
    bodies = []
    if re.search(r'Representation\s+of\s+the\s+People|Parliament|parliamentary|Elections\s+and\s+Franchise|Electoral\s+Law', w, re.I):
        bodies += PARLIAMENTARY
    if re.search(r'Local\s+Government|Councillors?|council\s+elections?|local\s+elections?|Electoral\s+Law|Elections\s+and\s+Franchise', w, re.I) \
            or re.search(r'Ward', roles_text, re.I):
        if scope and scope['name'] == 'Belfast':
            bodies.append('belfast-county-borough-council')
        elif scope and scope['name'] == 'Londonderry' and scope['kind'] == 'county-borough':
            bodies.append('londonderry-county-borough-council')
        else:
            bodies.append('local-government')
    return list(dict.fromkeys(bodies)) or list(PARLIAMENTARY)


def purpose_of(window):
    if re.search(r'postpone\w*\s+(?:of\s+)?(?:the\s+)?publication|timetable', window, re.I):
        return 'electoral-register timetable for the listed polling districts'
    if re.search(r'alter\w*[^.]{0,80}Polling\s+Districts|substituted\s+for\s+the\s+existing', window, re.I):
        return 'alteration of polling districts and polling places'
    if re.search(r'divid\w+[^.]{0,60}into\s+(?:polling|Polling)\s+districts', window, re.I):
        return 'division into polling districts'
    if re.search(r'polling\s+station\s+scheme', window, re.I):
        return 'polling station scheme'
    return None


def ocr_flags(text):
    f = []
    if re.search(r'[^A-Za-z0-9 .,\'()&/-]', text):
        f.append('odd-characters')
    if re.search(r'[a-z][A-Z]|\b[a-z]{1,2}\b(?<!of)(?<!on)|[A-Z]{2,}[a-z]', text):
        f.append('case-noise')
    if re.search(r'\d', text) and re.search(r'[A-Za-z]{3,}', text):
        f.append('digits-in-name')
    if re.search(r'[A-Z][a-z]*[1l]{2,}|rn(?=[a-z])|\bcl\b|ii', text):
        f.append('possible-ocr-letter-confusion')
    return f


# ---------------------------------------------------------------------------------------------
# One issue

def parse_issue(issue, issue_date, pages, nums, pdf_path):
    records, skipped = [], []
    texts = [t or '' for _, _, t in pages]
    for k, (idx, _, text) in enumerate(pages):
        if not GATE.search(text or ''):
            continue
        flat = G.join_lines(text)
        prev = G.join_lines(texts[k - 1]) if k else ''
        window = (prev[-3000:] + ' ' + flat)
        page = nums[k] if k < len(nums) else None
        base = {'issue': issue, 'issue_date': issue_date, 'page_index': idx, 'page': page}
        found = False
        # 1. Printed schedules.
        tables = schedule_from_pdf(pdf_path, idx) if pdf_path else None
        statute = G.statute_like(flat)
        if tables and statute != 'blank-form' and not FORM_PAGE.search(text):
            first_head = re.search(r'Polling\W+District|Ward\s+in\s+which|District\s+Electoral', text)
            ctx = (prev[-3000:] + ' ' + G.join_lines(text[:first_head.start()] if first_head else text))
            scope = scope_of(ctx[-2500:]) or scope_of(ctx)
            date, date_kind = G.best_date(ctx[-3500:] + ' ' + flat[:4000])
            purpose = purpose_of(ctx[-3000:] + ' ' + flat[:1500])
            act = re.findall(r'((?:REPRESENTATION\s+OF\s+THE\s+PEOPLE|Representation\s+of\s+the\s+People|ELECTIONS\s+AND\s+FRANCHISE|'
                             r'Elections\s+and\s+Franchise|ELECTORAL\s+LAW|Electoral\s+Law|LOCAL\s+GOVERNMENT|Local\s+Government)'
                             r'[A-Za-z ()]{0,40}?ACTS?|(?:Representation\s+of\s+the\s+People|Elections\s+and\s+Franchise|Electoral\s+Law|Local\s+Government)'
                             r'[A-Za-z ().]{0,40}?Acts?)[ ,.(N.I)]*(?:,?\s*(?:19|18)\d\d(?:\s+to\s+(?:19)\d\d)?)?', ctx[-3000:])
            roles_text = ' '.join(' '.join(t['columns']) for t in tables)
            bodies = elections_served(ctx[-3000:], scope, roles_text)
            nrows = 0
            sched = dict(base, record='polling-schedule', scope=scope, bodies=bodies, purpose=purpose,
                         statutory_authority=G.clean_ws(act[-1]) if act else None,
                         notice_date=date or issue_date, notice_date_source=date_kind or 'issue-date',
                         layout='pdf-table', columns=[t['columns'] for t in tables])
            dropped = 0
            for t in tables:
                for r in t['rows']:
                    places = []
                    flags = []
                    for p in r['place']:
                        kept, flag = G.sanitise_place(p)
                        if flag:
                            flags.append(flag)
                        if flag == 'dropped-private-address':
                            dropped += 1
                        if kept:
                            places.append(kept)
                    dist = r['district']
                    num = re.fullmatch(r'(?:No\.?\s*)?([0-9IlO]{1,3}[A-Z]?|[A-Z]{1,2})\.?', dist)
                    nums_list = re.findall(r'\b\d{1,3}\b', dist) if re.fullmatch(r'[\d ,.&and]+', dist) else []
                    rec = dict(base, record='polling-district', scope=scope, bodies=bodies, notice_date=sched['notice_date'],
                               notice_date_source=sched['notice_date_source'], purpose=purpose,
                               polling_district=None if (num or nums_list) else dist,
                               polling_district_numbers=nums_list or ([num.group(1)] if num else None),
                               area_printed=r['area'] or None,
                               area_kind=('ward' if any('Ward' in c for c in t['columns']) else
                                          'district-electoral-division' if any(re.search('Electoral', c) for c in t['columns']) else
                                          'townlands' if any(re.search('Townland', c, re.I) for c in t['columns']) else
                                          'streets' if any(re.search('Street', c, re.I) for c in t['columns']) else None),
                               polling_place=' / '.join(places) or None,
                               layout='pdf-table')
                    rec['ocr_flags'] = sorted(set(flags + ocr_flags(' '.join([dist] + r['area'] + places))))
                    if not r['area'] and 'area' in t['roles']:
                        rec['ocr_flags'].append('no-area-read')
                    if not places and 'place' in t['roles']:
                        rec['ocr_flags'].append('no-place-read')
                    rec['confidence'] = 'medium' if not rec['ocr_flags'] else 'low'
                    records.append(G.cite(rec))
                    nrows += 1
            sched['rows'] = nrows
            sched['private_addresses_dropped'] = dropped
            sched['continues_next_page'] = any(t['reaches_page_foot'] for t in tables)
            sched['confidence'] = 'medium'
            records.insert(len(records) - nrows, G.cite(sched))
            found = True
        elif not pdf_path and re.search(r'Polling\s+Districts?\.?\s*\n', text) and re.search(r'Polling\s+Plac|Ward|comprising', text) and not statute:
            lists = text_only_schedule(text)
            scope = scope_of(window[-6000:])
            date, kind = G.best_date(window[-6000:])
            rec = dict(base, record='polling-schedule', scope=scope, bodies=elections_served(window, scope, ' '.join(lists)),
                       purpose=purpose_of(window), notice_date=date or issue_date, notice_date_source=kind or 'issue-date',
                       layout='text-only', lists={k: v[:400] for k, v in lists.items()}, rows=0, confidence='low',
                       ocr_flags=['columns-not-aligned-without-pdf'])
            records.append(G.cite(rec))
            found = True
        # 2. Instruments (orders, regulations, schemes) named with "Polling" in their title.
        titles = []
        for m in INSTR_RE.finditer(flat):
            t = G.clean_ws(m.group(1))
            t = re.sub(r'^.*?\b(?:entitled|viz\.?:?|namely|that|made)\s+(?:the\s+)?', '', t)
            t = re.sub(r'^(?:the|The)\s+', '', t)
            if len(t) > 15 and t not in titles:
                titles.append(t)
                tail = flat[m.end():m.end() + 160]
                sr = SR_RE.search(tail)
                made = G.find_dates(flat[max(0, m.start() - 300):m.end() + 300])
                rec = dict(base, record='polling-instrument', title=t,
                           sr_number=f'{sr.group(1)} No. {sr.group(2)}' if sr else None,
                           bodies=PARLIAMENTARY + ['local-government'] if re.search(r'Electoral\s+Law|Station\s+Scheme', t, re.I) else
                           (PARLIAMENTARY if re.search(r'Parliament|Representation', t) else []),
                           notice_date=(made[0][2] if made else issue_date), confidence='medium',
                           kind=('polling-station-scheme' if re.search(r'Station\s+Scheme', t, re.I) else
                                 'polling-districts' if re.search(r'District', t) else 'polling-places'))
                records.append(G.cite(rec))
                found = True
        if not found:
            skipped.append((idx, statute or 'mention-only'))
    return records, skipped


# ---------------------------------------------------------------------------------------------
# Civgraph hooks

def crosscheck(records):
    unmatched = []
    for r in records:
        r.pop('civgraph_file', None)
        r.pop('civgraph_keys', None)
        if r['record'] == 'polling-instrument':
            if r.get('bodies'):
                nxt = [(b, G.first_election_after(b, r['notice_date'], 5)) for b in r['bodies']]
                keys = [f'{b}/{x[0]}' for b, x in nxt if x]
                if keys:
                    r['civgraph_keys'] = keys
                    r['civgraph_key'] = keys[0]
            continue
        scope = r.get('scope') or {}
        hits = []
        if r['record'] == 'polling-district' and r.get('area_kind') == 'ward' and r.get('area_printed'):
            council = [b for b in r.get('bodies', []) if 'council' in b]
            for ward in r['area_printed']:
                hits += G.next_contests(council, ward, r['notice_date'], years=6, min_score=0.9)
        if scope.get('name'):
            hits += G.next_contests([b for b in r.get('bodies', []) if b in PARLIAMENTARY], scope['name'], r['notice_date'], years=6)
        keys = list(dict.fromkeys(G.contest_key(c) for c in hits))
        if keys:
            r['civgraph_keys'] = keys
            r['civgraph_key'] = keys[0]
            r['civgraph_file'] = next(c['file'] for c in hits if G.contest_key(c) == keys[0])
        else:
            unmatched.append({'issue': r['issue'], 'page': r.get('page'), 'record': r['record'],
                              'polling_district': r.get('polling_district') or r.get('polling_district_numbers'),
                              'scope': scope.get('name'), 'bodies': r.get('bodies'), 'notice_date': r.get('notice_date'),
                              'citation': r['citation']})
    return unmatched


def write_csv(path, records):
    cols = ['year', 'notice_date', 'scope', 'scope_kind', 'polling_district', 'polling_district_numbers', 'area_kind', 'area_printed',
            'polling_place', 'bodies', 'civgraph_key', 'confidence', 'ocr_flags', 'citation', 'url']
    rows = sorted((r for r in records if r['record'] == 'polling-district'),
                  key=lambda r: (r.get('notice_date') or '', (r.get('scope') or {}).get('name') or '', r['issue'], r['page_index']))
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(cols)
        for r in rows:
            sc = r.get('scope') or {}
            w.writerow([(r.get('notice_date') or '')[:4], r.get('notice_date'), sc.get('name'), sc.get('kind'), r.get('polling_district'),
                        '; '.join(r.get('polling_district_numbers') or []), r.get('area_kind'), '; '.join(r.get('area_printed') or []),
                        r.get('polling_place'), '; '.join(r.get('bodies') or []), r.get('civgraph_key'), r.get('confidence'),
                        '; '.join(r.get('ocr_flags') or []), r['citation'], r['url']])


def main():
    ap = G.add_common_args(G.make_parser(__doc__))
    args = ap.parse_args()
    db_path, out, pdf_dir = G.resolve_paths(args)
    cache = G.open_cache(out / 'polling-notices-cache.sqlite')
    src = G.open_source(db_path)
    todo, n_ok = G.todo_issues(src, cache, PARSER_VERSION, G.wanted_issues(args.issues), args.full)
    new = 0
    candidates = G.fts_issues(src, FTS_PREFILTER, todo)
    for k, (n, date, key) in enumerate(todo):
        pages = G.issue_pages(src, n) if n in candidates else []
        if any(GATE.search(t or '') for _, _, t in pages):
            pdf = pdf_dir / f'{n}.pdf'
            recs, skipped = parse_issue(n, date, pages, G.page_numbers(pages), str(pdf) if pdf.exists() else None)
            ds = G.issue_date_source(src, n)
            for r in recs:
                r['issue_date_source'] = ds
        else:
            recs, skipped = [], []
        G.store_issue(cache, n, PARSER_VERSION, key, recs, skipped)
        new += len(recs)
        if k % 200 == 199:
            cache.commit()
    cache.commit()
    records = G.cached_records(cache, PARSER_VERSION)
    skips = G.cached_skips(cache, PARSER_VERSION)
    summary = {'generated': datetime.datetime.now().isoformat(timespec='seconds'), 'parser_version': PARSER_VERSION,
               'run': {'issues_ok': n_ok, 'parsed_now': len(todo), 'records_now': new,
                       'last_issue': src.execute("SELECT MAX(issue), MAX(date) FROM issues WHERE status='ok'").fetchone()}}
    if not args.no_compare:
        unmatched = crosscheck(records)
        summary['crosscheck'] = {'matched': sum(1 for r in records if r.get('civgraph_key')), 'unmatched': len(unmatched)}
        summary['unmatched'] = unmatched[:500]
    with open(out / 'polling-notices.jsonl', 'w', encoding='utf-8', newline='\n') as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    write_csv(out / 'polling-districts-by-year.csv', records)
    dists = [r for r in records if r['record'] == 'polling-district']
    summary.update({
        'records': len(records),
        'by_record': dict(collections.Counter(r['record'] for r in records)),
        'by_decade': {f'{d}/{t}': v for (d, t), v in sorted(collections.Counter((G.decade(r.get('notice_date')), r['record']) for r in records).items())},
        'by_body': dict(collections.Counter(b for r in records for b in (r.get('bodies') or ['unclear']))),
        'schedules': [{'citation': r['citation'], 'scope': (r.get('scope') or {}).get('name'), 'notice_date': r.get('notice_date'),
                       'rows': r.get('rows'), 'purpose': r.get('purpose'), 'layout': r.get('layout'),
                       'continues_next_page': r.get('continues_next_page')} for r in records if r['record'] == 'polling-schedule'],
        'instruments': [{'title': r['title'], 'sr_number': r.get('sr_number'), 'citation': r['citation']} for r in records if r['record'] == 'polling-instrument'],
        'district_rows_with_ocr_flags': sum(1 for r in dists if r.get('ocr_flags')),
        'private_addresses_dropped': sum(r.get('private_addresses_dropped') or 0 for r in records),
        'skipped_pages': dict(collections.Counter(s['reason'] for s in skips)),
        'skipped_page_list': skips[:300],
    })
    (out / 'polling-notices-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({k: summary[k] for k in ('run', 'records', 'by_record', 'by_decade', 'by_body', 'skipped_pages') if k in summary}, indent=1))
    if 'crosscheck' in summary:
        print('crosscheck', summary['crosscheck'])


if __name__ == '__main__':
    main()
