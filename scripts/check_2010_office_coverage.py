import fitz
import os

constituencies = [
    "Belfast East", "Belfast North", "Belfast South", "Belfast West",
    "East Antrim", "East Londonderry", "Fermanagh and South Tyrone", "Foyle",
    "Lagan Valley", "Mid Ulster", "Newry and Armagh", "North Antrim",
    "North Down", "South Antrim", "South Down", "Strangford",
    "Upper Bann", "West Tyrone"
]

files = [
    "statement_of_persons_nominated_-_ballymena_office.pdf",
    "statement_of_persons_nominated_-_banbridge_2_office.pdf",
    "statement_of_persons_nominated_-_omagh_office.pdf",
    "statement_of_persons_nominated_-_londonderry_office.pdf",
    "statement_of_persons_nominated_-_newtownards_office-2.pdf"
]

root = r"c:\Users\scomo\boundaries-website"

for f in files:
    path = os.path.join(root, f)
    if os.path.exists(path):
        try:
            doc = fitz.open(path)
            text = " ".join([p.get_text() for p in doc]).lower()
            doc.close()
            found = [c for c in constituencies if c.lower() in text]
            print(f"{f}: {', '.join(found)}")
        except Exception as e:
            print(f"{f}: Error reading - {e}")
    else:
        print(f"{f}: File not found")
