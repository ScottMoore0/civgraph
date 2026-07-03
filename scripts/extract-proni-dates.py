#!/usr/bin/env python3
"""
Civgraph 'Additional Data' — Extracted Dates pipeline.

Reads the original PRONI `dates` free text for every record and produces a
cleaned, structured version:
  ext_start_date / ext_end_date  (EDTF/ISO-8601-2 partial dates, native precision:
                                  '1906', '1897-04' or '1973-04-12' — never padded)
  ext_start_year / ext_end_year  (ints — power the app's From/To range filter)
  ext_precision                  (day|month|year|decade|century|range|'')
  ext_circa                      (approximate — source said 'c.'/'circa')
  ext_estimated                  (source date was square-bracketed or queried '?',
                                  i.e. supplied/estimated by the PRONI cataloguer)
  ext_bound                      ('after' | 'before' | '' — one-sided open date, e.g.
                                  'post 1929' -> after; the open side's year is NULL)
  ext_undated                    (flag)
  ext_display                    (human string, e.g. '12 April 1973 – 10 May 1973')
  needs_review                   (1 = ambiguous: bracketed/uncertain/century)

Manual overrides: rows in data/proni/date-overrides.csv (keyed by PRONI ref)
win over the auto-extraction, so you can correct records 'to an extent'. The
run is idempotent — re-run any time after editing the overrides file.

Outputs:
  D:/PRONI/eCatalogue/extracted-dates.sqlite   (table `ext`, keyed by ref -> for D1)
  D:/PRONI/eCatalogue/date-needs-review.csv     (the needs_review rows to work from)
"""
import sqlite3, re, csv, os

SRC = r"D:/PRONI/eCatalogue/proni.sqlite"
OUT_DB = r"D:/PRONI/eCatalogue/extracted-dates.sqlite"
REVIEW_CSV = r"D:/PRONI/eCatalogue/date-needs-review.csv"
OVERRIDES = os.path.join(os.path.dirname(__file__), "..", "data", "proni", "date-overrides.csv")

MONTHNAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
              'August', 'September', 'October', 'November', 'December']
MONTHS = {m.lower(): i for i, m in enumerate(MONTHNAMES) if m}
for a, f in [('jan', 'january'), ('feb', 'february'), ('mar', 'march'), ('apr', 'april'),
             ('jun', 'june'), ('jul', 'july'), ('aug', 'august'), ('sep', 'september'),
             ('sept', 'september'), ('oct', 'october'), ('nov', 'november'), ('dec', 'december')]:
    MONTHS[a] = MONTHS[f]
ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6, 'seventh': 7,
       'eighth': 8, 'ninth': 9, 'tenth': 10, 'eleventh': 11, 'twelfth': 12, 'thirteenth': 13,
       'fourteenth': 14, 'fifteenth': 15, 'sixteenth': 16, 'seventeenth': 17, 'eighteenth': 18,
       'nineteenth': 19, 'twentieth': 20, 'twenty-first': 21, 'twenty first': 21}
YEAR = r"(1\d{3}|20\d{2})"  # 1000-2099 (PRONI holds medieval records, e.g. 1215)


def parse_expr(s):
    s = s.strip()
    if not s:
        return None
    if '[' in s or ']' in s or '?' in s:            # supplied/queried -> ext_estimated (set in extract)
        s = s.replace('[', '').replace(']', '').replace('?', '').strip()
    circa = False
    if re.match(r"^(c\.?\s*|circa\s+)", s, re.I):
        circa = True; s = re.sub(r"^(c\.?\s*|circa\s+)", "", s, flags=re.I).strip()
    # one-sided bound word, anchored at the start and followed by a date -> after/before.
    # NB: 'by'/'from' deliberately excluded (they mean "endorsed by <person>" / "from <place>").
    bound = None
    m = re.match(r"(not\s+before|post|after|since)\b", s, re.I)
    if m:
        bound = 'after'; s = s[m.end():].strip()
    else:
        m = re.match(r"(not\s+after|pre|before|until|ante)\b", s, re.I)
        if m:
            bound = 'before'; s = s[m.end():].strip()
    low = s.lower()
    def cnum(w):
        return ORD.get(w) or (int(re.match(r"(\d{1,2})", w).group(1)) if re.match(r"\d", w) else None)
    # multi-century span: '17th and 18th centuries' -> 1600-1799, '13th or 14th' -> 1200-1399
    m = re.search(r"([\w-]+)\s+(?:and|or)\s+([\w-]+)\s+cent(?:ury|uries)?\.?", low)
    if m:
        cs = [cnum(m.group(1)), cnum(m.group(2))]
        if all(cs):
            return dict(y=(min(cs) - 1) * 100, m=None, d=None, prec='century', circa=circa, bound=bound, y_end=(max(cs) - 1) * 100 + 99)
    m = re.search(r"([\w-]+)\s+cent(?:ury|uries)?\.?", low)  # 'century', 'centuries', 'Cent.'
    if m:
        c = cnum(m.group(1))
        if c:
            return dict(y=(c - 1) * 100, m=None, d=None, prec='century', circa=circa, bound=bound, y_end=(c - 1) * 100 + 99)
    m = re.match(r"(1\d\d|20\d)0s\b", low)
    if m:
        y = int(m.group(1)) * 10
        return dict(y=y, m=None, d=None, prec='decade', circa=circa, bound=bound, y_end=y + 9)
    m = re.match(r"(\d{1,2})\s+([A-Za-z]+)\s+" + YEAR, s)
    if m and m.group(2).lower() in MONTHS:
        return dict(y=int(m.group(3)), m=MONTHS[m.group(2).lower()], d=int(m.group(1)), prec='day', circa=circa, bound=bound)
    m = re.match(r"([A-Za-z]+)\s+" + YEAR, s)
    if m and m.group(1).lower() in MONTHS:
        return dict(y=int(m.group(2)), m=MONTHS[m.group(1).lower()], d=None, prec='month', circa=circa, bound=bound)
    m = re.search(YEAR, s)
    if m:
        return dict(y=int(m.group(1)), m=None, d=None, prec='year', circa=circa, bound=bound)
    return None


def edtf(y, m, d):
    """Variable-precision EDTF / ISO-8601-2 partial date — never padded, so the
    string's own length carries the precision: '1906', '1897-04', '1973-04-12'."""
    if y is None:
        return ''
    if d and m:
        return f"{y:04d}-{m:02d}-{d:02d}"
    if m:
        return f"{y:04d}-{m:02d}"
    return f"{y:04d}"


def ordinal(n):
    suf = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f"{n}{suf}"


def fmt(e):
    if e['d'] and e['m']:
        b = f"{e['d']} {MONTHNAMES[e['m']]} {e['y']}"
    elif e['m']:
        b = f"{MONTHNAMES[e['m']]} {e['y']}"
    elif e['prec'] == 'decade':
        b = f"{e['y']}s"
    elif e['prec'] == 'century':
        c1 = e['y'] // 100 + 1
        c2 = (e.get('y_end') or e['y']) // 100 + 1
        b = f"{ordinal(c1)} century" if c1 == c2 else f"{ordinal(c1)}–{ordinal(c2)} century"
    else:
        b = str(e['y'])
    return ('c. ' if e['circa'] else '') + b


def fmt_bound(e):
    base = fmt(e)
    if e.get('bound') == 'after':
        return 'after ' + base
    if e.get('bound') == 'before':
        return 'before ' + base
    return base


def extract(raw):
    d = (raw or '').strip()
    # square brackets / '?' = date supplied or queried by the PRONI cataloguer
    estimated = 1 if ('[' in d or ']' in d or '?' in d) else 0
    # undated/unknown: empty, a 'No date' variant, or nothing but brackets/'?'
    if d == '' or d.replace('[', '').replace(']', '').replace('?', '').strip() == '' \
            or re.fullmatch(r"[\(\[]?\s*(no\.?\s*date|n\.?\s*d\.?|undated|unknown|not\s+dated)\s*[\)\]]?\.?", d, re.I):
        return dict(sd='', ed='', sy=None, ey=None, prec='', circa=0, estimated=0, bound='', undated=1, display='Undated', review=0)
    parts = re.split(r"\s*[-–—]\s*|\s+to\s+|\s+x\s+", d, maxsplit=1)
    a = parse_expr(parts[0])
    b = parse_expr(parts[1]) if len(parts) > 1 else None
    if a is None and b is None:
        return dict(sd='', ed='', sy=None, ey=None, prec='', circa=0, estimated=estimated, bound='', undated=0, display=d, review=1)
    if a is None:
        a = b
    hi = b if b else a
    # 'before X' opens the start (lower bound unknown); 'after X' opens the end.
    open_start = (a['bound'] == 'before')
    open_end = (hi['bound'] == 'after')
    sy = None if open_start else a.get('y')
    ey = None if open_end else hi.get('y_end', hi.get('y'))
    sd = '' if open_start else edtf(a['y'], a['m'], a['d'])
    ed = '' if open_end else (f"{hi['y_end']:04d}" if hi.get('y_end') else edtf(hi['y'], hi['m'], hi['d']))
    circa = 1 if (a['circa'] or hi['circa']) else 0
    bound = 'after' if open_end else ('before' if open_start else '')
    # centuries (single or multi) now resolve to a year span; anything the parser
    # couldn't read at all is handled by the unparsed branch above (review=1)
    review = 0
    disp = fmt_bound(a)
    if b and (b['y'] != a['y'] or b['m'] != a['m'] or b['d'] != a['d']):
        disp = fmt_bound(a) + ' – ' + fmt_bound(b)
    prec = 'range' if b else a['prec']
    return dict(sd=sd, ed=ed, sy=sy, ey=ey, prec=prec, circa=circa, estimated=estimated, bound=bound, undated=0, display=disp, review=review)


def load_overrides():
    ov = {}
    if os.path.exists(OVERRIDES):
        with open(OVERRIDES, newline='', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                ref = (row.get('ref') or '').strip()
                if ref:
                    ov[ref] = row
    return ov


def main():
    ov = load_overrides()
    con = sqlite3.connect(SRC); con.text_factory = lambda b: b.decode('utf-8', 'replace')
    rows = con.execute("SELECT dates, COUNT(*) n FROM proni GROUP BY dates").fetchall()
    memo = {d: extract(d) for d, n in rows}
    total = sum(n for _, n in rows)
    n_est = sum(n for d, n in rows if memo[d]['estimated'])   # cross-cutting: also dated/circa
    n_after = sum(n for d, n in rows if memo[d].get('bound') == 'after')
    n_before = sum(n for d, n in rows if memo[d].get('bound') == 'before')
    stat = {}
    for d, n in rows:
        r = memo[d]
        k = 'undated' if r['undated'] else ('needs_review' if r['review'] else ('circa' if r['circa'] else ('dated' if r['sy'] is not None else 'unparsed')))
        stat[k] = stat.get(k, 0) + n

    out = sqlite3.connect(OUT_DB)
    out.execute("DROP TABLE IF EXISTS ext")
    out.execute("""CREATE TABLE ext (ref TEXT PRIMARY KEY, ext_start_date TEXT, ext_end_date TEXT,
        ext_start_year INT, ext_end_year INT, ext_precision TEXT, ext_circa INT, ext_estimated INT,
        ext_bound TEXT, ext_undated INT, ext_display TEXT, needs_review INT, overridden INT)""")
    review_rows = []
    batch = []
    cur = con.execute("SELECT ref, dates FROM proni")
    n_over = 0
    for ref, dates in cur:
        r = dict(memo[(dates or '').strip() if (dates is not None) else ''] if (dates or '').strip() in memo else extract(dates))
        overridden = 0
        if ref in ov:
            o = ov[ref]; overridden = 1; n_over += 1
            if o.get('ext_start_date'): r['sd'] = o['ext_start_date'].strip()
            if o.get('ext_end_date'): r['ed'] = o['ext_end_date'].strip()
            if o.get('ext_start_year'): r['sy'] = int(o['ext_start_year'])
            if o.get('ext_end_year'): r['ey'] = int(o['ext_end_year'])
            if o.get('ext_display'): r['display'] = o['ext_display'].strip()
            if o.get('ext_undated'): r['undated'] = int(o['ext_undated'] or 0)
            r['review'] = 0
        batch.append((ref, r['sd'], r['ed'], r['sy'], r['ey'], r['prec'], r['circa'], r['estimated'], r['bound'], r['undated'], r['display'], r['review'], overridden))
        if r['review'] and not overridden:
            review_rows.append((ref, dates or '', r['sd'], r['ed'], r['display']))
        if len(batch) >= 20000:
            out.executemany("INSERT INTO ext VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch); batch = []
    if batch:
        out.executemany("INSERT INTO ext VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    out.execute("CREATE INDEX ext_years ON ext(ext_start_year, ext_end_year)")
    out.commit(); out.close(); con.close()

    try:
        with open(REVIEW_CSV, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['ref', 'dates (raw PRONI)', 'auto ext_start_date', 'auto ext_end_date', 'auto ext_display',
                        '-> ext_start_date', 'ext_end_date', 'ext_start_year', 'ext_end_year', 'ext_display', 'ext_undated'])
            for ref, raw, sd, ed, disp in review_rows:
                w.writerow([ref, raw, sd, ed, disp, '', '', '', '', '', ''])
    except PermissionError:
        print(f"WARN: {REVIEW_CSV} is open/locked — left untouched (ext table still written).")

    print(f"records: {total:,}   overrides applied: {n_over:,}")
    for k, v in sorted(stat.items(), key=lambda x: -x[1]):
        print(f"  {k:14s} {v:>10,}  {100 * v / total:5.1f}%")
    print(f"  {'estimated*':14s} {n_est:>10,}  {100 * n_est / total:5.1f}%   (* PRONI-estimated, cross-cuts the above)")
    print(f"  bound: after={n_after:,}  before={n_before:,}  (open-ended dates, one year NULL)")
    print(f"needs-review rows written: {len(review_rows):,} -> {REVIEW_CSV}")


if __name__ == '__main__':
    main()
