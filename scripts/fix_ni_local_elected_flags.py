#!/usr/bin/env python
"""Fix NI local-election seat counts, elected flags and one collided DEA header (1977-2005).

validate-test2-route.mjs checks that every NI local DEA elects exactly its seat count. Sixteen
did not. Two defects, both in the source per-DEA files, so they are corrected there and every
rebuild stays correct (the same approach as fix_1973_elected_flags.py).

1. STATUS ON EVERY COUNT ROW. In eleven DEAs the scrape set Status='Elected' on every count row
   of candidates who were excluded or left standing at the final count, so 5, 6 or 7 were
   "elected" to 4 or 5 seats. The count data itself is intact, so the result is reconstructed
   from it: a candidate whose total reached the quota was elected; the seats left after them go
   to the highest totals still standing at the final count; everyone else was not elected.
   Checked against published results before being trusted: Omagh Area D 1977 (Johnston,
   McElroy, Martin, Hadden) and Armagh Area D 1977 (Armstrong, McManus, Tobin, Creswell,
   Brannigan) on Wikipedia reproduce exactly.

2. SEAT COUNT. Ballymena Area A 1981 declares 6 seats and a quota of 549, which fits no seat
   count for its 4,244 valid poll, and it has only six candidates, one of them excluded.
   Wikipedia's 1981 Ballymena Borough Council election returns four members (John Armstrong,
   Samuel Hanna, Desmond Armstrong, James Woulahan); with 4 seats the Droop quota is 849 and the
   counts give exactly those four.

3. A COLLIDED HEADER. castle.json holds Belfast's Castle DEA -- its candidates are Nigel Dodds,
   Alban Maginness, John Carson -- but in 1985-2005 its countInfo was Carrickfergus's Castle DEA:
   Council_Name Carrickfergus, 5 seats, and the poll figures of carrick-castle.json exactly.
   First preferences came to four times its "valid poll". Belfast's Castle DEA had 6 seats in
   all of these years (Wikipedia 1985; ARK Belfast City Council results 1993-2011), and the six
   elected in each file are the ones those sources name. The header is restored from Belfast's
   own count: council, 6 seats, valid poll from first preferences, Droop quota. Fields copied
   verbatim from carrick-castle.json that cannot be derived (total poll, spoiled, and the
   electorate where it matches Carrickfergus's) are cleared rather than left wrong.

Idempotent. `--check` reports and writes nothing.
"""
import os, sys, json, math, argparse, collections

BASE = 'data/elections-source/data/elections/local-government'

FLAG_FIXES = [
    ('1977-05-18', 'armagh-area-d'), ('1977-05-18', 'ballymoney-area-c'), ('1977-05-18', 'fermanagh-area-d'),
    ('1977-05-18', 'moyle-area-c'), ('1977-05-18', 'omagh-area-d'),
    ('1981-05-20', 'armagh-area-d'), ('1981-05-20', 'ballymoney-area-c'), ('1981-05-20', 'fermanagh-area-d'),
    ('1981-05-20', 'omagh-area-d'), ('2005-05-05', 'coleraine-east'),
    ('1981-05-20', 'ballymena-area-a'),
]
SEAT_OVERRIDES = {('1981-05-20', 'ballymena-area-a'): 4}
CASTLE_YEARS = ['1985-05-15', '1989-05-17', '1993-05-19', '1997-05-21', '2005-05-05']

# Published winners the reconstruction must reproduce before anything is written. Surnames,
# because the sources spell forenames differently (Pat/Patrick Convery, Danny/Daniel Lavery).
PUBLISHED = {
    ('1977-05-18', 'omagh-area-d'): {'Johnston', 'McElroy', 'Martin', 'Hadden'},
    ('1977-05-18', 'armagh-area-d'): {'Armstrong', 'McManus', 'Tobin', 'Creswell', 'Brannigan'},
    ('1981-05-20', 'ballymena-area-a'): {'Armstrong', 'Hanna', 'Woulahan'},
    ('1985-05-15', 'castle'): {'Carson', 'Maginness', 'Millar', 'Dodds', 'Redpath', 'Campbell'},
    ('1993-05-19', 'castle'): {'Dodds', 'Browne', 'Maginness', 'Carson', 'Stevenson', 'McCausland'},
    ('1997-05-21', 'castle'): {'Dodds', 'Maginness', 'Campbell', 'Lavery', 'Browne', 'McCausland'},
    ('2005-05-05', 'castle'): {'Dodds', 'Convery', 'Browne', 'Mullaghan', 'Cunningham', 'Crozier'},
}


def load(path):
    raw = open(path, encoding='utf-8', newline='').read()
    return json.loads(raw), raw.endswith('\n')


def save(path, doc, trailing_newline):
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text + ('\n' if trailing_newline else ''))


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def reconstruct(rows, seats, quota):
    """Winners from the count data: reached quota, then the best still standing at the end."""
    by = collections.defaultdict(list)
    for r in rows:
        by[r['Candidate_Id']].append(r)
    last_count = max(int(r['Count_Number']) for r in rows)
    reached, standing = set(), {}
    for cid, rs in by.items():
        totals = {int(r['Count_Number']): number(r['Total_Votes']) for r in rs}
        if max(totals.values()) >= quota:
            reached.add(cid)
        elif totals.get(last_count, 0) > 0:
            standing[cid] = totals[last_count]
    fill = sorted(standing, key=lambda c: (-standing[c], c))[:max(0, seats - len(reached))]
    return reached | set(fill), by, last_count


def surnames(by, winners):
    return {by[c][0].get('Surname') for c in winners}


def restatus(rows, winners, by, last_count):
    changed = 0
    for r in rows:
        cid = r['Candidate_Id']
        present_at_end = any(int(x['Count_Number']) == last_count and number(x['Total_Votes']) > 0 for x in by[cid])
        want = 'Elected' if cid in winners else ('Not Elected' if present_at_end else 'Excluded')
        if r.get('Status') != want:
            r['Status'] = want
            changed += 1
        if cid not in winners and r.get('Occurred_On_Count') and present_at_end:
            r['Occurred_On_Count'] = ''
    return changed


def fix_flags(date, slug, check):
    path = os.path.join(BASE, date, slug + '.json')
    doc, nl = load(path)
    c = doc['Constituency']
    ci, rows = c['countInfo'], c['countGroup']
    seats = SEAT_OVERRIDES.get((date, slug), int(number(ci.get('Number_Of_Seats'))))
    valid = number(ci.get('Valid_Poll'))
    quota = math.floor(valid / (seats + 1)) + 1 if (date, slug) in SEAT_OVERRIDES else number(ci.get('Quota'))
    winners, by, last_count = reconstruct(rows, seats, quota)
    if len(winners) != seats:
        sys.exit('FAIL: %s %s reconstructs %d winners for %d seats' % (date, slug, len(winners), seats))
    expected = PUBLISHED.get((date, slug))
    if expected and not expected <= surnames(by, winners):
        sys.exit('FAIL: %s %s reconstruction %s does not reproduce the published winners %s' % (date, slug, sorted(surnames(by, winners)), sorted(expected)))
    before = len({r['Candidate_Id'] for r in rows if r.get('Status') == 'Elected'})
    changed = restatus(rows, winners, by, last_count)
    meta = []
    if (date, slug) in SEAT_OVERRIDES:
        if ci.get('Number_Of_Seats') != str(seats) or ci.get('Quota') != str(int(quota)):
            meta.append('seats %s->%d, quota %s->%d' % (ci.get('Number_Of_Seats'), seats, ci.get('Quota'), quota))
        ci['Number_Of_Seats'] = str(seats)
        ci['Quota'] = str(int(quota))
    if (changed or meta) and not check:
        save(path, doc, nl)
    return '%s %-20s seats=%d elected %d->%d (%d rows restatused)%s' % (date, slug, seats, before, len(winners), changed, ('; ' + ', '.join(meta)) if meta else '')


def fix_castle(date, check):
    path = os.path.join(BASE, date, 'castle.json')
    doc, nl = load(path)
    ci, rows = doc['Constituency']['countInfo'], doc['Constituency']['countGroup']
    carrick = load(os.path.join(BASE, date, 'carrick-castle.json'))[0]['Constituency']['countInfo']
    first = {r['Candidate_Id']: number(r['Candidate_First_Pref_Votes']) for r in rows if str(r['Count_Number']) == '1'}
    seats = 6
    valid = int(round(sum(first.values())))
    quota = math.floor(valid / (seats + 1)) + 1
    winners, by, _ = reconstruct(rows, seats, quota)
    flagged = {r['Candidate_Id'] for r in rows if r.get('Status') == 'Elected'}
    if len(winners) != seats or winners != flagged:
        sys.exit('FAIL: castle %s: count data does not give the six flagged winners under a 6-seat quota' % date)
    expected = PUBLISHED.get((date, 'castle'))
    if expected and surnames(by, winners) != expected:
        sys.exit('FAIL: castle %s winners %s differ from published %s' % (date, sorted(surnames(by, winners)), sorted(expected)))
    new = dict(ci)
    new.update({'Council_Name': 'Belfast', 'Number_Of_Seats': str(seats), 'Valid_Poll': str(valid), 'Quota': str(quota)})
    for field in ('Total_Poll', 'Spoiled', 'Total_Electorate'):
        if ci.get(field) not in ('', None) and ci.get(field) == carrick.get(field):
            new[field] = ''
    diff = {k: (ci.get(k), new[k]) for k in new if ci.get(k) != new[k]}
    if diff and not check:
        doc['Constituency']['countInfo'] = new
        save(path, doc, nl)
    return '%s castle.json          %s' % (date, diff or 'already restored')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    for date, slug in FLAG_FIXES:
        print(fix_flags(date, slug, args.check))
    for date in CASTLE_YEARS:
        print(fix_castle(date, args.check))
    print('\n--check: nothing written' if args.check else '\nwritten')


if __name__ == '__main__':
    main()
