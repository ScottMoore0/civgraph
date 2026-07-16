import sys, os, csv, glob, json, gzip, io, re, subprocess, time, threading
sys.path.insert(0,'/tmp/c2011')
from convert import load_outlines, load_geo, parse, GEOGTAG
from concurrent.futures import ThreadPoolExecutor
ROOT="/home/user/civgraph/data/census/2011"
env=open("/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/.r2env").read()
ACC=env.split("CLOUDFLARE_ACCOUNT_ID=")[1].split("\n")[0].strip()
TOK=env.split("CLOUDFLARE_API_TOKEN=")[1].split("\n")[0].strip()
PFX="data/census/2011-cleaned"; BASEURL=f"https://data.civgraph.net/{PFX}"
DRY=os.environ.get("DRY")=="1"
OUTDIR="/tmp/c2011/out"; os.makedirs(OUTDIR,exist_ok=True)

# dataset dirs (skip admin duplicates marked '(1)'? no—include all, tag by dir)
DSDIRS=[d for d in glob.glob(f"{ROOT}/*") if os.path.isdir(d)]

def geogtag(subdir):
    b=os.path.basename(subdir).upper()
    return GEOGTAG.get(b, b.replace(' ','_'))

def put(gzbytes,key):
    url=f"https://api.cloudflare.com/client/v4/accounts/{ACC}/r2/buckets/boundaries-data/objects/{key}"
    tmp=f"/tmp/c2011/.up_{threading.get_ident()}.gz"
    open(tmp,'wb').write(gzbytes)
    for a in range(4):
        try:
            c=subprocess.run(["curl","-s","-o","/dev/null","-w","%{http_code}","-X","PUT",url,
              "-H",f"Authorization: Bearer {TOK}","-H","Content-Type: application/gzip",
              "--data-binary",f"@{tmp}","--max-time","120"],capture_output=True,text=True,timeout=140).stdout.strip()
        except Exception: c="000"
        if c=="200": os.remove(tmp); return True
        time.sleep(1.5*(a+1))
    os.remove(tmp); return False

lock=threading.Lock(); manifest=[]; st={"files":0,"rows":0,"skip":0,"fail":0}

def process(dsdir, outlines, geo, datafile):
    fn=os.path.basename(datafile)                      # e.g. DC1101NIDATA0.CSV
    m=re.match(r'([A-Z]{2}\d+[A-Z]{2})', fn)
    if not m: return
    tid=m.group(1)
    if tid not in outlines:
        with lock: st["skip"]+=1
        return
    title,rows=outlines[tid]; dims,cm=parse(tid,title,rows)
    if not cm:
        with lock: st["skip"]+=1
        return
    ncat=max(len(v) for v in cm.values())
    gtag=geogtag(os.path.dirname(datafile))
    buf=io.StringIO(); w=csv.writer(buf)
    hdr=["Geography Code","Geography Label"]+[f"Category {i+1}" for i in range(ncat)]+["Count"]
    w.writerow(hdr)
    nrows=0
    with open(datafile, encoding='latin-1') as f:
        rd=csv.DictReader(f)
        for row in rd:
            gc=row.get("GeographyCode","").strip()
            if not gc: continue
            gl=geo.get(gc, gc)
            for code,labels in cm.items():
                v=row.get(code)
                if v is None or v=="": continue
                labs=labels+[""]*(ncat-len(labels))
                w.writerow([gc,gl]+labs+[v]); nrows+=1
    data=buf.getvalue().encode()
    gz=gzip.compress(data)
    outfn=f"{tid}__{gtag}.csv.gz"
    ok=True
    if DRY:
        open(f"{OUTDIR}/{outfn}","wb").write(gz)
    else:
        ok=put(gz,f"{PFX}/{outfn}")
    with lock:
        if ok:
            st["files"]+=1; st["rows"]+=nrows
            manifest.append({"table":tid,"title":title,"dimensions":dims,"geography":gtag,
                             "num_categories":ncat,"file":outfn,"url":f"{BASEURL}/{outfn}","rows":nrows,"bytes":len(gz)})
        else: st["fail"]+=1

def run():
    tasks=[]
    for dsdir in DSDIRS:
        xs=glob.glob(f"{dsdir}/*/*.xlsx")
        if not xs: continue
        outlines=load_outlines(xs[0]); geo=load_geo(dsdir)
        for datafile in glob.glob(f"{dsdir}/*/*DATA*.CSV"):
            tasks.append((dsdir,outlines,geo,datafile))
    if os.environ.get("LIMIT"): tasks=tasks[:int(os.environ["LIMIT"])]
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(lambda t: process(*t), tasks))
    json.dump({"count":len(manifest),"tables":manifest}, open("/tmp/c2011/manifest2011.json","w"), separators=(",",":"))
    print("DONE",json.dumps(st))

if __name__=="__main__": run()
