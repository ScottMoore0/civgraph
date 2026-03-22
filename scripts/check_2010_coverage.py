import fitz  # PyMuPDF
import os

constituencies = [
    "Belfast East", "Belfast North", "Belfast South", "Belfast West",
    "East Antrim", "East Londonderry", "Fermanagh and South Tyrone", "Foyle",
    "Lagan Valley", "Mid Ulster", "Newry and Armagh", "North Antrim",
    "North Down", "South Antrim", "South Down", "Strangford",
    "Upper Bann", "West Tyrone"
]

pdf_files = [
    "STATEMENT-OF-PERSONS-NOMINATED-AND-NOTICE-OF-POLL-BN.pdf",
    "STATEMENT-OF-PERSONS-NOMINATED-AND-NOTICE-OF-POLL-EA.pdf",
    "STATEMENT-OF-PERSONS-NOMINATED-AND-NOTICE-OF-POLL-NYA.pdf",
    "STATEMENT-OF-PERSONS-NOMINATED-AND-NOTICE-OF-POLL-SA.pdf",
    "Statement-of-Persons-Nominated-BS.pdf",
    "Statement-of-Persons-Nominated-BW_1.pdf",
    "Statement-of-Persons-Nominated-FST.pdf",
    "statement_of_persons_nominated_-_ballymena_office.pdf",
    "statement_of_persons_nominated_-_banbridge_2_office.pdf",
    "statement_of_persons_nominated_-_londonderry_office.pdf",
    "statement_of_persons_nominated_-_newtownards_office-2.pdf",
    "statement_of_persons_nominated_-_omagh_office.pdf"
]

root = r"c:\Users\scomo\boundaries-website"
found_constituencies = set()

for pdf_name in pdf_files:
    pdf_path = os.path.join(root, pdf_name)
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_name}")
        continue
    
    try:
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        
        print(f"\nReviewing {pdf_name}:")
        for c in constituencies:
            if c.lower() in text.lower():
                print(f"  - Found: {c}")
                found_constituencies.add(c)
    except Exception as e:
        print(f"  - Error reading {pdf_name}: {e}")

missing = set(constituencies) - found_constituencies
if missing:
    print(f"\nMISSING CONSTITUENCIES: {sorted(list(missing))}")
else:
    print("\nALL 18 CONSTITUENCIES COVERED!")
