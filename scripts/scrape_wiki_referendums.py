"""Scrape per-constituency referendum results from Wikipedia amendment
articles (Category:Amendments_of_the_Constitution_of_Ireland).

Each amendment article includes a 'Results by constituency' (or similar)
table with rows = constituencies, columns = electorate, total poll,
yes votes, no votes, spoiled, yes %, no %.

Output: one JSON per (event_date, topic_slug, constituency_slug) under
  election-viewer-package/data/elections/ireland-referendum/<date>-<topic-slug>/

Plus an aggregate `_constituencies.json` listing the constituency rows.
"""
from __future__ import annotations
import json, re, sys, time
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

UA = {'User-Agent': 'civgraph.net (NI/ROI civic-data project)'}
OUT_BASE = Path('election-viewer-package/data/elections/ireland-referendum')


def slugify(s: str) -> str:
    s = re.sub(r'\s+', '-', s.strip().lower())
    s = re.sub(r'[^a-z0-9-]', '', s)
    return re.sub(r'-+', '-', s).strip('-')


def parse_int(s):
    s = (s or '').replace(',', '').replace(' ', '').strip()
    if not s or s in ('—', '-', '–'):
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s))
        except ValueError:
            return None


def parse_float(s):
    s = (s or '').replace(',', '').replace(' ', '').replace('%', '').strip()
    if not s or s in ('—', '-', '–'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# Headers we might find in any column. Map to canonical field names.
HEADER_MAP = [
    # ordered: more specific first
    (r'^constituency\b|^local\s+authority\b|^region\b', 'constituency'),
    (r'^electorate\b', 'electorate'),
    (r'^total\s+poll\b|^total\s+votes\b|^valid\s+poll\b', 'total_poll'),
    (r'^turnout\b', 'turnout_pct'),
    (r'^spoil(t|ed)\b', 'spoiled'),
    (r'^proportion.*yes|^percent.*yes|^yes\s*%|^%\s*yes', 'yes_pct'),
    (r'^proportion.*no|^percent.*no|^no\s*%|^%\s*no', 'no_pct'),
    (r'^votes\s+yes\b|^yes\s+votes?\b|^yes$', 'yes'),
    (r'^votes\s+no\b|^no\s+votes?\b|^no$', 'no'),
    (r'^valid\s+vote', 'valid_poll'),
]


def map_header(h):
    h = re.sub(r'\s+', ' ', h.lower().strip())
    h = h.replace('\xa0', ' ')
    for pat, name in HEADER_MAP:
        if re.match(pat, h):
            return name
    return None


def _expand_header(table):
    """Walk the first 1-2 rows of `table`, honouring rowspan + colspan, and
    return a flat list of column header strings. Handles Wikipedia's
    common pattern of:
        row0: Constituency (rowspan=2) | Electorate (rowspan=2) | Votes (colspan=2) | %% (colspan=2)
        row1: Yes | No | Yes | No
    by concatenating row0+row1 cells in their final column positions.
    """
    rows = table.find_all('tr')
    if not rows:
        return []
    # Build a 2-row matrix that respects spans
    grid = [[None, None] for _ in range(40)]  # over-allocate; will trim

    def place(text, r, c, rs, cs):
        for dr in range(rs):
            for dc in range(cs):
                if r + dr >= len(grid):
                    grid.append([None, None])
                if c + dc >= len(grid[r + dr]):
                    grid[r + dr].extend([None] * (c + dc + 1 - len(grid[r + dr])))
                if grid[r + dr][c + dc] is None:
                    grid[r + dr][c + dc] = text

    for r_idx, tr in enumerate(rows[:2]):
        c_idx = 0
        for cell in tr.find_all(['th', 'td']):
            text = cell.get_text(' ', strip=True)
            rs = int(cell.get('rowspan', 1))
            cs = int(cell.get('colspan', 1))
            # Skip already-filled grid cells (from earlier row's rowspan)
            while c_idx < len(grid[r_idx]) and grid[r_idx][c_idx] is not None:
                c_idx += 1
            place(text, r_idx, c_idx, rs, cs)
            c_idx += cs

    # Determine column count from row 0 non-None positions
    n_cols = 0
    for c in range(len(grid[0])):
        if grid[0][c] is not None:
            n_cols = c + 1
    headers = []
    for c in range(n_cols):
        top = grid[0][c] or ''
        bot = grid[1][c] if len(grid) > 1 and c < len(grid[1]) and grid[1][c] is not None else ''
        # If bottom adds info (sub-header like Yes/No), join "<top> <bot>"
        if bot and bot.lower() != top.lower():
            headers.append(f'{top} {bot}'.strip())
        else:
            headers.append(top)
    return headers


def find_results_table(soup, caption_match=None):
    """Find the wikitable that has constituencies as rows and Yes/No columns.
    Returns (table, header_strings, normalised_keys) or (None, None, None).
    `caption_match` (substring, case-insensitive) selects a specific table
    when several match — useful on overview pages with multiple events.
    """
    for table in soup.select('table.wikitable'):
        if caption_match:
            cap = table.find('caption')
            cap_text = cap.get_text(' ', strip=True) if cap else ''
            if caption_match.lower() not in cap_text.lower():
                continue
        headers = _expand_header(table)
        if not headers:
            continue
        norm = [map_header(h) for h in headers]
        if 'constituency' in norm and 'yes' in norm and 'no' in norm:
            return table, headers, norm
    return None, None, None


def parse_row(cells, norm):
    out = {}
    for i, cell in enumerate(cells):
        if i >= len(norm) or norm[i] is None:
            continue
        text = cell.get_text(' ', strip=True)
        key = norm[i]
        if key == 'constituency':
            out[key] = re.sub(r'\s+', ' ', text).strip()
        elif key in ('yes_pct', 'no_pct', 'turnout_pct', 'valid_pct'):
            out[key] = parse_float(text)
        else:
            out[key] = parse_int(text)
    return out


def detect_basis(soup):
    """Detect whether results are reported by Dáil constituency or LA."""
    text = soup.get_text(' ', strip=True).lower()
    if 'local authority' in text and re.search(r'(by|per)\s+local\s+authority', text):
        return 'local-authorities'
    return 'dail-constituencies'  # default — most modern referenda


def scrape_amendment(url, topic_override=None, date_override=None, caption_match=None):
    with httpx.Client(headers=UA, timeout=60.0, follow_redirects=True) as c:
        r = c.get(url)
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code} for {url}')
    soup = BeautifulSoup(r.text, 'html.parser')

    title = soup.select_one('h1').get_text(strip=True)
    table, headers, norm = find_results_table(soup, caption_match=caption_match)
    if not table:
        return {'url': url, 'title': title, 'error': 'no constituency table found'}

    rows = []
    # Skip the header rows (1 or 2 depending on row-span structure)
    body_start = 2 if any(int(c.get('rowspan', 1)) > 1 for c in table.find_all('tr')[0].find_all(['th', 'td'])) else 1
    for tr in table.find_all('tr')[body_start:]:
        cells = tr.find_all(['td', 'th'])
        if not cells:
            continue
        row = parse_row(cells, norm)
        if not row.get('constituency') or row['constituency'].lower() in ('total', 'totals'):
            continue
        rows.append(row)

    return {
        'url': url, 'title': title,
        'basis': detect_basis(soup),
        'headers': headers, 'norm_headers': norm,
        'rows': rows,
    }


def main():
    # Two amendments to validate the pipeline before bulk-running.
    samples = [
        ('https://en.wikipedia.org/wiki/Thirty-sixth_Amendment_of_the_Constitution_of_Ireland',
         'Thirty-sixth Amendment (Repeal of Eighth — abortion)', '2018-05-25'),
        ('https://en.wikipedia.org/wiki/Thirty-fourth_Amendment_of_the_Constitution_of_Ireland',
         'Thirty-fourth Amendment (Marriage equality)', '2015-05-22'),
    ]
    out_dir = Path('_tmp_ref/wiki_samples')
    out_dir.mkdir(parents=True, exist_ok=True)
    for url, topic, date in samples:
        print(f'\n=== {topic} ({date}) ===')
        try:
            result = scrape_amendment(url)
        except Exception as e:
            print(f'  ERROR: {e}')
            continue
        if 'error' in result:
            print(f'  ERROR: {result["error"]}')
            continue
        print(f'  title: {result["title"]}')
        print(f'  basis: {result["basis"]}')
        print(f'  headers: {result["headers"]}')
        print(f'  norm:    {result["norm_headers"]}')
        print(f'  rows:    {len(result["rows"])}')
        if result['rows']:
            print(f'  sample row: {result["rows"][0]}')
        slug = slugify(topic)
        out_path = out_dir / f'{date}-{slug}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f'  wrote {out_path}')
        time.sleep(1)


if __name__ == '__main__':
    main()
