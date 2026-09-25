#!/usr/bin/env python3
"""Draw a random sample from a Walker harvest and crop each figure for checking by eye.

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> \
      python scripts/walker/spot_check.py electorates --n 20 --out <dir>

The harvests of pre-1918 electorates, 1802-1880 results and constituency histories have no
second source to check them against, so the only measure of their accuracy is to look at the
printed page. This picks records with a fixed seed -- so the sample is reproducible and not
chosen to flatter -- finds each figure on its page, and writes contact sheets of the printed
row beside what was harvested. A reviewer marks each one right or wrong.

Output is a set of PNGs and a JSON manifest of what each crop claims. The crops are private
review material and are written OUTSIDE the repository: they are images of a book in copyright.
"""
import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import page_image, WALKER_DIR  # noqa: E402

import pytesseract
from PIL import Image, ImageDraw, ImageOps

VOLUME = 'walker-ireland-1801-1922.pdf'
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def load(kind):
    if kind == 'electorates':
        d = json.load(open(os.path.join(ROOT, 'data/elections/corrections/walker-pre1918-electorates.json'), encoding='utf-8'))
        return [{'page': r['page'], 'value': r['electorate'],
                 'claim': f"{r['date'][:10]} {r['constituency']}: {r['electorate']:,} electors"}
                for r in d['records']]
    if kind == 'pre1885':
        d = json.load(open(os.path.join(ROOT, 'data/elections/walker-pre1885-results.json'), encoding='utf-8'))
        out = []
        for r in d['records']:
            c = next((c for c in r['candidates'] if c.get('votes')), None)
            if not c:
                continue
            out.append({'page': r['page'], 'value': c['votes'], 'inherited': r['headConfidence'] != 'read from this page',
                        'claim': f"{r['year']} {r['kind']} {r['constituency']}: {c['name']} {c['party']} {c['votes']}"})
        return out
    if kind == 'byelections':
        d = json.load(open(os.path.join(ROOT, 'data/elections/walker-byelections-1885-1922.json'), encoding='utf-8'))
        out = []
        for r in d['records']:
            c = next((c for c in r['candidates'] if c.get('votes')), None)
            value = c['votes'] if c else r.get('electorate')
            if not value:
                continue
            who = f"{c['name']} {c['party']} {c['votes']}" if c else f"unopposed {r['candidates'][0]['name']}, electorate {r['electorate']}"
            out.append({'page': r['page'], 'value': value,
                        'claim': f"{r['year']} {r['date']} {r['constituency']}: {who}"})
        return out
    if kind == 'histories':
        d = json.load(open(os.path.join(ROOT, 'data/elections/walker-constituency-histories.json'), encoding='utf-8'))
        out = []
        for r in d['records']:
            for m in r['members']:
                if m.get('votes'):
                    out.append({'page': r['pages'][0], 'value': m['votes'],
                                'claim': f"{r['constituency']} {m.get('year') or ''}: {m['text'][:40]} {m['votes']}"})
        return out
    raise SystemExit(f'unknown kind {kind}')


def locate(im, value):
    """Where the value is printed: both '1,234' and '1234' forms are tried."""
    targets = {f'{value:,}', str(value)}
    d = pytesseract.image_to_data(im, config='--oem 1 --psm 6 -l eng', output_type=pytesseract.Output.DICT)
    for i, t in enumerate(d['text']):
        if t.replace('.', ',').strip(' |') in targets:
            return d['left'][i], d['top'][i], d['width'][i], d['height'][i]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['electorates', 'pre1885', 'histories', 'byelections'])
    ap.add_argument('--n', type=int, default=20)
    ap.add_argument('--seed', type=int, default=20260925)
    ap.add_argument('--prefer-inherited', action='store_true')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    pdf = os.path.join(WALKER_DIR, VOLUME)
    pool = load(args.kind)
    rnd = random.Random(args.seed)
    if args.prefer_inherited:
        inh = [p for p in pool if p.get('inherited')]
        rest = [p for p in pool if not p.get('inherited')]
        sample = rnd.sample(inh, min(len(inh), args.n // 2)) + rnd.sample(rest, args.n - min(len(inh), args.n // 2))
    else:
        sample = rnd.sample(pool, min(args.n, len(pool)))
    strips, manifest = [], []
    for k, s in enumerate(sample, 1):
        im = page_image(pdf, s['page']).convert('L')
        box = locate(im, s['value'])
        if not box:
            manifest.append({**s, 'n': k, 'located': False})
            continue
        x, y, w, h = box
        crop = im.crop((0, max(0, y - int(h * 1.2)), im.width, min(im.height, y + h + int(h * 1.2))))
        crop = ImageOps.autocontrast(crop.resize((1500, int(1500 * crop.height / crop.width))), cutoff=1).convert('RGB')
        canvas = Image.new('RGB', (crop.width, crop.height + 26), 'white')
        canvas.paste(crop, (0, 26))
        ImageDraw.Draw(canvas).text((6, 6), f"#{k}  harvested: {s['claim']}", fill=(200, 0, 0))
        strips.append(canvas)
        manifest.append({**s, 'n': k, 'located': True})
    for sheet_i in range(0, len(strips), 8):
        group = strips[sheet_i:sheet_i + 8]
        H = sum(g.height + 8 for g in group)
        sheet = Image.new('RGB', (1500, H), (230, 230, 230))
        yy = 0
        for g in group:
            sheet.paste(g, (0, yy))
            yy += g.height + 8
        sheet.save(os.path.join(args.out, f'{args.kind}-{sheet_i // 8 + 1}.png'))
    json.dump(manifest, open(os.path.join(args.out, f'{args.kind}-manifest.json'), 'w'), indent=1)
    print(f'{args.kind}: {len(sample)} sampled, {sum(m["located"] for m in manifest)} located, '
          f'{(len(strips) + 7) // 8} sheet(s) in {args.out}')


if __name__ == '__main__':
    main()
