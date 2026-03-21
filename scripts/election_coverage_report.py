#!/usr/bin/env python
"""Generate a chronological report of SPN/Agent data coverage for all NI elections."""

elections = [
    ("Westminster 2024", "4 Jul 2024", "W", 18, "COMPLETE (EONI 18/18)", "Partial (1 PDF)"),
    ("Local 2023", "18 May 2023", "L", 80, "COMPLETE (EONI+councils 80/80 DEAs)", "Partial (council sites)"),
    ("Assembly 2022", "5 May 2022", "A", 18, "COMPLETE (EONI 18/18 incl Belfast South from IA)", "Partial (2 PDFs)"),
    ("Westminster 2019", "12 Dec 2019", "W", 18, "COMPLETE (EONI 18/18)", "Partial"),
    ("Local 2019", "2 May 2019", "L", 80, "NEAR-COMPLETE (~73/80, Lisburn&Castlereagh 7 DEAs missing)", "Partial (council sites)"),
    ("European 2019", "23 May 2019", "E", 1, "COMPLETE (EONI)", "Yes (1 PDF)"),
    ("Westminster 2017", "8 Jun 2017", "W", 18, "COMPLETE (EONI 18/18)", "None"),
    ("Assembly 2017", "2 Mar 2017", "A", 18, "COMPLETE (EONI 18/18)", "Yes (19 agent MDs)"),
    ("Assembly 2016", "5 May 2016", "A", 18, "COMPLETE (EONI 18/18)", "Yes (17 agent MDs)"),
    ("Westminster 2015", "7 May 2015", "W", 18, "COMPLETE (EONI 18/18 individual+combined)", "None"),
    ("European 2014", "22 May 2014", "E", 1, "COMPLETE (EONI)", "None"),
    ("Local 2014", "22 May 2014", "L", 80, "PARTIAL (33 SPNs from old-26 councils: Ards 14, Ballymoney 7, Craigavon 8, Moyle 7, Fermanagh 3, others)", "Yes (34 agent files)"),
    ("Assembly 2011", "5 May 2011", "A", 18, "PARTIAL (9-17/18 from EONI MDs+PDFs)", "Partial (2 agent MDs)"),
    ("Local 2011", "5 May 2011", "L", 101, "PARTIAL (7 SPNs: Coleraine 1, Craigavon 2, Moyle 4)", "Yes (11 agents)"),
    ("Westminster 2010", "6 May 2010", "W", 18, "BNA NEWS ARTICLES (9+ Belfast Telegraph). No formal SPN.", "None"),
    ("European 2009", "4 Jun 2009", "E", 1, "BNA NEWS ARTICLES (27+ Belfast Telegraph). No formal SPN.", "None"),
    ("Assembly 2007", "7 Mar 2007", "A", 18, "BNA NEWS ARTICLES (20+ Belfast Telegraph). No formal SPN.", "None"),
    ("Westminster 2005", "5 May 2005", "W", 18, "BNA NEWS ARTICLES (3+ Belfast Telegraph). No formal SPN.", "None"),
    ("Local 2005", "5 May 2005", "L", 101, "MINIMAL (1 SPN: Limavady)", "Yes (4 agents: Ballymoney 3, Limavady 1)"),
    ("Assembly 2003", "26 Nov 2003", "A", 18, "BNA NEWS ARTICLES (10+ via constituency search). No formal SPN.", "None"),
    ("Local 2001", "7 Jun 2001", "L", 101, "NONE", "None"),
    ("Westminster 2001", "7 Jun 2001", "W", 18, "NONE", "None"),
    ("European 1999", "10 Jun 1999", "E", 1, "NONE", "None"),
    ("Assembly 1998", "25 Jun 1998", "A", 18, "GAZETTE ONLY (9 notices, unverified)", "None"),
    ("Westminster 1997", "1 May 1997", "W", 18, "GAZETTE ONLY (15 notices, unverified)", "None"),
    ("Local 1997", "21 May 1997", "L", 101, "NONE", "None"),
    ("Forum 1996", "30 May 1996", "F", 18, "GAZETTE ONLY (14 notices, unverified)", "None"),
    ("European 1994", "9 Jun 1994", "E", 1, "GAZETTE ONLY (12 notices, unverified)", "None"),
    ("Local 1993", "19 May 1993", "L", 101, "NONE", "None"),
    ("Westminster 1992", "9 Apr 1992", "W", 17, "GAZETTE ONLY (38 notices, unverified)", "None"),
    ("Local 1989", "17 May 1989", "L", 101, "NONE", "None"),
    ("European 1989", "15 Jun 1989", "E", 1, "GAZETTE ONLY (2 notices)", "None"),
    ("Westminster 1987", "11 Jun 1987", "W", 17, "COMPLETE (BNA Belfast Telegraph pp18-19, all 17)", "None"),
    ("Local 1985", "15 May 1985", "L", 101, "NONE", "None"),
    ("European 1984", "14 Jun 1984", "E", 1, "GAZETTE ONLY (2 notices)", "None"),
    ("Westminster 1983", "9 Jun 1983", "W", 17, "COMPLETE (BNA Belfast Telegraph pp16-17, all 17)", "None"),
    ("Assembly 1982", "20 Oct 1982", "A", 12, "GAZETTE ONLY (3 notices, unverified)", "None"),
    ("Local 1981", "20 May 1981", "L", 101, "NONE", "None"),
    ("European 1979", "7 Jun 1979", "E", 1, "GAZETTE ONLY (1 notice)", "None"),
    ("Westminster 1979", "3 May 1979", "W", 12, "LIKELY COMPLETE (BNA Belfast Telegraph pp17-18, 7 articles)", "None"),
    ("Local 1977", "18 May 1977", "L", 101, "NONE", "None"),
    ("Convention 1975", "1 May 1975", "C", 12, "COMPLETE (BNA Belfast News-Letter pp11-13, all 12)", "None"),
    ("Westminster Oct 1974", "10 Oct 1974", "W", 12, "NONE", "None"),
    ("Westminster Feb 1974", "28 Feb 1974", "W", 12, "NONE", "None"),
    ("Assembly 1973", "28 Jun 1973", "A", 12, "PARTIAL (BNA: Londonderry only, 2 articles)", "None"),
    ("Local 1973", "30 May 1973", "L", 26, "NONE", "None"),
    ("Westminster 1970", "18 Jun 1970", "W", 12, "PARTIAL (BNA: Londonderry+Antrim, 6 articles)", "None"),
    ("Stormont 1969", "24 Feb 1969", "S", 52, "SUBSTANTIAL (BNA: 27 articles across 5 NI papers)", "None"),
    ("Westminster 1966", "31 Mar 1966", "W", 12, "GAZETTE ONLY (1 notice)", "None"),
    ("Stormont 1965", "25 Nov 1965", "S", 52, "GAZETTE ONLY (4 notices)", "None"),
    ("Westminster 1964", "15 Oct 1964", "W", 12, "NONE", "None"),
    ("Stormont 1962", "31 May 1962", "S", 52, "PARTIAL (BNA: Antrim 5 const + Londonderry)", "None"),
    ("Westminster 1959", "8 Oct 1959", "W", 12, "GAZETTE ONLY (2 notices)", "None"),
    ("Stormont 1958", "20 Mar 1958", "S", 52, "GAZETTE ONLY (3 notices)", "None"),
    ("Westminster 1955", "26 May 1955", "W", 12, "GAZETTE ONLY (4 notices)", "None"),
    ("Stormont 1953", "22 Oct 1953", "S", 52, "GAZETTE ONLY (4 notices)", "None"),
    ("Westminster 1951", "25 Oct 1951", "W", 12, "GAZETTE ONLY (5 notices)", "None"),
    ("Westminster 1950", "23 Feb 1950", "W", 12, "GAZETTE ONLY (5 notices)", "None"),
    ("Stormont 1949", "10 Feb 1949", "S", 52, "GAZETTE ONLY (6 notices)", "None"),
    ("Stormont 1945", "14 Jun 1945", "S", 52, "GAZETTE ONLY (2 notices)", "Gazette (returning officer charges)"),
    ("Westminster 1945", "5 Jul 1945", "W", 13, "GAZETTE ONLY (2 notices)", "None"),
    ("Stormont 1938", "9 Feb 1938", "S", 48, "BNA FOUND (7 articles, Northern Whig, not yet captured)", "None"),
    ("Westminster 1935", "14 Nov 1935", "W", 13, "GAZETTE ONLY (10 notices)", "None"),
    ("Stormont 1933", "30 Nov 1933", "S", 48, "GAZETTE ONLY (3 notices)", "None"),
    ("Westminster 1931", "27 Oct 1931", "W", 13, "GAZETTE ONLY (7 notices incl London Gazette)", "None"),
    ("Westminster 1929", "30 May 1929", "W", 13, "GAZETTE ONLY (3 notices)", "None"),
    ("Stormont 1929", "22 May 1929", "S", 48, "GAZETTE ONLY (3 notices)", "None"),
    ("Stormont 1925", "3 Apr 1925", "S", 48, "GAZETTE ONLY (4 notices)", "None"),
    ("Westminster 1924", "29 Oct 1924", "W", 13, "GAZETTE ONLY (10 notices)", "None"),
    ("Westminster 1923", "6 Dec 1923", "W", 13, "GAZETTE ONLY (10 notices)", "None"),
    ("Westminster 1922", "15 Nov 1922", "W", 13, "GAZETTE ONLY (13 notices)", "None"),
    ("Stormont 1921", "24 May 1921", "S", 48, "GAZETTE ONLY (3 notices)", "None"),
]

for name, date, t, c, spn, agent in elections:
    agent_str = f"  Agent: {agent}" if agent != "None" else ""
    print(f"{name:<35} {date:<14} {c:>3} const  {spn}")
    if agent_str:
        print(f"{'':49}{agent_str}")

# Summary
cats = {}
for _, _, _, _, spn, _ in elections:
    if "COMPLETE" in spn and "NEAR" not in spn and "LIKELY" not in spn:
        cats["COMPLETE"] = cats.get("COMPLETE", 0) + 1
    elif "NEAR" in spn:
        cats["NEAR-COMPLETE"] = cats.get("NEAR-COMPLETE", 0) + 1
    elif "LIKELY" in spn:
        cats["LIKELY COMPLETE"] = cats.get("LIKELY COMPLETE", 0) + 1
    elif "SUBSTANTIAL" in spn:
        cats["SUBSTANTIAL"] = cats.get("SUBSTANTIAL", 0) + 1
    elif "PARTIAL" in spn:
        cats["PARTIAL"] = cats.get("PARTIAL", 0) + 1
    elif "BNA NEWS" in spn or "BNA FOUND" in spn:
        cats["BNA NEWS/FOUND"] = cats.get("BNA NEWS/FOUND", 0) + 1
    elif "GAZETTE" in spn:
        cats["GAZETTE ONLY"] = cats.get("GAZETTE ONLY", 0) + 1
    elif "MINIMAL" in spn:
        cats["MINIMAL"] = cats.get("MINIMAL", 0) + 1
    elif spn == "NONE":
        cats["NONE"] = cats.get("NONE", 0) + 1

print(f"\n{'='*80}")
print(f"SUMMARY ({len(elections)} elections)")
print(f"{'='*80}")
order = ["COMPLETE", "NEAR-COMPLETE", "LIKELY COMPLETE", "SUBSTANTIAL",
         "PARTIAL", "BNA NEWS/FOUND", "GAZETTE ONLY", "MINIMAL", "NONE"]
for cat in order:
    if cat in cats:
        print(f"  {cat:<20} {cats[cat]:>3}")
