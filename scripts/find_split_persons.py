#!/usr/bin/env python3
"""Find people split across two person ids, using Wikipedia biographies as the evidence.

audit_person_ids.py lists UNDER-MERGE pairs: two ids sharing a name whose careers do not
overlap. Its own header calls that a screen, not a proof, and a name-based fold once
fused 231 different people, so the pairs are never merged on the name alone. This script
looks for evidence that a pair is ONE person:

  a single Wikipedia biography of someone with this name that places them, for EACH id,
  in one of that id's constituencies (or councils) in one of that id's years -- in an
  infobox office or succession box with matching term years, or in one sentence that
  also says they stood, sat, won or lost.

Ian Paisley is the model case: 104615 holds his Stormont contests in Bannside (1969,
1970), 48601 the rest of his career; his article's infobox has both offices.

One half may instead be pinned by its body and exact year ("elected to the Northern
Ireland House of Commons in 1925"), but never both halves, and a sentence that mentions
a son, father, brother or namesake is not used. A candidacy outside the person's
lifetime (or before they were 18) rules the article out for that half.

Verdicts, for every pair:
  CONFIRMED   exactly one biography covers both halves -> person_id_confirmed_merges.csv
  AMBIGUOUS   more than one biography covers both (not merged)
  DISTINCT    different biographies cover the two halves (two people; not merged)
  ONE-SIDE    a biography covers one half only (not merged)
  UNRESOLVED  no biography covers either half (not merged)

merge_person_ids.py merges the CONFIRMED pairs (class WIKIPEDIA-BIOGRAPHY). All
verdicts go to person_split_review.csv for review.

Wikipedia responses are cached in .cache/wikipedia-persons/ (gitignored).

Usage:  python scripts/find_split_persons.py [--name "Ian Paisley" ...]
"""
import argparse, collections, csv, glob, hashlib, json, os, re, sys, time, unicodedata
import urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'render', 'metadata', 'elections-test2')
PERS = os.path.join(REPO, 'data', 'elections', 'persons')
REG = os.path.join(PERS, 'person_registry.json')
AUDIT = os.path.join(PERS, 'person_id_corrections.csv')
OUT_CONFIRMED = os.path.join(PERS, 'person_id_confirmed_merges.csv')
OUT_REVIEW = os.path.join(PERS, 'person_split_review.csv')
CACHE = os.path.join(REPO, '.cache', 'wikipedia-persons')

# ---- Wikipedia ------------------------------------------------------------------------------

UA = 'civgraph-person-dedupe/1.0 (https://civgraph.net; research)'
API = 'https://en.wikipedia.org/w/api.php'
_last = [0.0]


def api(params):
    params = dict(params, format='json', formatversion='2', maxlag='5')
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    for attempt in range(5):
        wait = 0.25 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(API + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
            data = json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(2 + attempt * 3)
            continue
        if 'error' in data and data['error'].get('code') == 'maxlag':
            time.sleep(5)
            continue
        os.makedirs(CACHE, exist_ok=True)
        json.dump(data, open(path, 'w', encoding='utf-8'))
        return data
    raise RuntimeError('Wikipedia API failed: %r' % params)


def search(q, limit=10):
    d = api({'action': 'query', 'list': 'search', 'srsearch': q, 'srlimit': limit, 'srnamespace': 0, 'srprop': ''})
    return [h['title'] for h in d.get('query', {}).get('search', [])]


def _fetch(titles):
    out = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        d = api({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'redirects': '1',
                 'titles': '|'.join(chunk)})
        q = d.get('query', {})
        m = {t: t for t in chunk}
        for n in q.get('normalized', []):
            for k, v in list(m.items()):
                if v == n['from']:
                    m[k] = n['to']
        for r in q.get('redirects', []):
            for k, v in list(m.items()):
                if v == r['from']:
                    m[k] = r['to']
        pages = {p['title']: p for p in q.get('pages', [])}
        for k, v in m.items():
            p = pages.get(v)
            if p and not p.get('missing') and p.get('revisions'):
                out[k] = (v, p['revisions'][0]['slots']['main']['content'])
    return out


def wikitext(titles):
    """{requested title: (resolved title, wikitext)}, each page cached on its own."""
    pdir = os.path.join(CACHE, 'pages')
    os.makedirs(pdir, exist_ok=True)
    out, missing = {}, []
    for t in dict.fromkeys(titles):
        p = os.path.join(pdir, hashlib.sha1(t.encode()).hexdigest() + '.json')
        if os.path.exists(p):
            v = json.load(open(p, encoding='utf-8'))
            if v:
                out[t] = tuple(v)
        else:
            missing.append(t)
    if missing:
        got = _fetch(missing)
        for t in missing:
            p = os.path.join(pdir, hashlib.sha1(t.encode()).hexdigest() + '.json')
            json.dump(list(got[t]) if t in got else None, open(p, 'w', encoding='utf-8'))
            if t in got:
                out[t] = got[t]
    return out

# ---- text ----------------------------------------------------------------------------------


def fold(s):
    s = unicodedata.normalize('NFKD', s or '')
    return ''.join(c for c in s if not unicodedata.combining(c))


def norm(s):
    s = fold(s).lower().replace('&', ' and ').replace('’', "'")
    s = re.sub(r"[^a-z0-9]+", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


DIRS = ('north', 'south', 'east', 'west', 'mid', 'central')
ABBR = {'n': 'north', 's': 'south', 'e': 'east', 'w': 'west'}
GENERIC = {'area', 'town', 'rural', 'city', 'borough', 'county', 'district', 'central', 'north', 'south', 'east', 'west', 'mid'}
# Constituency names too common in biographies to place anyone (European and Forum
# constituencies, provinces, the big cities on their own).
GENERIC_CONS = {'northern ireland', 'ireland', 'dublin', 'belfast', 'cork', 'munster', 'leinster', 'ulster', 'connacht',
                'connacht ulster', 'connaught ulster', 'south', 'east', 'north west', 'midlands north west', 'ireland south',
                'ireland east', 'ireland north west', 'dublin city', 'city of dublin'}


def con_variants(o):
    """The ways an article may name this candidacy's constituency, or its council."""
    out = set()
    if o['body'] in ('local-government', 'ireland-local'):
        council = o.get('council') or ''
        m = re.match(r'^(.*?)\s*\(([^)]+)\)\s*$', o['con'])  # ROI: "Athlone (Westmeath)"
        area = o['con']
        if m:
            council = council or m.group(2)
            area = m.group(1)
        c = norm(council)
        if c:
            for suf in ('borough council', 'district council', 'city council', 'county council', 'council',
                        'city and district council', 'urban district council', 'town council'):
                out.add(f'{c} {suf}')
        a = norm(re.sub(r'\b(Area [A-Z]|corrected)\b', '', area))
        if a and len(a.split()) >= 2 and not set(a.split()) <= GENERIC and not a.startswith('lg'):
            out.add(a)
        return out - GENERIC_CONS
    raw = o['con'].replace('*', ' ')
    c = norm(raw.split(',')[0]) if ',' in raw else norm(raw)
    if not c:
        return out
    w = c.split()
    if len(w) >= 2 and w[-1] in ABBR:
        w = w[:-1] + [ABBR[w[-1]]]
        c = ' '.join(w)
    out.add(c)
    if len(w) >= 2 and w[0] in DIRS:
        out.add(' '.join(w[1:] + w[:1]))
    if len(w) >= 2 and w[-1] in DIRS:
        out.add(' '.join(w[-1:] + w[:-1]))
    if w[0] == 'county' and len(w) >= 2:
        rest = ' '.join(w[1:])
        out |= {f'co {rest}', f'{rest} county', f'county of {rest}'}
    return out - GENERIC_CONS


def strip_refs(t):
    t = re.sub(r'<ref[^>]*/>', ' ', t)
    t = re.sub(r'<ref[^>]*>.*?</ref>', ' ', t, flags=re.S)
    return re.sub(r'<!--.*?-->', ' ', t, flags=re.S)


def delinks(t):
    return re.sub(r'\[\[([^|\]]*)\|([^\]]*)\]\]', r'\2 ; \1 ;', t).replace('[[', '').replace(']]', '')


def templates(t):
    """Spans of the top-level {{...}} blocks."""
    out, depth, start, i = [], 0, None, 0
    while i < len(t) - 1:
        if t[i:i + 2] == '{{':
            if depth == 0:
                start = i
            depth += 1
            i += 2
            continue
        if t[i:i + 2] == '}}' and depth:
            depth -= 1
            i += 2
            if depth == 0:
                out.append((start, i))
            continue
        i += 1
    return out


def offices(t):
    """[(normalized office text, (first year, last year))] from the infobox and succession boxes."""
    res = []
    for s, e in templates(t):
        block = t[s:e]
        if not re.match(r'\{\{\s*Infobox', block, re.I):
            continue
        fields = {}
        for m in re.finditer(r'\n\s*\|\s*([A-Za-z_ ]+?)(\d*)\s*=\s*(.*?)(?=\n\s*\||\n\}\}|$)', block, re.S):
            k, n, v = m.group(1).strip().lower(), m.group(2) or '1', m.group(3)
            fields.setdefault(n, {})[k] = fields.get(n, {}).get(k, '') + ' ' + v
        for n, f in fields.items():
            text = ' '.join(v for k, v in f.items()
                            if 'constituency' in k or k in ('office', 'parliament', 'assembly', 'riding', 'council', 'title'))
            ys = [int(y) for k in ('term_start', 'term_end', 'term') for y in re.findall(r'\b(1[6-9]\d\d|20\d\d)\b', f.get(k, ''))]
            if text.strip() and ys:
                res.append((norm(delinks(text)),
                            (min(ys), max(ys)) if len(ys) > 1 or 'term_end' in f else (min(ys), min(ys) + 40)))
    for s, e in templates(t):
        block = t[s:e]
        if not re.match(r'\{\{\s*s-ttl\s*\|', block, re.I):
            continue
        tt = re.search(r'title\s*=\s*(.*?)(?=\|\s*years\s*=|\}\}$)', block, re.S)
        yy = re.search(r'years\s*=\s*(.*?)(?=\||\}\}$)', block, re.S)
        if tt and yy:
            ys = [int(y) for y in re.findall(r'\b(1[6-9]\d\d|20\d\d)\b', yy.group(1))]
            if ys:
                res.append((norm(delinks(tt.group(1))), (min(ys), max(ys)) if len(ys) > 1 else (ys[0], ys[0] + 40)))
    return res


ABBREV = re.compile(r'\b(Co|St|Mr|Mrs|Dr|Rev|Lt|Col|Capt|Gen|No|Jr|Sr|Hon|Rt|Mt|Ft|Bt|[A-Z])\.')


def sentences(t):
    """Prose sentences, templates removed and links reduced to their text, normalized."""
    keep, last = [], 0
    for s, e in templates(t):
        keep.append(t[last:s])
        last = e
    keep.append(t[last:])
    prose = ABBREV.sub(lambda m: m.group(1) + '․', delinks(''.join(keep)))
    out = []
    for para in re.split(r'\n+', prose):
        for s in re.split(r'(?<=[.!?;])\s+', para):
            n = norm(s)
            if n:
                out.append(n)
    return out


def lifespan(t):
    b = re.search(r'\[\[Category:(\d{3,4}) births', t)
    d = re.search(r'\[\[Category:(\d{3,4}) deaths', t)
    return (int(b.group(1)) if b else None, int(d.group(1)) if d else None)


def is_bio(t):
    return bool(re.search(r'\[\[Category:(\d{3,4}s? births|\d{3,4} deaths|Living people|Year of birth missing|Year of death missing)', t)) \
        or bool(re.search(r'\{\{\s*Infobox (officeholder|politician|person|member|MP|state representative|peer|noble)', t, re.I))


def name_ok(name, title, text):
    nm = norm(name).split()
    if not nm:
        return False
    sur, first = nm[-1], nm[0]
    tt = norm(re.sub(r'\(.*?\)', '', title))
    lead = re.search(r"'''(.+?)'''", text)
    cand = tt + ' ' + (norm(lead.group(1)) if lead else '')
    if sur not in cand.split() and sur not in tt.replace(' ', ''):
        return False
    if len(first) == 1:
        return any(x.startswith(first) for x in cand.split())
    return first in cand.split() or (first[:3] in {x[:3] for x in cand.split()})


ELECTION = re.compile(r'\b(elect\w*|re elect\w*|stood|stand|stands|standing|contest\w*|candida\w*|won|win|wins|lost|lose|loses|'
                      r'defeat\w*|returned|by election|seat|seats|poll\w*|votes?|unseated|retain\w*|co opted|served|serving|'
                      r'member|councillor\w*|alderman|mayor|mp|mps|td|tds|mla|mlas|mep|represent\w*|sat for|sitting)\b')
RELATIVE = re.compile(r'\b(son|sons|father|brother|nephew|uncle|grandson|grandfather|cousin|namesake|not to be confused)\b')
BODY = {
    'parliament-of-northern-ireland': re.compile(r'northern ireland house of commons|house of commons of northern ireland|parliament of northern ireland|northern ireland parliament|\bstormont\b'),
    'house-of-commons-of-the-united-kingdom': re.compile(r'house of commons of the united kingdom|uk house of commons|british house of commons|\bwestminster\b|uk parliament|parliament of the united kingdom|united kingdom parliament'),
    'dail-eireann': re.compile(r'\bdail\b|\bteachta dala\b'),
    'northern-ireland-assembly': re.compile(r'northern ireland assembly'),
    'european-parliament': re.compile(r'european parliament'),
    'ireland-european': re.compile(r'european parliament'),
    'northern-ireland-constitutional-convention': re.compile(r'constitutional convention'),
    'northern-ireland-forum-for-political-dialogue': re.compile(r'northern ireland forum'),
}
SUCCESSOR = re.compile(r'\b(jn?r|jun|junior|sn?r|sen|senior|[IVX]{2,})\b', re.I)

_articles = {}


def article(title, txt):
    if title not in _articles:
        t = strip_refs(txt)
        _articles[title] = {'bio': is_bio(txt), 'life': lifespan(txt), 'offices': offices(t), 'sentences': sentences(t)}
    return _articles[title]


def cover(art, side):
    """Evidence that this article's subject is the person behind these candidacies, or ''."""
    years = sorted({o['y'] for o in side})
    born, died = art['life']
    if born and min(years) < born + 18:
        return ''
    if died and max(years) > died:
        return ''
    cands = {(len(v), v, o['y']) for o in side for v in con_variants(o)}
    for _, v, y in sorted(cands, reverse=True):
        pat = re.compile(r'\b' + re.escape(v) + r'\b')
        for text, (lo, hi) in art['offices']:
            if pat.search(text) and lo - 1 <= y <= hi + 1:
                return f'infobox: {y} {v}'
        for s in art['sentences']:
            if pat.search(s) and any(re.search(r'\b%d\b' % yy, s) for yy in (y, y + 1, y - 1)) \
                    and ELECTION.search(pat.sub(' ', s)) and not RELATIVE.search(s):
                return f'text: {y} {v}'
    for o in sorted(side, key=lambda o: o['y']):
        bp = BODY.get(o['body'])
        if not bp:
            continue
        for s in art['sentences']:
            if bp.search(s) and re.search(r'\b%d\b' % o['y'], s) and ELECTION.search(s) and not RELATIVE.search(s):
                return f'body: {o["y"]} {o["body"]}'
    return ''


def best_con(side):
    c = collections.Counter()
    for o in side:
        vs = sorted(con_variants(o), key=len, reverse=True)
        if vs:
            c[vs[0]] += 1
    return c.most_common(1)[0][0] if c else ''


def judge(name, oa, ob):
    rec = {'verdict': 'UNRESOLVED', 'article': '', 'evidence_a': '', 'evidence_b': ''}
    if not oa or not ob:
        rec['verdict'] = 'NO-CANDIDACIES'
        return rec
    if SUCCESSOR.search(name):
        rec['verdict'] = 'SUFFIX'
        return rec
    qn = re.sub(r'\s+', ' ', name).strip()
    ca, cb = best_con(oa), best_con(ob)
    titles = search(f'"{qn}"' + (f' "{ca}"' if ca else '') + (f' "{cb}"' if cb and cb != ca else ''), 5)
    if ca:
        titles += search(f'"{qn}" "{ca}"', 5)
    if cb and cb != ca:
        titles += search(f'"{qn}" "{cb}"', 5)
    titles += search(f'"{qn}"', 10)
    titles = list(dict.fromkeys(titles))
    # only an article whose title carries the surname can be this person's biography
    sur = norm(name).split()[-1] if norm(name) else ''
    titles = [t for t in titles if sur and (sur in norm(t).split() or sur in norm(t).replace(' ', ''))]
    pages = wikitext(titles)
    seen, found = set(), []
    for t in titles:
        if t not in pages:
            continue
        rt, txt = pages[t]
        if rt in seen:
            continue
        seen.add(rt)
        art = article(rt, txt)
        if not art['bio'] or not name_ok(name, rt, txt):
            continue
        found.append((rt, cover(art, oa), cover(art, ob)))
    both = [f for f in found if f[1] and f[2] and not (f[1].startswith('body') and f[2].startswith('body'))]
    if len(both) == 1:
        rec.update(verdict='CONFIRMED', article=both[0][0], evidence_a=both[0][1], evidence_b=both[0][2])
    elif len(both) > 1:
        rec.update(verdict='AMBIGUOUS', article=' | '.join(f[0] for f in both))
    else:
        only_a = [f[0] for f in found if f[1] and not f[2]]
        only_b = [f[0] for f in found if f[2] and not f[1]]
        if only_a and only_b and set(only_a).isdisjoint(only_b):
            rec.update(verdict='DISTINCT', article=' | '.join(only_a) + ' / ' + ' | '.join(only_b))
        elif only_a or only_b:
            rec.update(verdict='ONE-SIDE', article=' | '.join(only_a + only_b),
                       evidence_a='covered' if only_a else '', evidence_b='covered' if only_b else '')
    return rec

# ---- data ----------------------------------------------------------------------------------


def stable_keys(e):
    """What identifies this entity's rows whatever its personId becomes after a registry
    rebuild: the source's person ids and candidacy ids, or for rows with neither (most
    1918-1922 Dail rows), the name they are keyed by. merge_person_ids.py finds the pair
    again by these."""
    keys = sorted(set(e.get('sourcePersonIds') or []) | set(e.get('sourceIds') or []))
    if e.get('keyedBy') == 'name' or not keys:
        keys += [f'name:{m}' for m in e.get('matchKeys') or []]
    return ' ; '.join(keys)


def load(want):
    obs = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        body = d.get('bodySlug') or ''
        date = str(d.get('date') or '')
        for r in d.get('results') or []:
            con = str(r.get('constituency') or '').strip()
            for c in (r.get('candidates') or []):
                pid = c.get('personId')
                if pid in want:
                    obs[pid].append({'body': body, 'con': con, 'y': int(date[:4]) if date[:4].isdigit() else 0,
                                     'council': r.get('localBody') or (d.get('localBodyByConstituency') or {}).get(con) or ''})
    return obs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', action='append', help='only pairs with this name (repeatable); writes nothing')
    args = ap.parse_args()
    reg = json.load(open(REG, encoding='utf-8'))
    ents = {e['personId']: e for e in reg['entities']}
    pairs = []
    with open(AUDIT, encoding='utf-8', newline='') as fh:
        for r in csv.DictReader(fh):
            if r['kind'] == 'UNDER-MERGE':
                a, b = (int(x) for x in r['personId'].split('+'))
                if a in ents and b in ents and (not args.name or ents[a]['displayName'] in args.name):
                    pairs.append((a, b))
    obs = load({p for ab in pairs for p in ab})
    rows = []
    for i, (a, b) in enumerate(pairs):
        rec = judge(ents[a]['displayName'], obs.get(a, []), obs.get(b, []))
        keep, drop = (a, b) if a < b else (b, a)
        ek, ed = (rec['evidence_a'], rec['evidence_b']) if keep == a else (rec['evidence_b'], rec['evidence_a'])
        rows.append({'keep': keep, 'drop': drop, 'name': ents[keep]['displayName'],
                     'keep_years': f"{ents[keep]['firstYear']}-{ents[keep]['lastYear']}",
                     'drop_years': f"{ents[drop]['firstYear']}-{ents[drop]['lastYear']}",
                     'verdict': rec['verdict'], 'article': rec['article'], 'evidence_keep': ek, 'evidence_drop': ed,
                     'keep_keys': stable_keys(ents[keep]), 'drop_keys': stable_keys(ents[drop])})
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(pairs)}', flush=True)
    print(dict(collections.Counter(r['verdict'] for r in rows)))
    if args.name:
        for r in rows:
            print(r)
        return
    fields = list(rows[0].keys())
    with open(OUT_REVIEW, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: (r['verdict'], r['name'], r['keep'])))
    conf = [r for r in rows if r['verdict'] == 'CONFIRMED']
    # Pairs confirmed on an earlier run are merged by now, so the audit no longer lists
    # them; they stay in the file, which is how merge_person_ids.py re-finds them after a
    # registry rebuild.
    if os.path.exists(OUT_CONFIRMED):
        have = {(r['keep_keys'], r['drop_keys']) for r in conf}
        with open(OUT_CONFIRMED, encoding='utf-8', newline='') as fh:
            conf += [r for r in csv.DictReader(fh) if (r.get('keep_keys'), r.get('drop_keys')) not in have]
    with open(OUT_CONFIRMED, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['keep', 'drop', 'name', 'keep_years', 'drop_years', 'article',
                                           'evidence_keep', 'evidence_drop', 'keep_keys', 'drop_keys'])
        w.writeheader()
        for r in sorted(conf, key=lambda r: (r['name'], r['keep'])):
            w.writerow({k: r[k] for k in w.fieldnames})
    print(f'wrote {OUT_REVIEW} ({len(rows)} pairs)\nwrote {OUT_CONFIRMED} ({len(conf)} confirmed)')
    print('NEXT: python scripts/merge_person_ids.py && python scripts/apply_person_ids_v2.py (repeat until nothing to merge)')


if __name__ == '__main__':
    sys.exit(main())
