#!/usr/bin/env python
"""Find what the Belfast Gazette prints about election expenses, and extract the figures it gives.

Reads the crawler's database READ-ONLY (and the issue PDFs for the Exchequer statements' figure
columns) and writes, in <out> (default <CIVGRAPH_GAZETTE_DIR>/extracted):

  expenses-notices.jsonl          one record per notice (see "kind" below)
  expenses-notices-summary.json   what kinds exist by decade and body, unmatched records, skipped pages
  expenses-notices-cache.sqlite   per-issue cache (makes reruns incremental)

Kinds ("kind" field):
  candidate-expense-return        a return or declaration of a candidate's election expenses: election,
                                  constituency/area, candidate, election agent (names only), total and any
                                  itemised heads. (None printed 1922-1985; the parser is ready for later issues.)
  expense-returns-inspection      a notice of where candidates' returns may be inspected (names only)
  candidate-expense-limits        an Order or notice setting the maximum candidates' election expenses,
                                  with the fixed sum and the per-elector sum where printed (old and new)
  returning-officer-charges       a scale of maximum charges / remuneration and expenses of returning
                                  officers (instrument, maker, date, body, general or by-elections, whether
                                  the scale is printed in full)
  registration-expenses           scales or regulations for electoral registration expenses
  exchequer-returning-officers-expenses
                                  the "Returning Officers' Expenses" line of the monthly Exchequer statement
                                  (month and total-to-date figures, read from the PDF layout)
  returning-officer-claims-notice a notice to persons with claims against a returning officer for one election

Skipped (listed in the summary with the reason): civil-service competition terms ("no expenses in
connection with attendance"), accounts of other bodies, Acts and Rules text and blank statutory forms,
other mentions.

Privacy: names of candidates and agents only; addresses are dropped at parse time and never stored.
Raw notice text is not written out.

Civgraph hooks: a return is matched to its contest (civgraph_file, civgraph_key <body>/<date>/<slug>);
an instrument to the first Civgraph election it governs in each body (civgraph_keys <body>/<date>);
an Exchequer line to the NI elections held in the nine months before the statement. Unmatched records
are listed in the summary.

  CIVGRAPH_GAZETTE_DIR=<data folder> python scripts/ingest/gazette-spn/extract_expenses_notices.py [--full]
         [--issues 30-400] [--no-compare] [--db <dir>/gazette.sqlite] [--out <dir>/extracted]

Rerun at any time while the crawl runs: only new, refetched or re-dated issues are parsed. Bump
PARSER_VERSION after changing the rules.
"""
import collections, datetime, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gazette_notice_common as G  # noqa: E402
from extract_election_notices import strip_name, ocr_flags_for_name  # noqa: E402

PARSER_VERSION = 2
FTS_PREFILTER = 'expen* OR penses OR charges OR "returning officers"'

GATE = re.compile(r'ex\W{0,3}pen\W{0,3}ses|Returning\W+Officers?\W{0,3}\s+(?:Remuneration|Charges)|Maximum\s+Charges', re.I)
EXP = re.compile(r'expenses|charges', re.I)

NOISE = [
    ('civil-service-competition', re.compile(r'No\s+expenses\s+in\s+connection\s+with\s+attend|TRAVELLING\s+EXPENSES|Civil\s+Service\s+Commissioners|'
                                             r'competition|examination\s+fee', re.I)),
    ('other-body-accounts', re.compile(r'STATEMENT\s+OF\s+ACCOUNTS|Nursing|Midwives|Examination\s+expenses', re.I)),
]
KINDS = [
    ('exchequer-returning-officers-expenses', re.compile(r'Returning\W+Officers\W{0,3}\s+Expenses', re.I),
     re.compile(r'Consolidated\s+Fund|Supply\s+Services|Sinking\s+Funds|Temporary\s+Borrowings', re.I)),
    ('candidate-expense-limits', re.compile(r'limits?\s+(?:on|of)\s+candidates|Variation\s+of\s+Limits|maximum\s+amount\s+of\s+candidates|'
                                            r'limit\s+on\s+candidates\W{0,3}\s+election\s+expenses', re.I), None),
    ('candidate-expense-return', re.compile(r'returns?\W+(?:and\W+declarations?\W+)?(?:of|as\W+to|respecting)\W+(?:the\W+)?election\W+expenses|'
                                            r'declarations?\W+(?:as\W+to|of|respecting)\W+(?:the\W+)?election\W+expenses|'
                                            r'statement\s+of\s+(?:the\s+)?election\s+expenses', re.I), None),
    ('returning-officer-charges', re.compile(r"Returning\W+Officers?\W{0,3}\s*(?:\(\w+\)\s*)?(?:Remuneration\s+and\s+)?(?:Expenses|Charges)|"
                                             r"Maximum\s+Charges\s+of\s+Returning|Returning\s+Officers\W{0,3}\s+Fees", re.I), None),
    ('registration-expenses', re.compile(r'Registration\s+Expenses', re.I), None),
    ('returning-officer-claims-notice', re.compile(r'claims?\W+against\W+(?:a|the|any)\W+returning\W+officer', re.I), None),
]
TITLE_RE = re.compile(r"((?:The\s+)?(?:[A-Z][A-Za-z'&.]*\s+|\(\s*|\)\s*|of\s+|and\s+|to\s+){0,12}?"
                      r"(?:Expenses|Charges|Limits[A-Za-z' ]{0,40}Expenses)\)?\s*(?:\((?:[A-Z][A-Za-z ]+)\)\s*)*"
                      r"(?:Order|Regulations|Rules)(?:\s*\((?:Northern\s+Ireland|N\.\s?I\.)\))?,?\s*(?:19|20)\d\d)")
SR_RE = re.compile(r'(?:S\.\s?R\.?\s*(?:&|and)?\s*(?:O\.)?|Statutory\s+Rules\s+(?:and|&)\s+Orders)\s*,?\s*(?:\(N\.I\.\)\s*)?(19\d\d|20\d\d)\s*,?\s*No\.?\s*,?\s*(\d{1,4})')
# The text layer often loses the pound sign as U+FFFD; both are read as pounds.
POUND = '[' + chr(0xA3) + chr(0xFFFD) + ']'
AMOUNT = POUND + r'\s?[\d,]+(?:\.\d{1,2})?(?:\s+\d{1,2}\s*s\.?)?(?:\s+\d{1,2}\s*d\.?)?'
MONEY_RE = re.compile(POUND + r"\s?([\d,]+(?:\.\d{1,2})?)(?:\s+(\d{1,2})\s*s\.?)?(?:\s+(\d{1,2})\s*d\.?)?|([\d.]+)\s?p\b")
HEADS = re.compile(r'(Agent|Sub-?agents?|Polling\s+agents?|Clerks?\s+and\s+messengers|Printing(?:,?\s+advertising)?|Advertising|Stationery|'
                   r'Postage|Telegrams?|Public\s+meetings?|Committee\s+rooms?|Miscellaneous(?:\s+matters)?|Personal\s+expenses|'
                   r'Goods|Services|Transport|Conveyances?|Halls?|Election\s+address(?:es)?)\W{0,30}(' + AMOUNT + ')', re.I)
SCALE_TEXT = re.compile(r'DISBURSEMENTS|presiding\s+officer|polling\s+station|ballot\s+(?:boxes|papers)|For\s+the\s+hire|counting\s+assistants', re.I)
CAPS_TITLE_RE = re.compile(r"([A-Z][A-Z ()'&.,-]{5,140}?(?:EXPENSES|CHARGES)\)?\s*(?:\([A-Z .]+\)\s*)?(?:ORDER|REGULATIONS|RULES)\s*"
                           r"(?:\((?:NORTHERN IRELAND|N\.\s?I\.)\))?,?\s*(?:19|20)\d\d)")
SUBJECT_RE = re.compile(r'prescribing\s+(?:an?\s+)?(?:revised\s+|new\s+)?((?:Scales?|rates?)\s+of\s+[^.]{10,220}?)(?=\.|\s+The\s+Order|\s+Copies)', re.I)


def money(text):
    """Printed amount -> (pounds as a number, printed form). Handles pounds, shillings and pence and new pence."""
    m = MONEY_RE.search(text or '')
    if not m:
        return None, None
    printed = re.sub(POUND, chr(0xA3), G.clean_ws(m.group(0)))
    if m.group(4):
        return round(float(m.group(4)) / 100, 4), printed
    try:
        v = float(m.group(1).replace(',', ''))
    except ValueError:
        return None, printed
    if m.group(2):
        v += int(m.group(2)) / 20
    if m.group(3):
        v += int(m.group(3)) / 240
    return round(v, 4), printed


def bodies_of(text):
    t = text
    out = []
    if re.search(r'Scotland|England\s+and\s+Wales', t) and not re.search(r'Northern\s+Ireland', t[:400]):
        return ['out-of-scope']
    if re.search(r'Imperial\s+Parliament|Parliament\s+of\s+the\s+United\s+Kingdom|parliamentary\s+elections?\s+in\s+Northern|'
                 r'Representation\s+of\s+the\s+People\s+Act\s+19(?:49|83)', t, re.I) or \
            (re.search(r'Treasury', t) and re.search(r'PARLIAMENTARY\s+ELECTIONS', t, re.I) and not re.search(r'NORTHERN\s+IRELAND\s+PARLIAMENT|Parliament\s+of\s+Northern|House\s+of\s+Commons\s+of\s+Northern', t, re.I)):
        out.append('house-of-commons-of-the-united-kingdom')
    if re.search(r'NORTHERN\s+IRELAND\s+PARLIAMENT|Parliament\s+of\s+Northern|House\s+of\s+Commons\s+of\s+Northern|Electoral\s+Law\s+Act', t, re.I) or \
            (re.search(r'Ministry\s+of\s+Finance', t) and re.search(r'PARLIAMENTARY', t, re.I)):
        out.append('parliament-of-northern-ireland')
    if re.search(r'Elections\s+and\s+Franchise', t, re.I):
        out += ['parliament-of-northern-ireland', 'local-government']
    if re.search(r'local\s+elections?|Local\s+Government|Councillors?|District\s+Councils?|Electoral\s+Law\s+Act', t, re.I):
        out.append('local-government')
    if re.search(r'Northern\s+Ireland\s+Assembly|Assembly\s+elections?', t, re.I):
        out.append('northern-ireland-assembly')
    if re.search(r'European\s+(?:Parliament|Assembly)', t, re.I):
        out.append('european-parliament')
    return list(dict.fromkeys(out))


def instrument(window):
    titles = [G.clean_ws(m.group(1)) for m in TITLE_RE.finditer(window)]
    titles = [re.sub(r'^.*?\b(?:entitled|viz\.?,?:?|namely)\s+(?:the\s+)?', '', t) for t in titles]
    titles = [re.sub(r'^(?:The|the|An|an|A)\s+', '', t) for t in titles if len(t) > 15]
    for m in CAPS_TITLE_RE.finditer(window):
        t = G.clean_ws(m.group(1)).strip(' .,-')
        if len(t) > 90:
            t = re.sub(r'^.*?(?=NORTHERN IRELAND \(|THE [A-Z])', '', t)
        t = re.sub(r'\bOf\b', 'of', re.sub(r'\bAnd\b', 'and', t.title()))
        titles.append(re.sub(r'^The\s+', '', t))
    subj = SUBJECT_RE.search(window)
    sr = SR_RE.search(window)
    made = None
    m = re.search(r'(?:dated|made\s+on\s+the|made\s+on)\s+([^()]{0,40}?(?:19|20)\d\d)', window, re.I)
    if m:
        ds = G.find_dates(m.group(1))
        made = ds[0][2] if ds else None
    maker = None
    for name, rx in (('Treasury', r'Treasury'), ('Ministry of Finance', r'Ministry\s+of\s+Finance'),
                     ('Ministry of Home Affairs', r'Ministry\s+of\s+Home\s+Affairs'), ('Secretary of State', r'Secretary\s+of\s+State'),
                     ('Department of Finance', r'Department\s+of\s+Finance'), ('Department of the Environment', r'Department\s+of\s+the\s+Environment'),
                     ('Privy Council', r'Privy\s+Council|Order\s+in\s+Council')):
        if re.search(rx, window[:1500]):
            maker = name
            break
    return {'title': titles[0] if titles else None, 'subject': G.clean_ws(subj.group(1)) if subj else None,
            'sr_number': f'{sr.group(1)} No. {sr.group(2)}' if sr else None, 'made_date': made, 'made_by': maker}


def heading_key(window):
    m = re.search(r"RETURNING\W+OFFICERS\W{0,3}\s+(?:REMUNERATION\s+AND\s+)?EXPENSES|REGISTRATION\s+EXPENSES|VARIATION\s+OF\s+LIMITS", window)
    return m.group(0) if m else None


# ---------------------------------------------------------------------------------------------
# Kind parsers

def amount_pair(was, now):
    """Old and new amounts as printed (pound sign restored) and in pounds."""
    def one(a):
        a = re.sub(POUND, chr(0xA3), a.replace(' ', ''))
        v = money(a)[0]
        return a, v
    (w, wv), (n, nv) = one(was), one(now)
    return {'was': w, 'was_pounds': wv, 'now': n, 'now_pounds': nv}


def parse_limits(window):
    out = {}
    pairs = []
    for m in re.finditer(r'(fixed\s+sum|additional\s+sum|sum)[^()]{0,40}\(which\s+was\s+(' + POUND + r'?\s?[\d.,]+p?)\s+and\s+will\s+be\s+(' + POUND + r'?\s?[\d.,]+p?)\)'
                         r'(?:[^.;]{0,60}?(?:in\s+respect\s+of\s+each|for\s+each|per)\s+([^.;()]{3,60}?)(?=\s+for\s+th|\s+at\s+th|[.;(]))?', window, re.I):
        pairs.append({'part': G.clean_ws(m.group(1)).lower(), 'per': G.clean_ws(m.group(4)) if m.group(4) else None,
                      **amount_pair(m.group(2), m.group(3))})
    if not pairs:
        for m in re.finditer(r'(?:from|was)\s+(' + POUND + r'\s?[\d.,]+|[\d.]+p)\s+(?:to|and\s+will\s+be)\s+(' + POUND + r'\s?[\d.,]+|[\d.]+p)', window):
            pairs.append({'part': None, **amount_pair(m.group(1), m.group(2))})
    if pairs:
        out['limits'] = pairs
    m = re.search(r'last\s+increased\s+(?:in|by)\s+(?:the\W+)?([A-Za-z][^;]{3,60}?(?:19|20)\d\d)', window, re.I)
    if m:
        out['previous_change'] = G.clean_ws(m.group(1))
    m = re.search(r'fee\s+payable\s+for\s+the\s+inspection\s+of\s+the\s+returns[^.]{0,40}?from\s+(\S+)\s+to\s+(' + POUND + r'?\s?[\d.]+p?)', window, re.I)
    if m:
        out['inspection_fee'] = {'was': m.group(1), 'now': m.group(2).replace(' ', '')}
    out['elections'] = ('local elections' if re.search(r'local\s+elections', window, re.I) else
                        'parliamentary elections' if re.search(r'parliamentary', window, re.I) else None)
    return out


def parse_return(window):
    """A candidate's return of election expenses (generic: no example printed 1922-1985)."""
    out = {}
    m = re.search(r'(?i:ELECTION\s+(?:of\s+(?:an?\s+)?(?:Members?|Councillors?|Representatives?)\s+)?(?:for|of|to)\s+(?:the\s+)?)'
                  r'([A-Z][A-Za-z\'. -]{2,60}?)(?=\s+(?:Constituency|CONSTITUENCY|Ward|WARD|Electoral\s+Area|District)|[,.;\n])', window)
    if m:
        out['area_printed'] = G.clean_ws(m.group(1))
    poll = re.search(r'(?:held|poll(?:ing)?\s+day|election)\s+on\s+(?:the\s+)?([^.;]{4,40}?(?:19|20)\d\d)', window, re.I)
    if poll:
        d = G.find_dates(poll.group(1))
        out['election_date'] = d[0][2] if d else None
    cands = []
    for cm in re.finditer(r'(?:Name\s+of\s+)?Candidate\s*[:.\-]?\s*([A-Z][^\n;]{3,120}?)(?=\s*(?:Election\s+Agent|Agent\b|Total|' + POUND + r'|\n|;|$))', window):
        name = person(cm.group(1))
        if len(name.split()) < 2 or re.search(r'\d', name):
            continue
        seg = window[cm.end():cm.end() + 1500]
        nxt = re.search(r'(?:Name\s+of\s+)?Candidate\s*[:.\-]', seg)
        seg = seg[:nxt.start()] if nxt else seg
        rec = {'candidate': name, 'ocr_flags': ocr_flags_for_name(name)}
        am = re.search(r'(?:Election\s+)?Agent\s*[:.\-]?\s*([A-Z][^\n;]{3,100}?)(?=\.\s+[A-Z]|\n|;|$)', seg)
        if am:
            rec['agent'] = person(am.group(1))
        tm = re.search(r'Total[^\d]{0,40}(' + AMOUNT + ')', seg, re.I)
        if tm:
            rec['total'], rec['total_printed'] = money(tm.group(1))
        heads = [{'head': G.clean_ws(h.group(1)), 'amount': money(h.group(2))[0], 'printed': money(h.group(2))[1]}
                 for h in HEADS.finditer(seg) if not re.match(r'Agent', h.group(1), re.I) or h.start() > (am.end() if am else -1)]
        if heads:
            rec['heads'] = heads
        cands.append(rec)
    if cands:
        out['candidates'] = cands
    return out


HEAD_WORD = r'(?:Total|Printing|Agent|Election|Stationery|Postage|Name|Candidate|Advertising|Personal|Miscellaneous|Public|Committee)'


def person(raw):
    """A candidate's or agent's name only: cut at the next field and drop any address."""
    s = re.split(r'\.\s+(?=' + HEAD_WORD + r'\b)|\s+' + HEAD_WORD + r'\s*[:.]', raw)[0]
    return strip_name(s)


def exchequer_line(pdf_path, page_index):
    """Month and total-to-date figures on the "Returning Officers' Expenses" line, by column position."""
    try:
        import pymupdf
        page = pymupdf.open(pdf_path)[page_index]
    except Exception:
        return None
    ws = page.get_text('words')
    out = []
    for w in ws:
        if not w[4].startswith('Returning'):
            continue
        y = (w[1] + w[3]) / 2
        line = sorted([v for v in ws if abs((v[1] + v[3]) / 2 - y) < 4 and v[0] > w[0]], key=lambda v: v[0])
        if not any(v[4].startswith('Expenses') for v in line[:3]):
            continue
        heads = [v for v in ws if v[1] < w[1] and v[0] > w[0] and re.match(r'Month|Total|Period|Year', v[4])]
        months = [v for v in heads if v[4].startswith('Month')]
        totals = [v for v in heads if v[4].startswith('Total') and not re.match(r'TOTAL', v[4])]
        figs = [v for v in line if re.fullmatch(r'[\d,.]{1,12}', v[4]) and re.search(r'\d', v[4])]
        rec = {'figures_printed': [v[4] for v in figs]}
        for v in figs:
            val = int(re.sub(r'\D', '', v[4]))
            cx = (v[0] + v[2]) / 2
            near = min(months + totals, key=lambda h: abs((h[0] + h[2]) / 2 - cx), default=None)
            if near is not None and abs((near[0] + near[2]) / 2 - cx) < 60:
                rec['month' if near in months else 'total_to_date'] = val
        out.append(rec)
    return out or None


# ---------------------------------------------------------------------------------------------
# One issue

def parse_issue(issue, issue_date, pages, nums, pdf_path):
    records, skipped = [], []
    last = None  # previous page's record, for scales printed over several pages
    for k, (idx, _, text) in enumerate(pages):
        if not GATE.search(text or ''):
            last = None
            continue
        flat = G.join_lines(text)
        page = nums[k] if k < len(nums) else None
        seen = set()
        page_recs = []
        for m in EXP.finditer(flat):
            win = flat[max(0, m.start() - 700):m.end() + 900]
            near = flat[max(0, m.start() - 250):m.end() + 250]
            noise = next((r for r, rx in NOISE if rx.search(near)), None)
            if noise:
                skipped.append((idx, noise))
                continue
            kind = None
            for kname, rx, ctx in KINDS:
                if rx.search(near) and (ctx is None or ctx.search(win)):
                    kind = kname
                    break
            if kind is None:
                if re.search(r'election|candidate|returning\s+officer|agent', near, re.I):
                    skipped.append((idx, 'other-election-mention'))
                continue
            statute = G.statute_like(win)
            if statute and kind in ('returning-officer-claims-notice', 'candidate-expense-return', 'expense-returns-inspection'):
                skipped.append((idx, statute))
                continue
            if kind == 'candidate-expense-return' and re.search(r'This\s+Order|These\s+Regulations|fee\s+payable|will\s+be\s+available', near):
                kind = 'candidate-expense-limits' if re.search(r'limit', win, re.I) else None
                if kind is None:
                    skipped.append((idx, 'explanatory-note'))
                    continue
            if kind == 'candidate-expense-return' and not MONEY_RE.search(win):
                kind = 'expense-returns-inspection' if re.search(r'inspect', win, re.I) else None
                if kind is None:
                    skipped.append((idx, 'return-mentioned-no-figures'))
                    continue
            # One record per kind and instrument on a page (a scale mentions "expenses" many times).
            ins = instrument(win)
            key = (kind, '') if kind in ('exchequer-returning-officers-expenses', 'candidate-expense-return') else \
                (kind, ins['sr_number'] or ins['made_date'] or ins['title'] or '')
            if key in seen or (kind, '') in seen or (key[1] and (kind, '?') in seen):
                continue
            seen.add(key)
            if not key[1]:
                seen.add((kind, '?'))
            rec = {'issue': issue, 'issue_date': issue_date, 'page_index': idx, 'page': page, 'kind': kind}
            bodies = bodies_of(win)
            if bodies == ['out-of-scope']:
                skipped.append((idx, 'outside-northern-ireland'))
                continue
            rec['bodies'] = bodies
            if kind == 'exchequer-returning-officers-expenses':
                mm = re.search(r'Month\s+of\s+(' + '|'.join(G.MONTHS) + r'),?\s*((?:19|20)\d\d)', flat)
                if mm:
                    rec['statement_month'] = f'{mm.group(2)}-{G.MONTHS.index(mm.group(1)) + 1:02d}'
                fy = re.search(r'(?:Total\s+to|period\s+from)[^.]{0,40}?(\d{1,2}(?:st|nd|rd|th)?\s+(?:' + '|'.join(G.MONTHS) + r'),?\s*(?:19|20)\d\d)', flat)
                if fy:
                    ds = G.find_dates(fy.group(1))
                    rec['total_to_date_until'] = ds[0][2] if ds else None
                lines = exchequer_line(pdf_path, idx) if pdf_path else None
                if lines:
                    rec.update({k2: v for k2, v in lines[0].items()})
                    rec['layout'] = 'pdf-columns'
                    rec['confidence'] = 'medium' if ('month' in rec or 'total_to_date' in rec) else 'low'
                else:
                    rec['layout'] = 'text-only'
                    rec['confidence'] = 'low'
                rec['bodies'] = ['parliament-of-northern-ireland', 'house-of-commons-of-the-united-kingdom']
                rec['note'] = "Northern Ireland Exchequer issues for returning officers' expenses (all elections paid from the Consolidated Fund)"
            elif kind in ('returning-officer-charges', 'registration-expenses', 'candidate-expense-limits'):
                rec.update(instrument(win))
                if re.search(r'Scotland|England|Wales', (rec.get('title') or '') + ' ' + (rec.get('subject') or '')):
                    skipped.append((idx, 'outside-northern-ireland'))
                    continue
                if kind == 'returning-officer-charges':
                    rec['election_scope'] = ('by-elections' if re.search(r'other\s+than\s+(?:at\s+)?Elections?\s+of\s+the\s+full\s+number', win, re.I)
                                             else 'general-elections' if re.search(r'full\s+number\s+of\s+Members|GENERAL\s+ELECTIONS', win, re.I) else None)
                    rec['scale_printed'] = bool(re.search(r'DISBURSEMENTS|For\s+each\s+presiding\s+officer|For\s+one\s+clerk', flat, re.I))
                if kind == 'candidate-expense-limits':
                    rec.update(parse_limits(win))
                rec['confidence'] = 'medium' if rec.get('title') or rec.get('sr_number') else 'low'
            elif kind == 'candidate-expense-return':
                rec.update(parse_return(flat[max(0, m.start() - 1500):m.end() + 6000]))
                rec['confidence'] = 'medium' if rec.get('candidates') and not any(c.get('ocr_flags') for c in rec['candidates']) else 'low'
            elif kind == 'expense-returns-inspection':
                r2 = parse_return(win)
                rec['area_printed'] = r2.get('area_printed')
                rec['candidates'] = [{'candidate': c['candidate'], **({'agent': c['agent']} if c.get('agent') else {})} for c in r2.get('candidates', [])]
                rec['confidence'] = 'low'
            elif kind == 'returning-officer-claims-notice':
                r2 = parse_return(win)
                rec['area_printed'] = r2.get('area_printed')
                rec['election_date'] = r2.get('election_date')
                rec['confidence'] = 'low'
                if not rec['area_printed']:
                    # The standard "take notice" paragraph printed in Rules and forms, not one election's notice.
                    skipped.append((idx, 'rules-or-form-paragraph'))
                    continue
            if not rec['bodies'] and kind in ('returning-officer-charges', 'registration-expenses'):
                # No body named near the heading: infer it from the maker (the Treasury acted for
                # Westminster; the NI ministries for Stormont before 1973, for district councils after).
                maker = rec.get('made_by')
                if maker == 'Treasury':
                    rec['bodies'] = ['house-of-commons-of-the-united-kingdom']
                elif maker:
                    rec['bodies'] = ['parliament-of-northern-ireland'] if issue_date < '1973' else ['local-government']
                if rec['bodies']:
                    rec['body_inferred_from_maker'] = True
            if not rec.get('notice_date'):
                rec['notice_date'] = rec.get('made_date') or issue_date
            page_recs.append(G.cite(rec))
        # A scale printed over several pages is one record with a page range.
        if not page_recs and last and last['kind'] == 'returning-officer-charges' and SCALE_TEXT.search(flat) and not heading_key(flat):
            last['page_end'] = page
            last['scale_printed'] = True
            G.cite(last)
            continue
        records.extend(page_recs)
        last = page_recs[-1] if page_recs else None
    return records, skipped


# ---------------------------------------------------------------------------------------------
# Civgraph hooks

def crosscheck(records):
    unmatched = []
    for r in records:
        for k in ('civgraph_file', 'civgraph_key', 'civgraph_keys'):
            r.pop(k, None)
        kind = r['kind']
        keys, file = [], None
        if kind == 'exchequer-returning-officers-expenses':
            end = (r.get('statement_month') or r['issue_date'][:7]) + '-28'
            try:
                start = (datetime.date.fromisoformat(end) - datetime.timedelta(days=270)).isoformat()
            except ValueError:
                start = None
            if start:
                keys = [f'{b}/{d}' for b, d, _ in G.elections_between(r['bodies'], start, end)]
        elif kind in ('returning-officer-charges', 'registration-expenses', 'candidate-expense-limits'):
            for b in r.get('bodies') or []:
                nxt = G.first_election_after(b, r.get('made_date') or r['notice_date'],
                                             1 if r.get('election_scope') == 'by-elections' else 5)
                if nxt:
                    keys.append(f'{b}/{nxt[0]}')
        elif kind in ('candidate-expense-return', 'expense-returns-inspection', 'returning-officer-claims-notice') and r.get('area_printed'):
            date = r.get('election_date') or r['notice_date']
            by = G.by_body()
            best = gazette_match(by, r.get('bodies'), r['area_printed'], date)
            if best:
                c = best[1]
                keys, file = [G.contest_key(c)], c['file']
                for cand in r.get('candidates') or []:
                    names = [x['name'] for x in c['candidates']]
                    rel = sorted(((G.gazette_crosscheck.RANK.index(G.gazette_crosscheck.name_relation(cand['candidate'], n)), n) for n in names), key=lambda t: t[0])
                    if rel and rel[0][0] <= 4:
                        cand['civgraph_candidate'] = rel[0][1]
        if keys:
            r['civgraph_keys'] = keys
            r['civgraph_key'] = keys[0]
        if file:
            r['civgraph_file'] = file
        if not keys and kind not in ('registration-expenses',):
            unmatched.append({'kind': kind, 'citation': r['citation'], 'title': r.get('title'), 'area_printed': r.get('area_printed'),
                              'bodies': r.get('bodies'), 'notice_date': r.get('notice_date')})
    return unmatched


def gazette_match(by, bodies, place, date):
    return G.gazette_crosscheck.match_contest(by, bodies[0] if bodies and len(bodies) == 1 else None, place, date, before=200, after=30)


def main():
    ap = G.add_common_args(G.make_parser(__doc__))
    args = ap.parse_args()
    db_path, out, pdf_dir = G.resolve_paths(args)
    cache = G.open_cache(out / 'expenses-notices-cache.sqlite')
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
    with open(out / 'expenses-notices.jsonl', 'w', encoding='utf-8', newline='\n') as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    summary.update({
        'records': len(records),
        'by_kind': dict(collections.Counter(r['kind'] for r in records)),
        'by_decade_kind': {f'{d}/{t}': v for (d, t), v in sorted(collections.Counter((G.decade(r.get('notice_date')), r['kind']) for r in records).items())},
        'by_body': dict(collections.Counter(b for r in records for b in (r.get('bodies') or ['unclear']))),
        'candidate_returns_with_amounts': sum(1 for r in records if r['kind'] == 'candidate-expense-return' and any('total' in c for c in r.get('candidates') or [])),
        'instruments': [{'kind': r['kind'], 'title': r.get('title'), 'sr_number': r.get('sr_number'), 'made_date': r.get('made_date'),
                         'bodies': r.get('bodies'), 'election_scope': r.get('election_scope'), 'limits': r.get('limits'),
                         'scale_printed': r.get('scale_printed'), 'citation': r['citation']}
                        for r in records if r['kind'] in ('returning-officer-charges', 'registration-expenses', 'candidate-expense-limits')],
        'exchequer_lines': sum(1 for r in records if r['kind'] == 'exchequer-returning-officers-expenses'),
        'exchequer_lines_with_figures': sum(1 for r in records if r['kind'] == 'exchequer-returning-officers-expenses' and ('month' in r or 'total_to_date' in r)),
        'skipped_pages': dict(collections.Counter(s['reason'] for s in skips)),
        'skipped_page_list': [s for s in skips if s['reason'] not in ('civil-service-competition',)][:400],
    })
    (out / 'expenses-notices-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps({k: summary[k] for k in ('run', 'records', 'by_kind', 'by_decade_kind', 'by_body', 'skipped_pages') if k in summary}, indent=1))
    if 'crosscheck' in summary:
        print('crosscheck', summary['crosscheck'])


if __name__ == '__main__':
    main()
