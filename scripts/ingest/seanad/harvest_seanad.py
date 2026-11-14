#!/usr/bin/env python3
"""Harvest what the Seanad build reads from the network into .cache/seanad/ (gitignored).

  oireachtas/houses.json          the Seanad terms (houseNo, dateRange) from the Oireachtas API
  oireachtas/house-<n>.json       the members of each term, with their panel or university and
                                  their member code (the official person id)
  wikipedia/<title>.json          the wikitext of each term's article ("26th Seanad") and of the
                                  elections that have an article of their own; the List of Seanad
                                  by-elections, each by-election article it names, and the result
                                  template an article draws its count from

A file already in the cache is not fetched again (--refresh fetches everything). Requests are at
least two seconds apart. No User-Agent is sent except to Wikimedia hosts (wikimedia_headers.py).

  python scripts/ingest/seanad/harvest_seanad.py [--refresh]
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CACHE = REPO / '.cache' / 'seanad'
_WM = __import__('runpy').run_path(str(Path(__file__).resolve().parents[1] / 'wikimedia_headers.py'))
wikimedia_headers = _WM['wikimedia_headers']

API = 'https://api.oireachtas.ie/v1'
WIKI_API = 'https://en.wikipedia.org/w/api.php'
DELAY = 2.0
_last = [0.0]


def fetch_json(url: str) -> object:
    wait = DELAY - (time.monotonic() - _last[0])
    if wait > 0:
        time.sleep(wait)
    request = urllib.request.Request(url, headers=wikimedia_headers(url))
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
    _last[0] = time.monotonic()
    return json.loads(body.decode('utf-8'))


def cached(path: Path, url: str, refresh: bool) -> object:
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding='utf-8'))
    data = fetch_json(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'fetched {url}', file=sys.stderr)
    return data


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def wikipedia_titles(houses: list[dict]) -> list[str]:
    """The term articles ("26th Seanad"; "1928 Seanad" for the Seanad of the Irish Free State, whose
    members were elected in stages), which give each election's dates and the members elected, and
    the articles of the elections that have one of their own."""
    titles = [f'{ordinal(int(h["houseNo"]))} Seanad' for h in houses if str(h['houseNo']).isdigit() and int(h['houseNo']) < 100]
    free_state = [f'{h["houseNo"]} Seanad' for h in houses if str(h['houseNo']).isdigit() and int(h['houseNo']) >= 1922]
    return titles + free_state + ['1922 Seanad election', '1925 Seanad election', '2020 Seanad election', '2025 Seanad election']


def fetch_article(title: str, refresh: bool) -> str:
    """An article's wikitext into the cache ('' when it is missing)."""
    query = urllib.parse.urlencode({'action': 'parse', 'page': title, 'prop': 'wikitext', 'format': 'json', 'formatversion': '2', 'redirects': '1'})
    try:
        # A title's colon ("Template:...") would name an alternate data stream on Windows.
        doc = cached(CACHE / 'wikipedia' / f"{title.replace(':', '_')}.json", f'{WIKI_API}?{query}', refresh)
    except Exception as error:  # a missing article is reported, not fatal
        print(f'{title}: {error}', file=sys.stderr)
        return ''
    return ((doc or {}).get('parse') or {}).get('wikitext') or ''


def by_election_titles(listing: str) -> list[str]:
    """The by-election articles the List of Seanad by-elections names (its `article` fields)."""
    return sorted({m.strip() for m in re.findall(r'\|\s*article\s*=[ \t]*([^\n|]*)', listing) if m.strip()})


def main(argv: list[str]) -> int:
    refresh = '--refresh' in argv
    houses_doc = cached(CACHE / 'oireachtas' / 'houses.json', f'{API}/houses?chamber=seanad&limit=100', refresh)
    houses = [row['house'] for row in houses_doc['results']]
    for house in houses:
        number = house['houseNo']
        cached(CACHE / 'oireachtas' / f'house-{number}.json', f'{API}/members?chamber=seanad&house_no={number}&limit=500', refresh)
    for title in wikipedia_titles(houses):
        fetch_article(title, refresh)
    for title in by_election_titles(fetch_article('List of Seanad by-elections', refresh)):
        text = fetch_article(title, refresh)
        for template in re.findall(r'\{\{(\d{4} [^{}|]*by-election result)\}\}', text):
            fetch_article(f'Template:{template}', refresh)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
