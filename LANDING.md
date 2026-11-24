# LANDING: w23-bna-split3 (owner approval of 24 Nov 2026: "all remaining BNA work", part 3)

Branch `w23-bna-split3`, worktree `C:\Users\scomo\civgraph-w23-bna-split3`, from main 64cf711e13, rebased on main 85136c8604 (no persons files changed on main meanwhile, so no re-stamp was needed). Nothing pushed, published or
uploaded. Continues w23-bna-split parts 1-2 (landing\w23-bna-split.md) with the same mechanism: a split re-keys rows with a
declared key in `label-blanked-identity-keys.csv` (a new key for a new person, or the destination man's own key for a split
and join) plus a kept-apart row; a join is a `person_id_confirmed_merges.csv` row keeping the lowest id; display names in
`display-names.csv`. Every row carries the tag `w23-bna-split3`.

Evidence: `D:\civgraph-intake\wave19-2026-11-18\bna-split\batch-9` ... (decisions.csv with one row per unit and its
citations; spec-N.json = the rows appended); helpers in `bna-split\tools3\` (batchN.py hold the decisions as data).

## Method

The owner's signed-in BNA in one tab of my own in his Chrome (closed at the end); his tabs untouched; no sign-in, settings,
downloads or CAPTCHA. Search-result snippets only (no page opened). Facts and citations only; addresses kept to town or
townland. The Lennon Wylie directories were not needed for any decision in this part.

## Batches (commits after the rebase)

- Batch 9 (91b7e19232; pairs and conflicts of bna7 rank7.txt): split by place, both sides on page evidence: Thomas Neill (pairs 494/502:
  Tandragee 1905-23 -> 137939; Dungannon Central Ward 1936-55 -> 135502, the Dungannon chairman who died in 1955), James Quinn (499:
  Armagh Rural Middletown 1899-1905 -> 136844; Dungannon West Ward 1926-49 -> 135882), W. J. Workman (121: Ballyclare -> 139681; Larne
  Inver -> 142849), John Jackson (522: Leggygowan -> 137043; Tartaraghan, John Jackson jun. -> 135843). Conflicts joined: 1048 McKinney
  1961/1967 -> Fred (Frederick J.) McKinney 135801; 506 Walker 1946/1952 -> 139424 (John Walker, died 1952); 523 Chambers 1952 -> 147240
  (William Lewis Chambers, same contest); 922 Joseph C. Patterson -> 145918 (kept apart from John J. Patterson). Kept apart: 477
  (the 1967 P. McGrath is Paul). Left: 568 Morrow. 20 stamps moved; 8 retired (136554, 136610, 137524, 137525, 141349, 141488, 147391,
  148187), 0 new.
- Batch 10 (50f210ae88; part-2 undecidables): split to a new person: S. Moore (Armagh 1961), W. Morrison (Newtownards 1967), W. Harvey
  (Whitehead 1952), David Patterson (Killyman 1964), Hugh Reilly (Fermanagh CC Crom 1967); split and join: A. McGowan Whiteabbey 1964/67
  -> 143219 (kept apart from the Londonderry alderman 138833); John Conway pair 1070 (Banagher 1964 -> 144187, Loughash 1936 -> 147582),
  with a guard key for the Armagh 1899 John Conway (137000): the first run of this batch folded him into 147582 because the two ids
  shared the key `John Conway|Nationalist Party`; backed out and rerun from the committed generated files. Joined: J. Crawford 1936 ->
  145925 (167774 retired), J. McCormick 1961 -> 148087 (167807 retired). Kept as one: 142047 R. J. Finlay, J.P. 17 stamps moved;
  2 retired; 5 new (168470, 168476, 168488, 168508, 168509).
- Batch 11 (df5bc63c60; part-1 split leads): split to a new person: Isaac Baxter (Bangor Dufferin 1927-33), Alexander Robb (Ballywalter
  1933, the member being John A. Robb), William J. Caldwell (Lisnaskea Deerpark 1949), J. Murphy (Dungannon West Ward Labour 1946-49),
  John W. Henderson (Hillsborough Ballyskeagh 1967); split and join: J. McAlinden 1936 -> John M'Alinden 135718. 10 stamps moved;
  0 retired; 5 new (168531, 168560, 168588, 168606, 168631).
- Batch 12 (6aeeb0908d; over-merge pairs): 322 W. H. Smith (Clogher rows -> William Helfrich Smith 147260), 92/476/864 Brady (Newry 1949
  -> James Brady 141384; Minterburn 1967 -> Joshua Brady 148197), 1063/1074 Robert Lyons (Markethill -> 135984; Donemana -> 135646,
  137433 joined), 928 O'Kane (Belfast 1920 to a new person; Camderry 1952 -> 133985), 770 Patrick Quinn (Newbridge -> 137323;
  Carrickmore -> 147615; Castleblayney 1899 new), 997 James Kelly (Carrickfergus new), 531 Peter O'Neill (Meenagh 1964 new), 399
  Robert Brown (Downpatrick 1924 -> 146725; Dungannon 1967 new). 27 stamps moved; 2 retired (134782, 137433); 5 new (168681, 168701,
  168704, 168733, 168734).
- Batch 13 (e19dc16f9b; pairs 95/938 Mullan): Glenariff man -> 136764, Loughmacrory/Carrickmore man -> 143958, kept apart; Armagh rows
  1902-14 left. 8 stamps moved; 0 retired; 0 new.

Totals: 82 stamps moved, 12 ids retired (each answering), 15 new ids (`bna-split
ew-person-ids-part3.csv`).

## Checks (each batch)

- `MANIFEST_ARGS=--withhold-unmappable npm run persons:rebuild`: PERSON IDS OK, each from the previous batch's committed generated files.
- Stamp diff against the previous batch: 0 candidacy keys lost or gained; every moved row one the batch meant to move (checks.txt per batch).
- Every retired id answers (keepcheck.py); every confirmed-merge keep resolves (redirectcheck.py: 0); no published person id newly
  fails to resolve (pubcmp.py: 483 before and after, all pre-existing).
- `npm run records:build`, then `tests/records/published-person-addresses.test.mjs`: pass. `npm run test:elections-unit`: 49 pass.
- For the coordinator's post-landing rebuild, as before: browse, graph, records, site figures and sitemap from main's full build.

## Left for the owner (undecidable)

- Conflict 568 Morrow (Clabby: Thomas J./T./S./T. Morrow; several Thomas Morrows at Clabby).
- Part-2 leads: 147229 W. A. Elliott (Florencecourt 1949 / Enniskillen South Ward 1958), 139004 J. Neill (Bangor 1928-31 / Coleraine
  1949), 146523 Michael Fox, 145907 J. Armstrong (each within one county; not searched further).
- Part-1 leads: 136048 W. J. Black (1902 Armagh CC candidate vs the Killeen member, J.P., 1936-53), 146751 R. J. Johnston,
  139456 John Baird.
- Over-merge pairs (`bna-split\overmerge-pairs-part3.csv`): 34 still undecidable: 20 Wilson, 81 Johnston, 136/658 Hunter, 267/448/453/721
  Hamilton, 281 Craig, 315/776 Kelly, 351 O'Neill, 395 M'Cullough, 446/452 Gibson, 447/507/556 Murphy, 449 Johnston, 451 Russell,
  456 Johnston, 504/516/1062 Stewart, 509 Quinn, 510 Brown, 589 Johnston, 712/873 Maguire, 756 Anderson, 789 Wilson, 904/905 White,
  1075 Gallagher; remnants: 136764/136953 Armagh Mullan rows, 137411 (Portadown 1939, Holywood 1964), 139000/139018 Portrush Kellys
  and the Lisburn 1946 J. Kelly, 140030 P. O'Neill (Limavady Rural 1964), 141096 J. Brady Aughnacloy 1946.
- Leads, not applied: 142722 -> 94597 (Limavady W. Morrison 1964 = William Morrison?); 139233, 140312 -> 138833 (Londonderry North
  McGowan 1952/55); 167790 John Walker 1929-39 East Ward probably 139424.

## If main's persons files move before landing

Take main's generated persons files (registry, merges, name registry, corrections, alias candidates), re-append this branch's rows
(`grep -e w23-bna-split3` in label-blanked-identity-keys.csv and display-names.csv; the kept-apart and confirmed rows carry
"w23-bna-split3" in their evidence text), re-run the persons rebuild once from those clean generated files, then keepcheck and
pubcmp. Note: a persons rebuild over an already-rebuilt tree renumbers the merge pass's transient drop ids (no live id changes).

## Architecture rules
- Rules touched: R13 (person ids: retired ids each answer through a confirmed row; new ids only for split-off men); R6 (data rows only)
- Exceptions added: none; baseline entries added: none
- check:architecture: not affected (data rows only)
- R2 no copies: yes
- R3 real seams, no new dependencies: yes
- R4 one data door: yes
- R8 cleanup beyond listeners (maps, workers, timers): n/a (no UI code)
- R10 text keyed: n/a (no interface text)
- R12 logic pure and tested: yes (no repository logic; helpers in tmp/scratch, untracked; copies in bna-split\tools3)
- Prototype deferrals (R14): none
