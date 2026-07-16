import sys, os, glob, zipfile, io, csv, gzip, json, subprocess, threading, time, re
WD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/cen2001"
sys.path.insert(0, WD)
from conv2001 import parse_file, parse_geo, code_level, level_from_name, LEVELTAG
from concurrent.futures import ThreadPoolExecutor
env=open("/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/.r2env").read()
ACC=env.split("CLOUDFLARE_ACCOUNT_ID=")[1].split("\n")[0].strip()
TOK=env.split("CLOUDFLARE_API_TOKEN=")[1].split("\n")[0].strip()
PFX="data/census/2001-cleaned"; BASEURL=f"https://data.civgraph.net/{PFX}"
EXTRACT=f"{WD}/extract"; os.makedirs(EXTRACT, exist_ok=True)
STD={"OA2001","WARD2001","LGD2001","NI"}

NAME2LEVEL=[("output area","OA2001"),("ward","WARD2001"),("district","LGD2001"),
    ("northern ireland","NI"),("parliament","PARLCON2001"),("nuts","NUTS3"),
    ("education and library","ELB"),("health and social","HSSB"),("assembly","AA2001")]
def nested_level(name):
    n=name.lower()
    for k,v in NAME2LEVEL:
        if k in n: return v
    return None

def extract_all():
    out=[]   # (path, level_hint)
    seen=set()
    for fz in glob.glob(f"{WD}/2001-*.zip"):
        with zipfile.ZipFile(fz) as z:
            for n in z.namelist():
                if n.lower().endswith('.zip'):
                    if 'percentage' in n.lower(): continue
                    try: zz=zipfile.ZipFile(io.BytesIO(z.read(n)))
                    except: continue
                    hint=nested_level(n)
                    for m in zz.namelist():
                        if not m.lower().endswith('.csv') or '(pct)' in m.lower() or 'percentage' in m.lower(): continue
                        base=os.path.basename(m)
                        key=f"{hint}__{base}"
                        if key in seen: continue
                        seen.add(key)
                        outp=f"{EXTRACT}/{key}"
                        with open(outp,'wb') as f: f.write(zz.read(m))
                        out.append((outp,hint))
                elif n.lower().endswith('.csv') and '(pct)' not in n.lower() and 'percentage' not in n.lower():
                    hint=nested_level(n)   # subdir path may carry the level
                    base=os.path.basename(n); key=f"{hint}__{base}"
                    if key in seen: continue
                    seen.add(key)
                    outp=f"{EXTRACT}/{key}"
                    with open(outp,'wb') as f: f.write(z.read(n))
                    out.append((outp,hint))
    return sorted(set(out))

lock=threading.Lock(); manifest=[]; st={"files":0,"rows":0,"skip":0,"fail":0}
def put(gzb,key):
    url=f"https://api.cloudflare.com/client/v4/accounts/{ACC}/r2/buckets/boundaries-data/objects/{key}"
    tmp=f"{WD}/.up_{threading.get_ident()}.gz"; open(tmp,'wb').write(gzb)
    for a in range(4):
        try:
            c=subprocess.run(["curl","-s","-o","/dev/null","-w","%{http_code}","-X","PUT",url,
              "-H",f"Authorization: Bearer {TOK}","-H","Content-Type: application/gzip",
              "--data-binary",f"@{tmp}","--max-time","120"],capture_output=True,text=True,timeout=140).stdout.strip()
        except Exception: c="000"
        if c=="200": os.remove(tmp); return True
        time.sleep(1.2*(a+1))
    os.remove(tmp); return False

def process(item):
    path, hint = item
    fn=os.path.basename(path)
    try: tid,title,ncol,nrow,out=parse_file(path)
    except Exception:
        with lock: st["fail"]+=1
        return
    if not out or not re.match(r'^[A-Z]{1,4}\d', tid or ''):   # skip malformed/non-table
        with lock: st["skip"]+=1
        return
    tagl, _ = level_from_name(fn)
    prilevel = tagl or hint            # filename tag wins, else nested-zip hint
    ncat=max(len(rc)+len(cc) for _,rc,cc,_ in out)
    buckets={}
    for geo,rc,cc,v in out:
        code,name=parse_geo(geo)
        cl=code_level(code)
        if prilevel in STD:
            if cl!=prilevel: continue          # keep only this standard level's rows
            lv=prilevel
        elif prilevel:
            if code=="Northern Ireland" or cl is not None: continue  # drop NI + standard rollups
            lv=prilevel
        else:
            lv=cl or ("NI" if code=="Northern Ireland" else "OTHER")
        cats=(rc+cc)+[""]*(ncat-len(rc)-len(cc))
        buckets.setdefault(lv,[]).append([code,name]+cats+[v])
    hdr=["Geography Code","Geography Label"]+[f"Category {i+1}" for i in range(ncat)]+["Count"]
    for lv,rws in buckets.items():
        buf=io.StringIO(); w=csv.writer(buf); w.writerow(hdr); w.writerows(rws)
        gz=gzip.compress(buf.getvalue().encode())
        outfn=f"{tid}__{lv}.csv.gz"
        if put(gz,f"{PFX}/{outfn}"):
            with lock:
                st["files"]+=1; st["rows"]+=len(rws)
                manifest.append({"table":tid,"title":title,"geography":lv,"num_categories":ncat,
                                 "file":outfn,"url":f"{BASEURL}/{outfn}","rows":len(rws),"bytes":len(gz)})
        else:
            with lock: st["fail"]+=1

if __name__=="__main__":
    csvs=extract_all()
    print(f"extracted {len(csvs)} numerical CSVs", flush=True)
    if os.environ.get("LIMIT"): csvs=csvs[:int(os.environ["LIMIT"])]
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(process, csvs))
    json.dump({"count":len(manifest),"tables":manifest}, open(f"{WD}/manifest2001.json","w"), separators=(",",":"))
    print("DONE", json.dumps(st), flush=True)
