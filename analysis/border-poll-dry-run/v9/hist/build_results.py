#!/usr/bin/env python3
"""Tier-2/3 targets: nationalist-bloc first-preference share by constituency for
the historical NILT-era (and 1990s) contests, from test/metadata/elections-test2.
Also the NI-wide Yes% for the 1998 GFA referendum (level-only target)."""
import json, csv, os
from collections import defaultdict
D="/home/user/civgraph/test/metadata/elections-test2"
NAT={'Sinn Féin','SDLP',"Workers' Party",'Independent Nationalist','Republican Sinn Féin','Aontú','IRSP'}
CONTESTS={
 'assembly':[('1998','northern-ireland-assembly__1998-06-25'),
             ('2003','northern-ireland-assembly__2003-11-26'),
             ('2007','northern-ireland-assembly__2007-03-07')],
 'westminster':[('1992','house-of-commons-of-the-united-kingdom__1992-04-09'),
                ('1997','house-of-commons-of-the-united-kingdom__1997-05-01'),
                ('2001','house-of-commons-of-the-united-kingdom__2001-06-07'),
                ('2005','house-of-commons-of-the-united-kingdom__2005-05-05'),
                ('2010','house-of-commons-of-the-united-kingdom__2010-05-06')],
}
rows=[]
for contest,items in CONTESTS.items():
    for year,fn in items:
        j=json.load(open(f"{D}/{fn}.json"))
        by=defaultdict(lambda:{'nat':0.0,'tot':0.0})
        for c in j['mainLikeCandidateSummary']:
            con=c['constituency']; v=float(c.get('firstPrefs') or c.get('votes') or 0)
            by[con]['tot']+=v
            if c['party'] in NAT: by[con]['nat']+=v
        for con,d in by.items():
            if d['tot']>0:
                rows.append(dict(contest=contest,year=year,area=con,
                                 nat_pct=round(100*d['nat']/d['tot'],2),total=int(d['tot'])))
with open(f"{os.path.dirname(__file__)}/hist_results_frame.csv","w",newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=['contest','year','area','nat_pct','total']); w.writeheader(); w.writerows(rows)
# NI-wide nationalist per contest + GFA ref Yes
ni={}
for contest,items in CONTESTS.items():
    for year,fn in items:
        sub=[r for r in rows if r['contest']==contest and r['year']==year]
        n=sum(r['nat_pct']*r['total'] for r in sub); t=sum(r['total'] for r in sub)
        ni[f"{contest} {year}"]=round(n/t,2)
gfa=json.load(open(f"{D}/northern-ireland-referendum__1998-05-22-belfast-agreement.json"))
ni['GFA-ref 1998 Yes']=gfa['results'][0]['leadingPct']
json.dump(ni,open(f"{os.path.dirname(__file__)}/hist_ni_actual.json","w"),indent=1)
print("wrote hist_results_frame.csv  (%d rows)"%len(rows))
for k,v in ni.items(): print(f"  {k:22s} {v}")
