#!/usr/bin/env python3
"""Fill the 1973-1997 hole in the Dáil series, from the source the rest of it came from.

THE GAP

data/elections-source/data/elections/dail-eireann/ holds 1918-1969 and then jumps to
2002. Nine general elections are missing: 1973, 1977, 1981, February 1982, November
1982, 1987, 1989, 1992 and 1997. Everything either side of the hole is complete, with
first preferences, counts, quota and turnout, so an "elected members only" fill would
leave a visibly poorer island between two whole halves.

WHY NOT WIKIPEDIA

Because Wikipedia is not where this data comes from; it is where a citation of it lives.
Every existing constituency file records `source_url`, and every one of them points at
electionsireland.org, which is also what the Wikipedia articles cite. Taking the data
from the cited source keeps one provenance chain instead of introducing a second, and
avoids importing CC BY-SA text into a corpus licensed otherwise.

The Oireachtas open data held locally covers the same elections and is the official
source, but it records who was ELECTED, not how many votes anyone got. It is the right
source for membership and the wrong one for results.

WHAT THIS DOES NOT ASSUME

  * The index page is a seat summary and carries no constituency links, so the
    constituency set is discovered by probing ids rather than read from a list. Ids are
    global to electionsireland.org and stable across elections -- 1969 and 2002 use the
    same 32..235 range -- so the probe set is the union of ids observed in the
    surrounding elections, not a blind sweep of the range.
  * A probe that returns a page with no candidate rows means that constituency did not
    exist at that election. That is expected, not an error: boundaries were revised
    repeatedly across these nine elections.
  * The election DATE is read from the Dáil's own index page rather than hardcoded,
    because the date a Dáil first SAT is not polling day and the two are easy to
    confuse.

Parsing is imported from scrape_ei_dail_old.py rather than reimplemented. That parser
produced every existing file in this series, quirks included -- its `counts` array is
the summary row rather than per-count transfers -- and a second parser would silently
produce a differently-shaped half of the same series.

Rate limited and idempotent: an election whose directory already holds _index.json is
skipped, so this can be re-run to pick up what failed.

Usage:
  python scripts/harvest-dail-gap.py [--only 1973,1977] [--delay 1.0] [--dry-run]
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = REPO / 'data/elections-source/data/elections/dail-eireann'
BASE = 'https://electionsireland.org'
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project)'}

# (Dáil number, election year, URL key).
#
# The URL key is not always the year. Where two Dála were elected in one year the source
# disambiguates with a month suffix -- 1927 is already stored as `1927jun` and
# `1927sepB` -- and 1982 follows the same shape as `1982feb` and `1982nov`. A bare
# `election=1982` returns a 1.5 KB stub, not an error, so guessing the key wrong looks
# like an election with no constituencies rather than a broken URL.
GAP = [(20, 1973, '1973'), (21, 1977, '1977'), (22, 1981, '1981'),
       (23, 1982, '1982feb'), (24, 1982, '1982nov'), (25, 1987, '1987'),
       (26, 1989, '1989'), (27, 1992, '1992'), (28, 1997, '1997')]

MONTHS = ('january february march april may june july august september october '
          'november december').split()


def load_parser():
    """The parser that produced the existing files, imported rather than copied."""
    spec = importlib.util.spec_from_file_location('ei_old', HERE / 'scrape_ei_dail_old.py')
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = ['scrape_ei_dail_old.py']          # it builds a client at import time
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


def probe_ids(lo: int = 1957, hi: int = 2007) -> list[int]:
    """Constituency ids observed in the elections bracketing the gap.

    Not every id ever used: the series spans a century and constituencies come and go,
    so the full set is ~194 and probing all of them for all nine elections would be
    ~1,750 requests against someone else's server for no gain. The window either side of
    the gap covers every constituency that could plausibly exist within it.
    """
    ids = set()
    for name in os.listdir(OUT):
        directory = OUT / name
        if not directory.is_dir():
            continue
        year = name[:4]
        if not (year.isdigit() and lo <= int(year) <= hi):
            continue
        for path in directory.glob('*.json'):
            if path.name.startswith('_'):
                continue
            try:
                value = json.loads(path.read_text(encoding='utf-8')).get('cons_id')
                if value is not None:
                    ids.add(int(value))
            except Exception:
                continue
    return sorted(ids)


def election_date(client: httpx.Client, dail_no: int, year: int, key: str) -> str | None:
    """Polling day, read from the Dáil's own index page.

    The page says e.g. "General Election of 28 February 1973". Returned as ISO so the
    directory name matches the rest of the series.
    """
    try:
        response = client.get(f'{BASE}/results/general/{dail_no:02d}dail.cfm')
    except Exception:
        return None
    if response.status_code != 200:
        return None
    text = BeautifulSoup(response.text, 'html.parser').get_text(' ', strip=True)
    # The weekday is present on some pages and absent on others: 1992 reads "General
    # Election of Wednesday 25 November 1992", 1973 reads "of 28 February 1973".
    match = re.search(
        r'General Election of\s+(?:\w+day\s+)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', text)
    if not match:
        return _date_from_result_page(client, year, key)
    day, month_name, found_year = match.groups()
    month = MONTHS.index(month_name.lower()) + 1 if month_name.lower() in MONTHS else None
    if not month or int(found_year) != year:
        return None
    return f'{found_year}-{month:02d}-{int(day):02d}'


def _date_from_result_page(client: httpx.Client, year: int, key: str) -> str | None:
    """Fallback for Dála whose index page is a year index rather than a result summary.

    A constituency result page states the polling day in its own right, so the date still
    comes from the source rather than from a table typed in here.
    """
    for cons in (32, 36, 38):
        try:
            response = client.get(f'{BASE}/result.cfm?election={key}&cons={cons}')
        except Exception:
            continue
        if response.status_code != 200:
            continue
        text = BeautifulSoup(response.text, 'html.parser').get_text(' ', strip=True)
        match = re.search(r'(?:\w+day\s+)?(\d{1,2})\s+([A-Za-z]+)\s+(%d)' % year, text)
        if not match:
            continue
        day, month_name, found_year = match.groups()
        if month_name.lower() not in MONTHS:
            continue
        return f'{found_year}-{MONTHS.index(month_name.lower()) + 1:02d}-{int(day):02d}'
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated years to harvest')
    ap.add_argument('--delay', type=float, default=1.0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--wide', action='store_true',
                    help='probe every constituency id ever seen, not just the bracketing window')
    ap.add_argument('--refresh', action='store_true',
                    help='re-probe an election that already has _index.json, keeping existing files')
    ap.add_argument('--range', help='sweep a literal id range, e.g. 1-260, instead of observed ids. '
                                    'Needed for constituencies that existed at only one election, '
                                    'whose ids therefore appear in no other election in the series.')
    args = ap.parse_args()

    wanted = {int(y) for y in args.only.split(',')} if args.only else None
    targets = [t for t in GAP if wanted is None or t[1] in wanted]
    parser = load_parser()
    if args.range:
        lo, hi = (int(x) for x in args.range.split('-'))
        ids = list(range(lo, hi + 1))
    else:
        ids = probe_ids(0, 9999) if args.wide else probe_ids()
    client = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)

    print(f'Dáil gap harvest: {len(targets)} election(s), probing {len(ids)} constituency ids')

    for dail_no, year, key in targets:
        date = election_date(client, dail_no, year, key)
        if not date:
            print(f'  {dail_no}th Dáil ({year}): SKIP -- could not read polling day from the index page')
            continue
        out_dir = OUT / date
        if (out_dir / '_index.json').exists() and not args.refresh:
            print(f'  {date}: already harvested, skipping')
            continue
        print(f'\n=== {dail_no}th Dáil, polled {date} ===')
        if args.dry_run:
            print('  --dry-run: nothing fetched')
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        summary = []
        for n, cons in enumerate(ids, 1):
            url = f'{BASE}/result.cfm?election={key}&cons={cons}'
            try:
                response = client.get(url)
                html = response.text if response.status_code == 200 else None
            except Exception:
                html = None
            time.sleep(args.delay)
            if not html or len(html) < 1500:
                continue
            if args.refresh and any(
                    p.name != '_index.json' and json.loads(p.read_text(encoding='utf-8')).get('cons_id') == str(cons)
                    for p in out_dir.glob('*.json')):
                continue
            title = BeautifulSoup(html, 'html.parser').find('title')
            name = ''
            if title:
                # "ElectionsIreland.org: 20th Dail - Carlow Kilkenny First Preference Votes"
                m = re.search(r'-\s*(.+?)\s+First Preference', title.get_text(strip=True))
                if m:
                    name = m.group(1).strip()
            if not name:
                continue
            data = parser.parse_constituency(html, name)
            if not data['candidates']:
                continue            # constituency did not exist at this election
            data['year'] = year
            data['dail_num'] = dail_no
            data['cons_id'] = str(cons)
            data['source_url'] = url
            slug = parser.slugify(name) or f'cons-{cons}'
            (out_dir / f'{slug}.json').write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
            summary.append({'name': name, 'cons_id': str(cons),
                            'candidates': len(data['candidates']),
                            'seats': data['meta'].get('seats')})
            print(f'  [{n}/{len(ids)}] {name[:32]:<32} {len(data["candidates"])} candidates')
        # Rebuilt from what is on disk, not from this run's fetches. A --refresh pass
        # adds a handful of files and must not shrink the index to only those.
        on_disk = []
        for path in sorted(out_dir.glob('*.json')):
            if path.name.startswith('_'):
                continue
            doc = json.loads(path.read_text(encoding='utf-8'))
            on_disk.append({'name': doc.get('constituency'), 'cons_id': doc.get('cons_id'),
                            'candidates': len(doc.get('candidates') or []),
                            'seats': (doc.get('meta') or {}).get('seats')})
        summary = on_disk
        (out_dir / '_index.json').write_text(
            json.dumps(summary, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'  -> {len(summary)} constituencies, {sum(s["candidates"] for s in summary)} candidacies')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
