import fitz
import os

deas = [
    "Castlereagh Central", "Castlereagh South", 
    "Downshire East", "Downshire West", 
    "Killultagh", "Lisburn North", "Lisburn South"
]
root = r"c:\Users\scomo\boundaries-website\_tmp_eoni_spn"

print("Searching for Lisburn & Castlereagh DEAs in PDFs (excluding AreaOfficeAddress):")

for r, d, f in os.walk(root):
    for filename in f:
        if filename.lower().endswith(".pdf") and "areaofficeaddress" not in filename.lower():
            path = os.path.join(r, filename)
            try:
                doc = fitz.open(path)
                # Check ALL pages just in case it's a multi-DEA PDF
                text = ""
                for page in doc:
                    text += page.get_text().lower()
                
                found_in_doc = []
                for dea in deas:
                    if dea.lower() in text:
                        found_in_doc.append(dea)
                
                if found_in_doc:
                    print(f"\n{path}:")
                    print(f"  Matches: {found_in_doc}")
                doc.close()
            except:
                pass
