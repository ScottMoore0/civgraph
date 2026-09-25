# Walker election volumes

Tools for reading the election tables in B. M. Walker's two reference volumes and
checking Civgraph's figures against them.

    Parliamentary Election Results in Ireland, 1801-1922  (Royal Irish Academy, 1978)
    Parliamentary Election Results in Ireland, 1918-92    (Royal Irish Academy, 1992)

## The books are not in this repository

Both are in copyright. They are held privately as page scans; point `WALKER_DIR` at the
folder containing them. Election results are facts and carry no copyright, so the figures
may be used and cited — Walker's own prose, notes and maps may not, and nothing here
reproduces them.

## Running

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> \
      python scripts/walker/extract.py walker-ireland-1801-1922.pdf 146 151

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> \
      python scripts/walker/check_against_civgraph.py \
        --volume walker-ireland-1801-1922.pdf --pages 146-151 \
        --body house-of-commons-of-the-united-kingdom

Page numbers are 0-based indexes into the assembled PDF, not printed page numbers. Omit
`--date` and the pages are aligned to whichever Civgraph election their figures reproduce.

Needs `pypdf`, `pillow`, `pytesseract` and a Tesseract binary. `TESSERACT_CMD` can be
omitted where Tesseract is already on the path.

## What was hard, so it is not rediscovered

**The rows are bowed, not skewed.** One line of the 1885 tables runs cy 1356 → 1277 →
1344 across the page: 79px of deviation against a 54px word height, falling then rising.
That is page curl from a bound book. Measured skew is 0.0° and deskewing changes nothing,
because no rotation straightens a curve. `bow_profile` measures it from the page and
`flatten` subtracts it before rows are grouped.

**Columns cannot be found from whitespace.** Candidate names fill the gaps, so ink is
continuous from x≈0.08 to x≈0.86 and there are no gutters to detect. The pre-1918 tables
carry a printed header on every page, and its words give the column centres exactly.

**Number format identifies nothing.** The elector count is comma'd for Cork city (14,569)
and not for Clare West (9813), and there are three numeric columns because the date
carries a day of the month. Columns come from position only.

**Wrapped lines.** A wrapped constituency continuation sits at roughly x 0.17–0.21 of the
page width, a wrapped candidate continuation at roughly 0.55–0.67; that is what tells them
apart. A wrapped candidate carries its vote on the second line.

**Multi-member seats have no special formatting.** Cork city is printed like any
single-member seat; the exception is stated in the page head, which `two_member_seats`
reads.

**Do not render the PDF at higher dpi.** The page *is* the embedded scan and its mediabox
equals that image's pixel size, so `pdftoppm -r 400` upsamples a ~2000×3200 image to ~198
megapixels for no extra detail.

**Open the PDF once.** Constructing a reader per page on a multi-gigabyte file exhausts
memory part way through a run.

## Why the comparison screens exist

An earlier version of this check reported 24 confident electorate errors. All were
artefacts. Each screen answers one:

- Pairing pages by the year in the running head is wrong by one election, because the head
  scan also reads the facing page. Walker's figure kept turning out to be Civgraph's for
  the *next* election. Pages are aligned by evidence instead.
- A row can bleed across a table boundary, so a figure that is the same seat's value in
  another election is discarded.
- A row can bleed into its neighbour, so a figure that is another seat's value in the same
  election is discarded.
- "Waterford" and "Waterford County" are different seats with different electorates, so a
  qualified name never matches a bare one where both exist.

A screen can only discard a finding, never create one.

For votes there is a stronger test: Civgraph's candidates should sum to its own stated
valid poll, so if substituting Walker's figure breaks that sum, the Walker figure is an
OCR misread rather than a disagreement. Across roughly 585 vote comparisons every
apparent disagreement failed that test — no vote discrepancy has been found.

## Output

| file | from | status |
|---|---|---|
| `data/elections/corrections/walker-electorate-review.json` | `check_against_civgraph.py` | 7 applied, 3 held (1922-23 Dáil electorates whose basis no source settles) |
| `data/elections/corrections/walker-pre1918-electorates.json` | `harvest_electorates.py` | general-election electorates for 1885-1918; by-election registers excluded |
| `data/elections/corrections/walker-seat-corrections.json` | by hand, from the page heads | Cork City returned two members, 1885-1918 |
| `data/elections/walker-verified-contests.json` | `record_verified.py` | contests whose figures Walker reproduces; they cite him as checked |
| `data/elections/walker-pre1885-results.json` | `harvest_pre1885.py`, `crosscheck_wikipedia_members.py` | 1802-1880 contests, unverified; general elections marked with whether Wikipedia's members agree |
| `data/elections/walker-byelections-1885-1922.json` | `harvest_byelections.py` | 1885-1922 by-elections, unverified |
| `data/elections/walker-constituency-histories.json` | `harvest_constituency_section.py` | member succession per seat, unverified |
| `data/elections/walker-abbreviations.json` | transcribed | the party legends and stated sources of each section of the 1918-92 volume |
| `data/elections/wikipedia-mp-lists-ireland.json` | `harvest_wikipedia_mp_lists.py` | members for Irish seats at every general election 1802-1918 |

The corrections are applied at manifest build time by the Walker overlay in
`scripts/build-test2-election-manifest.mjs`, keyed by source file; the imported files are
left as they are. The overlay also restores the 446 pre-1918 unopposed returns that were
imported with their columns shifted. `scripts/build-election-provenance.mjs` notes on each
contest which figures came from Walker, and which Walker disputes.

## Measured accuracy

`spot_check.py` draws a fixed-seed sample and crops each figure from the page for checking by
eye; the crops are written outside the repository.

- pre-1918 electorates: 23 of 24 right; the one error (a by-election register) is now excluded.
- 1802-1880 results, after three rounds of fixes: election and votes right in 20 and 19 of 20,
  every field right in 15 of 20. Against Wikipedia's lists of members, 766 of 970 comparable
  general-election contests agree.
- 1885-1922 by-elections: figures right in 14 of 16, every field right in 7 of 16.
- constituency histories: about two in three locatable entries right; not import-grade.
