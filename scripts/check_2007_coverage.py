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
    "statement_of_persons_nominiated_be_and_bs-2.pdf",
    "statement_of_persons_nominiated_bn_and_bw-2.pdf",
    "statement_of_persons_nominiated_ea_and_sa.pdf",
    "statement_of_persons_nominiated_fst_and_wt.pdf",
    "statement_of_persons_nominiated_lv_and_sd-2.pdf",
    "statement_of_persons_nominiated_mu_and_na-2.pdf",
    "statement_of_persons_nominiated_n_a_and_ub.pdf",
    "statement_of_persons_nominiated_nd_and_st.pdf"
]

root = r"c:\Users\scomo\boundaries-website"
found_total = set()

for f in files:
    path = os.path.join(root, f)
    if os.path.exists(path):
        try:
            doc = fitz.open(path)
            file_found = set()
            for page in doc:
                text = page.get_text().lower()
                for c in constituencies:
                    if (c.lower() in text) and ("constituency" in text):
                        file_found.add(c)
                        found_total.add(c)
            doc.close()
            print(f"{f}: {sorted(list(file_found))}")
        except Exception as e:
            print(f"{f}: Error reading - {e}")
    else:
        print(f"{f}: File not found")

missing = set(constituencies) - found_total
if missing:
    print(f"\nMISSING CONSTITUENCIES: {sorted(list(missing))}")
else:
    print("\nALL 18 CONSTITUENCIES COVERED!")
