# Proposed Home and About pages

Drafts of a replacement Home page and About page. **Not published.** `docs/` is listed in
`.cfignore`, so nothing here is uploaded to Cloudflare Pages; these are version-controlled
working drafts, not served routes.

| File | Replaces |
|---|---|
| `home.html` | the map application at `/` |
| `about.html` | `pages/about.html` |

Both are self-contained: GSAP animation, images inlined as base64, no external asset
references to speak of.

## Why they live here now

They were previously loose files on the Desktop, with older copies in Downloads. That cost
real work: on 10 September a session edited a Downloads copy dated 29 August, two versions
behind the current draft, and the retaken screenshot, caption fix and figure corrections
all went into a file nobody would ever ship. Three separate lineages of the same page
existed and nothing said which was current.

They are also where six hard-coded figures drifted, three of them wrong by the time anyone
checked. Being outside the repository was the reason `build-site-stats.mjs --check` could
not hold them.

## Keeping the figures honest

Both pages are covered by `npm run check:proposed-pages`, which is part of `npm run check`.

`scripts/build-site-stats.mjs` recognises two markup forms:

- the stats row on the Home page, keyed on each stat's visible label;
- `data-stat="<key>"` on any element, which is how the About page's prose table opts in.

Keys are those in `data/database/site-stats.json`: `publicMaps`, `electionContests`,
`candidacies`, `people`, `scannedBooks`, `cataloguedSources`.

To bring a page up to date after the data moves:

```
node scripts/build-site-stats.mjs --apply docs/proposed-pages/home.html
```

Figures stated in prose rather than inside a tagged element are **not** covered. There are
still some, and the review notes on both pages say so.

## Open questions

- The mission statement on the About page is the six-paragraph text agreed with Phelim
  Birch. A later suggested amendment, adding that the tools are part of the project rather
  than an extension and that wider querying is an aim rather than a current feature, was
  never accepted or rejected.
- Whether the Acknowledgements section should return to the About page. It was removed on
  the grounds that provenance is recorded throughout the site; Phelim was asked whether
  anything specifically belonged there and the record does not show an answer.
- The Open Graph preview image is still the one captured on 5 August, advertising
  "1012 maps" and a `Census` nav link that no longer exists.
