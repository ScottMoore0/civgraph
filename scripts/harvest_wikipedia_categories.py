#!/usr/bin/env python3
"""Harvest every page under a set of Wikipedia categories, following all subcategories.

Built to test whether Wikipedia can source the Republic of Ireland's European Parliament,
presidential and local election data, which currently comes from ElectionsIreland alone.

  1. Walks each root category through the MediaWiki API (list=categorymembers, with
     continuation), following every subcategory exactly once, so a category loop cannot
     recurse and a page reached by two paths is fetched once.
  2. Fetches the current wikitext of every member page in batches of 50, recording its
     revision id and timestamp, so the harvest says exactly which revision it read.
  3. Writes one JSON file per page and an index listing every category, every page, the
     category path that reached it, and basic shape counts (results templates, wikitables,
     count columns) for the feasibility analysis.

Output goes to .cache/wikipedia/categories/ (gitignored): Wikipedia text is CC BY-SA 4.0,
and copying it into the repository is a separate decision from reading it.

Polite by construction: an identifying User-Agent, maxlag=5, a delay between requests, and
retries that honour Retry-After. Resumable: a page already cached at the same revision is
not re-fetched.

  python scripts/harvest_wikipedia_categories.py
  python scripts/harvest_wikipedia_categories.py --category "Category:Presidential_elections_in_Ireland"
"""
import os, re, sys, json, time, argparse, urllib.parse, urllib.request, urllib.error

API = 'https://en.wikipedia.org/w/api.php'
USER_AGENT = 'civgraph.net election source research (https://civgraph.net; harvest_wikipedia_categories.py)'
DELAY_SECONDS = 0.6
OUT = os.path.join('.cache', 'wikipedia', 'categories')
PAGES = os.path.join(OUT, 'pages')

DEFAULT_ROOTS = [
    'Category:European Parliament constituencies in the Republic of Ireland',
    'Category:Presidential elections in Ireland',
    'Category:Council elections in the Republic of Ireland',
]


def api(params, attempt=0):
    params = dict(params, format='json', formatversion='2', maxlag='5')
    url = API + '?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        if attempt < 6 and error.code in (429, 500, 502, 503, 504):
            wait = int(error.headers.get('Retry-After') or 0) or (5 * (attempt + 1))
            time.sleep(wait)
            return api(params, attempt + 1)
        raise
    except urllib.error.URLError:
        if attempt < 6:
            time.sleep(5 * (attempt + 1))
            return api(params, attempt + 1)
        raise
    if data.get('error', {}).get('code') == 'maxlag' and attempt < 6:
        time.sleep(5 * (attempt + 1))
        return api(params, attempt + 1)
    if 'error' in data:
        raise RuntimeError('API error: %s' % data['error'])
    time.sleep(DELAY_SECONDS)
    return data


def category_members(category):
    members, cont = [], {}
    while True:
        data = api(dict({'action': 'query', 'list': 'categorymembers', 'cmtitle': category,
                         'cmlimit': 'max', 'cmprop': 'ids|title|ns|type'}, **cont))
        members.extend(data['query']['categorymembers'])
        if 'continue' not in data:
            return members
        cont = data['continue']


def walk(roots):
    """Breadth-first over categories. Returns (categories, pages) with discovery paths."""
    categories, pages = {}, {}
    queue = [(root, [root]) for root in roots]
    while queue:
        category, path = queue.pop(0)
        if category in categories:
            continue
        members = category_members(category)
        categories[category] = {'path': path, 'members': len(members),
                                'subcategories': [m['title'] for m in members if m['ns'] == 14],
                                'pages': [m['title'] for m in members if m['ns'] != 14]}
        print('  %-90s %4d members' % (category[:90], len(members)), flush=True)
        for m in members:
            if m['ns'] == 14:
                if m['title'] not in categories:
                    queue.append((m['title'], path + [m['title']]))
            else:
                entry = pages.setdefault(m['title'], {'title': m['title'], 'pageid': m.get('pageid'), 'ns': m['ns'], 'paths': []})
                entry['paths'].append(path)
    return categories, pages


def page_file(pageid):
    return os.path.join(PAGES, '%s.json' % pageid)


def shape(text):
    return {
        'bytes': len(text.encode('utf-8')),
        'electionBoxes': len(re.findall(r'\{\{\s*Election box', text, re.I)),
        'wikitables': len(re.findall(r'\{\|[^\n]*wikitable', text)),
        'countColumns': len(re.findall(r'!\s*(?:Count|\d+(?:st|nd|rd|th)\s+count)', text, re.I)),
        'firstPreferenceMentions': len(re.findall(r'first[- ]preference|1st pref', text, re.I)),
        'quotaMentions': len(re.findall(r'\bquota\b', text, re.I)),
        'sectionHeadings': len(re.findall(r'^==+[^=\n]+==+\s*$', text, re.M)),
        'references': len(re.findall(r'<ref[ >]', text)),
        'citesElectionsIreland': len(re.findall(r'electionsireland\.org', text, re.I)),
    }


def fetch_contents(pages):
    titles = [p['title'] for p in pages.values() if p['ns'] == 0]
    fetched = skipped = 0
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        data = api({'action': 'query', 'prop': 'revisions|categories', 'titles': '|'.join(batch),
                    'rvprop': 'ids|timestamp|content', 'rvslots': 'main', 'cllimit': 'max', 'redirects': '1'})
        for page in data['query'].get('pages', []):
            if page.get('missing') or not page.get('revisions'):
                continue
            rev = page['revisions'][0]
            path = page_file(page['pageid'])
            if os.path.exists(path):
                try:
                    if json.load(open(path, encoding='utf-8')).get('revid') == rev['revid']:
                        skipped += 1
                        continue
                except (ValueError, OSError):
                    pass
            text = rev['slots']['main'].get('content', '')
            record = {'title': page['title'], 'pageid': page['pageid'], 'revid': rev['revid'],
                      'timestamp': rev['timestamp'], 'url': 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ', '_')),
                      'categories': [c['title'] for c in page.get('categories', [])],
                      'licence': 'CC BY-SA 4.0 (Wikipedia text); attribution to the article history',
                      'wikitext': text}
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(record, fh, ensure_ascii=False)
            fetched += 1
        print('  content batch %d-%d of %d (fetched %d, unchanged %d)' % (i + 1, i + len(batch), len(titles), fetched, skipped), flush=True)
    return fetched, skipped


def title_from(value):
    """Accept a bare title or a full https://en.wikipedia.org/wiki/... URL."""
    value = value.strip()
    if '/wiki/' in value:
        value = value.split('/wiki/', 1)[1]
    return urllib.parse.unquote(value).replace('_', ' ')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--category', action='append', help='root category, title or URL (repeatable); defaults to the three RoI election categories')
    ap.add_argument('--article', action='append', default=[], help='an individual article, title or URL (repeatable)')
    ap.add_argument('--index-name', default='_index.json', help='index file name, so separate harvests keep separate indexes')
    args = ap.parse_args()
    raw_roots = args.category if args.category is not None else ([] if args.article else DEFAULT_ROOTS)
    roots = [title_from(c) for c in raw_roots]
    roots = [c if c.startswith('Category:') else 'Category:' + c for c in roots]
    os.makedirs(PAGES, exist_ok=True)

    print('Walking categories:')
    categories, pages = walk(roots)
    for article in args.article:
        title = title_from(article)
        pages.setdefault(title, {'title': title, 'pageid': None, 'ns': 0, 'paths': []})['paths'].append(['(requested article)'])
    roots = roots + ['(article) ' + title_from(a) for a in args.article]
    print('categories: %d | pages: %d (articles: %d)' % (len(categories), len(pages), sum(1 for p in pages.values() if p['ns'] == 0)))

    print('Fetching wikitext:')
    fetched, skipped = fetch_contents(pages)

    index_pages = []
    by_title = {}
    for name in os.listdir(PAGES):
        rec = json.load(open(os.path.join(PAGES, name), encoding='utf-8'))
        by_title[rec['title']] = rec
    for title, entry in sorted(pages.items()):
        rec = by_title.get(title)
        row = dict(entry)
        if rec:
            row.update({'revid': rec['revid'], 'timestamp': rec['timestamp'], 'url': rec['url'], 'file': page_file(rec['pageid']).replace(os.sep, '/'),
                        'shape': shape(rec['wikitext'])})
        index_pages.append(row)
    index = {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'roots': roots,
             'counts': {'categories': len(categories), 'pages': len(pages), 'articlesWithContent': sum(1 for r in index_pages if r.get('revid')),
                        'fetchedThisRun': fetched, 'unchanged': skipped},
             'categories': categories, 'pages': index_pages}
    with open(os.path.join(OUT, args.index_name), 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    print('wrote %s: %s' % (os.path.join(OUT, args.index_name), index['counts']))


if __name__ == '__main__':
    main()
