#!/usr/bin/env python3
"""v9 phase 35 — schema-consistency sweep over the election metadata.

Motivated by four defects of the same class in this workstream, three of which
produced plausible-but-wrong output silently:

  * Occurred_On_Count -- per-count in Assembly files, a CONSTANT in local-government
    files. Half the transfer data went unattributed and the matrix was trained on
    Assembly contests alone while being used to project local seats.
  * cp1252 vs UTF-8 in 6_ -- script unrunnable.
  * cp1252 vs UTF-8 in 8_ -- "Sinn Fein"/"Aontu" keys silently missed, a FALSE
    -20.45pt poll house effect reported, and the polls written off as unusable.
  * "Non-transferable" as a pseudo-candidate row in local files only.

The common shape: a field that exists in both formats but MEANS something different,
or exists in one and not the other. Nothing errors; the numbers just come out wrong.

This profiles the NI contests and flags:
  A. fields present in one contest type but not the other
  B. fields that VARY per count in one type and are CONSTANT in the other
  C. pseudo-candidate rows (party names that are not parties)
  D. file encodings that are not UTF-8
"""
import os, json, collections
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

GROUPS = {
    'assembly': ['northern-ireland-assembly__2016-05-05.json',
                 'northern-ireland-assembly__2017-03-02.json',
                 'northern-ireland-assembly__2022-05-05.json'],
    'local': ['local-government-local-government-districts__2014-05-22.json',
              'local-government-local-government-districts__2019-05-02.json',
              'local-government-local-government-districts__2023-05-18.json'],
    'westminster': ['house-of-commons-of-the-united-kingdom__2015-05-07.json',
                    'house-of-commons-of-the-united-kingdom__2017-06-08.json',
                    'house-of-commons-of-the-united-kingdom__2019-12-12.json',
                    'house-of-commons-of-the-united-kingdom__2024-07-04.json'],
}
KNOWN_NONPARTY = {'non-transferable', 'nontransferable', 'total', 'spoilt', 'spoiled'}


def profile(files):
    cand_fields, count_fields = collections.Counter(), collections.Counter()
    varying, constant = collections.Counter(), collections.Counter()
    pseudo = collections.Counter()
    n_areas = 0
    for fn in files:
        p = os.path.join(META, fn)
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        for r in d['results']:
            n_areas += 1
            for c in r.get('candidates') or []:
                for k in c:
                    cand_fields[k] += 1
            cg = (r.get('animationPayload') or {}).get('Constituency', {}).get('countGroup') or []
            if not cg:
                continue
            for x in cg:
                for k in x:
                    count_fields[k] += 1
                pn = (x.get('Party_Name') or '').strip()
                if pn.lower() in KNOWN_NONPARTY:
                    pseudo[pn] += 1
            # does each field vary WITHIN a candidate across counts?
            by_cand = collections.defaultdict(list)
            for x in cg:
                by_cand[str(x.get('Candidate_Id'))].append(x)
            for k in count_fields:
                nv = 0
                for cid, xs in by_cand.items():
                    vals = {str(x.get(k)) for x in xs}
                    if len(vals) > 1:
                        nv += 1
                if nv:
                    varying[k] += 1
                else:
                    constant[k] += 1
    return {'areas': n_areas, 'cand': cand_fields, 'count': count_fields,
            'varying': varying, 'constant': constant, 'pseudo': pseudo}


def main():
    print("SCHEMA-CONSISTENCY SWEEP\n" + "=" * 72)
    prof = {g: profile(f) for g, f in GROUPS.items()}
    for g, p in prof.items():
        print(f"  {g:12} areas={p['areas']:4}  candidate fields={len(p['cand']):2}  "
              f"countGroup fields={len(p['count']):2}")

    print("\nA. FIELDS PRESENT IN ONE CONTEST TYPE BUT NOT ANOTHER")
    allc = set().union(*[set(p['cand']) for p in prof.values()])
    for k in sorted(allc):
        where = [g for g, p in prof.items() if k in p['cand']]
        if len(where) < len(prof):
            print(f"  candidate.{k:26} only in: {', '.join(where)}")
    allg = set().union(*[set(p['count']) for p in prof.values()])
    for k in sorted(allg):
        where = [g for g, p in prof.items() if k in p['count']]
        if len(where) < len([g for g in prof if prof[g]['count']]):
            print(f"  countGroup.{k:26} only in: {', '.join(where)}")

    print("\nB. FIELDS THAT VARY PER COUNT IN ONE TYPE BUT ARE CONSTANT IN ANOTHER")
    print("   (this is the Occurred_On_Count failure mode)")
    flagged = False
    for k in sorted(allg):
        status = {}
        for g, p in prof.items():
            if not p['count'] or k not in p['count']:
                continue
            v, c = p['varying'].get(k, 0), p['constant'].get(k, 0)
            status[g] = 'varies' if v > c else 'CONSTANT'
        if len(set(status.values())) > 1:
            flagged = True
            print(f"  {k:28} " + "  ".join(f"{g}={s}" for g, s in status.items()))
    if not flagged:
        print("   (none)")

    print("\nC. PSEUDO-CANDIDATE ROWS (party names that are not parties)")
    any_p = False
    for g, p in prof.items():
        for name, n in p['pseudo'].items():
            any_p = True
            print(f"  {g:12} '{name}' x{n}")
    if not any_p:
        print("   (none)")

    print("\nD. FILE ENCODINGS")
    import glob
    bad = []
    for f in sorted(glob.glob(os.path.join(HERE, '*.json'))
                    + glob.glob(os.path.join(HERE, '..', 'v3', '*.json'))
                    + glob.glob(os.path.join(HERE, '..', 'v6', '*.json'))):
        b = open(f, 'rb').read()
        try:
            b.decode('utf-8')
        except UnicodeDecodeError:
            bad.append((os.path.relpath(f, HERE), 'NOT utf-8'))
    if bad:
        for f, why in bad:
            print(f"  {f:52} {why}")
        print("  -> these must be read with an explicit non-UTF-8 encoding, or")
        print("     normalised to UTF-8. Adding encoding='utf-8' to a reader would BREAK them.")
    else:
        print("   all analysis JSON decodes as UTF-8")


if __name__ == '__main__':
    main()
