#!/usr/bin/env python3
"""v9 phase 61 — render the phase-60 Assembly projection as a results-style map.

Inputs: assembly2026_projection.csv (phase 60) and the OSNI 2023 parliamentary
constituency boundaries (PC2023.fgb, already published as layer `pc-2023`). The 18
PC_NAME values match the projection's index exactly, so the join needs no alias table.

DESIGN NOTE, and it is deliberate. The reference graphic is a RESULTS map, where every
number is fact. This is a PROJECTION with the same visual grammar, and that grammar
signals certainty the model does not have -- per-constituency seat error in the
forward-only holdout is 0.89-1.89 seats. Two things are therefore drawn differently:

  * the FIFTH seat in each constituency (the last elected, i.e. the one that flips) is
    drawn with a dashed outline rather than solid;
  * the header says PROJECTION and carries the poll and date it rests on.

Blocs come from alignment_label (data/elections/alignment/alignment_rules.json): a party
is unionist if labelled `unionist`, nationalist if labelled `nationalist`, otherwise
Other. That puts Aontú with the nationalists and Alliance/Green/PBP in Other, which is
the registry's own logic rather than a fresh judgement call.

Output: assembly2026_map.svg and .png
"""
import os, sys, json, math
import numpy as np
import pandas as pd
import geopandas as gpd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Wedge, Rectangle, FancyBboxPatch
from matplotlib.collections import PatchCollection

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PROJ = os.path.join(HERE, 'assembly2026_projection.csv')
FGB = os.path.join(os.environ.get('CLAUDE_JOB_DIR', HERE), 'tmp', 'PC2023.fgb')
IG = 29902                      # Irish Grid, so shapes are not stretched

PARTIES = ['Sinn Féin', 'DUP', 'UUP', 'SDLP', 'Alliance', 'TUV', 'Green',
           'Aontú', 'PBP', 'Independent', 'Other']
COL = {'Sinn Féin': '#326760', 'DUP': '#d46a4c', 'Alliance': '#f6cb2f',
       'UUP': '#48a5ee', 'SDLP': '#2aa82c', 'TUV': '#0c3a6a', 'PBP': '#ff0090',
       'Green': '#22ac6f', 'Aontú': '#44532a', 'Independent': '#b8b8b8',
       'Other': '#8a8a8a'}
BLOC = {'Unionist': ['DUP', 'UUP', 'TUV'],
        'Nationalist': ['Sinn Féin', 'SDLP', 'Aontú'],
        'Other': ['Alliance', 'Green', 'PBP', 'Independent', 'Other']}
BLOC_COL = {'Unionist': '#48a5ee', 'Nationalist': '#2aa82c', 'Other': '#f6cb2f'}
BELFAST = ['BELFAST EAST', 'BELFAST NORTH', 'BELFAST SOUTH AND MID DOWN', 'BELFAST WEST']
BG, FG, MUTED = '#000000', '#ffffff', '#9aa0a6'


def _ink(hexcol):
    """Black or white label, whichever the bar colour can carry."""
    r, gg, b = (int(hexcol[i:i+2], 16) / 255 for i in (1, 3, 5))
    lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b
    return '#10221f' if lum > 0.55 else '#ffffff'


def seat_offsets(r):
    """Five seat markers: three above, two below, as in the reference graphic."""
    dx, dy = r * 2.25, r * 2.0
    return [(-dx, dy / 2), (0, dy / 2), (dx, dy / 2), (-dx / 2, -dy / 2), (dx / 2, -dy / 2)]


def visual_centre(geom):
    """Pole of inaccessibility where available, else a representative point. A centroid
    would place Foyle's and Strangford's markers outside their own boundary."""
    try:
        from shapely import ops
        biggest = max(geom.geoms, key=lambda g: g.area) if geom.geom_type == 'MultiPolygon' else geom
        return ops.polylabel(biggest, tolerance=200)
    except Exception:
        return geom.representative_point()


def draw_map(ax, g, df, r, skip_markers=()):
    for _, row in g.iterrows():
        name = row['PC_NAME']
        d = df.loc[name]
        lead = max(PARTIES, key=lambda p: d.get(f'pct_{p}', 0))
        geom = row.geometry
        polys = geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]
        for poly in polys:
            xs, ys = poly.exterior.xy
            ax.fill(xs, ys, facecolor=COL[lead], edgecolor='#ffffff', linewidth=0.8,
                    alpha=0.85, zorder=1)
    for _, row in g.iterrows():
        name = row['PC_NAME']
        if name in skip_markers:
            continue      # drawn in the Belfast inset instead; at city scale the four
                          # Belfast seats' markers collide on the NI-wide map
        d = df.loc[name]
        pt = visual_centre(row.geometry)
        won = []
        for p in PARTIES:
            won += [p] * int(d.get(f'seats_{p}', 0))
        for i, (ox, oy) in enumerate(seat_offsets(r)):
            if i >= len(won):
                break
            last = (i == len(won) - 1)
            ax.add_patch(Circle((pt.x + ox, pt.y + oy), r, facecolor=COL[won[i]],
                                edgecolor='#0d1b1a' if not last else '#ffffff',
                                linewidth=1.0 if not last else 1.4,
                                linestyle='solid' if not last else (0, (2, 1.6)),
                                zorder=3))


def main():
    df = pd.read_csv(PROJ, index_col=0)
    g = gpd.read_file(FGB).to_crs(epsg=IG)
    g['PC_NAME'] = g['PC_NAME'].astype(str).str.upper().str.strip()
    missing = set(df.index) ^ set(g['PC_NAME'])
    if missing:
        sys.exit(f'name mismatch: {missing}')

    tv = df.valid_poll.sum()
    share = {p: 100 * df[f'fp_{p}'].sum() / tv for p in PARTIES}
    seats = {p: int(df[f'seats_{p}'].sum()) for p in PARTIES}
    order = [p for p in sorted(PARTIES, key=lambda p: -seats[p]) if seats[p] or share[p] > 0.4]

    fig = plt.figure(figsize=(16, 10), dpi=110)
    fig.patch.set_facecolor(BG)

    # ---------------- map ----------------
    ax = fig.add_axes([0.24, 0.02, 0.60, 0.96]); ax.set_facecolor(BG); ax.axis('off')
    draw_map(ax, g, df, r=3300, skip_markers=set(BELFAST))
    ax.set_aspect('equal')
    ax.autoscale_view()

    # ---------------- Belfast inset ----------------
    axb = fig.add_axes([0.775, 0.63, 0.215, 0.33]); axb.set_facecolor(BG); axb.axis('off')
    gb = g[g['PC_NAME'].isin(BELFAST)]
    draw_map(axb, gb, df, r=1500)
    axb.set_aspect('equal')
    minx, miny, maxx, maxy = gb.total_bounds
    # Belfast South and Mid Down runs far south under the 2023 review, so the inset is
    # clipped to the city rather than to that constituency's full extent.
    axb.set_xlim(minx - 1500, maxx + 1500)
    axb.set_ylim(maxy - (maxx - minx) * 1.05, maxy + 2500)
    axb.set_title('Belfast', color=FG, fontsize=10, pad=2)

    # ---------------- left panel ----------------
    y = 0.955
    fig.text(0.015, y, 'NI ASSEMBLY — PROJECTION', color=FG, fontsize=15, weight='bold')
    y -= 0.030
    fig.text(0.015, y, '3 August 2026 · 2023 boundaries', color=MUTED, fontsize=9)
    y -= 0.020
    fig.text(0.015, y, 'LucidTalk Summer 2026 poll, house-effect corrected',
             color=MUTED, fontsize=8)
    y -= 0.040
    mx = max(share.values())
    for p in order:
        fig.patches.append(Rectangle((0.015, y - 0.004), 0.098 * share[p] / mx, 0.019,
                                     transform=fig.transFigure, facecolor=COL[p],
                                     edgecolor='none'))
        fig.text(0.020, y + 0.001, p, color=_ink(COL[p]), fontsize=8.5, weight='bold')
        fig.text(0.163, y + 0.001, f'{share[p]:.2f}%', color=COL[p], fontsize=8.5,
                 weight='bold', ha='right')
        fig.text(0.205, y + 0.001, f'{seats[p]}', color=COL[p], fontsize=9.5,
                 weight='bold', ha='right')
        y -= 0.027

    y -= 0.020
    for b, ps in BLOC.items():
        bs = sum(seats[p] for p in ps); bv = sum(share[p] for p in ps)
        fig.patches.append(Rectangle((0.015, y - 0.004), 0.098 * bv / 100 * 1.9, 0.021,
                                     transform=fig.transFigure,
                                     facecolor=BLOC_COL[b], edgecolor='none', alpha=0.85))
        fig.text(0.020, y + 0.002, b, color=_ink(BLOC_COL[b]), fontsize=8.5, weight='bold')
        fig.text(0.163, y + 0.002, f'{bv:.2f}%', color=FG, fontsize=8.5, ha='right')
        fig.text(0.205, y + 0.002, f'{bs}', color=FG, fontsize=9.5, weight='bold', ha='right')
        y -= 0.030

    # ---------------- donut (vote share) ----------------
    axd = fig.add_axes([0.055, 0.30, 0.13, 0.16]); axd.set_facecolor(BG); axd.axis('off')
    axd.pie([share[p] for p in order], colors=[COL[p] for p in order],
            startangle=90, counterclock=False,
            wedgeprops=dict(width=0.42, edgecolor=BG, linewidth=0.8))
    axd.set_title('vote share', color=MUTED, fontsize=8, pad=0)

    # ---------------- hemicycle (90 seats) ----------------
    axh = fig.add_axes([0.02, 0.03, 0.20, 0.24]); axh.set_facecolor(BG); axh.axis('off')
    seq = []
    for p in ['Sinn Féin', 'SDLP', 'Aontú', 'Green', 'PBP', 'Alliance', 'Independent',
              'Other', 'UUP', 'DUP', 'TUV']:
        seq += [p] * seats.get(p, 0)
    rows, per = [16, 20, 24, 30], []
    rings = [(0.55, 16), (0.70, 20), (0.85, 24), (1.00, 30)]
    i = 0
    for rad, n in rings:
        for k in range(n):
            if i >= len(seq):
                break
            th = math.pi * (k + 0.5) / n
            axh.add_patch(Circle((rad * math.cos(th), rad * math.sin(th)), 0.035,
                                 facecolor=COL[seq[i]], edgecolor=BG, linewidth=0.5))
            i += 1
    axh.set_xlim(-1.12, 1.12); axh.set_ylim(-0.06, 1.12); axh.set_aspect('equal')
    axh.set_title(f'{sum(seats.values())} seats', color=MUTED, fontsize=8, pad=0)

    fig.text(0.985, 0.015,
             'Projection, not a result. Per-constituency seat error 0.89–1.89 (forward-only holdout).\n'
             'Dashed marker = last seat elected in that constituency, the one most likely to flip.',
             color=MUTED, fontsize=7.5, ha='right', va='bottom')

    for ext in ('svg', 'png'):
        p = os.path.join(HERE, f'assembly2026_map.{ext}')
        fig.savefig(p, facecolor=BG, bbox_inches='tight')
        print('wrote', p)
    print(f'\n  seats: ' + '  '.join(f'{p} {seats[p]}' for p in order))
    for b, ps in BLOC.items():
        print(f'  {b:12} {sum(share[p] for p in ps):5.2f}%  {sum(seats[p] for p in ps):3} seats')


if __name__ == '__main__':
    main()
