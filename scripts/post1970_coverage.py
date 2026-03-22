#!/usr/bin/env python
"""Post-1970 NI election SPN/Agent coverage report."""

elections = [
    ("Westminster 2024", "4 Jul 2024", 18, "COMPLETE", "18/18 (EONI)", "Partial (1 PDF)"),
    ("Local 2023", "18 May 2023", 80, "COMPLETE", "80/80 DEAs (EONI+councils)", "Partial"),
    ("Assembly 2022", "5 May 2022", 18, "COMPLETE", "18/18 (EONI, Belfast South from IA)", "Partial (2 PDFs)"),
    ("Westminster 2019", "12 Dec 2019", 18, "COMPLETE", "18/18 (EONI)", "Partial"),
    ("Local 2019", "2 May 2019", 80, "NEAR-COMPLETE", "~73/80. L&C nominations page found on IA, pending download. Could complete all 80.", "Partial"),
    ("European 2019", "23 May 2019", 1, "COMPLETE", "1/1 (EONI)", "Yes (1 PDF)"),
    ("Westminster 2017", "8 Jun 2017", 18, "COMPLETE", "18/18 (EONI)", "None"),
    ("Assembly 2017", "2 Mar 2017", 18, "COMPLETE", "18/18 (EONI)", "Yes (19 MDs)"),
    ("Assembly 2016", "5 May 2016", 18, "COMPLETE", "18/18 (EONI)", "Yes (17 MDs)"),
    ("Westminster 2015", "7 May 2015", 18, "COMPLETE", "18/18 (EONI)", "None"),
    ("European 2014", "22 May 2014", 1, "COMPLETE", "1/1 (EONI)", "None"),
    ("Local 2014", "22 May 2014", 80, "NEAR-COMPLETE", "~69/80 (86%). Belfast 7/10, missing Mid Ulster 7, L&C 6, A&N 7.", "Yes (~50 agent files)"),
    ("Assembly 2011", "5 May 2011", 18, "PARTIAL", "9-17/18 from EONI MDs+PDFs", "Partial (2 MDs)"),
    ("Local 2011", "5 May 2011", 101, "PARTIAL", "~25/101 DEAs. Craigavon 4, Strabane 3, Omagh 3 pending, Moyle 3, Coleraine 4, Belfast 2+9XLS, Down combined, Ballymena 5 results.", "Yes (~30 agents)"),
    ("Westminster 2010", "6 May 2010", 18, "BNA NEWS", "No formal SPN. 9+ BNA articles.", "None"),
    ("European 2009", "4 Jun 2009", 1, "BNA NEWS", "No formal SPN. 27+ BNA articles.", "None"),
    ("Assembly 2007", "7 Mar 2007", 18, "BNA NEWS", "No formal SPN. 20+ BNA articles.", "None"),
    ("Westminster 2005", "5 May 2005", 18, "COMPLETE", "18/18 (FOI on Yumpu, 20 page images with proposers/seconders/assentors)", "Full (in SPN)"),
    ("Local 2005", "5 May 2005", 101, "PARTIAL", "~15/101. Derry 5, Newtownabbey 2/4, Limavady 1, Ballymoney 1. Antrim pending.", "Partial"),
    ("Assembly 2003", "26 Nov 2003", 18, "BNA NEWS", "No formal SPN. 10+ BNA articles.", "None"),
    ("Local 2001", "7 Jun 2001", 101, "NONE", "No digital source found.", "None"),
    ("Westminster 2001", "7 Jun 2001", 18, "NONE", "No digital source found.", "None"),
    ("European 1999", "10 Jun 1999", 1, "NONE", "No digital source found.", "None"),
    ("Assembly 1998", "25 Jun 1998", 18, "GAZETTE", "Gazette procedural notices only.", "None"),
    ("Westminster 1997", "1 May 1997", 18, "NONE", "No BNA coverage. Gazette procedural.", "None"),
    ("Local 1997", "21 May 1997", 101, "NONE", "No digital source found.", "None"),
    ("Forum 1996", "30 May 1996", 18, "GAZETTE", "Gazette procedural. BNA may have coverage.", "None"),
    ("European 1994", "9 Jun 1994", 1, "GAZETTE", "Gazette procedural only.", "None"),
    ("Local 1993", "19 May 1993", 101, "NONE", "No digital source found.", "None"),
    ("Westminster 1992", "9 Apr 1992", 17, "NONE", "No BNA or digital source.", "None"),
    ("Local 1989", "17 May 1989", 101, "NONE", "No digital source found.", "None"),
    ("European 1989", "15 Jun 1989", 1, "GAZETTE", "Gazette procedural.", "None"),
    ("Westminster 1987", "11 Jun 1987", 17, "COMPLETE", "17/17 (BNA Belfast Telegraph pp18-19)", "None"),
    ("Local 1985", "15 May 1985", 101, "BNA FOUND", "BNA Londonderry Sentinel has SPNs. Not yet systematically captured.", "None"),
    ("European 1984", "14 Jun 1984", 1, "GAZETTE", "Gazette procedural.", "None"),
    ("Westminster 1983", "9 Jun 1983", 17, "COMPLETE", "17/17 (BNA Belfast Telegraph pp16-17)", "None"),
    ("Assembly 1982", "20 Oct 1982", 12, "NONE", "No BNA or digital source.", "None"),
    ("Local 1981", "20 May 1981", 101, "NONE", "BNA search URL generated, not yet checked.", "None"),
    ("European 1979", "7 Jun 1979", 1, "GAZETTE", "Gazette procedural.", "None"),
    ("Westminster 1979", "3 May 1979", 12, "LIKELY COMPLETE", "BNA Belfast Telegraph pp17-18, screenshots captured.", "None"),
    ("Local 1977", "18 May 1977", 101, "NONE", "BNA search URL generated, not yet checked.", "None"),
    ("Convention 1975", "1 May 1975", 12, "COMPLETE", "12/12 (BNA Belfast News-Letter pp11-13)", "None"),
    ("Westminster Oct 1974", "10 Oct 1974", 12, "NONE", "BNA no results.", "None"),
    ("Westminster Feb 1974", "28 Feb 1974", 12, "NONE", "BNA no results.", "None"),
    ("Assembly 1973", "28 Jun 1973", 12, "PARTIAL", "Londonderry only (1/12).", "None"),
    ("Local 1973", "30 May 1973", 26, "NONE", "No digital source found.", "None"),
    ("Westminster 1970", "18 Jun 1970", 12, "PARTIAL", "Antrim + Londonderry (2/12).", "None"),
]

for name, date, c, status, spn, agent in elections:
    print(f"{name:<28} {date:<14} {c:>3}  {status:<17} {spn}")
    if agent != "None":
        print(f"{'':>63}Agent: {agent}")

cats = {}
for _, _, _, status, _, _ in elections:
    cats[status] = cats.get(status, 0) + 1
print()
print(f"SUMMARY ({len(elections)} post-1970 elections):")
for s in ["COMPLETE", "LIKELY COMPLETE", "NEAR-COMPLETE", "PARTIAL",
          "BNA FOUND", "BNA NEWS", "GAZETTE", "NONE"]:
    if s in cats:
        print(f"  {s:<18} {cats[s]:>3}")
