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
| `ocr_output/` (77 `.txt`) | Raw OCR of those scans. | Faithful but **column-scrambled** — see below. |
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
