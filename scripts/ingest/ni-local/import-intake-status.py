"""Copy what the grouped pre-1973 Northern Ireland local elections need from the council intake.

  python scripts/ingest/ni-local/import-intake-status.py --intake <intake folder>   (or CIVGRAPH_NI_INTAKE)

The intake (calendar, authorities, the review's exclusion list and the per-round work files) lives
outside the repository and changes while rounds are transcribed. The site never reads it: this
script writes data/elections/ni-local/round-status.json, a small committed snapshot that
scripts/build/build-ni-local-grouped.mjs reads, so the build is reproducible from a clean checkout.

For every calendar row (authority, round) it keeps: the poll date, whether the calendar says the
round was held (held / not-held / unknown), the round's own status where it was transcribed
(done, partial, held, no-election), the areas whose contest was held back (`held_contests`),
the number of areas expected, and the review's reason if the round is excluded from the repo.
Free-text notes and citations are not copied.
"""
import argparse, csv, glob, json, os, re, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, 'data', 'elections', 'ni-local', 'round-status.json')


def calendar_held(status, kind):
    s = (status or '').strip().lower()
    if s.startswith('held'):
        return 'held'
    if s.startswith('not held') or s.startswith('no-election') or s.startswith('no election'):
        return 'not-held'
    if not s and (kind or '').lower().startswith('not held'):
        return 'not-held'
    return 'unknown'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--intake', default=os.environ.get('CIVGRAPH_NI_INTAKE', ''))
    args = ap.parse_args()
    intake = args.intake
    if not intake:
        sys.exit('give the council intake folder: --intake <folder> or CIVGRAPH_NI_INTAKE')
    cal_path = os.path.join(intake, 'phase-a2', 'calendar.csv')
    auth_path = os.path.join(intake, 'calendar', 'authorities.csv')
    excl_path = os.path.join(intake, 'phase-b', 'apply-exclude.json')
    work_dir = os.path.join(intake, 'phase-b', 'work')
    for p in (cal_path, auth_path, excl_path, work_dir):
        if not os.path.exists(p):
            sys.exit(f'missing intake input: {p}')

    authorities = {}
    for row in csv.DictReader(open(auth_path, encoding='utf-8')):
        authorities[row['slug']] = {'county': row['county'].strip(), 'type': row['type'].strip()}

    excluded = {}
    for item in json.load(open(excl_path, encoding='utf-8')).get('rounds', []):
        excluded[(item['slug'], item['folder'])] = str(item.get('reason') or 'held back in review')[:200]

    work = {}
    for path in glob.glob(os.path.join(work_dir, '*', '*.json')):
        slug = os.path.basename(os.path.dirname(path))
        folder = os.path.splitext(os.path.basename(path))[0]
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', folder):
            continue
        data = json.load(open(path, encoding='utf-8'))
        held = [str(h.get('area') or '').strip() for h in (data.get('held_contests') or []) if h.get('area')]
        expected = data.get('expected_areas_full', data.get('expected_areas'))
        work[(slug, folder)] = {
            'status': data.get('status') or 'done',
            'heldAreas': held,
            'contests': len(data.get('contests') or []),
            'expectedAreas': expected if isinstance(expected, int) else None,
        }

    rounds = []
    seen = set()
    for row in csv.DictReader(open(cal_path, encoding='utf-8')):
        slug = row['authority_slug'].strip()
        folder = row['round_date'].strip()
        key = (slug, folder)
        seen.add(key)
        poll = (row.get('poll_date') or '').strip() or folder
        entry = {
            'slug': slug,
            'round': folder,
            'pollDate': poll if re.match(r'^\d{4}-\d{2}-\d{2}$', poll) else folder,
            'calendar': calendar_held(row.get('status'), row.get('kind')),
            'kind': (row.get('kind') or '').strip()[:80],
        }
        w = work.get(key)
        if w:
            entry['work'] = w['status']
            if w['heldAreas']:
                entry['heldAreas'] = w['heldAreas']
            if w['expectedAreas']:
                entry['expectedAreas'] = w['expectedAreas']
        if key in excluded:
            entry['excluded'] = excluded[key]
        rounds.append(entry)
    # A work file filed under its poll date where the calendar has the statutory date: the same
    # authority in the same year is the same round.
    by_year = {}
    for entry in rounds:
        by_year.setdefault((entry['slug'], entry['round'][:4]), []).append(entry)
    # Work files with no calendar row (a round found in the papers but not on the calendar).
    for (slug, folder), w in sorted(work.items()):
        if (slug, folder) in seen:
            continue
        same_year = [e for e in by_year.get((slug, folder[:4]), []) if 'work' not in e]
        if len(same_year) == 1:
            entry = same_year[0]
            entry['workRound'] = folder
            entry['work'] = w['status']
            if w['heldAreas']:
                entry['heldAreas'] = w['heldAreas']
            if w['expectedAreas']:
                entry['expectedAreas'] = w['expectedAreas']
            if (slug, folder) in excluded:
                entry['excluded'] = excluded[(slug, folder)]
            continue
        entry = {'slug': slug, 'round': folder, 'pollDate': folder, 'calendar': 'unknown', 'kind': '', 'work': w['status']}
        if w['heldAreas']:
            entry['heldAreas'] = w['heldAreas']
        if (slug, folder) in excluded:
            entry['excluded'] = excluded[(slug, folder)]
        rounds.append(entry)
    rounds.sort(key=lambda r: (r['round'], r['slug']))

    out = {
        'schemaVersion': 1,
        'about': 'Snapshot of the NI council intake (calendar, authorities, exclusions, round status) for the grouped pre-1973 local elections. Written by scripts/ingest/ni-local/import-intake-status.py; the site never reads the intake itself.',
        'importedAt': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'authorities': dict(sorted(authorities.items())),
        'rounds': rounds,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(rounds)} rounds, {len(authorities)} authorities, {len(excluded)} excluded, {len(work)} work files')


if __name__ == '__main__':
    main()
