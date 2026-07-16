import csv, re, io, os

# geography level from filename tag e.g. "TABLE S356 (WARD).csv", "TABLE KS06 (NUM) (OA).csv"
LEVELTAG={"OA":"OA2001","WARD":"WARD2001","DC":"LGD2001","NI":"NI","PC":"PARLCON2001",
          "NUTS3":"NUTS3","ELB":"ELB","HSSB":"HSSB","AA":"AA2001"}
def level_from_name(fn):
    tags=re.findall(r'\(([^)]+)\)', fn)
    for t in reversed(tags):
        if t.upper() in LEVELTAG: return LEVELTAG[t.upper()], t.upper()
    return None,None

# classify a parsed geography code to a level tag
def code_level(code):
    if code in ("Northern Ireland","N92000002","95"): return "NI"
    c=code.replace(" ","")
    if re.fullmatch(r'\d{2}[A-Z]{2}', c): return "LGD2001"      # 95AA
    if re.fullmatch(r'\d{2}[A-Z]{2}\d{2}', c): return "WARD2001" # 95AA01
    if re.fullmatch(r'\d{2}[A-Z]{2}\d{6}', c): return "OA2001"   # 95AA010001
    return None

def parse_geo(label):
    s=label.strip()
    m=re.match(r'(\S+)\s+(.+)', s)
    if m and re.match(r'^[0-9A-Z]', m.group(1)) and any(ch.isdigit() for ch in m.group(1)):
        return m.group(1), m.group(2)
    return s, s   # NI, or OA (code==name)

def num(v):
    v=v.strip()
    if v in ('-','',':','..','*'): return 0
    try: return int(v.replace(',',''))
    except:
        try: return int(float(v))
        except: return None

def parse_file(path):
    """Yield rows: (geo_label, [row_cat...], [col_cat...], count). Also returns (title, ncoldims, nrowdims)."""
    with open(path, encoding='latin-1') as f:
        rows=list(csv.reader(f))
    title=None; i=0
    for i,r in enumerate(rows):
        if r and r[0].startswith('Table '):
            m=re.match(r'Table\s+(\S+):\s*(.*)', r[0]); tid=m.group(1); title=m.group(2).strip(); break
    # skip metadata; find header rows (col0 empty, has content beyond) and first data row (col0 non-empty)
    hdr_rows=[]; first_data=None
    for j in range(i+1, len(rows)):
        r=rows[j]
        if not r: continue
        c0=(r[0] if r else '').strip()
        beyond=any((c or '').strip() for c in r[1:])
        if c0.startswith('Table population') or c0.startswith('Geographical level') or c0.startswith('Source:') or c0.startswith('Note'):
            continue   # metadata line
        if c0=='' and beyond:
            hdr_rows.append(r)
        elif c0!='':
            first_data=j; break
    if first_data is None or not hdr_rows: return tid,title,None,None,[]
    n_index=next(k for k,c in enumerate(hdr_rows[-1]) if (c or '').strip())
    # forward-fill each header row across value cols
    def ff(r):
        o=[(c or '').strip() for c in r]+['']*(200)
        last=''
        for k in range(n_index,len(o)):
            if o[k]: last=o[k]
            o[k]=last
        return o
    H=[ff(r) for r in hdr_rows]
    out=[]
    for j in range(first_data, len(rows)):
        r=rows[j]
        if not r or not (r[0] or '').strip(): continue
        if len(r)<=n_index: continue   # ragged/short row, no data cells
        geo=r[0]
        rowcats=[((r[k] or '').strip() if k<len(r) else '') for k in range(1,n_index)]
        for k in range(n_index, len(r)):
            colcats=[H[t][k] for t in range(len(H)) if k<len(H[t])]
            colcats=[c for c in colcats]
            v=num(r[k])
            if v is None: continue
            out.append((geo, rowcats, colcats, v))
    return tid, title, len(hdr_rows), n_index-1, out
