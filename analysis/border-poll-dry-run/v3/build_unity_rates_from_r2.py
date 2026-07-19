#!/usr/bin/env python3
"""Build the LucidTalk Irish-unity (border-poll) rate series LIVE from the
persisted LucidTalk corpus on R2 (data.civgraph.net/data/polling/lucidtalk/
cleaned/), replacing the hand-cached v3/lucidtalk_unity_rates.json snapshot.

For each poll date it reads the corpus poll CSV, locates the border-poll
voting-intention question (identified robustly by its response set containing
both "United Ireland" and "United Kingdom"), and computes:
  - decided : NI decided United-Ireland share = UI / (UI + UK) * 100
  - rate_C  : same, among respondents of Catholic community background
  - rate_P  : same, among Protestant community background
  - rate_O  : same, among Other + No Religion pooled (community-background 'Other/None')

Usage:  python3 build_unity_rates_from_r2.py [--write]
  (default: print + verify against committed snapshot; --write updates
   unity_rates.json in this directory.)
"""
import csv, io, gzip, json, ssl, urllib.request, argparse, os

BASE = "https://data.civgraph.net/data/polling/lucidtalk/cleaned"

# Honour an outbound HTTPS proxy + custom CA bundle if the environment sets them
# (e.g. the agent sandbox). In a normal environment these are unset and urllib
# talks to data.civgraph.net directly.
_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
_ca = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
_ctx = ssl.create_default_context(cafile=_ca) if _ca and os.path.exists(_ca) else None
_opener = urllib.request.build_opener(
    *( [urllib.request.ProxyHandler({"https": _proxy, "http": _proxy})] if _proxy else [] ),
    urllib.request.HTTPSHandler(context=_ctx) if _ctx else urllib.request.HTTPSHandler(),
)
# poll date -> corpus CSV basename (spreadsheet-melted crosstab polls)
DATES = {
    "2016-09": "2016-09__LTSeptTrackerPollResults-MainReport",
    "2021-01": "2021-01-spreadsheet",
    "2021-05": "2021-05-spreadsheet",
    "2022-08": "2022-08-spreadsheet",
    "2024-02": "2024-02-spreadsheet",
    "2025-02": "2025-02-spreadsheet",
}
HERE = os.path.dirname(os.path.abspath(__file__))


def fetch(name):
    url = f"{BASE}/{name}.csv.gz"
    try:
        with _opener.open(url, timeout=60) as resp:
            raw = resp.read()
    except Exception:
        # Fallback: curl, which picks up proxy + CA bundle from the environment
        import subprocess
        raw = subprocess.run(["curl", "-fsSL", url], capture_output=True, check=True).stdout
    return list(csv.DictReader(io.StringIO(gzip.decompress(raw).decode("utf-8"))))


def is_ui(s): return "united ireland" in s.lower()
def is_uk(s): return "united kingdom" in s.lower()


def border_measure(rows):
    """Return (measure, style) for the border-poll voting-intention question.

    style 'uiuk'         -> responses are 'United Ireland' / 'United Kingdom'.
    style 'leaveremain'  -> older reports phrase it as LEAVE (=United Ireland) /
                            REMAIN (=stay in the UK). Only accepted for measures
                            whose NAME contains 'BORDER POLL' AND that have no
                            UI/UK response, so EU/Brexit Leave/Remain questions
                            can never be mistaken for the border poll.
    """
    from collections import defaultdict
    resp = defaultdict(set)
    for x in rows:
        resp[x["Measure"]].add(x["Response"])
    uiuk = [m for m, rs in resp.items()
            if any(is_ui(s) for s in rs) and any(is_uk(s) for s in rs)]
    if uiuk:
        return sorted(uiuk, key=len)[0], "uiuk"
    lr = [m for m, rs in resp.items()
          if "border poll" in m.lower()
          and any(s.strip().upper() == "LEAVE" for s in rs)
          and any(s.strip().upper() == "REMAIN" for s in rs)
          and not any(is_ui(s) or is_uk(s) for s in rs)]
    if lr:
        return sorted(lr, key=len)[0], "leaveremain"
    return None, None


def _match_ui(resp, style):
    return is_ui(resp) if style == "uiuk" else resp.strip().upper() == "LEAVE"


def _match_uk(resp, style):
    return is_uk(resp) if style == "uiuk" else resp.strip().upper() == "REMAIN"


def _pct(rows, measure, cat, style):
    """Weighted UI% and UK% for one breakdown cell (cat=None -> Total, else a
    Religion category). Uses the published weighted percentages, not raw counts."""
    ui = uk = None
    for x in rows:
        if x["Measure"] != measure or x["Statistic"] != "percent":
            continue
        if cat is None:
            if x["Breakdown Dimension"] != "Total":
                continue
        elif x["Breakdown Dimension"] != "Religion" or x["Breakdown Category"] != cat:
            continue
        if _match_ui(x["Response"], style):
            ui = float(x["Value"])
        elif _match_uk(x["Response"], style):
            uk = float(x["Value"])
    return ui, uk


def _base_n(rows, measure, cat):
    n = 0.0
    for x in rows:
        if (x["Measure"] == measure and x["Statistic"] == "count"
                and x["Breakdown Dimension"] == "Religion" and x["Breakdown Category"] == cat):
            n += float(x["Value"] or 0)
    return n


def _decided(ui, uk):
    return round(100 * ui / (ui + uk), 1) if (ui and uk) else None


def _religion_cats(rows, measure):
    return sorted({x["Breakdown Category"] for x in rows
                   if x["Measure"] == measure and x["Breakdown Dimension"] == "Religion"})


def rate(rows, measure, style, cats=None):
    """Decided United-Ireland share. cats=None -> Total; one category -> that
    community; an iterable -> base-weighted pool of those categories."""
    if cats is None:
        return _decided(*_pct(rows, measure, None, style))
    cats = list(cats)
    if len(cats) == 1:
        return _decided(*_pct(rows, measure, cats[0], style))
    num = den = 0.0
    for cat in cats:
        ui, uk = _pct(rows, measure, cat, style)
        n = _base_n(rows, measure, cat)
        if ui and uk:
            num += n * ui
            den += n * (ui + uk)
    return round(100 * num / den, 1) if den else None


def _is_catholic(cat): return "catholic" in cat.lower()       # 'Catholic', 'Roman Catholic'
def _is_protestant(cat): return "protestant" in cat.lower()


def community_rates(rows, measure, style):
    """Decided-UI share for the three census community-background buckets, by
    predicate on the Religion category labels (robust to 'Roman Catholic' etc.).
    'Other/None' = every category that is neither Catholic nor Protestant."""
    cats = _religion_cats(rows, measure)
    cath = [c for c in cats if _is_catholic(c) and not _is_protestant(c)]
    prot = [c for c in cats if _is_protestant(c) and not _is_catholic(c)]
    other = [c for c in cats if not _is_catholic(c) and not _is_protestant(c)]
    return (rate(rows, measure, style, cath) if cath else None,
            rate(rows, measure, style, prot) if prot else None,
            rate(rows, measure, style, other) if other else None)


def build():
    out = {}
    for date, name in DATES.items():
        try:
            rows = fetch(name)
        except Exception as e:
            print(f"  ! {date}: fetch failed ({e})")
            continue
        m, style = border_measure(rows)
        if not m:
            print(f"  ! {date}: no border-poll measure found")
            continue
        rc, rp, ro = community_rates(rows, m, style)
        out[date] = {
            "rate_C": rc,
            "rate_P": rp,
            "rate_O": ro,
            "decided": rate(rows, m, style, None),
            "source": f"{BASE}/{name}.csv.gz",
            "measure": m,
            "response_style": style,
        }
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    live = build()
    snap = json.load(open(os.path.join(HERE, "lucidtalk_unity_rates.json")))
    print(f"{'date':8} {'decided':>8} {'rate_C':>7} {'rate_P':>7} {'rate_O':>7}   vs committed")
    for d in sorted(set(live) | set(snap)):
        l = live.get(d, {})
        s = snap.get(d, {})
        def fmt(k): return f"{l.get(k):>7}" if l.get(k) is not None else "   None"
        flag = ""
        for k in ("decided", "rate_C", "rate_P", "rate_O"):
            if l.get(k) is not None and s.get(k) is not None and abs(l[k] - s[k]) > 1.0:
                flag += f" Δ{k}={l[k]-s[k]:+.1f}"
        print(f"{d:8} {fmt('decided')} {fmt('rate_C')} {fmt('rate_P')} {fmt('rate_O')}   {flag or 'ok'}")
    if args.write:
        json.dump(live, open(os.path.join(HERE, "lucidtalk_unity_rates.json"), "w"),
                  ensure_ascii=False, indent=1)
        print("\nwrote lucidtalk_unity_rates.json (live from R2)")
