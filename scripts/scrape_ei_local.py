"""Steps 6+7: Local elections (1979-2024) via Wayback. Same engine as Dáil."""
import re, json, time
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

BASE = 'https://electionsireland.org'
WAYBACK = 'https://web.archive.org/web/2024/'
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project)'}
OUT = Path(r'election-viewer-package/data/elections/ireland-local')
OUT.mkdir(parents=True, exist_ok=True)
c = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)

LOCAL_YEARS = [2024, 2019, 2014, 2009, 2004, 1999, 1991, 1985, 1979, 1974]


def slugify(s):
    s = re.sub(r'\s+', '-', s.strip().lower())
    s = re.sub(r'[^a-z0-9-]', '', s)
    return re.sub(r'-+', '-', s).strip('-')


def fetch_wb(url, retries=2):
    for a in range(retries):
        try:
            r = c.get(f'{WAYBACK}{url}')
            if r.status_code == 200 and len(r.text) > 1500:
                return r.text
        except Exception:
            pass
        time.sleep(2)
    return None


def parse_local_index(year):
    url = f'{BASE}/results/local/{year}local.cfm'
    r = c.get(url)
    if r.status_code != 200: return []
    soup = BeautifulSoup(r.text, 'html.parser')
    items = []
    for a in soup.find_all('a', href=re.compile(r'result\.cfm\?election=\d+L&(?:amp;)?cons=\d+')):
        m = re.search(r'election=(\d+L)&(?:amp;)?cons=(\d+)', a['href'])
        if m:
            items.append({'election': m.group(1), 'cons': m.group(2),
                          'name': a.get_text(strip=True)})
    return items


def parse_constituency(html, cons_name):
    soup = BeautifulSoup(html, 'html.parser')
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
    cands = []
    for table in soup.find_all('table'):
        cand_rows = [r for r in table.find_all('tr') if r.find('a', href=re.compile(r'candidate\.cfm', re.I))]
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
            cands.append({'name': cand_name, 'party': party,
                          'first_pref': counts[0] if counts else None,
                          'final_count': counts[-1] if counts else None,
                          'counts': counts, 'status': status})
        if cands: break
    return {'meta': meta, 'candidates': cands, 'constituency': cons_name}


def main():
    for year in LOCAL_YEARS:
        out_dir = OUT / str(year)
        if (out_dir / '_index.json').exists():
            print(f'  skip {year} — already done')
            continue
        print(f'\n=== Local {year} ===')
        cons_list = parse_local_index(year)
        print(f'  {len(cons_list)} LEAs')
        if not cons_list: continue
        out_dir.mkdir(parents=True, exist_ok=True)
        summary = []
        for i, item in enumerate(cons_list, 1):
            ei_url = f'{BASE}/result.cfm?election={item["election"]}&cons={item["cons"]}'
            html = fetch_wb(ei_url)
            if not html:
                print(f'  [{i}/{len(cons_list)}] {item["name"][:30]}: ! fetch failed'); continue
            data = parse_constituency(html, item['name'])
            data['year'] = year; data['cons_id'] = item['cons']; data['source_url'] = ei_url
            slug = slugify(item['name']) or f'cons-{item["cons"]}'
            with open(out_dir / f'{slug}.json', 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            summary.append({'name': item['name'], 'cons_id': item['cons'],
                            'candidates': len(data['candidates']),
                            'seats': data['meta'].get('seats')})
            time.sleep(1.0)
        with open(out_dir / '_index.json', 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        print(f'  -> {len(summary)} LEAs scraped')


if __name__ == '__main__':
    main()
