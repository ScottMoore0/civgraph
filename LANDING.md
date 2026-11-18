# LANDING: w19-council-audit (NI council results 1921-67: detectors, then fixes from page images)

Branch `w19-council-audit` (rebased on main 4ddb9c1d74; main's 7 new commits touch none of these files), worktree `C:\Users\scomo\civgraph-w19-council-audit`. Owner decision 10 (18 Nov 2026). Not pushed, not published. Work folder: `D:\civgraph-intake\wave19-2026-11-18\council-audit\`.

## Commits

1. `90b290f41f` check:ni-council-quality: three new detectors and a ranked list (code + unit tests + CHECKS.md).
2. `b98c125b50` the town polling-day lead skips rounds whose note explains the date.
3. `b3e7d13fdf` batch 1 data: 6 contests corrected from page images.
4. `fa10086cf5` person-id re-stamp after batch 1 (exactly 3 stamps move; 3 retired ids redirect), grouped NI years 1939/1952/1967 rebuilt.

## Phase 1: detectors

The §4 detectors already existed: `scripts/check/rules/ni-council-quality.mjs` (council-audit, 11 Nov). They were re-run over every live 1921-67 NI council contest, and extended:

- **name-initials** (new): a forename printed only as initials, where the same council within two rounds has the same surname with a written-out forename of those initials. With `--persons` (reads the records build's stamps through `recordPaths()`), only pairs the registry holds as two people are reported.
- **poll-date** (new), three checks:
  - a CC/RD round filed on a different day from its county's (CC and RDs polled the same day);
  - a town round more than a week from the towns' common day (low; rounds whose note explains the date are skipped);
  - a polled contest whose every cited issue is dated before the poll.
- **omitted-loser** now also fires on a recorded poll or majority with no defeated candidate and no votes.
- **`--ranked-csv`**: one row per flagged contest, with:
  - reason codes;
  - confidence, the odds that a real defect is there, per flag type from the Nov 2026 fixers' hit rates (fixed / (fixed + confirmed-ok) in their ledgers);
  - people touched.
- **`--reviewed`** reads earlier fixers' ledgers (file, flag_types, action). Where a fixer passed the contest, each flag type that fixer saw, and any name or citation flag, keeps a tenth of its odds.
- Unit tests: `tests/unit/ni-council-quality.test.mjs`, 7/7 (initialsOf, name-initials with and without the registry, poll-date, citedDates, ranking and sinking).

**Run over all 10,787 NI council contests 1921-67** (82 bodies, of which 6,065 are DeepSeek), with OCR caches of 7,335 cited pages. After batch 1, 4,834 contests are flagged, 2,413 of them DeepSeek. Contests flagged, by reason:

| Reason | Contests |
|---|---|
| NAME-INIT | 1,675 |
| CITE | 1,520 |
| NOT-ON-PAGE | 1,407 |
| TABLE-SUMMARY | 653 |
| AREAS | 347 |
| NAME-RARE | 110 |
| NAME-OCR | 84 |
| NAME-VAR | 66 |
| SEATS | 42 |
| PARTVOTE | 17 |
| OMIT-OCR | 12 |
| OMIT | 9 |
| ARITH | 8 |
| DATE | 5 |
| REGVOTE | 4 |

By confidence:

| Confidence | Contests |
|---|---|
| ≥ 0.5 | 19 |
| 0.25-0.5 | 14 |
| 0.1-0.25 | 379 |
| < 0.1 | 4,422 |

1,566 contests were seen by an earlier fixer.

**Files** (in the work folder):
- `flags-ranked.csv`, and `flags-ranked-where.csv` (which archive holds each cited page);
- `flags\<council>.csv`;
- `person-split-leads-initials.csv`.

**New finding: split people.** 2,404 initials-only candidacies (1,895 distinct id pairs) sit on a different person id from a written-out namesake of the same council within two rounds. 1,927 of them are in the same division. An example: J. Connellan (Newry 1949, 143331) and Joseph Connellan (1946/1952, 139487). This is person-registry work: a same-division initials-compatible merge class, with Snr/Jnr care. It is not page reading, so it was not merged here.

## Phase 2: batch 1 (the INA-readable top of the ranking)

202 contests decided (`ledger.csv`):

| Outcome | Contests | How decided |
|---|---|---|
| Fixed | 6 | |
| Confirmed-ok | 172 | about 30 on the image; 142 by every surname being on the cited page's full INA text (exact, or one OCR letter off), or the flagged rare spelling printed exactly so |
| Review | 24 | |

The 6 fixes:

| Contest | Change | Defect |
|---|---|---|
| Newry UD 1967 West Ward | printed 'T. M'Gragh' recorded as T. McGrath, the ward's 1964 Irish Labour member | spelling-variant |
| Banbridge UD 1939 West Ward | W. E. Hooten -> W. E. Holton (printed 'Holten'; Holton in his 8 later returns) | name-misread |
| Portrush UD 1952 | E. Stanfield -> S. Stanfield (the nominations and his 1946-58 returns) | initials |
| Ballymoney RD 1961 Vow | re-cited from an Irish News page without the result to BNL 2 Jun 1961 p9 and 17 May 1961 p5 | citation-incomplete |
| Omagh UD 1952 West, Enniskillen 1939 South | printed forms W. Drum and R. Hanon recorded in Name_As_Printed | other |

- **Changes made:** no candidacies added, 3 renamed, no votes changed.
- **Ids:**
  - 3 stamps move: 142602 -> 142600, 143269 -> 138879, 143186 -> 142431;
  - each retired id has a redirect row in `person_id_confirmed_merges.csv`;
  - one confirmed same-ward row joins Newry's 1967 T. McGrath to his 1964 return (the registry splits same-name rows whose party keys differ);
  - no other stamp changed (all 85,287 candidacies compared with main's snapshot).
- **Sample re-check** (`sample-check.csv`): 10 OCR-confirmed contests, seed 20261118, 9 checked, 0 defects. Caveat: I checked it myself, not a separate agent, and only 2 on the image.
- **Real defect rate in batch 1:** 6 of 178 decided (3.4%). The `NOT-ON-PAGE` flags on INA pages are overwhelmingly OCR garbles of the printed name.

## What remains (ranked; `flags-ranked-where.csv`, excluding contests decided in ledgers)

| Band | Contests | BNA only | INA | Both | No link / other |
|---|---|---|---|---|---|
| A (conf ≥ 0.25) | 33 | 13 | 4 | 7 | 9 |
| B (0.12-0.25) | 309 | 242 | 34 | 25 | 8 |
| C (0.05-0.12) | 1,347 | 358 | 589 | 114 | 286 |
| D (< 0.05) | 2,969 | 825 | 947 | 129 | 1,068 |

- Band A+B touches about 664 people. Most is NOT-ON-PAGE 281, NAME-INIT 99, CITE 31, NAME-RARE 26, AREAS 23, NAME-VAR 17, OMIT 9, PARTVOTE 9.
- **The bulk needs BNA page images.** BNA's images and OCR return 403 without the owner's session, and I did not use his cookie. `login-pages.csv` lists 148 BNA pages ranked by the flagged weight each would settle:
  - Northern Whig, 20 Sep 1946, p. 3 (47 contests: 1946 rural nominations);
  - Northern Whig, 7 May 1927, p. 2 (45: Fermanagh RDs);
  - Ballymena Weekly Telegraph and Ballymena Observer, 20 May 1949 (19 each);
  - Northern Whig, 21 May 1958, p. 9 (16);
  - Belfast News-Letter, 21 May 1958, p. 11 (14);
  - Belfast Telegraph, 31 May 1961, p. 20 (12);
  - Londonderry Sentinel, 26 Apr 1924, p. 2 (8).
- **INA remainder** (band C, 589 INA-only contests): `tools\autofind.py` + `exact.py` clear most mechanically. About 30% go to image reads at about 3 min each.
- **Unresolvable online** (review): the top "review" contests need papers that are not on INA:
  - Newtownards 1955, four wards: the five defeated were printed without wards; needs the Newtownards Chronicle;
  - Newcastle UD 1946 (12 defeated) and 1967 (2): needs the Mourne Observer or Down Recorder;
  - Portstewart 1964: the Northern Constitution;
  - Cookstown 1964: the Mid-Ulster Mail;
  - Dromore 1955, ninth member: Dromore Leader or Banbridge Chronicle;
  - Gilford 1932: the PRONI minute book LA/77/2/BA/1;
  - Monkstown 1955: the printed majority 144 does not fit the printed 440/298; needs the BT or the Whig.
- **Estimate** [inferred]:

  | Work | Effort |
  |---|---|
  | Band A+B with BNA access | about 25-35 agent-hours (2-3 fixers in parallel by county); most pages settle 5-47 contests each |
  | Band C, INA mechanical pass | about 2 hours machine time |
  | Band C, the image reads it leaves (about 180) | about 9-10 agent-hours |
  | Band D | low value; leave |
  | Initials split-person merges | a persons stream: a merge class + review, about 4-6 hours |

## Tools for further fixers

`D:\civgraph-intake\wave19-2026-11-18\council-audit\tools\` and `FIXER-NOTES.txt`.

- The INA helper sends no identifying header and no cookie.
- INA search returns nothing to a plain client now, so `scan.py` walks issues page by page instead.

## Tests

- `node --test tests/unit/ni-council-quality.test.mjs`: 7/7.
- `npm run check:fast`: 86/86, after rebuilding the grouped years and, locally, the election provenance.
- `npm run test:elections-unit`: 47/47.
- `check:types:pipeline` and `check:architecture`: clean.
- eslint: clean.

## Landing steps

1. Rebase/merge onto main. The data files touched are 6 contest JSONs plus `data/elections/persons/*` and 3 `render/metadata/ni-local` years.
2. If main's persons files moved: restore `data/elections/persons/` from main, keep the 4 appended rows of `person_id_confirmed_merges.csv`, and rerun `MANIFEST_ARGS=--withhold-unmappable npm run persons:rebuild`. Expect the same 3 stamp moves.
3. Then rebuild the grouped years and the records data path as usual. The election provenance must be rebuilt: the Vow citation changed.

## Files others may touch

- 6 contest files:
  - `newry-urban-district-council/1967-05-17/west-ward.json`
  - `banbridge-urban-district-council/1939-05-15/west-ward.json`
  - `portrush-urban-district-council/1952-05-21/portrush.json`
  - `ballymoney-rural-district-council/1961-06-01/vow.json`
  - `omagh-urban-district-council/1952-05-21/west-ward.json`
  - `enniskillen-borough-council/1939-05-15/south-ward.json`
- `data/elections/persons/*`
- `render/metadata/ni-local/{1939,1952,1967}.json`
- `scripts/check/rules/ni-council-quality.mjs`, its test and `CHECKS.md`.

## Architecture rules
- Rules touched: R4: the detector reads the records build's bundles through `recordPaths()` from `@civgraph/config` (`--persons`); it opens no database. R11: the new functions are typed in JSDoc, and `ni-council-quality.mjs` still type-checks under `config/tsconfig.pipeline.json`. R12: the new logic (initialsOf, initialsOnlyFindings, pollDateFindings, citedDates, rankContests) is pure and unit-tested.
- Exceptions added: none; baseline entries added: none
- check:architecture: new findings 0; baseline unchanged
- R2 no copies: yes
- R3 real seams, no new dependencies: yes
- R4 one data door: yes
- R8 cleanup beyond listeners (maps, workers, timers): n/a (a CLI)
- R10 text keyed: n/a (report text of a check script)
- R12 logic pure and tested: yes
- Prototype deferrals (R14): none
