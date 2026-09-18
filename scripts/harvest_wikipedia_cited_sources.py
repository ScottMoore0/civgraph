#!/usr/bin/env python3
"""Extract every source cited in harvested Wikipedia election articles, and fetch them.

The aim is to cite the sources Wikipedia relies on -- council result sheets, government
publications, ARK, EONI, newspapers -- rather than Wikipedia itself. This finds them and
records whether each can actually be reached and what it contains.

PHASE 1, extract (always runs). For each article listed in the given harvest indexes
(.cache/wikipedia/categories/_index*.json), every citation:
  * <ref>...</ref> bodies, with named references reused by <ref name=x/> resolved to the
    one definition, so a source cited twenty times is one source with twenty uses;
  * citation templates (cite web / news / book / journal / report / ISB ...), recording url,
    archive-url, title, publisher / website / work, date and access-date;
  * bare [http://...] links inside references, including ones beside a template;
  * outside references: citation templates (e.g. a "Sources" list of books) and plain links,
    notably "External links", where many council election articles give the council's own
    results page and cite nothing inline;
  * the context of each use: the article, the nearest section heading, whether it sits inside
    an election results box -- the citation for one specific contest -- and its basis
    (inline-citation, inline-link, inline-text, section-citation, external-link, body-link).
Writes .cache/wikipedia-sources/citations.jsonl (one row per use) and urls.json (one row per
unique URL, with every article and contest that cites it).

PHASE 2, fetch (--fetch). For each unique URL: the original first; if that fails, the
archived copy the citation itself gives (archive-url), since many council and department
pages have moved. Polite: identifying User-Agent, robots.txt honoured per host, at least
DELAY seconds between requests to one host, a size cap per response, no retries past a
block or paywall. Records status, final URL, content type, size and SHA-256 in fetch.jsonl,
and keeps the body under .cache/wikipedia-sources/files/. Resumable: a URL already fetched
is skipped.

  python scripts/harvest_wikipedia_cited_sources.py                      # extract only
  python scripts/harvest_wikipedia_cited_sources.py --fetch --workers 8  # extract and fetch
"""
import os, re, sys, json, time, hashlib, argparse, threading, urllib.parse, urllib.request, urllib.error, urllib.robotparser
from concurrent.futures import ThreadPoolExecutor, as_completed

CATEGORY_DIR = os.path.join('.cache', 'wikipedia', 'categories')
OUT = os.path.join('.cache', 'wikipedia-sources')
FILES = os.path.join(OUT, 'files')
USER_AGENT = 'civgraph.net source verification (https://civgraph.net; citations of Wikipedia election articles)'
DELAY = 1.0
ARCHIVE_DELAY = 2.5
MAX_BYTES = 40 * 1024 * 1024
TIMEOUT = 45

CITE_TEMPLATE = re.compile(r'\{\{\s*(cite[ _][a-z ]+|citation|webarchive|Cite ISB|harvnb|sfn|london gazette|cite hansard)\s*\|', re.I)


def balanced_templates(text, start_regex):
    for m in re.finditer(start_regex, text):
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith('{{', i):
                depth += 1; i += 2; continue
            if text.startswith('}}', i):
                depth -= 1; i += 2
                if depth == 0:
                    yield m, text[m.start() + 2:i - 2]
                    break
                continue
            i += 1


def split_params(inner):
    parts, cur, depth_t, depth_l, i = [], [], 0, 0, 0
    while i < len(inner):
        two = inner[i:i + 2]
        if two == '{{': depth_t += 1; cur.append(two); i += 2; continue
        if two == '}}': depth_t -= 1; cur.append(two); i += 2; continue
        if two == '[[': depth_l += 1; cur.append(two); i += 2; continue
        if two == ']]': depth_l -= 1; cur.append(two); i += 2; continue
        if inner[i] == '|' and depth_t == 0 and depth_l == 0:
            parts.append(''.join(cur)); cur = []
        else:
            cur.append(inner[i])
        i += 1
    parts.append(''.join(cur))
    params = {}
    for p in parts[1:]:
        if '=' in p:
            k, v = p.split('=', 1)
            params[k.strip().lower()] = v.strip()
    return parts[0].strip(), params


def clean(value):
    value = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', value or '')
    value = re.sub(r"'{2,}", '', value)
    value = re.sub(r'<[^>]+>', '', value)
    return re.sub(r'\s+', ' ', value).strip()


def citations_in(body):
    """Citation records from one <ref> body (or one citation template found outside refs)."""
    records, spans = [], []
    for m, inner in balanced_templates(body, CITE_TEMPLATE):
        spans.append((m.start(), m.start() + len(inner) + 4))
        name, params = split_params(inner)
        rec = {
            'template': name.lower(),
            'url': params.get('url') or params.get('chapter-url') or params.get('chapterurl') or '',
            'archiveUrl': params.get('archive-url') or params.get('archiveurl') or '',
            'title': clean(params.get('title', '')),
            'publisher': clean(params.get('publisher') or params.get('website') or params.get('work') or params.get('newspaper') or ''),
            'date': params.get('date', ''),
            'accessDate': params.get('access-date') or params.get('accessdate') or '',
            'page': params.get('page') or params.get('pages') or params.get('p') or '',
        }
        if name.lower() == 'cite isb':
            rec['statute'] = {k: params.get(k, '') for k in ('type', 'year', 'number', 'act', 'title')}
        records.append(rec)
    # Plain links, including ones beside a template in the same ref ("see also [http://... results]").
    template_urls = {u for r in records for u in (r['url'], r['archiveUrl']) if u}
    for m in re.finditer(r'\[(https?://[^\s\]<>"]+)(?:\s+([^\]\n]*))?\]|(?<![\[=/"\w])(https?://[^\s\]|<>"}{]+)', body):
        if any(s <= m.start() < e for s, e in spans):
            continue
        url = (m.group(1) or m.group(3)).rstrip('.,;)')
        if url in template_urls:
            continue
        records.append({'template': 'bare-link', 'url': url, 'archiveUrl': '', 'title': clean(m.group(2) or ''), 'publisher': '', 'date': '', 'accessDate': '', 'page': ''})
    if not records and clean(body):
        records.append({'template': 'text', 'url': '', 'archiveUrl': '', 'title': clean(body)[:200], 'publisher': '', 'date': '', 'accessDate': '', 'page': ''})
    return records


def extract(index_names):
    uses, urls = [], {}
    articles = 0
    for index_name in index_names:
        path = os.path.join(CATEGORY_DIR, index_name)
        if not os.path.exists(path):
            print('  (missing index %s)' % index_name)
            continue
        index = json.load(open(path, encoding='utf-8'))
        for page in index['pages']:
            if not page.get('file') or not os.path.exists(page['file']):
                continue
            rec = json.load(open(page['file'], encoding='utf-8'))
            text = rec['wikitext']
            articles += 1
            named = {}
            for m in re.finditer(r'<ref\s+name\s*=\s*"?([^">/]+?)"?\s*>(.*?)</ref>', text, re.S | re.I):
                named[m.group(1).strip()] = m.group(2)
            box_spans = [(m.start(), m.end()) for m in re.finditer(r'\{\{\s*STV Election box begin\d?\s*\|.*?\n\s*\}\}', text, re.S | re.I)]
            box_spans += [(m.start(), m.end()) for m in re.finditer(r'\{\{\s*Election box begin[^|]*\|.*?\}\}', text, re.S | re.I)]
            headings = [(m.start(), clean(m.group(1))) for m in re.finditer(r'^==+\s*([^=\n]+?)\s*==+\s*$', text, re.M)]

            def context(pos):
                heading = next((h for p, h in reversed(headings) if p < pos), '')
                span = next(((s, e) for s, e in box_spans if s <= pos <= e), None)
                box_title = ''
                if span:
                    t = re.search(r'\|\s*title\s*=\s*(.*)', text[span[0]:span[1]])
                    box_title = clean(re.sub(r'<ref.*', '', t.group(1))) if t else ''
                return heading, bool(span), box_title

            def record(cite, pos, basis):
                heading, in_box, box_title = context(pos)
                uses.append(dict(cite, basis=basis, article=rec['title'], articleUrl=rec['url'], revid=rec['revid'], heading=heading,
                                 resultsBox=in_box, contest=box_title, index=index_name))
                if cite['url'] or cite['archiveUrl']:
                    key = cite['url'] or cite['archiveUrl']
                    entry = urls.setdefault(key, {'url': cite['url'], 'archiveUrls': [], 'titles': set(), 'publishers': set(),
                                                  'templates': set(), 'articles': set(), 'contests': set(), 'uses': 0})
                    entry['uses'] += 1
                    if cite['archiveUrl'] and cite['archiveUrl'] not in entry['archiveUrls']:
                        entry['archiveUrls'].append(cite['archiveUrl'])
                    for field, value in (('titles', cite['title']), ('publishers', cite['publisher']), ('templates', cite['template']), ('articles', rec['title'])):
                        if value:
                            entry[field].add(value)
                    if in_box and box_title:
                        entry['contests'].add('%s | %s' % (rec['title'], box_title))

            ref_pattern = re.compile(r'<ref(\s+[^>]*?)?(/>|>(.*?)</ref>)', re.S | re.I)
            for m in ref_pattern.finditer(text):
                attrs, body = m.group(1) or '', m.group(3)
                if body is None:
                    name = re.search(r'name\s*=\s*"?([^">/]+?)"?\s*(?:/|$)', attrs)
                    body = named.get(name.group(1).strip()) if name else None
                    if body is None:
                        continue
                for cite in citations_in(body):
                    basis = {'bare-link': 'inline-link', 'text': 'inline-text'}.get(cite['template'], 'inline-citation')
                    record(cite, m.start(), basis)

            # Outside <ref> tags: citation templates in "Sources" / "Bibliography" lists, and plain
            # links -- above all "External links", where many council election articles give the
            # council's own results page and cite nothing inline. Refs and comments are blanked to
            # the same length first, so positions (and so headings and boxes) still line up.
            blank = ref_pattern.sub(lambda m: ' ' * len(m.group(0)), text)
            blank = re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), blank, flags=re.S)
            template_spans = []
            for m, inner in balanced_templates(blank, CITE_TEMPLATE):
                template_spans.append((m.start(), m.start() + len(inner) + 4))
                for cite in citations_in('{{' + inner + '}}'):
                    if cite['template'] != 'text':
                        record(cite, m.start(), 'section-citation')
            for m in re.finditer(r'\[(https?://[^\s\]<>"]+)(?:\s+([^\]\n]*))?\]|(?<![\[=/"\w])(https?://[^\s\]|<>"}{]+)', blank):
                if any(s <= m.start() < e for s, e in template_spans):
                    continue
                url = (m.group(1) or m.group(3)).rstrip('.,;)')
                if re.search(r'wikipedia\.org|wikimedia\.org|wikidata\.org', url):
                    continue
                heading = context(m.start())[0]
                basis = 'external-link' if re.search(r'external link|source|further reading|bibliograph|reference|note|citation', heading, re.I) else 'body-link'
                record({'template': 'bare-link', 'url': url, 'archiveUrl': '', 'title': clean(m.group(2) or ''), 'publisher': '',
                        'date': '', 'accessDate': '', 'page': ''}, m.start(), basis)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'citations.jsonl'), 'w', encoding='utf-8') as fh:
        for u in uses:
            fh.write(json.dumps(u, ensure_ascii=False) + '\n')
    serial = []
    for key, e in urls.items():
        serial.append(dict(e, key=key, titles=sorted(e['titles']), publishers=sorted(e['publishers']), templates=sorted(e['templates']),
                           articles=sorted(e['articles']), contests=sorted(e['contests'])))
    json.dump(serial, open(os.path.join(OUT, 'urls.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return articles, uses, serial


class HostGate:
    def __init__(self):
        self.lock = threading.Lock()
        self.locks, self.last, self.robots = {}, {}, {}

    def host_lock(self, host):
        with self.lock:
            return self.locks.setdefault(host, threading.Lock())

    def allowed(self, url):
        parts = urllib.parse.urlsplit(url)
        base = '%s://%s' % (parts.scheme, parts.netloc)
        with self.lock:
            rp = self.robots.get(base)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                req = urllib.request.Request(base + '/robots.txt', headers={'User-Agent': USER_AGENT})
                with urllib.request.urlopen(req, timeout=20) as r:
                    rp.parse(r.read().decode('utf-8', 'replace').splitlines())
            except Exception:
                rp.parse([])  # unreachable or absent robots.txt: no restriction stated
            with self.lock:
                self.robots[base] = rp
        return rp.can_fetch(USER_AGENT, url)

    def wait(self, host):
        delay = ARCHIVE_DELAY if 'archive.org' in host else DELAY
        gap = time.time() - self.last.get(host, 0)
        if gap < delay:
            time.sleep(delay - gap)
        self.last[host] = time.time()


def fetch_one(url, gate):
    host = urllib.parse.urlsplit(url).netloc.lower()
    if not url.startswith(('http://', 'https://')):
        return {'url': url, 'outcome': 'not-http'}
    try:
        if not gate.allowed(url):
            return {'url': url, 'outcome': 'robots-disallowed'}
    except Exception as error:
        return {'url': url, 'outcome': 'robots-error', 'error': str(error)[:200]}
    with gate.host_lock(host):
        gate.wait(host)
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': '*/*'})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body = r.read(MAX_BYTES + 1)
                truncated = len(body) > MAX_BYTES
                body = body[:MAX_BYTES]
                ctype = r.headers.get('Content-Type', '')
                digest = hashlib.sha256(body).hexdigest()
                ext = '.pdf' if 'pdf' in ctype or body[:4] == b'%PDF' else ('.html' if 'html' in ctype else '.bin')
                name = hashlib.sha1(url.encode('utf-8')).hexdigest() + ext
                with open(os.path.join(FILES, name), 'wb') as fh:
                    fh.write(body)
                return {'url': url, 'outcome': 'ok', 'status': r.status, 'finalUrl': r.geturl(), 'contentType': ctype,
                        'bytes': len(body), 'truncated': truncated, 'sha256': digest, 'file': os.path.join(FILES, name).replace(os.sep, '/')}
        except urllib.error.HTTPError as error:
            return {'url': url, 'outcome': 'http-error', 'status': error.code}
        except Exception as error:
            return {'url': url, 'outcome': 'network-error', 'error': str(error)[:200]}


def fetch_all(serial, workers):
    os.makedirs(FILES, exist_ok=True)
    log_path = os.path.join(OUT, 'fetch.jsonl')
    done = {}
    if os.path.exists(log_path):
        for line in open(log_path, encoding='utf-8'):
            try:
                row = json.loads(line)
                done[row['key']] = row
            except ValueError:
                pass
    todo = [e for e in serial if e['key'] not in done]
    print('fetch: %d unique sources, %d already done, %d to fetch' % (len(serial), len(done), len(todo)), flush=True)
    gate = HostGate()
    lock = threading.Lock()
    counts = {'ok': 0, 'archive-ok': 0, 'failed': 0}

    def work(entry):
        attempts = []
        if entry['url']:
            first = fetch_one(entry['url'], gate)
            attempts.append(first)
            if first['outcome'] == 'ok':
                return {'key': entry['key'], 'source': 'original', **first, 'attempts': attempts}
        for archive in entry['archiveUrls'][:1]:
            second = fetch_one(archive, gate)
            attempts.append(second)
            if second['outcome'] == 'ok':
                return {'key': entry['key'], 'source': 'archive', **second, 'attempts': attempts}
        return {'key': entry['key'], 'source': None, 'outcome': 'failed', 'attempts': attempts}

    with open(log_path, 'a', encoding='utf-8') as log, ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, e) for e in todo]
        for n, future in enumerate(as_completed(futures), 1):
            row = future.result()
            with lock:
                log.write(json.dumps(row, ensure_ascii=False) + '\n'); log.flush()
                counts['ok' if row['source'] == 'original' else 'archive-ok' if row['source'] == 'archive' else 'failed'] += 1
                if n % 100 == 0 or n == len(todo):
                    print('  fetched %d/%d | original ok %d | archive ok %d | failed %d' % (n, len(todo), counts['ok'], counts['archive-ok'], counts['failed']), flush=True)
    return counts


# ---------------------------------------------------------------- archive retry
#
# A fetch can "succeed" with HTTP 200 and still not be the cited document: every EONI
# results file cited in these articles now returns EONI's "Page not found" page with a 200,
# and others are bot challenges, empty bodies or one landing page served for many URLs.
# Those rows never tried the Wayback Machine, because the fallback only runs on an error.
# The list of such rows is written by the analysis (soft-failures.json); this retries each
# one against the Wayback Machine, slowly, and appends a recovered copy to fetch.jsonl (the
# last row for a key wins everywhere it is read).

SOFT_FAIL_PAGE = re.compile(r'page not found|404 not found|error 404|client challenge|enable javascript|just a moment|'
                            r'access denied|attention required|are you a robot|captcha|online casino', re.I)
RETRY_DELAY = 6.0
MAX_CONSECUTIVE_429 = 8


def _parse_date(value):
    import datetime
    value = re.sub(r'\s+', ' ', (value or '').strip())
    for fmt in ('%d %B %Y', '%Y-%m-%d', '%B %d, %Y', '%d %b %Y', '%b %d, %Y', '%B %Y', '%Y'):
        try:
            return datetime.datetime.strptime(value, fmt)
        except ValueError:
            pass
    m = re.search(r'\b(19[89]\d|20[0-4]\d)\b', value)
    return datetime.datetime(int(m.group(1)), 7, 1) if m else None


def _snapshot_plan(key, uses_for_key, wide=False):
    """(original URL, Wayback timestamps to try). The editor's access date first, because the
    page said what the article cites then; then three years earlier, for pages that had
    already been replaced by the time a later editor checked them.

    wide=True is the second pass for pages whose first two snapshots were also bad: a year
    after, a year before, six years before, and a fixed mid-2010s capture."""
    m = re.match(r'https?://web\.archive\.org/web/(\d{4,14})[a-z_]*/(https?://.+)', key)
    if m:
        original, year, md = m.group(2), int(m.group(1)[:4]), (m.group(1)[4:8] or '0701')
    else:
        dates = [d for u in uses_for_key for d in (_parse_date(u.get('accessDate')), _parse_date(u.get('date'))) if d]
        when = min(dates) if dates else None
        original = key
        year, md = (when.year, when.strftime('%m%d')) if when else (2016, '0701')
    if m:
        first = ['%d%s' % (year - 1, md), '%d%s' % (year - 3, md)]
    elif dates_known(uses_for_key):
        first = ['%d%s' % (year, md), '%d%s' % (year - 3, md)]
    else:
        first = ['2016', '2012']
    if not wide:
        return original, first
    extra = ['%d%s' % (year + 1, md), '%d%s' % (year - 1, md), '%d0101' % (year - 6), '20150701']
    return original, [s for s in dict.fromkeys(extra) if s not in first]


def dates_known(uses_for_key):
    return any(_parse_date(u.get('accessDate')) or _parse_date(u.get('date')) for u in uses_for_key)


def _looks_soft_failed(result, bad_sha):
    import html as html_module
    if result.get('sha256') == bad_sha or (result.get('bytes') or 0) < 500:
        return True
    if result['file'].endswith('.pdf'):
        return False
    head = open(result['file'], 'rb').read(200_000).decode('utf-8', 'replace')
    head = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', head, flags=re.S | re.I)
    head = re.sub(r'\s+', ' ', html_module.unescape(re.sub(r'<[^>]+>', ' ', head)))[:1500]
    return bool(SOFT_FAIL_PAGE.search(head))


def archive_retry(soft_path, log_name='archive-retry.jsonl', wide=False):
    """Also used for hard failures (errors whose citation gave no archive link). Those lists
    leave out robots.txt exclusions and 401/402/403/451: an archived copy of a page the
    publisher blocks or paywalls would get round the block."""
    import collections
    global ARCHIVE_DELAY
    ARCHIVE_DELAY = RETRY_DELAY
    soft = json.load(open(soft_path, encoding='utf-8'))
    uses = collections.defaultdict(list)
    for line in open(os.path.join(OUT, 'citations.jsonl'), encoding='utf-8'):
        u = json.loads(line)
        if u['url'] or u['archiveUrl']:
            uses[u['url'] or u['archiveUrl']].append(u)
    rows = {}
    for line in open(os.path.join(OUT, 'fetch.jsonl'), encoding='utf-8'):
        try:
            row = json.loads(line)
            rows[row['key']] = row
        except ValueError:
            pass
    log_path = os.path.join(OUT, log_name)
    done = set()
    if os.path.exists(log_path):
        for line in open(log_path, encoding='utf-8'):
            try:
                done.add(json.loads(line)['key'])
            except ValueError:
                pass
    todo = [s for s in soft if s['key'] not in done]
    print('archive retry: %d soft failures, %d already retried, %d to go' % (len(soft), len(done), len(todo)), flush=True)
    gate = HostGate()
    recovered_count = consecutive_429 = 0
    with open(log_path, 'a', encoding='utf-8') as log, open(os.path.join(OUT, 'fetch.jsonl'), 'a', encoding='utf-8') as fetch_log:
        for n, item in enumerate(todo, 1):
            original, stamps = _snapshot_plan(item['key'], uses.get(item['key'], []), wide=wide)
            attempts, recovered = [], None
            for stamp in stamps:
                url = 'https://web.archive.org/web/%sid_/%s' % (stamp, original)
                backoff = 60
                while True:
                    result = fetch_one(url, gate)
                    if result.get('status') != 429:
                        consecutive_429 = 0
                        break
                    consecutive_429 += 1
                    if consecutive_429 > MAX_CONSECUTIVE_429:
                        print('archive retry: stopping, the Wayback Machine kept answering 429; rerun to resume', flush=True)
                        return {'retried': n - 1, 'recovered': recovered_count, 'stoppedEarly': True}
                    print('  429, waiting %ds' % backoff, flush=True)
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 900)
                attempts.append(result)
                if result['outcome'] == 'ok' and not _looks_soft_failed(result, item.get('sha')):
                    recovered = result
                    break
            log.write(json.dumps({'key': item['key'], 'previous': item['status'], 'recovered': bool(recovered), 'attempts': attempts}, ensure_ascii=False) + '\n')
            log.flush()
            if recovered:
                recovered_count += 1
                prior = (rows.get(item['key']) or {}).get('attempts') or []
                fetch_log.write(json.dumps({'key': item['key'], 'source': 'archive', **recovered, 'attempts': prior + attempts,
                                            'retry': 'wayback-after-soft-failure'}, ensure_ascii=False) + '\n')
                fetch_log.flush()
            if n % 25 == 0 or n == len(todo):
                print('  retried %d/%d | recovered %d' % (n, len(todo), recovered_count), flush=True)
    return {'retried': len(todo), 'recovered': recovered_count, 'stoppedEarly': False}


# --------------------------------------------------------------- archive.today
#
# The Wayback Machine had no usable copy of some dead pages (mostly council "results" pages
# from 1999-2009). archive.today holds others. Its robots.txt allows /timemap/ and snapshot
# pages. One request at a time, ARCHIVE_TODAY_DELAY apart; a 429 backs off, and a challenge
# page (CAPTCHA, "unusual traffic") stops the run rather than being worked around.

ARCHIVE_TODAY = 'https://archive.ph'
ARCHIVE_TODAY_DELAY = 10.0
CHALLENGE_PAGE = re.compile(r'captcha|cf-chl|challenge-platform|security check|unusual traffic|are you a robot', re.I)


def _mementos(timemap_text):
    import datetime
    out = []
    for m in re.finditer(r'<(https?://[^>]+)>;\s*rel="[^"]*memento[^"]*";\s*datetime="([^"]+)"', timemap_text):
        try:
            out.append((datetime.datetime.strptime(m.group(2), '%a, %d %b %Y %H:%M:%S GMT'), m.group(1)))
        except ValueError:
            pass
    return out


def archive_today(dead_path):
    rows = {}
    for line in open(os.path.join(OUT, 'fetch.jsonl'), encoding='utf-8'):
        try:
            row = json.loads(line)
            rows[row['key']] = row
        except ValueError:
            pass
    items = json.load(open(dead_path, encoding='utf-8'))
    log_path = os.path.join(OUT, 'archive-today.jsonl')
    done = set()
    if os.path.exists(log_path):
        done = {json.loads(l)['key'] for l in open(log_path, encoding='utf-8') if l.strip()}
    todo = [i for i in items if i['key'] not in done]
    print('archive.today: %d dead links, %d done, %d to go' % (len(items), len(done), len(todo)), flush=True)
    gate = HostGate()
    recovered = backoffs = 0

    def polite_get(url):
        nonlocal backoffs
        wait = 120
        while True:
            time.sleep(ARCHIVE_TODAY_DELAY)
            result = fetch_one(url, gate)
            if result.get('status') == 429:
                backoffs += 1
                if backoffs > 3:
                    return result, 'rate-limited'
                print('  429 from archive.today, waiting %ds' % wait, flush=True)
                time.sleep(wait)
                wait *= 2
                continue
            if result['outcome'] == 'ok' and not result['file'].endswith('.pdf'):
                head = open(result['file'], 'rb').read(50_000).decode('utf-8', 'replace')
                if CHALLENGE_PAGE.search(head) and len(head) < 20_000:
                    return result, 'challenge'
            return result, None

    with open(log_path, 'a', encoding='utf-8') as log, open(os.path.join(OUT, 'fetch.jsonl'), 'a', encoding='utf-8') as fetch_log:
        for n, item in enumerate(todo, 1):
            url = item['url']
            variants = [url]
            parts = urllib.parse.urlsplit(url)
            toggled = parts.netloc[4:] if parts.netloc.startswith('www.') else 'www.' + parts.netloc
            variants.append(urllib.parse.urlunsplit((parts.scheme, toggled, parts.path, parts.query, '')))
            attempts, chosen = [], None
            access = [d for d in (_parse_date(a) for a in item.get('accessDates') or []) if d]
            for variant in variants:
                timemap, stop = polite_get('%s/timemap/%s' % (ARCHIVE_TODAY, variant))
                attempts.append({k: timemap.get(k) for k in ('url', 'outcome', 'status')})
                if stop:
                    print('archive.today: stopping (%s); rerun later to resume' % stop, flush=True)
                    return {'tried': n - 1, 'recovered': recovered, 'stoppedEarly': stop}
                if timemap['outcome'] != 'ok':
                    continue
                mementos = _mementos(open(timemap['file'], encoding='utf-8', errors='replace').read())
                if not mementos:
                    continue
                target = min(access) if access else None
                mementos.sort(key=lambda m: abs((m[0] - target).days) if target else m[0].timestamp())
                for when, memento in mementos[:2]:
                    page, stop = polite_get(memento)
                    attempts.append({k: page.get(k) for k in ('url', 'outcome', 'status')})
                    if stop:
                        print('archive.today: stopping (%s); rerun later to resume' % stop, flush=True)
                        return {'tried': n - 1, 'recovered': recovered, 'stoppedEarly': stop}
                    if page['outcome'] == 'ok' and not _looks_soft_failed(page, None):
                        chosen = dict(page, memento=memento, mementoDate=when.strftime('%Y-%m-%d'))
                        break
                if chosen:
                    break
            log.write(json.dumps({'key': item['key'], 'recovered': bool(chosen), 'attempts': attempts}, ensure_ascii=False) + '\n')
            log.flush()
            if chosen:
                recovered += 1
                prior = (rows.get(item['key']) or {}).get('attempts') or []
                fetch_log.write(json.dumps({'key': item['key'], 'source': 'archive', **chosen, 'attempts': prior + attempts,
                                            'retry': 'archive-today'}, ensure_ascii=False) + '\n')
                fetch_log.flush()
            if n % 10 == 0 or n == len(todo):
                print('  tried %d/%d | recovered %d' % (n, len(todo), recovered), flush=True)
    return {'tried': len(todo), 'recovered': recovered, 'stoppedEarly': False}


# -------------------------------------------------------- follow index pages
#
# Many cited pages are indexes: EONI's results pages list one result sheet per district
# electoral area, and a council's results page links a document per local electoral area.
# The page itself names no candidates, so it cannot verify anything; the linked sheet can.
# For each such page, follow the links whose text or address names an area of a contest that
# cites the page (plus every document on a small page), fetch them -- through the same Wayback
# snapshot when the page was an archived copy -- and record which page each came from.

DOC_LINK = re.compile(r'\.(pdf|xlsx?|csv|docx?)(\?|$)|/getmedia/|/files/', re.I)
AREA_STOPWORDS = {'the', 'of', 'and', 'area', 'no', 'ward', 'wards', 'lea', 'dea', 'electoral', 'local', 'district', 'county', 'council',
                  'city', 'borough', 'seats', 'seat', 'pdf', 'xls', 'xlsx', 'doc', 'htm', 'html', 'aspx', 'php'}
MAX_LINKS_PER_INDEX = 60


def _area_tokens(text):
    import unicodedata
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(c for c in text if not unicodedata.combining(c)).lower()
    return {t for t in re.split(r'[^a-z0-9]+', text) if t and t not in AREA_STOPWORDS}


def follow_index(list_path, workers=6):
    import html as html_module
    rows = {}
    for line in open(os.path.join(OUT, 'fetch.jsonl'), encoding='utf-8'):
        try:
            row = json.loads(line)
            rows[row['key']] = row
        except ValueError:
            pass
    items = json.load(open(list_path, encoding='utf-8'))
    log_path = os.path.join(OUT, 'linked-docs.jsonl')
    done = set()
    if os.path.exists(log_path):
        for line in open(log_path, encoding='utf-8'):
            if line.strip():
                r = json.loads(line)
                if r.get('source'):  # failures are retried on the next run
                    done.add((r['parent'], r['key']))
    tasks, pages_with_links = [], 0
    for item in items:
        row = rows.get(item['key']) or {}
        path = row.get('file') or ''
        if not row.get('source') or not path.endswith('.html') or not os.path.exists(path):
            continue
        raw = open(path, encoding='utf-8', errors='replace').read()
        final = row.get('finalUrl') or row.get('url') or item['key']
        m = re.match(r'https?://web\.archive\.org/web/(\d{8,14})[a-z_]*/(https?://.+)', final)
        stamp, base = (m.group(1), m.group(2)) if m else (None, final)
        areas = [a for a in (_area_tokens(x) for x in item['areas']) if a]
        base_host = urllib.parse.urlsplit(base).netloc.lower().replace('www.', '')
        picked, all_docs, seen = [], [], set()
        for href, text in re.findall(r'<a\b[^>]*?href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>', raw, re.S | re.I):
            href = html_module.unescape(href.strip())
            wm = re.match(r'(?:https?://web\.archive\.org)?/web/\d+[a-z_]*/(https?://.+)', href)
            url = wm.group(1) if wm else urllib.parse.urljoin(base, href)
            if not url.startswith('http') or url in seen or url.rstrip('/') == base.rstrip('/'):
                continue
            seen.add(url)
            label = clean(re.sub(r'<[^>]+>', ' ', text))
            path_words = urllib.parse.unquote(urllib.parse.urlsplit(url).path).replace('-', ' ').replace('_', ' ')
            tokens = _area_tokens('%s %s' % (label, path_words))
            is_doc = bool(DOC_LINK.search(url))
            same_site = urllib.parse.urlsplit(url).netloc.lower().replace('www.', '') == base_host
            if is_doc and same_site:
                all_docs.append((url, label))
            if (is_doc or same_site) and any(a <= tokens for a in areas):
                picked.append((url, label, 'names a citing contest\'s area'))
        if not picked and 0 < len(all_docs) <= 25:
            picked = [(u, l, 'every document on a small index page') for u, l in all_docs]
        if picked:
            pages_with_links += 1
        for url, label, why in picked[:MAX_LINKS_PER_INDEX]:
            if (item['key'], url) not in done:
                tasks.append((item, url, label, why, stamp))
    print('follow index: %d cited pages, %d with matching links, %d documents to fetch' % (len(items), pages_with_links, len(tasks)), flush=True)
    gate = HostGate()
    lock = threading.Lock()
    counts = {'ok': 0, 'failed': 0}

    def fetch_patiently(url):
        # The Wayback Machine drops connections under sustained load; a pause and a retry
        # recovers them (every one of 38 network errors in a trial run succeeded on retry).
        result = fetch_one(url, gate)
        for pause in (20, 60):
            if result['outcome'] != 'network-error':
                break
            time.sleep(pause)
            result = fetch_one(url, gate)
        return result

    def work(task):
        item, url, label, why, stamp = task
        attempts = []
        if stamp:
            result = fetch_patiently('https://web.archive.org/web/%sid_/%s' % (stamp, url))
            attempts.append(result)
            source = 'archive'
        else:
            result = fetch_patiently(url)
            attempts.append(result)
            source = 'original'
            if result['outcome'] != 'ok' and result.get('status') not in (401, 402, 403, 451) and result['outcome'] != 'robots-disallowed':
                original, stamps = _snapshot_plan(url, [{'accessDate': item.get('accessDate')}])
                result = fetch_patiently('https://web.archive.org/web/%sid_/%s' % (stamps[0], original))
                attempts.append(result)
                source = 'archive'
        ok = result['outcome'] == 'ok' and not _looks_soft_failed(result, None)
        return item, url, label, why, (source if ok else None), result, attempts

    with open(log_path, 'a', encoding='utf-8') as log, open(os.path.join(OUT, 'fetch.jsonl'), 'a', encoding='utf-8') as fetch_log, \
            ThreadPoolExecutor(max_workers=workers) as pool:
        for n, future in enumerate(as_completed([pool.submit(work, t) for t in tasks]), 1):
            item, url, label, why, source, result, attempts = future.result()
            with lock:
                log.write(json.dumps({'parent': item['key'], 'key': url, 'label': label, 'why': why, 'source': source,
                                      'outcome': result['outcome'], 'status': result.get('status')}, ensure_ascii=False) + '\n')
                log.flush()
                if source:
                    counts['ok'] += 1
                    fetch_log.write(json.dumps({'key': url, 'source': source, **result, 'attempts': attempts, 'linkedFrom': item['key']},
                                               ensure_ascii=False) + '\n')
                    fetch_log.flush()
                else:
                    counts['failed'] += 1
                if n % 100 == 0 or n == len(tasks):
                    print('  documents %d/%d | ok %d | failed %d' % (n, len(tasks), counts['ok'], counts['failed']), flush=True)
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--index', action='append', help='harvest index names (default: every _index*.json)')
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--archive-retry', metavar='SOFT_FAILURES_JSON',
                    help='retry the listed failures against the Wayback Machine, one at a time')
    ap.add_argument('--retry-log', default='archive-retry.jsonl', help='progress log name under .cache/wikipedia-sources')
    ap.add_argument('--wide', action='store_true', help='second pass: try snapshots further from the access date')
    ap.add_argument('--archive-today', metavar='DEAD_LINKS_JSON', help='look the listed dead links up on archive.today, one at a time')
    ap.add_argument('--follow-index', metavar='INDEX_PAGES_JSON', help='fetch the per-area documents that the listed index pages link to')
    args = ap.parse_args()
    if args.archive_retry:
        print(archive_retry(args.archive_retry, args.retry_log, args.wide))
        return
    if args.archive_today:
        print(archive_today(args.archive_today))
        return
    if args.follow_index:
        print(follow_index(args.follow_index, args.workers))
        return
    indexes = args.index or sorted(n for n in os.listdir(CATEGORY_DIR) if n.startswith('_index') and n.endswith('.json'))
    articles, uses, serial = extract(indexes)
    by_template = {}
    for u in uses:
        by_template[u['template']] = by_template.get(u['template'], 0) + 1
    domains = {}
    for e in serial:
        host = urllib.parse.urlsplit(e['url'] or e['archiveUrls'][0]).netloc.lower().replace('www.', '')
        domains[host] = domains.get(host, 0) + 1
    print('indexes: %s' % indexes)
    print('articles: %d | citation uses: %d | uses inside results boxes: %d | unique URLs: %d' % (articles, len(uses), sum(1 for u in uses if u['resultsBox']), len(serial)))
    print('uses by template: %s' % sorted(by_template.items(), key=lambda kv: -kv[1])[:12])
    print('unique URLs by domain (top 25): %s' % sorted(domains.items(), key=lambda kv: -kv[1])[:25])
    print('uses with no URL (books, print, statute): %d' % sum(1 for u in uses if not u['url'] and not u['archiveUrl']))
    if args.fetch:
        print(fetch_all(serial, args.workers))


if __name__ == '__main__':
    main()
