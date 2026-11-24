#!/usr/bin/env python3
"""Pure helpers for the Northern Ireland censuses of 1926, 1937, 1951, 1961 and 1966 (stream
w23-census-1926-61): reading printed numbers, naming areas, checking a table against its own
printed totals, apportioning counts to 2021 Data Zones and building stable areas.

Nothing here reads or writes files: the drivers (hist_census_*.py) do that. The unit tests are
in hist-census-1926-61.test.mjs.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

# ---------------------------------------------------------------------------------------------
# Numbers as printed


def parse_int(value):
    """A printed count, or None for a blank, a dash or a dot (the reports print '.' for nil and
    '-' for not given). Footnote markers ('2,198 [Note 3]', '1,234*') are dropped.

    >>> parse_int('1,234 [Note 2]')
    1234
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value)) if value == value else None
    s = str(value)
    s = re.sub(r'\[[^\]]*\]', '', s)          # [Note x]
    s = s.replace('—', '-').replace('–', '-').strip()
    s = s.rstrip('*†‡§').strip()
    if s in ('', '-', '.', '..', '...', '…'):
        return None
    neg = s.startswith('-') and len(s) > 1
    digits = re.sub(r'[,\s]', '', s.lstrip('+-'))
    if not re.fullmatch(r'\d+', digits):
        return None
    n = int(digits)
    return -n if neg else n


def acres(a, r=0, p=0):
    """Statute acres from acres, roods and perches (4 roods to the acre, 40 perches to the rood)."""
    a, r, p = parse_int(a), parse_int(r) or 0, parse_int(p) or 0
    if a is None:
        return None
    return round(a + r / 4 + p / 160, 4)


# ---------------------------------------------------------------------------------------------
# Area names

_NOTE = re.compile(r'\[\s*note[^\]]*\]?|\((?:[a-z]{1,2}|\d)\)', re.I)


def strip_notes(name):
    """'Newry No.2 Rural District [Note aa]' -> 'Newry No.2 Rural District'."""
    s = _NOTE.sub('', str(name or ''))
    return re.sub(r'\s+', ' ', s).strip(' ,.')


def split_ded_label(label):
    """A DED label as the county tables print it: '(TOTAL) 12. Name D.E.D. (or Ward)'.

    Returns (ref, name, ward) where ref is the serial number in the county table (int or None),
    name is the division's own name and ward the ward name where the DED is also a ward
    ('Ballymena No. 1 Urban D.E.D. or Market Ward' -> ward 'Market').
    """
    s = strip_notes(label)
    s = re.sub(r'^\s*total\s+', '', s, flags=re.I)
    m = re.match(r'^\s*(\d+)\s*(?:[.,]\s*|\s+)(.*)$', s)
    ref = int(m.group(1)) if m else None
    s = m.group(2) if m else s
    ward = None
    mw = re.search(r'\bor\s+(.*?)\s*ward\b\.?$', s, re.I)
    if mw:
        ward = mw.group(1).strip(' ,.') or None
        s = s[:mw.start()]
    s = re.sub(r'\bD\.?\s*E\.?\s*D\.?(?=\s|$)', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' ,.')
    return ref, s, ward


def norm_key(name):
    """A matching key for an area name: case, accents, punctuation, 'St'/'Saint', the words
    'Urban', 'Rural', 'D.E.D.', 'Ward' and the '&' vs 'and' spelling are ignored.
    'Ballymena No. 1 Urban' and 'BALLYMENA NO.1 URBAN' share a key; 'Rich Hill' and 'Richhill'
    too. The alias file handles everything this does not.
    """
    s = unicodedata.normalize('NFKD', strip_notes(name)).encode('ascii', 'ignore').decode().lower()
    s = s.replace('&', ' and ')
    s = re.sub(r'\bsaint\b', 'st', s)
    s = re.sub(r'\bd\.?\s*e\.?\s*d\.?(?=\s|$)', ' ', s)
    s = re.sub(r'\b(urban|rural|ward|number|no)\b', ' ', s)
    return re.sub(r'[^a-z0-9]', '', s)


def district_kind(name):
    """'urban_district', 'rural_district', 'county_borough', 'municipal_borough' or None."""
    s = strip_notes(name).lower()
    if 'county borough' in s:
        return 'county_borough'
    if 'municipal borough' in s or re.search(r'\bborough\b', s):
        return 'municipal_borough'
    if 'urban district' in s:
        return 'urban_district'
    if 'rural district' in s:
        return 'rural_district'
    return None


# ---------------------------------------------------------------------------------------------
# Checks against a table's own printed totals


def check_sum(parts, total, tolerance=0):
    """('ok'|'fail'|'na', difference): parts that should add to a printed total. A part or the
    total being unknown (None) makes the check 'na', never 'ok'."""
    if total is None or any(p is None for p in parts) or not parts:
        return 'na', None
    diff = sum(parts) - total
    return ('ok' if abs(diff) <= tolerance else 'fail'), diff


def check_sexes(persons, males, females):
    """Males + females = persons."""
    return check_sum([males, females], persons)


def check_rows(rows, parent_key, total_of, value_keys=('persons', 'males', 'females')):
    """Children summing to their parent, for each value. rows: dicts with 'key', parent_key and
    values. total_of: parent key -> dict of printed totals. Returns check records."""
    by_parent = defaultdict(list)
    for r in rows:
        by_parent[r[parent_key]].append(r)
    out = []
    for parent, kids in sorted(by_parent.items(), key=lambda kv: str(kv[0])):
        tot = total_of.get(parent)
        for v in value_keys:
            status, diff = check_sum([k.get(v) for k in kids], (tot or {}).get(v))
            out.append({'parent': parent, 'variable': v, 'children': len(kids), 'status': status, 'diff': diff})
    return out


def row_status(checks):
    """One verdict for an area from its checks: 'fail' beats 'ok' beats 'na'."""
    st = [c for c in checks if c is not None]
    if 'fail' in st:
        return 'fail'
    if 'ok' in st:
        return 'ok'
    return 'na'


# ---------------------------------------------------------------------------------------------
# Apportioning counts


def apportion(totals, weights):
    """Apportion each unit's count over its pieces in proportion to the pieces' weights.

    totals: unit -> count. weights: unit -> {piece: weight >= 0}. A unit whose weights sum to 0
    is split equally (and reported). Returns (piece -> share of each unit), as
    {unit: {piece: value}}, and the list of units that fell back. The values of a unit always add
    back to its count exactly (to float precision): nothing is fitted, nothing is lost.
    """
    out, fell_back = {}, []
    for unit, total in totals.items():
        w = weights.get(unit) or {}
        if not w:
            fell_back.append(unit)
            out[unit] = {}
            continue
        s = sum(w.values())
        if s <= 0:
            fell_back.append(unit)
            n = len(w)
            out[unit] = {k: total / n for k in w}
        else:
            out[unit] = {k: total * v / s for k, v in w.items()}
    return out, fell_back


def dasymetric_weights(area_by_piece, town_area_by_piece, town_total, unit_total):
    """Town-aware weights for one unit: the printed town population goes to the pieces of the
    town footprint (by their share of the footprint's area), the rest of the unit's population
    to the pieces outside it (by area). Returns piece -> persons (adds to unit_total), or None
    when there is no footprint or no area outside it (the caller falls back to area weights).

    area_by_piece: piece -> area of the piece inside the unit. town_area_by_piece: piece -> area
    of the town footprint in that piece (<= the piece's area).
    """
    if unit_total is None or not town_total or town_total <= 0:
        return None
    town_area = sum(town_area_by_piece.values())
    rest_area = {k: max(0.0, a - town_area_by_piece.get(k, 0.0)) for k, a in area_by_piece.items()}
    rest_sum = sum(rest_area.values())
    if town_area <= 0:
        return None
    town_total = min(town_total, unit_total)
    remainder = unit_total - town_total
    if rest_sum <= 0 and remainder > 0:
        return None
    out = {}
    for k in area_by_piece:
        v = town_total * town_area_by_piece.get(k, 0.0) / town_area
        if remainder > 0:
            v += remainder * rest_area[k] / rest_sum
        out[k] = v
    return out


# ---------------------------------------------------------------------------------------------
# Housing-stock (valuation era band) weighting. The callers read the private valuation extract;
# nothing here sees a property, only counts per piece.

# census day as a fraction of the year (1926: 18 Apr; 1937: 28 Feb; 1951: 8 Apr; 1961: 23 Apr;
# 1971: 25 Apr; 1981: 5 Apr; 1991: 21 Apr; 2001: 29 Apr; 2011: 27 Mar)
CENSUS_DAY = {'1926': 1926.3, '1937': 1937.16, '1951': 1951.27, '1961': 1961.31, '1971': 1971.31, '1981': 1981.26,
              '1991': 1991.3, '2001': 2001.33, '2011': 2011.24}
STOCK_AREA_ABOVE = 20.0    # persons per surviving qualifying property above which stock is not used
STOCK_BLEND_ABOVE = 12.0   # ... and above which stock and area are blended half and half
OPEN_BAND_END = 2025.0     # where an open-ended band ('Post 2005', '2006 onwards') is taken to end
_ERA_RANGE = re.compile(r'^(\d{4})\s*-\s*(\d{4})')
_ERA_POST = re.compile(r'^Post[ -]?(\d{4})', re.I)
_ERA_OPEN = re.compile(r'^(\d{4})\s*(?:\+|-\s*$|-\s*(?:present|date|current|now)\b|onwards\b|or later\b|and later\b)', re.I)


def era_band(subclass, open_end=OPEN_BAND_END):
    """(kind, first year, years) of a valuation era band, or (None, None, None) for a property
    with none (apartments carry no band). Kinds: 'pre' (Pre 1919, Pre-1919: built before every
    census here), 'inter-war' (1919-1945), 'range' ('1946-1965', '1966-1990', ...), 'open'
    ('Post 2005' from 2006, '2006 onwards', '2006+', '2006-present': up to open_end).

    >>> era_band('1966-1990')
    ('range', 1966, 25)
    """
    s = str(subclass or '').strip()
    if re.match(r'^Pre[ -]?1919', s, re.I):
        return 'pre', None, None
    if re.match(r'^Inter-?War', s, re.I):
        return 'inter-war', 1919, 27
    m = _ERA_RANGE.match(s)
    if m and not _ERA_OPEN.match(s):
        start = int(m.group(1))
        return 'range', start, int(m.group(2)) - start + 1
    m = _ERA_POST.match(s)
    if m:
        start = int(m.group(1)) + 1
        return 'open', start, max(open_end - start, 1e-9)
    m = _ERA_OPEN.match(s)
    if m:
        start = int(m.group(1))
        return 'open', start, max(open_end - start, 1e-9)
    return None, None, None


def era_weight(subclass, census_day, open_end=OPEN_BAND_END):
    """The share of a domestic property's valuation era band that was built by census day,
    assuming building spread evenly over the band's years: Pre 1919 (or Pre-1919) 1; Inter-War
    (1919-1945, 27 years) (day - 1919) / 27; a 'YYYY-YYYY' band (1946-1965, 1966-1990, ...)
    (day - first year) / its years; an open band ('Post 2005', '2006 onwards') the same up to
    open_end; clamped to 0..1. Anything else (apartments carry no band) 0.

    >>> round(era_weight('1966-1990', 1971.31), 4)   # 5.31 of the band's 25 years
    0.2124
    """
    kind, start, years = era_band(subclass, open_end)
    if kind is None:
        return 0.0
    if kind == 'pre':
        return 1.0
    return max(0.0, min(1.0, (census_day - start) / years))


def stock_weight(subclass, census_day, open_end=OPEN_BAND_END, bandless=0.0):
    """A domestic property's weight on census day: era_weight for a property with an era band;
    bandless (default 0: left out) for one with none (apartments carry no band, so their build
    date is unknown; a run may count them, e.g. 1, for the later censuses)."""
    if era_band(subclass, open_end)[0] is None:
        return float(bandless)
    return era_weight(subclass, census_day, open_end)


def era_band_table(counts, census_days, open_end=OPEN_BAND_END):
    """One row per era band as it is spelt, with its kind and its weight on each census day, so a
    run shows which bands count and which it does not recognise. counts: band -> number of
    domestic properties (aggregate; nothing per property); census_days: year -> census day.
    Rows: {'band', 'kind' ('none' where unrecognised), 'properties', 'weight_<year>' ...}, most
    properties first."""
    rows = []
    for band, n in sorted(counts.items(), key=lambda kv: (-kv[1], str(kv[0]))):
        kind = era_band(band, open_end)[0] or 'none'
        r = {'band': band, 'kind': kind, 'properties': n}
        for y, day in census_days.items():
            r[f'weight_{y}'] = round(era_weight(band, day, open_end), 4)
        rows.append(r)
    return rows


def stock_guard(persons, stock, area_above=STOCK_AREA_ABOVE, blend_above=STOCK_BLEND_ABOVE):
    """The survivor-bias guard: (mode, persons per surviving property). Where the surviving
    stock is implausibly small for the people it must hold (demolished housing), the stock is
    not trusted: above area_above persons per property area weighting is used, above
    blend_above half stock, half area."""
    if stock <= 0:
        return 'area (no qualifying stock)', None
    ratio = persons / stock
    if ratio > area_above:
        return f'area (persons per surviving property > {area_above:g})', ratio
    if ratio > blend_above:
        return f'blend (persons per surviving property {blend_above:g}-{area_above:g})', ratio
    return 'stock', ratio


def _norm(d):
    s = sum(d.values())
    return {k: v / s for k, v in d.items()} if s > 0 else None


def stock_unit_weights(area_by, fp_area, s_all, s_in, town_total, persons,
                       area_above=STOCK_AREA_ABOVE, blend_above=STOCK_BLEND_ABOVE):
    """Housing-weighted persons per piece of one unit (a DED, ward or pool).

    area_by: piece -> area; fp_area: piece -> area of the town footprint(s) in it; s_all: piece ->
    qualifying stock (era-weighted properties) in it; s_in: piece -> the part of that stock inside
    the footprint; town_total: printed town population in the unit (0 if none).

    Towns first: the town population (capped at the unit's) goes inside the footprint by the
    stock there (by footprint area where there is none). The rest goes outside the footprint by
    stock, guarded by stock_guard (area, or a half-and-half blend, where persons per surviving
    property is implausibly high). Where the unit has no land outside the footprint the rest
    goes inside too. Returns (weights, mode, persons per property, persons outside towns, stock
    outside towns); the weights add to persons exactly.
    """
    keys = list(area_by)
    s_in = {i: s_in.get(i, 0.0) for i in keys}
    s_out = {i: max(0.0, s_all.get(i, 0.0) - s_in[i]) for i in keys}
    tt = min(town_total, persons) if town_total else 0.0
    rem = persons - tt
    so = sum(s_out.values())
    mode, ratio = stock_guard(rem, so, area_above, blend_above)
    d_area = _norm({i: area_by[i] for i in keys}) or {i: 1.0 / len(keys) for i in keys}
    d_in = _norm(s_in) or _norm({i: fp_area.get(i, 0.0) for i in keys}) or d_area
    d_out_area = _norm({i: max(0.0, area_by[i] - fp_area.get(i, 0.0)) for i in keys}) or d_in
    d_out_stock = _norm(s_out) or d_out_area
    if mode == 'stock':
        d_out = d_out_stock
    elif mode.startswith('blend'):
        d_out = {i: 0.5 * d_out_stock[i] + 0.5 * d_out_area[i] for i in keys}
    else:
        d_out = d_out_area
    w = {i: rem * d_out[i] + tt * d_in[i] for i in keys}
    return w, mode, ratio, rem, so


def stock_apportion(pieces, totals, area_above=STOCK_AREA_ABOVE, blend_above=STOCK_BLEND_ABOVE):
    """Housing-weighted placement for units with no town figures (the 1984 wards of 1991, the
    output areas of 2001, the small areas of 2011): each unit's count goes to its pieces (the unit
    cut by the Data Zones) by qualifying stock, guarded by stock_guard, by area beside it.

    pieces: [(piece id, unit, area, qualifying stock)]; totals: unit -> persons.
    Returns {'stock': piece -> persons, 'area': piece -> persons, 'flags': [one per unit not by
    stock: unit, persons, stock, persons per property, mode], 'lost': [units with no piece]}.
    Each unit's pieces add back to its count exactly under both methods.
    """
    by_unit = defaultdict(list)
    for pid, unit, area, stock in pieces:
        by_unit[unit].append((pid, float(area), float(stock)))
    w_stock, w_area, flags = {}, {}, []
    for unit, P in totals.items():
        lst = by_unit.get(unit)
        if not lst:
            continue
        area_by = {pid: a for pid, a, _ in lst}
        s_all = {pid: s for pid, _, s in lst}
        tot = sum(area_by.values())
        for pid, a in area_by.items():
            w_area[pid] = P * a / tot if tot > 0 else P / len(area_by)
        if tot <= 0:
            area_by = {pid: 1.0 for pid in area_by}
        w, mode, ratio, _, so = stock_unit_weights(area_by, {}, s_all, {}, 0, P, area_above, blend_above)
        w_stock.update(w)
        if mode != 'stock':
            flags.append({'unit': unit, 'persons': P, 'qualifying_stock': so,
                          'persons_per_property': ratio, 'used': mode})
    lost = [u for u in totals if u not in by_unit]
    return {'stock': w_stock, 'area': w_area, 'flags': flags, 'lost': lost}


def share_town(persons, stock_by_ward, area_by_ward):
    """A town's printed population shared among the wards its footprint lies in: by the
    qualifying stock inside the footprint in each ward, by footprint area where there is none."""
    d = _norm({k: v for k, v in stock_by_ward.items() if v > 0}) or _norm({k: v for k, v in area_by_ward.items() if v > 0})
    return {k: persons * v for k, v in d.items()} if d else {}


def settlement_index(names):
    """{key: [(settlement name, qualifier)]} for matching printed town names to the 2015
    settlements: 'DROMORE (BANBRIDGE LGD)' under 'dromore' with qualifier 'BANBRIDGE LGD',
    'OMAGH TOWN' and 'DERRY CITY' under 'omagh' and 'derry', 'WARRENPOINT / BURREN' under both,
    'HILLSBOROUGH AND CULCAVY' under both, 'CRAIGAVON URBAN AREA including ...' under 'craigavon'."""
    idx = defaultdict(list)
    for n in names:
        s = str(n)
        q = ''
        m = re.match(r'^(.*?)\s*\(([^)]*)\)\s*$', s)
        if m:
            s, q = m.group(1), m.group(2)
        s = re.sub(r'\s+URBAN AREA\b.*$', '', s, flags=re.I)
        s = re.sub(r'\s+(CITY|TOWN)$', '', s, flags=re.I)
        parts = re.split(r'\s+/\s+|\s+AND\s+', s) if not re.search(r'\bLGD\b', s) else [s]
        for p in {s, *parts}:
            k = norm_key(p)
            if k and (n, q) not in idx[k]:
                idx[k].append((n, q))
    return dict(idx)


SETTLEMENT_ALIASES = {'londonderry': 'derry', 'ballykinlercamp': 'ballykinler'}


def match_settlement(index, town, district='', county=''):
    """The 2015 settlement name(s) for a printed town (its name before any '(part ..)' or 'Town'),
    or [] when there is none or the choice is ambiguous. Several settlements of the same name are
    told apart by their qualifier, which must name the town's district or county."""
    base = re.split(r'\s+\(|\s+Town\b', str(town))[0]
    k = norm_key(base)
    cands = index.get(k) or index.get(SETTLEMENT_ALIASES.get(k, ''), [])
    names = sorted({n for n, _ in cands})
    if len(names) <= 1:
        return names
    keys = [norm_key(x) for x in (district, county) if x]
    qual = sorted({n for n, q in cands if q and any(x and x in norm_key(q) for x in keys)})
    if len(qual) == 1:
        return qual
    plain = sorted({n for n, q in cands if not q})
    return plain if len(plain) == 1 else []


def pair_leftovers(left_a, left_b, min_ratio=0.6):
    """One-to-one pairs of (group, name key) left unmatched on two sides (spelling variants such as
    'warringstown' and 'waringstown'): first within the same group, best similarity first and at
    least min_ratio; then the same name in another group. Returns {a: b}."""
    import difflib
    out, used = {}, set()
    cands = sorted(((difflib.SequenceMatcher(None, a[1], b[1]).ratio(), a, b) for a in left_a for b in left_b if a[0] == b[0]),
                   reverse=True)
    for r, a, b in cands:
        if r >= min_ratio and a not in out and b not in used:
            out[a] = b
            used.add(b)
    for a in left_a:
        if a in out:
            continue
        same = [b for b in left_b if b not in used and b[1] == a[1]]
        if len(same) == 1:
            out[a] = same[0]
            used.add(same[0])
    return out


def dissimilarity(prev, cur):
    """Share of people who would have to move for cur's distribution over areas to match prev's
    (half the sum of absolute differences of the two shares; 0 = the same pattern, growth apart).
    prev, cur: area -> persons."""
    a, b = sum(prev.values()), sum(cur.values())
    if a <= 0 or b <= 0:
        return None
    return 0.5 * sum(abs(cur.get(k, 0.0) / b - prev.get(k, 0.0) / a) for k in set(prev) | set(cur))


# ---------------------------------------------------------------------------------------------
# Stable areas


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if str(ra) < str(rb):
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


def stable_areas(dz_units, nest_share=0.95):
    """The smallest groups of Data Zones that each hold whole historic units in every year.

    dz_units: {year: {dz: {unit: share of the dz in that unit}}} (shares of the DZ's area or
    population, summing to ~1 per DZ). A DZ nests in a unit when one unit holds >= nest_share of
    it; a DZ that does not nest ties together every unit holding at least (1 - nest_share) of
    it. Every DZ joins the units it nests in or straddles, and two DZs end up together when they
    share a unit in any year. Returns {dz: group id} with ids the smallest DZ code of the group.
    """
    uf = UnionFind()
    for year, dzs in dz_units.items():
        for dz, shares in dzs.items():
            uf.find(('dz', dz))
            if not shares:
                continue
            top_unit, top = max(shares.items(), key=lambda kv: kv[1])
            if top >= nest_share:
                uf.union(('dz', dz), ('u', year, top_unit))
            else:
                for unit, sh in shares.items():
                    if sh >= 1 - nest_share:
                        uf.union(('dz', dz), ('u', year, unit))
    groups = defaultdict(list)
    for node in list(uf.parent):
        if node[0] == 'dz':
            groups[uf.find(node)].append(node[1])
    out = {}
    for members in groups.values():
        gid = min(members)
        for dz in members:
            out[dz] = gid
    return out


# ---------------------------------------------------------------------------------------------
# OCR rows (tesseract --psm 6 text, one printed row per line, more or less)

_NUM = re.compile(r'(?<![\w.])[-+]?\d{1,3}(?:[,.]\d{3})+(?![\d])|(?<![\w.,])\d+(?:\.\d+)?(?![\w,])')


def ocr_numbers(line):
    """The numeric tokens of an OCR line, in order, as strings ('1,234', '0.98', '12').

    Common misreads are mended first: 'l' or 'I' between digits is 1, 'O' between digits is 0,
    a stray '|', ']', '}', ')' or ';' after a number is a column rule.
    """
    s = line
    s = re.sub(r'(?<=\d)[lI](?=\d)', '1', s)
    s = re.sub(r'(?<=\d)[oO](?=\d)', '0', s)
    s = re.sub(r'(?<=\d)[\]\}\)\|;:!]', ' ', s)
    s = re.sub(r'[\[\{\(\|](?=\d)', ' ', s)
    return [m.group(0) for m in _NUM.finditer(s)]


def to_count(tok):
    """'1,234' or '1.234' (a misread comma) -> 1234; '0.98' (a ratio) -> None."""
    if re.fullmatch(r'\d{1,3}(?:[,.]\d{3})+', tok):
        return int(re.sub(r'[,.]', '', tok))
    if re.fullmatch(r'\d+', tok):
        return int(tok)
    return None


# ---------------------------------------------------------------------------------------------
# Matching census areas to boundary-layer features


def urban_flag(name, district=''):
    """'urban', 'rural' or '' for a DED: from its own name ('Lurgan Urban', 'Lurgan Rural'), else
    from its district ('... Urban District', a borough) for the census side."""
    s = strip_notes(name).lower()
    if re.search(r'\brural\b', s):
        return 'rural'
    if re.search(r'\burban\b', s):
        return 'urban'
    k = district_kind(district or '')
    if k in ('urban_district', 'municipal_borough', 'county_borough'):
        return 'urban'
    if k == 'rural_district':
        return 'rural'
    return ''


def match_units(census, layer, aliases=None, fuzzy=0.82):
    """Match census rows to layer features.

    census: [{'id', 'county', 'name', 'district', 'ward'(optional)}]; layer: [{'id', 'county', 'name'}].
    Counties compare case-blind; county-borough wards match in any county (Belfast's wards lie
    in Antrim and Down on the map). Order: an alias ({census id: layer id}), then the same key
    (norm_key) in the county, told apart by urban/rural where a key repeats, then the ward name,
    then the closest unmatched name in the county (difflib ratio >= fuzzy), one to one.
    Returns ({census id: (layer id, how)}, unmatched census ids, unmatched layer ids).
    """
    import difflib
    aliases = aliases or {}
    out = {}
    used = set()

    def cty(c):
        return str(c or '').split()[0].upper()

    lay_by = defaultdict(list)
    for f in layer:
        keys = {norm_key(f['name']), norm_key(re.sub(r'\([^)]*\)', '', f['name']))}
        inner = re.search(r'\(([^)]*)\)', f['name'])
        if inner:   # 'BALLYMENA No. 3 URBAN (HARRYVILLE)' is the Harryville ward
            keys.add(norm_key(inner.group(1)))
        for k in keys:
            lay_by[(cty(f['county']), k)].append(f)
            lay_by[('*', k)].append(f)
    for c in census:
        if c['id'] in aliases and aliases[c['id']] not in used:
            out[c['id']] = (aliases[c['id']], 'alias')
            used.add(aliases[c['id']])
    for c in census:
        if c['id'] in out:
            continue
        # Belfast's wards lie in Antrim and Down on the map; Londonderry's stay in their county
        cb = district_kind(c.get('district', '')) == 'county_borough' and cty(c['county']) == 'BELFAST'
        keys = ([norm_key(c['ward'])] if c.get('ward') else []) + [norm_key(c['name'])]
        if district_kind(c.get('district', '')) in ('urban_district', 'municipal_borough'):
            # 1961 prints a borough's wards by ward name alone ('North'); the map has 'BALLYCASTLE NORTH'
            town = re.sub(r'\s+(Urban District|Municipal Borough)$', '', strip_notes(c['district']))
            keys.append(norm_key(f"{town} {c['name']}"))
        for k in keys:
            cands = [f for f in lay_by[('*' if cb else cty(c['county']), k)] if f['id'] not in used]
            if c.get('district'):
                # the map's own district, where it gives one, must agree (Belfast's Victoria ward
                # is not Newtownards's Victoria ward)
                ck_ = norm_key(c['district']) + district_kind(c['district'])
                cands = [f for f in cands if not f.get('district')
                         or norm_key(f['district']) + district_kind(f['district']) == ck_]
            if len(cands) > 1:
                fl = urban_flag(c['name'], c.get('district', ''))
                cands = [f for f in cands if urban_flag(f['name']) in (fl, '')] or cands
                exact = [f for f in cands if urban_flag(f['name']) == fl]
                cands = exact if len(exact) == 1 else cands
            if len(cands) == 1:
                out[c['id']] = (cands[0]['id'], 'ward name' if c.get('ward') and k == keys[0] else 'name')
                used.add(cands[0]['id'])
                break
    # fuzzy, best pairs first
    pairs = []
    for c in census:
        if c['id'] in out:
            continue
        for f in layer:
            if f['id'] in used or (cty(f['county']) != cty(c['county'])
                                   and district_kind(c.get('district', '')) != 'county_borough'):
                continue
            if f.get('district') and c.get('district') and                     norm_key(f['district']) + district_kind(f['district']) != norm_key(c['district']) + district_kind(c['district']):
                continue   # the map says another district (Carnmoney is not Carnmoon)
            r = difflib.SequenceMatcher(None, norm_key(c['name']), norm_key(f['name'])).ratio()
            if r >= fuzzy:
                pairs.append((r, c['id'], f['id']))
    for r, cid, fid in sorted(pairs, reverse=True):
        if cid in out or fid in used:
            continue
        out[cid] = (fid, f'fuzzy {r:.2f}')
        used.add(fid)
    return out, [c['id'] for c in census if c['id'] not in out], [f['id'] for f in layer if f['id'] not in used]
