#!/usr/bin/env python3
"""Wire the Republic of Ireland local elections into the live viewer.

The harvest holds ten years of RoI local results under
data/elections-source/data/elections/ireland-local/<year>/, but nothing published them:
the directories are named by year rather than polling day, no file records which council
an area belongs to, and there is no entry for them in elections_index.json. This script
does for them what integrate_roi_dail.py did for the Dail.

  1. Reads each year's council and area structure from ElectionsIreland's own index page
     (results/local/<year>local.cfm), through the same page cache as the id harvest.
  2. Renames <year>/ to the polling day.
  3. Stamps every area file with its council, ElectionsIreland result id and seats.
  4. Gives an area name used by two councils its council ("Athlone (Westmeath)"). Both
     Athlones were written to one athlone.json, so one council's result was lost every year;
     in 2019 and 2024 the file kept was the empty one.
  5. Recovers areas whose file is missing or empty from their result page, where the page
     has results. 26 areas of 2014 were never scraped at all.
  6. Rewrites each year's _index.json with council, result id, seats and candidate count.
  7. Adds one body to elections_index.json, for the years that meet the coverage threshold,
     listing only areas with results and recording how many areas the election had.

ElectionsIreland holds partial results for several years, and that is not repaired here
because the source does not have it: 2019 has results for 103 of 166 areas, 2024 for 63 of
166. Those years are published with the coverage stated. 1974, 1979 and 1985 have results
for 2, 3 and 16 areas; they are held back, because an "election" drawn from a handful of
areas would read as the whole contest.

Idempotent. `--dry-run` reports the plan and writes nothing.

  python scripts/integrate_roi_local.py --dry-run
  python scripts/integrate_roi_local.py
"""
import os
import re
import sys
import json
import argparse
import importlib.util
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

import httpx  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402
from harvest_ei_candidate_ids import fetch, HEADERS  # noqa: E402

LOCAL_DIR = os.path.join(REPO, 'data', 'elections-source', 'data', 'elections', 'ireland-local')
MASTER_INDEX = os.path.join(REPO, 'data', 'elections-source', 'data', 'elections_index.json')
BODY_NAME = 'Local Authorities of Ireland'
BODY_SLUG = 'ireland-local'

# Polling days. 1991-2024 as ElectionsIreland's own index pages state them. The 1974, 1979
# and 1985 pages state none, so those three come from Wikipedia's article on each election.
DATES = {
    1974: '1974-06-18', 1979: '1979-06-07', 1985: '1985-06-20', 1991: '1991-06-27',
    1999: '1999-06-10', 2004: '2004-06-11', 2009: '2009-06-05', 2014: '2014-05-23',
    2019: '2019-05-24', 2024: '2024-06-07',
}

# Share of an election's areas that must have results before it is published.
MIN_COVERAGE = 0.25


def slugify(value):
    value = re.sub(r'\s+', '-', str(value or '').strip().lower())
    value = re.sub(r'[^a-z0-9-]', '', value)
    return re.sub(r'-+', '-', value).strip('-')


def council_name(text):
    """ElectionsIreland's heading, with its one typo ("Cork County Counci") repaired."""
    text = ' '.join(str(text or '').split())
    return re.sub(r' Counci$', ' Council', text)


def council_short(council):
    return re.sub(r'\s+(City and County|County|City|Borough|Town)?\s*Council$', '', council).strip() or council


def load_scraper():
    spec = importlib.util.spec_from_file_location('scrape_ei_local', os.path.join(HERE, 'scrape_ei_local.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_index(html, year):
    """[{council, areas: [{name, cons_id, seats}]}] from a year's index page.

    Two layouts: 2019 and 2024 head each council's list with an <h6>, earlier years with a
    bold paragraph. Links are filtered to this year's local election, so the Dail
    by-elections a page mentions in passing are not taken for areas."""
    soup = BeautifulSoup(html or '', 'html.parser')
    tag = 'election=%dL' % year
    councils, seen = [], set()
    for ul in soup.find_all('ul'):
        areas = []
        for li in ul.find_all('li', recursive=False):
            link = li.find('a', href=True)
            if not link or tag not in link['href']:
                continue
            cons = re.search(r'cons=(\d+)', link['href'])
            if not cons or cons.group(1) in seen:
                continue
            seen.add(cons.group(1))
            seats = li.find('i')
            seat_text = seats.get_text(strip=True) if seats else ''
            areas.append({
                'name': ' '.join(link.get_text(' ', strip=True).split()),
                'cons_id': cons.group(1),
                'seats': int(seat_text) if seat_text.isdigit() else None,
            })
        if not areas:
            continue
        heading = None
        node = ul
        for _ in range(12):
            node = node.find_previous(['h6', 'b', 'strong'])
            if node is None:
                break
            text = ' '.join(node.get_text(' ', strip=True).split())
            if text and not text.endswith(':') and text != '|' and not text.isdigit():
                heading = text
                break
        councils.append({'council': council_name(heading) if heading else 'Unknown council', 'areas': areas})
    return councils


def write_json(path, data):
    # indent=2 and no trailing newline, as the harvest writes these files.
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    client = httpx.Client(headers=HEADERS, timeout=60.0, follow_redirects=True)
    scraper = load_scraper()
    body_dates = []

    for year in sorted(DATES):
        date = DATES[year]
        old_dir = os.path.join(LOCAL_DIR, str(year))
        new_dir = os.path.join(LOCAL_DIR, date)
        if os.path.isdir(old_dir) and not os.path.isdir(new_dir):
            if not args.dry_run:
                os.rename(old_dir, new_dir)
        work_dir = new_dir if os.path.isdir(new_dir) else old_dir
        if not os.path.isdir(work_dir):
            print('%d: no directory' % year)
            continue

        html, _ = fetch(client, 'https://electionsireland.org/results/local/%dlocal.cfm' % year)
        councils = parse_index(html, year)
        files_by_cons = {}
        for name in os.listdir(work_dir):
            if name.endswith('.json') and not name.startswith('_'):
                path = os.path.join(work_dir, name)
                with open(path, encoding='utf-8') as fh:
                    files_by_cons[str(json.load(fh).get('cons_id'))] = path

        slug_counts = collections.Counter(slugify(a['name']) for c in councils for a in c['areas'])
        stats = collections.Counter()
        rows, placed = [], set()
        for council in councils:
            for area in council['areas']:
                display = area['name']
                if slug_counts[slugify(area['name'])] > 1:
                    display = '%s (%s)' % (area['name'], council_short(council['council']))
                    stats['disambiguated'] += 1
                target = os.path.join(work_dir, slugify(display) + '.json')
                url = 'https://electionsireland.org/result.cfm?election=%dL&cons=%s' % (year, area['cons_id'])
                source = files_by_cons.get(area['cons_id'])
                data = None
                if source:
                    with open(source, encoding='utf-8') as fh:
                        data = json.load(fh)
                if not data or not data.get('candidates'):
                    page, _ = fetch(client, url)
                    parsed = scraper.parse_constituency(page, display) if page else None
                    if parsed and parsed.get('candidates'):
                        data = dict(data or {})
                        data.update({'candidates': parsed['candidates'], 'meta': parsed.get('meta') or data.get('meta') or {}})
                        stats['recovered from the page'] += 1
                if data is None:
                    data = {'candidates': [], 'meta': {}}
                    stats['no file and no results on the page'] += 1
                data['constituency'] = display
                data['council'] = council['council']
                data['cons_id'] = area['cons_id']
                data['year'] = year
                data['source_url'] = data.get('source_url') or url
                if area['seats']:
                    data['seats'] = area['seats']
                candidates = len(data.get('candidates') or [])
                stats['areas with results' if candidates else 'areas without results'] += 1
                if not args.dry_run:
                    write_json(target, data)
                    if source and os.path.abspath(source) != os.path.abspath(target) and source not in placed:
                        if not any(files_by_cons.get(a['cons_id']) == source and a is not area for c in councils for a in c['areas']):
                            os.remove(source)
                            stats['file renamed to its disambiguated name'] += 1
                placed.add(target)
                rows.append({'name': display, 'council': council['council'], 'cons_id': area['cons_id'],
                             'seats': area['seats'], 'candidates': candidates, 'file': os.path.basename(target)})

        orphans = [p for c, p in files_by_cons.items() if c not in {r['cons_id'] for r in rows}]
        with_results = [r for r in rows if r['candidates']]
        coverage = len(with_results) / len(rows) if rows else 0
        published = coverage >= MIN_COVERAGE
        print('%d -> %s | councils %d | areas %d | with results %d (%.0f%%) | %s | %s | orphan files %d' % (
            year, date, len(councils), len(rows), len(with_results), 100 * coverage,
            'published' if published else 'held back', dict(stats), len(orphans)))
        if not args.dry_run:
            write_json(os.path.join(work_dir, '_index.json'), rows)
        if published:
            body_dates.append({'date': date, 'constituencies': [r['name'] for r in with_results], 'totalAreas': len(rows)})

    body_dates.sort(key=lambda d: d['date'], reverse=True)
    with open(MASTER_INDEX, encoding='utf-8') as fh:
        master = json.load(fh)
    bodies = [b for b in master.get('bodies') or [] if b.get('slug') != BODY_SLUG]
    bodies.append({'name': BODY_NAME, 'slug': BODY_SLUG, 'dates': body_dates})
    print('elections_index.json: %s with %d election(s): %s' % (BODY_NAME, len(body_dates), ', '.join(d['date'] for d in body_dates)))
    if not args.dry_run:
        master['bodies'] = bodies
        with open(MASTER_INDEX, 'w', encoding='utf-8') as fh:
            json.dump(master, fh, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
