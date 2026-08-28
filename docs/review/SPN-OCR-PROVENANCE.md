# Statements of Persons Nominated: can the 822 extracted candidates be published?

> **Status: findings for review — 2026-08-27. NOTHING HAS BEEN PUBLISHED.**
> `scripts/review/match-spn-ocr-candidates.mjs` reproduces every number here. It writes
> nothing and is not wired into `build` or `check`. Step 5 of the agreed sequence — adding
> `proposer`/`seconder`/`agent` to candidate `meta` and surfacing them — was **not carried
> out**, because step 3's gate said not to. The reasoning is below.

## The question

`archive/ocr/` holds 822 candidate records extracted from Belfast newspaper Statements of
Persons Nominated, carrying **proposers, seconders and election agents** — roles recorded
nowhere else in Civgraph. Publishing them means joining each to a candidate row in an
existing contest. The agreed sequence was: build the election mapping, match and report,
let the match rate decide, verify a sample, and only then touch the schema.

## Provenance of every input

| Layer | What it is | Trustworthy? |
|---|---|---|
| Newspaper scans | British Newspaper Archive. The `BL_` stem encodes the BNA title id and issue date. | The issue date is the **only date in this pipeline not derived by a model**. |
| `archive/ocr/text/` (77 `.txt`) | Original OCR of those scans. | Faithful but **column-scrambled** — see below. |
| `archive/ocr/text-v2/` (77 `.txt`) | Column-aware re-OCR, 2026-08-28. | +25.4% recoverable signal. Not yet re-extracted. |
| `archive/ocr/` (70 `.json`) | LLM extraction by `scripts/extract_spn_llm.py` via OpenRouter. | Verified here for the first time. |
| `data/database/spn-ocr-election-map.json` | Which Civgraph election each file belongs to. | **Derived from candidate-name evidence, not asserted.** |

Seven of the 77 inputs were never extracted; five extractions returned empty.

## Step 1 — the election mapping is evidence, not assertion

The obvious key, the LLM's `election_name`, is the **least** trustworthy field in the file:
32 distinct values for about a dozen real contests, 14 records saying `"Unknown"`, and at
least three wrong outright — `"Northern Ireland Parliamentary Election 1938"` on a paper
dated 1958-03-10, and `"Westminster General Election"` for both 1975 and 1986, neither of
which happened.

So the mapping is proposed from evidence instead. The newspaper's own issue date narrows
the field to contests within 120 days, and the winner is chosen by **how many candidate
surnames the OCR record and the Civgraph contest actually share**. Only files scoring ≥ 0.75
are recorded as mappings; the other 49 are listed as `unresolved` rather than guessed.

**21 of 70 files map with name-level agreement.** Every one of the 13 election years the
corpus touches (1950–1988) does exist in Civgraph, so nothing is orphaned for want of a
parent.

## Step 2/3 — the match rate, and why the headline number misleads

**228 of 822 candidates join: 27.7%.** Far below the 90% bar. But the corpus is bimodal,
not uniformly mediocre, and the split is the actionable part:

| Election-resolution confidence | Files | Candidates | Matched | Rate |
|---|---:|---:|---:|---:|
| ≥ 0.75 | 21 | 219 | 155 | **70.8%** |
| 0.40 – 0.74 | 13 | 126 | 36 | 28.6% |
| 0.01 – 0.39 | 17 | 423 | 37 | 8.7% |
| 0 | 12 | 54 | 0 | 0.0% |

Two of my own bugs were found and fixed while measuring, and both had been depressing the
rate:

- Constituency scoping treated a normalisation failure as a miss. SPN prose
  (`"District of Newry and Mourne - District Electoral Area Crotlieve"`) does not reduce to
  Civgraph's `lg85-NaM-Crotlieve`, so scoped searches returned nothing while whole elections
  were scoring 1.0. Now falls back to the whole election.
- The Mc/Mac/M' fold matched **any** M followed by three letters, turning `MINFORD` into
  `MCINFORD` and `MULLAN` into `MCLLAN`. It silently broke every M-surname in a corpus full
  of them, and surfaced only as an implausible number of verification failures.

## Step 4 — the extraction is sound; my first test of it was not

Checking each extracted surname against the raw OCR text it came from:

| Field | Strict (exact string) | Trace (4+ char run) |
|---|---:|---:|
| candidate name | 216/228 · 94.7% | **228/228 · 100%** |
| proposer | 208/215 · 96.7% | **215/215 · 100%** |
| seconder | 193/205 · 94.1% | 203/205 · 99.0% |
| agent | 18/21 · 85.7% | 20/21 · 95.2% |

The first version of this check used strict matching only and reported **187 apparent
fabrications**. That was wrong, and worth recording because the error was mine and it
pointed the opposite way from the truth. Reading the scan text for
`BL_0000038_19541123_034_0002` shows the page prints the candidate as `Arms|trong` across a
**column break** and the agent as `Falrley` — an `l` read for an `i`. The names are on the
page; the exact strings are not.

**Three values in 669 have no trace at all.** The extraction did not invent this data.

## So why does it not join?

Because the OCR is column-scrambled, not because the model was careless. Of the 595
unmatched candidates, **252 (42.4%) carry a surname Civgraph has never seen in any
election** — and the examples show what happened to them:

| Extracted | What it actually is |
|---|---|
| `Violette Wilhelmina Drumarkir` | `Drumarkir` is an **address** fragment from the next column |
| `Brian LIGAN` | truncated — Milligan or Halligan |
| `Francis Joseph HIRE` | truncated — Maguire |
| `Ciaran En` | truncated |
| `FRENCH Tom`, `KEARNS Freddie` | surname/forename **order reversed** |

The model transcribed a mangled page faithfully. The damage is upstream of it.

**This is the finding that matters, because it changes what the fix is.** More matching
logic will not recover these; the OCR needs re-running with column detection. Fuzzy-matching
a truncated `HIRE` onto `Maguire` would be guessing, and guessing is what this whole
sequence was designed to avoid.

## Step 5 — not done, and why

The gate set before measuring was: 90%+ publish, ~50% something is wrong. The corpus returns
27.7% overall and 70.8% at its best. **Neither clears the bar, so the schema was not
touched.**

Worth being explicit that the schema was never the obstacle. `candidates.meta` already
exists and `functions/_api/elections/index.js:56` documents it as *"every field not promoted
to a column, so responses stay shape-compatible"* — three fields would flow to the API with
no migration and no API change. Roughly an hour of work, sitting behind a data problem that
is not an hour of work.

Publishing the 155 that do join would mean shipping proposers and agents for an arbitrary
19% of a contest's candidates, with no way for a reader to tell that the silence for the
other 81% means "not yet transcribed" rather than "stood unproposed".

## What would change the answer

1. **Re-OCR with column detection.** The single highest-value step; it addresses the cause
   rather than the symptom. The scans are the same, so this is repeatable.
2. **Human-verify the 21 confident files.** `docs/review/SPN-VERIFICATION-WORKSHEET.txt`
   holds a 50-row spread of matches with proposer, seconder and agent for eyeballing.
   If those hold up, 219 candidates at 70.8% is a defensible first tranche.
3. **Settle the rights position.** Not established. These are extracts from BNA-held scans.
   Factual nomination detail is unlikely to attract copyright, but that is a view, not a
   clearance, and nothing should be published before it is confirmed.
4. **Decide what the 252 unknown surnames are.** Some are damaged strings. Others may be
   real candidates missing from Civgraph — the October 1974 pages name people Civgraph has
   no record of anywhere. That is a coverage question worth its own look, and it is the
   reverse of the one asked here: not "can this data join?" but "what is Civgraph missing?"

## Reproducing

```
node scripts/review/match-spn-ocr-candidates.mjs             # match report + stratification
node scripts/review/match-spn-ocr-candidates.mjs --verify    # extraction vs raw OCR text
node scripts/review/match-spn-ocr-candidates.mjs --sample 50 # verification worksheet
node scripts/review/match-spn-ocr-candidates.mjs --json      # everything, machine-readable
```

---

# Follow-up, 2026-08-28: re-OCR, rights, and the withdrawn nominations

Three of the four "what would change the answer" items were worked. The headline is that
**the biggest single cause of the low match rate turns out not to be an error at all.**

## Withdrawn nominations — the finding that reframes the rest

The October 1974 pages name candidates Civgraph has no record of, and I had flagged that as
a coverage gap worth investigating. It is not a gap. Reading the raw text of
`BL_0005119_19741002_205_0009`:

> `THE ABOVE ST/ IR NOMINATIONS WERE WITHDRAWN.`
> `THE FOLLOWING PERSO[NS] ... WERE NOMINATED. THEIR NOM[INATIONS]`

A Statement of Persons Nominated lists **everyone nominated**, including those whose
nominations were later **withdrawn** and who therefore never appeared on a ballot.
Civgraph's election data is derived from *results*, so it structurally cannot contain them.

**14 of the 77 scans carry withdrawn-nomination language**, and they are disproportionately
the low-scoring files — 1974-10-02, 1975-04-16, 1979-04-25, 1983-05-25 are all in the
bottom band.

Civgraph's October 1974 coverage was checked directly and is complete: 3–5 candidates per
constituency across all twelve seats, which matches the contest. Nothing is missing.

So a substantial share of the 252 "surnames Civgraph has never seen" are not extraction
damage and not gaps. **They are people who stood for nomination and withdrew** — real
historical facts that a results-derived dataset cannot hold. That makes this material more
valuable than the match rate implied, and it means the match rate was always the wrong
single measure: a withdrawn nominee *should* fail to join.

## Re-OCR with column detection — done, and it works

`scripts/ocr/reocr-spn-columns.py`, output in `archive/ocr/text-v2/`.

What did **not** work, recorded because it is the obvious approach: finding column gutters by
ink density. It detected **one** column on the 1954 page. These are dense classified pages
whose columns are separated by printed rules, not white space, so there is no gap to find.

What works is Tesseract's own `--psm 4`, with `--psm 11` appended as an unordered
supplement. Measured across all 77 scans, counting distinct Civgraph-known surnames
findable in each page:

| | Surnames recoverable |
|---|---:|
| original OCR | 8,208 |
| re-OCR | **10,290 (+25.4%)** |

**60 of 77 pages carry more signal, 10 fewer, 7 unchanged.** On the 1954 Armagh notice it
recovers `ARMSTRONG`, `CHRISTOPHER` and `FAIRLEY` — none of which appear anywhere in the
original text.

**What re-OCR cannot fix.** Some scans are physically **cropped mid-column**. On
`BL_0000960_19850425_239_0043` the surname column is cut off at the left edge, so the page
itself reads `ARPER | Patrick Francis` — the candidate is Harper, which his own seconder
"Mary A. Harper" confirms two columns away. `LIGAN` is the tail of Milligan and `HIRE` of
Maguire, same page, same cause. Those need a better scan from the BNA, not a better OCR pass.

**The end-to-end gain is not yet measurable.** The match rate is computed from the LLM
*extraction*, and re-running that needs an OpenRouter key, which is deliberately not handled
here. `scripts/extract_spn_llm.py` is now repaired and runnable; pointing `SPN_OCR_DIR` at
`archive/ocr/text-v2/` and re-running it is the next step, and it is the one that would move
the 27.7%.

## Rights — position established, and it splits in two

Read off the scans themselves. **36 of 77 carry a printed rights footer**, naming two
copyright holders:

- `Image © National World Publishing Ltd. Image created courtesy of THE BRITISH LIBRARY BOARD.`
- `Image © Independent News and Media PLC. Image created courtesy of THE BRITISH LIBRARY BOARD.`

24 distinct newspaper titles are involved.

**The images are third-party copyright and must never be published.** The source PDFs stay
gitignored; nothing in `archive/ocr/` contains an image.

**The extracted facts are a different question, and the answer is more favourable.** A
Statement of Persons Nominated is a **statutory public notice**, published by a Returning
Officer under electoral law. The newspaper's rights in it are the typographical arrangement
— 25 years in the UK, so expired for every one of these, the latest being 1988 — and there
is no copyright in facts. Who was nominated, by whom, and who acted as agent are facts on a
public notice.

That is a considered position, not a clearance, and it is worth one look from someone
qualified before publication. But it is not the blocker; the data quality is.

## Where this leaves it

The gate verdict is unchanged — **nothing published, no schema touched** — but the reasoning
has moved. The obstacle is no longer "the extraction may be unreliable"; that was tested and
it is sound. It is that the extraction was made from the *worse* of the two OCR passes, and
that the match rate counts withdrawn nominees as failures when they are the most interesting
records in the set.

The next step is concrete and small: re-run `extract_spn_llm.py` against
`archive/ocr/text-v2/`, then re-measure. That single run is what decides this.

---

# Correction, 2026-08-28: the extraction DID fabricate. Reading the scans directly.

**This retracts the central claim of the section above.** That section says "The extraction
did not invent this data", on the strength of a *trace* test — did any 4-character run of
each surname appear in the source text? It did, for 100% of names. **The test was too
permissive and the conclusion was wrong.**

`scripts/ocr/crop-spn-region.py` now locates the notice on a page and renders it large
enough to read directly. Read that way, `BL_0000038_19541123_034_0002` — the 1954 Armagh
notice, the very record quoted earlier as the exemplar of "clean structured data" — carries
**exactly one candidate**, returned unopposed:

> Armstrong, Christopher Wyborne. Dean's Hill, Armagh. **Farmer.**
> Proposer Frederick N. L. Bell, seconder William T. W. Gracey.
> Agent William H. Fairley, 24 Windsor Avenue, Lurgan.

The extraction has **two**. The second — `McATEER, Edward`, with proposer "Patrick J.
O'Hare", seconder "Patrick Agnew" and agent "James O'Reilly" — **does not appear on the
notice at all**. It also gave Armstrong's description as "Ulster Unionist" where the form
says "Farmer", his proposer as "Robert J. Bell" rather than Frederick N. L. Bell, and his
agent's address as "74 Scotch Street, Armagh" rather than 24 Windsor Avenue, Lurgan.

The trace test passed all of it because fragments of those strings occur elsewhere on a
broadsheet page of cattle-market advertising. A weak test returning a reassuring number is
worse than no test, and this one produced a headline conclusion that was the opposite of the
truth.

## What direct reading resolves

`data/database/spn-verified.json` holds the transcriptions. Three notices so far, seven
constituencies, eight candidates, **ten specific corrections** to the extraction.

The most useful single result: **`Lawrence Percy Ossory`** — one of the 252 "surnames
Civgraph has never seen" — is not a surname. The candidate is **Orr, Lawrence Percy Story**,
and *Ossory* is the name of his house, read out of the Place of Residence column. He was UUP
MP for South Down from 1950. Every one of the damaged-name cases is likely to be resolvable
this way, and only this way.

## Nomination status is now a modelled field

Withdrawn nominees have their own status rather than counting as match failures. The
vocabulary is taken from column 6 of the statutory form itself — *"Decision of returning
officer that nomination paper is invalid, or other reason why a person nominated no longer
stands nominated"* — giving `nominated`, `withdrawn`, `invalid`.

This is a different axis from Civgraph's existing `candidates.status` (Elected / Excluded /
Not Elected), all of which describe someone who reached a ballot. Re-run with that
separation, the match report reads:

| | Candidates | Share |
|---|---:|---:|
| matched | 228 | 27.7% |
| unmatched **on a page carrying withdrawals** | 280 | 34.1% |
| election resolved, genuinely no person | 213 | 25.9% |
| no election resolved | 54 | 6.6% |
| ambiguous | 47 | 5.7% |

The 34.1% is the part that was being counted as failure and mostly is not.

## Where this leaves the plan

Re-running the LLM extraction is **off the table** — it is the component now shown to
fabricate. Better OCR would not have helped either: the 1954 page's OCR is fine, and the
invented candidate came from the model, not the text.

That leaves direct reading, which works and is the only method that has produced a
defensible record. It is roughly one to three page-crops per notice across 77 scans. The
tooling is built and the schema is settled, so the remaining work is transcription rather
than design.
