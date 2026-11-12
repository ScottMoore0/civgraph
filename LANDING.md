# council-audit-3b: landing notes (second pass on County Down and Armagh)

Fixer 3b, 12 Nov 2026. Branch `council-audit-3b`, worktree `C:\Users\scomo\civgraph-council-audit-3b`, stacked on `council-audit-3` (dbce4a0b7c), which is stacked on the coordinator branch `council-audit`. Data-only: 47 contest JSON files, no code, no person files, no re-stamp, no new or renamed files. Not pushed. Work folder: `D:\civgraph-intake\batch4-2026-11-11\council-audit\fix-3b\` (ledger.csv, review.csv, img\, scripts).

Not rebased on main: main's commits since the shared base (802d27589d) touch none of my 47 files (checked), so this lands on top of `council-audit-3` the same way fix-3 does.

## Commits (on top of council-audit-3)

- bdb46ed2ee Bangor 1958: the five `*-alderman.json` contests now have Seat_Type "Alderman" (was "Councillor"); the note no longer says all five aldermen were unopposed (Ballyholme's was contested).
- e79e8ac0a6 Newry No. 1 RD 1930 (10 files) re-cited to the Newry Telegraph, 3 May 1930, p. 2 (BNA art 2); the old Newry Reporter link led to a masthead and that issue has no list. South Down (Kilkeel) RD 1936 (all 19 files) re-cited to the Newry Reporter, 7 May 1936, p. 6 ("Kilkeel Rural Council", BNA art 25); the Belfast Telegraph, 7 May 1936, p. 6 has no such article. All 29 names checked on the images; Damolly 1930 A. Hemming -> A. Henning; four 1936 Name_As_Printed set to the printed Wm./Thos./Geo.
- ea52aa180c Newry West 1955: W. Shane -> B. M'Shane; M. M'Guigan 606 -> 608 (printed; order confirms). Newcastle 1955 Name_As_Printed J. Trainer.
- 2f74521c22 Kilkeel RD 1955 Ballymartin: Name_As_Printed Newall (name kept Newell).
- 01cb5d9aab Warrenpoint Labour labels (task 3, below) and Warrenpoint West 1955 M. J. Berry -> Barry. (The message says 13 relabelled; the true count is 16 from NI Labour, plus 9 others: see below.)
- 8da2c2934c Donaghadee North 1952 J. M'Calg -> J. M'Caig; Donaghmore (Newry No. 1) 1946 Edward J. -> Edward T. Brady; Dromore (Down CC) 1952 Name_As_Printed Cresswell.
- dd3d3237ab Carrowdore (North Down RD) 1927: printed "Alex. Adam (old)", recorded as Adams (the sitting member, printed Adams in 1924).

## Task 3: Warrenpoint Labour rows (every affected file)

Changed (Party_Name -> Irish Labour, colour #A0A0A0; Party_As_Printed set to the printed label; Name_As_Printed keeps the first-cited paper's string):
- `warrenpoint-urban-district-council/1958-05-21/west-ward.json`: 6 rows (NT 24 May 1958 p. 4 prints "Irish Labour"/"I.L.").
- `warrenpoint-urban-district-council/1958-05-21/east-ward.json`: Duffy, Gray ("Irish Labour"); NT citation added.
- `warrenpoint-urban-district-council/1955-05-18/west-ward.json`: 7 rows ("I.L.", "Irish Labour ... full team of seven"); NT 21 May 1955 p. 7 cited.
- `warrenpoint-urban-district-council/1955-05-18/east-ward.json`: Magennis ("Irish Labour"); NT cited.
- `warrenpoint-urban-district-council/1961-05-17/west-ward.json`: 7 "Eire Labour"/"E.L." rows had no Party_Name -> Irish Labour.
- `warrenpoint-urban-district-council/1967-05-17/east-ward.json`: "(I.L.)" Boyle, M'Neill were Independent Labour -> Irish Labour (BNL heads the ward "Irish Lab. gain one seat").

Left, in review: 1952 West (cited Newry Reporter prints no labels; file splits Irish Lab./Lab.), 1946 and 1936 West (papers print only "Labour"; NI Labour is an inference), 1949 West (P. Barry printed "Ind. Lab.", kept), 1923 West (generic "Labour", kept). 1964 East/West and 1967 West were already Irish Labour.

## Landing / rebuild

1. Fast-forward `council-audit-3` to `council-audit-3b` (or merge into `council-audit` after council-audit-3).
2. Person-id re-stamp in the documented order (memory project_ei_person_ids.md). Renamed candidates should keep their ids: A. Henning (Damolly 1930), B. M'Shane (Newry West 1955), M. J. Barry (Warrenpoint West 1955), J. M'Caig (Donaghadee North 1952), Edward T. Brady (Donaghmore 1946), Alex. Adams (Carrowdore 1927). No rows added.
3. Records build, grouped pre-1973 rebuild; the party changes reach the person cards' parties (`person_card_parties`) at the next records build.
4. Renames for the coordinator (fixers may not rename): `south-down-rural-district-council/1936-06-04/lismore.json` -> `lisnacree.json` (printed "Lisnacree - P. Doyle", as 1930/1939); `maghereagh.json` (printed "Maghereagh - Geo. Annett") possibly -> `maghera.json` as 1930/1939 file him.

## Tests

- `npm run -s check:candidate-name-party`: PASS (43,834 rows, no new artefacts).
- `node --test tests/unit/ni-council-quality.test.mjs`: 3/3 pass.
- `node --test tests/elections/ni-local-grouped.test.mjs`: NOT RUN; it reads `tmp/records/elections-test2.json`, which only a records build makes (forbidden in fixer worktrees). Run after the coordinator's build.
- `ni-council-quality.mjs --list --ocr-roots ...`: 16 of the 47 fixed contests no longer flag. The rest are expected: the 19 South Down 1936 files still flag name-not-on-page because the detector's page cache does not hold the newly cited Newry Reporter article (refresh the OCR cache); Damolly 1930 (OCR "Henniug"); confirmed-ok contests keep their OCR-misread flags.

## Ledger (fix-3b\ledger.csv, 182 rows)

fixed 47, confirmed-ok 104, review 1, not-reached 30 (15 of these: the name was searched on every cited page and not found, so the name is probably on another page). Real defects: citation-incomplete 29, other 11 (Seat_Type 5, party labels 6 files), name-misread 4, spelling-variant 4, initials 1, vote 1, areas 2 (renames). Of fix-3's 145 not-reached contests: 115 now resolved (104 confirmed-ok on the image, 10 fixed, 1 review), 30 still not reached.

## Review list (fix-3b\review.csv, 7 rows)

Lismore/Maghereagh 1936 renames; Warrenpoint 1952 labels; Warrenpoint 1936/1946 NI Labour inference; W. Grey/Gray 1955; C. C. Stewart's blotted figure (Donaghadee 1952); Maghera 1927 P. vs Hugh M'Cartan.

## Files others may touch

Only contest files of my councils (Bangor, Newry No. 1 RD, South Down RD, Newry UD, Newcastle UD, Warrenpoint UD, Donaghadee UD, Down CC, North Down RD). No overlap with main or council-audit-3's other commits.

## Architecture rules

- Rules touched: none (data-only contest JSON edits; no code)
- Exceptions added: none; baseline entries added: none
- check:architecture: not run (no code changed); baseline unchanged
- R2 no copies: yes
- R3 real seams, no new dependencies: yes
- R4 one data door: yes
- R8 cleanup beyond listeners (maps, workers, timers): n/a
- R10 text keyed: n/a
- R12 logic pure and tested: n/a
- Prototype deferrals (R14): none
