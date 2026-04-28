"""Step 2: Recent Dáil elections (2002-2024) via Wayback Machine.

Iterates each Dáil's index page (which is NOT Cloudflare-blocked), gets the
list of constituency URLs, then fetches each constituency result via Wayback.
"""
import re, json, time
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

BASE = 'https://electionsireland.org'
WAYBACK = 'https://web.archive.org/web/2024/'
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project)'}
OUT = Path(r'election-viewer-package/data/elections/dail-eireann')
OUT.mkdir(parents=True, exist_ok=True)
c = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)

# Dáil number → year mapping for recent ones
DAIL_NUMS = [(28, 1997), (29, 2002), (30, 2007), (31, 2011), (32, 2016), (33, 2020), (34, 2024)]


def slugify(s):
    s = re.sub(r'\s+', '-', s.strip().lower())
    s = re.sub(r'[^a-z0-9-]', '', s)
    return re.sub(r'-+', '-', s).strip('-')


def fetch_wb(ei_url, retries=2):
    for a in range(retries):
        try:
            r = c.get(f'{WAYBACK}{ei_url}')
            if r.status_code == 200 and len(r.text) > 1500:
                return r.text
        except Exception:
            pass
        time.sleep(2)
    return None


def parse_dail_index(num):
    """Get list of (cons_id, cons_name) for a given Dáil index page (works without Wayback)."""
    url = f'{BASE}/results/general/{num:02d}dail.cfm'
    r = c.get(url)
    if r.status_code != 200: return []
    soup = BeautifulSoup(r.text, 'html.parser')
    items = []
    for a in soup.find_all('a', href=re.compile(r'result\.cfm\?election=\d+&amp;cons=|result\.cfm\?election=\d+&cons=')):
        m = re.search(r'election=(\d+)&(?:amp;)?cons=(\d+)', a['href'])
        if m:
            items.append({'election': m.group(1), 'cons': m.group(2),
                          'name': a.get_text(strip=True)})
    return items


def parse_constituency(html, cons_name):
    """Extract candidate-count table from a constituency result page."""
    soup = BeautifulSoup(html, 'html.parser')
    # Meta
    text = soup.get_text(' ', strip=True)
    meta = {}
    for key, regex in [
        ('electorate', r'Electorate:\s*([\d,]+)'),
        ('total_poll', r'Total Poll:\s*([\d,]+)'),
        ('valid_poll', r'Valid Poll:\s*([\d,]+)'),
        ('spoilt', r'Spoil(?:ed|t):\s*([\d,]+)'),
        ('quota', r'Quota:\s*([\d,]+)'),
        ('seats', r'Seats?:\s*(\d+)'),
        ('turnout', r'Turnout:\s*([\d.]+)'),
    ]:
        m = re.search(regex, text, re.I)
        if m:
            try:
                v = m.group(1).replace(',', '')
                meta[key] = float(v) if '.' in v else int(v)
            except ValueError:
                pass

    # Candidates — find table with candidate links
    cands = []
    for table in soup.find_all('table'):
        rows = table.find_all('tr')
        cand_rows = [r for r in rows if r.find('a', href=re.compile(r'candidate\.cfm', re.I))]
        if not cand_rows: continue
        for row in cand_rows:
            link = row.find('a', href=re.compile(r'candidate\.cfm', re.I))
            cells = row.find_all('td')
            cand_name = link.get_text(strip=True)
            party = ''
            party_img = row.find('img', alt=True)
            if party_img:
                party = party_img.get('alt', '').replace('Lozenge', '').strip()
            counts = []
            for c_ in cells[1:]:
                t = c_.get_text(strip=True).replace(',', '').replace('+', '')
                if not t: continue
                m = re.match(r'^(\d+(?:\.\d+)?)$', t)
                if m: counts.append(float(m.group(1)) if '.' in t else int(t))
            status = ''
            for s in row.find_all(['strong', 'b']):
                txt = s.get_text(strip=True)
                if txt in ('Made Quota', 'Elected', 'Excluded', 'Eliminated', 'Deemed Elected', 'Withdrew', 'Not Elected'):
                    status = txt; break
            cands.append({
                'name': cand_name, 'party': party,
                'first_pref': counts[0] if counts else None,
                'final_count': counts[-1] if counts else None,
                'counts': counts, 'status': status,
            })
        if cands: break
    return {'meta': meta, 'candidates': cands, 'constituency': cons_name}


def main():
    for num, year in DAIL_NUMS:
        print(f'\n=== {num}th Dáil ({year}) ===')
        cons_list = parse_dail_index(num)
        print(f'  {len(cons_list)} constituencies')
        if not cons_list: continue
        out_dir = OUT / str(year)
        out_dir.mkdir(parents=True, exist_ok=True)
        summary = []
        for i, item in enumerate(cons_list, 1):
            ei_url = f'{BASE}/result.cfm?election={item["election"]}&cons={item["cons"]}'
            html = fetch_wb(ei_url)
            if not html:
                print(f'  [{i}/{len(cons_list)}] {item["name"]}: ! fetch failed')
                continue
            data = parse_constituency(html, item['name'])
            data['year'] = year
            data['cons_id'] = item['cons']
            data['source_url'] = ei_url
            slug = slugify(item['name']) or f'cons-{item["cons"]}'
            with open(out_dir / f'{slug}.json', 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            summary.append({'name': item['name'], 'cons_id': item['cons'],
                            'candidates': len(data['candidates']),
                            'seats': data['meta'].get('seats'),
                            'quota': data['meta'].get('quota')})
            print(f'  [{i}/{len(cons_list)}] {item["name"]}: {len(data["candidates"])} candidates')
            time.sleep(1.2)
        with open(out_dir / '_index.json', 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)


if __name__ == '__main__':
    main()
