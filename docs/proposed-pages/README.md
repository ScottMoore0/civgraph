# Proposed Home and About pages

Drafts of a replacement Home page and About page. **Not published.** `docs/` is listed in
`.cfignore`, so nothing here is uploaded to Cloudflare Pages; these are version-controlled
working drafts, not served routes.

| File | Replaces |
|---|---|
| `home.html` | the map application at `/` |
| `about.html` | `pages/about.html` |

## Layout

```
home.html  about.html      markup only
css/shared.css             1,962 lines common to both pages
css/home.css  about.css    the per-page tail
js/01..10-*.js             one file per original inline block, shared by both pages
assets/                    images and favicon, content-hashed
```

They arrived as single self-contained files with GSAP, ScrollTrigger, eight page scripts
and every image inlined as base64: 1,512 KB and 861 KB. That was the right shape for a
draft meant to be *sent to someone*, and the wrong one once they were in the repo, where
base64 defeats caching entirely and nothing can be diffed.

Split 2026-09-12 to 45 KB and 27 KB of markup. Every script block became its own file
rather than being concatenated, because the blocks are not adjacent -- two sit in `<head>`
and eight at the end of `<body>` -- and merging them would have changed execution order
and timing. The numeric prefixes are that order. All ten are byte-identical between the
two pages, so there is one copy of each.

Nothing is inlined now: no `data:` URIs remain in either page.

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

Figures stated in prose are covered too, where a computed key exists: they are wrapped in
`<span data-stat="...">`. Six further keys beyond the headline set are available for this
(`elections`, `catalogueEntries`, `renderedLayers`, `proniRecords`, `graphEntities`), and
are checked only on pages that actually claim them. What remains unguarded is figures with
no computed source, such as "552 boundaries" for the 1984 wards.

## These are the only current copies

Older lineages are archived, dated, under
`Desktop\Civgraph proposed pages\superseded\`, with a pointer file beside them.
Nothing outside this directory is current, including the copy marked "EDITED IN ERROR",
which is the 2026-09-11 pass that went into the wrong lineage before being redone here.

## Open questions

- ~~Whether to take the suggested amendment to the mission statement.~~ Decided
  2026-09-12: taken. The About page carries the text agreed with Phelim Birch plus two
  changes -- the tools are stated to be part of the project rather than an extension, and
  wider querying is stated as an aim rather than a current feature, which was the point
  his review raised.
- ~~Whether the Acknowledgements section should return to the About page.~~ Decided
  2026-09-12: no Acknowledgements section. Provenance is recorded throughout the site.
- ~~The Open Graph preview image is stale.~~ Regenerated 2026-09-12: it now reads 795 maps
  and carries the current nav. `check:og-preview` holds it.
