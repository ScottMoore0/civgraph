# w23-lea-import: Phelim Birch's Local Electoral Areas spreadsheet (DECISIONS-23NOV item 15)

Branch `w23-lea-import`, worktree `C:\Users\scomo\civgraph-w23-lea-import`. Nothing pushed, published or uploaded.

## The sheet
Phelim's Google Sheet (https://docs.google.com/spreadsheets/d/1mNuNNYUzPLIUYcBN6NaGbYqVO4xIqPU-m5FZ-4B6grE) is
**shared with named accounts only**. An anonymous fetch got HTTP 401. The owner exported it as .xlsx through his own
browser on 23 Nov 2026 at 13:36. The raw file stays private and unmodified at
`D:\civgraph-intake\wave19-2026-11-18\w23-lea\phelim-lea-sheet-2026-11-23.xlsx`. It is not in the repository and is
not linked from the site.

- **By Council Area** (A1:AQ130): rows are years 1898-2026 and columns are 42 councils: today's 31, plus the old
  city/county splits and 8 Northern Ireland counties/cities up to 1921. Each cell is one arrangement of a council's
  electoral areas, merged down over the years it was in force (402 merges). Most cells link to the instrument that
  made the arrangement: a Local Government Board annual report on the Internet Archive (1898-1911), an Electoral
  (County) Areas Order of 1925, an Act, or an S.I. Some labels carry "[areas, seats]" ("1898 [32, 32]",
  "1930 [5, 30]"), or "1 EA (1929)", "Wards (1853)", or "?". There are 2 comments by Phelim. Fills: yellow on the
  election years in column A; grey on the cities; black for NI from 1922.
- **List** (A1:C331): the same instruments, grouped by "Following Census Year" (1901-2022). Each row gives the
  instrument, the council area and a link. His legend (A2): "Grey = no census report coverage, red = not mentioned in
  census report, white = mentioned in census report". There are 5 comments, and "???" rows (black) for the census
  years with no census.

## What is in this branch
1. **Source file** `data/intake/2026-11-23-phelim-lea-sheet.json` (385 KB). It transcribes every cell verbatim, with
   link, fill and comments (author "Phelim B"), and every merge. It also restates the two tabs as 409 `arrangements`
   (councils, label, from/to years taken from the merge) and 329 List `instruments`. Provenance: author Phelim Birch;
   licence "Provided by the author for Civgraph"; sheet URL and its named-accounts-only sharing; export time, sha256
   and size; received 21 Nov (answer 2.2); owner approval 23 Nov.
   Link check: each of the 284 distinct links was fetched once, one request at a time with no User-Agent (Internet
   Archive by item), and its status and page title are recorded:
   - 227 Irish Statute Book pages and the 4 Internet Archive items (LGB annual reports 27, 30, 33 and 36): HTTP 200,
     public.
   - The Cork Archives minutes page: 200, public.
   - The Oireachtas OPAC PDF (Dublin wards 1900): returns a "catalogue unavailable" page. **Not usable.**
   - The Irish Newspaper Archives search link (Dún Laoghaire-Rathdown 1930): **subscription, not fetched, not
     linked.**
   A copy of the check is at `D:\civgraph-intake\wave19-2026-11-18\w23-lea\linkcheck-2026-11-23.tsv`.
2. **Script** `scripts/ingest/idb-phelim/import-lea-sheet.mjs`, using the existing `xlsx` dependency. It writes the
   source file, and with `--wire` sets the map references below. It is idempotent: a re-run replaces only the
   references it wrote. It is step `lea-sheet` of the `idb-phelim` ingest plugin (`plugin.mjs`, new input
   `leaSheet`), with its parity entry in `scripts/ingest/parity.json`.
3. **References on the LEA maps** (`data/database/maps.json`). Each edition now cites the orders in Phelim's List
   group for the census that followed it. Each label is the instrument's own title as the Irish Statute Book
   publishes it, verbatim (including the book's own "Managhan" typo in S.I. 290/1998). Each note reads "Listed by
   Phelim Birch in his Local Electoral Areas spreadsheet (List tab, following census year N)." The existing
   references are kept, and each reference's URL was checked as public. They show in the map's Sources panel
   ("References"):

   | Map | List group | References added |
   |---|---|---|
   | roi-lea-2008 | 2011 | 33 (S.I. 427-452/2008, 503-509/2008, 47/2009) |
   | roi-lea-2014 | 2016 | 30 (S.I. 40-70/2014) |
   | roi-lea-2019 | 2022 | 33 (S.I. 610-638/2018, 27, 28, 156 and 157/2019) |
   | Roscommon (2014), DLR (2019), Galway County (2019) council maps | 2016 / 2022 | 1 each (that council's order) |

4. **To Be Added: Local Electoral Areas 1998** (`roi-lea-1998`). This is a placeholder (`placeholder: true`, no
   geometry, no provider) in the `roi-lea` class and in the catalogue row's `toBeAdded`. It cites the 34 S.I.s of
   1998 that Phelim lists under 2002. Every council column in his grid has a 1998 arrangement, and every one of those
   orders is titled "... Local Electoral Areas Order, 1998".
   - Before: the row "Local Electoral Areas (Republic of Ireland)" spans 2008-2019 with 3 editions.
   - After: it spans 1998-2019, with "1 to be added".

No new text was written: no description was changed (the row already has Phelim's description) and no geometry was
drawn or derived.

## Source only (not wired), and why
- **Editions before 1998.** His 1985 orders are titled "County Electoral Areas (Amendment) Order, 1985", and his
  comment on 1986 reads "Called County Electoral Areas and Borough Electoral areas in the census report". So it is
  not settled whether 1919/20, 1925, 1942/45, 1974 and 1985 belong in this row or in a separate CEA/BEA row. 1974
  and 1942/45 were also not national redraws.
- **1898-1918 county electoral divisions.** These fall under the "County Electoral Divisions (Ireland)" row, which
  has county-ed-1911. The LGB report links could cite those editions, but which order covers which edition is a
  judgement for him.
- **"[areas, seats]" counts, "1 EA", "Wards (...)", "?" and "[X, ?]".** Partial, and kept as his text.
- **1994 Dublin orders and the per-council in-between orders** (Kildare 1987, Longford 1990, Waterford 1988, and so
  on): there are no matching editions on the site.

## Questions for the owner / Phelim
1. Should LEA editions before 1998 (1985, 1974, 1942/45, 1925, 1919/20) go in the Local Electoral Areas row, or in a
   separate County/Borough Electoral Areas row? And as which national editions (by order year, or by election year)?
2. Edition naming: roi-lea-2008 and roi-lea-2014 are named by order year, but roi-lea-2019 is named for the 2018
   orders (plus the 2019 Cork, Kerry and Tipperary amendments). Is "1998" right for the 1999/2004 set, or should it
   be "1999"?
3. List C318: S.I. No. 629/2018 is labelled "Cavan". The grid (Monaghan column) and the statute book say Monaghan.
   His text is kept as is; the site label uses the published title.
4. List row 201, "S.I. No. 114/1994 | Carlow, Laois, Louth, Meath (?)", has no link, and the grid has "1994?" for
   those four counties. Is that order confirmed?
5. The Dublin wards 1900 link (opac.oireachtas.ie) shows "Online public catalogue unavailable". Does he have another
   copy?
6. The "[areas, seats]" annotations: does he want them shown (for example as edition notes) once complete?
7. The yellow fills on the year column: are these election years? This is our reading; he gives no legend.

## Checks
`npm run rebuild` in the worktree: **REBUILD OK** (check:fast 86/86, catalogue tests 87 passed, browser 19 passed,
records-check OK). Regenerated by it / i18n:build: catalogue.json, i18n map-name overlay + review TSV/coverage +
names.ga.json, site figures (site-stats, status, about, status page), agent maps index, maps pages, sw.js.
check:architecture: clean against the baseline. The records build is local only (nothing went to D1).

Note for the lander: the 688-line maps.json diff is references only (+ the roi-lea-1998 record and its class entry).

## Architecture rules
- Rules touched: R1 (new script under scripts/, which is in the `scripts` unit; imports `xlsx` and node built-ins
  only); R6 (no registry vocabulary literals; the map ids in WIRING are data ids, as in other ingest scripts); R13
  (only additions: a new map id `roi-lea-1998`, new references; nothing renamed or removed).
- Exceptions added: none. Baseline entries added: none.
- check:architecture: new findings 0; baseline unchanged.
- R2 no copies: yes
- R3 real seams, no new dependencies: yes (`xlsx` was already a dependency)
- R4 one data door: yes (no browser code)
- R8 cleanup beyond listeners: n/a (no async views)
- R10 text keyed: n/a (no interface text; reference labels and notes are data)
- R12 logic pure and tested: n/a (a one-off ingest script, as the other scripts/ingest scripts)
- Prototype deferrals (R14): none
