#!/usr/bin/env python3
"""Add History of Parliament pages saved by hand in a browser to the local archive.

    python scripts/hop/ingest_saved_pages.py --archive <archive.sqlite> --urls <list.txt> <folder>

The site now puts a JavaScript bot check in front of its pages, so the ones the crawl lost
(401s) are saved one at a time from a browser ("Save page as", HTML only, or Chrome's
single-file .mhtml) into <folder>.
Each saved file is matched to the URL it came from by its <title> -- a member page's title
carries his surname and years ("WYSE, Thomas (1791-1862)"), a constituency page's its
name ("Co. Longford") -- and stored under that URL with status 200, replacing the 401.
Files that are a bot check, a login wall, or match no wanted URL are reported and skipped.
Pages can also come from the Internet Archive's own copies (web.archive.org/web/<ts>id_/<url>,
the page as captured): pass --source wayback. Run extract_hop_ireland.py afterwards.
"""
import argparse
import email
import email.policy
import glob
import json
import os
import re
import sqlite3
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def wanted_key(url):
    """'/member/wyse-thomas-1791-1862' -> ('member', 'wyse', '1791-1862');
    '/constituencies/county-longford' -> ('constituency', 'longford', None)."""
    slug = url.rstrip('/').rsplit('/', 1)[-1].lower().replace('%e2%80%99', '')
    if '/member/' in url:
        years = re.search(r'(\d{4})-(\d{4})$', slug)
        return ('member', re.sub(r'[^a-z]', '', slug.split('-')[0]), years.group(0) if years else None)
    return ('constituency', re.sub(r'^(co|county)-', '', slug).replace('-', ' '), None)


def page_key(html):
    title = re.search(r'<title>(.*?)</title>', html, re.S | re.I)
    title = re.sub(r'\s+', ' ', title.group(1)) if title else ''
    title = title.split('|')[0].strip()
    # Uncertain years are printed "?1793" or "c.1750"; the slug has the bare year.
    m = re.match(r"^([^,(]+),.*?\((?:\?|c\.\s*)?(\d{4})-(?:\?|c\.\s*)?(\d{4})\)", title)
    if m:
        return ('member', re.sub(r'[^a-z]', '', m.group(1).lower().split()[0]), f'{m.group(2)}-{m.group(3)}')
    return ('constituency', re.sub(r'^(co\.?|county)\s+', '', title.lower()).strip(), None)


def from_mhtml(raw):
    """Chrome's "Webpage, single file" (.mhtml): the page is the first text/html part."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    part = next((p for p in msg.walk() if p.get_content_type() == 'text/html'), None)
    return part.get_payload(decode=True) if part else b''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--archive', default=os.environ.get('HOP_ARCHIVE'))
    ap.add_argument('--urls', required=True)
    ap.add_argument('--source', default='manual-save', help='recorded on each row, e.g. "wayback" for Internet Archive copies')
    ap.add_argument('folder')
    args = ap.parse_args()
    urls = [u.strip() for u in open(args.urls, encoding='utf-8') if u.strip()]
    by_key = {}
    for u in urls:
        by_key.setdefault(wanted_key(u), []).append(u)
    db = sqlite3.connect(args.archive)
    done, skipped = [], []
    files = glob.glob(os.path.join(args.folder, '*.htm*')) + glob.glob(os.path.join(args.folder, '*.mhtml'))
    for f in sorted(files):
        raw = open(f, 'rb').read()
        if f.lower().endswith('.mhtml'):
            raw = from_mhtml(raw)
        html = raw.decode('utf-8', 'replace')
        if 'Bot check' in html[:3000] or 'restricted to logged in users' in html:
            skipped.append((os.path.basename(f), 'bot check or login page, not the page itself'))
            continue
        hits = by_key.get(page_key(html), [])
        if len(hits) != 1:
            skipped.append((os.path.basename(f), 'matches no wanted URL' if not hits else 'matches several URLs'))
            continue
        url = hits[0]
        key = re.sub(r'^https?://(www\.)?', '', url)
        db.execute('insert or replace into responses (url, status, reason, headers, body, fetched, source, key) '
                   'values (?, 200, ?, ?, ?, ?, ?, ?)',
                   (url, 'OK', json.dumps([['Content-Type', 'text/html']]), raw, time.time(), args.source, key))
        done.append(url)
    db.commit()
    left = sorted(set(urls) - set(done))
    print(json.dumps({'stored': len(done), 'skipped': skipped, 'still wanted': left}, indent=1))


if __name__ == '__main__':
    main()
