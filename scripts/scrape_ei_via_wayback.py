"""Generic EI scraper via Wayback Machine — bypasses Cloudflare on /result.cfm.

Subject covered here:
  - Presidential elections (steps 3)
  - European elections, ROI side (step 4)
"""
import re, json, time, sys
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

BASE_EI = 'https://electionsireland.org'
WAYBACK_PREFIX = 'https://web.archive.org/web/2024/'  # use the most-recent cached snapshot near 2024
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project; via web.archive.org)'}

c = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)


def wb_fetch(ei_url, retries=3):
    """Fetch a page via Wayback Machine. Returns html or None."""
    wb_url = f'{WAYBACK_PREFIX}{ei_url}'
    for attempt in range(retries):
        try:
            r = c.get(wb_url)
            if r.status_code == 200 and len(r.text) > 1500:
                return r.text
        except Exception as e:
            time.sleep(2 * (attempt + 1))
            continue
        time.sleep(1)
    return None


def slugify(s):
    s = re.sub(r'\s+', '-', s.strip().lower())
    s = re.sub(r'[^a-z0-9-]', '', s)
    return re.sub(r'-+', '-', s).strip('-')


def parse_count_table(soup):
    """Parse EI candidate-count table (used by Dáil, Presidential, European, Seanad).

    Returns: list of candidates with their per-count vote totals.
    """
    candidates = []
    # Find the main results table — usually right after the constituency name header
    for table in soup.find_all('table'):
        rows = table.find_all('tr')
        if len(rows) < 2: continue
        # Detect candidate-row pattern: links to a candidate page + a Party column
        first_data_row = None
        for r_ in rows[1:]:
            if r_.find('a', href=re.compile(r'candidate\.cfm|cand\.cfm', re.I)):
                first_data_row = r_
                break
        if not first_data_row: continue

        # Collect all data rows
        for r_ in rows:
            link = r_.find('a', href=re.compile(r'candidate\.cfm|cand\.cfm', re.I))
            if not link: continue
            cells = r_.find_all('td')
            if len(cells) < 4: continue
            cand_name = link.get_text(strip=True)
            party = ''
            party_img = r_.find('img')
            if party_img and party_img.get('alt'):
                party = party_img['alt']
            # Numeric cells (counts) — gather all numerics from later cells
            counts = []
            for c_ in cells[1:]:
                t = c_.get_text(strip=True).replace(',', '').replace('+', '')
                if not t: continue
                m = re.match(r'^(\d+(?:\.\d+)?)$', t)
                if m: counts.append(float(m.group(1)) if '.' in t else int(t))
            # Status — look for 'Made Quota', 'Elected', 'Excluded', 'Eliminated', etc.
            status = ''
            for s in r_.find_all(['strong', 'b']):
                txt = s.get_text(strip=True)
                if txt in ('Made Quota', 'Elected', 'Excluded', 'Eliminated', 'Deemed Elected', 'Withdrew', 'Disqualified'):
                    status = txt; break
            candidates.append({
                'name': cand_name, 'party': party, 'counts': counts, 'status': status,
            })
        if candidates:
            break
    return candidates


def parse_constituency_meta(soup):
    """Extract constituency metadata: electorate, total poll, valid poll, quota, spoilt."""
    meta = {}
    text = soup.get_text(' ', strip=True)
    for key, regex in [
        ('electorate', r'Electorate:\s*([\d,]+)'),
        ('total_poll', r'Total Poll:\s*([\d,]+)'),
        ('valid_poll', r'Valid Poll:\s*([\d,]+)'),
        ('spoilt', r'Spoil(?:ed|t):\s*([\d,]+)'),
        ('quota', r'Quota:\s*([\d,]+)'),
        ('seats', r'Seats:\s*(\d+)'),
        ('turnout', r'Turnout:\s*([\d.]+)\s*%'),
    ]:
        m = re.search(regex, text, re.I)
        if m:
            try:
                v = m.group(1).replace(',', '')
                meta[key] = float(v) if '.' in v else int(v)
            except ValueError:
                pass
    return meta


def scrape_presidential():
    """Step 3: Presidential elections — national-level results."""
    OUT = Path(r'election-viewer-package/data/elections/ireland-president')
    OUT.mkdir(parents=True, exist_ok=True)

    print('=== Step 3: Presidential ===')
    html = wb_fetch(f'{BASE_EI}/results/president/index.cfm')
    soup = BeautifulSoup(html or '', 'html.parser')
    elections = []
    for a in soup.find_all('a', href=re.compile(r'result\.cfm\?election=\d+P')):
        url = a['href']
        m = re.search(r'election=(\d+P)&cons=(\d+)', url)
        if m: elections.append({'election_id': m.group(1), 'cons': m.group(2),
                                'label': a.get_text(strip=True)})
    print(f'  {len(elections)} presidential elections found')
    summary = []
    for i, el in enumerate(elections, 1):
        url = f'{BASE_EI}/result.cfm?election={el["election_id"]}&cons={el["cons"]}'
        print(f'  [{i}/{len(elections)}] {el["election_id"]}')
        html = wb_fetch(url)
        if not html:
            print(f'    ! fetch failed'); continue
        soup = BeautifulSoup(html, 'html.parser')
        # Year is in election_id e.g. '1990P'
        year = re.match(r'(\d{4})', el['election_id']).group(1)
        title = soup.find('title')
        title_txt = title.get_text(strip=True) if title else ''
        # Candidates
        cands = parse_count_table(soup)
        meta = parse_constituency_meta(soup)
        record = {
            'body': 'President of Ireland', 'year': int(year), 'date': None,
            'election_id': el['election_id'],
            'title': title_txt,
            'candidates': cands, 'meta': meta,
            'source_url': url,
        }
        out_dir = OUT / year
        out_dir.mkdir(exist_ok=True)
        out = out_dir / 'national.json'
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
        summary.append({'year': year, 'candidates': len(cands), 'path': str(out)})
        time.sleep(1.5)
    with open(OUT / '_index.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    print(f'  → {len(summary)} elections scraped')


def scrape_european():
    """Step 4: European Parliament elections (ROI), per-constituency."""
    OUT = Path(r'election-viewer-package/data/elections/ireland-european')
    OUT.mkdir(parents=True, exist_ok=True)

    print('\n=== Step 4: European (ROI) ===')
    html = wb_fetch(f'{BASE_EI}/results/europe/index.cfm')
    soup = BeautifulSoup(html or '', 'html.parser')
    elections_by_year = {}
    for a in soup.find_all('a', href=re.compile(r'result\.cfm\?election=\d+E&')):
        url = a['href']
        m = re.search(r'election=(\d+E)&cons=(\d+)', url)
        if m:
            year = m.group(1)[:4]
            elections_by_year.setdefault(year, []).append({
                'election_id': m.group(1),
                'cons': m.group(2),
                'label': a.get_text(strip=True),
            })
    print(f'  {sum(len(v) for v in elections_by_year.values())} EU constituency-elections across {len(elections_by_year)} years')
    summary = []
    for year, items in sorted(elections_by_year.items()):
        for i, el in enumerate(items, 1):
            url = f'{BASE_EI}/result.cfm?election={el["election_id"]}&cons={el["cons"]}'
            print(f'  [{year}/{i}] cons={el["cons"]}')
            html = wb_fetch(url)
            if not html:
                print(f'    ! fetch failed'); continue
            soup = BeautifulSoup(html, 'html.parser')
            cands = parse_count_table(soup)
            meta = parse_constituency_meta(soup)
            cons_name = el['label'].strip()
            record = {
                'body': 'European Parliament', 'year': int(year), 'date': None,
                'election_id': el['election_id'], 'cons_id': el['cons'],
                'constituency': cons_name,
                'candidates': cands, 'meta': meta,
                'source_url': url,
            }
            out_dir = OUT / year
            out_dir.mkdir(exist_ok=True)
            slug = slugify(cons_name) or f'cons-{el["cons"]}'
            out = out_dir / f'{slug}.json'
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(record, f, indent=2, ensure_ascii=False)
            summary.append({'year': year, 'constituency': cons_name,
                            'candidates': len(cands), 'path': str(out)})
            time.sleep(1.5)
    with open(OUT / '_index.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    print(f'  → {len(summary)} constituency-elections scraped')


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if target in ('all', 'president'): scrape_presidential()
    if target in ('all', 'european'): scrape_european()
