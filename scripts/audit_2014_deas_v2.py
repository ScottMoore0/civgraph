import fitz
import os

councils_deas = {
    "Antrim and Newtownabbey": ["Airport", "Antrim", "Ballyclare", "Dunsilly", "Glengormley", "Macedon", "Threemilewater"],
    "Ards and North Down": ["Ards Peninsula", "Bangor Central", "Bangor East and Donaghadee", "Bangor West", "Comber", "Holywood and Clandeboye", "Newtownards"],
    "Armagh City, Banbridge and Craigavon": ["Armagh", "Banbridge", "Craigavon", "Cusher", "Lagan River", "Lurgan", "Portadown"],
    "Belfast": ["Balmoral", "Black Mountain", "Castle", "Collin", "Court", "Lisnasharragh", "Oldpark", "Ormiston", "Titanic"],
    "Causeway Coast and Glens": ["Ballymoney", "Bann", "Benbradagh", "Causeway", "Coleraine", "Limavady", "The Glens"],
    "Derry City and Strabane": ["Ballyarnett", "Derg", "Faughan", "Foyleside", "Sperrin", "The Moor", "Waterside"],
    "Fermanagh and Omagh": ["Enniskillen", "Erne East", "Erne North", "Erne West", "Mid Tyrone", "Omagh", "West Tyrone"],
    "Lisburn and Castlereagh": ["Castlereagh Central", "Castlereagh South", "Downshire East", "Downshire West", "Killultagh", "Lisburn North", "Lisburn South"],
    "Mid and East Antrim": ["Ballymena", "Bannside", "Braid", "Carrick Castle", "Coast Road", "Knockagh", "Larne Lough"],
    "Mid Ulster": ["Carntogher", "Clogher Valley", "Cookstown", "Dungannon", "Magherafelt", "Moyola", "Torrent"],
    "Newry, Mourne and Down": ["Clandeboye", "Downpatrick", "Newry", "Rowallane", "Slieve Croob", "Slieve Gullion", "The Mournes"]
}

root = r"c:\Users\scomo\boundaries-website"
results = {}

# List of folders to scan
search_folders = [
    root,
    os.path.join(root, "_tmp_eoni_spn"),
    os.path.join(root, "_tmp_eoni_markdown")
]

# Collect all potential 2014 files
all_files = []
for folder in search_folders:
    if not os.path.exists(folder): continue
    for r, d, f in os.walk(folder):
        if "2014" in r or "2014" in "".join(f):
            for filename in f:
                if filename.lower().endswith((".pdf", ".md", ".doc")):
                    all_files.append(os.path.join(r, filename))

# DEA text matching
for council, deas in councils_deas.items():
    results[council] = {"found": set(), "missing": []}
    for dea in deas:
        found = False
        # 1. Filename match (Fast)
        for path in all_files:
            if dea.lower() in os.path.basename(path).lower():
                results[council]["found"].add(dea)
                found = True
                break
        
        if found: continue
        
        # 2. Content match (Deep)
        for path in all_files:
            if path.lower().endswith(".pdf"):
                try:
                    doc = fitz.open(path)
                    # Check first page content
                    first_page = doc[0].get_text().lower()
                    if dea.lower() in first_page:
                        results[council]["found"].add(dea)
                        found = True
                    doc.close()
                except:
                    pass
            if found: break
        
        if not found:
            results[council]["missing"].append(dea)

# Print Detailed Report
for council, data in results.items():
    total = len(councils_deas[council])
    found_count = len(data["found"])
    status = "COMPLETE" if found_count == total else f"PARTIAL ({found_count}/{total})"
    if found_count == 0: status = "MISSING"
    
    print(f"\n{council}: {status}")
    if data["missing"]:
        print(f"  - Missing DEAs: {', '.join(data['missing'])}")
