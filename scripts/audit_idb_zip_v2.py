"""For each FGB in the zip, map it to the matching R2 URL on the website
(using a basename-rename table where appropriate) and compare bytes.
"""
import hashlib, os, subprocess
from urllib.parse import quote

ROOT = '_tmp_idb_zip/Irish Digitised Boundaries'

# zip relative path -> R2 URL (or None to skip)
RENAME = {
    'Counties/1957.fgb': 'https://data.civgraph.net/data/maps/baronies-parishes/Counties_Ireland_1957.fgb',
    'Dáil Constituencies/1974.fgb': 'https://data.civgraph.net/data/maps/parliamentary/1974_Dail.fgb',
    'Dáil Constituencies/1980.fgb': 'https://data.civgraph.net/data/maps/parliamentary/1980_Dail.fgb',
    'Dáil Constituencies/1983.fgb': 'https://data.civgraph.net/data/maps/parliamentary/1983_Dail.fgb',
    'Dáil Constituencies/Files already on the site/1990.fgb': 'https://data.civgraph.net/data/maps/parliamentary/1990_Dail.fgb',
    'Dáil Constituencies/Files already on the site/1995.fgb': 'https://data.civgraph.net/data/maps/parliamentary/1995_Dail.fgb',
    'Dáil Constituencies/Files already on the site/1998.fgb': 'https://data.civgraph.net/data/maps/parliamentary/1998_Dail.fgb',
    'Dáil Constituencies/Files already on the site/2005.fgb': 'https://data.civgraph.net/data/maps/parliamentary/2005_Dail.fgb',
    'Dáil Constituencies/Files already on the site/2009.fgb': 'https://data.civgraph.net/data/maps/parliamentary/2009_Dail.fgb',
    'Dáil Constituencies/Files already on the site/2013.fgb': 'https://data.civgraph.net/data/maps/parliamentary/ROIConstituencies2013.fgb',
    'Dáil Constituencies/Files already on the site/2017.fgb': 'https://data.civgraph.net/data/maps/parliamentary/ROIConstituencies2017.fgb',
    'EDs/DEDs_Connacht_1919.fgb': 'https://data.civgraph.net/data/maps/electoral-divisions/DEDs_Connacht_1919.fgb',  # NEW
    'EDs/DEDs_Ulster_1921.fgb': 'https://data.civgraph.net/data/maps/electoral-divisions/DEDs_Ulster_1921.fgb',  # NEW (different from Wards_DEDs_Ulster_1921)
    'EDs/Files already on the site/Wards_DEDs_Munster_1983.fgb': 'https://data.civgraph.net/data/maps/electoral-divisions/Electoral Divisions 1986-2019/Wards_DEDs_Munster_1983.fgb',
    'Local Authorities/1965.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1965.fgb',
    'Local Authorities/1966.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1966.fgb',
    'Local Authorities/1977.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1977.fgb',
    'Local Authorities/1980.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1980.fgb',
    'Local Authorities/1985.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1985.fgb',
    'Local Authorities/1986.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1986.fgb',
    'Local Authorities/1994.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1994.fgb',
    'Local Authorities/Files already on the site/2002.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_2002.fgb',
    'Local Authorities/Files already on the site/2008.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_2008.fgb',
    'Local Authorities/Files already on the site/2014.fgb': 'https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_2014.fgb',
}


def head(url):
    enc = url.split('://')[0] + '://' + url.split('://')[1].split('/')[0] + '/' + quote(url.split('://')[1].split('/', 1)[1], safe='/')
    r = subprocess.run(['curl', '-sI', '--max-time', '8', enc], capture_output=True, text=True)
    status = length = None
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith('HTTP/'):
            try: status = int(line.split()[1])
            except: pass
        if line.lower().startswith('content-length:'):
            try: length = int(line.split(':',1)[1].strip())
            except: pass
    return status, length


for rel, url in RENAME.items():
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print(f'  MISSING in zip: {rel}'); continue
    sz = os.path.getsize(p)
    status, length = head(url)
    if status != 200:
        verdict = f'NEW (R2 status={status})'
    elif length == sz:
        verdict = 'IDENTICAL'
    else:
        verdict = f'DIFFERENT (zip {sz} vs R2 {length})'
    print(f'  {verdict:>22}  {rel}')
