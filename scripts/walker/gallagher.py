#!/usr/bin/env python3
"""Read Michael Gallagher, Irish Elections 1922-44: Results and Analysis (PSAI Press, 1993).

    python scripts/walker/gallagher.py <path to the PDF>

The PDF (published free by TCD's Department of Political Science) has a text layer, but
reading it as flowing text pairs figures with the wrong contest wherever two unopposed
returns sit side by side: page 22 comes out as "LIMERICK CITY AND EAST Electorate: 44,911
... Electorate: 46,991", and the second electorate belongs to the other column. So this reads
words with their positions: a contest's figures are the labelled values in the column under
its heading.

Two readers:
  general_elections(doc)  heading, electorate, valid votes, quota and seats of every
                          general-election contest (the transfer tables are not read)
  by_elections(doc)       every by-election in full: date, seat, electorate, valid votes,
                          quota, each candidate's first preferences and count-by-count
                          totals, and the cause of the vacancy

The book is in copyright and is not in this repository; only figures are taken from it.
"""
import re
import sys

import pymupdf

YEAR = re.compile(r'^19[234]\d$')
DATE = re.compile(r'^(\d{1,2})\.(\d{1,2})\.(\d{2})$')
NUM = re.compile(r'^\d{1,3}(?:,\d{3})*$|^\d+$')
LABELS = {'Electorate:': 'electorate', 'votes:': 'validVotes', 'Quota:': 'quota',
          'Seats:': 'seats', 'Candidates:': 'candidates', 'Turnout:': 'turnout'}
PAGE_OFFSET = 13          # PDF page index minus printed page number


def _lines(page, tol=3.5):
    """Words grouped into printed lines, each sorted left to right."""
    words = sorted(page.get_text('words'), key=lambda w: (w[1], w[0]))
    lines = []
    for w in words:
        x0, y0, x1, y1, t = w[:5]
        if lines and abs(lines[-1]['y'] - y0) <= tol:
            lines[-1]['words'].append((x0, t))
        else:
            lines.append({'y': y0, 'words': [(x0, t)]})
    for ln in lines:
        ln['words'].sort()
    return lines


def _num(t):
    t = t.replace(',', '').replace('%', '')
    try:
        return float(t) if '.' in t else int(t)
    except ValueError:
        return None


def _labelled(lines, x_lo, x_hi, y_lo, y_hi):
    """Label -> value for the labels printed in one column between two heights."""
    out = {}
    for ln in lines:
        if not (y_lo < ln['y'] < y_hi):
            continue
        ws = [(x, t) for x, t in ln['words'] if x_lo - 5 <= x < x_hi]
        for i, (x, t) in enumerate(ws):
            key = LABELS.get(t)
            if key and key not in out:
                for _, v in ws[i + 1:]:
                    n = _num(v)
                    if n is not None:
                        out[key] = n
                        break
    return out


def general_elections(doc):
    """Every general-election contest heading and its labelled figures."""
    out = []
    for pno in range(len(doc)):
        lines = _lines(doc[pno])
        heads = []
        for ln in lines:
            ws = ln['words']
            for i, (x, t) in enumerate(ws):
                if YEAR.match(t) and i + 1 < len(ws) and ws[i + 1][1][:1].isupper() and ws[i + 1][1].isupper():
                    name = []
                    for _, u in ws[i + 1:]:
                        if YEAR.match(u) or u.endswith(':'):
                            break
                        name.append(u)
                    # 1927 had two elections and heads them "June 1927 CLARE", "Sept 1927
                    # GALWAY": the block's column is anchored on the month, not the year.
                    month = ws[i - 1][1] if i > 0 and ws[i - 1][1] in ('June', 'Sept') else None
                    hx = ws[i - 1][0] if month else x
                    heads.append({'x': hx, 'y': ln['y'], 'year': int(t), 'month': month, 'name': ' '.join(name)})
        for h in heads:
            # The block's labels start ~36pt left of the year and run down to the next
            # heading in the same column.
            col = [g for g in heads if abs(g['x'] - h['x']) < 60 and g['y'] > h['y']]
            y_hi = min([g['y'] for g in col], default=10_000)
            others = sorted({g['x'] for g in heads if abs(g['x'] - h['x']) >= 60 and g['x'] > h['x']})
            x_hi = (others[0] - 36) if others else 10_000
            figs = _labelled(lines, h['x'] - 40, x_hi, h['y'], min(y_hi, h['y'] + 120))
            if 'electorate' not in figs:
                continue
            out.append({'year': h['year'], 'month': h['month'], 'constituency': h['name'].replace('–', '-').title(),
                        'page': pno - PAGE_OFFSET, **figs})
    return out


def by_elections(doc):
    """Every by-election: its figures, candidates and counts, and the cause."""
    out = []
    in_section = False
    for pno in range(len(doc)):
        text = doc[pno].get_text()
        if re.search(r'By-elections to fill vacancies', text):
            in_section = True
        elif in_section and re.search(r'Electorate, valid votes and first preferences|^\s*\d+\s*The \w+ general election', text[:400]):
            in_section = False
        if not in_section:
            continue
        lines = _lines(doc[pno])
        starts = [i for i, ln in enumerate(lines)
                  if len(ln['words']) >= 3 and NUM.match(ln['words'][0][1]) and DATE.match(ln['words'][1][1])]
        for k, i in enumerate(starts):
            block = lines[i:starts[k + 1] if k + 1 < len(starts) else len(lines)]
            head = block[0]['words']
            d, m, y = DATE.match(head[1][1]).groups()
            rec = {'number': int(head[0][1]), 'date': f'19{y}-{int(m):02d}-{int(d):02d}',
                   'constituency': ' '.join(t for _, t in head[2:]).replace('–', '-').title(),
                   'page': pno - PAGE_OFFSET}
            rec.update(_labelled(block, 80, 230, block[0]['y'] - 1, 10_000))
            party, cands, cause = None, [], []
            reading_cause = False
            for ln in block[1:]:
                ws = ln['words']
                first_x, first = ws[0]
                if first == 'Cause:' or reading_cause:
                    reading_cause = True
                    if first.startswith('Other') or first.startswith('Note'):
                        rec.setdefault('notes', []).append(' '.join(t for _, t in ws))
                        continue
                    cause.append(' '.join(t for _, t in ws if t != 'Cause:'))
                    continue
                if first in LABELS or first in ('Valid', 'First', 'preferences', 'Count') or ln is block[0]:
                    continue
                if first == 'Non-transferable':
                    continue
                if first_x < 100 and not any(NUM.match(t.replace('+', '').replace('-', '')) for _, t in ws):
                    party = ' '.join(t for _, t in ws)
                    continue
                if 100 <= first_x < 130 and ',' in first:
                    name = []
                    j = 0
                    while j < len(ws) and not re.match(r'^[\d+\-]', ws[j][1]):
                        name.append(ws[j][1])
                        j += 1
                    toks = [t for _, t in ws[j:]]
                    counts, pct, sign = [], None, None
                    for t in toks:
                        if t in ('+', '-'):
                            sign = t
                            continue
                        n = _num(t.lstrip('+-'))
                        if n is None:
                            continue
                        if isinstance(n, float):
                            pct = n
                        elif sign or t[:1] in '+-':
                            sign = None          # a transfer; the running total follows it
                        else:
                            counts.append(n)
                    surname, _, forename = ' '.join(name).partition(',')
                    cands.append({'name': f'{forename.strip()} {surname.strip()}'.strip(),
                                  'party': party, 'firstPreferences': counts[0] if counts else None,
                                  'counts': counts, 'firstPreferencePct': pct})
            if cands:
                final = max(cands, key=lambda c: (len(c['counts']), c['counts'][-1] if c['counts'] else 0))
                for c in cands:
                    c['elected'] = c is final
            if not cands:
                # An unopposed return is printed as prose: "Dr Robert Rowlette (Ind) was
                # returned unopposed. The vacancy was caused by the death on ... of ...".
                prose = ' '.join(t for ln in block[1:] for _, t in ln['words'])
                m = re.search(r"^(.*?)\s+\(([^)]+)\)\s+was returned unopposed", prose)
                if m:
                    name = re.sub(r'^(Dr|Mr|Mrs|Prof\.?|Sir)\s+', '', m.group(1)).strip()
                    cands.append({'name': name, 'party': m.group(2), 'firstPreferences': None,
                                  'counts': [], 'firstPreferencePct': None, 'unopposed': True})
                    c = re.search(r'The vacancy was caused by (?:the )?(.*?)(?:\s+\d{1,3})?$', prose)
                    if c:
                        cause.append(c.group(1))
            rec['candidates'] = cands
            # The page number printed at the foot follows the last block's cause.
            rec['cause'] = re.sub(r'\s+\d{1,3}$', '', ' '.join(cause).strip()) or None
            out.append(rec)
    return out


def _row(ws):
    """(name, counts, pct) from one candidate line: running totals only, transfers skipped.
    Reading stops at the first word that is neither a figure nor a sign, so a note set
    beside the table ("Note: These figures ...") is not read as counts."""
    name, j = [], 0
    while j < len(ws) and not re.match(r'^[\d+\-]', ws[j][1]):
        name.append(ws[j][1])
        j += 1
    counts, pct, sign = [], None, None
    for _, t in ws[j:]:
        if t in ('+', '-'):
            sign = t
            continue
        if t == 'Elected':
            continue
        n = _num(t.lstrip('+-'))
        if n is None:
            break
        if isinstance(n, float):
            pct = n
        elif sign or t[:1] in '+-':
            sign = None
        else:
            counts.append(n)
    surname, _, forename = ' '.join(name).lstrip('*').partition(',')
    return f'{forename.strip()} {surname.strip()}'.strip(), counts, pct


def general_election_contest(doc, printed_page, heading):
    """One general-election contest in full, found by its heading on a printed page:
    figures, candidates with party, first preferences and running totals, and who was
    elected (reached the quota, or the last standing when seats were filled without it)."""
    pno = printed_page + PAGE_OFFSET
    lines = _lines(doc[pno])
    start = next(i for i, ln in enumerate(lines)
                 if re.search(r'19\d\d\s+' + re.escape(heading.upper()), ' '.join(t for _, t in ln['words'])))
    x0 = min(x for x, _ in lines[start]['words']) - 36
    end = next((i for i in range(start + 1, len(lines))
                if re.match(r'^(June |Sept )?19\d\d\s+[A-Z]{3}', ' '.join(t for _, t in lines[i]['words']))
                and abs(lines[i]['words'][0][0] - lines[start]['words'][0][0]) < 60), len(lines))
    block = lines[start:end]
    rec = _labelled(block, x0 - 5, x0 + 200, block[0]['y'] - 1, 10_000)
    party, cands, others = None, [], {}
    for ln in block[1:]:
        ws = [(x, t) for x, t in ln['words'] if x >= x0 - 5]
        if not ws:
            continue
        fx, first = ws[0]
        text = ' '.join(t for _, t in ws)
        if first.startswith('Others:') or ('—' in text and not re.search(r'\d', text)):
            for part in re.split(r'\s{2,}|;', re.sub(r'^Others?:\s*', '', text)):
                if '—' in part:
                    s, lab = part.split('—', 1)
                    others[s.strip().lower()] = lab.strip(' .')
            continue
        if first in LABELS or first in ('Valid', 'Count', 'First', 'Non-transferable') or first.startswith('First'):
            continue
        if fx < x0 + 10 and not re.search(r'\d', text) and ',' not in first and not first.startswith('*'):
            party = text if len(text) < 40 else party
            continue
        # An outgoing TD is marked "*Ruttledge,": the asterisk sits left of the indent.
        if x0 + 4 <= fx < x0 + 45 and (',' in first or first.startswith('*')):
            name, counts, pct = _row(ws)
            if counts:
                cands.append({'name': name, 'party': party, 'firstPreferences': counts[0], 'counts': counts})
    q = rec.get('quota') or 10 ** 9
    seats = rec.get('seats') or 1
    reached = [c for c in cands if max(c['counts']) >= q]
    rest = sorted((c for c in cands if c not in reached),
                  key=lambda c: (len(c['counts']), c['counts'][-1]), reverse=True)
    winners = (reached + rest)[:seats]
    for c in cands:
        c['elected'] = c in winners
        if c['party'] in ('Others', 'Other'):
            c['party'] = others.get(c['name'].split()[-1].lower(), 'Independent')
    return {**rec, 'candidates': cands, 'page': printed_page}


if __name__ == '__main__':
    doc = pymupdf.open(sys.argv[1])
    ge, by = general_elections(doc), by_elections(doc)
    print(f'general-election contests: {len(ge)}; by-elections: {len(by)}')
