# Archive

This directory contains working artifacts, old pages, research notes, and OCR outputs that are not part of the live site. Files are preserved for reference but are not served or built.

## Structure

- `working/` — Session artifacts, working files, temp outputs, election documents, spreadsheets, screenshots, logs
- `pages/` — Old/unreferenced HTML pages and scripts
- `research/` — Markdown notes, audits, catalogues, session summaries
- `ocr/` — **Extracted** candidate data from Belfast newspaper scans of Special Polling
  Notices. See "The OCR pair" below — this half is unpublished data, not scrap.
- `legacy-scripts/` — Retired build/runtime scripts kept for reference only

## Moving files back

Any file can be restored to the repo root with:

```bash
git mv archive/<subdir>/filename.ext filename.ext
```

## The OCR pair

`archive/ocr/` is **output**, not working scrap, and it is worth more than its position in
this directory suggests.

`scripts/extract_spn_llm.py` reads raw OCR text of Belfast newspaper scans, sends each file
to an LLM, and writes structured JSON of the Special Polling Notices — candidates with their
addresses, party descriptions, proposers, seconders and election agents.

**The extraction ran and it worked.** Measured 2026-08-27 across the 70 files here:

| | |
|---|---:|
| files carrying data | 65 |
| files that came back empty | 5 |
| constituencies | 134 |
| candidates | 822 |
| distinct elections named | 32 |
| span | 1938 – 1986 |

The OCR text itself is rough — one line reads `ALEX. MURDOCH, AY, NOVEMBER 25, 1054` — and
cleaning that up is exactly what the LLM pass was for. The JSON is clean and structured.

**Nothing downstream reads it.** No candidate name, address or agent from these files appears
anywhere in `data/`, `app/data/` or `functions/`, and the published election schema has no
`proposer`, `seconder` or `agent` field to put them in. Proposers, seconders and election
agents are not recorded anywhere else in Civgraph. So this is 822 unpublished candidate
records, not a duplicate of something already live.

### The input is not here

The raw text this was extracted FROM is still at the repository root, in `ocr_output/`
(77 `.txt` files). Commit `71abea8985` *"chore: archive non-essential root files"* moved the
output here and `bna_catalogue.md` to `research/`, but left the input behind. The two halves
belong together.

That commit also broke the script, which has three stale paths as a result:

| Line | Points at | State |
|---|---|---|
| 21 `OCR_DIR` | `ocr_output/` | still at the repo root |
| 22 `OUT_DIR` | `ocr_extracted_json/` | gone — it is this directory now |
| 23 `CATALOGUE_PATH` | `bna_catalogue.md` | gone — now `archive/research/bna_catalogue.md` |

Seven of the 77 inputs were never extracted at all. Re-running to cover them means fixing
those paths first. The script also reads `OPENROUTER_API_KEY` from an absolute path outside
the repository, which an outside developer cannot satisfy as written.
