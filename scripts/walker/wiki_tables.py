#!/usr/bin/env python3
"""Read a Wikipedia results table from the RENDERED HTML rather than the wikitext.

WHY NOT THE WIKITEXT

These 58 articles do not agree on markup, and each variation broke a different assumption:
1832 heads its table with one simple row; 1885 uses two header rows with rowspan and
colspan, so the real column names sit on the second; 1950 opens with a candidate-count
table and puts results in a later one; several prefix every row with a party-colour cell,
which shifts every column one to the right and produced party names like "0" and "1".

In the rendered HTML a cell is a cell. MediaWiki has already resolved the templates and
the spans, so the table can be read as a grid, and colspan/rowspan can be expanded
properly instead of guessed at.
"""
import re

from bs4 import BeautifulSoup


def _text(el):
    s = el.get_text(' ', strip=True)
    s = re.sub(r'\[\d+\]', '', s)              # footnote markers
    s = s.replace('−', '-').replace('\xa0', ' ')
    return s.strip()


def grid(table, elements=False):
    """The table as a grid of (text, was_a_header_cell), with spans expanded; with
    `elements`, (text, was_a_header_cell, cell) so a caller can read the cell's links."""
    rows = table.find_all('tr')
    out, pending = [], {}
    for r_i, tr in enumerate(rows):
        row, c_i = [], 0
        while (r_i, c_i) in pending:
            row.append(pending.pop((r_i, c_i)))
            c_i += 1
        for cell in tr.find_all(['th', 'td'], recursive=False):
            try:
                cs = int(cell.get('colspan', 1))
                rs = int(cell.get('rowspan', 1))
            except ValueError:
                cs = rs = 1
            val = (_text(cell), cell.name == 'th') + ((cell,) if elements else ())
            for k in range(cs):
                row.append(val)
                for extra in range(1, rs):
                    pending[(r_i + extra, c_i + k)] = val
                c_i += 1
            while (r_i, c_i) in pending:
                row.append(pending.pop((r_i, c_i)))
                c_i += 1
        out.append(row)
    return out


def _num(s):
    s = (s or '').replace(',', '').replace('%', '').strip()
    if re.fullmatch(r'-?\d+', s):
        return int(s)
    if re.fullmatch(r'-?\d+\.\d+', s):
        return float(s)
    return None


def _columns(g):
    """Which grid columns hold party, seats, votes and share.

    Header rows are the leading rows made of <th> cells -- taken from the markup, not
    guessed from cell length, which previously counted two data rows as header and
    absorbed their values into the column names.

    Several tables open each row with a party-colour cell that is empty in the body, and
    its header still says "Party" because the heading is spanned across both. So where
    more than one column claims to be the party, the one actually carrying names in the
    body wins.
    """
    head_n = 0
    for row in g:
        if row and sum(1 for _v, th in row if th) >= max(2, len(row) // 2):
            head_n += 1
        else:
            break
    head_n = max(1, head_n)
    width = max(len(r) for r in g)
    merged = []
    for i in range(width):
        parts = []
        for r in range(head_n):
            if i < len(g[r]) and g[r][i][0] and g[r][i][0].lower() not in (p.lower() for p in parts):
                parts.append(g[r][i][0])
        merged.append(' '.join(parts).lower())
    body = g[head_n:]

    def populated(i):
        n = 0
        for row in body:
            if i < len(row):
                v = row[i][0]
                if v and _num(v) is None:
                    n += 1
        return n

    idx = {}
    party_candidates = []
    for i, name in enumerate(merged):
        if not name:
            continue
        if 'party' in name or 'affiliation' in name:
            party_candidates.append(i)
        elif 'change' in name or '+/' in name or 'swing' in name:
            continue
        elif 'seat' in name and '%' not in name and 'seats' not in idx:
            idx['seats'] = i
        elif 'vote' in name and '%' not in name and 'votes' not in idx:
            idx['votes'] = i
        elif '%' in name and 'seat' not in name and 'share' not in idx:
            idx['share'] = i
    if party_candidates:
        idx['party'] = max(party_candidates, key=populated)
    return idx, merged, head_n


def parse_article(html):
    """(party rows, total row, column names) from the best results table in the page."""
    soup = BeautifulSoup(html, 'lxml')
    best, best_score = ([], None, []), 0
    for table in soup.find_all('table'):
        g = grid(table)
        if len(g) < 3:
            continue
        idx, names, head_n = _columns(g)
        if 'seats' not in idx and 'votes' not in idx:
            continue
        rows, total = [], None
        for row in g[head_n:]:
            if not row:
                continue
            party = (row[idx['party']][0] if 'party' in idx and idx['party'] < len(row)
                     else row[0][0])
            party = re.sub(r'^\W+', '', party or '').strip()
            if not party or _num(party) is not None:
                continue                        # a colour swatch or a stray figure
            rec = {'party': party}
            for key in ('seats', 'votes', 'share'):
                i = idx.get(key)
                rec[key] = _num(row[i][0]) if (i is not None and i < len(row)) else None
            if re.fullmatch(r'total[s]?|all parties', party, re.I):
                total = rec
            elif rec['seats'] is not None or rec['votes'] is not None:
                rows.append(rec)
        # A summary table names each party once. A constituency table repeats them, and
        # being longer it would win on row count alone -- which is how the 2019 article
        # returned twenty-one rows of per-seat results instead of its summary.
        seen_names = [r['party'].lower() for r in rows]
        repeats = len(seen_names) - len(set(seen_names))
        # Votes and share arrive the wrong way round where the header groups them under
        # a spanned "Votes" heading: 1885 came back with votes 30.3 and share 307,119.
        for r in rows + ([total] if total else []):
            v, s = r.get('votes'), r.get('share')
            if v is not None and s is not None and v <= 100 and s > 100:
                r['votes'], r['share'] = s, v
        score = len(set(seen_names)) + (3 if any(r['votes'] for r in rows) else 0) \
            + (3 if any(r['seats'] for r in rows) else 0) + (2 if total else 0) \
            - 2 * repeats
        if score > best_score:
            best, best_score = (rows, total, [n for n in names if n]), score
    return best
