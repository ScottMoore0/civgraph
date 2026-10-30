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
          'Seats:': 'seats', 'seats:': 'contestedSeats', 'Candidates:': 'candidates', 'Turnout:': 'turnout'}
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


def _heads(lines):
    """The general-election contest headings on a page ("1922  CARLOW-KILKENNY")."""
    heads = []
    for ln in lines:
        ws = [w[:2] for w in ln['words']]
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
    return heads


def general_elections(doc):
    """Every general-election contest heading and its labelled figures."""
    out = []
    for pno in range(len(doc)):
        lines = _lines(doc[pno])
        heads = _heads(lines)
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


SIGNS = {'+': 1, '-': -1, '–': -1, '−': -1}
STATUS = ('Elected', 'Eliminated')


def _bold_lines(page, tol=3.5):
    """As _lines, but each word is (x, text, bold). Gallagher sets in bold the party headings
    and the figure at which a candidate was elected."""
    rects = [s['bbox'] for b in page.get_text('dict')['blocks'] for ln in b.get('lines', [])
             for s in ln['spans'] if s['flags'] & 16 and s['text'].strip()]
    words = sorted(page.get_text('words'), key=lambda w: (w[1], w[0]))
    lines = []
    for w in words:
        x0, y0, x1, y1, t = w[:5]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        bold = any(r[0] <= cx <= r[2] and r[1] <= cy <= r[3] for r in rects)
        if lines and abs(lines[-1]['y'] - y0) <= tol:
            lines[-1]['words'].append((x0, t, bold))
        else:
            lines.append({'y': y0, 'words': [(x0, t, bold)]})
    for ln in lines:
        ln['words'].sort()
    return lines


def _is_fig(t):
    return t in SIGNS or t in STATUS or (t[:1] in SIGNS and _num(t[1:]) is not None) or _num(t) is not None


def _cells(ws, starts):
    """One table row's figures. Zone 0 is the column left of the first "Count n" heading
    (first preferences; in a continued table the total carried over, or "Elected" /
    "Eliminated"); each count column holds a transfer (signed, the sign sometimes a word of
    its own: "+ 56") and the running total. Gallagher leaves the total blank where the
    candidate's surplus or votes went out.

    Column headings are not evenly spaced (a long heading such as "Brett, O'Hurley" pushes
    the next one right), so a transfer goes to the count whose heading is nearest, and a
    total to the count of the transfer it follows."""
    lead = {'value': None, 'status': None, 'bold': False}
    cells = [{'transfer': None, 'total': None, 'bold': False, 'status': None, 'spanTransfer': None} for _ in starts]
    cur, sign, span_at, span_sign = None, None, None, 1
    for x, t, b in ws:
        zone = sum(1 for s in starts if x >= s - 6)
        if starts and t in ('(+', '(-'):
            span_at, span_sign = x, SIGNS[t[1]]
            continue
        if starts and span_at is not None and t.endswith(')') and isinstance(_num(t[:-1]), int):
            k = min(range(len(starts)), key=lambda k: abs(span_at - starts[k]))
            cells[k]['spanTransfer'], span_at, cur = span_sign * _num(t[:-1]), None, None
            continue
        if starts and t.startswith('(') and t.endswith(')') and isinstance(_num(t.strip('()').lstrip('+-')), int):
            # "(+231)": transfers over two counts, given only together (Anthony, Cork
            # Borough 1943; Wicklow 1943 sets it "(+ 177)")
            k = min(range(len(starts)), key=lambda k: abs(x - starts[k]))
            v = t.strip('()')
            cells[k]['spanTransfer'] = SIGNS.get(v[:1], 1) * _num(v.lstrip('+-'))
            cur = None
            continue
        signed = t in SIGNS or (t[:1] in SIGNS and isinstance(_num(t[1:]), int))
        if signed and starts and (zone > 0 or lead['value'] is not None):
            # a wide transfer ("-11016") can start left of its own column's heading
            cur = min(range(len(starts)), key=lambda k: abs(x - starts[k]))
            if t in SIGNS:
                sign = SIGNS[t]
            else:
                cells[cur]['transfer'], sign = SIGNS[t[:1]] * _num(t[1:]), None
            continue
        if t in STATUS:
            if zone == 0:
                lead['status'] = t
            else:
                cells[zone - 1]['status'] = t
            continue
        n = _num(t)
        if not isinstance(n, int):
            continue
        if sign is not None and cur is not None:
            cells[cur]['transfer'], sign = sign * n, None
        elif cur is not None and cells[cur]['transfer'] is not None and cells[cur]['total'] is None:
            cells[cur]['total'], cells[cur]['bold'] = n, b
        elif zone == 0:
            if lead['value'] is None:
                lead['value'], lead['bold'] = n, b
        else:
            cells[zone - 1]['total'], cells[zone - 1]['bold'] = n, b
    return lead, cells


def _surname_map(text, others):
    """"Others:  Farrelly, Tucker—Dublin Trades Council" -> {'farrelly': ..., 'tucker': ...}."""
    text = re.sub(r'^Others?:\s*', '', text).strip()
    if '—' not in text:
        return
    # "Bergin—Protectionist Farmer; Henderson—Independent Farmer": one label per part
    parts = []
    for part in text.split(';'):
        if parts and '—' not in part:
            parts[-1] += ';' + part          # a ";" inside one label, not a new name
        else:
            parts.append(part)
    for part in parts:
        if '—' not in part:
            continue
        names, label = part.split('—', 1)
        for n in re.split(r',|\s+and\s+', names):
            if n.strip():
                others[n.strip().lower()] = label.strip(' .')


PARTY_HEADINGS = ('Fianna Fáil', 'Fine Gael', 'Labour', 'National Labour', 'Clann na Talmhan',
                  'Cumann na nGaedheal', 'Farmers', 'National League', 'National Centre Party',
                  'Republicans', 'Sinn Féin', 'Pro-Treaty SF', 'Anti-Treaty SF', 'Others')


def _heading(text):
    """A bold party heading. A note set beside the table can run into the heading's line
    ("Fine Gael seventh), Keogh on the eighth ...", Dublin North-West 1943): keep the
    party name only."""
    for p in sorted(PARTY_HEADINGS, key=len, reverse=True):
        if text.startswith(p + ' ') and text != p:
            return p
    return text


def _note_key(s):
    return re.sub(r'\s+', ' ', (s or '').replace('’', "'").replace('‘', "'")).strip().lower()


def _others_note(printed, others):
    """The footnote label ("Others: Keogan—Independent Republican") for a candidate. A note
    may name a candidate by surname ("Keogan") or in full ("Patrick O'Reilly", where two
    O'Reillys stand); a full name is matched first, so a namesake is not given the label."""
    notes = {_note_key(k): v for k, v in others.items()}
    printed = re.sub(r'\s*\([^)]*\)$', '', printed.lstrip('*'))
    surname, _, forename = printed.partition(',')
    full = _note_key(f'{forename} {surname}')
    if full in notes:
        return notes[full]
    sur = _note_key(surname)
    return notes.get(sur)


def _others_party(heading, note):
    """A candidate printed under Gallagher's "Others" heading belongs to no party in the
    table: the party is the footnote's label where he gives one, else Independent. (Before
    2026-10-30 the reader kept the heading printed above "Others", so independents came out
    as the last party listed.)"""
    if heading in ('Others', 'Other'):
        return note or 'Independent'
    return heading


def _person(printed):
    """"Walsh, William (Ballinrobe)" -> "William Walsh (Ballinrobe)"."""
    printed, tag = re.match(r'^(.*?)\s*(\([^)]*\))?$', printed.lstrip('*')).groups()
    surname, _, forename = printed.partition(',')
    return f"{forename.strip()} {surname.strip()}{' ' + tag if tag else ''}".strip()


def general_election_results(doc):
    """Every general-election contest in full: its labelled figures, each candidate's party
    heading, first preferences and whether elected, and where Gallagher prints it the count
    table: per count the transfer source, each candidate's transfer and running total, and
    the non-transferable papers. Five shapes:
      counts                a full count table (sometimes continued in a second block below)
      partialCounts         the first few counts and a note on the rest (Dublin County 1927)
      firstCountOnly        every seat filled on the first count, so no table of transfers
      firstPreferencesOnly  first preferences and a note (Limerick, Longford-Westmeath 1923)
      unopposed             names only
    Where Gallagher leaves a total blank (a surplus or an elimination went out), the
    running total is the previous one plus the transfer. A note's prose is returned as
    noteText only so a caller can pull figures out of it; it must not be stored."""
    out = []
    for pno in range(len(doc)):
        lines = _bold_lines(doc[pno])
        heads = _heads(lines)
        for h in heads:
            same = [g for g in heads if abs(g['x'] - h['x']) < 60 and g['y'] > h['y']]
            y_hi = min([g['y'] for g in same], default=10_000)
            right = sorted(g['x'] for g in heads if g['x'] - h['x'] >= 60 and abs(g['y'] - h['y']) < 5)
            x_lo, x_hi = h['x'] - 45, (right[0] - 36 if right else 10_000)
            # The party summary is sometimes set beside a short table (Galway 1923): read
            # only what lies left of it.
            for ln in lines:
                ws = ln['words']
                for i in range(len(ws) - 2):
                    if (h['y'] < ln['y'] < y_hi and ws[i][0] > x_lo + 150 and ws[i][0] < x_hi and ws[i][2]
                            and ws[i][1] == 'First' and ws[i + 1][1].startswith('preference')):
                        x_hi = ws[i][0] - 5
            block = []
            for ln in lines:
                if not (h['y'] <= ln['y'] < y_hi):
                    continue
                ws = [w for w in ln['words'] if x_lo <= w[0] < x_hi]
                if not ws:
                    continue
                if ws[0][1] == 'First' and ws[0][2] and len(ws) > 1 and ws[1][1].startswith('preference'):
                    break
                block.append({'y': ln['y'], 'words': ws})
            plain = [{'y': b['y'], 'words': [w[:2] for w in b['words']]} for b in block]
            figs = _labelled(plain, x_lo + 5, x_hi, h['y'], 10_000)
            if 'electorate' not in figs:
                continue
            label_x = min(w[0] for b in block for w in b['words'] if w[1] == 'Electorate:')
            rec = {'year': h['year'], 'month': h['month'],
                   'constituency': h['name'].replace('–', '-').title(), 'page': pno - PAGE_OFFSET, **figs}
            # A note set beside the table (Limerick 1923) shares the table's lines: cut it off.
            note_x = next((w[0] for b in block for w in b['words'] if w[1] in ('Note:', 'Note')), None)
            side = note_x is not None and note_x > label_x + 100
            note_lines, in_note, last_y = [], False, None
            for b in block:
                ws = [w for w in b['words'] if w[0] >= note_x - 3] if side else b['words']
                if any(w[1] in ('Note:', 'Note') for w in ws):
                    in_note = True
                elif in_note and (b['y'] - last_y > 16 or not ws or ws[0][1].startswith('Others')):
                    in_note = False
                if in_note and ws:
                    note_lines.append(' '.join(w[1] for w in ws))
                    last_y = b['y']
            text = ' '.join(w[1] for b in block for w in b['words'])
            if 'unopposed' in text:
                rec['shape'] = 'unopposed'
                rec['candidateList'] = _unopposed(block, label_x)
                rec['noteText'] = ' '.join(note_lines) or None
                out.append(rec)
                continue
            party, cands, others, rows, last, auto = None, [], {}, {}, None, []
            counts = {}            # count number -> {'source', 'kind', 'nonTransferable'}
            starts, nums, desc_until, hdr_y, side_note = [], [], -1, -100, []
            group = 0
            for b in block[1:]:
                ws = [w for w in b['words'] if w[0] < note_x - 3] if side else b['words']
                if starts and b['y'] > desc_until:
                    # A note set beside a short table, unlabelled (Mayo North 1943), starts
                    # well right of the last count column and its "Elected" marks.
                    edge = max(starts) + 100
                    beyond = [w for w in ws if w[0] >= edge]
                    if beyond:
                        side_note.append(' '.join(w[1] for w in beyond))
                        ws = [w for w in ws if w[0] < edge]
                if not ws:
                    continue
                t0, words = ws[0][1], [w[1] for w in ws]
                joined = ' '.join(words)
                hdr, combined, skip = [], {}, set()
                for i in range(len(ws) - 1):
                    if ws[i][1] == 'Count' and ws[i + 1][1].isdigit():
                        hdr.append((ws[i][0], int(ws[i + 1][1])))
                        skip |= {i, i + 1}
                    elif ws[i][1] == 'Counts':
                        # "Counts 2, 3": two surpluses dealt with together, one column
                        k, ns = i + 1, []
                        while k < len(ws) and re.match(r'^(\d+([,–-]\d*)?|and|&)$', ws[k][1]):
                            ns += [int(d) for d in re.findall(r'\d+', ws[k][1])]
                            k += 1
                        if ns:
                            hdr.append((ws[i][0], ns[-1]))
                            combined[ns[-1]] = list(range(ns[0], ns[-1] + 1))
                            skip |= set(range(i, k))
                if hdr:
                    # Waterford-Tipperary East 1922 sets "Count 4" a line above the others
                    # to fit a three-name heading: headings within two lines are one row.
                    if starts and b['y'] - hdr_y < 25:
                        pairs = sorted(set(zip(starts, nums)) | set(hdr))
                    else:
                        pairs = hdr
                    if b['y'] - hdr_y >= 25:
                        group += 1
                    starts, nums, hdr_y = [x for x, _ in pairs], [n for _, n in pairs], b['y']
                    for n in nums:
                        counts.setdefault(n, {'source': [], 'kind': None})
                        if n in combined:
                            counts[n]['countsCombined'] = combined[n]
                    desc_until = b['y'] + 30
                    ws = [w for i, w in enumerate(ws) if i not in skip]
                if b['y'] <= desc_until and starts and ws and not ws[0][2]:
                    for x, t, _ in ws:
                        if x < starts[0] - 6:
                            continue
                        n = nums[sum(1 for s in starts if x >= s - 6) - 1]
                        if t in ('surplus', 'votes', 'surpluses'):
                            counts[n]['kind'] = t
                        else:
                            counts[n]['source'].append(t)
                    continue
                if not ws:
                    continue
                if t0 in ('Others', 'Other') and len(ws) == 1 and ws[0][2]:
                    # the bold "Others" group heading: its candidates are not in the party
                    # printed above (see _others_party)
                    party = 'Others'
                    continue
                if t0.startswith('Others') or t0 in ('Note:', 'Note') or ('—' in joined and not re.search(r'\d', joined)):
                    if '—' in joined:
                        _surname_map(joined, others)
                    continue
                if t0.startswith('Non-transferable'):
                    lead, cells = _cells(ws[1:], starts)
                    for n, c in zip(nums, cells):
                        counts[n]['nonTransferable'] = {'transfer': c['transfer'], 'total': c['total'],
                                                        **({'transferOverTwoCounts': c['spanTransfer']}
                                                           if c.get('spanTransfer') is not None else {})}
                    continue
                if t0.startswith('_') or t0 in LABELS or t0 in ('Valid', 'First', 'preferences'):
                    continue
                if ws[0][2] and ws[0][0] < label_x + 3 and not re.search(r'\d', joined):
                    party = _heading(joined)
                    continue
                if _is_fig(t0) and last is not None and ws[0][0] >= label_x + 60 and b['y'] - row_y < 14:
                    # a figure dropped to the line below its candidate (Vaughan, Cork 1922)
                    _, cells = _cells(ws, starts)
                    for n, c in zip(nums, cells):
                        prev = last['cells'].setdefault(n, {'transfer': None, 'total': None, 'bold': False, 'status': None})
                        for k in ('transfer', 'total', 'status'):
                            if prev[k] is None and c[k] is not None:
                                prev[k] = c[k]
                        prev['bold'] = prev['bold'] or c['bold']
                        last['bold'] = last['bold'] or c['bold']
                    continue
                if not (label_x + 3 <= ws[0][0] < label_x + 30):
                    continue
                j = 0
                while j < len(ws) and not _is_fig(ws[j][1]):
                    j += 1
                printed = ' '.join(w[1] for w in ws[:j])
                if 'Returned' in printed and 'automatically' in printed:
                    # the outgoing Ceann Comhairle, returned without a contest
                    printed = printed.split(' Returned')[0]
                    auto.append({'name': _person(printed), 'nameAsPrinted': printed.lstrip('*'),
                                 'outgoing': printed.startswith('*'), 'party': party, 'partyNote': None,
                                 'firstPreferences': None, 'elected': True, 'electedInTable': False,
                                 'returnedAutomatically': True})
                    continue
                if (j == len(ws) and last is not None and b['y'] - row_y < 14 and t0.startswith('(')
                        and ws[0][0] >= label_x + 20):
                    # "Walsh, William / (Ballinrobe)": namesakes told apart on a second line
                    rows.pop(last['printed'], None)
                    last['printed'] += ' ' + printed
                    rows[last['printed']] = last
                    continue
                if j == len(ws) and last is not None and last['printed'].endswith('-') and b['y'] - row_y < 14:
                    # a double-barrelled name wrapped onto a second line ("MacMurrough- / Kavanagh, Arthur")
                    rows.pop(last['printed'], None)
                    last['printed'] += printed
                    rows[last['printed']] = last
                    continue
                if not (',' in printed or printed.endswith('-')) or j == len(ws):
                    continue
                rest = ws[j:]
                if not starts:
                    # first preferences only: the figure and "Elected", then prose may follow
                    k = 0
                    while k < len(rest) and _is_fig(rest[k][1]):
                        k += 1
                    rest = rest[:k]
                lead, cells = _cells(rest, starts)
                # a continued table repeats the names; a namesake in the same block is a new row
                c = rows.get(printed) or next((v for k, v in rows.items() if k.startswith(printed + ' (')
                                               and v['group'] != group and group not in v['seen']), None)
                if c is None or c['group'] == group:
                    c = rows[printed] = {'printed': printed, 'party': party, 'lead': lead, 'cells': {},
                                         'carried': {}, 'statuses': set(), 'bold': lead['bold'],
                                         'group': group, 'seen': set()}
                    cands.append(c)
                else:
                    if lead['value'] is not None and nums:
                        c['carried'][max([k for k in counts if k < nums[0]], default=1)] = lead['value']
                    c['bold'] = c['bold'] or lead['bold']
                c['seen'].add(group)
                if lead['status']:
                    c['statuses'].add(lead['status'])
                if any(w[1] == 'Elected' for w in rest):
                    c['statuses'].add('Elected')
                for n, cell in zip(nums, cells):
                    c['cells'][n] = cell
                    c['bold'] = c['bold'] or cell['bold']
                last, row_y = c, b['y']
            cols = sorted(counts)
            result = []
            # a footnote names "Others" candidates by surname: where the table has an
            # "Others" heading, a party candidate of the same surname is not meant
            has_others = any(c['party'] == 'Others' for c in cands)
            for c in cands:
                fp = c['lead']['value']
                transfers, totals, running, span = [None], [fp], [fp], {}
                at = 1 if c['lead']['bold'] else None
                for n in cols:
                    cell = c['cells'].get(n, {})
                    tr, tot = cell.get('transfer'), cell.get('total')
                    if cell.get('spanTransfer') is not None:
                        span[n] = cell['spanTransfer']
                    if at is None and cell.get('bold'):
                        at = n
                    transfers.append(tr)
                    totals.append(tot)
                    prev = running[-1]
                    running.append(tot if tot is not None else
                                   None if cell.get('spanTransfer') is not None or (prev is None and tr is None)
                                   else (prev or 0) + (tr or 0))
                note = _others_note(c['printed'], others) if (c['party'] == 'Others' or not has_others) else None
                result.append({
                    'name': _person(c['printed']), 'nameAsPrinted': c['printed'].lstrip('*'),
                    'outgoing': c['printed'].startswith('*'),
                    'party': _others_party(c['party'], note),
                    **({'partyHeading': 'Others'} if c['party'] == 'Others' else {}),
                    'partyNote': note,
                    'firstPreferences': fp,
                    'elected': c['bold'] or 'Elected' in c['statuses'],
                    'electedInTable': c['bold'], 'electedAtCount': at,
                    'transfers': transfers, 'printedTotals': totals, 'runningTotals': running,
                    'carried': c['carried'],
                    **({'transferOverTwoCounts': span} if span else {}),
                })
            result += [a for i, a in enumerate(auto) if a['name'] not in [b['name'] for b in auto[:i]]]
            # a bracketed figure set between two count columns can land on the second; it
            # belongs with the first, which is then blank (non-transferable, Cork Borough 1943)
            for a, b in zip(cols, cols[1:]):
                na, nb = counts[a].get('nonTransferable') or {}, counts[b].get('nonTransferable') or {}
                if 'transferOverTwoCounts' in nb and na.get('transfer') is None and na.get('total') is None and na:
                    na['transferOverTwoCounts'] = nb.pop('transferOverTwoCounts')
            nt_run = [0]
            for n in cols:
                nt = counts[n].get('nonTransferable') or {}
                nt_run.append(nt['total'] if nt.get('total') is not None else
                              None if 'transferOverTwoCounts' in nt or nt_run[-1] is None
                              else nt_run[-1] + (nt.get('transfer') or 0))
            # bold figures (and the automatically returned Ceann Comhairle) account for
            # every seat when the table is complete
            in_table = sum(1 for r in result if r.get('electedInTable') or r.get('returnedAutomatically'))
            whole = in_table >= (rec.get('seats') or 0)
            rec['shape'] = (('counts' if whole else 'partialCounts') if counts else
                            'firstCountOnly' if whole else 'firstPreferencesOnly')
            rec['numCounts'] = cols[-1] if cols else 1
            rec['countNumbers'] = [1] + cols
            rec['counts'] = [{'count': n, **({'countsCombined': counts[n]['countsCombined']} if 'countsCombined' in counts[n] else {}),
                              'source': ' '.join(counts[n]['source']) or None, 'kind': counts[n]['kind'],
                              'nonTransferable': counts[n].get('nonTransferable'),
                              'nonTransferableRunning': nt_run[i + 1]}
                             for i, n in enumerate(cols)]
            rec['candidateList'] = result
            rec['noteText'] = ' '.join(note_lines + side_note) or None
            out.append(rec)
    return out


def _unopposed(block, label_x):
    """Names returned unopposed, set in up to two columns under bold party headings."""
    cols, cands = {}, []
    for b in block[1:]:
        ws = b['words']
        if ws[0][1] in LABELS or ws[0][1] == 'Valid':
            continue
        segs, cur = [], []
        for w in ws:
            if cur and w[0] - cur[-1][0] > 60:
                segs.append(cur)
                cur = []
            cur.append(w)
        segs.append(cur)
        for seg in segs:
            col = 0 if seg[0][0] < label_x + 100 else 1
            txt = ' '.join(w[1] for w in seg)
            if seg[0][2]:
                cols[col] = txt
            elif ',' in txt and 'unopposed' not in txt:
                cands.append({'name': _person(txt), 'nameAsPrinted': txt.lstrip('*'), 'outgoing': txt.startswith('*'),
                              'party': _others_party(cols.get(col), None), 'firstPreferences': None, 'elected': True, 'unopposed': True})
    return cands


if __name__ == '__main__':
    doc = pymupdf.open(sys.argv[1])
    ge, by = general_elections(doc), by_elections(doc)
    print(f'general-election contests: {len(ge)}; by-elections: {len(by)}')
