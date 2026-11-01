#!/usr/bin/env python
"""Re-date Belfast Gazette issues from the date the issue itself prints.

The crawler took the first date on the front page, which is often a notice's date, not the issue's:
684 of the first 3,753 issues with a printed running head disagreed with it, 226 by more than a week.
An issue's own date is printed in the running head of its later pages ("THE BELFAST GAZETTE,
FEBRUARY 9, 1940." or "THE BELFAST GAZETTE, 9th FEBRUARY, 1940"); a one-page issue has only its
masthead ("FRIDAY, 5th MAY, 1939."). This takes, in order:
  1. the date most of the running heads give;
  2. the masthead date, which follows a weekday name;
  3. otherwise the crawler's date stays, marked unconfirmed if it falls outside its neighbours'.
The result goes in issues.date; issue_dates(issue, date, date_source, crawler_date) records which rule
gave it and the crawler's own value. (A separate table, because the crawler inserts whole issues rows
and a changed issues table would stop it.) Safe to rerun, and to run while the crawl continues.

  python scripts/gazette/fix_issue_dates.py [--db <gazette.sqlite>] [--dry-run]
"""
import argparse, bisect, collections, datetime, os, re, sqlite3

MONTHS = 'JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER'.split()
MON = '|'.join(MONTHS)
YEAR = r'(1\s?9\s?\d\s?\d|2\s?0\s?\d\s?\d)'
# A day as the OCR layer reads it: "llth", "HTH" and "lira" are 11th, "STH" 8th, "1O" 10, "11 TH" 11th.
DAY = r'(H(?=TH)|li(?=ra)|[\dlIOS]{1,2})\s?'
OCR_DIGITS = str.maketrans('lIOS', '1108')
HEAD_MDY = re.compile(r'GAZETTE[\W_]{0,6}(' + MON + r')[\W_]{0,4}' + DAY + r'(?:st|nd|rd|th)?[\W_]{1,4}' + YEAR, re.I)
HEAD_DMY = re.compile(r'GAZETTE[\W_]{0,6}' + DAY + r'(?:st|nd|rd|th|TH|ST|ND|RD)?[\W_]{0,4}(' + MON + r')[\W_]{0,4}' + YEAR, re.I)
WEEKDAY = r'(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)'
MAST_DMY = re.compile(WEEKDAY + r'[\W_]{1,4}' + DAY + r'(?:st|nd|rd|th|ra|TH|ST|ND|RD)?[\W_]{0,4}(' + MON + r')[\W_]{0,4}' + YEAR, re.I)
MAST_MDY = re.compile(WEEKDAY + r'[\W_]{1,4}(' + MON + r')[\W_]{0,4}' + DAY + r'(?:st|nd|rd|th)?[\W_]{1,4}' + YEAR, re.I)


def mkdate(day, month, year):
    try:
        return datetime.date(int(re.sub(r'\D', '', year)), MONTHS.index(month.upper()) + 1, int('11' if day in ('H', 'li') else str(day).translate(OCR_DIGITS))).isoformat()
    except (ValueError, IndexError):
        return None


def head_dates(text):
    head = text[:400]
    out = [mkdate(m.group(2), m.group(1), m.group(3)) for m in HEAD_MDY.finditer(head)]
    out += [mkdate(m.group(1), m.group(2), m.group(3)) for m in HEAD_DMY.finditer(head)]
    return [d for d in out if d]


def masthead_date(text):
    head = text[:900]
    for rx, order in ((MAST_DMY, (1, 2, 3)), (MAST_MDY, (2, 1, 3))):
        m = rx.search(head)
        if m:
            d = mkdate(m.group(order[0]), m.group(order[1]), m.group(order[2]))
            if d:
                return d
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=os.path.join(os.environ.get('CIVGRAPH_GAZETTE_DIR', ''), 'gazette.sqlite'))
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    db = sqlite3.connect(args.db, timeout=60)
    if not args.dry_run:
        db.execute('CREATE TABLE IF NOT EXISTS issue_dates(issue INTEGER PRIMARY KEY, date TEXT, date_source TEXT, crawler_date TEXT)')
    known = {r[0]: r[1] for r in db.execute('SELECT issue, crawler_date FROM issue_dates')} if db.execute(
        "SELECT 1 FROM sqlite_master WHERE name='issue_dates'").fetchone() else {}
    issues = [(i, d, known.get(i)) for i, d in db.execute("SELECT issue, date FROM issues WHERE status='ok' ORDER BY issue")]
    votes, mast = collections.defaultdict(collections.Counter), {}
    for issue, idx, text in db.execute('SELECT issue, page_index, text FROM pages'):
        if idx == 0:
            mast[issue] = masthead_date(text or '')
        else:
            votes[issue].update(head_dates(text or ''))
    result, counts = {}, collections.Counter()
    for issue, date, crawler in issues:
        original = crawler or date
        if votes[issue]:
            new, src = votes[issue].most_common(1)[0][0], 'running-head'
        elif mast.get(issue):
            new, src = mast[issue], 'masthead'
        else:
            new, src = original, 'crawler'
        result[issue] = [new, src, original]
    # Issues run in date order. A date outside its neighbours' (the median of the three running-head
    # dates either side) is an OCR slip or a notice's date; it becomes the Friday after the earlier
    # neighbour (the Gazette's day of issue), capped at the later one, marked estimated.
    ordered = sorted(result)
    heads = [i for i in ordered if result[i][1] == 'running-head']
    median = lambda xs: sorted(xs)[len(xs) // 2] if xs else None
    for issue in ordered:
        new, src, _ = result[issue]
        pos = bisect.bisect_left(heads, issue)
        lo = median([result[i][0] for i in heads[max(0, pos - 3):pos]])
        hi = median([result[i][0] for i in heads[pos + (pos < len(heads) and heads[pos] == issue):][:3]])
        if new and (lo is None or new >= lo) and (hi is None or new <= hi):
            continue
        if lo:
            d = datetime.date.fromisoformat(lo)
            est = (d + datetime.timedelta(days=(4 - d.weekday()) % 7 or 7)).isoformat()
            result[issue][0] = min(est, hi) if hi else est
            result[issue][1] = 'estimated'
        else:
            result[issue][1] = src + '-unconfirmed'
    for issue, (new, src, original) in result.items():
        counts[(src, 'changed' if new != original else 'same')] += 1
    for k, v in sorted(counts.items()):
        print(f'{k[0]:<20} {k[1]:<8} {v}')
    if not args.dry_run:
        db.executemany('INSERT OR REPLACE INTO issue_dates(issue, date, date_source, crawler_date) VALUES (?,?,?,?)',
                       [(issue, new, src, original) for issue, (new, src, original) in result.items()])
        db.executemany('UPDATE issues SET date=? WHERE issue=?', [(new, issue) for issue, (new, _, _) in result.items()])
        db.commit()


if __name__ == '__main__':
    main()
