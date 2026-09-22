#!/usr/bin/env python3
"""Harvest the constituency section of Walker's 1801-1922 volume (pp. 197 onward).

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> \
      python scripts/walker/harvest_constituency_section.py --pages 213-425

This is the second half of the volume and the part nothing has touched. Where the
chronological tables give one election across every seat, this gives one SEAT across
every election from the Union to 1922: who held it, from when, and why it changed hands.

    | population   CARLOW        electorate
      1821 8035    (1 M.P.)      1800-32 13
      year          candidates                    votes
      1801          H. S. Prittie
      1801          Prittie created Lord Dunalley
                    Hon. F. A. Prittie
      1806          Ormsby app. recorder of Prince of Wales Island

Civgraph has no counterpart at all: it holds results, not member succession, and nothing
before 1885. So this cannot be checked against anything -- it is a transcription, marked
unverified, and the same caution applies as to the pre-1885 results.

Votes appear only for contested years; most rows are unopposed returns or the reason a
seat fell vacant, which is why a row without figures is kept rather than dropped.
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import (page_image, words_of, rows_of, PARTY_RE,        # noqa: E402
                     NUM_RE, WALKER_DIR)

VOLUME = 'walker-ireland-1801-1922.pdf'
# A constituency opens with its name in capitals, usually beside a population and an
# electorate figure. Allowing lower case here swallowed candidate surnames.
HEADER_RE = re.compile(r'^[A-Z][A-Z\'\- ]{3,30}$')
YEAR_RE = re.compile(r'^(1[78]\d{2})$')
SEATS_RE = re.compile(r'\((\d+)\s*M\.?P', re.I)
EVENT_RE = re.compile(r'\b(app\.|appointed|created|resign|death|died|unseated|petition|'
                      r'succeeded|elects to sit|vacated|chiltern|escheat)\b', re.I)
SOURCE = {'title': 'Parliamentary Election Results in Ireland, 1801-1922',
          'editor': 'Brian M. Walker (ed.)', 'publisher': 'Royal Irish Academy',
          'year': 1978}


# A column header repeated down the page, or a row that is mostly figures, is not a
# member. Without this the harvest kept lines like "year candidates aff. Oley" and
# "81 1381 218,126 81 4" beside real entries such as
# "Earl of Belfast (G. H. Chichester) L", and roughly half of what it reported was noise.
HEADER_NOISE = re.compile(r'^(year|candidates?|votes?|aff|pol|electorate|population|'
                          r'constituenc|m\.?p\.?|seats?)', re.I)


def _looks_like_entry(text):
    if not text or len(text) < 4:
        return False
    if HEADER_NOISE.match(text.strip()):
        return False
    letters = sum(ch.isalpha() for ch in text)
    if letters < 4 or letters / len(text) < 0.45:
        return False                      # mostly digits and punctuation
    # A member or an event mentions a name or a recognisable act; a bare fragment does not.
    if EVENT_RE.search(text):
        return True
    return bool(re.search(r"[A-Z][a-z]{2,}", text))


def extract_page(pdf, idx):
    """(constituency blocks, stats) from one page of the constituency section."""
    im = page_image(pdf, idx)
    words, (pw, ph) = words_of(im)
    if not words:
        return [], {'rows': 0}
    blocks, current = [], None
    rows = rows_of(words, pw, top=0.06, page_h=ph)
    for row in rows:
        text = ' '.join(w['text'] for w in row).strip()
        if not text or re.search(r'^\d{1,3}$', text):
            continue
        # A constituency heading: mostly capitals, few other words on the line.
        caps = [w['text'] for w in row if HEADER_RE.match(w['text'])]
        if caps and len(' '.join(caps)) >= 4 and len(caps) >= 1 and \
                len(' '.join(caps)) / max(1, len(text)) > 0.25:
            name = ' '.join(caps).title()
            current = {'constituency': name, 'page': idx, 'members': [],
                       'seats': None, 'population': None, 'electorate': None}
            m = SEATS_RE.search(text)
            if m:
                current['seats'] = int(m.group(1))
            nums = [int(w['text'].replace(',', '')) for w in row
                    if NUM_RE.match(w['text']) and len(w['text'].replace(',', '')) >= 4]
            if nums:
                current['population'] = max(nums)
            blocks.append(current)
            continue
        if current is None:
            continue
        lead = row[0]['text']
        year = YEAR_RE.match(lead)
        rest = ' '.join(w['text'] for w in row[1:]).strip(' .|,')
        if not year and not current['members']:
            continue
        party = next((w['text'].strip('[](){}.,') for w in row
                      if PARTY_RE.match(w['text'])), None)
        votes = None
        for w in reversed(row):
            if NUM_RE.match(w['text']) and w['cx'] > pw * 0.7:
                votes = int(w['text'].replace(',', ''))
                break
        entry = {'year': int(year.group(1)) if year else None,
                 'text': rest if year else ' '.join(w['text'] for w in row).strip(' .|,'),
                 'party': party, 'votes': votes}
        if EVENT_RE.search(entry['text']):
            entry['kind'] = 'event'            # a vacancy, appointment or resignation
        else:
            entry['kind'] = 'member'
        if _looks_like_entry(entry['text']):
            current['members'].append(entry)
    return blocks, {'rows': len(rows)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pages', default='213-425')
    ap.add_argument('--out', default=os.path.join(
        'data', 'elections', 'walker-constituency-histories.json'))
    args = ap.parse_args()
    pdf = os.path.join(WALKER_DIR, VOLUME)
    if not os.path.exists(pdf):
        sys.exit(f'not found: {pdf}. Set WALKER_DIR to the folder holding the scans.')
    lo, hi = (int(x) for x in args.pages.split('-'))

    merged, skipped = {}, defaultdict(int)
    for idx in range(lo, hi + 1):
        try:
            blocks, _stats = extract_page(pdf, idx)
        except Exception:
            skipped['pages that could not be read'] += 1
            continue
        if not blocks:
            skipped['pages yielding no constituency'] += 1
            continue
        for b in blocks:
            key = re.sub(r'[^a-z]', '', b['constituency'].lower())
            if key in merged:
                merged[key]['members'] += b['members']
                merged[key]['pages'].append(b['page'])
                for f in ('seats', 'population'):
                    if merged[key][f] is None:
                        merged[key][f] = b[f]
            else:
                b['pages'] = [b.pop('page')]
                merged[key] = b

    records = sorted(merged.values(), key=lambda b: b['constituency'])
    entries = sum(len(b['members']) for b in records)
    doc = {
        'schemaVersion': 1,
        'description': (
            'Constituency histories from the second half of Walker\'s 1801-1922 volume: '
            'for each seat, its members from the Union to 1922 with the year each took '
            'it and, for contested years, the votes. Civgraph holds nothing comparable '
            '-- it records results, not member succession, and nothing before 1885 -- so '
            'this is entirely new material and has no second source. UNVERIFIED: treat '
            'as a transcription to be spot-checked, not as established data.'),
        'provenance': {
            'method': 'scripts/walker/harvest_constituency_section.py',
            'source': SOURCE,
            'licence': 'Facts only: names, years, parties and figures. The volume is in '
                       'copyright, is not in this repository, and its prose is not '
                       'reproduced beyond the short factual reason a seat fell vacant.',
        },
        'counts': {'constituencies': len(records), 'entries': entries,
                   'withVotes': sum(1 for b in records for m in b['members'] if m['votes']),
                   'events': sum(1 for b in records for m in b['members']
                                 if m.get('kind') == 'event'),
                   'skipped': dict(skipped)},
        'records': records,
    }
    out = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {out}')
    for k, v in doc['counts'].items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
