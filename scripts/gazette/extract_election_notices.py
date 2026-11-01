#!/usr/bin/env python
"""Find and parse election notices in the Belfast Gazette and check them against Civgraph.

Stage 2 of the Belfast Gazette extraction. Reads the crawler's database READ-ONLY
(scripts/gazette/crawl_belfast_gazette.py fills it) and, for pages laid out as tables, the issue
PDFs, and writes:

  <out>/extracted/election-notices.jsonl        one parsed notice per line
  <out>/extracted/election-notices-summary.json  counts by type/body/decade and parse quality
  <out>/extracted/election-crosscheck.json      every notice matched (or not) to a Civgraph contest
  <out>/extracted/election-fix-proposals.json   source-checked-fixes-style PROPOSALS (never applied)
  <out>/extracted/election-notices-cache.sqlite  per-issue parse cache (makes reruns incremental)

Notices recognised: members returned / elected to serve (Crown Office, Clerk of the Crown),
Speaker's warrants for new writs and other vacancy notices, statements of persons nominated,
notices of poll, declarations of result, appointments of election agents (names only), council
casual vacancies, and election petitions; for Westminster NI seats, the Parliament of Northern
Ireland (incl. Queen's University), the Assembly / Convention / Forum, NI councils and the
European Parliament.

Privacy: candidates', proposers' and agents' addresses (and occupation-with-address text) are
dropped at parse time; only names, printed descriptions (party labels), constituencies and figures
are stored. Raw notice text is never written out. Insolvency, estates and personal notices are not
read beyond the keyword gate.

Citations: "Belfast Gazette, issue <n>, <d Month yyyy>, p. <page>",
https://www.thegazette.co.uk/Belfast/issue/<n>/page/<page> (Crown copyright, Open Government
Licence). Nothing is fetched from thegazette.co.uk.

  CIVGRAPH_GAZETTE_DIR=<data folder> python scripts/gazette/extract_election_notices.py [--full]
         [--issues 30-400] [--no-compare] [--db <dir>/gazette.sqlite] [--out <dir>/extracted]

The data folder is the crawler's (gazette.sqlite + pdf/); --db and --out override its parts.

Rerun at any time while the crawl runs: issues already parsed by this parser version are taken
from the cache, new issues are parsed, and every output file is rewritten from the cache.
"""
import argparse, collections, datetime, json, os, re, sqlite3, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import civgraph_elections  # noqa: E402
import gazette_crosscheck  # noqa: E402

PARSER_VERSION = 26
REPO = Path(__file__).resolve().parents[2]
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
          'November', 'December']
MONTH_RE = '|'.join(m[:3] + r'[a-z]*' for m in MONTHS)

# ---------------------------------------------------------------------------------------------
# Keyword gate: only pages matching this FTS query are read at all.
FTS_GATE = ('"to serve" OR "new writ" OR "persons nominated" OR "notice of poll" OR "poll will be taken" OR '
            '"result of poll" OR "result of the poll" OR "duly elected" OR "election agent" OR "election agents" OR '
            '"casual vacancy" OR "election petition" OR "returned to serve" OR "votes recorded" OR '
            '"statement as to persons" OR "elected to serve" OR "returning officer" OR "member returned" OR '
            '"members returned" OR "in the room of" OR "in the place of" OR "vacancy in the office" OR '
            '"declaration of result" OR "uncontested" OR "unopposed"')

STRONG_PHRASES = re.compile(r'elected to serve|returned to serve|persons nominated|notice of poll|duly elected|in the room of|'
                            r'result of (?:the )?poll|election agent|casual vacancy|new writ', re.I)

# Notice anchors, most specific first. Each yields (type, regex). OCR noise is tolerated with \W+.
W = r'[\W_]{1,6}'
# 'M.EMBERS' (1958) and "Member's" (1931) are text-layer readings; Westminster lists say 'the Imperial
# Parliament'.
RETURN_ANCHOR = re.compile(r"(?:M\W{0,2}EMB\w{1,3}(?:'?S)?|Senators?)" + W + r'(?:elected|returned|re[-\s]?elected)' + W + r'to' + W + r'serve' + W +
                           r'\S{1,4}' + W + r'(?:the' + W + r')?(?:present' + W + r')?(?:Imperial' + W + r')?(?:P\W{0,3}A\W{0,3}R\W{0,3}L\W{0,3}I\W{0,3}A\W{0,3}M\W{0,3}E\W{0,3}N\W{0,3}T|House|Commons|Assembly|Senate)|'
                           r'RETURN' + W + r'OF' + W + r'(?:THE' + W + r')?MEMBERS?' + W + r'(?:elected|returned)', re.I)
ANCHORS = [
    ('return-of-members', RETURN_ANCHOR),
    ('writ-or-vacancy', re.compile(r'(?:new|issue)' + W + r'(?:of' + W + r'a' + W + r')?writ' + W + r'(?:for' + W + r')?(?:the' + W + r')?(?:election|electing)', re.I)),
    ('writ-or-vacancy', re.compile(r'(?:warrant|writ)[^.]{0,200}?in' + W + r'the' + W + r'room' + W + r'of', re.I | re.S)),
    ('statement-of-persons-nominated', re.compile(r'STATEMENT' + W + r'(?:AS' + W + r'TO|OF)' + W + r'PERSONS' + W + r'NOMINATED', re.I)),
    ('notice-of-poll', re.compile(r'NOTICE' + W + r'OF' + W + r'(?:A' + W + r')?POLL\b|poll' + W + r'will' + W + r'be' + W + r'taken', re.I)),
    ('declaration-of-result', re.compile(r'(?:DECLARATION|RESULT|NOTICE)' + W + r'OF' + W + r'(?:THE' + W + r')?RESULT' + W + r'OF' + W + r'(?:THE' + W + r')?(?:POLL|ELECTION)|'
                                         r'number' + W + r'of' + W + r'votes' + W + r'recorded', re.I)),
    ('election-agents', re.compile(r'(?:APPOINTMENT|NAMES?)' + W + r'(?:AND' + W + r'ADDRESS(?:ES)?' + W + r')?OF' + W + r'(?:THE' + W + r')?ELECTION' + W + r'AGENTS?|ELECTION' + W + r'AGENTS?' + W + r'(?:APPOINTED|NOTICE)', re.I)),
    ('casual-vacancy', re.compile(r'(?:NOTICE' + W + r'OF' + W + r')?CASUAL' + W + r'VACANC(?:Y|IES)|vacancy' + W + r'in' + W + r'the' + W + r'office' + W + r'of' + W + r'(?:councillor|alderman)', re.I)),
    ('election-petition', re.compile(r'ELECTION' + W + r'PETITIONS?\b(?!' + W + r'(?:Act|Rules))', re.I)),
]
ANCHOR_SPAN = 6000  # characters a notice may run to before the next anchor

# Text that marks the end of a notice (start of an unrelated one).
END_RE = re.compile(r'\n(?:Ministry of [A-Z]|MINISTRY OF |NOTICE\.\n|The Lord Lieutenant|His Grace the Governor|'
                    r'The Governor of Northern Ireland|Whitehall|ORDER,? Dated|IN THE HIGH COURT|COURT OF THE IRISH|'
                    r'TRADE BOARDS|Notice is hereby given that a Writ of Summons|Final Notice|Estate of )')

# ---------------------------------------------------------------------------------------------
# Body and place vocabulary
COUNTIES = ['Antrim', 'Armagh', 'Down', 'Fermanagh', 'Londonderry', 'Tyrone']
BODY_WORDS = [
    ('european-parliament', re.compile(r'European\s+(?:Parliament|Assembly)', re.I)),
    ('northern-ireland-forum-for-political-dialogue', re.compile(r'Forum', re.I)),
    ('northern-ireland-constitutional-convention', re.compile(r'Constitutional\s+Convention', re.I)),
    ('northern-ireland-assembly', re.compile(r'(?:Northern\s+Ireland|the)\s+Assembly', re.I)),
    ('local-government', re.compile(r'District\s+Council|Borough\s+Council|Urban\s+District|Rural\s+District|County\s+Council|'
                                    r'Councillors?|Aldermen|Alderman|electoral\s+ward|District\s+Electoral\s+Area|\bWard\b', re.I)),
    ('parliament-of-northern-ireland', re.compile(r'Parliament\s+of\s+Northern\s+Ireland|House\s+of\s+Commons\s+of\s+Northern|'
                                                  r'Northern\s+Ireland\s+House\s+of\s+Commons|Clerk\s+of\s+the\s+Crown\s+(?:and\s+Peace\s+)?for\s+Northern|'
                                                  r'Speaker\s+of\s+the\s+House\s+of\s+Commons\s+of\s+Northern|Stormont', re.I)),
    ('house-of-commons-of-the-united-kingdom', re.compile(r'Crown\s+Office|Imperial\s+Parliament|Parliament\s+of\s+the\s+United\s+Kingdom|'
                                                          r'House\s+of\s+Commons\s+of\s+the\s+United|Westminster', re.I)),
]

# Address-like text: drop on sight.
ADDRESS_WORDS = (r'Road|Rd|Street|St\.?|Avenue|Ave|Park|Gardens|Terrace|Place|Crescent|Drive|Lane|Square|Villas?|House|'
                 r'Cottage|Lodge|Hall|Manor|Court|Close|Way|Grove|Hill|Mount|Parade|Quay|Row|Walk|Belfast|Londonderry|Derry|'
                 r'Lisburn|Newry|Armagh|Omagh|Enniskillen|Coleraine|Ballymena|Bangor|Larne|Portadown|Lurgan|Dungannon|'
                 r'Strabane|Co\.|County|BT\d')
ADDRESS_RE = re.compile(r'\d|\b(?:' + ADDRESS_WORDS + r')\b')
HONORIFIC_TAIL = re.compile(r',?\s*(?:Esq(?:uire)?\.?|Baronet|Bart\.?|Bt\.?|K\.?C\.?|M\.?P\.?|J\.?P\.?|M\.?D\.?|LL\.?D\.?|D\.?L\.?|'
                            r'K\.?B\.?E\.?|C\.?B\.?E\.?|O\.?B\.?E\.?|M\.?B\.?E\.?|D\.?S\.?O\.?|M\.?C\.?|C\.?B\.?|K\.?C\.?B\.?|G\.?C\.?B\.?|'
                            r'P\.?C\.?|Q\.?C\.?|M\.?A\.?|B\.?A\.?|B\.?L\.?|F\.?R\.?C\.?S\.?|C\.?M\.?G\.?|K\.?C\.?M\.?G\.?|G\.?B\.?E\.?|K\.?P\.?|K\.?G\.?|'
                            r'Knight|Kt\.?|the\s+younger|junior|Jun\.?|Sen\.?)\s*$', re.I)


def clean_ws(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def join_lines(text):
    """Flatten OCR lines: rejoin hyphenated words, drop OCR junk characters."""
    text = text.replace('\u2014', '-').replace('\u2013', '-').replace('\u2019', "'").replace('\u2018', "'")
    text = re.sub(r'(\w)-\s*\n\s*([a-z])', r'\1\2', text)
    text = re.sub(r'([A-Z]{2})-\s*\n\s*([A-Z]{2})', r'\1\2', text)
    text = re.sub(r'(\w)-\s*\n\s*([A-Z])', r'\1-\2', text)
    text = re.sub(r'(\w)\s*[«*]+\s*', r'\1 ', text)
    text = re.sub(r'[•^~\\|«»_]+', ' ', text)
    return clean_ws(text)


def strip_name(raw):
    """A person's name from a printed entry: drop 'of <address>', titles at the end, OCR junk."""
    s = clean_ws(re.sub(r'\([^)]*\)?', ' ', raw or ''))
    s = re.split(r',\s*(?:of|residing at|at)\s+|\s+of\s+(?=["\'\d]|[A-Z][a-z]+\s+(?:' + ADDRESS_WORDS + r')\b)', s)[0]
    s = re.sub(r'^[^A-Za-z]+', '', s)
    s = re.sub(r'^[a-z](?=[A-Z])', '', s)
    # The name runs to the first comma; what follows is a style, honours or an occupation
    # ('John Clarke Davison, Esquire, LL.B., Barrister-at-Law'), never kept.
    first = s.split(',')[0]
    if len(first.split()) >= 2 and not re.match(r'(?:His|Her)\s', first):
        s = first
    s = re.sub(r'[^A-Za-z.\'\)]+$', '', s)
    prev = None
    while prev != s:
        prev = s
        s = HONORIFIC_TAIL.sub('', s).strip(' ,.')
    s = re.sub(r'^(?:the\s+)?(?:Right\s+Hon(?:ourable|\.)?|Rt\.?\s+Hon\.?|Hon(?:ourable|\.)|Mr\.?|Mrs\.?|Miss|Dr\.?)\s+', '', s, flags=re.I)
    return s.strip(' ,.')


def ocr_flags_for_name(name):
    flags = []
    if re.search(r'[^A-Za-z .\'\-()]', name):
        flags.append('odd-characters')
    if re.search(r'\b[a-z]{2,}', name.split(' ')[-1] if name else ''):
        flags.append('lowercase-surname')
    if len(name) < 4:
        flags.append('too-short')
    if re.search(r'[a-z]\.[a-z]|\b[a-z]\b|[a-z]{2,}[A-Z]', name):
        flags.append('ocr-fragment')
    return flags


def parse_date_text(text, default_year=None, last=False):
    """First (or last) 'd Month yyyy' (OCR-tolerant) date in text, as ISO."""
    found = None
    for m in re.finditer(r'(\d{1,2})\s*(?:st|nd|rd|th|«\*|ra|d)?[\s.,*]*(?:day\s+of\s+)?(' + MONTH_RE + r')[\s.,]*(1[89]\d\d|20\d\d)?', text, re.I):
        try:
            mon = next(i for i, mm in enumerate(MONTHS) if m.group(2).lower().startswith(mm[:3].lower())) + 1
            year = int(m.group(3)) if m.group(3) else default_year
            if year:
                found = datetime.date(year, mon, int(m.group(1))).isoformat()
                if not last:
                    return found
        except (StopIteration, ValueError):
            continue
    return found


def body_of(text, notice_type):
    for body, rx in BODY_WORDS:
        if rx.search(text):
            if body == 'local-government' and notice_type in ('return-of-members', 'writ-or-vacancy') and re.search(r'Parliament', text):
                continue
            return body
    return None


# ---------------------------------------------------------------------------------------------
# Page numbers: the Gazette's printed page numbers run on through the year; the text layer gives
# them in the running head. Vote on (printed - index) across an issue's pages.

HEAD_DATE = re.compile(r'GAZETTE[\W_]{0,6}(' + MONTH_RE + r')[\W_]{0,4}(\d{1,2})[\W_]{1,4}(1\s?9\s?\d\s?\d|20\d\d)', re.I)


def running_head_date(page_texts):
    """The issue date from the running heads ('THE BELFAST GAZETTE, JUNE 22, 1923.'), by vote across pages;
    the crawler's front-page date is sometimes misread."""
    votes = collections.Counter()
    for t in page_texts[1:]:
        m = HEAD_DATE.search(t[:200])
        if not m:
            continue
        try:
            mon = next(i for i, mm in enumerate(MONTHS) if m.group(1).lower().startswith(mm[:3].lower())) + 1
            votes[datetime.date(int(re.sub(r'\D', '', m.group(3))), mon, int(m.group(2))).isoformat()] += 1
        except (StopIteration, ValueError):
            continue
    if not votes:
        return None
    best, n = votes.most_common(1)[0]
    return best if n >= 2 or len(votes) == 1 else None


def text_layer_kind(pdf_path, page_index):
    """'ocr' when the page is a scanned image with an OCR text layer, 'digital' when its text is typeset."""
    try:
        import pymupdf
        page = pymupdf.open(pdf_path)[page_index]
        area = page.rect.width * page.rect.height
        for info in page.get_image_info():
            x0, y0, x1, y1 = info['bbox']
            if (x1 - x0) * (y1 - y0) > 0.5 * area:
                return 'ocr'
        return 'digital'
    except Exception:
        return None


def printed_page_numbers(page_texts):
    votes = collections.Counter()
    for i, t in enumerate(page_texts):
        lines = [l.strip() for l in t.split('\n') if l.strip()]
        for line in lines[:4] + lines[-3:]:
            m = re.fullmatch(r"[^\w]{0,2}(\d{1,4})[.\-]?", line)
            if m:
                n = int(m.group(1))
                if 1 <= n <= 5000 and not (1918 <= n <= 2030):
                    votes[n - i] += 1
    if not votes:
        return [None] * len(page_texts)
    offset, count = votes.most_common(1)[0]
    if count < 2 and len(page_texts) > 2:
        return [None] * len(page_texts)
    return [offset + i if offset + i >= 1 else None for i in range(len(page_texts))]


# ---------------------------------------------------------------------------------------------
# Parsers. Each takes the flattened notice text and returns a dict of fields (no addresses).

CAUSE_RE = re.compile(r'(deceased|dec[ea]a?sed|w\w{1,2}\s+ha(?:th|s)\s+(?:been\s+)?(?:accepted|appointed|resigned|succeeded|called)[^.;]{0,160}|'
                      r'resigned|who\s+has\s+become\s+a\s+Peer[^.;]{0,80}|whose\s+election\s+has\s+been\s+declared\s+void[^.;]{0,80}|'
                      r'disqualified[^.;]{0,80}|who\s+has\s+been\s+elected[^.;]{0,80})', re.I)


def classify_cause(text):
    t = (text or '').lower()
    if 'deceased' in t or 'death' in t or 'died' in t:
        return 'death'
    if 'peer' in t or 'succeeded' in t or 'called up' in t:
        return 'peerage'
    if 'resign' in t or 'chiltern' in t or 'northstead' in t or 'stewardship' in t:
        return 'resignation'
    if 'accepted' in t or 'appointed' in t or 'office' in t:
        return 'appointment'
    if 'void' in t:
        return 'election-void'
    if 'disqualif' in t:
        return 'disqualification'
    return 'unknown' if t else None


DIRECTIONS = r'(?:East|West|North|South|Mid|Central|North[- ]East|North[- ]West|South[- ]East|South[- ]West)'


def tidy_constituency(s):
    s = clean_ws(re.sub(r"[^A-Za-z'&,.\- ]", ' ', s))
    s = re.sub(r"(?<![A-Za-z])'|'(?![A-Za-z])", ' ', s)
    s = re.sub(r'^(?:[A-Za-z]\s+)+(?=[A-Z][a-z])', '', s)
    s = clean_ws(s).strip(' ,.:;-')
    # 'County of Down, West Down Division' -> 'West Down'; 'Borough of Belfast, East Division' -> 'Belfast East';
    # 'Antrim, Mid Division' -> 'Mid Antrim'.
    m = re.search(r"([A-Z][\w']+(?:\s+[A-Z][\w']+){0,3})\s+Division", s)
    if m:
        div = m.group(1)
        if re.fullmatch(DIRECTIONS, div):
            area = re.search(r"(?:County|Borough|City|County\s+Borough)\s+of\s+(?:the\s+City\s+of\s+)?([A-Z][\w']+)", s) or re.search(r"([A-Z][\w']+)\s*,", s)
            if area:
                name = area.group(1)
                return f'{name} {div}' if name == 'Belfast' else f'{div} {name}'
        return div
    return s


RANKS = re.compile(r"^(?:(?:the\s+)?(?:Right\s+Hon(?:ourable|\.)?|Rt\.?\s+Hon\.?|Hon(?:ourable|\.)?|Most\s+Hon\.?|Field[- ]Marshal|"
                   r"(?:Lt\.?|Lieut\.?|Lieutenant)[- .]*(?:Colonel|Col\.?|Commander|General)|Colonel|Col\.|Major(?:[- ]General)?|Captain|Capt\.|"
                   r"Brigadier(?:[- ]General)?|General|Admiral|Commander|Rev\.?|Reverend|Very\s+Rev\.?|Professor|Prof\.|Dr\.?|Doctor|Mr\.?|Mrs\.?|Miss|"
                   r"Sir|Dame|Lady|Lord|Viscount|Earl|Marquess|Alderman|Councillor)\s+)+", re.I)


def fix_case(s):
    """Title-case a name or heading printed in capitals; leave mixed case alone."""
    letters = re.sub(r'[^A-Za-z]', '', s)
    if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.8 and len(letters) > 3:
        s = s.title()
        s = re.sub(r"\bMc([a-z])", lambda m: 'Mc' + m.group(1).upper(), s)
        s = re.sub(r"\bMac([a-z])(?=[a-z]{3})", lambda m: 'Mac' + m.group(1).upper(), s)
        s = re.sub(r"\b(Of|And|The|In)\b", lambda m: m.group(1).lower(), s)
        s = re.sub(r"'S\b", "'s", s)
    return s


def bare_name(printed):
    """The name without ranks, styles and honours: 'Lt.-Colonel Philip James Woods' -> 'Philip James Woods'."""
    s = re.sub(r"(?<![A-Za-z])'|'(?![A-Za-z])", '', printed)
    s = re.sub(r'\b(Honourable|Hon\.?)-', r'\1 ', s)
    s = RANKS.sub('', s).strip()
    s = re.sub(r"^\S*(?:Colonel|General|Commander|Marshal|Admiral)\s+(?:Sir\s+)?", '', s).strip()
    return s or printed


def repair_name(s):
    s = re.sub(r"\bM'\s+(?=[A-Z])", "M'", s)
    s = re.sub(r"\bM\s+'(?=[A-Z])", "M'", s)
    s = re.sub(r'(?<=[a-z])\s+([a-z]{1,3})$', r'\1', s)    # 'Connie k' -> 'Conniek' (still flagged), 'Beat tie' -> 'Beattie'
    s = re.sub(r'(?<=\w)-\s+(?=[A-Z])', '-', s)            # 'Lennox- Conyngham'
    return s


def member_entry(const, printed, extra=None):
    printed = repair_name(fix_case(strip_name(printed)))
    e = {'constituency_printed': tidy_constituency(fix_case(const)) if const else '', 'name_printed': printed, 'name': bare_name(printed)}
    e.update(extra or {})
    e['ocr_flags'] = sorted(set(ocr_flags_for_name(e['name']) + ['pred:' + f for f in ocr_flags_for_name(e.get('predecessor') or 'Xxxx Xxxx')]))
    return e


HEADING_LINE = re.compile(r"^(?:(?:COUNTY|BOROUGH|CITY|COUNTY\s+BOROUGH|UNIVERSITY)\b.*|QUEEN.S\s+UNIVERSITY.*|IRELAND\.?|NORTHERN\s+IRELAND\.?|"
                          r"[A-Z][\w']+(?:\s+[A-Z][\w']+){0,3}\s+(?:Division|DIVISION)\.?|[A-Z][A-Z' .\-]{3,60})$")
PROSE = re.compile(r"\b(?:the|this|day|was|were|has|have|pleased|his|her|that|which|shall|by|for|with|to|on|at)\b")
NAME_HINT = re.compile(r"Esq|Bart|Baronet|Knight|K\.C|K\.B\.E|Sir\b|Hon\b|Hon\.|Colonel|Captain|Major|Lieut|Professor|Dr\.|Rev|Mrs?\.|Miss|"
                       r"D\.S\.O|M\.C\.|D\.L|O\.B\.E|C\.B\.E|LL\.D|M\.D", re.I)


def parse_general_list(lines):
    """Lines of a general-election return under place headings, in the two layouts the Gazette used:
    'COUNTY OF ANTRIM.' / 'East Belfast Division.' headings (Crown Office, Westminster) and
    'BELFAST BOROUGH (East Division)—' / 'ANTRIM COUNTY—' headings (Stormont), names one to a line
    ending in a full stop or run together with 'and'."""
    members, county, division, buf = [], '', '', []

    def place_now():
        if division and county:
            if re.fullmatch(DIRECTIONS, division):
                return f'{county}, {division} Division'
            return f'{division} Division' if county.split()[-1].lower() in division.lower() else f'{county}, {division} Division'
        return f'{division} Division' if division else county

    def flush():
        nonlocal buf
        text = join_lines('\n'.join(buf))
        buf = []
        if not text:
            return
        place = place_now()
        inline = re.match(r"^(?P<d>[A-Z][\w'. ]{1,40}?)\s*\.?\s+Div\w*\.?\s*-+\s*(?P<n>.+)$", text.replace('\u2014', '-').replace('\u2013', '-'))
        if inline:
            div = fix_case(clean_ws(inline.group('d').replace('.', ' ')))
            if re.fullmatch(DIRECTIONS, div) and county:
                place = f'{county}, {div} Division'
            elif county and county.split()[-1].lower() not in div.lower() and county != 'Belfast':
                place = f'{div} Division' if re.search(r'\b' + re.escape(county) + r'\b', div) else f'{div} Division ({county})'
            else:
                place = f'Belfast {div}' if county == 'Belfast' else f'{div} Division'
            text = inline.group('n')
        for part in re.split(r',?\s+and\s+(?=(?:the\s+)?[A-Z])|;\s*', text):
            if len(re.sub(r'[^A-Za-z]', '', part)) >= 5 and len(strip_name(part).split()) >= 2:
                members.append(member_entry(place, part))

    def county_name(text):
        t = clean_ws(re.sub(r'[^A-Za-z\' ,]', ' ', text))
        t = re.sub(r'^(?:COUNTY\s+BOROUGH|COUNTY|BOROUGH|CITY|COUNTIES)\s+OF\s+(?:THE\s+CITY\s+OF\s+)?', '', t, flags=re.I)
        t = re.sub(r',?\s*(?:COUNTY|COUNTIES|BOROUGH|COUNTY BOROUGH)(?:\s+OF)?$', '', t, flags=re.I)
        return fix_case(t.strip(' ,'))

    pending_heading = ''
    for raw in lines:
        dashed = clean_ws(raw).replace('\u2014', '-').replace('\u2013', '-')
        dashed = re.sub(r'^[a-z](?=[A-Z])', '', re.sub(r'^[^A-Za-z]+', '', dashed))
        line = dashed.strip(' .:-')
        if not line:
            continue
        if re.match(r'^(?:This day|Council Chamber|By the|Given at|Dated|NOTICE|Ministry|MINISTRY|Whitehall|At the Court|WHEREAS|Whereas|'
                    r'NOW|Now,? therefore|IT IS|PRESENT|ORDER|In pursuance|The Lord|His Excellency|His Grace|Crown Office|Office of)', line):
            break
        if re.match(r'^(?:THE\s+)?BELFAST\s+GAZETTE|^\d{1,4}$', line, re.I):
            continue
        if re.search(r'\b(?:ACTS?|ORDERS?|RULES|REGULATIONS|NOTICE|MINISTRY|SCHEDULE|LIST|COMMISSION|COURT|ESTATE|PURCHASE)\b', line.upper()) \
                and (line.isupper() or re.search(r'\bList\s+No\b', line, re.I)):
            break
        if len(' '.join(buf)) > 400:
            break
        # Stormont layout: 'BELFAST BOROUGH (East Division)-', 'ANTRIM COUNTY-', 'FERMANAGH AND TYRONE, COUNTIES' + 'OF-'
        hm = re.match(r"^([A-Z][A-Z' .,]{2,60}?)\s*(?:\(([^)]*)\))?\s*-+$", dashed)
        if hm or (pending_heading and re.fullmatch(r'OF\s*-*', dashed)):
            flush()
            if hm:
                county = county_name(pending_heading + ' ' + hm.group(1) if pending_heading else hm.group(1))
                division = fix_case(re.sub(r'\s*Division\s*$', '', hm.group(2) or '', flags=re.I))
            else:
                county = county_name(pending_heading)
                division = ''
            pending_heading = ''
            continue
        if re.search(r'Division$', line, re.I) and len(line) < 60:
            flush()
            division = fix_case(re.sub(r'\s*Division$', '', line, flags=re.I))
            division = re.sub(r'\s+Belfast$', '', division) if county.endswith('Belfast') else division
            continue
        if line.isupper() and len(line) < 70 and not NAME_HINT.search(line):
            flush()
            if re.fullmatch(r'(?:NORTHERN\s+)?IRELAND|ENGLAND|SCOTLAND|WALES', line):
                continue
            if re.search(r'COUNTIES$|,$', line):
                pending_heading = line
                continue
            county = county_name(line)
            division = ''
            continue
        if len(PROSE.findall(line)) >= 3 and not NAME_HINT.search(line):
            break
        buf.append(raw)
        # One name a line, ending in a full stop (not a bare title or initial).
        if dashed.endswith('.') and not re.fullmatch(r"(?:Mrs?|Miss|Dr|Sir|Rev|[A-Z])\.?", line):
            flush()
        if len(members) > 120:
            break
    flush()
    return members


# Entry layout of the general-election lists, 1929 onwards (Westminster and Stormont):
#   'Borough of Belfast (North Division)—Thomas Somerset, Esquire.'      (Westminster 1929-45)
#   '1. North Antrim—Henry Maitland Clark, Esquire.'  '1. North Antrim: ...'  (Westminster 1950-70)
#   'BALLYNAFEIGH DIVISION—The Right Honourable Ivan Neill.'             (Stormont 1958)
#   'Ballynafeigh Constituency—...' under 'Borough of Belfast'           (Stormont 1965)
#   'Ballynafeigh Constituency' on its own line, the member below it    (Stormont 1969)
# and the heading-and-names layout of 1922-25 ('COUNTY OF ANTRIM.' / 'BELFAST BOROUGH (East
# Division)—' with the members one to a line), which parse_general_list also reads.
ENTRY_SEP = re.compile(r'\s*(?:-?[—–]+(?:\s*-)?|\s-\s|-1[—–]|:(?=\s*[A-Z]))\s*')
PLACE_WORD = re.compile(r"\b(?:Division|Constituency|Borough|County|Counties|University|City)\b", re.I)
PLACE_HEADING = re.compile(r"(?:Parliamentary\s+)?(?:County\s+Borough|County|Borough|City|Counties)\s+o[fp]\s+(?:the\s+City\s+of\s+)?"
                           r"[A-Za-z' ]{3,40}|Queen.?s\s+Univers\w*\s*\.?\s*of\s+Belfast?", re.I)  # 'BOROUGH OP BELFAST'
SECTION_HEADING = re.compile(r"(?:County|Borough)\s+Constituencies", re.I)
DIVISION_HEADING = re.compile(r"[A-Z][\w'.\- ]{1,50}?\s+(?:Division|Constituency)", re.I)
LIST_STOP = re.compile(r"^(?:This day|Council Chamber|By the|Given at|Dated|NOTICE|Notice|Ministry|MINISTRY|Whitehall|At the Court|"
                       r"WHEREAS|Whereas|NOW|Now,? therefore|IT IS|PRESENT|ORDER|In pursuance|His Excellency|His Grace|Crown Office|"
                       r"CROWN OFFICE|Office of|OFFICE OF|I,\s|H\.\s?M\.|STATUTORY|THE MINISTRY|IN THE\b|SUPREME|CIVIL SERVICE|Senators?\s+elected|"
                       r"L\.\s?\d|\d{1,2}(?:st|nd|rd|th)\s+[A-Z][a-z]+,?\s+(?:1[89]|20)\d\d|Privy\s+Council|[A-Z][a-z]+\s+Office\b|Board\s+of\s)")
TITLE_END = re.compile(r"(?:\b(?:Hon|Rt|Lt|Col|Capt|Rev|Dr|Mr|Mrs|St|Prof|Gen|Maj|Brig|Lieut|Cdr)\.|(?:^|\s)[A-Z]\.)$")
HONOURS_START = re.compile(r"^(?:(?:[A-Z][a-zA-Z]?\.\s?){1,4}(?:,|$|\s)|Esq|Bart|Baronet|K\.|Knight)")
MEMBER_SPLIT = re.compile(r",?\s+and\s+(?=(?:the\s+)?[A-Z])|;\s*|,\s+(?=(?:Lt|Lieut|Col|Colonel|Major|Captain|Capt|Sir|The\s+Right|Rev|Reverend|"
                          r"Mrs|Miss|Professor|Dr|Doctor)\b\.?\s*\S+\s+\S)")


def print_lines(lines):
    """Rejoin print lines the text layer broke at wide justified spaces ('County \\nof \\nDown')."""
    out, cur = [], ''
    for raw in lines:
        cur += raw
        if raw.strip() and raw.endswith((' ', '\t')):
            continue
        out.append(cur)
        cur = ''
    if cur:
        out.append(cur)
    return out


def ends_name(line):
    """A line that ends a member's entry: a full stop not closing a title or a lone initial."""
    tail = re.sub(r"[\s'\"]+$", '', line)
    return tail.endswith('.') and not TITLE_END.search(tail)


def place_like(p):
    p = p.strip(" .,:;'\"-")
    if not p or NAME_HINT.search(p) or re.search(r'\bEsq|\bHonourable\b', p, re.I) or len(p.split()) > 9:
        return False
    if PLACE_WORD.search(p):
        return True
    words = [w for w in p.split() if w[0].isalpha()]
    return 0 < len(words) <= 5 and all(w[0].isupper() or w.lower() in ('and', 'of', 'the') for w in words)


def heading_area(text):
    t = clean_ws(re.sub(r"[^A-Za-z' ]", ' ', text))
    t = re.sub(r'^(?:Parliamentary\s+)?(?:County\s+Borough|County|Borough|City|Counties)\s+o[fp]\s+(?:the\s+City\s+of\s+)?', '', t, flags=re.I)
    return fix_case(t.strip())


def entry_place(area, place):
    """'CENTRAL DIVISION' under 'COUNTY OF ARMAGH' -> 'Central Armagh'; 'Clifton Constituency' under
    'Borough of Belfast' -> 'Belfast Clifton'; 'Borough of Belfast (North Division)' stands alone."""
    p = fix_case(clean_ws(place).strip(' .,:;-'))
    core = re.sub(r'\s*\b(?:Division|Constituency)\b\.?$', '', p, flags=re.I).strip(' .,')
    core = re.sub(r'^(North|South|East|West|Mid)-(?=[A-Z])', r'\1 ', core)  # 'Mid-Antrim Division'
    if not area or PLACE_WORD.search(core) or area.lower() in core.lower():
        return core
    if re.fullmatch(DIRECTIONS, core):
        return f'Belfast {core}' if area == 'Belfast' else f'{core} {area}'
    return f'Belfast {core}' if area == 'Belfast' else core


def parse_entry_list(lines):
    """Members of a general-election return, entry by entry (see the layouts above)."""
    blocks, area, cur, stray = [], '', None, 0
    for raw in print_lines(lines):
        s = clean_ws(raw).replace('–', '—')
        s = re.sub(r'^(?:\(?[a-zA-Z]\)\s*)', '', re.sub(r'^[^A-Za-z(\d]+', '', s))
        numbered = bool(re.match(r'\d{1,2}\s*[.,]', s))
        s = re.sub(r'^\d{1,2}\s*[.,]\s*', '', s)
        s = re.sub(r'\b(Divis)\W+(ion)\b', r'\1\2', s, flags=re.I)  # 'DUNCAIRN DIVIS.ION'
        t = s.strip(' .:;,\'"—-')
        if not t or re.fullmatch(r'\d{1,4}', t) or re.match(r'(?:THE\s+)?BELFAST\s+GAZETTE', t, re.I):
            continue
        if re.fullmatch(r'(?:NORTHERN\s+)?IRELAND|ENGLAND|SCOTLAND|WALES', t, re.I):
            continue
        open_entry = cur is not None and cur['lines'] and not re.search(r'[.]\W*$', cur['lines'][-1])
        if LIST_STOP.match(t) and not (open_entry and re.match(r'(?:Notice|NOTICE)$', t)):
            break
        if re.search(r'\b(?:ACTS?|ORDERS?|RULES|REGULATIONS|NOTICE|MINISTRY|SCHEDULE|LIST|COMMISSION|COURT|ESTATE|PURCHASE|TREASURY)\b', t.upper()) \
                and t.isupper():
            break
        if len(PROSE.findall(t)) >= 3 and not NAME_HINT.search(t):
            break
        if SECTION_HEADING.fullmatch(t):
            area, cur = '', None
            continue
        m = ENTRY_SEP.search(s)
        if m and ':' in m.group(0) and not numbered:  # 'John W: Kennedy' is not 'Place: Name'
            m = None
        if m and m.start() > 0:
            pre, rest = s[:m.start()], s[m.end():]
            # A name ending and the next place run together on one line ('Esquire. Borough of ...').
            lead = ''
            cut = list(re.finditer(r"(?<!\bSt)(?<!\b[A-Z])\.\s+(?=[A-Z(])", pre))
            if cut and not place_like(pre):
                lead, pre = pre[:cut[-1].start() + 1], pre[cut[-1].end():]
            if place_like(pre) and not (rest == '' and ':' in m.group(0)):
                if lead and cur is not None:
                    cur['lines'].append(lead)
                if PLACE_HEADING.fullmatch(pre.strip(' .')) and not re.search(r'\(', pre):
                    area_here = ''
                else:
                    area_here = area
                cur = {'area': area_here, 'place': pre, 'lines': [rest] if rest.strip() else []}
                blocks.append(cur)
                continue
        if PLACE_HEADING.fullmatch(t) and not open_entry:
            area = '' if re.search(r'University', t, re.I) else heading_area(t)
            cur = {'area': '', 'place': t, 'lines': []}
            blocks.append(cur)
            continue
        if DIVISION_HEADING.fullmatch(t) and len(t.split()) <= 6:
            cur = {'area': area, 'place': t, 'lines': []}
            blocks.append(cur)
            continue
        if cur is None:
            stray += 1
            if stray > 3:
                break
            continue
        if t.isupper() and len(t.split()) >= 2 and not open_entry and not NAME_HINT.search(t) and not re.search(r'ESQ', t):
            break
        cur['lines'].append(s)
        if sum(len(b['lines']) for b in blocks) > 250:
            break
    members = []
    for b in blocks:
        names, buf = [], []
        for i, line in enumerate(b['lines']):
            # (Not after a lone forename: 'Foyle Constituency—Edward' / 'Esquire.' / 'Gerard McAteer,'.)
            if buf and ends_name(buf[-1]) and not HONOURS_START.match(line) \
                    and len(strip_name(join_lines('\n'.join(buf))).split()) >= 2:
                names.append(buf)
                buf = []
            buf.append(line)
        if buf:
            names.append(buf)
        place = entry_place(b['area'], b['place'])
        for chunk in names:
            text = join_lines('\n'.join(chunk))
            text = re.sub(r'\b(Right)\s*[,.\-]+\s*(Hon)', r'\1 \2', text)  # 'The Right, Honourable'
            text = re.sub(r'\b(Honourable)[.,](?=\s)', r'\1', text)        # 'The Right Honourable. Sir'
            text = re.sub(r'\b(Sir|Captain|Major|Colonel|Doctor|Professor|Reverend)\s*,\s+(?=[A-Z])', r'\1 ', text)  # 'Sir, Basil'
            text = re.sub(r'(?<=\s[A-Z]):(?=\s)', '.', text)                  # 'John W: Kennedy'
            # The text layer sometimes sets 'Esquire.' inside the name ('Edward Esquire. Gerard McAteer').
            text = re.sub(r'\bEsq(?:uire)?\b\.?,?\s+(?=[A-Z][a-z]+\s+(?:Mc|Mac|O\')?[A-Z])', '', text)
            for part in MEMBER_SPLIT.split(text):
                if len(re.sub(r'[^A-Za-z]', '', part)) >= 5 and len(strip_name(part).split()) >= 2 \
                        and not re.fullmatch(r'(?:Esq\w*|Bart\w*|Baronet)\W*', part.strip(), re.I):
                    members.append(member_entry(place, part))
        if len(members) > 120:
            break
    return members


def list_quality(members):
    score = 0.0
    for m in members:
        n, p = m.get('name') or '', m.get('constituency_printed') or ''
        if p and 1 <= len(n.split()) <= 6 and not re.search(r'Constituency|Division|County|Borough|Office|Council|place of', n, re.I) \
                and not m.get('ocr_flags'):
            score += 1
        else:
            score -= 0.5
    return score


# 'in the place of', 'in the room of', and text-layer readings: 'place-of', 'In th; place of', 'room .of'.
IN_PLACE_OF = r'in\W+th\w?\W+(?:place|room)\W*of\b'


def parse_return(raw, issue_year):
    """MEMBER(S)/Senator elected or returned to serve: a by-election return ('X, in the place of Y, deceased')
    or a general-election list under county / borough / division headings."""
    out = {'members': []}
    m = RETURN_ANCHOR.search(raw)
    if not m:
        return out
    head, rest = raw[:m.start()], raw[m.end():]
    out['notice_date'] = parse_date_text(join_lines(head[-200:]), issue_year, last=True) if head else None
    anchor_flat = join_lines(raw[m.start():m.end() + 160])
    out['house'] = 'senate' if re.match(r'Senat', anchor_flat, re.I) else 'commons'
    general = re.search(r'General\s+Elec\w*', anchor_flat, re.I)  # 'General Electon' (1966)
    flat = join_lines(rest[:ANCHOR_SPAN])
    by = re.search(IN_PLACE_OF, flat[:1500], re.I)
    out['by_election'] = bool(by and not general)
    if general:
        gm = re.search(r'General\s+Elec\w*,?\s*(?:held\s+(?:on|in)\s+)?(?:the\s+)?(.{0,40})', anchor_flat, re.I)
        out['general_election_printed'] = clean_ws(re.sub(r'[^\w ,]', ' ', gm.group(1))).strip(' ,') if gm else ''
        ym = re.search(r'(?:1[89]|20)\d\d\W*?\n', rest[:200])
        lines = rest[ym.end():].split('\n') if ym else rest.split('\n')
        old, new = parse_general_list(lines), parse_entry_list(lines)
        out['members'] = new if list_quality(new) >= list_quality(old) else old
        return out
    if not out['by_election']:
        # One member and no predecessor: 'MEMBER elected to serve in the present Parliament / for the
        # County Constituency of Mid-Ulster. / Thomas James Mitchell, Esq.' (Mid Ulster, August 1955).
        sm = re.match(r"\W*for\s+the\s+(?:County|Borough)\s+Constituency\s+of\s+(?P<c>[^\n]+?(?:-\s*\n[^\n]+?)?)[.:;]+\s*\n(?P<n>[^\n]+)", rest)
        if sm and len(strip_name(sm.group('n')).split()) >= 2:
            out['members'] = [member_entry(join_lines(sm.group('c')), fix_case_mixed(sm.group('n')))]
            return out
        # A return without 'in the place of': a list with headings, or one member.
        out['members'] = parse_general_list(rest.split('\n'))
        return out
    pos = 0
    body_raw = rest[:ANCHOR_SPAN]
    for e in re.finditer(IN_PLACE_OF + r'\W*', body_raw, re.I):
        if e.start() < pos:
            continue
        # The entry ends at a line ending in a full stop that is not a title or a lone initial
        # ('the Right Hon.', 'J.'), though an honours string ('D.S.O.') may end it.
        tail = body_raw[e.end():e.end() + 400]
        endm = re.search(r'(?:(?<![A-Z])(?<!Hon)(?<!Rt)(?<!Lt)(?<!Col)(?<!Capt)(?<!Rev)(?<!Dr)(?<!Mr)(?<!Mrs)(?<!St)(?<!Sir)'
                         r'|(?<=[A-Z]\.[A-Z]))\.[ \t]*\n|;\s', tail)
        seg = join_lines(tail[:endm.start()] if endm else tail[:220])
        cm = re.search(r'(?:,\s*|\s+)(' + CAUSE_RE.pattern + r')', seg, re.I)
        pred_text, cause = (seg[:cm.start()], cm.group(1)) if cm else (seg, None)
        pre = join_lines(body_raw[pos:e.start()])
        pos = e.end() + (endm.end() if endm else len(seg))
        pre = re.sub(r'^[\s.,;:\-]*(?:(?:the\s+)?(?:present\s+)?(?:P\W{0,3}A\W{0,3}R\W{0,3}L\W{0,3}I\W{0,3}A\W{0,3}M\W{0,3}E\W{0,3}N\W{0,3}T|House\s+of\s+Commons)(?:\s+of\s+Northern\s+Ireland)?)?[^A-Za-z]*', '', pre, flags=re.I)
        pre = re.sub(r'^\s*of\s+Northern\s+Ireland[\s.:,;\-]*', '', pre, flags=re.I)
        pre = ' '.join(t for t in pre.split() if not re.search(r'[&$#@%*\u00a3]', t))
        pre = re.sub(r"[\s.,;:\-]+['\"]+\s*", ': ', pre)
        pre = fix_case_mixed(pre)
        # Westminster returns from 1950: "for the Borough Constituency of Belfast West: JOHN SMITH".
        pre = re.sub(r'^\s*for\s+(?:the\W+)?', '', pre, flags=re.I)
        pre = re.sub(r'\bMid-\s*(?=Ulster)', 'Mid ', pre, flags=re.I)  # not 'Mid' - 'Ulster: GEORGE FORREST'
        cons = re.match(r'^(?:(?:Borough|County|Parliamentary)\W+)?Constituency\s+of\s+(?P<c>[^:]+?)\s*[:;,.\-]+\s*(?P<n>[A-Z].*)$',
                        pre.strip(), re.S | re.I)
        split = cons or re.search(r"^(?P<c>.*(?:Division|Borough|University|Burghs?|Constituency|County\s+of\s+[A-Z][a-z]+|City\s+of\s+[A-Z][a-z]+|"
                          r"Queen.s\s+University\s+of\s+Belfast)\)?)[\s.,:;\-]+(?P<n>[A-Z].*)$", pre.strip(), re.S | re.I)
        if out['house'] == 'senate':
            const, member = '', re.sub(r'^.*?(?:Senator|SENATOR)\W+', '', pre)
        elif split:
            const, member = split.group('c'), split.group('n')
        else:
            parts = re.split(r'[.:]\s+(?=[A-Z])', pre.strip(), maxsplit=1)
            const, member = (parts[0], parts[1]) if len(parts) == 2 else ('', parts[0])
        pred = fix_case(strip_name(pred_text))
        out['members'].append(member_entry(const, member, {
            'predecessor': bare_name(pred), 'predecessor_printed': pred,
            'vacancy_cause_printed': clean_ws(cause)[:160] if cause else None,
            'vacancy_cause': classify_cause(cause) if cause else 'not printed'}))
        if len(out['members']) > 40:
            break
    seen, uniq = set(), []
    for mem in out['members']:
        key = (mem['constituency_printed'], mem['name'])
        if key not in seen:
            seen.add(key)
            uniq.append(mem)
    out['members'] = uniq
    return out


def fix_case_mixed(s):
    """Title-case runs of capitals (BOROUGH OF BELFAST (WEST DIVISION). LT.-COLONEL PHILIP ...) inside mixed text."""
    return re.sub(r"\b[A-Z][A-Z'.\-]+(?:[\s(),]+[A-Z][A-Z'.\-]+)+\b", lambda m: fix_case(m.group(0)), s)


def parse_writ(text, issue_year):
    """Speaker's warrant / notice of a new writ: constituency, predecessor, cause."""
    out = {}
    m = re.search(r'(?:election|electing)\s+of\s+(?:a\s+)?(?:Member|Members|Burgess)\s+(?:to\s+serve\s+in\s+(?:the\s+)?(?:present\s+)?'
                  r'(?:Parliament|House\s+of\s+Commons)[^,]{0,60}?\s+)?for\s+(?:the\s+)?(?P<c>.{3,120}?)\s+in\s+the\s+room\s+of\s+'
                  r'(?P<p>.+?)(?:,\s*|\s+)(?P<cause>' + CAUSE_RE.pattern + r')', text, re.I | re.S)
    if m:
        out['constituency_printed'] = tidy_constituency(m.group('c'))
        out['predecessor'] = strip_name(m.group('p'))
        out['vacancy_cause_printed'] = clean_ws(m.group('cause'))[:160]
        out['vacancy_cause'] = classify_cause(m.group('cause'))
    dates = [parse_date_text(text[d.start():d.start() + 60], issue_year) for d in re.finditer(r'\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?(?:' + MONTH_RE + r')', text)]
    out['dates_mentioned'] = [d for d in dates if d][:4]
    return out


def parse_generic_vacancy(text, issue_year):
    out = {}
    m = re.search(r'(?:office\s+of\s+)?(?P<role>councillor|alderman)s?\s+(?:for|of)\s+(?:the\s+)?(?P<c>.{3,120}?)'
                  r'(?:\s+(?:is|has\s+become|became)\s+vacant|\s+by\s+reason|\s*,\s*vacant)', text, re.I | re.S)
    if m:
        out['role'] = m.group('role').title()
        out['ward_or_area_printed'] = tidy_constituency(m.group('c'))
    m = re.search(r'(?:death|resignation|disqualification)\s+of\s+(?P<n>[A-Z][A-Za-z.\' \-]{3,60}?)(?:,|\s+(?:the|a|who|late))', text)
    if m:
        out['predecessor'] = strip_name(m.group('n'))
        out['vacancy_cause'] = classify_cause(text[m.start():m.start() + 20])
    m = re.search(r'(?P<council>[A-Z][A-Za-z\' ]{2,60}?(?:District|Borough|Urban\s+District|Rural\s+District|County|City)\s+Council)', text)
    if m:
        out['council_printed'] = clean_ws(m.group('council'))
    return out


def parse_petition(text, issue_year):
    out = {}
    m = re.search(r'(?:election|return)\s+(?:of\s+a\s+Member\s+)?for\s+(?:the\s+)?(?P<c>.{3,100}?)\s+(?:held|on|which)', text, re.I | re.S)
    if m:
        out['constituency_printed'] = tidy_constituency(m.group('c'))
    m = re.search(r'Petitioners?[,:\s]+(?:and\s+)?(?P<n>.{3,200}?)\s+Respondents?', text, re.S)
    if m:
        out['parties_printed'] = [strip_name(x) for x in re.split(r'\s+and\s+|,\s+', m.group('n')) if strip_name(x)][:6]
    out['election_date'] = parse_date_text(text, issue_year)
    return out


# --- Table notices (statements of persons nominated, notices of poll, results, agents) --------------
# Read from the PDF word layout: find the header row, take the column x-ranges, and keep only the
# name, description and votes columns. Address columns are never read into the output.

HEADER_COLS = {
    'surname': re.compile(r'^surname', re.I),
    'other_names': re.compile(r'^other|^forenames?|^christian', re.I),
    'name': re.compile(r'^name', re.I),
    'address': re.compile(r'^(?:home|address|abode|place)', re.I),
    'description': re.compile(r'^description|^party', re.I),
    'votes': re.compile(r'^votes?|^number', re.I),
    'proposer': re.compile(r'^(?:proposer|names?\s+of\s+(?:proposer|signatories|subscribers))|^seconder|^subscribers?|^assentors?', re.I),
    'agent': re.compile(r'^agent|election\s+agent', re.I),
    'office': re.compile(r'^office', re.I),
    'decision': re.compile(r'^decision|^reason|^invalid', re.I),
}


def words_by_line(page, clip=None):
    words = page.get_text('words', clip=clip)
    lines = collections.defaultdict(list)
    for x0, y0, x1, y1, w, b, l, n in words:
        lines[(b, l)].append((x0, y0, x1, y1, w))
    out = []
    for key, ws in lines.items():
        ws.sort()
        out.append((min(w[1] for w in ws), ws))
    out.sort(key=lambda r: (round(r[0] / 3), r[1][0][0]))
    return out


def table_from_layout(pdf_path, page_index, anchor_text):
    """Rows of {surname, other_names, name, description, votes} from a table under a header with 'Surname'/'Name'."""
    try:
        import pymupdf
    except ImportError:
        return None
    try:
        doc = pymupdf.open(pdf_path)
        page = doc[page_index]
    except Exception:
        return None
    hits = page.search_for(anchor_text[:40]) if anchor_text else []
    top = hits[0].y0 if hits else 0
    # Column layout: the notice may sit in one column of a multi-column page; work in the column
    # that holds the anchor.
    col_x0, col_x1 = 0, page.rect.width
    if hits:
        mid = page.rect.width / 2
        if hits[0].x1 < mid + 10:
            col_x1 = mid + 5
        elif hits[0].x0 > mid - 10:
            col_x0 = mid - 5
    clip = pymupdf.Rect(col_x0, top, col_x1, page.rect.height)
    lines = words_by_line(page, clip)
    header = None
    for y, ws in lines[:80]:
        text = ' '.join(w[4] for w in ws)
        if re.search(r'\bSurname\b|\bName\s+of\s+candidate|\bCandidate\b', text, re.I):
            header = (y, ws)
            break
    if not header:
        return None
    # Column starts from header words, merging words that belong to one heading ("Other names").
    cols = []
    for x0, y0, x1, y1, w in header[1]:
        for key, rx in HEADER_COLS.items():
            if rx.match(w) and not any(c[1] == key for c in cols):
                cols.append((x0, key))
                break
    cols.sort()
    if not cols:
        return None
    rows = []
    for y, ws in lines:
        if y <= header[0] + 2:
            continue
        text = ' '.join(w[4] for w in ws)
        if re.search(r'^(?:Dated|Returning Officer|Chief Electoral|The persons above|The person opposite|Notice|\*|Signed)', text, re.I):
            break
        if re.search(r'Electoral\s+Office|Election\s+(?:of|for)\b|STATEMENT|NOTICE', text) and rows:
            break
        row = collections.defaultdict(list)
        for x0, y0, x1, y1, w in ws:
            key = cols[0][1]
            for cx, ck in cols:
                if x0 + 2 >= cx:
                    key = ck
            row[key].append(w)
        rows.append({k: ' '.join(v) for k, v in row.items()})
    # Merge continuation lines (no surname/name cell) into the previous row; never keep address/proposer cells.
    merged = []
    for r in rows:
        keep = {k: v for k, v in r.items() if k in ('surname', 'other_names', 'name', 'description', 'votes')}
        if not keep:
            continue
        if merged and not (keep.get('surname') or keep.get('name')):
            for k, v in keep.items():
                merged[-1][k] = clean_ws(merged[-1].get(k, '') + ' ' + v)
            continue
        merged.append(keep)
    return merged or None


def parse_table_notice(text, issue_year, pdf_path, page_index, anchor_text, notice_type):
    out = {}
    m = re.search(r'(?:ELECTION|Election)\s+(?:of\s+(?:a\s+)?(?:Members?|Councillors?|Representatives?)\s+)?(?:for|of|to)\s+(?:the\s+)?(?P<c>[A-Z][^\n]{3,140}?)(?=\s+(?:STATEMENT|NOTICE|The|Notice|I,|A\s+POLL|Statement)|\.|$)', text)
    if m:
        out['constituency_printed'] = tidy_constituency(m.group('c'))
    out['election_date'] = None
    pm = re.search(r'poll\s+will\s+be\s+(?:held|taken)\s+on\s+(?:\w+day,?\s+)?(?:the\s+)?(.{4,40})', text, re.I)
    if pm:
        out['election_date'] = parse_date_text(pm.group(1), issue_year)
    seats = re.search(r'(?:number\s+of\s+(?:members|councillors|seats)\s+to\s+be\s+elected\s+(?:is|was)\s+)(\w+)', text, re.I)
    if seats:
        out['seats_printed'] = seats.group(1)
    rows = table_from_layout(pdf_path, page_index, anchor_text) if pdf_path else None
    cands = []
    if rows:
        out['layout'] = 'pdf-words'
        for r in rows:
            sur = clean_ws(r.get('surname', ''))
            other = clean_ws(r.get('other_names', ''))
            name = clean_ws(r.get('name', '')) or clean_ws(f'{other} {sur.title() if sur.isupper() else sur}')
            desc = clean_ws(r.get('description', ''))
            if desc and ADDRESS_RE.search(desc) and not re.search(r'Party|Unionist|Labour|Alliance|Sinn|SDLP|Independent|Nationalist|Republican|Conservative|Liberal|Green|Workers|Democratic|Socialist|People', desc, re.I):
                desc = ''  # an address or occupation-with-address strayed into the column
            votes = re.sub(r'[^\d]', '', r.get('votes', '') or '')
            nm = strip_name(name)
            if not nm or len(nm) < 3:
                continue
            cands.append({'name': nm, 'surname': sur, 'other_names': other, 'description': desc,
                          'votes': int(votes) if votes else None, 'ocr_flags': ocr_flags_for_name(nm)})
    else:
        out['layout'] = 'text-only'
        # Fall back on declarations in running text: "<Name> (<Description>) .... 12,345"
        votes_ctx = re.search(r'votes', text, re.I) and re.search(r'elected', text, re.I)
        for vm in re.finditer(r"(?P<n>[A-Z][a-z'.]+(?:\s+[A-Z][A-Za-z'.\-]+){1,4})\s*(?:\((?P<d>[^)]{2,60})\))?[\s.]*?(?P<v>\d{1,3}(?:,\d{3})+|\d{2,6})\s*(?:votes)?(?=[\s.;])", text if votes_ctx else ''):
            nm = strip_name(vm.group('n'))
            if nm and not re.search(r'Electorate|Poll|Total|Rejected|Spoilt|Majority|Quota|Ward|Area|Division|Act|Section|Article|Regulation|Order|day|Dated', nm, re.I):
                cands.append({'name': nm, 'description': clean_ws(vm.group('d') or ''), 'votes': int(vm.group('v').replace(',', '')),
                              'ocr_flags': ocr_flags_for_name(nm)})
        if notice_type not in ('declaration-of-result',):
            cands = []
    out['candidates'] = cands
    elected = re.findall(r'(?:hereby\s+declare|declare)\s+(?:that\s+)?(?P<n>.{3,200}?)\s+(?:is|are|has\s+been|have\s+been)\s+(?:duly\s+)?elected', text, re.I | re.S)
    if elected:
        out['declared_elected'] = [strip_name(x) for x in re.split(r',\s+|\s+and\s+', elected[0]) if strip_name(x)][:12]
    for key, rx in (('electorate', r'electorate[^\d]{0,40}(\d[\d,]{2,9})'), ('rejected', r'(?:rejected|spoilt|spoiled)[^\d]{0,60}(\d[\d,]{0,7})'),
                    ('valid_poll', r'(?:valid\s+poll|total\s+(?:number\s+of\s+)?valid\s+votes)[^\d]{0,40}(\d[\d,]{2,9})'), ('quota', r'quota[^\d]{0,40}(\d[\d,]{1,9})')):
        mm = re.search(rx, text, re.I)
        if mm:
            out[key] = int(mm.group(1).replace(',', ''))
    if re.search(r'uncontested|unopposed|no\s+poll|deemed\s+to\s+be\s+elected|duly\s+elected\s+without', text, re.I):
        out['uncontested'] = True
    return out


def parse_agents(text, issue_year, pdf_path, page_index, anchor_text):
    """Election agents: candidate -> agent NAMES only."""
    out = {'agents': []}
    rows = None
    try:
        import pymupdf
        doc = pymupdf.open(pdf_path)
        page = doc[page_index]
        lines = words_by_line(page)
        cols, header_y = [], None
        for y, ws in lines:
            t = ' '.join(w[4] for w in ws)
            if re.search(r'Candidate', t, re.I) and re.search(r'Agent', t, re.I):
                header_y = y
                xs = [(w[0], w[4]) for w in ws]
                cand_x = next(x for x, w in xs if re.match(r'candidate|name', w, re.I))
                agent_x = next((x for x, w in xs if re.match(r'agent|election', w, re.I) and x > cand_x + 20), None)
                addr_x = next((x for x, w in xs if re.match(r'address|office', w, re.I) and (agent_x is None or x > agent_x)), None)
                cols = [(cand_x, 'candidate'), (agent_x, 'agent'), (addr_x, 'address')]
                cols = sorted(c for c in cols if c[0] is not None)
                break
        if header_y is not None and len(cols) >= 2:
            rows = []
            for y, ws in lines:
                if y <= header_y + 2:
                    continue
                t = ' '.join(w[4] for w in ws)
                if re.match(r'(?:Dated|Returning|Chief|Signed)', t):
                    break
                row = collections.defaultdict(list)
                for w in ws:
                    key = cols[0][1]
                    for cx, ck in cols:
                        if w[0] + 2 >= cx:
                            key = ck
                    row[key].append(w[4])
                if row.get('candidate') or row.get('agent'):
                    rows.append({'candidate': strip_name(' '.join(row.get('candidate', []))), 'agent': strip_name(' '.join(row.get('agent', [])))})
    except Exception:
        rows = None
    if rows:
        out['layout'] = 'pdf-words'
        out['agents'] = [r for r in rows if r['candidate'] or r['agent']][:60]
    else:
        out['layout'] = 'text-only'
        for m in re.finditer(r'(?P<a>[A-Z][A-Za-z.\' \-]{3,50}?)\s+(?:has\s+been\s+)?appointed\s+(?:as\s+)?(?:the\s+)?election\s+agent\s+(?:for|of)\s+(?P<c>[A-Z][A-Za-z.\' \-]{3,50}?)(?=[,.;]|\s+(?:a|the)\s+candidate)', text):
            out['agents'].append({'candidate': strip_name(m.group('c')), 'agent': strip_name(m.group('a'))})
    m = re.search(r'(?:ELECTION|Election)\s+(?:of\s+[^\n]{0,40}?)?(?:for|of)\s+(?:the\s+)?(?P<c>[A-Z][^\n]{3,100}?)(?=\s+(?:NOTICE|Notice|The|Names)|\.|$)', text)
    if m:
        out['constituency_printed'] = tidy_constituency(m.group('c'))
    return out


# ---------------------------------------------------------------------------------------------

def find_notices(issue, page_texts, page_numbers, issue_date, pdf_path):
    """All election notices in one issue."""
    year = int(issue_date[:4]) if issue_date else None
    starts = []  # (char offset in joined text, page index, type)
    joined = ''
    offsets = []
    for i, t in enumerate(page_texts):
        offsets.append(len(joined))
        joined += t + '\n\f\n'
    for ntype, rx in ANCHORS:
        for m in rx.finditer(joined):
            starts.append((m.start(), ntype, m.group(0)))
    starts.sort()
    # Drop anchors inside the span of an earlier anchor of a compatible type (e.g. 'number of votes
    # recorded' inside a declaration already anchored).
    picked = []
    for s in starts:
        if picked and s[1] != 'return-of-members' and s[0] - picked[-1][0] < 400 and (s[1] == picked[-1][1] or {s[1], picked[-1][1]} <= {'declaration-of-result', 'notice-of-poll', 'statement-of-persons-nominated'}):
            continue
        if picked and s[0] - picked[-1][0] < 1200 and s[1] == 'writ-or-vacancy' and picked[-1][1] == 'writ-or-vacancy':
            continue
        picked.append(s)
    notices = []
    for k, (pos, ntype, anchor) in enumerate(picked):
        end = min(picked[k + 1][0] if k + 1 < len(picked) else len(joined), pos + ANCHOR_SPAN)
        begin = max(0, pos - 400)
        # Back up to the notice's own heading (Crown Office, dated line) but not into the previous notice.
        prev_end = picked[k - 1][0] if k else 0
        begin = max(begin, prev_end + 1 if k else 0)
        raw = joined[begin:end]
        em = END_RE.search(raw, pos - begin + len(anchor) + 40)
        if em:
            raw = raw[:em.start()]
        page_index = max(i for i, o in enumerate(offsets) if o <= pos)
        flat = join_lines(raw)
        # The legislation (Acts, Rules, Orders) that mention 'election petition', 'returning officer'
        # etc. are not notices; skip windows that read as statute text.
        statute = len(re.findall(r'\bshall\b', flat[:2500])) >= 3 or re.search(r'\b(?:Section|Article|Regulation|Rule)\s+\d+.*\b(?:shall|may)\b', flat[:1500])
        if statute and ntype in ('election-petition', 'casual-vacancy', 'notice-of-poll', 'writ-or-vacancy', 'declaration-of-result'):
            if not re.search(r'in\s+the\s+room\s+of|duly\s+elected|persons\s+nominated', flat, re.I):
                continue
        rec = {
            'issue': issue, 'issue_date': issue_date, 'page_index': page_index,
            'page': page_numbers[page_index] if page_numbers else None,
            'type': ntype,
        }
        anchor_rel = flat.find(join_lines(anchor)[:20])
        if ntype == 'return-of-members':
            rec.update(parse_return(raw, year))
        elif ntype == 'writ-or-vacancy':
            rec.update(parse_writ(flat, year))
            if not rec.get('constituency_printed'):
                rec.update(parse_generic_vacancy(flat, year))
        elif ntype == 'casual-vacancy':
            rec.update(parse_generic_vacancy(flat, year))
        elif ntype == 'election-petition':
            rec.update(parse_petition(flat, year))
        elif ntype == 'election-agents':
            rec.update(parse_agents(flat, year, pdf_path, page_index, anchor))
        else:
            rec.update(parse_table_notice(flat, year, pdf_path, page_index, anchor, ntype))
        context = join_lines(joined[max(begin, pos - 250):pos + 500])
        rec['body'] = body_of(context, ntype)
        if ntype == 'return-of-members':
            # The words after "to serve in the present Parliament" decide the house: Stormont returns
            # say "of Northern Ireland", Westminster ones "for the ... Constituency" or "Imperial
            # Parliament". The heading does not: the Crown Office for Northern Ireland issued
            # Westminster returns and also the Stormont general-election lists of 1953-62.
            serve = re.search(r'(?:elected|returned)\s+to\s+serve\s+\w{1,3}\s+(?:the\s+)?(?:pres\w{1,3}\s+)?'
                              r'(Imperial\s+)?Parl\W*ia\W*ment(\W+of\s+Nor\W*thern\s+Ire\W*land)?', context, re.I)
            if rec.get('house') == 'senate':
                rec['body'] = 'senate-of-northern-ireland'
            elif serve and serve.group(2):
                rec['body'] = 'parliament-of-northern-ireland'
            elif serve and (serve.group(1) or re.search(r'[CG]r[o0G]wn\s+Office', context, re.I)):
                rec['body'] = 'house-of-commons-of-the-united-kingdom'
            elif re.search(r'Clerk\s+of\s+the\s+Crown\s+(?:and\s+Peace\s+)?for\s+Northern|'
                           r'Parliament\s+of\s+Northern\s+Ire\W*land', context, re.I):
                rec['body'] = 'parliament-of-northern-ireland'
            elif re.search(r'[CG]r[o0G]wn\s+Office', context, re.I):
                rec['body'] = 'house-of-commons-of-the-united-kingdom'
        if not rec.get('notice_date'):
            rec['notice_date'] = parse_date_text(flat[:300], year) or issue_date
        rec['text_layer'] = text_layer_kind(pdf_path, page_index) if pdf_path else None
        rec['confidence'] = confidence(rec)
        if rec['confidence'] == 'discard':
            continue
        notices.append(rec)
    return notices


def confidence(rec):
    t = rec['type']
    flags = []
    if t == 'return-of-members':
        ms = rec.get('members') or []
        if not ms:
            return 'low'
        flags = [f for m in ms for f in m.get('ocr_flags', [])]
        bad = sum(1 for m in ms if not m.get('name') or (rec.get('by_election') and not m.get('constituency_printed')))
        if bad:
            return 'low'
        return 'medium' if flags else 'high'
    if t == 'writ-or-vacancy':
        if rec.get('constituency_printed') and rec.get('predecessor'):
            return 'high' if not ocr_flags_for_name(rec['predecessor']) else 'medium'
        if rec.get('ward_or_area_printed'):
            return 'medium'
        return 'discard'
    if t in ('statement-of-persons-nominated', 'notice-of-poll', 'declaration-of-result'):
        c = rec.get('candidates') or []
        if c and rec.get('constituency_printed'):
            return 'medium' if any(x.get('ocr_flags') for x in c) or rec.get('layout') == 'text-only' else 'high'
        return 'low' if c or rec.get('declared_elected') else 'discard'
    if t == 'election-agents':
        return 'medium' if rec.get('agents') else 'low'
    if t == 'casual-vacancy':
        return 'medium' if rec.get('ward_or_area_printed') else 'discard'
    if t == 'election-petition':
        return 'medium' if rec.get('constituency_printed') else 'discard'
    return 'low'


def cite(rec):
    d = rec.get('issue_date')
    when = ''
    if d:
        dt = datetime.date.fromisoformat(d)
        when = f'{dt.day} {MONTHS[dt.month - 1]} {dt.year}'
    page = rec.get('page')
    rec['citation'] = f"Belfast Gazette, issue {rec['issue']}, {when}, p. {page if page else '?'}"
    rec['url'] = f"https://www.thegazette.co.uk/Belfast/issue/{rec['issue']}/page/{page}" if page else f"https://www.thegazette.co.uk/Belfast/issue/{rec['issue']}"
    return rec


# ---------------------------------------------------------------------------------------------
# Cache and driver

def open_cache(path):
    db = sqlite3.connect(path)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS done(issue INTEGER PRIMARY KEY, parser INTEGER, notices INTEGER, at TEXT);
      CREATE TABLE IF NOT EXISTS notices(issue INTEGER, seq INTEGER, json TEXT, PRIMARY KEY(issue, seq));
      CREATE TABLE IF NOT EXISTS misses(issue INTEGER, page_index INTEGER, phrase TEXT, PRIMARY KEY(issue, page_index, phrase));
    ''')
    return db


def parse_issues(db_path, pdf_dir, cache, wanted=None, full=False):
    src = sqlite3.connect(f'file:{Path(db_path).resolve().as_posix()}?mode=ro', uri=True)
    ok = [(r[0], r[1]) for r in src.execute("SELECT issue, date FROM issues WHERE status='ok' ORDER BY issue")]
    done = set() if full else {r[0] for r in cache.execute('SELECT issue FROM done WHERE parser=?', (PARSER_VERSION,))}
    todo = [(n, d) for n, d in ok if n not in done and (wanted is None or n in wanted)]
    gated = set()
    if todo:
        lo, hi = todo[0][0], todo[-1][0]
        gated = {r[0] for r in src.execute('SELECT DISTINCT p.issue FROM pages_fts JOIN pages p ON p.rowid = pages_fts.rowid '
                                           'WHERE pages_fts MATCH ? AND p.issue BETWEEN ? AND ?', (FTS_GATE, lo, hi))}
    new_notices = 0
    for n, date in todo:
        notices = []
        if n in gated:
            texts = [r[0] or '' for r in src.execute('SELECT text FROM pages WHERE issue=? ORDER BY page_index', (n,))]
            pdf = pdf_dir / f'{n}.pdf'
            head_date = running_head_date(texts)
            notices = find_notices(n, texts, printed_page_numbers(texts), head_date or date, str(pdf) if pdf.exists() else None)
            for rec in notices:
                rec['issue_date_source'] = 'running-head' if head_date else ('crawler' if date else 'none')
                if head_date and date and head_date != date:
                    rec['crawler_date'] = date
        cache.execute('DELETE FROM notices WHERE issue=?', (n,))
        cache.execute('DELETE FROM misses WHERE issue=?', (n,))
        if n in gated:
            # Recall check: pages with a strong election phrase that yielded no notice.
            have = {rec['page_index'] for rec in notices}
            for i, t in enumerate(texts):
                if i in have:
                    continue
                flat = join_lines(t)
                for phrase in STRONG_PHRASES.findall(flat):
                    cache.execute('INSERT OR IGNORE INTO misses VALUES (?,?,?)', (n, i, phrase.lower()))
        for i, rec in enumerate(notices):
            cache.execute('INSERT INTO notices VALUES (?,?,?)', (n, i, json.dumps(cite(rec), ensure_ascii=False)))
        cache.execute('INSERT OR REPLACE INTO done VALUES (?,?,?,?)', (n, PARSER_VERSION, len(notices), datetime.datetime.now().isoformat(timespec='seconds')))
        new_notices += len(notices)
    cache.commit()
    last = src.execute("SELECT MAX(issue), MAX(date) FROM issues WHERE status='ok'").fetchone()
    return {'issues_ok': len(ok), 'parsed_now': len(todo), 'notices_now': new_notices, 'last_issue': last[0], 'last_issue_date': last[1]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dir', default=os.environ.get('CIVGRAPH_GAZETTE_DIR'), help='data folder (or set CIVGRAPH_GAZETTE_DIR)')
    ap.add_argument('--db', help='crawler database (default <dir>/gazette.sqlite)')
    ap.add_argument('--out', help='output folder (default <dir>/extracted)')
    ap.add_argument('--full', action='store_true', help='reparse every issue (ignore the cache)')
    ap.add_argument('--issues', help='only these issues, e.g. 30-400')
    ap.add_argument('--no-compare', action='store_true')
    args = ap.parse_args()
    if not args.dir and not (args.db and args.out):
        sys.exit('Set CIVGRAPH_GAZETTE_DIR (or give --dir, or --db and --out).')
    db_path = Path(args.db) if args.db else Path(args.dir) / 'gazette.sqlite'
    out = Path(args.out) if args.out else Path(args.dir) / 'extracted'
    pdf_dir = db_path.parent / 'pdf'
    out.mkdir(parents=True, exist_ok=True)
    cache = open_cache(out / 'election-notices-cache.sqlite')
    wanted = None
    if args.issues:
        a, _, b = args.issues.partition('-')
        wanted = set(range(int(a), int(b or a) + 1))
    run = parse_issues(db_path, pdf_dir, cache, wanted, args.full)
    notices = [json.loads(r[0]) for r in cache.execute(
        'SELECT n.json FROM notices n JOIN done d ON d.issue = n.issue AND d.parser = ? ORDER BY n.issue, n.seq', (PARSER_VERSION,))]
    with open(out / 'election-notices.jsonl', 'w', encoding='utf-8', newline='\n') as f:
        for n in notices:
            f.write(json.dumps(n, ensure_ascii=False) + '\n')
    summary = {
        'generated': datetime.datetime.now().isoformat(timespec='seconds'), 'parser_version': PARSER_VERSION, 'run': run,
        'issues_parsed': cache.execute('SELECT COUNT(*) FROM done WHERE parser=?', (PARSER_VERSION,)).fetchone()[0],
        'notices': len(notices),
        'by_type': dict(collections.Counter(n['type'] for n in notices)),
        'by_type_confidence': {f'{k[0]}/{k[1]}': v for k, v in sorted(collections.Counter((n['type'], n['confidence']) for n in notices).items())},
        'by_body': dict(collections.Counter(n.get('body') or 'unclear' for n in notices)),
        'by_decade': dict(sorted(collections.Counter((n.get('issue_date') or '????')[:3] + '0s' for n in notices).items())),
        'members_in_returns': sum(len(n.get('members') or []) for n in notices),
        'candidates_in_tables': sum(len(n.get('candidates') or []) for n in notices),
        'possible_misses_file': 'election-notices-possible-misses.json',
    }
    misses = [{'issue': i, 'page_index': p, 'phrases': ph} for i, p, ph in cache.execute(
            "SELECT m.issue, m.page_index, GROUP_CONCAT(m.phrase, '; ') FROM misses m JOIN done d ON d.issue = m.issue AND d.parser = ? "
            "GROUP BY m.issue, m.page_index ORDER BY m.issue", (PARSER_VERSION,))]
    summary['possible_misses'] = len(misses)
    (out / 'election-notices-possible-misses.json').write_text(json.dumps(misses, indent=0), encoding='utf-8')
    if not args.no_compare:
        rows = gazette_crosscheck.compare(notices, civgraph_elections.load(REPO))
        accessed = datetime.date.today().isoformat()
        props = gazette_crosscheck.proposals(rows, accessed)
        (out / 'election-crosscheck.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
        (out / 'election-fix-proposals.json').write_text(json.dumps({
            'schemaVersion': 1,
            'description': 'PROPOSALS ONLY, not applied. Belfast Gazette election notices checked against Civgraph '
                           '(data/elections-source with data/elections/corrections/source-checked-fixes.json laid over it). Same record '
                           'shape as source-checked-fixes.json; sourceFile null means Civgraph lacks the contest; ocrUncertain marks '
                           'readings from the OCR text layer that need the page image checked. Verify every record before copying it '
                           'into the corrections file.',
            'generatedBy': 'scripts/gazette/extract_election_notices.py', 'parserVersion': PARSER_VERSION,
            'batches': {'belfast-gazette-proposals-' + accessed: 'Belfast Gazette election notices (returns of members, writs, '
                        'statements of persons nominated, notices of poll, results) checked against Civgraph contests.'},
            'records': props}, ensure_ascii=False, indent=1), encoding='utf-8')
        summary['crosscheck'] = dict(collections.Counter(r['verdict'] for r in rows))
        returns = [r for r in rows if r['type'] == 'return-of-members' and r.get('gazette_name')]
        summary['parse_quality'] = {
            'return_entries_compared': len(returns),
            'matched_to_a_civgraph_contest': sum(1 for r in returns if r.get('civgraph_file')),
            'name_agrees_with_civgraph_person': sum(1 for r in returns if r.get('name_relation') in ('same', 'fuller', 'initials', 'familiar')),
            'entries_with_ocr_flags': sum(1 for r in returns if r.get('ocr_flags')),
            'notices_low_confidence_not_compared': sum(1 for n in notices if n['confidence'] == 'low'),
        }
        summary['proposals'] = dict(collections.Counter(p['category'] for p in props))
    (out / 'election-notices-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()


