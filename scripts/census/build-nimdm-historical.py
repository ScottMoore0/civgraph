import xlrd, csv, os, re, math
SP="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/nimdm"
OUT="/home/user/civgraph/data/census/derived"

def cells(s,r): return [s.cell_value(r,c) for c in range(s.ncols)]
def sval(v):
    if isinstance(v,float) and v==int(v): return str(int(v))
    return str(v).strip()

def find_header(s):
    for r in range(min(12,s.nrows)):
        row=[str(x).lower() for x in cells(s,r)]
        if any('rank' in x for x in row) and any('code' in x or 'ward' in x for x in row):
            return r
    return None

def col_idx(hdr, *keys):
    for i,h in enumerate(hdr):
        hl=str(h).lower()
        if all(k in hl for k in keys): return i
    return None

def add_decile(rows, rankkey):
    N=len(rows)
    for row in rows:
        try: rk=int(float(row[rankkey]))
        except: rk=None
        row[rankkey+"_decile"]= math.ceil(rk/N*10) if rk else ""
    return rows

def convert_single(path, geoglabel):
    """2001-style: one wide sheet with code,name,LGD,MDM+domains."""
    wb=xlrd.open_workbook(path)
    sn=[n for n in wb.sheet_names() if 'ward level data' in n.lower() or 'data' in n.lower()][0]
    s=wb.sheet_by_name(sn); hr=find_header(s)
    hdr=[str(x).strip() for x in cells(s,hr)]
    rows=[]
    for r in range(hr+1, s.nrows):
        c=cells(s,r)
        if not str(c[0]).strip() or str(c[0]).strip().lower().startswith('nan'): continue
        rec={hdr[i]: sval(c[i]) for i in range(len(hdr)) if hdr[i]}
        if not rec.get(hdr[0]): continue
        rows.append(rec)
    # standardise MDM rank decile
    rk=[h for h in hdr if 'rank' in h.lower() and 'multiple' in h.lower()]
    return hdr, rows, (rk[0] if rk else None)

def convert_multi(path, codekey):
    """2005/2010-style: main MDM sheet + domain sheets, join by geography code."""
    wb=xlrd.open_workbook(path)
    base={}   # code -> record
    order=[]
    domains=[]
    for sn in wb.sheet_names():
        s=wb.sheet_by_name(sn);
        if s.nrows<5: continue
        hr=find_header(s)
        if hr is None: continue
        hdr=[str(x).strip() for x in cells(s,hr)]
        ci=col_idx(hdr, codekey.lower())
        if ci is None: ci=0
        # score & rank cols = last two data cols with 'score'/'rank'
        si=next((i for i,h in enumerate(hdr) if 'score' in h.lower()), None)
        ri=next((i for i,h in enumerate(hdr) if 'rank' in h.lower()), None)
        snl=sn.lower()
        is_mdm = 'mdm' in snl or 'multiple' in snl or ('economic' in snl and 'measure' in snl)
        base_pref = 'EDM' if ('economic' in snl and 'measure' in snl) else 'MDM'
        dom = base_pref if is_mdm else re.sub(r'\s+',' ',sn).strip()
        if is_mdm: domains.insert(0,dom)
        elif si is not None: domains.append(dom)
        for r in range(hr+1, s.nrows):
            c=cells(s,r); code=sval(c[ci])
            if not code or code.lower().startswith('nan'): continue
            rec=base.setdefault(code,{})
            if code not in order: order.append(code)
            if is_mdm:
                rec["code"]=code
                # capture name/LGD columns
                for i,h in enumerate(hdr):
                    hl=h.lower()
                    if 'name' in hl and 'lgd' not in hl and 'soa' in hl: rec["name"]=sval(c[i])
                    if 'lgd' in hl and 'name' in hl: rec["LGD"]=sval(c[i])
                if si is not None: rec[base_pref+"_score"]=sval(c[si])
                if ri is not None: rec[base_pref+"_rank"]=sval(c[ri])
            else:
                if si is not None: rec[dom+"_score"]=sval(c[si])
                if ri is not None: rec[dom+"_rank"]=sval(c[ri])
    rows=[base[c] for c in order]
    return rows, domains

def write(fn, rows, cols):
    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/{fn}","w",newline="") as f:
        w=csv.writer(f); w.writerow(cols)
        for r in rows: w.writerow([r.get(c,"") for c in cols])
    print(f"wrote {fn}: {len(rows)} rows, {len(cols)} cols")

# 2001 ward
hdr, rows, rk = convert_single(f"{SP}/2001_Ward_LGD.xls","Ward")
if rk:
    N=len(rows)
    for r in rows:
        try: r["MDM_decile"]=math.ceil(int(float(r[rk]))/N*10)
        except: r["MDM_decile"]=""
    hdr=hdr+["MDM_decile"]
write("nimdm-2001-ward.csv", rows, hdr)

def finalize(rows, doms, fn):
    base=doms[0]  # 'MDM' or 'EDM'
    N=len(rows)
    for r in rows:
        try: r[base+"_decile"]=math.ceil(int(float(r.get(base+"_rank")))/N*10)
        except: r[base+"_decile"]=""
    cols=["code","name","LGD",f"{base}_score",f"{base}_rank",f"{base}_decile"]+[f"{d}_{m}" for d in doms[1:] for m in ("score","rank")]
    write(fn, rows, cols)

# 2005 SOA (full MDM) + OA (Economic Deprivation Measure only)
finalize(*convert_multi(f"{SP}/2005_SOA.xls","SOA"), "nimdm-2005-soa.csv")
finalize(*convert_multi(f"{SP}/2005_OA.xls","OA"), "nimdm-2005-oa.csv")
# 2010 OA (full MDM)
finalize(*convert_multi(f"{SP}/2010_OA.xls","OA"), "nimdm-2010-oa.csv")
