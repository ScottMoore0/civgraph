"""Shared plumbing for the Belfast Gazette polling-district and election-expenses extractors.

Used by extract_polling_notices.py and extract_expenses_notices.py. Reads the crawler's database
READ-ONLY (scripts/gazette/crawl_belfast_gazette.py fills it) and keeps a per-extractor cache beside
the outputs, so a rerun while the crawl is still going parses only issues it has not seen, whose
download changed, or whose date was corrected, then rewrites every output from the cache.

Citations follow the other Gazette extractors: "Belfast Gazette, issue <n>, <d Month yyyy>, p. <page>",
https://www.thegazette.co.uk/Belfast/issue/<n>/page/<page> (Crown copyright, Open Government Licence;
facts and citations only). Nothing is fetched from thegazette.co.uk.

Civgraph hooks: contests come from civgraph_elections.load() (data/elections-source with the
source-checked fixes laid over it, read-only); a record matched to a contest carries civgraph_file
(the repo-relative contest file) and civgraph_key (<body>/<date>/<slug>, or <body>/<date> when the
match is to an election rather than one contest).
"""
import argparse, datetime, json, os, re, sqlite3, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import civgraph_elections  # noqa: E402
import gazette_crosscheck  # noqa: E402
from extract_election_notices import join_lines, printed_page_numbers, words_by_line, MONTHS  # noqa: E402,F401
from extract_boundary_notices import find_dates, labelled_dates  # noqa: E402,F401

REPO = HERE.parents[1]
URL_PAGE = 'https://www.thegazette.co.uk/Belfast/issue/{n}/page/{p}'
URL_ISSUE = 'https://www.thegazette.co.uk/Belfast/issue/{n}'


# ---------------------------------------------------------------------------------------------
# CLI and folders

def add_common_args(ap):
    ap.add_argument('--dir', default=os.environ.get('CIVGRAPH_GAZETTE_DIR'), help='data folder (or set CIVGRAPH_GAZETTE_DIR)')
    ap.add_argument('--db', help='crawler database (default <dir>/gazette.sqlite)')
    ap.add_argument('--out', help='output folder (default <dir>/extracted)')
    ap.add_argument('--full', action='store_true', help='reparse every issue (ignore the cache)')
    ap.add_argument('--issues', help='only these issues, e.g. 30-400')
    ap.add_argument('--no-compare', action='store_true', help='skip the Civgraph cross-check')
    return ap


def resolve_paths(args):
    if not args.dir and not (args.db and args.out):
        sys.exit('Set CIVGRAPH_GAZETTE_DIR (or give --dir, or --db and --out).')
    db_path = Path(args.db) if args.db else Path(args.dir) / 'gazette.sqlite'
    out = Path(args.out) if args.out else Path(args.dir) / 'extracted'
    out.mkdir(parents=True, exist_ok=True)
    return db_path, out, db_path.parent / 'pdf'


def wanted_issues(spec):
    if not spec:
        return None
    a, _, b = spec.partition('-')
    return set(range(int(a), int(b or a) + 1))


def open_source(db_path):
    return sqlite3.connect(f'file:{Path(db_path).resolve().as_posix()}?mode=ro', uri=True)


# ---------------------------------------------------------------------------------------------
# Cache: one row per issue (keyed on parser version + download time + issue date, so a refetched
# issue or a corrected date is parsed again), one row per record, and the pages that matched the
# keyword gate but gave no record (with the reason), for recall checks.

def open_cache(path):
    db = sqlite3.connect(path)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS done(issue INTEGER PRIMARY KEY, parser INTEGER, src_key TEXT, records INTEGER, at TEXT);
      CREATE TABLE IF NOT EXISTS records(issue INTEGER, seq INTEGER, json TEXT, PRIMARY KEY(issue, seq));
      CREATE TABLE IF NOT EXISTS skipped(issue INTEGER, page_index INTEGER, reason TEXT, PRIMARY KEY(issue, page_index, reason));
    ''')
    return db


def todo_issues(src, cache, version, wanted=None, full=False):
    rows = src.execute("SELECT issue, date, fetched_at FROM issues WHERE status='ok' ORDER BY issue").fetchall()
    done = {} if full else {r[0]: r[1] for r in cache.execute('SELECT issue, src_key FROM done WHERE parser=?', (version,))}
    out = []
    for n, d, f in rows:
        key = f'{f}|{d}'
        if (wanted is None or n in wanted) and done.get(n) != key:
            out.append((n, d, key))
    return out, len(rows)


def fts_issues(src, query, todo):
    """Issues among todo with a page matching an FTS5 query (a cheap pre-filter before the regex gate;
    the query should include prefix terms for words OCR splits over a line, e.g. poll* for "Poll-ing")."""
    if not todo:
        return set()
    lo, hi = min(t[0] for t in todo), max(t[0] for t in todo)
    try:
        return {r[0] for r in src.execute('SELECT DISTINCT p.issue FROM pages_fts JOIN pages p ON p.rowid = pages_fts.rowid '
                                          'WHERE pages_fts MATCH ? AND p.issue BETWEEN ? AND ?', (query, lo, hi))}
    except sqlite3.Error:
        return {t[0] for t in todo}


def store_issue(cache, issue, version, src_key, records, skipped):
    cache.execute('DELETE FROM records WHERE issue=?', (issue,))
    cache.execute('DELETE FROM skipped WHERE issue=?', (issue,))
    for i, rec in enumerate(records):
        cache.execute('INSERT INTO records VALUES (?,?,?)', (issue, i, json.dumps(rec, ensure_ascii=False)))
    for page_index, reason in sorted(set(skipped)):
        cache.execute('INSERT OR IGNORE INTO skipped VALUES (?,?,?)', (issue, page_index, reason))
    cache.execute('INSERT OR REPLACE INTO done VALUES (?,?,?,?,?)',
                  (issue, version, src_key, len(records), datetime.datetime.now().isoformat(timespec='seconds')))


def cached_records(cache, version):
    return [json.loads(r[0]) for r in cache.execute(
        'SELECT r.json FROM records r JOIN done d ON d.issue = r.issue AND d.parser = ? ORDER BY r.issue, r.seq', (version,))]


def cached_skips(cache, version):
    return [{'issue': i, 'page_index': p, 'reason': r} for i, p, r in cache.execute(
        'SELECT s.issue, s.page_index, s.reason FROM skipped s JOIN done d ON d.issue = s.issue AND d.parser = ? '
        'ORDER BY s.issue, s.page_index', (version,))]


# ---------------------------------------------------------------------------------------------
# Pages, page numbers, dates, citations

def issue_pages(src, issue):
    return src.execute('SELECT page_index, page_number, text FROM pages WHERE issue=? ORDER BY page_index', (issue,)).fetchall()


def page_numbers(pages):
    """Printed page number per page index: the crawler's label where it has one, else the running
    numbers voted across the issue (the Gazette's pages run on through the year)."""
    labels = {i: int(l) for i, l, _ in pages if l and str(l).strip().isdigit()}
    if len(labels) >= max(1, len(pages) // 2):
        return [labels.get(i) for i, _, _ in pages]
    return printed_page_numbers([t or '' for _, _, t in pages])


def issue_date_source(src, issue):
    try:
        r = src.execute('SELECT date_source FROM issue_dates WHERE issue=?', (issue,)).fetchone()
        return r[0] if r else None
    except sqlite3.Error:
        return None


def fmt_date(iso):
    if not iso:
        return ''
    d = datetime.date.fromisoformat(iso[:10])
    return f'{d.day} {MONTHS[d.month - 1]} {d.year}'


def cite(rec):
    page, end = rec.get('page'), rec.get('page_end')
    p = f'pp. {page}-{end}' if page and end and end != page else f'p. {page if page else "?"}'
    rec['citation'] = f"Belfast Gazette, issue {rec['issue']}, {fmt_date(rec.get('issue_date'))}, {p}"
    rec['url'] = URL_PAGE.format(n=rec['issue'], p=page) if page else URL_ISSUE.format(n=rec['issue'])
    return rec


def best_date(text, prefer=('made_seal', 'made'), last=True):
    """A notice's own date from its text: a sealed/dated/made date, else the last (or first) full date."""
    ds = labelled_dates(text)
    for kind in prefer:
        hit = [d['date'] for d in ds if d['kind'] == kind]
        if hit:
            return hit[-1] if last else hit[0], kind
    if ds:
        return (ds[-1] if last else ds[0])['date'], 'other'
    return None, None


def clean_ws(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def statute_like(flat):
    """Act, Rule or Order text (or a blank statutory form) rather than a notice about one place."""
    head = flat[:3000]
    if len(re.findall(r'\bshall\b', head)) >= 4:
        return 'statute-text'
    if re.search(r'day\s+of\s*,?\s*19\s*[,.]|day\s+of\s+19\s|Note\.?\W+The\s+following\s+notification\s+must\s+be\s+added', head):
        return 'blank-form'
    return None


# ---------------------------------------------------------------------------------------------
# Privacy: a polling place may be a public building or a locality; anything that reads as an
# individual's house (a house number, "residence of", "house of Mr") is dropped at parse time.

PUBLIC_BUILDING = re.compile(r'School|Schoolhouse|N\.?\s?S\.?\b|Hall|Court\s*-?\s*house|Court\s+House|Church|Chapel|Meeting\s*-?\s*House|'
                             r'Library|Institute|Centre|Center|Office|Barracks|Station|Club|College|Academy|Workhouse|Union|'
                             r'Dispensary|Market\s*-?\s*House|Town\s*-?\s*Hall|Lodge|Mission|Gymnasium|Leisure|Community|Parochial|'
                             r'Pavilion|Depot|Assembly\s+Rooms?|Tabernacle|Gospel|Y\.?M\.?C\.?A|Scout|Legion|Orange|Hibernian|A\.?O\.?H', re.I)
PRIVATE_HINT = re.compile(r'\bresidence\s+of\b|\bhouse\s+of\s+(?:Mr|Mrs|Miss|the\s+late)\b|\bdwelling\b|\bfarm\s*-?\s*house\s+of\b|'
                          r'\bpremises\s+of\s+(?:Mr|Mrs|Miss)\b|\boccupied\s+by\b|\b(?:Mr|Mrs|Miss)\.?\s+[A-Z]', re.I)
HOUSE_NUMBER = re.compile(r'(?:^|,\s*)\d{1,4}[A-Za-z]?\s*,?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Rd|Street|St|Avenue|Ave|Park|Gardens|'
                          r'Terrace|Place|Crescent|Drive|Lane|Square|Villas?|Parade|Row|Walk|Way|Grove|Close|Court)\b')


def sanitise_place(text):
    """(kept text or None, flag). Keeps a public building name or a locality; drops private houses;
    strips a street number/address tail from a public building ("Orange Hall, 12 Main Street")."""
    s = clean_ws(text).strip(' .,;:-*')
    if not s:
        return None, None
    if PRIVATE_HINT.search(s):
        return None, 'dropped-private-address'
    if HOUSE_NUMBER.search(s):
        head = HOUSE_NUMBER.split(s)[0].strip(' ,')
        if head and PUBLIC_BUILDING.search(head):
            return head, 'address-tail-removed'
        return None, 'dropped-private-address'
    return s, None


# ---------------------------------------------------------------------------------------------
# Civgraph contests

_CONTESTS = None


def contests():
    global _CONTESTS
    if _CONTESTS is None:
        _CONTESTS = civgraph_elections.load(REPO)
    return _CONTESTS


def by_body():
    out = {}
    for c in contests():
        out.setdefault(c['body'], []).append(c)
    return out


def contest_key(c):
    return f"{c['body']}/{c['date']}/{c['slug']}"


def cdate(c):
    return gazette_crosscheck.contest_date(c)


def next_contests(bodies, place, date, years=6, min_score=0.8, first_only=True):
    """Civgraph contests for a place at the first election on or after date (per body), within years.
    Matches a county to the seats named after it ('Tyrone' -> 'Fermanagh and Tyrone', 'Mid Tyrone')."""
    try:
        d = datetime.date.fromisoformat(date[:10])
    except (TypeError, ValueError):
        return []
    idx = by_body()
    out = []
    for body in bodies:
        hits = []
        for c in idx.get(body, []):
            cd = cdate(c)
            if cd is None or cd < d or (cd - d).days > years * 366:
                continue
            s = gazette_crosscheck.place_score(place, c['name'])
            if c.get('council'):
                s = max(s, gazette_crosscheck.place_score(place, f"{c['council']} {c['name']}"))
            ka, kb = set(gazette_crosscheck.place_key(place).split()), set(gazette_crosscheck.place_key(c['name']).split())
            if ka and ka <= kb:
                s = max(s, 0.8)
            if s >= min_score:
                hits.append((cd, -s, c))
        if not hits:
            continue
        hits.sort(key=lambda h: (h[0], h[1]))
        first = hits[0][0]
        out.extend(c for cd, _, c in hits if not first_only or cd == first)
    return out


def elections_between(bodies, start, end):
    """[(body, date, contests)] for the NI elections held between two ISO dates."""
    try:
        a, b = datetime.date.fromisoformat(start[:10]), datetime.date.fromisoformat(end[:10])
    except (TypeError, ValueError):
        return []
    seen = {}
    for body, cs in by_body().items():
        if bodies and body not in bodies:
            continue
        for c in cs:
            cd = cdate(c)
            if cd and a <= cd <= b:
                seen.setdefault((body, c['date']), 0)
                seen[(body, c['date'])] += 1
    return sorted((k[0], k[1], v) for k, v in seen.items())


def first_election_after(body, date, min_contests=1, years=10):
    """(date, number of contests) of the first Civgraph election in body on or after date (within years)."""
    try:
        d = datetime.date.fromisoformat(date[:10])
    except (TypeError, ValueError):
        return None
    counts = {}
    for c in by_body().get(body, []):
        cd = cdate(c)
        if cd and d <= cd and (cd - d).days <= years * 366:
            counts[c['date']] = counts.get(c['date'], 0) + 1
    for k in sorted(counts, key=lambda x: x if len(x) > 4 else x + '-06-30'):
        if counts[k] >= min_contests:
            return k, counts[k]
    return None


def decade(iso):
    return (iso or '????')[:3] + '0s'


def make_parser(doc):
    return argparse.ArgumentParser(description=doc, formatter_class=argparse.RawDescriptionHelpFormatter)
