#!/usr/bin/env python3
"""Recover the per-person candidate ids that ElectionsIreland publishes and our
scrapers threw away.

WHY THIS EXISTS. Persons in the election data have no identifier of their own. The
registry keys them on the NAME, because the `id` on a candidacy is often a row index
rather than a person -- id '1' sits on 2,260 candidacies under unrelated names. Keying
on the name has two opposite failure modes and the audit finds both:

  OVER-MERGE   two people who share a name become one 106-year career.
  UNDER-MERGE  one person spelled two ways becomes two people.

Neither is fixable from the data we hold, because the data we hold contains no evidence
of identity at all. It is fixable from the SOURCE. Every ElectionsIreland result page
links each candidate to `candidate.cfm?ID=<n>`, and that id is the person, not the row:

  ID=1     Seamus Pattison, in 1961, 1969, 1977, 1987 and 1997 alike
  ID=2549  Jim Gibbons (Carlow-Kilkenny, 1961-1977)
  ID=3084  Jim Gibbons (Carlow-Kilkenny, 1997)   <- a different man, same name

That is exactly the evidence both failure modes need, and scrape_ei_dail*.py dropped it
on the floor: they kept name, party, votes and counts, and not the link the name sat in.

WHAT THIS DOES. Re-fetches the result page each constituency file already records in its
own `source_url`, reads the candidate ids off it, and writes `ei_candidate_id` onto the
matching candidate. Nothing else in the file is touched. The pages are cached under
.cache/, so a re-run costs nothing and an interrupted run resumes where it stopped.

MATCHING, AND WHEN IT REFUSES. Ids are matched to candidates by normalised name. Where
that is unambiguous it is taken. Where the page and the file list the same number of
candidates in the same order but a name does not match, the position is used and the
row is reported as `positional` so it can be inspected. Anything else is left alone --
an unstamped candidacy keeps the behaviour it has today, which is name keying, and that
is strictly better than a confidently wrong id.

  python scripts/harvest_ei_candidate_ids.py --body dail-eireann
  python scripts/harvest_ei_candidate_ids.py --all --report
"""
import os
import re
import sys
import csv
import json
import glob
import time
import random
import hashlib
import argparse
import unicodedata
import collections
import concurrent.futures

try:
    import httpx
    from bs4 import BeautifulSoup
except ImportError as exc:  # pragma: no cover - environment problem, not logic
    sys.exit(f'missing dependency: {exc}. pip install httpx beautifulsoup4')

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
ELECTIONS = os.path.join(REPO, 'data', 'elections-source', 'data', 'elections')
CACHE = os.path.join(REPO, '.cache', 'electionsireland')
REPORT = os.path.join(REPO, 'data', 'elections', 'persons', 'ei-candidate-id-harvest.csv')

# Only result.cfm pages carry candidate links. A referendum page has no candidates at
# all, so those files are skipped rather than fetched and found empty.
RESULT_URL = re.compile(r'electionsireland\.org/result\.cfm\?election=([^&]+)&(?:amp;)?cons=(\d+)', re.I)
CANDIDATE_ID = re.compile(r'ID=\s*(\d+)', re.I)
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project; contact via civgraph.net)'}


def matchkey(value):
    """Same normalisation the person registry uses, so a name that matches here matches
    there. Accents folded, punctuation dropped, case flattened."""
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", ' ', text)).strip()


NAME_TITLES = {
    'general', 'gen', 'sir', 'major', 'maj', 'captain', 'capt', 'dr', 'doctor', 'countess',
    'count', 'lady', 'lord', 'colonel', 'col', 'lt', 'lieutenant', 'commandant', 'comdt',
    'professor', 'prof', 'rev', 'reverend', 'fr', 'father', 'mrs', 'mr', 'ms', 'miss',
    'senator', 'sen', 'cllr', 'councillor', 'alderman', 'ald', 'the', 'hon', 'dame', 'madame',
}
NAME_PARTICLES = {'o', 'de', 'di', 'da', 'van', 'von', 'mac', 'mc', 'ni', 'ui', 'la', 'le'}


def name_parts(value):
    """(surname, forenames) with titles dropped and particles kept out of the forenames."""
    tokens = [t for t in matchkey(value).split() if t not in NAME_TITLES]
    if not tokens:
        return None, []
    return tokens[-1], [t for t in tokens[:-1] if t not in NAME_PARTICLES]


def forenames_compatible(a, b):
    for x, y in zip(a, b):
        if not (x == y or (len(x) == 1 and y.startswith(x)) or (len(y) == 1 and x.startswith(y))):
            return False
    return True


def names_compatible(a, b):
    """The same person written two ways, as far as the letters can show.

    Same surname, and forenames that agree as far as both go, where an initial agrees
    with any name it begins. So "General Richard Mulcahy" is Richard Mulcahy, "P. J.
    Ruttledge" is Patrick J Ruttledge and "Arthur MacMurrough-Kavanagh" is Arthur
    Kavanagh, but "Edmund Wall" is not Edward Wall and "Eugene Doherty" is not Joseph
    O'Doherty. It is only ever used inside one contest's page, and only for a unique hit.
    """
    sa, fa = name_parts(a)
    sb, fb = name_parts(b)
    return bool(sa) and sa == sb and bool(fa) and bool(fb) and forenames_compatible(fa, fb)


def cache_path(url):
    digest = hashlib.sha1(url.encode('utf-8')).hexdigest()
    return os.path.join(CACHE, digest[:2], digest + '.html')


def fetch(client, url, refresh=False, delay=1.2, retries=3):
    """Return the page text, from the cache when we already have it.

    The cache is what makes this rerunnable. Harvesting three thousand pages is an hour
    of someone else's bandwidth; paying it twice because a later step failed would be
    rude as well as slow."""
    path = cache_path(url)
    if os.path.exists(path) and not refresh:
        with open(path, encoding='utf-8', errors='replace') as fh:
            return fh.read(), True
    for attempt in range(retries):
        try:
            response = client.get(url)
            if response.status_code == 200 and len(response.text) > 800:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w', encoding='utf-8') as fh:
                    fh.write(response.text)
                time.sleep(delay + random.random() * 0.4)
                return response.text, False
        except Exception:
            pass
        time.sleep(2 + attempt * 3)
    return None, False


def parse_candidate_ids(html):
    """Candidate links in document order, which is the order the result table lists them.

    The href is not tidy -- the id sits on its own line inside the attribute -- so the
    digits are pulled out rather than the attribute parsed as a number."""
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for anchor in soup.find_all('a', href=True):
        if 'candidate.cfm' not in anchor['href'].lower():
            continue
        found = CANDIDATE_ID.search(anchor['href'])
        if not found:
            continue
        name = re.sub(r'\s+', ' ', anchor.get_text(strip=True)).strip()
        if not name:
            continue
        out.append({'id': int(found.group(1)), 'name': name})
    return out


def assign(page_candidates, file_candidates):
    """Map page ids onto file candidates, and say how each one was decided.

    Returns (assignments, how) where assignments is index -> id. `how` is one of
    'name' (a unique name match), 'positional' (same length, same order, name differed)
    or 'unmatched'."""
    by_key = collections.defaultdict(list)
    for index, entry in enumerate(page_candidates):
        by_key[matchkey(entry['name'])].append(index)

    assignments = {}
    how = {}
    used = set()
    for index, candidate in enumerate(file_candidates):
        key = matchkey(candidate.get('name'))
        hits = [i for i in by_key.get(key, []) if i not in used]
        if len(hits) == 1:
            used.add(hits[0])
            assignments[index] = page_candidates[hits[0]]['id']
            how[index] = 'name'

    # Second pass: the same person written differently on the page ("General Richard
    # Mulcahy", "P. J. Ruttledge"). Taken only when exactly one unused page name is
    # compatible with this row AND no other unassigned row is compatible with that page
    # name, so two Patrick Ryans in one contest are never guessed between.
    open_rows = [i for i in range(len(file_candidates)) if i not in assignments]
    for index in open_rows:
        hits = [j for j in range(len(page_candidates)) if j not in used
                and names_compatible(file_candidates[index].get('name'), page_candidates[j]['name'])]
        if len(hits) != 1:
            continue
        rivals = [k for k in open_rows if k != index and k not in assignments
                  and names_compatible(file_candidates[k].get('name'), page_candidates[hits[0]]['name'])]
        if rivals:
            continue
        used.add(hits[0])
        assignments[index] = page_candidates[hits[0]]['id']
        how[index] = 'compatible-name'

    # Positional fallback, and only when the two lists are the same length. A page with
    # a different number of candidates than the file is a different reading of the
    # contest, and guessing across that is how a wrong id gets written confidently.
    if len(page_candidates) == len(file_candidates):
        for index in range(len(file_candidates)):
            if index in assignments:
                continue
            if index in used:
                continue
            assignments[index] = page_candidates[index]['id']
            how[index] = 'positional'
            used.add(index)

    for index in range(len(file_candidates)):
        how.setdefault(index, 'unmatched')
    return assignments, how


def prefetch(urls, workers=4, delay=1.0, refresh=False):
    """Fill the cache concurrently, then let the matching pass read it sequentially.

    Fetching one page at a time ran at thirteen a minute -- four hours for the archive --
    and almost all of that was waiting on the far end rather than loading it. A small
    pool of workers, each still pausing between its own requests, keeps the offered rate
    to roughly two a second while cutting the wall clock to about an hour. Splitting
    fetching from matching also keeps the matching code sequential and readable: by the
    time it runs, every page it wants is already on disk."""
    todo = [u for u in urls if refresh or not os.path.exists(cache_path(u))]
    if not todo:
        return 0, 0
    print(f'prefetching {len(todo):,} pages with {workers} workers '
          f'({len(urls) - len(todo):,} already cached)', flush=True)
    done = {'ok': 0, 'fail': 0}

    def worker(chunk):
        client = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)
        for url in chunk:
            html, _ = fetch(client, url, refresh=refresh, delay=delay)
            if html:
                done['ok'] += 1
            else:
                done['fail'] += 1
            total = done['ok'] + done['fail']
            if total % 100 == 0:
                print(f'  {total:>5}/{len(todo):,} fetched ({done["fail"]} failed)', flush=True)
        client.close()

    chunks = [todo[i::workers] for i in range(workers)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(worker, chunks))
    return done['ok'], done['fail']


BYELECTION_INDEX = 'https://electionsireland.org/results/general/byelectiondail.cfm'
MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june',
     'july', 'august', 'september', 'october', 'november', 'december'])}


def byelection_index(client, refresh=False, delay=1.2):
    """Dail by-elections, keyed by (date, constituency).

    The by-election files carry no source_url -- whoever scraped them did not have one
    to record -- so there is nothing for the main pass to re-fetch. ElectionsIreland
    does hold them, under result.cfm?election=<year>B&cons=<id>, listed on one index
    page. Reading that index gives every by-election a url, which is then harvested by
    exactly the same code as everything else and recorded in the file so this lookup is
    needed once."""
    html, _ = fetch(client, BYELECTION_INDEX, refresh=refresh, delay=delay)
    if not html:
        return {}
    soup = BeautifulSoup(html, 'html.parser')
    out = {}
    for anchor_tag in soup.find_all('a', href=True):
        if 'result.cfm' not in anchor_tag['href']:
            continue
        row = anchor_tag.find_parent('tr')
        if not row:
            continue
        cells = [re.sub(r'\s+', ' ', td.get_text(strip=True)) for td in row.find_all('td')]
        date = next((c for c in cells if re.fullmatch(r'\d{1,2} [A-Za-z]+ \d{4}', c)), None)
        if not date:
            continue
        day, month, year = date.split()
        month = MONTHS.get(month.lower())
        if not month:
            continue
        iso = f'{int(year):04d}-{month:02d}-{int(day):02d}'
        constituency = anchor_tag.get_text(strip=True)
        url = 'https://electionsireland.org/' + anchor_tag['href'].split('/')[-1].lstrip('./')
        out[(iso, matchkey(constituency))] = url.split('&ref=')[0]
    return out


LIFESPANS = os.path.join(REPO, 'data', 'elections', 'persons', 'ei-candidate-lifespans.json')
RENDERED = os.path.join(REPO, 'render', 'metadata', 'elections-test2')
BORN = re.compile('Born: ([0-9]{1,2} [A-Za-z]+ [0-9]{4})')
DIED = re.compile('Died: ([0-9]{1,2} [A-Za-z]+ [0-9]{4})')


def to_iso(text):
    parts = (text or '').split()
    if len(parts) != 3 or parts[1].lower() not in MONTHS:
        return None
    return '%04d-%02d-%02d' % (int(parts[2]), MONTHS[parts[1].lower()], int(parts[0]))


def harvest_lifespans(client, refresh=False, delay=1.2, max_span=45, max_gap=25):
    """Birth and death dates for every source person id whose career looks impossible.

    A source id is evidence, not proof. ElectionsIreland files a 2024 Laois candidate
    under ID 1021, which is Austin Stack, born 1879 and dead since 1929 -- and its own
    candidate page says so. Where the source gives a lifespan, a candidacy after the
    death or before the age of 21 cannot be that person, and the builder detaches it
    from the id. Where it gives none, nothing is decided here: a long gap is a reason to
    look, and deciding it would be the name-based guess the ids exist to replace.

    Only ids that trip the audit's own thresholds are fetched, and entries already on
    file are kept, so a later build that no longer trips them does not lose the record
    of why."""
    years = collections.defaultdict(list)
    names = collections.defaultdict(set)
    for path in glob.glob(os.path.join(RENDERED, '*.json')):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        date = str(data.get('date') or '')
        if not date[:4].isdigit():
            continue
        for result in data.get('results') or []:
            for candidate in result.get('candidates') or []:
                spid = candidate.get('sourcePersonId') or candidate.get('sourcePersonIdRejected', {}).get('id')
                if spid:
                    years[spid].append(int(date[:4]))
                    names[spid].add(candidate.get('name') or '')
    suspect = []
    for spid, ys in years.items():
        ys = sorted(ys)
        gap = max((ys[i + 1] - ys[i] for i in range(len(ys) - 1)), default=0)
        if ys[-1] - ys[0] > max_span or gap > max_gap:
            suspect.append(spid)

    existing = {}
    if os.path.exists(LIFESPANS):
        with open(LIFESPANS, encoding='utf-8') as fh:
            existing = json.load(fh).get('persons') or {}
    for spid in sorted(suspect, key=lambda value: int(value.split(':')[1])):
        if spid in existing and not refresh:
            continue
        url = 'https://electionsireland.org/candidate.cfm?ID=%d' % int(spid.split(':')[1])
        html, _ = fetch(client, url, refresh=refresh, delay=delay)
        text = ' '.join(BeautifulSoup(html or '', 'html.parser').get_text(' ', strip=True).split())
        born, died = BORN.search(text), DIED.search(text)
        existing[spid] = {
            'names': sorted(names[spid]),
            'born': to_iso(born.group(1)) if born else None,
            'died': to_iso(died.group(1)) if died else None,
            'url': url,
        }
    doc = {
        'description': 'Lifespans ElectionsIreland publishes for source person ids whose '
                       'candidacies span an implausible career. Read by '
                       'build-test2-election-manifest.mjs, which detaches a candidacy from '
                       'the id when it falls after the death or before the age of 21.',
        'generatedBy': 'scripts/harvest_ei_candidate_ids.py --lifespans',
        'persons': dict(sorted(existing.items(), key=lambda kv: int(kv[0].split(':')[1]))),
    }
    os.makedirs(os.path.dirname(LIFESPANS), exist_ok=True)
    with open(LIFESPANS, 'w', encoding='utf-8', newline='') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    dated = sum(1 for v in existing.values() if v['born'] or v['died'])
    print('lifespans: %d suspect ids, %d on file, %d with a birth or death date' % (len(suspect), len(existing), dated))
    print('wrote ' + LIFESPANS)


def source_files(bodies=None):
    out = []
    for path in sorted(glob.glob(os.path.join(ELECTIONS, '*', '*', '*.json'))):
        if os.path.basename(path).startswith('_'):
            continue
        body = os.path.basename(os.path.dirname(os.path.dirname(path)))
        if bodies and body not in bodies:
            continue
        out.append((body, path))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--body', action='append', default=[],
                        help='body slug to harvest; repeatable. Default: every body with '
                             'ElectionsIreland result pages.')
    parser.add_argument('--all', action='store_true', help='every body (the default).')
    parser.add_argument('--limit', type=int, default=0, help='stop after N pages (for a trial run).')
    parser.add_argument('--refresh', action='store_true', help='re-fetch even when cached.')
    parser.add_argument('--delay', type=float, default=1.2, help='seconds between live fetches.')
    parser.add_argument('--dry-run', action='store_true', help='report only; write nothing.')
    parser.add_argument('--report', action='store_true', help='write the per-candidacy CSV.')
    parser.add_argument('--workers', type=int, default=4, help='concurrent prefetch workers.')
    parser.add_argument('--lifespans', action='store_true',
                        help='fetch birth/death dates for source ids with impossible careers, then stop.')
    parser.add_argument('--byelections', action='store_true',
                        help="also recover source urls for by-elections, which carry none.")
    args = parser.parse_args()

    bodies = set(args.body) if args.body and not args.all else None
    files = source_files(bodies)
    client = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)
    if args.lifespans:
        harvest_lifespans(client, refresh=args.refresh, delay=args.delay)
        return
    byelections = byelection_index(client, refresh=args.refresh, delay=args.delay)         if args.byelections else {}
    if args.byelections:
        print(f'by-election index: {len(byelections):,} contests', flush=True)

    stats = collections.Counter()
    per_body = collections.defaultdict(collections.Counter)
    rows = []
    fetched = 0

    if args.workers > 1 and not args.limit:
        wanted = []
        for _, path in files:
            with open(path, encoding='utf-8') as fh:
                peek = json.load(fh)
            url = str(peek.get('source_url') or '')
            if not RESULT_URL.search(url) and byelections:
                url = byelections.get((os.path.basename(os.path.dirname(path)),
                                       matchkey(peek.get('constituency') or '')), '')
            if RESULT_URL.search(url):
                wanted.append(url)
        prefetch(sorted(set(wanted)), workers=args.workers, delay=args.delay, refresh=args.refresh)

    for body, path in files:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        url = str(data.get('source_url') or '')
        if not RESULT_URL.search(url) and byelections:
            key = (os.path.basename(os.path.dirname(path)),
                   matchkey(data.get('constituency') or ''))
            found = byelections.get(key)
            if found:
                url = found
                data['source_url'] = url
                stats['byelection:url-recovered'] += 1
        if not RESULT_URL.search(url):
            stats['skipped:no-ei-url'] += 1
            continue
        # A file with no candidates of its own is still worth fetching. 131 Dail
        # constituency files are empty -- our scrape of those pages came back with
        # nothing -- and their candidacies reach the site from the Wikipedia count
        # sidecar instead. Skipping them meant the one place that could name those
        # people was never even requested.
        candidates = data.get('candidates') or []
        if args.limit and fetched >= args.limit:
            break

        html, from_cache = fetch(client, url, refresh=args.refresh, delay=args.delay)
        fetched += 1
        if not from_cache:
            stats['fetched'] += 1
        else:
            stats['cached'] += 1
        if not html:
            stats['page:failed'] += 1
            per_body[body]['failed'] += 1
            continue

        page = parse_candidate_ids(html)
        if not page:
            stats['page:no-candidate-links'] += 1
            per_body[body]['no-links'] += 1
            continue

        assignments, how = assign(page, candidates)
        changed = False

        # The whole roster the page carried, not only the part we matched. Our own scrape
        # of these pages was incomplete -- the Wikipedia count sidecars know candidates
        # for 1922-1969 that our files never had -- and those candidacies reach the site
        # through the sidecar rather than through `candidates` below. Recording what the
        # page actually listed lets the builder name them too, and costs one small array
        # per constituency.
        roster = [{'id': entry['id'], 'name': entry['name']} for entry in page]
        if data.get('ei_candidates') != roster:
            data['ei_candidates'] = roster
            changed = True
        for index, candidate in enumerate(candidates):
            kind = how.get(index, 'unmatched')
            stats['candidacy:' + kind] += 1
            per_body[body][kind] += 1
            if args.report:
                rows.append({
                    'body': body,
                    'date': os.path.basename(os.path.dirname(path)),
                    'file': os.path.basename(path),
                    'name': candidate.get('name') or '',
                    'how': kind,
                    'ei_candidate_id': assignments.get(index, ''),
                    'source_url': url,
                })
            if index in assignments and candidate.get('ei_candidate_id') != assignments[index]:
                candidate['ei_candidate_id'] = assignments[index]
                changed = True

        if changed and not args.dry_run:
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write('\n')
            stats['files:written'] += 1

        if fetched % 100 == 0:
            print(f'  {fetched:>5} pages  '
                  f'{stats["candidacy:name"]:>6} by name  '
                  f'{stats["candidacy:positional"]:>5} positional  '
                  f'{stats["candidacy:unmatched"]:>5} unmatched', flush=True)

    if args.report and rows:
        os.makedirs(os.path.dirname(REPORT), exist_ok=True)
        with open(REPORT, 'w', encoding='utf-8', newline='') as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    total = sum(stats['candidacy:' + k] for k in ('name', 'compatible-name', 'positional', 'unmatched'))
    print(f'\npages: {stats["fetched"]:,} fetched, {stats["cached"]:,} from cache, '
          f'{stats["page:failed"]:,} failed, {stats["page:no-candidate-links"]:,} without links')
    print(f'files written: {stats["files:written"]:,}')
    print(f'candidacies: {total:,} seen')
    for kind in ('name', 'compatible-name', 'positional', 'unmatched'):
        count = stats['candidacy:' + kind]
        share = (100.0 * count / total) if total else 0.0
        print(f'  {kind:11} {count:>7,}  {share:5.1f}%')
    print('\nby body:')
    for body in sorted(per_body):
        counter = per_body[body]
        print(f'  {body:26} name {counter["name"]:>6,}  positional {counter["positional"]:>5,}  '
              f'unmatched {counter["unmatched"]:>5,}')
    if args.report and rows:
        print(f'\nwrote {REPORT}')


if __name__ == '__main__':
    main()
