# council-audit-12b (second pass: County Antrim and the Belfast area): landing notes

Branch `council-audit-12b`, worktree `C:\Users\scomo\civgraph-council-audit-12b`. Built from `council-audit-2`'s tip (68433bbf57) with `council-audit-1` merged in (7ecb1a0398, clean). `council-audit` (1ede439c66) is an ancestor, so this merges into `council-audit` as a fast-forward and carries both fixers' work. Not pushed. Work folder: `D:\civgraph-intake\batch4-2026-11-11\council-audit\fix-12b\` (ledger.csv, review.csv, edits-*.json, img\).

## Commits (data only; no person-id re-stamp)
- bb0367a276 Ballymena RD: Galgorm 1967 Davison 202 -> 262; the 21 unopposed 1946 returns re-cited to BNL 20 Sep 1946 p3.
- 09a8db11ac Newtownabbey 1961 Cavehill: Taggart 408; Belfast 1937 Clifton printed Catherwood; Lisburn RD 1936 Lisnagarvey, 1967 Ballyscolly and Lissue, and Moira RD 1967 Ballyleny re-cited.
- 8e71cce572 Antrim RD 1967 Antrim Rural: Jack Bleakley (was Blakely); printed forms Geo. Bailie (Moira RD 1924) and W. J. M'Clennaghan (Antrim RD 1936); Belfast RD 1936 Ballygomartin and 1955 Monkstown, Antrim CC 1952 Aghalee re-cited.
- 8e116aa70c Ballymena 1929 Market Ward: Andrew Beggs and William Ervine (were W. Beggs, William Irvine); Ballycastle RD 1924 Fair Head re-cited.
- 1c71595222 Ballycastle UD 1939 South re-cited; 1923 South Ward check quote fixed.
- 0d5bc2ffc6 Antrim TC 1923: the second link is the BNA copy of the News-Letter, not the Northern Whig.

## The five items in the brief
1. Not-reached name-not-on-page contests (81 from fix-1, 45 from fix-2): all 126 dealt with. 22 fixed and 104 confirmed-ok. Every flag that led to a fix and most of the confirmations were read on the page image. About 60 confirmations rest on clear OCR context, and the ledger says which.
2. Ballymena RD 1967 Galgorm: Davison 262. The Ballymena Observer, 8 Jun 1967, p. 8 (image) prints Dickey 484, Davison 262, majority 222, and 746 votes cast of an electorate of 1,117 (484 + 262 = 746). The notice cited before is in the Ballymena Weekly Telegraph (masthead "Ballymena Times"), not the Observer.
3. Ballymena RD 1946: the list is in the BNL, 20 Sep 1946, p. 3 (INA BNL19460920.2.69). All 21 names were confirmed on the image and the 21 files re-cited.
4. Taggart (Newtownabbey 1961 Cavehill): 408, printed clearly in the Belfast Telegraph, 18 May 1961, p. 4. It had been read as "about 468" from the News-Letter's cut figure.
5. **Castlereagh RD 1964 `holywood.json` should be renamed `holywood-rural.json`**, to match 1961 and 1967 and the notice heading. Not renamed here. Likewise, **Ballymena RD 1946 `ballykullion.json` should become `ballyscullion.json`** with Constituency_Name "Ballyscullion": the page prints Ballyscullion, as the other 11 rounds do.

## Ledger (fix-12b\ledger.csv, 149 rows)
fixed 39, confirmed-ok 110. Real defects in fixed rows:
- citation-incomplete 33
- name-misread 3
- spelling-variant 2
- vote 2
- other 3

No omitted losers were found. Proni-items reserved files were not touched; Belfast 1964 Dock, Smithfield and Victoria were left alone.

## Re-stamp needed after landing
Run it in the documented order. Changed names:
- Jack Bleakley (Antrim RD 1967);
- Andrew Beggs and William Ervine (Ballymena 1929 Market Ward).

Only Name_As_Printed changed for Catherwood, Bailie and M'Clennaghan.

## Review list (fix-12b\review.csv, 7 rows)
- The other 21 Ballymena RD 1967 files call the BWT notice "Ballymena Observer".
- Lisburn RD 1967: Magheragall, Montiaghs and Tullyrusk cite pages that probably lack the names (Frances or Francis Corey).
- Antrim Rural 1967: Bleakley (BT) or Blakeley (BNL).
- Carrickfergus 1931: six members inferred from a pre-nomination list plus "no contest".
- Merge leads (not made):
  - M'Clennaghan/M'Clenahan, Randalstown Rural;
  - Erwin/Irwin/Ervine, Ballymena Market Ward.
- ballykullion rename.

## Tests
- check:candidate-name-party: PASS.
- tests/unit/ni-council-quality.test.mjs: 3/3 pass.
- tests/elections/ni-local-grouped.test.mjs: NOT RUN. It needs tmp/records (a records build), which fixers must not make.
- ni-council-quality --list --ocr-roots: of the 149 ledger files, 124 are still flagged name-not-on-page. These are OCR garbles of names that are on the page, plus pages missing from the detector's OCR caches (BNA tables split into column articles). None is a data defect. 17 of the 21 Ballymena 1946 files cleared.
- Main: `council-audit` itself does not merge cleanly into main (the person registry files from its re-stamp commit). This branch adds no conflicts of its own, so the lander re-runs the re-stamp after rebasing.

## Files others may touch
Only contest JSON under County Antrim and Belfast-area councils.

## Architecture rules
- Rules touched: none (data-only JSON edits)
- Exceptions added: none; baseline entries added: none
- check:architecture: not run (no code changed); baseline unchanged
- R2 no copies: yes
- R3 real seams, no new dependencies: yes
- R4 one data door: yes
- R8 cleanup beyond listeners (maps, workers, timers): n/a
- R10 text keyed: n/a
- R12 logic pure and tested: n/a
- Prototype deferrals (R14): none
