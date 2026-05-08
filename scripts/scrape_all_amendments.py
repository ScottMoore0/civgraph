"""Bulk-run the Wikipedia amendment scraper across every individual
amendment that went to referendum, write extracted per-constituency
results to _tmp_ref/wiki_samples/<date>-<slug>.json, plus an index of
which events succeeded/failed.

Pairs each amendment with the existing project referendum-event folder
(election-viewer-package/data/elections/ireland-referendum/<date>-<slug>/)
so the next step can integrate per-constituency JSONs there.
"""
from pathlib import Path
import json, time
import sys
sys.path.insert(0, 'scripts')
from scrape_wiki_referendums import scrape_amendment, slugify

# Each tuple is (Wikipedia URL slug, ISO date, project folder slug, topic label).
# project folder slug should match an existing folder under
# election-viewer-package/data/elections/ireland-referendum/<date>-<slug>/.
AMENDMENTS = [
    ('Third_Amendment_of_the_Constitution_of_Ireland',     '1972-05-10', 'accession-to-the-european-communities', '3rd Amendment — EEC accession'),
    ('Fourth_Amendment_of_the_Constitution_of_Ireland',    '1972-12-07', 'voting-age',                            '4th Amendment — Voting age 18'),
    ('Fifth_Amendment_of_the_Constitution_of_Ireland',     '1972-12-07', 'recognition-of-specified-religions',    '5th Amendment — Religion'),
    ('Sixth_Amendment_of_the_Constitution_of_Ireland',     '1979-07-05', 'adoption',                              '6th Amendment — Adoption'),
    ('Seventh_Amendment_of_the_Constitution_of_Ireland',   '1979-07-05', 'university-representation-in-seanad',   '7th Amendment — University Senate'),
    ('Eighth_Amendment_of_the_Constitution_of_Ireland',    '1983-09-07', 'right-to-life-of-the-unborn',           '8th Amendment — Right to Life'),
    ('Ninth_Amendment_of_the_Constitution_of_Ireland',     '1984-06-14', 'extension-of-voting-right-at-dail-elections', '9th Amendment — Non-citizen votes'),
    ('Tenth_Amendment_of_the_Constitution_of_Ireland',     '1987-05-26', 'ratification-of-the-single-european-act', '10th Amendment — Single European Act'),
    ('Eleventh_Amendment_of_the_Constitution_of_Ireland',  '1992-06-18', 'european-union',                        '11th Amendment — Maastricht'),
    # 12th 1992 (right to information on abortion) failed; was withdrawn pre-vote in some sources.
    ('Thirteenth_Amendment_of_the_Constitution_of_Ireland','1992-11-25', 'travel',                                '13th Amendment — Travel'),
    ('Fourteenth_Amendment_of_the_Constitution_of_Ireland','1992-11-25', 'information',                           '14th Amendment — Information'),
    ('Fifteenth_Amendment_of_the_Constitution_of_Ireland', '1995-11-24', 'dissolution-of-marriage',               '15th Amendment — Divorce'),
    ('Sixteenth_Amendment_of_the_Constitution_of_Ireland', '1996-11-28', 'bail',                                  '16th Amendment — Bail'),
    ('Seventeenth_Amendment_of_the_Constitution_of_Ireland','1997-10-30','cabinet-confidentiality',               '17th Amendment — Cabinet'),
    ('Eighteenth_Amendment_of_the_Constitution_of_Ireland', '1998-05-22','treaty-of-amsterdam',                   '18th Amendment — Amsterdam Treaty'),
    ('Nineteenth_Amendment_of_the_Constitution_of_Ireland', '1998-05-22','northern-ireland',                      '19th Amendment — Good Friday Agreement'),
    ('Twentieth_Amendment_of_the_Constitution_of_Ireland',  '1999-06-10','recognition-for-local-government',     '20th Amendment — Local Government'),
    # 21st (Death penalty) and 23rd (ICC) were both held 7 June 2001 but the
    # project currently has no event folder for them — skip until added.
    # ('Twenty-first_Amendment_of_the_Constitution_of_Ireland','2001-06-07','death-penalty', '21st Amendment — Death penalty'),
    # ('Twenty-third_Amendment_of_the_Constitution_of_Ireland','2001-06-07','international-criminal-court', '23rd Amendment — ICC'),
    ('Twenty-sixth_Amendment_of_the_Constitution_of_Ireland','2002-10-19','treaty-of-nice-ii',                    '26th Amendment — Nice II'),
    ('Twenty-seventh_Amendment_of_the_Constitution_of_Ireland','2004-06-11','irish-citizenship',                  '27th Amendment — Citizenship'),
    ('Twenty-eighth_Amendment_of_the_Constitution_of_Ireland','2009-10-02','treaty-of-lisbon-ii',                 '28th Amendment — Lisbon II'),
    ('Twenty-ninth_Amendment_of_the_Constitution_of_Ireland','2011-10-27','judges-remuneration',                  '29th Amendment — Judges pay'),
    ('Thirtieth_Amendment_of_the_Constitution_of_Ireland',  '2012-05-31','fiscal-treaty',                         '30th Amendment — Fiscal Treaty'),
    ('Thirty-first_Amendment_of_the_Constitution_of_Ireland','2012-11-10','children',                             '31st Amendment — Children'),
    ('Thirty-third_Amendment_of_the_Constitution_of_Ireland','2013-10-04','court-of-appeal',                      '33rd Amendment — Court of Appeal'),
    ('Thirty-fourth_Amendment_of_the_Constitution_of_Ireland','2015-05-22','equal-marriage',                      '34th Amendment — Marriage equality'),
    ('Thirty-sixth_Amendment_of_the_Constitution_of_Ireland', '2018-05-25','regulation-of-termination-of-pregnancy-repeal-of-8th-amendment','36th Amendment — Repeal of 8th'),
    ('Thirty-seventh_Amendment_of_the_Constitution_of_Ireland','2018-10-26','repeal-of-blasphemy-offence',        '37th Amendment — Blasphemy'),
    ('Thirty-eighth_Amendment_of_the_Constitution_of_Ireland', '2019-05-24','regulation-of-divorce',              '38th Amendment — Divorce'),
    # 39th + 40th Amendments (Family + Care, March 2024) — both rejected.
    # 39th has its own article; 40th's per-constituency table only lives on
    # the combined 2024_Irish_constitutional_referendums overview page, so
    # we point at that page and disambiguate by caption.
    ('Thirty-ninth_Amendment_of_the_Constitution_of_Ireland', '2024-03-08','the-family',                          '39th Amendment — Family (rejected)'),
    ('2024_Irish_constitutional_referendums',                 '2024-03-08','care',                                '40th Amendment — Care (rejected)',
        'Fortieth Amendment (Care)'),
]

OUT_DIR = Path('_tmp_ref/wiki_samples')
OUT_DIR.mkdir(parents=True, exist_ok=True)

def main():
    summary = []
    for entry in AMENDMENTS:
        if len(entry) == 5:
            slug, date, project_slug, topic, caption_match = entry
        else:
            slug, date, project_slug, topic = entry
            caption_match = None
        url = f'https://en.wikipedia.org/wiki/{slug}'
        print(f'\n=== {topic} ({date}) ===')
        print(f'  {url}')
        try:
            result = scrape_amendment(url, caption_match=caption_match)
        except Exception as e:
            print(f'  ! {e}')
            summary.append({'date': date, 'project_slug': project_slug, 'url': url,
                            'topic': topic, 'status': 'fetch_error', 'error': str(e)[:120]})
            continue
        if 'error' in result:
            print(f'  ! {result["error"]}')
            summary.append({'date': date, 'project_slug': project_slug, 'url': url,
                            'topic': topic, 'status': 'no_table'})
            continue
        n_rows = len(result['rows'])
        print(f'  basis={result["basis"]}  rows={n_rows}')
        out = {
            'date': date, 'project_slug': project_slug, 'topic': topic,
            'wikipedia_url': url, 'basis': result['basis'],
            'headers': result['headers'], 'norm_headers': result['norm_headers'],
            'rows': result['rows'],
        }
        out_path = OUT_DIR / f'{date}-{project_slug}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        summary.append({'date': date, 'project_slug': project_slug, 'url': url,
                        'topic': topic, 'status': 'ok', 'rows': n_rows,
                        'basis': result['basis']})
        time.sleep(1)
    with open(OUT_DIR / '_summary.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    ok = sum(1 for s in summary if s['status'] == 'ok')
    fail = len(summary) - ok
    print(f'\n=== {ok} OK / {fail} failed ===')
    for s in summary:
        if s['status'] != 'ok':
            print(f'  ! {s["date"]} {s["topic"]}: {s["status"]}')


if __name__ == '__main__':
    main()
