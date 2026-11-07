#!/usr/bin/env python
"""Find Belfast Gazette notices about Northern Ireland administrative boundaries and their legal
authority, structure them, and propose maps.json references for the NI admin-area editions.

Reads the crawler's database READ-ONLY (scripts/ingest/gazette-spn/crawl_belfast_gazette.py output) and keeps
its own state beside the outputs, so it can run while the crawl is still going: each run processes
only issues it has not seen (or whose download changed), then rewrites every output from the full
state. Re-running with no new issues rewrites identical files.

Recognised notice types (see classify()):
  royal_assent            one record per Act (or Measure) named in an assent notice, with assent date
  order_in_council        Orders in Council named in a notice (post-1972 legislation by Order)
  statutory_rule          S.R.&O. / S.R. list entries about boundaries, wards, elections, polling
  boundaries_commissioner Local Government Boundaries Commissioner / District Electoral Areas
                          Commissioner notices (provisional/revised/final recommendations, hearings)
  parliamentary_boundaries Boundary Commission / redistribution of Westminster or Stormont seats
  private_bill_notice     notice of an intended private bill (e.g. a borough extension or a new district)
  local_inquiry           inquiries into boundary extensions, alterations, provisional orders
  provisional_order       provisional orders altering or extending boroughs and districts
  district_constitution   a town constituted an urban district
  town_constitution       Towns Improvement (Ireland) Act 1854 adopted for a town
  district_alteration_order  borough / urban / rural district extension or alteration orders
  ward_order              division of a borough or district into wards, ward boundaries
  electoral_division_order  district or county electoral divisions altered or schemed
  polling_district_order  counties or districts divided into polling districts
  boundary_other          other notices about local-government boundaries (low confidence)
Insolvency, estates, probate, land-purchase and other personal notices are skipped.

Outputs (in --out, default <CIVGRAPH_GAZETTE_DIR>/extracted):
  boundary-notices.jsonl, boundary-notices.csv, boundary-notices-report.md,
  maps-json-gazette-proposals.json, extract-state.sqlite (resume state; delete to start over)

Citations follow "Belfast Gazette, issue <n>, <d Month yyyy>, p. <page>" and
https://www.thegazette.co.uk/Belfast/issue/<n>/page/<page> (Crown copyright, Open Government
Licence: facts and citations only; summaries are generated from extracted fields, not copied).

Matching (proposals only; maps.json is never written): a notice is linked to the NI editions
(admin-areas-*, ded-*, county-ed-*, deds-ni-*, wards-*, deas-*, lgd-*, pc-*, stormont-*) whose date
equals its in-force or made date, or (Acts, commissioner and parliamentary notices) to an edition in
the following two years that names the same place. Notices already cited (same issue and page, and
the same place when the citation label names one) are listed as rediscovered; boundary-change notices
with no edition are listed as gaps. Existing Gazette citations are also checked: dates that differ
from the notice, cited pages that are not printed pages, and citations the extractor did not find.

Bump VERSION after changing the rules: the next run reprocesses every issue.

  python scripts/ingest/gazette-spn/extract_boundary_notices.py [--db <gazette folder>/gazette.sqlite]
      [--out <gazette folder>/extracted] [--maps data/database/maps.json] [--rebuild]
      [--from-issue N] [--to-issue N] [--limit N] [--no-extract]
"""
import argparse, os, csv, datetime, hashlib, json, re, sqlite3, sys, time
from collections import Counter, defaultdict
from pathlib import Path

import regex

VERSION = 21
ROOT = Path(__file__).resolve().parents[3]
URL_PAGE = 'https://www.thegazette.co.uk/Belfast/issue/{n}/page/{p}'
URL_PDF = 'https://www.thegazette.co.uk/Belfast/issue/{n}/data.pdf'
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
          'october', 'november', 'december']
MON_ABBR = {m[:3]: i + 1 for i, m in enumerate(MONTHS)}
MON_ABBR['sept'] = 9

# ---------------------------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------------------------

def dehyphenate(text):
    # "Enact-\nments" -> "Enactments"; keep real hyphens before capitals ("Newry-\nMourne" rare).
    return re.sub(r'(\w)-\s*\n\s*([a-z])', r'\1\2', text)


def squash_spaced_caps(text):
    # "S P E C I A L" -> "SPECIAL"
    return re.sub(r'\b(?:[A-Za-z] ){3,}[A-Za-z]\b', lambda m: m.group(0).replace(' ', ''), text)


def flat(text):
    """One-line, whitespace-collapsed, dehyphenated text (original case)."""
    return re.sub(r'\s+', ' ', squash_spaced_caps(dehyphenate(text))).strip()


_SKEL = str.maketrans({'1': 'i', '|': 'i', '!': 'i', 'l': 'i', 'í': 'i', '0': 'o', '’': "'"})


def skel(text):
    """OCR-tolerant matching form: lower case, l/1/|/! -> i, 0 -> o, rn -> m, punctuation -> space."""
    s = flat(text).lower().replace('rn', 'm').replace('vv', 'w')
    s = s.translate(_SKEL)
    s = re.sub(r"[^a-z0-9' ]+", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def kw(phrase, fuzzy=True):
    """Compile a skeleton-space pattern for a phrase; long words tolerate one OCR error."""
    parts = []
    for word in skel(phrase).split():
        w = regex.escape(word)
        if fuzzy and len(word) >= 8:
            parts.append(f'(?:{w}){{e<=1}}')
        else:
            parts.append(w)
    return regex.compile(r'\b' + r'\s?'.join(parts) + r'\b')


def any_kw(*phrases, fuzzy=True):
    pats = [kw(p, fuzzy) for p in phrases]
    return lambda s: any(p.search(s) for p in pats)


# ---------------------------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------------------------

ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6, 'seventh': 7,
       'eighth': 8, 'ninth': 9, 'tenth': 10, 'eleventh': 11, 'twelfth': 12, 'thirteenth': 13,
       'fourteenth': 14, 'fifteenth': 15, 'sixteenth': 16, 'seventeenth': 17, 'eighteenth': 18,
       'nineteenth': 19, 'twentieth': 20, 'thirtieth': 30}
UNITS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
         'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14,
         'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19}
TENS = {'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
        'eighty': 80, 'ninety': 90}
MON_RE = r'(?P<m>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?'
DAY_RE = r'(?P<d>[0-3]?[0-9]|[iIl][0-9oO]|[0-9][oOiIl]|[1-3][0-9])\s?(?:st|nd|rd|th|ra|d)?\.?'
YEAR_RE = r'(?P<y>1\s?[9g]\s?-?\s?[0-9]\s?-?\s?[0-9]|20\s?[0-9]\s?[0-9])'
ORDW = '|'.join(sorted(list(ORD) + [f'{t}-{o}' for t in ('twenty', 'thirty') for o in ORD if ORD[o] < 10], key=len, reverse=True))
YEARW_RE = r'(?P<yw>(?:o\S{1,2}\s+thousand\s+nine\s+hundred|nine\S{3,5}\s+hundred)(?:\s+and)?(?:\s+[a-z]+(?:-\s?[a-z]+)?){0,2})'
INYEAR = r'''[\s,.'’"*]*(?:in\s+the\s+year\s+(?:of\s+our\s+lord\s+)?)?'''
DATE_PATS = [
    re.compile(r'\b' + DAY_RE + r'''[\s,'’]*(?:day\s+of[\s'’".,]+)?''' + MON_RE + INYEAR + r'(?:' + YEAR_RE + '|' + YEARW_RE + ')', re.I),
    re.compile(r'\b' + MON_RE + r'[\s,.]+' + DAY_RE + r'[\s,]+' + YEAR_RE, re.I),
    re.compile(r'\b(?P<dw>' + ORDW + r''')\s+day\s+of[\s'’".,]+''' + MON_RE + INYEAR + r'(?:' + YEAR_RE + '|' + YEARW_RE + ')', re.I),
]


def _num(tok):
    return int(tok.translate(str.maketrans('iIlOo', '11100')))


def _year_words(text):
    words = re.sub(r'(o\S{1,2}\s+thousand\s+nine\s+hundred|nine\S{3,5}\s+hundred)(\s+and)?', '', text.lower()).replace('-', ' ').split()
    total = 0
    for w in words:
        if w in TENS:
            total += TENS[w]
        elif w in UNITS:
            total += UNITS[w]
        else:
            break
    if not total:
        raise ValueError('year words not understood')
    return 1900 + total


def find_dates(text):
    """[(start, end, iso)] for every parseable full date in text (flat form)."""
    out = []
    taken = []
    for pat in DATE_PATS:
        for m in pat.finditer(text):
            if any(s <= m.start() < e for s, e in taken):
                continue
            try:
                g = m.groupdict()
                mon = g['m'].lower().rstrip('.')
                month = MON_ABBR.get(mon[:4] if mon.startswith('sept') else mon[:3])
                if g.get('dw'):
                    dw = g['dw'].lower()
                    day = ORD[dw] if dw in ORD else {'twenty': 20, 'thirty': 30}[dw.split('-')[0]] + ORD[dw.split('-')[1]]
                else:
                    day = _num(g['d'])
                if g.get('yw'):
                    year = _year_words(g['yw'])
                else:
                    year = int(re.sub(r'\D', '', g['y'].replace('g', '9')))
                iso = datetime.date(year, month, day).isoformat()
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
            if not (1900 <= year <= 2030):
                continue
            out.append((m.start(), m.end(), iso))
            taken.append((m.start(), m.end()))
    return sorted(out)


DATE_LABELS = [
    ('assent', r'assent'),
    ('in_force', r'come into (?:operation|force)|came into (?:operation|force)|take effect|shall have effect|have effect|'
                 r'appointed day|in force|operative|commenc|on and after|from and after|as from|with effect from|for all (?:other )?purposes|'
                 r'(?:registration|register)[^.]{0,60}purposes|purposes of (?:the )?(?:registration|election)'),
    ('made', r'dated|\bmade\b|sealed|given under|signed|this\s+\S+\s+day of|confirmed|approved'),
    ('inquiry', r'inquiry|hearing|will hold|will sit|enquiry'),
    ('objections', r'objection|representations'),
    ('election', r'election|\bpoll\b'),
]


def labelled_dates(text):
    res = []
    for s, e, iso in find_dates(text):
        ctx = text[max(0, s - 140):s].lower()
        best, best_pos = 'other', -1
        for label, pat in DATE_LABELS:
            for m in re.finditer(pat, ctx):
                if m.start() >= best_pos:
                    best, best_pos = label, m.start()
        if best_pos < len(ctx) - 120 and best != 'assent':
            best = 'other' if best_pos < 0 else best
        if best == 'made' and re.search(r'given under|seal|dated this|this\s+\S+\s+day', text[max(0, s - 90):s], re.I):
            best = 'made_seal'
        res.append({'date': iso, 'kind': best})
    return res


def fmt_date(iso):
    if not iso:
        return ''
    d = datetime.date.fromisoformat(iso)
    return f'{d.day} {d.strftime("%B")} {d.year}'


def short_date(iso):
    d = datetime.date.fromisoformat(iso)
    return f'{d.day} {d.strftime("%b")} {d.year}'


# ---------------------------------------------------------------------------------------------
# Places and authorities
# ---------------------------------------------------------------------------------------------

COUNTIES = ['Antrim', 'Armagh', 'Down', 'Fermanagh', 'Londonderry', 'Tyrone']
TOWNS = '''Antrim Armagh Ardglass Augher Aughnacloy Ballycastle Ballyclare Ballykelly Ballymena Ballymoney
Ballynahinch Banbridge Bangor Belfast Belleek Bessbrook Bushmills Caledon Carrickfergus Castlederg
Castledawson Castlereagh Castlewellan Claudy Clogher Coalisland Coleraine Comber Cookstown Craigavon
Crossgar Crossmaglen Crumlin Cushendall Derry Donaghadee Downpatrick Draperstown Dromara Dromore
Dundonald Dungannon Dungiven Eglinton Enniskillen Fintona Fivemiletown Garvagh Gilford Glenarm
Glengormley Greenisland Hillsborough Holywood Irvinestown Jordanstown Keady Kesh Kilkeel Killyleagh
Kilrea Larne Limavady Lisburn Lisnaskea Londonderry Lurgan Maghera Magherafelt Markethill Moira
Moneymore Moyle Newcastle Newry Newtownabbey Newtownards Newtownbutler Newtownstewart Omagh
Portadown Portaferry Portrush Portstewart Randalstown Rathfriland Richhill Rostrevor Saintfield
Strabane Tandragee Toome Warrenpoint Whiteabbey Whitehead Ards Mourne'''.split()
MULTI = ['North Down', 'Newry and Mourne', 'Sion Mills', 'Castle Dawson', 'Newry No. 1', 'Newry No. 2',
         'Ballymena Rural', 'Belfast Rural', 'Lisburn Rural', 'Antrim Rural', 'Larne Rural',
         'Ballycastle Rural', 'Coleraine Rural', 'Banbridge Rural', 'Moira Rural', 'Kilkeel Rural',
         'Downpatrick Rural', 'Tandragee Rural', 'Lurgan Rural', 'Armagh Rural', 'Omagh Rural',
         'Strabane Rural', 'Cookstown Rural', 'Dungannon Rural', 'Clogher Rural', 'Castlederg Rural',
         'Magherafelt Rural', 'Limavady Rural', 'Londonderry Rural', 'Enniskillen Rural',
         'Irvinestown Rural', 'Lisnaskea Rural', 'Ballymoney Rural', 'Hillsborough Rural',
         'Castlereagh Rural', 'Newtownards Rural', 'North Down Rural']
ALIASES = {'Tanderagee': 'Tandragee', 'Tanderagee Rural': 'Tandragee Rural', 'Newtown Stewart': 'Newtownstewart',
           'Newtownbarry': 'Newtownbutler', 'Kilkeal': 'Kilkeel', 'Portglenone': 'Portglenone', 'Ballymacarrett': 'Ballymacarrett',
           'Castle Dawson': 'Castledawson', 'Port Stewart': 'Portstewart', 'Newtown Limavady': 'Limavady',
           'Newtownlimavady': 'Limavady', 'Lisnaskea Rural': 'Lisnaskea Rural'}
PLACE_SET = {p.lower(): p for p in TOWNS + COUNTIES + MULTI}
PLACE_SET.update({a.lower(): b for a, b in ALIASES.items()})
PLACE_RE = re.compile(r'\b(' + '|'.join(sorted((re.escape(p) for p in set(MULTI + TOWNS + list(ALIASES))), key=len, reverse=True)) + r')\b')
UNIT_PATS = [
    (re.compile(r'\b(?:Urban|Rural)\s+(?:County\s+)?District\s+of\s+([A-Z][A-Za-z\']+(?:\s+No\.\s*[12]|\s+[A-Z][a-z]+)?)'), 'district'),
    (re.compile(r'\b([A-Z][A-Za-z\']+(?:\s+[A-Z][a-z]+)?)\s+(Urban|Rural)\s+(?:County\s+)?District\b'), 'district2'),
    (re.compile(r'\b(?:Municipal\s+)?Borough\s+of\s+([A-Z][A-Za-z\']+(?:\s+[A-Z][a-z]+)?)'), 'borough'),
    (re.compile(r'\b([A-Z][A-Za-z\']+)\s+Borough\b'), 'borough2'),
    (re.compile(r'\bCounty\s+(?:Borough\s+)?of\s+(?:the\s+City\s+of\s+)?([A-Z][a-z]+)'), 'county'),
    (re.compile(r'\b(?:Town|City)\s+of\s+([A-Z][a-z]+)'), 'town'),
]
NOT_PLACE = {'The', 'Said', 'Such', 'Each', 'Any', 'Every', 'Northern', 'Ireland', 'Same', 'This', 'That',
             'Whole', 'Urban', 'Rural', 'County', 'New', 'Several', 'Existing', 'Proposed', 'Municipal'}


def find_places(text):
    found = []
    for pat, kind in UNIT_PATS:
        for m in pat.finditer(text):
            name = m.group(1).strip()
            first = name.split()[0]
            if first in NOT_PLACE:
                continue
            if name.lower() in PLACE_SET or first.lower() in PLACE_SET:
                name = PLACE_SET.get(name.lower(), PLACE_SET.get(first.lower(), first) + name[len(first):])
                if kind.startswith('district') and kind == 'district2':
                    found.append(f'{name} {m.group(2)} District')
                elif kind == 'district':
                    word = 'Urban' if re.search(r'Urban', m.group(0)) else 'Rural'
                    found.append(f'{name} {word} District')
                elif kind.startswith('borough'):
                    found.append(f'{name} Borough')
                elif kind == 'county':
                    found.append(f'County {name}' if name in COUNTIES else name)
                else:
                    found.append(name)
    for m in PLACE_RE.finditer(text):
        found.append(PLACE_SET.get(m.group(1).lower(), m.group(1)))
    out, seen = [], set()
    for p in found:
        key = p.lower()
        if key not in seen:
            seen.add(key)
            out.append(p)
    # drop bare names already present in a qualified form
    qual = [p for p in out if ' ' in p]
    out = [p for p in out if ' ' in p or not any(q.lower().startswith(p.lower() + ' ') or q.lower().endswith(' ' + p.lower()) for q in qual)]
    rank = lambda p: 0 if re.search(r'District|Borough', p) else (2 if p.startswith('County ') else 1)
    return sorted(out, key=lambda p: (rank(p), out.index(p)))[:40]


AUTHORITIES = [
    ('Governor of Northern Ireland', kw('governor of northern ireland')),
    ('Ministry of Home Affairs', kw('ministry of home affairs')),
    ('Ministry of Health and Local Government', kw('ministry of health and local government')),
    ('Ministry of Development', kw('ministry of development')),
    ('Ministry of Finance', kw('ministry of finance')),
    ('Department of the Environment', kw('department of the environment')),
    ('Local Government Boundaries Commissioner', kw('boundaries commissioner')),
    ('District Electoral Areas Commissioner', kw('district electoral areas commissioner')),
    ('Boundary Commission for Northern Ireland', kw('boundary commission for northern ireland')),
    ('Local Government Boundary Commission', kw('local government boundary commission')),
    ('Northern Ireland Office', kw('northern ireland office')),
    ('Privy Council', kw('privy council')),
    ('Clerk of the Parliaments', kw('clerk of the parliaments')),
]
COUNCIL_RE = re.compile(r'\b(?:County\s+Council\s+of\s+(?:the\s+County\s+of\s+)?([A-Z][a-z]+)|([A-Z][a-z]+)\s+County\s+Council)')


def find_authority(text, sk):
    names = [name for name, p in AUTHORITIES if p.search(sk)]
    for m in COUNCIL_RE.finditer(text):
        c = m.group(1) or m.group(2)
        if c in COUNTIES:
            names.append(f'{c} County Council')
    return list(dict.fromkeys(names))[:4]


# ---------------------------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------------------------

CAPW = r"(?:[A-Z][A-Za-z'’\.\-]*|No\.\s*\d+|\d+|of|and|the|for|in|&|\((?:[A-Z][A-Za-z ,'’\.\-&]+|No\.\s*\d+)\))"
INSTR_RE = re.compile(r"(" + CAPW + r"(?:\s+" + CAPW + r"){0,14}?\s+(?:Order|Scheme|Act|Measure|Regulations|Rules)"
                      r"(?:\s*\((?:Northern\s+Ireland|N\.\s?I\.)\))?,?\s*(?:19|20)\d\d)")
INSTR_HINT = re.compile(r'Extension|Alteration|Boundar|Ward|Electoral|District|Borough|Provisional|Confirmation|Polling|Constituenc|Redistribution|Local Government|Franchise|Election', re.I)


def clean_title(t):
    t = re.sub(r'\s+', ' ', t).strip(' .,;:-')
    t = re.sub(r'^(?:The|the|THE|That|the said|of|and|under|by|in|In|to|To)\s+', '', t)
    return t


def find_instruments(text):
    out = []
    for m in INSTR_RE.finditer(text):
        t = clean_title(m.group(1))
        # trim lead-ins such as "Notice is hereby given that the"
        t = re.sub(r'^.*?\b(?:that|the|of|under|by)\s+(?=[A-Z])', '', t) if len(t) > 90 else t
        if len(t) > 12 and INSTR_HINT.search(t):
            out.append(t)
    return list(dict.fromkeys(out))[:6]


# ---------------------------------------------------------------------------------------------
# Pages, headers, segmentation
# ---------------------------------------------------------------------------------------------

HEADER_SK = kw('belfast gazette')
WEEKDAY = re.compile(r'\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)\b', re.I)


def printed_numbers(pages):
    """Printed page number per page index (labels, else the page's own number line, smoothed)."""
    det = {}
    for idx, label, text in pages:
        if label and label.strip().isdigit():
            det[idx] = int(label)
            continue
        for line in text.splitlines()[:6]:
            t = line.strip().translate(str.maketrans('iIlOoSB', '1110058'))
            if re.fullmatch(r'\d{1,4}', t) and int(t) > 0:
                det[idx] = int(t)
                break
    offsets = Counter(v - i for i, v in det.items())
    if offsets:
        off, n = offsets.most_common(1)[0]
        if n >= max(2, len(det) * 0.5):
            return {idx: idx + off for idx, _, _ in pages}, 'inferred'
    return {idx: det.get(idx) for idx, _, _ in pages}, 'detected'


def strip_headers(idx, text):
    lines = text.splitlines()
    if idx == 0:
        for i, line in enumerate(lines[:60]):
            if WEEKDAY.search(line) and re.search(r'\d', line):
                lines = lines[i + 1:]
                break
    out = []
    for i, line in enumerate(lines):
        s = line.strip()
        if i < 4 and (re.fullmatch(r'[\W\dIlOoSB]{1,6}', s) or HEADER_SK.search(skel(s) or ' ')
                      or re.fullmatch(r'(?i)n[ui]mb\.?.{0,8}', s)):
            continue
        out.append(line)
    return out


def is_heading(line):
    s = line.strip()
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 4:
        return False
    up = sum(c.isupper() for c in letters) / len(letters)
    if up < 0.8:
        return False
    # signatures: "R. DAWSON BATES." / "J. A. DALE, Secretary."
    if re.fullmatch(r"(?:[A-Z]\.\s*){1,3}[A-Z'’\- ]+[.,]?", s) and len(s) < 40:
        return False
    return True


def segment(lines):
    """Split [(page_index, line)] into notices: a run of heading lines starts a new notice."""
    segs, cur, prev_head = [], [], False
    for pi, line in lines:
        if not line.strip():
            continue
        h = is_heading(line)
        if h and not prev_head and cur:
            body_chars = sum(len(l) for p, l in cur if not is_heading(l))
            if body_chars > 60:
                segs.append(cur)
                cur = []
        cur.append((pi, line))
        prev_head = h
    if cur:
        segs.append(cur)
    return segs


# ---------------------------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------------------------

PERSONAL = any_kw('bankruptcy', 'bankrupt', 'deceased', 'trustee act', 'winding up', 'liquidator', 'liquidation',
                  'partnership', 'receiving order', 'letters of administration', 'probate', 'administratrix',
                  'creditors', 'dissolution', 'deed poll', 'estates commissioners', 'land purchase', 'insolvency',
                  'land registry', 'arrangement with creditors', 'notice to claimants', 'in the goods of',
                  'adjudication', 'charitable donations', 'companies act', 'incumbrancers', 'land judge',
                  'chancery division', 'notice to creditors', 'lunacy', 'ward of court')
K = {name: any_kw(*phr) for name, phr in {
    'royal_assent': ['royal assent', 'signified his assent', 'signified her assent', 'given the royal assent', 'give his assent',
                     'give her assent', 'gave his assent', 'gave her assent', 'majesty s assent'],
    'following_acts': ['following acts', 'following bills', 'following act', 'following measures', 'following measure'],
    'order_in_council': ['order in council', 'orders in council'],
    'boundary': ['boundary', 'boundaries'],
    'district': ['urban district', 'rural district', 'urban county district', 'rural county district', 'borough',
                 'county borough', 'town of'],
    'ward': ['ward', 'wards'],
    'ded': ['district electoral division', 'district electoral divisions', 'electoral division', 'electoral divisions'],
    'ced': ['county electoral division', 'county electoral divisions'],
    'polling_district': ['polling district', 'polling districts'],
    'polling_station': ['polling station', 'polling stations', 'notice of poll', 'polling place', 'polling places',
                        'statement of persons nominated', 'election agent'],
    'provisional_order': ['provisional order'],
    'confirmation_act': ['confirmation act', 'provisional order confirmation'],
    'inquiry': ['local inquiry', 'public inquiry', 'inquiry', 'enquiry', 'public hearing'],
    'towns_improvement': ['towns improvement'],
    'ud_constituted': ['constituted an urban district', 'constitute an urban district', 'urban district order',
                       'constituted a rural district', 'constituting'],
    'private_bill': ['in parliament session', 'parliament of northern ireland session', 'private bill', 'private bills',
                     'in parliament'],
    'county': ['administrative county', 'county of', 'county borough of', 'poor law union', 'union'],
    'lg_boundaries': ['local government boundaries', 'local government (boundaries)'],
    'commissioner': ['boundaries commissioner', 'district electoral areas commissioner', 'electoral areas commissioner',
                     'assistant commissioner'],
    'dea': ['district electoral area', 'district electoral areas'],
    'parliamentary': ['parliamentary constituencies', 'parliamentary constituency', 'boundary commission',
                      'redistribution of seats', 'house of commons (method of voting and redistribution of seats)'],
    'statutory_rules': ['statutory rules and orders', 'statutory rules', 'statutory instruments'],
    'divide': ['divided into', 'divide', 'divides', 'divided', 'dividing', 'scheme', 'number of wards', 'the boundaries of the', 'should be altered',
               'shall be altered', 'be amalgamated', 'shall consist of', 'formed into', 'be united'],
    'order_word': ['order', 'ordered', 'orders', 'scheme'],
    'other_domain': ['drainage', 'fishery', 'fisheries', 'water supply', 'sewerage', 'harbour', 'pilotage', 'game',
                     'petty sessions', 'licensing', 'dispensary', 'school', 'trade board', 'gas undertaking',
                     'electricity', 'tramway', 'tramways', 'railway', 'turbary', 'forestry', 'special powers',
                     'housing', 'working classes', 'public health', 'acquisition of land', 'compulsory purchase', 'sanitary'],
}.items()}
_UNIT = r'(?:the\s)?(?:said\s)?(?:boundar\w*|borough|urban|rural|town|city|district|county|ward\w*|area)'


def _skre(p):
    # patterns are written in plain English; the skeleton turns l into i
    return regex.compile(p.replace('l', 'i'))


_EXT = [_skre(p) for p in (
    r'\b(?:extension){e<=1}\sof\s(?:the\s)?(?:said\s)?(?:boundar\w*|borough|urban\sdistrict|town|city|county\sborough)', r'\b(?:borough|district|town|city)\s(?:extension){e<=1}\b',
    r'\b(?:extension){e<=1}\s(?:order|scheme)\b', r'\bextend(?:ing|ed)?\s(?:the\s)?(?:said\s)?(?:boundar|borough|urban\sdistrict)', r'\bextended\sarea\b',
    r'\bboundar\w*\s(?:of\s)?(?:the\s)?(?:said\s)?(?:urban|rural|borough|town).{0,80}\bextend')]
_ALT = [_skre(p) for p in (
    r'\b(?:alteration){e<=1}\sof\s(?:the\s)?(?:boundar\w*|area)(?!\s(?:of|or)\s(?:the\s)?(?:said\s)?(?:several\s)?(?:existing\s)?(?:any\s)?(?:such\s)?wards?\b)',
    r'\balter(?:ing|ed)?\s(?:the\s)?(?:boundar\w*|area)(?!\s(?:of|or)\s(?:the\s)?(?:said\s)?(?:several\s)?(?:existing\s)?(?:any\s)?(?:such\s)?wards?\b)',
    r'\b(?:alteration){e<=1}\s(?:order|scheme)\b', r'\badded\sto\s(?:and\sform\spart\sof\s)?' + _UNIT,
    r'\btransferred\s(?:from|to)\s' + _UNIT, r'\bform(?:ing)?\spart\sof\s' + _UNIT,
    r'\bboundar\w*\s(?:shall\sbe|are\shereby|be)\s(?:altered|extended|varied|amended)')]
K['extension'] = lambda s: any(p.search(s) for p in _EXT)
K['alteration'] = lambda s: any(p.search(s) for p in _ALT)
REL_TITLE = re.compile(r'Extension|Boundar|Ward|Electoral|Election|Franchise|Constituenc|Redistribution|Local Government|'
                       r'Provisional Order|Urban District|Rural District|Borough|County Council|Representation of the People|'
                       r'Polling|Districts? Councils?|Elections?|Newtownabbey|Craigavon|New Towns?|Municipal', re.I)
SR_ENTRY = re.compile(r'(?:(?P<yr>(?:19|20)\d\d)\s+)?No\.?\s*(?P<no>\d{1,4})\.?\s*[-—–:]?\s*(?P<title>(?:The\s+)?[A-Z][^;]{8,220}?'
                      r'(?:Order|Regulations|Rules|Scheme|Byelaws|Bye-laws)(?:\s*\((?:Northern\s+Ireland|N\.\s?I\.)\))?,?\s*(?:(?:19|20)\d\d)?)')
ACT_END = re.compile(r"(?:Act|ACT|Measure|MEASURE)\s*,?\s*(?:\((?:Northern|NORTHERN)\s*(?:Ireland|IRELAND)\)|\(N\.\s?I\.\))?\s*,?\s*((?:19|20)\d\d)\b\.?")
TERMINATORS = re.compile(r'Clerk of the Parliament|Clerk of the Privy|Cabinet Office|Parliament Buildings|Stormont|Secretary\.|Governor\.', re.I)


def classify(sk, head_sk, text=''):
    """(type, subtype, base confidence) or None. sk: skeleton of the whole segment."""
    has = {k: f(sk) for k, f in K.items()}
    h = {k: K[k](head_sk) for k in ('boundary', 'ward', 'ded', 'ced', 'district', 'extension', 'alteration', 'polling_district',
                                     'provisional_order', 'other_domain', 'inquiry', 'county')}
    if has['royal_assent'] and (has['following_acts'] or kw('act').search(sk)):
        return 'royal_assent', '', 0.85
    if has['commissioner'] and (has['boundary'] or has['ward'] or has['dea'] or has['lg_boundaries']):
        stage = next((s for s in ('provisional recommendations', 'revised recommendations', 'final recommendations',
                                  'public hearing', 'assistant commissioner', 'inquiry', 'report')
                      if kw(s).search(sk)), '')
        return 'boundaries_commissioner', stage, 0.85
    if has['parliamentary'] and (has['boundary'] or kw('constituenc').search(sk)):
        return 'parliamentary_boundaries', '', 0.7
    if K['private_bill'](head_sk):
        if has['extension'] or has['alteration'] or (has['boundary'] and (has['district'] or has['ward'])) or (has['ward'] and has['divide']):
            return 'private_bill_notice', '', 0.45 if (has['other_domain'] or WATERISH(head_sk)) else 0.6
        return None
    domain_head = h['other_domain'] or WATERISH(head_sk)
    if domain_head and not (h['ward'] or h['ded'] or h['boundary']):
        return None
    if has['order_in_council'] and kw('northern ireland').search(sk) and REL_TITLE.search(text) and not has['other_domain']:
        return 'order_in_council', '', 0.6
    if has['statutory_rules'] and not (has['district'] and (has['extension'] or has['alteration']) and has['boundary']):
        return 'statutory_rule', '', 0.6
    if has['polling_station'] and not (has['boundary'] and (has['alteration'] or has['extension'])):
        return None
    loc = has['district'] or has['ward'] or has['ded'] or has['ced']
    change = has['extension'] or has['alteration'] or has['boundary'] or has['divide']
    ordered = kw('hereby order').search(sk) or kw('do order').search(sk) or kw('hereby confirm').search(sk)
    to_hold = any_kw('will hold', 'will be held', 'intends to hold', 'o clock', 'propose to hold', 'shall hold')(sk)
    if has['inquiry'] and to_hold and not ordered and loc and change:
        return 'local_inquiry', 'provisional order' if has['provisional_order'] else '', 0.7
    if has['provisional_order'] and loc and (has['extension'] or has['alteration'] or has['boundary']):
        return 'provisional_order', 'confirmation act' if has['confirmation_act'] else '', 0.75
    if has['towns_improvement'] and (kw('adopt').search(sk) or kw('adoption').search(sk) or kw('adopted').search(sk)):
        return 'town_constitution', '', 0.75
    if has['ud_constituted'] and has['district'] and kw('constitut').search(sk):
        return 'district_constitution', '', 0.75
    n_ward = len(WARD_WORD.findall(sk))
    if kw('reconstitut').search(sk) and not (has['extension'] or has['alteration'] or kw('divided into').search(sk)):
        return None  # a council reconstituted after dissolution, not a boundary change
    unit_head = h['ward'] or h['district'] or h['ded'] or h['ced'] or h['boundary'] or h['county']
    if n_ward >= 6 and has['order_word'] and not (h['extension'] or h['alteration'] or K['extension'](sk[:600])):
        return 'ward_order', '', 0.75
    if has['district'] and (has['extension'] or has['alteration']) and (has['boundary'] or h['extension'] or h['alteration']) and not h['ward'] \
            and not (PUBLIC_HEALTH(sk) and not (h['extension'] or h['alteration'])):
        return 'district_alteration_order', '', 0.75
    if has['ward'] and (has['divide'] or has['boundary'] or has['alteration']) and has['order_word'] and (unit_head or n_ward >= 4):
        return 'ward_order', '', 0.75
    if (has['ded'] or has['ced']) and (has['divide'] or has['boundary'] or has['alteration']) and (unit_head or kw('scheme').search(sk)):
        return 'electoral_division_order', 'county' if has['ced'] else 'district', 0.7 if has['order_word'] else 0.6
    if has['polling_district'] and (h['polling_district'] or kw('divided into polling districts').search(sk) or h['district']):
        return 'polling_district_order', '', 0.55
    if (has['lg_boundaries'] or (has['boundary'] and loc and has['order_word'] and unit_head)) and not has['other_domain']:
        return 'boundary_other', '', 0.4
    return None


PUBLIC_HEALTH = any_kw('public health (ireland) act 1896', 'urban authority', 'urban sanitary authority', 'contributory place')
WARD_WORD = regex.compile(r'\bwards?\b')
WATERISH = any_kw('water', 'gas', 'tramways', 'harbour', 'port', 'markets', 'gas undertaking', fuzzy=False)


TYPE_PHRASE = {
    'royal_assent': 'Royal Assent to', 'order_in_council': 'Order in Council', 'statutory_rule': 'Statutory rule',
    'boundaries_commissioner': 'Boundaries commissioner notice', 'parliamentary_boundaries': 'Parliamentary boundaries notice',
    'local_inquiry': 'Inquiry notice', 'provisional_order': 'Provisional order', 'town_constitution': 'Towns Improvement Act adopted',
    'district_constitution': 'New urban district constituted', 'district_alteration_order': 'District boundary altered',
    'ward_order': 'Ward order', 'private_bill_notice': 'Notice of a private bill', 'electoral_division_order': 'Electoral division order', 'polling_district_order': 'Polling districts order',
    'boundary_other': 'Boundary notice',
}
BOUNDARY_TYPES = {'private_bill_notice', 'district_alteration_order', 'district_constitution', 'town_constitution', 'ward_order',
                  'electoral_division_order', 'provisional_order', 'polling_district_order'}


def ocr_quality(text):
    words = re.findall(r'[A-Za-z]{3,}', text)
    if not words:
        return 0.0
    good = sum(1 for w in words if re.fullmatch(r'[A-Z]?[a-z]+|[A-Z]+', w) and re.search(r'[aeiouyAEIOUY]', w))
    return good / len(words)


GENERIC_HEAD = re.compile(r'^(?:THE\s+)?(?:MINISTRY|DEPARTMENT)\s+OF\b.*|.*\bACTS?\b.*\b(?:19|18)\d\d.*|^(?:PUBLIC\s+)?NOTICES?\.?$|'
                          r'^(?:NORTHERN\s+IRELAND|GOVERNMENT\s+OF\s+NORTHERN\s+IRELAND)\.?$|^ORDER\.?$', re.I)
GENERIC_PARTS = [re.compile(p, re.I) for p in (
    r'(?:THE\s+)?[.\s]*GOVERNMENT\s+OF\s+NORTHERN\s+IRELAND\.?',
    r'(?:THE\s+)?MINISTRY\s+O[FP]\s+[A-Z ,&]+?(?:FOR\s+NORTHERN\s+IRELAND|\.)\.?',
    r'(?:THE\s+)?[*\s]*[A-Z ()*.,]*?\bACTS?\s*[.\s]*\((?:NORTHERN|N\.)[^)]*\)[\s,.]*(?:\d[\d:]{3})?(?:\s+(?:to|and)\s+\d[\d:]{3,4})?\.?',
    r'\bFOR\s+NORTHERN\s+IRELAND\.?', r'^(?:PUBLIC\s+)?NOTICE\.?\s', r'\bSCHEDULE\.?')]
SIGNATURE = re.compile(r"^(?:[A-Z][A-Za-z]{0,3}\.\s*){1,3}[A-Z'’\-]+(?:\s+[A-Z'’\-]+)?[.,]?$")


def heading_of(seg):
    """(full heading, specific title): the uppercase lines that open a notice."""
    head, started = [], False
    rows = [l.strip() for _, l in seg[:18]]
    for i, s in enumerate(rows):
        if sum(c.isalpha() for c in s) < 4 or re.match(r'^[A-Z]{1,3}[./]*\s*\d{2,5}\.?$', s):
            continue
        if not started and is_heading(s) and len(s.split()) <= 5 and i + 1 < len(rows) and len(rows[i + 1]) < 50 \
                and re.search(r'Secretary|Clerk|Minister|Commissioner|Registrar|Town Clerk|Solicitor|Chairman|Governor', rows[i + 1]):
            continue  # "GEORGE A. HARRIS," / "Assistant Secretary." closing the previous notice
        if is_heading(s):
            if not started and (SIGNATURE.match(s) or re.match(r'^[A-Z]{1,3}[./]+\s*\d', s)):
                continue  # trailing signature or file number of the previous notice
            started = True
            head.append(s)
            if len(head) >= 8:
                break
        elif started:
            break
    full = flat('\n'.join(head))
    title = full
    for pat in GENERIC_PARTS:
        title = pat.sub(' ', title)
    title = re.sub(r'\s+', ' ', title).strip(' .,;:*')
    return full, title if len(title.split()) >= 2 else full


SHORT_KIND = {'ward_order': 'wards', 'electoral_division_order': 'district electoral divisions',
              'district_alteration_order': 'boundary alteration', 'district_constitution': 'constituted an urban district',
              'town_constitution': 'Towns Improvement Act adopted', 'polling_district_order': 'polling districts',
              'provisional_order': 'provisional order', 'local_inquiry': 'inquiry', 'private_bill_notice': 'private bill notice',
              'boundary_other': 'boundary notice', 'boundaries_commissioner': 'boundaries commissioner',
              'parliamentary_boundaries': 'parliamentary boundaries'}


def display_name(r):
    if r.get('instrument'):
        return r['instrument']
    place = (r.get('places') or [''])[0]
    if place:
        return f"{place} ({SHORT_KIND.get(r['type'], r['type'])})"
    return f"{nice_title(r.get('title') or '')} ({SHORT_KIND.get(r['type'], r['type'])})"


def summary_for(rec):
    t = rec['type']
    bits = []
    name = rec.get('instrument') or nice_title(rec.get('title') or '')
    if t == 'royal_assent':
        bits.append(f"Royal Assent to the {name}" + (f" on {fmt_date(rec['dates'].get('assent'))}" if rec['dates'].get('assent') else ''))
    elif t == 'statutory_rule':
        bits.append(f"Statutory rule {rec.get('sr_number') or ''} listed: {name}".replace('  ', ' '))
    else:
        bits.append(f"{TYPE_PHRASE[t]}{(' (' + rec['subtype'] + ')') if rec.get('subtype') else ''}: {name}")
    if rec.get('places') and t != 'royal_assent':
        bits.append('places named: ' + ', '.join(rec['places'][:6]))
    if rec.get('authority'):
        bits.append('by ' + ' / '.join(rec['authority'][:2]))
    d = rec['dates']
    for k, label in (('made', 'made'), ('in_force', 'in force'), ('inquiry', 'inquiry'), ('objections', 'objections by')):
        if d.get(k):
            bits.append(f'{label} {fmt_date(d[k])}')
    if rec.get('ward_count'):
        bits.append(f"{rec['ward_count']} wards")
    if rec.get('enabling_acts') and t not in ('royal_assent', 'statutory_rule'):
        bits.append('under ' + rec['enabling_acts'][0])
    return '; '.join(b for b in bits if b) + '.'


NUMWORDS = {w: n for w, n in UNITS.items()}
SMALL = {'of', 'and', 'the', 'for', 'in', 'to', 'by', 'on'}


def nice_title(t):
    if not t or not t.isupper():
        return t
    words = t.lower().split()
    return ' '.join(w if (i and w in SMALL) else (w[:1].upper() + w[1:]) for i, w in enumerate(words)).replace('(n', '(N')
WARD_COUNT = re.compile(r'divided into\s+(\w+)\s+wards', re.I)


def extract_issue(issue, idate, pages):
    """All boundary-relevant records for one issue. pages: [(page_index, label, text)]."""
    nums, page_mode = printed_numbers(pages)
    lines = []
    for idx, label, text in pages:
        for line in strip_headers(idx, dehyphenate(text)):
            lines.append((idx, line))
    recs = []
    for seg in segment(lines):
        raw = '\n'.join(l for _, l in seg)
        text = flat(raw)
        if len(text) < 80:
            continue
        sk = skel(text)
        head, title = heading_of(seg)
        head_sk = skel(head) if head else sk[:200]
        if PERSONAL(sk) and not (K['boundary'](head_sk) or K['ward'](head_sk) or K['royal_assent'](sk)):
            continue
        if re.match(r'^\W*(?:THE\s+)?(?:FIRST\s+|SECOND\s+|THIRD\s+)?SCHEDULE', head or '', re.I) and \
                not re.search(r'\bWHEREAS\b|\bhereby\b|NOTICE is', text, re.I):
            continue
        cls = classify(sk, head_sk, text)
        if not cls:
            continue
        typ, sub, conf = cls
        start_pi = seg[0][0]
        end_pi = seg[-1][0]
        base = {
            'issue': issue, 'issue_date': idate, 'page_index': start_pi, 'page_number': nums.get(start_pi),
            'page_end': nums.get(end_pi) if end_pi != start_pi else None, 'page_number_source': page_mode,
            'type': typ, 'subtype': sub, 'title': title[:200], 'heading': head[:300],
        }
        qual = ocr_quality(text)
        dates_l = labelled_dates(text)
        if typ == 'royal_assent':
            recs.extend(assent_records(base, text, dates_l, conf, qual))
            continue
        if typ in ('statutory_rule', 'order_in_council'):
            recs.extend(list_records(base, text, typ, conf, qual))
            continue
        rec = dict(base)
        found = find_instruments(text)
        instr = [t for t in found if not re.search(r'\bAct\b[^A-Za-z]*(?:\((?:Northern|N\.)[^)]*\))?[\s,]*\d{4}$', t)]
        rec['enabling_acts'] = [clean_title(re.sub(r'^(?:Section|section|Sections|Article)\s+\d+\w*\s+of\s+', '', t))
                                for t in found if t not in instr and re.search(
                                    r'(?:under|virtue of|powers?\s+(?:vested|conferred)[^.]{0,60}?by|pursuance of|provided by|enacted by)[^.]{0,40}$',
                                    text[:text.find(t)] if t in text else '')][:3]
        rec['instrument'] = instr[0] if instr else ''
        rec['other_instruments'] = instr[1:]
        rec['authority'] = find_authority(text, sk)
        rec['places'] = find_places(text)
        rec['dates'] = pick_dates(dates_l, idate)
        rec['all_dates'] = dates_l[:12]
        m = WARD_COUNT.search(text)
        if m:
            w = m.group(1).lower()
            rec['ward_count'] = int(w) if w.isdigit() else NUMWORDS.get(w)
        c = conf
        c += 0.08 if rec['instrument'] else -0.05
        c += 0.05 if rec['places'] else -0.1
        c += 0.04 if rec['dates'].get('in_force') or rec['dates'].get('made') else -0.05
        c -= 0.25 * max(0.0, 0.85 - qual)
        rec['ocr_quality'] = round(qual, 2)
        rec['confidence'] = round(max(0.05, min(0.97, c)), 2)
        rec['evidence_chars'] = len(text)
        recs.append(rec)
    for i, r in enumerate(recs):
        r['summary'] = summary_for(r)
        key = f"{r['issue']}|{r['page_index']}|{r['type']}|{r.get('instrument') or r.get('title')}|{i}"
        r['id'] = f"bg{r['issue']}-{r['page_index']}-{hashlib.sha1(key.encode()).hexdigest()[:6]}"
        r['citation'] = cite(r)
        r['url'] = URL_PAGE.format(n=r['issue'], p=r['page_number']) if r.get('page_number') else URL_PDF.format(n=r['issue'])
        r['boundary_relevant'] = r['type'] not in ('royal_assent', 'order_in_council', 'statutory_rule') or bool(r.get('relevant'))
    return recs


def pick_dates(dates_l, idate):
    out = {}
    for d in dates_l:
        k = d['kind']
        if k in ('other',):
            continue
        if k == 'in_force':
            out.setdefault('in_force_all', [])
            if d['date'] not in out['in_force_all']:
                out['in_force_all'].append(d['date'])
        if k in ('made', 'made_seal') and idate and d['date'] > idate:
            continue  # a "made" date after publication is a misread
        if k == 'made_seal':
            out['made'] = d['date']
            out['_sealed'] = True
            continue
        if k == 'made':
            if not out.get('_sealed'):
                out['made'] = d['date']  # the last one; earlier ones are usually recitals
            continue
        out.setdefault(k, d['date'])
    if idate and out.get('in_force_all'):
        lo, hi = str(int(idate[:4]) - 2) + idate[4:], str(int(idate[:4]) + 2) + idate[4:]
        out['in_force_all'] = [x for x in out['in_force_all'] if lo <= x <= hi]
        if not out['in_force_all']:
            out.pop('in_force_all')
            out.pop('in_force', None)
        elif out.get('in_force') not in out['in_force_all']:
            out['in_force'] = out['in_force_all'][0]
    if idate and out.get('made') and out['made'] < str(int(idate[:4]) - 3):
        out.pop('made')  # recital of an older instrument
    out.pop('_sealed', None)
    if 'in_force_all' in out and len(out['in_force_all']) > 1:
        out['in_force'] = max(out['in_force_all'])  # the later date is usually "all other purposes"
    return out


ASSENT_LEAD = re.compile(r'(?:assent|Assent|ASSENT)[^:]{0,240}?(?:following|undermentioned|under-mentioned)\s+(?P<kind>Acts?|Bills?|Measures?|ACTS?|BILLS?)'
                         r'[^:—–]{0,160}?(?:viz\.?|namely)?\s*[:;—–\-]+', re.S)
NEXT_NOTICE = re.compile(r'\b(?:Foreign|Colonial|India|Home|War|Privy Council|Treasury|Downing Street|Whitehall)\s+Office\b|'
                         r'\bThe (?:KING|QUEEN) has been\b|\bNOTICE is hereby\b|\bMINISTRY OF\b')


def assent_records(base, text, dates_l, conf, qual):
    """One record per Act or Measure in an assent notice.

    1920s-40s: "...to give his Assent to the following Bills ... viz.:- Expiring Laws. Local Authorities (Elections and
    Constitution). 2nd November, 1922." (short titles, date after the list). Later: "...the Royal Assent ... to the
    following Acts:- ... Act (Northern Ireland) 1966." (full titles)."""
    out = []
    for lead in ASSENT_LEAD.finditer(text):
        body = text[lead.end():lead.end() + 3000]
        before = text[max(0, lead.start() - 400):lead.start()]
        stops = [m.start() for m in (TERMINATORS.search(body), NEXT_NOTICE.search(body)) if m]
        body_dates = find_dates(body)
        if body_dates:
            stops.append(body_dates[0][0])
        cut = min(stops) if stops else len(body)
        listing = body[:cut]
        pre_dates = [d for s_, e_, d in find_dates(before)]
        assent = (pre_dates[-1] if pre_dates else None) or (body_dates[0][2] if body_dates and body_dates[0][0] == cut else None)
        assent_basis = 'printed'
        if not assent and base.get('issue_date'):
            assent, assent_basis = base['issue_date'], 'issue date (the assent date was not read)'
        year = (assent or base.get('issue_date') or '')[:4]
        acts = []
        ends = list(ACT_END.finditer(listing))
        if ends:
            pos = 0
            for m in ends:
                chunk = listing[pos:m.start()]
                pos = m.end()
                title = re.sub(r'^[\s\d\.\(\)\-—–,;:*]+', '', chunk).strip()
                title = re.sub(r'^(?:and|the|The)\s+', '', title)
                if not (3 <= len(title) <= 220) or not re.match(r"[A-Z]", title):
                    continue
                word = 'Measure' if m.group(0).lower().startswith('measure') else 'Act'
                ni = '(Northern Ireland) ' if re.search(r'Northern|N\.\s?I', m.group(0), re.I) else ''
                acts.append((flat(f'{title} {word} {ni}{m.group(1)}'), False))
        else:
            for chunk in re.split(r'(?<=[a-z\)\]])\.[\s\u2022*\-\u2013\u2014]+(?=[A-Z\(])', listing):
                title = re.sub(r'^[\s\d\.\-—–,;:*]+', '', chunk).strip(' .;,*')
                if not (3 <= len(title) <= 160) or not re.match(r'[A-Z]', title) or len(title.split()) > 18:
                    continue
                if re.search(r'\d{1,2}\s?(?:st|nd|rd|th)\b|\b(?:19|18)\d\d\b', title):
                    continue  # a misread date line
                if re.search(r'\b(?:Esq|appoint|graciously|Majesty|hereby|Office)\b', title):
                    break
                word = 'Measure' if lead.group('kind').lower().startswith('measure') else 'Act'
                acts.append((f'{title} {word} (Northern Ireland), {year}' if year else f'{title} {word}', True))
        for t, completed in dict.fromkeys(acts):
            rec = dict(base)
            rec.update(instrument=t, title_completed=completed, other_instruments=[], assent_date_basis=assent_basis,
                       authority=['Governor of Northern Ireland'] if base['issue_date'] and base['issue_date'] < '1973' else [],
                       places=find_places(t), dates={'assent': assent} if assent else {}, all_dates=[],
                       relevant=bool(REL_TITLE.search(t)), ocr_quality=round(qual, 2))
            rec['subtype'] = 'provisional order confirmation act' if re.search(r'Provisional Order', t, re.I) else ('local act' if rec['places'] else '')
            rec['confidence'] = round(max(0.1, min(0.95, conf + (0.05 if assent_basis == 'printed' else -0.15) - (0.1 if completed else 0)
                                                    - 0.2 * max(0, 0.85 - qual))), 2)
            out.append(rec)
    return out


def list_records(base, text, typ, conf, qual):
    out = []
    if typ == 'statutory_rule':
        for m in SR_ENTRY.finditer(text):
            t = clean_title(m.group('title'))
            if not REL_TITLE.search(t):
                continue
            rec = dict(base)
            yr = m.group('yr') or (re.search(r'(19|20)\d\d', t).group(0) if re.search(r'(19|20)\d\d', t) else '')
            rec.update(instrument=t, sr_number=f"{yr} No. {m.group('no')}".strip(), other_instruments=[],
                       authority=find_authority(text, skel(text)), places=find_places(t), dates={},
                       all_dates=[], relevant=True, ocr_quality=round(qual, 2))
            rec['confidence'] = round(max(0.1, min(0.9, conf + 0.1 - 0.25 * max(0, 0.85 - qual))), 2)
            out.append(rec)
    else:
        for t in find_instruments(text):
            if not re.search(r'Order', t) or not REL_TITLE.search(t):
                continue
            rec = dict(base)
            rec.update(instrument=t, other_instruments=[], authority=['Privy Council'], places=find_places(t),
                       dates=pick_dates(labelled_dates(text), base['issue_date']), all_dates=[], relevant=True,
                       ocr_quality=round(qual, 2))
            rec['confidence'] = round(max(0.1, min(0.85, conf - 0.25 * max(0, 0.85 - qual))), 2)
            out.append(rec)
    return out


def cite(r):
    d = fmt_date(r['issue_date']) if r.get('issue_date') else 'date unknown'
    p = f"p. {r['page_number']}" if r.get('page_number') else f"page index {r['page_index']}"
    if r.get('page_end') and r['page_end'] != r.get('page_number'):
        p = f"pp. {r['page_number']}-{r['page_end']}"
    return f"Belfast Gazette, issue {r['issue']}, {d}, {p}"


HEADER_DATE = re.compile(r'GAZETTE[,.\s]+' + MON_RE + r'[\s,.]+' + DAY_RE + r'[\s,]+' + YEAR_RE, re.I)


def issue_date_fallback(pages):
    """Most common date in the running heads ("THE BELFAST GAZETTE, JUNE 16, 1922")."""
    votes = Counter()
    for idx, _, text in pages[1:12]:
        for m in HEADER_DATE.finditer(text[:300]):
            ds = find_dates(m.group(0)[8:])
            if ds:
                votes[ds[0][2]] += 1
    if votes:
        best, n = votes.most_common(1)[0]
        if n >= 2 or len(votes) == 1:
            return best
    return None


# ---------------------------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------------------------

def open_state(path):
    st = sqlite3.connect(path)
    st.executescript('''
      CREATE TABLE IF NOT EXISTS processed(issue INTEGER PRIMARY KEY, fetched_at TEXT, version INTEGER, n INTEGER, date TEXT, pages INTEGER);
      CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY, issue INTEGER, json TEXT);
      CREATE INDEX IF NOT EXISTS notices_issue ON notices(issue);
      CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS issue_pages(issue INTEGER PRIMARY KEY, first_page INTEGER, last_page INTEGER, source TEXT);
    ''')
    return st


def run_extract(src, st, args):
    done = {r[0]: (r[1], r[2]) for r in st.execute('SELECT issue, fetched_at, version FROM processed')}
    q = "SELECT issue, fetched_at, date, pages FROM issues WHERE status='ok'"
    params = []
    if args.from_issue:
        q += ' AND issue >= ?'; params.append(args.from_issue)
    if args.to_issue:
        q += ' AND issue <= ?'; params.append(args.to_issue)
    todo = [r for r in src.execute(q + ' ORDER BY issue', params).fetchall()
            if done.get(r[0]) != (r[1], VERSION)]
    if args.limit:
        todo = todo[:args.limit]
    t0, n_new = time.time(), 0
    for k, (issue, fetched_at, idate, npages) in enumerate(todo):
        pages = src.execute('SELECT page_index, page_number, text FROM pages WHERE issue=? ORDER BY page_index', (issue,)).fetchall()
        if not pages:
            continue
        hdate = issue_date_fallback(pages)
        if hdate and (not idate or abs((datetime.date.fromisoformat(hdate) - datetime.date.fromisoformat(idate)).days) > 3):
            idate = hdate
        recs = extract_issue(issue, idate, pages)
        nums, mode = printed_numbers(pages)
        known = [v for v in nums.values() if v]
        st.execute('INSERT OR REPLACE INTO issue_pages VALUES (?,?,?,?)', (issue, min(known, default=None), max(known, default=None), mode))
        st.execute('DELETE FROM notices WHERE issue=?', (issue,))
        st.executemany('INSERT OR REPLACE INTO notices VALUES (?,?,?)', [(r['id'], issue, json.dumps(r, ensure_ascii=False)) for r in recs])
        st.execute('INSERT OR REPLACE INTO processed VALUES (?,?,?,?,?,?)', (issue, fetched_at, VERSION, len(recs), idate, len(pages)))
        n_new += len(recs)
        if k % 50 == 49:
            st.commit()
            print(f'  issue {issue}: {k + 1}/{len(todo)} issues, {n_new} records, {time.time() - t0:.0f}s', flush=True)
    last = st.execute('SELECT MAX(issue) FROM processed').fetchone()[0]
    st.execute("INSERT OR REPLACE INTO meta VALUES ('last_issue', ?)", (str(last),))
    if todo or not st.execute("SELECT v FROM meta WHERE k='last_run'").fetchone():
        st.execute("INSERT OR REPLACE INTO meta VALUES ('last_run', ?)", (datetime.datetime.now().isoformat(timespec='seconds'),))
    st.commit()
    return len(todo), n_new


# ---------------------------------------------------------------------------------------------
# Matching to maps.json
# ---------------------------------------------------------------------------------------------

NI_ID = re.compile(r'^(admin-areas-|ded-|deds-ni-|county-ed-|wards-|deas-|lgd-|stormont-|pc-)')
GAZ_URL = re.compile(r'thegazette\.co\.uk/Belfast/issue/(\d+)(?:/page/(\d+)|/data\.pdf)')


def load_maps(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    maps = [m for m in data['maps'] if NI_ID.match(m.get('id') or '') and not re.search(r'-raster$', m['id'])]
    cited = defaultdict(set)          # issue -> map ids
    cited_pages = defaultdict(set)    # (issue, page) -> map ids
    all_cites = []
    for m in data['maps']:
        for ref in m.get('references') or []:
            for g in GAZ_URL.finditer(ref.get('url') or ''):
                iss = int(g.group(1))
                pg = int(g.group(2)) if g.group(2) else None
                pgs = {pg} if pg else set()
                if not pg:
                    pm = re.search(r'pages? (\d+)(?:\s*-\s*(\d+))?', ref.get('note') or '')
                    if pm:
                        pgs = set(range(int(pm.group(1)), int(pm.group(2) or pm.group(1)) + 1))
                cited[iss].add(m['id'])
                for x in pgs or {None}:
                    cited_pages[(iss, x)].add(m['id'])
                all_cites.append({'map': m['id'], 'issue': iss, 'page': pg, 'pages': sorted(pgs), 'label': ref.get('label', ''),
                                  'note': ref.get('note', '')})
    return maps, cited, cited_pages, all_cites


def map_text(m):
    parts = [m.get('changeNote') or '', m.get('name') or '']
    for r in m.get('references') or []:
        parts += [r.get('label') or '', r.get('note') or '']
    return ' '.join(parts)


def place_keys(places):
    keys = set()
    for p in places:
        base = re.sub(r'\s+(Urban|Rural)\s+District|\s+Borough|^County\s+', '', p).strip()
        if base and base not in COUNTIES:
            keys.add(base.lower())
    return keys


def cite_fits(label, rec):
    """False when a citation label names a known place and the record names none of the same places."""
    named = {m.group(1).lower() for m in PLACE_RE.finditer(label.replace('Belfast Gazette', ''))}
    if not named:
        return True
    keys = place_keys(rec.get('places', [])) | {p.lower() for p in rec.get('places', [])}
    title = (rec.get('instrument') or '') + ' ' + (rec.get('title') or '')
    return bool(named & keys) or any(n in title.lower() for n in named)


def series_for(rec):
    t = rec['type']
    if t == 'electoral_division_order' and rec.get('subtype') == 'county':
        return ('county-ed-',)
    if t in ('ward_order', 'electoral_division_order', 'polling_district_order'):
        return ('ded-', 'deds-ni-')
    if t in ('boundaries_commissioner',):
        return ('lgd-', 'wards-', 'deas-')
    if t == 'parliamentary_boundaries':
        return ('pc-', 'stormont-')
    return ('admin-areas-', 'ded-', 'county-ed-')


CN_VERB = {'ward_order': 'wards re-formed', 'electoral_division_order': 'district electoral divisions altered',
           'district_alteration_order': 'boundary altered', 'district_constitution': 'constituted an urban district',
           'town_constitution': 'Towns Improvement Act adopted', 'polling_district_order': 'polling districts re-formed',
           'provisional_order': 'provisional order', 'private_bill_notice': 'private bill', 'royal_assent': 'Act',
           'statutory_rule': 'statutory rule', 'boundaries_commissioner': 'commissioner notice', 'parliamentary_boundaries': 'notice'}


def short_place(p):
    return p.replace(' Urban District', ' UD').replace(' Rural District', ' RD').replace(' Borough', ' borough')


def change_note(rs):
    groups = defaultdict(list)
    for r in rs:
        groups[r['type']].append(r)
    parts = []
    for t, items in groups.items():
        names = []
        for r in items:
            if r.get('instrument') and t not in ('ward_order', 'electoral_division_order'):
                names.append(r['instrument'])
            else:
                pl = next((p for p in r.get('places', []) if ' ' in p), (r.get('places') or ['?'])[0])
                extra = f" ({r['ward_count']} wards)" if r.get('ward_count') else ''
                names.append(short_place(pl) + extra)
        names = list(dict.fromkeys(names))
        acts = list(dict.fromkeys(a for r in items for a in r.get('enabling_acts', [])[:1]))
        parts.append(f"{CN_VERB.get(t, t).capitalize()}: {', '.join(names)}" + (f" (under the {acts[0]})" if len(acts) == 1 else ''))
    return '; '.join(parts) + '.'


def build_proposals(recs, maps, cited, cited_pages, all_cites, processed_issues, page_ranges=None):
    by_date = defaultdict(list)
    by_year = defaultdict(list)
    for m in maps:
        d = str(m.get('date') or '')
        if re.fullmatch(r'\d{4}-\d\d-\d\d', d):
            by_date[d].append(m)
        if re.match(r'\d{4}', d):
            by_year[int(d[:4])].append(m)
    mtext = {m['id']: map_text(m) for m in maps}
    proposals = defaultdict(lambda: {'references_add': [], 'changeNote_suggestions': [], 'checks': []})
    rediscovered, gaps, matched_keys = [], [], []
    rec_by_issue = defaultdict(list)
    for r in recs:
        rec_by_issue[r['issue']].append(r)
    cites_by_map_issue = defaultdict(list)
    for c in all_cites:
        cites_by_map_issue[(c['map'], c['issue'])].append(c)
        lo, hi = (page_ranges or {}).get(c['issue'], (None, None))
        if c['pages'] and lo and not any(lo <= x <= hi for x in c['pages']):
            cited_pages[(c['issue'], None)].add(c['map'])

    def add_ref(mid, r, conf, why):
        label = f"Belfast Gazette issue {r['issue']} ({display_name(r)})"
        d = r['dates']
        note_bits = [f"{short_date(r['issue_date'])}, page {r['page_number']}" if r.get('issue_date') and r.get('page_number') else r['citation']]
        if d.get('made'):
            note_bits.append(f"Made {short_date(d['made'])}")
        if d.get('in_force'):
            note_bits.append(f"In force: {short_date(d['in_force'])}")
        if d.get('assent'):
            note_bits.append(f"Royal Assent {short_date(d['assent'])}")
        note = '. '.join(note_bits) + '. ' + r['summary']
        prop = proposals[mid]
        if any(x['notice_id'] == r['id'] for x in prop['references_add']):
            return
        prop['references_add'].append({'label': label[:260], 'url': r['url'], 'note': note, 'citation': r['citation'],
                                       'notice_id': r['id'], 'notice_type': r['type'], 'confidence': round(conf, 2), 'match': why})

    for r in recs:
        if not r.get('boundary_relevant') or r['confidence'] < 0.35:
            continue
        if r['type'] in BOUNDARY_TYPES and not r.get('places'):
            continue
        if r['type'] == 'royal_assent' and not re.search(r'Extension|Boundar|Urban District|Newtownabbey|Electoral|Constituenc|Redistribution|Ward|New Town', r.get('instrument', ''), re.I):
            continue
        if r['type'] == 'statutory_rule' and not re.search(r'Boundar|Ward|Electoral|Extension|Alteration|Polling|Constituenc|District', r.get('instrument', ''), re.I):
            continue
        keys = place_keys(r.get('places', []))
        d = r.get('dates', {})
        cand_dates = [x for x in [d.get('in_force')] + d.get('in_force_all', []) + [d.get('made')] if x]
        prefixes = series_for(r)
        matched = []
        for cd in dict.fromkeys(cand_dates):
            for m in by_date.get(cd, []):
                if m['id'].startswith(prefixes):
                    matched.append((m, 'edition date equals the notice\'s ' + ('in-force' if cd != d.get('made') else 'made') + ' date'))
        if not matched and r['type'] in ('royal_assent', 'provisional_order', 'statutory_rule', 'boundaries_commissioner', 'parliamentary_boundaries', 'order_in_council'):
            base = d.get('assent') or d.get('made') or r.get('issue_date')
            if base:
                y = int(base[:4])
                for yy in (y, y + 1, y + 2):
                    for m in by_year.get(yy, []):
                        md = str(m.get('date') or '')
                        if not m['id'].startswith(prefixes) or md < base[:len(md)]:
                            continue
                        txt = mtext[m['id']].lower()
                        if keys and any(k in txt for k in keys):
                            matched.append((m, f'place named in the edition\'s notes, edition {m["date"]} follows the notice'))
                        elif r['type'] in ('boundaries_commissioner', 'parliamentary_boundaries') and yy in (y, y + 1):
                            matched.append((m, f'{r["type"].replace("_", " ")} notice in the year before edition {m["date"]}'))
        pages = set(range(r['page_number'], (r.get('page_end') or r['page_number']) + 1)) if r.get('page_number') else set()
        def label_fits(mid, rec):
            labels = [c['label'] + ' ' + c['note'][:120] for c in cites_by_map_issue.get((mid, rec['issue']), [])]
            return any(cite_fits(lb, rec) for lb in labels) if labels else True

        cited_here = set(cited_pages.get((r['issue'], None), set()))
        for pg in pages:
            cited_here |= cited_pages.get((r['issue'], pg), set())
        cited_here = {mid for mid in cited_here if label_fits(mid, r)}
        for mid in sorted(cited_here):
            rediscovered.append({'notice_id': r['id'], 'map': mid, 'citation': r['citation'], 'type': r['type'],
                                 'title': r.get('instrument') or r.get('title'),
                                 'edition_date_match': any(m['id'] == mid for m, _ in matched)})
        seen = set(cited_here)
        any_edition = bool(cited_here)
        for m, why in matched:
            if m['id'] in seen:
                continue
            seen.add(m['id'])
            any_edition = True
            txt = mtext[m['id']].lower()
            place_hit = bool(keys and any(k in txt for k in keys))
            conf = r['confidence'] * (1.0 if place_hit else 0.8)
            add_ref(m['id'], r, conf, why + ('; place already in the edition notes' if place_hit else '; place not yet in the edition notes'))
        if any_edition:
            matched_keys.append((r['type'], frozenset(keys), r.get('issue_date') or ''))
        if not any_edition and r.get('places') and r['confidence'] >= 0.5 and (r['type'] in BOUNDARY_TYPES or (r['type'] == 'royal_assent' and re.search(r'Extension|Boundar|Urban District', r.get('instrument', ''), re.I))):
            eff = d.get('in_force') or d.get('assent') or d.get('made') or r.get('issue_date')
            near = sorted((abs((datetime.date.fromisoformat(dd) - datetime.date.fromisoformat(eff)).days), dd)
                          for dd in by_date if eff and dd[:4].isdigit()) if eff else []
            gaps.append({'notice_id': r['id'], 'type': r['type'], 'subtype': r.get('subtype', ''),
                         'instrument': r.get('instrument') or r.get('title'), 'places': r.get('places', [])[:8],
                         'dates': {k: v for k, v in d.items() if k != 'in_force_all'}, 'effective_guess': eff,
                         'effective_basis': 'in force' if d.get('in_force') else ('assent' if d.get('assent') else ('made' if d.get('made') else 'issue date')),
                         'nearest_edition_dates': [x[1] for x in near[:3]], 'citation': r['citation'], 'url': r['url'],
                         'confidence': r['confidence'], 'summary': r['summary']})

    def near_match(g):
        r = next(x for x in recs if x['id'] == g['notice_id'])
        keys = frozenset(place_keys(r.get('places', [])))
        for t, k, d in matched_keys:
            if t == r['type'] and k and k == keys and d and r.get('issue_date') and \
                    abs((datetime.date.fromisoformat(d) - datetime.date.fromisoformat(r['issue_date'])).days) <= 60:
                return True
        return False
    related = [g for g in gaps if near_match(g)]
    gaps = [g for g in gaps if not near_match(g)]
    for g in related:
        g['note'] = 'same kind of notice for the same place within 60 days of one already matched: probably a reprint, correction or companion order'

    # changeNote suggestions for editions with none, and date checks on existing Gazette citations
    for mid, prop in proposals.items():
        m = next(x for x in maps if x['id'] == mid)
        good = [x for x in prop['references_add'] if x['confidence'] >= 0.6]
        if not (m.get('changeNote') or '').strip() and good:
            prop['changeNote_suggestions'].append({'proposed': change_note([next(rr for rr in recs if rr['id'] == x['notice_id']) for x in good]),
                                                   'reason': 'edition has no changeNote',
                                                   'citations': [x['citation'] for x in good], 'confidence': round(min(x['confidence'] for x in good), 2)})
    for c in all_cites:
        if c['issue'] not in processed_issues or not NI_ID.match(c['map']):
            continue
        want = set(c['pages'])
        lo, hi = (page_ranges or {}).get(c['issue'], (None, None))
        if want and lo and not any(lo <= x <= hi for x in want):
            fits = [r for r in rec_by_issue.get(c['issue'], []) if cite_fits(c['label'] + ' ' + c['note'][:120], r) and
                    place_keys(r.get('places', [])) & {m.group(1).lower() for m in PLACE_RE.finditer(c['label'].replace('Belfast Gazette', ''))}]
            proposals[c['map']]['checks'].append({
                'kind': 'page_not_a_printed_page', 'citation_label': c['label'], 'issue': c['issue'], 'cited_page': sorted(want),
                'issue_printed_pages': [lo, hi],
                'note': f"the cited page is outside this issue's printed pages {lo}-{hi} (probably a PDF page count)",
                'suggested_url': fits[0]['url'] if len(fits) == 1 else None,
                'suggested_citation': fits[0]['citation'] if len(fits) == 1 else None,
                'candidates': [f['citation'] + ' — ' + display_name(f) for f in fits[:5]]})
            want = set()
        rs = [r for r in rec_by_issue.get(c['issue'], []) if not want or not r.get('page_number')
              or want & set(range(r['page_number'], (r.get('page_end') or r['page_number']) + 1))]
        rs = [r for r in rs if cite_fits(c['label'] + ' ' + c['note'][:120], r)]
        if not rs:
            proposals[c['map']]['checks'].append({'kind': 'not_found', 'citation_label': c['label'], 'issue': c['issue'], 'page': c['page'],
                                                  'note': 'existing Gazette citation not recognised by the extractor (recall miss or not a boundary notice)'})
            continue
        for r in rs:
            for kind, word in (('made', r'Made\s+'), ('in_force', r'In force:?\s+'), ('assent', r'Royal Assent\s+')):
                v = r['dates'].get(kind)
                mm = re.search(word + r'(\d{1,2} [A-Z][a-z]{2} \d{4})', c['note'])
                if v and mm:
                    try:
                        existing = datetime.datetime.strptime(mm.group(1), '%d %b %Y').date().isoformat()
                    except ValueError:
                        continue
                    if existing != v and (kind != 'in_force' or v not in r['dates'].get('in_force_all', [])):
                        proposals[c['map']]['checks'].append({'kind': f'{kind}_date_differs', 'citation_label': c['label'], 'existing': existing,
                                                              'gazette_extracted': v, 'notice_id': r['id'], 'citation': r['citation'],
                                                              'confidence': round(r['confidence'] * 0.8, 2),
                                                              'note': 'verify against the page image before changing; OCR dates can misread'})
    return ({k: v for k, v in proposals.items() if v['references_add'] or v['changeNote_suggestions'] or v['checks']},
            rediscovered, gaps, related)


# ---------------------------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------------------------

CSV_COLS = ['id', 'issue', 'issue_date', 'page_number', 'page_end', 'page_index', 'type', 'subtype', 'title', 'instrument',
            'sr_number', 'authority', 'places', 'made', 'in_force', 'assent', 'inquiry', 'objections', 'boundary_relevant',
            'confidence', 'ocr_quality', 'summary', 'citation', 'url']


def write_outputs(st, src, out, maps_path):
    recs = [json.loads(j) for (j,) in st.execute('SELECT json FROM notices ORDER BY issue, id')]
    recs.sort(key=lambda r: (r['issue'], r['page_index'], r['id']))
    with open(out / 'boundary-notices.jsonl', 'w', encoding='utf-8', newline='\n') as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n')
    with open(out / 'boundary-notices.csv', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(CSV_COLS)
        for r in recs:
            d = r.get('dates', {})
            row = {**r, 'authority': '; '.join(r.get('authority', [])), 'places': '; '.join(r.get('places', [])),
                   'made': d.get('made', ''), 'in_force': d.get('in_force', ''), 'assent': d.get('assent', ''),
                   'inquiry': d.get('inquiry', ''), 'objections': d.get('objections', '')}
            w.writerow([row.get(c, '') if row.get(c) is not None else '' for c in CSV_COLS])

    processed = {r[0]: r for r in st.execute('SELECT issue, fetched_at, version, n, date, pages FROM processed')}
    maps, cited, cited_pages, all_cites = load_maps(maps_path)
    page_ranges = {r[0]: (r[1], r[2]) for r in st.execute('SELECT issue, first_page, last_page FROM issue_pages')}
    props, redisc, gaps, related = build_proposals(recs, maps, cited, cited_pages, all_cites, set(processed), page_ranges)
    total_ok = src.execute("SELECT COUNT(*), MIN(issue), MAX(issue), MIN(date), MAX(date) FROM issues WHERE status='ok'").fetchone()
    dates = [r[4] for r in processed.values() if r[4]]
    coverage = {'issues_processed': len(processed), 'issue_range': [min(processed, default=None), max(processed, default=None)],
                'date_range': [min(dates, default=None), max(dates, default=None)], 'pages_processed': sum(r[5] or 0 for r in processed.values()),
                'crawler_ok_issues': total_ok[0], 'crawler_max_issue': total_ok[2],
                'existing_gazette_citations_in_ni_maps_within_processed_issues': sum(1 for c in all_cites if c['issue'] in processed and NI_ID.match(c['map']))}
    stamp = (st.execute("SELECT v FROM meta WHERE k='last_run'").fetchone() or [''])[0]
    payload = {'generated': stamp, 'extractor_version': VERSION,
               'note': 'Proposals only; nothing here has been applied to maps.json. Verify each against the Gazette page before use. '
                       'Gazette content is Crown copyright under the Open Government Licence; cite facts with the given citation.',
               'coverage': coverage, 'proposals': dict(sorted(props.items())),
               'rediscovered_existing_citations': redisc, 'gaps': gaps, 'gaps_probable_reprints': related}
    (out / 'maps-json-gazette-proposals.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8', newline='\n')
    write_report(out, recs, coverage, props, redisc, gaps, stamp)
    return recs, coverage, props, redisc, gaps


def write_report(out, recs, coverage, props, redisc, gaps, stamp=''):
    types = Counter(r['type'] for r in recs)
    rel = Counter(r['type'] for r in recs if r.get('boundary_relevant'))
    decade = Counter((r['issue_date'] or '????')[:3] + '0s' for r in recs if r.get('boundary_relevant'))
    lines = ['# Belfast Gazette boundary notices: extraction report', '',
             f"Generated {stamp} (extractor v{VERSION}). Rerun: python scripts/ingest/gazette-spn/extract_boundary_notices.py", '',
             '## Coverage', '']
    for k, v in coverage.items():
        lines.append(f'- {k}: {v}')
    lines += ['', '## Records by type (all / boundary-relevant)', '']
    for t, n in types.most_common():
        lines.append(f'- {t}: {n} / {rel.get(t, 0)}')
    lines += ['', '## Boundary-relevant records by decade', '']
    for d_, n in sorted(decade.items()):
        lines.append(f'- {d_}: {n}')
    n_refs = sum(len(p['references_add']) for p in props.values())
    n_cn = sum(len(p['changeNote_suggestions']) for p in props.values())
    n_chk = sum(len(p['checks']) for p in props.values())
    lines += ['', '## maps.json proposals', '', f'- editions with proposals: {len(props)}', f'- references to add: {n_refs}',
              f'- changeNote suggestions: {n_cn}', f'- checks on existing citations: {n_chk}',
              f'- existing citations rediscovered: {len(redisc)}', f'- gaps (no matching edition): {len(gaps)}', '']
    for mid, p in sorted(props.items()):
        for x in p['references_add'][:6]:
            lines.append(f"- {mid}: + {x['label']} [{x['confidence']}] — {x['match']}")
    lines += ['', '## Gaps', '']
    for g in gaps[:200]:
        lines.append(f"- {g['effective_guess']} ({g['effective_basis']}): {g['type']} — {g['instrument'] or ''} — {', '.join(g['places'][:4])} — {g['citation']} [{g['confidence']}]")
    lines += ['', '## Sample records', '']
    for r in [r for r in recs if r.get('boundary_relevant')][:60]:
        lines.append(f"- {r['citation']}: {r['summary']} [{r['confidence']}]")
    (out / 'boundary-notices-report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    # The data folder lives outside the repo; name it with CIVGRAPH_GAZETTE_DIR (or --db/--out).
    gazette_dir = os.environ.get('CIVGRAPH_GAZETTE_DIR', '')
    ap.add_argument('--db', default=os.path.join(gazette_dir, 'gazette.sqlite') if gazette_dir else None)
    ap.add_argument('--out', default=os.path.join(gazette_dir, 'extracted') if gazette_dir else None)
    ap.add_argument('--maps', default=str(ROOT / 'data' / 'database' / 'maps.json'))
    ap.add_argument('--rebuild', action='store_true', help='forget the resume state and reprocess every issue')
    ap.add_argument('--from-issue', type=int)
    ap.add_argument('--to-issue', type=int)
    ap.add_argument('--limit', type=int, help='process at most this many new issues this run')
    ap.add_argument('--no-extract', action='store_true', help='only rewrite outputs from the saved state')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{Path(args.db).as_posix()}?mode=ro", uri=True)
    state_path = out / 'extract-state.sqlite'
    if args.rebuild and state_path.exists():
        state_path.unlink()
    st = open_state(state_path)
    if not args.no_extract:
        n_issues, n_recs = run_extract(src, st, args)
        print(f'Processed {n_issues} new or changed issues, {n_recs} records.')
    recs, cov, props, redisc, gaps = write_outputs(st, src, out, args.maps)
    print(f"Coverage: {cov['issues_processed']} issues {cov['issue_range']} ({cov['date_range'][0]} to {cov['date_range'][1]}), "
          f"{len(recs)} records ({sum(1 for r in recs if r.get('boundary_relevant'))} boundary-relevant); "
          f"{len(props)} editions with proposals, {len(redisc)} existing citations rediscovered, {len(gaps)} gaps.")
    print(f'Outputs in {out}')


if __name__ == '__main__':
    sys.exit(main())
