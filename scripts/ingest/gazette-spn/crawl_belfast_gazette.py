#!/usr/bin/env python
"""Download every issue of the Belfast Gazette as one PDF each, and index its text.

One request per issue (thegazette.co.uk/Belfast/issue/<n>/data.pdf), oldest first, with the
site's robots.txt Crawl-delay of 10 seconds between every request, empty answers included. The
issue PDFs carry the text layer, so no OCR is needed. Resumable: issues already recorded as ok or
empty are skipped, so rerunning continues where it stopped.

Output (outside the repo, never published as files; facts extracted from it are cited by issue and
page, the Gazette being Crown copyright under the Open Government Licence):
  <out>/pdf/<issue>.pdf
  <out>/gazette.sqlite   issues(issue, status, http, bytes, pages, date, date_text, supplement, fetched_at)
                         pages(issue, page_index, page_number, text) + pages_fts (FTS5 over text)

  python scripts/ingest/gazette-spn/crawl_belfast_gazette.py --out <gazette folder> [--start 1] [--end 9400]
"""
import argparse, datetime, os, re, sqlite3, sys, time, urllib.error, urllib.request
from pathlib import Path

import pymupdf

URL = 'https://www.thegazette.co.uk/Belfast/issue/{n}/data.pdf'
MONTHS = 'JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER'.split()
DATE_WORDS = re.compile(r'(\d{1,2})\s*(?:st|nd|rd|th|ra|ST|ND|RD|TH)?[\s.,]*(' + '|'.join(MONTHS) + r')[\s.,]*(1[89]\d\d|20\d\d)', re.I)
DATE_NUM = re.compile(r'\b(\d{2})/(\d{2})/(19\d\d|20\d\d)\b')
# The 1920s front pages print "FRIDAY, JUNE 16, 1922", sometimes OCR'd as "19-22".
DATE_MDY = re.compile(r'(' + '|'.join(MONTHS) + r')[\s.,]*(\d{1,2})[\s.,]+(1\s?-?9\s?-?\d\s?-?\d|20\d\d)', re.I)


def open_db(path):
    db = sqlite3.connect(path)
    db.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS issues(issue INTEGER PRIMARY KEY, status TEXT, http INTEGER, bytes INTEGER, pages INTEGER,
        date TEXT, date_text TEXT, supplement INTEGER, fetched_at TEXT);
      CREATE TABLE IF NOT EXISTS pages(issue INTEGER, page_index INTEGER, page_number TEXT, text TEXT, PRIMARY KEY(issue, page_index));
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(text, content='pages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    ''')
    return db


def issue_date(first_page):
    head = first_page[:2500]
    found = []
    m = DATE_WORDS.search(head)
    if m:
        found.append((m.start(), int(m.group(1)), MONTHS.index(m.group(2).upper()) + 1, int(m.group(3)), m.group(0)))
    m = DATE_MDY.search(head)
    if m:
        year = int(re.sub(r'\D', '', m.group(3)))
        found.append((m.start(), int(m.group(2)), MONTHS.index(m.group(1).upper()) + 1, year, m.group(0)))
    for _, day, month, year, text in sorted(found):
        try:
            return datetime.date(year, month, day).isoformat(), text
        except ValueError:
            continue
    m = DATE_NUM.search(head)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat(), m.group(0)
        except ValueError:
            pass
    return None, None


def fetch(n):
    """(http status, bytes) for one issue; raises on a network failure after retries."""
    req = urllib.request.Request(URL.format(n=n))
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                wait = 60 * (attempt + 1)
                print(f'  {n}: HTTP {e.code}, waiting {wait}s', flush=True)
                time.sleep(wait)
                continue
            return e.code, b''
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            wait = 30 * (attempt + 1)
            print(f'  {n}: {e}, retry in {wait}s', flush=True)
            time.sleep(wait)
    raise RuntimeError(f'issue {n}: giving up after retries')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.environ.get('CIVGRAPH_GAZETTE_DIR'), help='data folder (or set CIVGRAPH_GAZETTE_DIR)')
    ap.add_argument('--start', type=int, default=1)
    ap.add_argument('--end', type=int, default=9400)
    ap.add_argument('--delay', type=float, default=10.0)
    ap.add_argument('--stop-after-empty', type=int, default=150, help='stop after this many empty issues in a row past --tail-from')
    ap.add_argument('--tail-from', type=int, default=8600)
    args = ap.parse_args()
    if not args.out:
        sys.exit('Give --out or set CIVGRAPH_GAZETTE_DIR.')
    if args.delay < 10:
        sys.exit('The Gazette asks for a 10-second crawl delay; refusing a shorter one.')
    out = Path(args.out)
    (out / 'pdf').mkdir(parents=True, exist_ok=True)
    db = open_db(out / 'gazette.sqlite')
    done = {row[0] for row in db.execute("SELECT issue FROM issues WHERE status IN ('ok','empty')")}
    empty_run = 0
    started = time.time()
    fetched = 0
    for n in range(args.start, args.end + 1):
        if n in done:
            continue
        try:
            http, body = fetch(n)
        except RuntimeError as e:
            print(f'  {e}', flush=True)
            db.execute('INSERT OR REPLACE INTO issues(issue, status, fetched_at) VALUES (?,?,?)', (n, 'error', datetime.datetime.now().isoformat(timespec='seconds')))
            db.commit()
            time.sleep(args.delay)
            continue
        fetched += 1
        now = datetime.datetime.now().isoformat(timespec='seconds')
        if http != 200 or not body.startswith(b'%PDF'):
            db.execute('INSERT OR REPLACE INTO issues(issue, status, http, bytes, fetched_at) VALUES (?,?,?,?,?)', (n, 'empty', http, len(body), now))
            empty_run += 1
        else:
            empty_run = 0
            (out / 'pdf' / f'{n}.pdf').write_bytes(body)
            doc = pymupdf.open(stream=body, filetype='pdf')
            texts = [page.get_text() for page in doc]
            date, date_text = issue_date(texts[0] if texts else '')
            supplement = int(bool(re.search(r'S\s*U\s*P\s*P\s*L\s*E\s*M\s*E\s*N\s*T', (texts[0] if texts else '')[:600])))
            db.execute('DELETE FROM pages_fts WHERE rowid IN (SELECT rowid FROM pages WHERE issue=?)', (n,))
            db.execute('DELETE FROM pages WHERE issue=?', (n,))
            for i, text in enumerate(texts):
                label = doc[i].get_label() or ''
                cur = db.execute('INSERT INTO pages(issue, page_index, page_number, text) VALUES (?,?,?,?)', (n, i, label, text))
                db.execute('INSERT INTO pages_fts(rowid, text) VALUES (?,?)', (cur.lastrowid, text))
            db.execute('INSERT OR REPLACE INTO issues VALUES (?,?,?,?,?,?,?,?,?)', (n, 'ok', http, len(body), len(texts), date, date_text, supplement, now))
        db.commit()
        if fetched % 25 == 0 or http == 200:
            ok = db.execute("SELECT COUNT(*) FROM issues WHERE status='ok'").fetchone()[0]
            rate = fetched / max(time.time() - started, 1) * 3600
            print(f'issue {n}: {"ok" if http == 200 and body.startswith(b"%PDF") else "empty"}  | ok so far {ok} | {rate:.0f} issues/h', flush=True)
        if n >= args.tail_from and empty_run >= args.stop_after_empty:
            print(f'Stopping at {n}: {empty_run} empty issues in a row.', flush=True)
            break
        time.sleep(args.delay)
    print('Done.', flush=True)


if __name__ == '__main__':
    main()
