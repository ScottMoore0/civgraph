# Archive

`archive/` left this repository in November 2026, as part of the site restructure.
It held superseded code and working material, none of it built or deployed: the
retired Leaflet stack (`archive/leaflet/`), legacy scripts and partials, the
ElectionsNI reference copy (`archive/electionsni-reference/`), the Statements of
Persons Nominated OCR (`archive/ocr/`) and assorted working files
(`archive/working/`, `archive/research/`).

## Where it went

- **Offline copy:** `E:\civgraph-archive\archive\` (789 files). Every file is listed
  with its SHA-256 in `E:\civgraph-archive\MANIFEST.sha256`; the copy was checked
  against the repository file by file before removal.
- **Git history:** the last commit that holds it is `ba274cc564`. Until the history is
  cut, any file can be read back with

  ```sh
  git show ba274cc564:archive/legacy-scripts/bundle.mjs
  git restore --source=ba274cc564 -- archive/leaflet/   # whole folder, locally
  ```

  `/archive/` is gitignored, so a restored copy stays out of commits and out of the
  Pages deploy (`scripts/clean-for-pages.sh` still removes it).

The tag `leaflet-main-before-maplibre-root-20260612` still pins the Leaflet main.

## Scripts that read it

`scripts/review/match-spn-ocr-candidates.mjs` and `scripts/ocr/reocr-spn-columns.py`
read `archive/ocr/`. Point them at the offline copy:

```sh
CIVGRAPH_ARCHIVE_DIR=E:/civgraph-archive/archive node scripts/review/match-spn-ocr-candidates.mjs
```

## `analysis/` stays for now

`analysis/` was copied to `E:\civgraph-archive\analysis\` (502 files, in the same
manifest) but is still in the repository: civgraph.net serves it (for example
`/analysis/border-poll-dry-run/README.md` returns 200), because `.cfignore` lists it
and Cloudflare does not honour that, while `scripts/clean-for-pages.sh` does not
remove it. It comes out once the owner decides whether those files should be public.
