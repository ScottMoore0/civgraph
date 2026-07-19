#!/usr/bin/env python3
"""v7 — fold the v6 per-party calibration into the projection.

v5 produced the SA/DZ unity surface + demographic breakdowns at the LucidTalk
border-poll level (no house-effect correction). v6 measured LucidTalk's
per-party house effect against real elections. This applies the v6-derived
constitutional house-effect correction to the v5 surface as a uniform
logit-space level shift, preserving all of v5's geographic and demographic
structure. Reads ONLY committed v5 outputs + v6 calibration (no scratchpad deps).

Correction:
  * Party-VI signal (cleanly signed): net_unity_bias = Σ mean_error_p·prop_p =
    -0.76. mean_error = LT-actual, so LucidTalk's party VI implies a
    unity-leaning composition 0.76 pt BELOW the actual-election reality
    => correct the unity level UP by +0.76.
  * EU-referendum signal: |house effect| ~2.0 pt but DIRECTIONALLY AMBIGUOUS for
    unity (structural analogy unity=the 'leave-the-union' option => +2.0;
    demographic analogy unity-voters~Remain-voters => -2.0). Used as a symmetric
    uncertainty envelope, NOT as a point correction.
"""
import csv, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
V5 = os.path.join(HERE, "..", "v5")
V6 = json.load(open(os.path.join(HERE, "..", "v6", "party_calibration.json")))

DELTA_CENTRAL = -V6["implied_unity_bias"]["net_unity_bias_pts"]      # +0.76 (up)
ENVELOPE = abs(V6["eu_referendum"]["remain_overstatement_pts"])      # ~2.04 (± band)
DATES = ["2021-01", "2022-08", "2024-02", "2025-02"]


def logit(p): p = min(max(p / 100.0, 1e-6), 1 - 1e-6); return math.log(p / (1 - p))
def inv(x): return 100.0 / (1 + math.exp(-x))
def shift_pct(v, d): return round(inv(logit(v) + d), 1)


def main():
    os.makedirs(os.path.join(HERE, "areas"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "breakdowns"), exist_ok=True)
    v5sum = {r["date"]: r for r in json.load(open(os.path.join(V5, "summary.json")))["results"]}
    summary = []
    for date in DATES:
        v5_level = v5sum[date]["learned_level"]
        # logit shift that moves the NI level from v5_level to v5_level+DELTA_CENTRAL
        target = v5_level + DELTA_CENTRAL
        d = logit(target) - logit(v5_level)
        # --- DZ surface ---
        rows_out, uis = [], []
        with open(os.path.join(V5, "areas", f"{date}_DZ21.csv")) as fh:
            for r in csv.DictReader(fh):
                u = shift_pct(float(r["proj_unity_pct"]), d)
                uis.append(u)
                rows_out.append([r["DZ21"], r["label"], r["catholic_bg_pct"], u, "modelled"])
        with open(os.path.join(HERE, "areas", f"{date}_DZ21.csv"), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["DZ21", "label", "catholic_bg_pct", "proj_unity_pct", "provenance"])
            w.writerows(rows_out)
        uis.sort()
        n = len(uis)
        # --- demographic breakdowns ---
        bd = json.load(open(os.path.join(V5, "breakdowns", f"{date}_breakdown.json")))
        bd7 = {attr: {k: shift_pct(v, d) for k, v in cells.items()} for attr, cells in bd.items()}
        json.dump(bd7, open(os.path.join(HERE, "breakdowns", f"{date}_breakdown.json"), "w"), indent=1)
        summary.append(dict(
            date=date, v5_level=v5_level, correction=round(DELTA_CENTRAL, 2),
            v7_level=round(target, 1),
            envelope_low=round(target - ENVELOPE, 1), envelope_high=round(target + ENVELOPE, 1),
            dz_p10=uis[n // 10], dz_med=uis[n // 2], dz_p90=uis[9 * n // 10],
            maj=round(100 * sum(1 for u in uis if u > 50) / n, 1)))
    out = dict(
        method="v7 = v5 surface re-levelled by the v6-derived constitutional house-effect (uniform logit shift)",
        correction_central=round(DELTA_CENTRAL, 3),
        correction_source="v6 party-VI net_unity_bias (cleanly signed): LucidTalk understates unity-leaning party composition by 0.76pt vs actual elections",
        uncertainty_envelope=round(ENVELOPE, 2),
        uncertainty_source="v6 EU-referendum house-effect magnitude (~2.0pt, sign-ambiguous for unity) as a symmetric band",
        results=summary)
    json.dump(out, open(os.path.join(HERE, "summary.json"), "w"), indent=1)
    print(f"correction +{DELTA_CENTRAL:.2f} (± {ENVELOPE:.2f} envelope)")
    print(f"{'date':8} {'v5':>5} {'v7':>5} {'band':>13} {'DZ p10-med-p90':>16} {'maj%':>6}")
    for s in summary:
        print(f"{s['date']:8} {s['v5_level']:5.1f} {s['v7_level']:5.1f} "
              f"[{s['envelope_low']:4.1f},{s['envelope_high']:4.1f}] "
              f"{s['dz_p10']:5.1f}-{s['dz_med']:.1f}-{s['dz_p90']:.1f}  {s['maj']:5.1f}")


if __name__ == "__main__":
    main()
