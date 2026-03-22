import fitz
import os

council = "Lisburn and Castlereagh"
deas = ["Castlereagh Central", "Castlereagh South", "Downshire East", "Downshire West", "Killultagh", "Lisburn North", "Lisburn South"]

root = r"c:\Users\scomo\boundaries-website"
search_folders = [
    root,
    os.path.join(root, "_tmp_eoni_spn"),
    os.path.join(root, "_tmp_eoni_markdown")
]

all_files = []
for folder in search_folders:
    if not os.path.exists(folder): continue
    for r, d, f in os.walk(folder):
        if "2014" in r or "2014" in "".join(f):
            for filename in f:
                if filename.lower().endswith((".pdf", ".md", ".doc")):
                    all_files.append(os.path.join(r, filename))

print(f"Verbose Audit for {council}:")
for dea in deas:
    found_paths = []
    # 1. Filename match
    for path in all_files:
        if dea.lower() in os.path.basename(path).lower():
            found_paths.append(path)
    
    # 2. Content match (if not already found by filename)
    if not found_paths:
        for path in all_files:
            if path.lower().endswith(".pdf"):
                try:
                    doc = fitz.open(path)
                    first_page = doc[0].get_text().lower()
                    if dea.lower() in first_page:
                        found_paths.append(path)
                    doc.close()
                except:
                    pass
    
    if found_paths:
        print(f"\n{dea}: FOUND")
        for p in set(found_paths):
            print(f"  - {p}")
    else:
        print(f"\n{dea}: MISSING")
