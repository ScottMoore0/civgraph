# Bootstrap-era page fragments

> **Status: archived 2026-08-17. Not built, not served, not referenced.**

Three HTML fragments from the Bootstrap version of the site, before the MapLibre
rewrite. `about.html` still describes the project as "This NI Boundaries Website",
which is the name the repository is still called after.

They were at `partials/` in the repository root until 2026-08-17. Why they moved:

- **They are fragments, not pages.** No `<html>`, no `<head>`, no stylesheet.
  Bootstrap classes (`container my-5`, `form-control`) with nothing to supply them.
- **Nothing referenced them.** No `fetch`, no `<a href>`, no script, anywhere in
  the repository outside `archive/`.
- **They were still being served.** `/partials/home` returned HTTP 200 — an
  unstyled fragment, live on the public site, reachable by anyone who guessed it.
- **`partials/` sat next to `pages/`** at the repository root, with both holding an
  `about.html` of different content. That is a directory-level trap for a
  newcomer, and it is what prompted the check.

Kept rather than deleted, per project convention. `pages/` holds the real
standalone pages; see the layout table in the root `README.md`.
