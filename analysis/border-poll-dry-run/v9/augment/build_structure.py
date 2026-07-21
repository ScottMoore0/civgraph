#!/usr/bin/env python3
"""Contest-STRUCTURE covariates from the election JSONs: turnout, candidate counts
per bloc, and pact/vote-split indicators, per (contest, year, area). These address
the ELECTION residuals (esp. Westminster FPTP pact elections) but are BACKTEST-ONLY
— a referendum has no candidates or pacts, so they do NOT transfer to the unity
projection. Turnout is the only structural covariate a referendum shares."""
import json, csv, os
from collections import defaultdict
D="/home/user/civgraph/test/metadata/elections-test2"
NAT={'Sinn Féin','SDLP',"Workers' Party",'Independent Nationalist','Republican Sinn Féin','Aontú','IRSP'}
UNI={'DUP','UUP','TUV','PUP','Ulster Democratic Party','Independent Unionist','UKUP','Conservative',
     'NI Unionist Party','Ulster Independence Movement','Ulster Third Way','UKIP',"Ulster's Independent Voice",'UK Unionist'}
CONTESTS=[
 ('assembly',2016,'northern-ireland-assembly__2016-05-05','constituency'),
 ('assembly',2017,'northern-ireland-assembly__2017-03-02','constituency'),
 ('assembly',2022,'northern-ireland-assembly__2022-05-05','constituency'),
 ('westminster',2017,'house-of-commons-of-the-united-kingdom__2017-06-08','constituency'),
 ('westminster',2019,'house-of-commons-of-the-united-kingdom__2019-12-12','constituency'),
 ('westminster',2024,'house-of-commons-of-the-united-kingdom__2024-07-04','constituency'),
 ('assembly',1998,'northern-ireland-assembly__1998-06-25','constituency'),
 ('assembly',2003,'northern-ireland-assembly__2003-11-26','constituency'),
 ('assembly',2007,'northern-ireland-assembly__2007-03-07','constituency'),
 ('westminster',1997,'house-of-commons-of-the-united-kingdom__1997-05-01','constituency'),
 ('westminster',2001,'house-of-commons-of-the-united-kingdom__2001-06-07','constituency'),
 ('westminster',2005,'house-of-commons-of-the-united-kingdom__2005-05-05','constituency'),
 ('westminster',2010,'house-of-commons-of-the-united-kingdom__2010-05-06','constituency'),
 ('local',2014,'local-government-local-government-districts__2014-05-22','dea'),
 ('local',2019,'local-government-local-government-districts__2019-05-02','dea'),
 ('local',2023,'local-government-local-government-districts__2023-05-18','dea'),
 ('euref',2016,'northern-ireland-referendum__2016-06-23-eu-membership','constituency'),
]
rows=[]
for contest,year,fn,scale in CONTESTS:
    j=json.load(open(f"{D}/{fn}.json"))
    turn={r['constituency']:r.get('turnoutPct') for r in j['results']}
    cand=defaultdict(lambda:{'nat':set(),'uni':set(),'n':0})
    for c in j.get('mainLikeCandidateSummary',[]):
        a=c['constituency']; p=c['party']; cand[a]['n']+=1
        if p in NAT: cand[a]['nat'].add(p)
        if p in UNI: cand[a]['uni'].add(p)
    areas=set(turn)|set(cand)
    for a in areas:
        cc=cand.get(a,{'nat':set(),'uni':set(),'n':0})
        # per-party candidate counts need the full list; approximate n_nat/n_uni by candidate rows
        n_nat=sum(1 for c in j.get('mainLikeCandidateSummary',[]) if c['constituency']==a and c['party'] in NAT)
        n_uni=sum(1 for c in j.get('mainLikeCandidateSummary',[]) if c['constituency']==a and c['party'] in UNI)
        rows.append(dict(contest=contest,year=year,area=a,
            str__turnout=turn.get(a) or '',
            str__n_nat_cands=n_nat, str__n_uni_cands=n_uni, str__n_total_cands=cc['n'],
            str__sf_sdlp_both=int({'Sinn Féin','SDLP'} <= (cc['nat']|set())),
            str__uni_single=int(n_uni==1)))
with open(f"{os.path.dirname(__file__)}/structure.csv","w",newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=['contest','year','area','str__turnout','str__n_nat_cands',
        'str__n_uni_cands','str__n_total_cands','str__sf_sdlp_both','str__uni_single'])
    w.writeheader(); w.writerows(rows)
print(f"wrote structure.csv ({len(rows)} rows)")
# quick look at Westminster 2019 (the pact election)
for r in rows:
    if r['contest']=='westminster' and r['year']==2019 and r['area'] in ('North Down','Belfast North','Fermanagh and South Tyrone'):
        print(f"  W2019 {r['area']:28s} turnout={r['str__turnout']} nat_cands={r['str__n_nat_cands']} uni_cands={r['str__n_uni_cands']} sf_sdlp_both={r['str__sf_sdlp_both']} uni_single={r['str__uni_single']}")
