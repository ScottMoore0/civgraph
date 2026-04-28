"""Scrape ROI referendum results from ElectionsIreland.org.

Output: per-referendum JSON files under election-viewer-package/data/elections/
        ireland-referendum/{date}/{slug}.json (mirrors the site's existing layout).

Covers all 41 referenda (1937-2024) listed on EI's index.
"""
import os, re, json, time, sys
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

BASE = 'https://electionsireland.org'
INDEX_URL = f'{BASE}/results/referendum/index.cfm'
OUT_ROOT = Path(r'election-viewer-package/data/elections/ireland-referendum')
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project; scrape: referendums; ~1 req/sec)'}

c = httpx.Client(headers=HEADERS, timeout=30.0, follow_redirects=True)


def slugify(s):
    s = re.sub(r'\s+', '-', s.strip().lower())
    s = re.sub(r'[^a-z0-9-]', '', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def fetch_index():
    r = c.get(INDEX_URL)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')
    refs = []
    for a in soup.find_all('a', href=re.compile(r'refresult\.cfm\?ref=')):
        url = a['href']
        if not url.startswith('http'):
            url = f'{BASE}/results/referendum/{url}'
        # Display text often holds the date / amendment label
        label = a.get_text(strip=True)
        ref_id = re.search(r'ref=([^&"]+)', url).group(1)
        refs.append({'url': url, 'ref_id': ref_id, 'label': label})
    # de-dupe by ref_id, preferring the entry with the longer/more useful label
    by_id = {}
    for r_ in refs:
        prev = by_id.get(r_['ref_id'])
        if prev is None or len(r_['label']) > len(prev['label']):
            by_id[r_['ref_id']] = r_
    return list(by_id.values())


def parse_referendum(url, ref_id):
    """Fetch and parse one EI referendum page."""
    r = c.get(url)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')

    # Title pattern: 'Elections Ireland: Referendum DD MMM YYYY <Topic>'
    title_tag = soup.find('title')
    title = title_tag.get_text(strip=True) if title_tag else ''
    m = re.search(r'Referendum\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s+(.+?)\s*$', title)
    date_iso, topic = None, None
    if m:
        d, mon, y, topic = m.groups()
        try:
            t = time.strptime(f'{d} {mon} {y}', '%d %B %Y')
            date_iso = time.strftime('%Y-%m-%d', t)
        except ValueError:
            pass

    # Outcome — look for "ACCEPTED" / "REJECTED" h2
    outcome = None
    for h in soup.find_all(['h1', 'h2']):
        txt = h.get_text(strip=True).upper()
        if 'ACCEPTED' in txt or 'REJECTED' in txt or 'PASSED' in txt:
            outcome = 'passed' if ('ACCEPTED' in txt or 'PASSED' in txt) else 'rejected'
            break

    # Two big <h1> percentages near the top: Yes %, No %
    pcts = []
    for h in soup.find_all('h1'):
        m = re.search(r'(\d+\.\d+)\s*%', h.get_text())
        if m:
            pcts.append(float(m.group(1)))
    yes_pct = pcts[0] if len(pcts) >= 1 else None
    no_pct = pcts[1] if len(pcts) >= 2 else None

    # National totals — search all tables for Yes/No/Spoilt rows
    yes_total, no_total, spoilt_total, total_poll, electorate = None, None, None, None, None
    for tr in soup.find_all('tr'):
        cells = [c.get_text(strip=True) for c in tr.find_all(['td', 'th'])]
        if len(cells) < 2: continue
        first = cells[0].lower()
        if first == 'yes' and len(cells) >= 2:
            try: yes_total = int(re.sub(r'[^\d]', '', cells[1]))
            except: pass
        elif first == 'no' and len(cells) >= 2:
            try: no_total = int(re.sub(r'[^\d]', '', cells[1]))
            except: pass
        elif 'spoilt' in first or 'spoiled' in first:
            try: spoilt_total = int(re.sub(r'[^\d]', '', cells[1]))
            except: pass
        elif first.startswith('total poll'):
            try: total_poll = int(re.sub(r'[^\d]', '', cells[1]))
            except: pass
        elif first.startswith('total electorate') or first == 'electorate':
            try: electorate = int(re.sub(r'[^\d]', '', cells[1]))
            except: pass

    # Per-constituency breakdown — find table with constituency rows
    constituencies = []
    # Look for tables whose rows have a link to result.cfm (constituency name)
    for table in soup.find_all('table'):
        rows = table.find_all('tr')
        for row in rows:
            link = row.find('a', href=re.compile(r'result\.cfm\?election='))
            if not link: continue
            cells = [c.get_text(strip=True) for c in row.find_all('td')]
            if len(cells) < 5: continue
            cons_name = link.get_text(strip=True)
            # Cells layout (typical EI):
            #   [name, '', electorate, total_poll, spoilt, valid, yes, no, yes%, no%, turnout%]
            # Some variants. Be defensive — extract numbers in order.
            nums = []
            for cv in cells[1:]:
                try:
                    if '%' in cv:
                        nums.append(float(cv.replace('%', '').replace(',', '').strip()))
                    elif cv:
                        nums.append(int(re.sub(r'[^\d]', '', cv)))
                    else:
                        nums.append(None)
                except (ValueError, TypeError):
                    nums.append(None)
            constituencies.append({
                'constituency': cons_name,
                'cells': nums,
            })

    return {
        'ref_id': ref_id,
        'title': title,
        'topic': topic,
        'date': date_iso,
        'outcome': outcome,
        'national': {
            'yes_pct': yes_pct,
            'no_pct': no_pct,
            'yes_votes': yes_total,
            'no_votes': no_total,
            'spoilt_votes': spoilt_total,
            'total_poll': total_poll,
            'electorate': electorate,
        },
        'constituencies': constituencies,
        'source_url': url,
    }


def main():
    print('Fetching index...')
    refs = fetch_index()
    print(f'  {len(refs)} referenda')
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    summary = []
    for i, ref in enumerate(refs, 1):
        print(f'[{i}/{len(refs)}] {ref["ref_id"]} - {ref["label"][:60]}')
        try:
            data = parse_referendum(ref['url'], ref['ref_id'])
        except Exception as e:
            print(f'  ! {e}')
            continue
        date = data.get('date') or 'unknown-date'
        topic_slug = slugify(data.get('topic') or ref['ref_id'])
        out_dir = OUT_ROOT / date
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f'{topic_slug}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        summary.append({
            'ref_id': data['ref_id'], 'date': data['date'], 'topic': data['topic'],
            'outcome': data['outcome'], 'yes_pct': data['national']['yes_pct'],
            'cons_count': len(data['constituencies']), 'path': str(out_path),
        })
        time.sleep(1.0)  # polite
    summary_path = OUT_ROOT / '_index.json'
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f'\nDone. {len(summary)} referenda written under {OUT_ROOT}')
    print(f'Index: {summary_path}')


if __name__ == '__main__':
    main()
