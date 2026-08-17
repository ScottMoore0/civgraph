# Boundary gazette PDFs

> **Status: source material — deliberately NOT deployed.**

48 scanned gazette notices recording Northern Ireland boundary changes: urban and
rural district creations, alterations and abolitions, roughly 1848–1965. Filenames
carry the place, the instrument and the year, e.g.
`Antrim_Ballyclare 1965 alteration.pdf`.

## Why this returns 404 on the live site

`boundary-gazette/` is listed in `.cfignore`, so Cloudflare Pages never uploads
it. That is correct and intentional: it is input to the boundary data, not
something the site serves. `https://civgraph.net/boundary-gazette/` 404s by
design.

This file exists because that was not written down anywhere. A directory of 48
PDFs at the repository root, referenced by no code and returning 404, is
indistinguishable to a newcomer from something broken.

## What it is for

Primary evidence behind the historic local-government layers — the authority for
a boundary the published geometry asserts. Nothing reads these programmatically;
they are cited by hand when a boundary is questioned or corrected.

## If you want them published

They are third-party scans and their rights position has not been established, so
publication would need the same provenance determination as any other source —
see principle 6 in `docs/CIVGRAPH_PRINCIPLES.md` and the approved-publication gate
in `data/database/`. Do not simply remove the `.cfignore` line.
