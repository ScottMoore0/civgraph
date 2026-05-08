"""Targeted: scrape 2024 Wicklow Dáil constituency (cons=235) from
electionsireland.org via Wayback Machine, write to the canonical
2024-11-29/wicklow.json slot, and add it to _index.json.
"""
import json, re, time
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

OUT = Path('election-viewer-package/data/elections/dail-eireann/2024-11-29')
WAYBACK = 'https://web.archive.org/web/2025/'
BASE = 'https://electionsireland.org'
EI_URL = f'{BASE}/result.cfm?election=2024&cons=235'
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data project)'}


def fetch_wb(url):
    with httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True) as c:
        for _ in range(3):
            try:
                r = c.get(WAYBACK + url)
                if r.status_code == 200 and len(r.text) > 1500:
                    return r.text
            except Exception:
                pass
            time.sleep(2)
    return None


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
        rows = table.find_all('tr')
        cand_rows = [r for r in rows if r.find('a', href=re.compile(r'candidate\.cfm', re.I))]
        if not cand_rows:
            continue
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
                if not t:
                    continue
                m = re.match(r'^(\d+(?:\.\d+)?)$', t)
                if m:
                    counts.append(float(m.group(1)) if '.' in t else int(t))
            status = ''
            for s in row.find_all(['strong', 'b']):
                txt = s.get_text(strip=True)
                if txt in ('Made Quota', 'Elected', 'Excluded', 'Eliminated',
                           'Deemed Elected', 'Withdrew', 'Not Elected'):
                    status = txt
                    break
            cands.append({
                'name': cand_name, 'party': party,
                'first_pref': counts[0] if counts else None,
                'final_count': counts[-1] if counts else None,
                'counts': counts, 'status': status,
            })
        if cands:
            break
    return {'meta': meta, 'candidates': cands, 'constituency': cons_name}


def main():
    print(f'fetching {EI_URL} via Wayback ...')
    html = fetch_wb(EI_URL)
    if not html:
        raise SystemExit('failed to fetch Wicklow page')
    data = parse_constituency(html, 'Wicklow')
    data['year'] = 2024
    data['cons_id'] = '235'
    data['source_url'] = EI_URL
    print(f'  parsed {len(data["candidates"])} candidates, '
          f'electorate={data["meta"].get("electorate")}, '
          f'quota={data["meta"].get("quota")}')

    out = OUT / 'wicklow.json'
    OUT.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'wrote {out}')

    # Update _index.json
    idx_path = OUT / '_index.json'
    with open(idx_path, encoding='utf-8') as f:
        idx = json.load(f)
    if not any(e.get('cons_id') == '235' for e in idx):
        idx.append({
            'name': 'Wicklow',
            'cons_id': '235',
            'candidates': len(data['candidates']),
            'seats': data['meta'].get('seats'),
            'quota': data['meta'].get('quota'),
        })
        idx.sort(key=lambda x: x['name'])
        with open(idx_path, 'w', encoding='utf-8') as f:
            json.dump(idx, f, indent=2, ensure_ascii=False)
        print(f'added Wicklow to {idx_path} ({len(idx)} entries)')
    else:
        print('Wicklow already in _index.json')


if __name__ == '__main__':
    main()
