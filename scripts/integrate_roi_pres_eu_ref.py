"""
Wire Presidential, European (Ireland), and Referendum (Ireland) into the live viewer.

What this does:
  1. Presidential:
     - Rename year-only dirs to ISO dates (1990 -> 1990-11-07, etc.)
     - Rename national.json -> ireland.json (the engine fetches by slugified constituency name)
     - Add "President of Ireland" body to elections_index.json
       with constituencies: ["Ireland"] for each date.

  2. European (Ireland):
     - Rename year-only dirs to ISO dates (skip empty 1973+1977 by-elections)
     - Drop northern-ireland.json from each ROI dir (NI EP is a separate body)
     - Build an aggregated ireland.json per year: sums all ROI EU per-constituency
       first prefs by party so the engine can render a single-fill country map.
     - Add "European Parliament (Ireland)" body with constituencies: ["Ireland"].

  3. Referendum (Ireland):
     - Convert each topic file to a synthesized 2-candidate (Yes / No) shape so the
       count animation + winner colouring work.
     - Master index: each (date, topic) pair becomes one entry. Each "date" in the
       index gets the date's referendum topics as its constituencies list, but for
       the engine we pre-write one ireland.json per topic at /referendum/{date}-{slug}/ireland.json.
       Simpler: keep the existing /{date}/{topic-slug}.json layout and write a parallel
       ireland.json next to each topic file. The master index lists each (date, topic)
       as a separate "date" entry with a unique compound date string so the catalogue
       differentiates them.

Idempotent. Safe to re-run.
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA = os.path.join(ROOT, 'election-viewer-package', 'data', 'elections')
PRES = os.path.join(DATA, 'ireland-president')
EUR = os.path.join(DATA, 'ireland-european')
REF = os.path.join(DATA, 'ireland-referendum')
MASTER = os.path.join(ROOT, 'election-viewer-package', 'data', 'elections_index.json')


PRES_YEAR_TO_ISO = {
    '1938': '1938-05-04',
    '1945': '1945-06-16',
    '1952': '1952-04-25',
    '1959': '1959-06-17',
    '1966': '1966-06-01',
    '1973': '1973-05-30',
    '1974': '1974-12-03',
    '1976': '1976-12-09',
    '1983': '1983-12-03',
    '1990': '1990-11-07',
    '1997': '1997-10-30',
    '2004': '2004-10-21',
    '2011': '2011-10-27',
    '2018': '2018-10-26',
}

EUR_YEAR_TO_ISO = {
    '1979': '1979-06-07',
    '1984': '1984-06-14',
    '1989': '1989-06-15',
    '1994': '1994-06-09',
    '1999': '1999-06-11',
    '2004': '2004-06-11',
    '2009': '2009-06-05',
    '2014': '2014-05-23',
    '2019': '2019-05-24',
    '2024': '2024-06-07',
    # 1973/1977 skipped: empty data (pre-direct-election delegate replacements)
}

ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def slugify(s):
    s = s.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'\s+', '-', s)
    s = re.sub(r'-+', '-', s)
    return s


def rename_dirs(base, year_to_iso):
    for old, new in year_to_iso.items():
        op = os.path.join(base, old)
        np = os.path.join(base, new)
        if os.path.isdir(np):
            continue
        if not os.path.isdir(op):
            continue
        os.rename(op, np)
        print(f'  renamed {os.path.basename(base)}/{old} -> {new}')


def write_country_payload(out_path, source_payload, *, label):
    """Write a payload at out_path that the engine will treat as a single-constituency
    Ireland-wide result. Just rename + light fixup."""
    payload = dict(source_payload)
    payload['constituency'] = 'Ireland'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def integrate_pres():
    print('Presidential:')
    rename_dirs(PRES, PRES_YEAR_TO_ISO)
    dates_out = []
    for date_dir in sorted(os.listdir(PRES)):
        if not ISO_RE.match(date_dir):
            continue
        d = os.path.join(PRES, date_dir)
        nat = os.path.join(d, 'national.json')
        irl = os.path.join(d, 'ireland.json')
        if os.path.exists(nat) and not os.path.exists(irl):
            with open(nat, encoding='utf-8') as f:
                payload = json.load(f)
            write_country_payload(irl, payload, label='Ireland')
            os.remove(nat)
            print(f'  {date_dir}: national.json -> ireland.json')
        dates_out.append({'date': date_dir, 'constituencies': ['Ireland']})
    dates_out.sort(key=lambda d: d['date'], reverse=True)
    return {'name': 'President of Ireland', 'slug': 'ireland-president', 'dates': dates_out}


def integrate_eur():
    print('European (Ireland):')
    rename_dirs(EUR, EUR_YEAR_TO_ISO)
    # Remove empty pre-direct-election dirs entirely.
    for old in ('1973', '1977'):
        p = os.path.join(EUR, old)
        if os.path.isdir(p):
            for f in os.listdir(p):
                os.remove(os.path.join(p, f))
            os.rmdir(p)
            print(f'  removed empty {old}')

    dates_out = []
    for date_dir in sorted(os.listdir(EUR)):
        if not ISO_RE.match(date_dir):
            continue
        d = os.path.join(EUR, date_dir)
        # Drop NI EP file (NI is a separate body)
        ni = os.path.join(d, 'northern-ireland.json')
        if os.path.exists(ni):
            os.remove(ni)
            print(f'  {date_dir}: removed northern-ireland.json (NI EP is a separate body)')
        # Drop the previously synthesized aggregate (we now use per-constituency MEP FGBs).
        agg = os.path.join(d, 'ireland.json')
        if os.path.exists(agg):
            os.remove(agg)
            print(f'  {date_dir}: removed aggregated ireland.json (now uses per-constituency MEP FGBs)')
        # List per-constituency files: their `constituency` field is the display name.
        cons_names = []
        for cf in sorted(f for f in os.listdir(d) if f.endswith('.json') and f != '_index.json'):
            with open(os.path.join(d, cf), encoding='utf-8') as f:
                p = json.load(f)
            name = p.get('constituency') or cf[:-5].replace('-', ' ').title()
            cons_names.append(name)
        dates_out.append({'date': date_dir, 'constituencies': cons_names})
    dates_out.sort(key=lambda d: d['date'], reverse=True)
    return {'name': 'European Parliament (Ireland)', 'slug': 'ireland-european', 'dates': dates_out}


def integrate_ref():
    """Each (date, topic) pair becomes a separate dated entry. To keep the URL shape
    consistent with other bodies, we model each as date=ISO + constituency='Ireland'
    and write the synthesized payload into a date subdirectory keyed by topic slug.
    """
    print('Referendum (Ireland):')
    dates_out = []
    for date_dir in sorted(os.listdir(REF)):
        full = os.path.join(REF, date_dir)
        if not os.path.isdir(full):
            continue
        if not ISO_RE.match(date_dir):
            continue
        topic_files = [f for f in os.listdir(full) if f.endswith('.json') and f != '_index.json']
        for tf in topic_files:
            topic_slug = tf[:-5]
            if topic_slug == 'ireland':
                # already synthesised
                continue
            with open(os.path.join(full, tf), encoding='utf-8') as f:
                payload = json.load(f)
            topic = payload.get('topic') or topic_slug.replace('-', ' ').title()
            nat = payload.get('national') or {}
            yes_pct = nat.get('yes_pct')
            no_pct = nat.get('no_pct')
            yes_votes = nat.get('yes_votes')
            no_votes = nat.get('no_votes')
            outcome = (payload.get('outcome') or '').lower()
            # Build a 2-candidate (Yes, No) synthesized record. The engine will
            # render the higher percentage as the winner and colour the country.
            yes_candidate = {
                'name': 'Yes',
                'party': 'Yes',
                'first_pref': yes_votes or 0,
                'final_count': 1,
                'counts': [yes_votes or 0, (yes_pct or 0) / 100.0, 1, 1 if outcome == 'passed' else 2],
                'status': 'Made Quota' if outcome == 'passed' else 'Not Elected',
            }
            no_candidate = {
                'name': 'No',
                'party': 'No',
                'first_pref': no_votes or 0,
                'final_count': 2,
                'counts': [no_votes or 0, (no_pct or 0) / 100.0, 1, 2 if outcome == 'passed' else 1],
                'status': 'Not Elected' if outcome == 'passed' else 'Made Quota',
            }
            ref_id = payload.get('ref_id') or topic_slug
            sub_date = f'{date_dir}-{topic_slug}'
            sub_dir = os.path.join(REF, sub_date)
            os.makedirs(sub_dir, exist_ok=True)
            ireland_path = os.path.join(sub_dir, 'ireland.json')
            irish = {
                'body': 'Referendum (Ireland)',
                'constituency': 'Ireland',
                'meta': {'electorate': nat.get('electorate')},
                'topic': topic,
                'outcome': outcome,
                'yes_pct': yes_pct,
                'no_pct': no_pct,
                'ref_id': ref_id,
                'candidates': [yes_candidate, no_candidate],
            }
            with open(ireland_path, 'w', encoding='utf-8') as f:
                json.dump(irish, f, indent=2, ensure_ascii=False)
            dates_out.append({'date': sub_date, 'displayDate': date_dir, 'topic': topic, 'constituencies': ['Ireland']})
    dates_out.sort(key=lambda d: d['date'], reverse=True)
    return {'name': 'Referendum (Ireland)', 'slug': 'ireland-referendum', 'dates': dates_out}


def merge_into_master(*body_entries):
    master = json.load(open(MASTER, encoding='utf-8'))
    bodies = master.get('bodies', [])
    incoming_names = {b['name'] for b in body_entries}
    bodies = [b for b in bodies if b.get('name') not in incoming_names]
    bodies.extend(body_entries)
    master['bodies'] = bodies
    json.dump(master, open(MASTER, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f'  master index now has {len(bodies)} bodies')


def main():
    pres = integrate_pres()
    eur = integrate_eur()
    ref = integrate_ref()
    print(f'Presidential: {len(pres["dates"])} dates')
    print(f'European (Ireland): {len(eur["dates"])} dates')
    print(f'Referendum (Ireland): {len(ref["dates"])} entries')
    merge_into_master(pres, eur, ref)
    print('done')


if __name__ == '__main__':
    main()
