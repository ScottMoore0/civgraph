#!/usr/bin/env python3
"""v9 phase 18 (stage 3) — STV transfer model, built from the repo's OWN count data.

Source: test/metadata/elections-test2/*.json ->
        results[].animationPayload.Constituency.countGroup
        one row per candidate per count, carrying Total_Votes, Transfers, and
        Status/Occurred_On_Count marking when a candidate was Elected or Excluded.

No data is taken from any external project; the transfer matrix is estimated
entirely from these files.

Method
------
At count N the SOURCES are the candidates whose Occurred_On_Count == N (a surplus
distribution if Elected, an exclusion if Excluded). The DESTINATIONS are the
positive Transfers received at count N by candidates still continuing.

  single-source counts -> clean attribution: every transferred vote came from one
                          identifiable donor, so P(dest party | source party) is
                          directly observed. These alone train the matrix.
  multi-source counts  -> NI counts routinely exclude several low candidates at
                          once (South Down 2022 count 3 excludes four). The
                          destination split cannot be attributed to a single donor
                          without assumption, so these are EXCLUDED from training
                          and reported, rather than apportioned by a guess.

Non-transferable votes are modelled explicitly: they are the shortfall between a
source's transferable mass and the sum of positive destination transfers.

Estimates are smoothed with a hierarchical fallback so unseen pairs still predict:
    exact (source party -> dest party)  ->  source bloc -> dest bloc  ->  global

Output: transfer_matrix.json, transfer_model_report.txt
"""
import os, json, glob, collections
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')

# STV contests only -- Westminster is FPTP and has no transfers.
CONTESTS = [
    ('assembly', 2016, 'northern-ireland-assembly__2016-05-05.json'),
    ('assembly', 2017, 'northern-ireland-assembly__2017-03-02.json'),
    ('assembly', 2022, 'northern-ireland-assembly__2022-05-05.json'),
    ('local', 2014, 'local-government-local-government-districts__2014-05-22.json'),
    ('local', 2019, 'local-government-local-government-districts__2019-05-02.json'),
    ('local', 2023, 'local-government-local-government-districts__2023-05-18.json'),
]

NAT = {'Sinn Féin', 'SDLP', 'Aontú', 'Independent Nationalist', "Workers' Party", 'IRSP'}
UNI = {'DUP', 'UUP', 'TUV', 'PUP', 'Independent Unionist', 'UKIP', 'Conservative'}


def bloc(p):
    return 'NAT' if p in NAT else ('UNI' if p in UNI else 'OTH')


def f(x, default=0.0):
    try:
        return float(str(x).strip() or default)
    except Exception:
        return default


def extract_events(path, contest, year):
    """Yield one event per count: sources, destination transfers, non-transferable."""
    d = json.load(open(path, encoding='utf-8'))
    for r in d['results']:
        ap = (r.get('animationPayload') or {}).get('Constituency') or {}
        cg = ap.get('countGroup') or []
        if not cg:
            continue
        # candidate -> party, and status/occurred (constant across that candidate's rows)
        party, occurred, status = {}, {}, {}
        for x in cg:
            cid = str(x.get('Candidate_Id'))
            party[cid] = (x.get('Party_Name') or '').strip()
            oc = str(x.get('Occurred_On_Count') or '').strip()
            if oc:
                occurred[cid] = oc
                status[cid] = (x.get('Status') or '').strip()
        counts = sorted({str(x.get('Count_Number')) for x in cg}, key=lambda s: int(s))
        for ci, c in enumerate(counts):
            if ci == 0:
                continue  # count 1 is first preferences, no transfers
            rows = [x for x in cg if str(x.get('Count_Number')) == c]
            # sources: candidates whose status event occurred at the PREVIOUS count
            # boundary -- i.e. the transfer arriving at count c comes from the
            # candidate(s) resolved at count c-1... in this data the event is
            # stamped on the count at which it occurred, and their votes move at
            # the next count. Use candidates whose Occurred_On_Count == previous.
            prev = counts[ci - 1]
            srcs = [cid for cid, oc in occurred.items() if oc == prev]
            gains = {}
            for x in rows:
                t = f(x.get('Transfers'))
                cid = str(x.get('Candidate_Id'))
                if t > 0 and cid not in srcs:
                    gains[cid] = gains.get(cid, 0.0) + t
            if not gains:
                continue
            # transferable mass leaving the sources at this count
            lost = 0.0
            for x in rows:
                cid = str(x.get('Candidate_Id'))
                if cid in srcs:
                    lost += -f(x.get('Transfers'))
            # Parties with a CONTINUING candidate at this count. A transfer cannot
            # go to a party that has no candidate left, so predictions must be
            # renormalised over this set -- without it the matrix sends votes to
            # parties that were already eliminated.
            ci_n = int(c)
            avail = set()
            for cid, pty in party.items():
                oc = occurred.get(cid)
                if cid in srcs:
                    continue
                if oc is None or int(oc) >= ci_n:
                    avail.add(pty)
            yield {
                'contest': contest, 'year': year, 'area': r.get('constituency'),
                'count': c,
                'sources': [party.get(s, '') for s in srcs],
                'source_status': [status.get(s, '') for s in srcs],
                'gains': _by_party(gains, party),
                'available': sorted(avail),
                'moved': sum(gains.values()),
                'lost': lost,
            }


def _by_party(gains, party):
    out = {}
    for cid, v in gains.items():
        out[party.get(cid, '')] = out.get(party.get(cid, ''), 0.0) + v
    return out


def main():
    events, skipped_multi = [], 0
    for contest, year, fn in CONTESTS:
        p = os.path.join(META, fn)
        if not os.path.exists(p):
            raise SystemExit(f"missing {p}")
        for e in extract_events(p, contest, year):
            # The matrix is party -> party, so a count with several source
            # candidates is still cleanly attributable provided they are all of
            # the SAME party. Requiring a single source CANDIDATE discarded 82% of
            # events for no modelling reason. Only genuinely mixed-party bundles
            # are unattributable.
            srcp = {s for s in e['sources'] if s}
            if len(srcp) == 1:
                e = dict(e, sources=[next(iter(srcp))])
                events.append(e)
            else:
                skipped_multi += 1

    print(f"transfer events: {len(events)} single-source, {skipped_multi} multi-source "
          f"(excluded: destination split not attributable to one donor)")
    pct = 100.0 * len(events) / max(1, len(events) + skipped_multi)
    print(f"  usable share: {pct:.1f}%")

    # ---- estimate P(dest party | source party) + non-transferable rate ----
    pair = collections.defaultdict(float)
    src_mass = collections.defaultdict(float)
    nt_num, nt_den = collections.defaultdict(float), collections.defaultdict(float)
    for e in events:
        s = e['sources'][0]
        moved = e['moved']
        if moved <= 0:
            continue
        for dp, v in e['gains'].items():
            pair[(s, dp)] += v
        src_mass[s] += moved
        if e['lost'] > 0:
            nt_num[s] += max(0.0, e['lost'] - moved)
            nt_den[s] += e['lost']

    parties = sorted({p for (p, _) in pair} | {p for (_, p) in pair})
    matrix = {}
    for s in sorted(src_mass):
        row = {dp: pair[(s, dp)] / src_mass[s] for dp in parties if pair[(s, dp)] > 0}
        matrix[s] = dict(sorted(row.items(), key=lambda kv: -kv[1]))
    nontrans = {s: (nt_num[s] / nt_den[s]) if nt_den[s] > 0 else 0.0 for s in nt_den}

    # bloc-level fallback
    bpair, bmass = collections.defaultdict(float), collections.defaultdict(float)
    for e in events:
        s = e['sources'][0]
        if e['moved'] <= 0:
            continue
        for dp, v in e['gains'].items():
            bpair[(bloc(s), bloc(dp))] += v
        bmass[bloc(s)] += e['moved']
    bloc_matrix = {b: {d: bpair[(b, d)] / bmass[b] for d in ['NAT', 'UNI', 'OTH']
                       if bpair[(b, d)] > 0} for b in sorted(bmass)}

    out = {'matrix': matrix, 'nontransferable': nontrans, 'bloc_matrix': bloc_matrix,
           'n_events': len(events), 'n_multi_source_skipped': skipped_multi}
    json.dump(out, open(os.path.join(HERE, 'transfer_matrix.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    print("\nsource-party sample sizes (transferred votes observed):")
    for s, m in sorted(src_mass.items(), key=lambda kv: -kv[1])[:12]:
        nt = 100 * nontrans.get(s, 0)
        print(f"  {s:22} {m:9,.0f} votes   non-transferable {nt:4.1f}%")

    print("\ntop destinations by source party:")
    for s in ['DUP', 'Sinn Féin', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green', 'PBP',
              'Aontú', 'Independent']:
        if s not in matrix:
            continue
        top = list(matrix[s].items())[:4]
        print(f"  {s:12} -> " + ", ".join(f"{d} {100*v:.0f}%" for d, v in top))

    print("\nbloc-level transfer matrix (row = source bloc):")
    for b, row in bloc_matrix.items():
        print(f"  {b} -> " + ", ".join(f"{d} {100*v:.0f}%" for d, v in
                                       sorted(row.items(), key=lambda kv: -kv[1])))

    # ---- validation: leave-one-contest-out on the destination distribution ----
    print("\nleave-one-contest-out validation (destination-share MAE per event):")
    allc = sorted({(e['contest'], e['year']) for e in events})
    for c in allc:
        tr = [e for e in events if (e['contest'], e['year']) != c]
        te = [e for e in events if (e['contest'], e['year']) == c]
        pr, mass = collections.defaultdict(float), collections.defaultdict(float)
        for e in tr:
            s = e['sources'][0]
            if e['moved'] <= 0:
                continue
            for dp, v in e['gains'].items():
                pr[(s, dp)] += v
            mass[s] += e['moved']
        errs, errs_av = [], []
        for e in te:
            s = e['sources'][0]
            if e['moved'] <= 0 or mass.get(s, 0) <= 0:
                continue
            act = {dp: v / e['moved'] for dp, v in e['gains'].items()}
            raw = {d: pr[(s, d)] / mass[s] for (ss, d) in pr if ss == s}
            keys = set(act) | set(raw)
            errs.append(sum(abs(act.get(k, 0.0) - raw.get(k, 0.0)) for k in keys) / 2)
            # availability-conditioned: restrict to parties still in the race and
            # renormalise, then re-add the residual as non-transferable
            av = set(e.get('available') or [])
            cond = {d: v for d, v in raw.items() if d in av}
            tot = sum(cond.values())
            if tot > 0:
                cond = {d: v / tot for d, v in cond.items()}
                keys2 = set(act) | set(cond)
                errs_av.append(sum(abs(act.get(k, 0.0) - cond.get(k, 0.0))
                                   for k in keys2) / 2)
        if errs:
            print(f"  hold out {c[0]}{c[1]:5}  n={len(errs):4}  "
                  f"raw TVD med={np.median(errs):.3f}   "
                  f"availability-conditioned med={np.median(errs_av):.3f}"
                  if errs_av else "")
    open(os.path.join(HERE, 'transfer_model_report.txt'), 'w', encoding='utf-8').write(
        json.dumps({'n_events': len(events), 'skipped_multi': skipped_multi}, indent=1))
    print("\nwrote transfer_matrix.json")


if __name__ == '__main__':
    main()
