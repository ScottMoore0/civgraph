#!/usr/bin/env python3
"""Harvest the NISA (Northern Ireland Social Attitudes, 1989-1996) constitutional-
preference question (NIRELAND: 'long-term policy for NI... remain in UK / reunify
with the rest of Ireland') from the ARK 'SOL' open tabulations at ark.ac.uk.

This is the ONLY no-login route to a pre-1998 unity level signal: the UKDS microdata
is Safeguarded (licensed), but ARK SOL publishes the weighted marginal for each
variable — overall AND broken down by community background (Catholic/Protestant/None)
— as static HTML. That religion breakdown is exactly the axis the projection
poststratifies on. There was no NISA survey in 1992.

Output: nisa_reunify.json (per year: overall + by-religion % reunify) and .csv.
"""
import subprocess, re, json, os, sys
from bs4 import BeautifulSoup
HERE=os.path.dirname(__file__) or "."
BASE="https://www.ark.ac.uk/sol/surveys/gen_social_att/nisa"
# module the NIRELAND variable sits under, per year (confirmed by directory probe)
PATHS={
 1989:"Political_Attitudes/NIRELAND.html", 1990:"Political_Attitudes/NIRELAND.html",
 1991:"Political_Attitudes/NIRELAND.html", 1993:"Europe_and_International_Relations/NIRELAND.html",
 1994:"Europe_and_International_Relations/NIRELAND.html", 1995:"Politics/NIRELAND.html",
 1996:"Politics/NIRELAND.html",
}
def fetch(url):
    r=subprocess.run(["curl","-sS","--max-time","30",url],capture_output=True,text=True)
    return r.stdout
def parse(html):
    """reunify overall (single-value row) + by-religion (last 3-value row: Cath,Prot,None)."""
    soup=BeautifulSoup(html,"html5lib")
    runs=[]
    for tr in soup.find_all("tr"):
        cells=[c.get_text(" ",strip=True) for c in tr.find_all(["td","th"])]
        if not cells: continue
        if re.search(r"(re)?unify with the rest of ireland",cells[0],re.I):
            nums=[int(m.group()) for x in cells[1:] for m in [re.search(r"-?\d+",x)] if m]
            if nums: runs.append(nums)
    ov=[r for r in runs if len(r)==1]; rel=[r for r in runs if len(r)==3]
    if not ov or not rel: return None
    return dict(overall=ov[0][0],catholic=rel[-1][0],protestant=rel[-1][1],none=rel[-1][2])
out={}
for yr,path in PATHS.items():
    html=fetch(f"{BASE}/{yr}/website/{path}")
    rec=parse(html)
    if rec is None: print(f"{yr}: PARSE FAILED",file=sys.stderr); continue
    rec['source']=f"{BASE}/{yr}/website/{path}"
    out[yr]=rec
json.dump(out,open(f"{HERE}/nisa_reunify.json","w"),indent=1)
with open(f"{HERE}/nisa_reunify.csv","w") as fh:
    fh.write("year,reunify_overall,reunify_catholic,reunify_protestant,reunify_none\n")
    for y in sorted(out):
        r=out[y]; fh.write(f"{y},{r['overall']},{r['catholic']},{r['protestant']},{r['none']}\n")
print("NISA % reunify (NIRELAND), harvested from ARK SOL — no login:")
print(f"{'year':<6}{'overall':<9}{'Catholic':<10}{'Protestant':<12}{'None':<6}")
for y in sorted(out):
    r=out[y]; print(f"{y:<6}{r['overall']:<9}{r['catholic']:<10}{r['protestant']:<12}{r['none']:<6}")
print(f"\nharvested {len(out)}/7 years -> nisa_reunify.json/.csv")
