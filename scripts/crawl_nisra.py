"""Crawl nisra.gov.uk and download every dataset / publication linked from public pages.

Strategy:
  1. Read sitemap.xml to seed URL set.
  2. BFS internal pages collecting linked file assets.
  3. Download every .xlsx, .xls, .csv, .pdf, .zip, .ods file under nisra.gov.uk
     to D:\\nisra\\<topic-path>\\<filename>.
  4. Resume-safe: skip any file already on disk.
  5. Polite: ~1 req/sec, identifying User-Agent.

Outputs:
  D:\\nisra\\<mirrored-path>\\<file>
  D:\\nisra\\_inventory.json — running catalogue of URL → local path
  D:\\nisra\\_pages_seen.txt — pages we've already crawled (for resume)
  D:\\nisra\\_log.txt        — append-only progress log
"""
import os, re, time, json, sys, urllib.parse, io
from pathlib import Path
import httpx
from bs4 import BeautifulSoup
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = Path(r'D:\nisra')
ROOT.mkdir(parents=True, exist_ok=True)
INVENTORY = ROOT / '_inventory.json'
PAGES_SEEN_FILE = ROOT / '_pages_seen.txt'
LOG = ROOT / '_log.txt'

BASE = 'https://www.nisra.gov.uk'
HEADERS = {'User-Agent': 'civgraph.net (NI/ROI civic-data archive; ~1 req/s)'}
ASSET_EXTS = {'.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.pdf', '.zip', '.ods', '.gpkg', '.geojson', '.json', '.docx'}

c = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)

def log(msg):
    t = time.strftime('%H:%M:%S')
    line = f'[{t}] {msg}'
    print(line)
    with open(LOG, 'a', encoding='utf-8', errors='replace') as f:
        f.write(line + '\n')

def load_seen():
    if PAGES_SEEN_FILE.exists():
        return set(PAGES_SEEN_FILE.read_text(encoding='utf-8').splitlines())
    return set()

def add_seen(url):
    with open(PAGES_SEEN_FILE, 'a', encoding='utf-8') as f:
        f.write(url + '\n')

def load_inventory():
    if INVENTORY.exists():
        try:
            return json.loads(INVENTORY.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}

def save_inventory(inv):
    with open(INVENTORY, 'w', encoding='utf-8') as f:
        json.dump(inv, f, indent=2)

def is_internal(url):
    p = urllib.parse.urlparse(url)
    return p.netloc.endswith('nisra.gov.uk') or not p.netloc

def asset_path_for(url):
    p = urllib.parse.urlparse(url)
    rel = p.path.lstrip('/')
    if not rel: rel = 'index.html'
    return ROOT / 'mirror' / rel

def fetch_sitemap():
    """Parse sitemap.xml (and any linked sub-sitemaps) to seed page URLs."""
    urls = set()
    queue = [f'{BASE}/sitemap.xml']
    seen = set()
    while queue:
        sm_url = queue.pop()
        if sm_url in seen: continue
        seen.add(sm_url)
        try:
            r = c.get(sm_url)
            if r.status_code != 200: continue
            for m in re.finditer(r'<loc>([^<]+)</loc>', r.text):
                u = m.group(1).strip()
                if u.endswith('.xml'):
                    queue.append(u)
                else:
                    urls.add(u)
        except Exception as e:
            log(f'sitemap fetch fail {sm_url}: {e}')
    return urls

def download_asset(url, inv):
    if url in inv:
        return False  # already done
    out = asset_path_for(url)
    if out.exists():
        inv[url] = str(out)
        return False
    try:
        r = c.get(url)
        if r.status_code != 200:
            log(f'  ! {r.status_code} {url}')
            return False
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, 'wb') as f:
            f.write(r.content)
        inv[url] = str(out)
        log(f'  ↓ {len(r.content)/1024:.0f}KB  {url}')
        return True
    except Exception as e:
        log(f'  ! {e}  {url}')
        return False

def crawl():
    pages_seen = load_seen()
    inv = load_inventory()
    log(f'starting NISRA crawl — {len(pages_seen)} pages seen, {len(inv)} assets in inventory')

    # Seed from sitemap
    initial = fetch_sitemap()
    log(f'sitemap returned {len(initial)} URLs')
    queue = sorted(initial - pages_seen) + [BASE + '/']

    seen_in_session = set(pages_seen)
    pages_done = 0
    new_assets = 0
    last_save = time.time()

    while queue:
        url = queue.pop(0)
        if url in seen_in_session: continue
        seen_in_session.add(url)
        try:
            r = c.get(url)
        except Exception as e:
            log(f'fetch fail {url}: {e}')
            continue
        if r.status_code != 200:
            continue
        # Detect content type
        ct = r.headers.get('content-type', '').lower()
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
        if ext in ASSET_EXTS or ('html' not in ct and 'xml' not in ct):
            # Treat as asset
            if download_asset(url, inv):
                new_assets += 1
        else:
            # HTML page — extract links
            try:
                soup = BeautifulSoup(r.text, 'html.parser')
            except Exception:
                continue
            for tag in soup.find_all(['a', 'link', 'iframe']):
                href = tag.get('href') or tag.get('src')
                if not href: continue
                full = urllib.parse.urljoin(url, href)
                full = full.split('#')[0].split('?')[0]
                if not is_internal(full): continue
                ext2 = os.path.splitext(urllib.parse.urlparse(full).path)[1].lower()
                if ext2 in ASSET_EXTS:
                    if download_asset(full, inv):
                        new_assets += 1
                else:
                    if full not in seen_in_session:
                        queue.append(full)
        add_seen(url)
        pages_done += 1
        # Save inventory periodically
        if time.time() - last_save > 60:
            save_inventory(inv)
            last_save = time.time()
            log(f'  ... pages={pages_done} new_assets={new_assets} queue={len(queue)} total_assets={len(inv)}')
        time.sleep(1.0)

    save_inventory(inv)
    log(f'crawl complete — pages={pages_done} new_assets={new_assets} total_assets={len(inv)}')

if __name__ == '__main__':
    crawl()
