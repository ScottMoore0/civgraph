# The catalogue is NOT empty — this finding was wrong

> **Status: WITHDRAWN, 2026-08-23.** Kept rather than deleted because the mistake is more
> instructive than the original claim, and because it was reported as the highest-priority
> item on the backlog. It should not have been.

## What I claimed

That the catalogue rendered zero entries on first load: 1,012 maps known to the
controller, the shell rendered, and no rows. I recommended fixing it before anything else,
on the grounds that "the site's primary surface is empty on arrival".

## What is actually true

`#catalogueFlatView` contains **156,920 characters of rendered HTML**. It renders:

```
ELECTIONS  MAPS  BOOKS  TABLES
1012 maps
Elections
2020s  2010s  2000s  1990s  1980s  1970s  1960s  1950s  1940s  1930s  1920s  1910s ...
```

The catalogue is a **sectioned, drill-down interface** — top-level tabs, a count, and
decade groupings — not a flat list of map cards. `singleSectionFlatCatalogue` is `true`.

## Why I got it wrong, which is the useful part

Every probe I ran asked the same question in four different costumes:

```
.map-card  .class-member  .c1-grid-entry  [data-map-id]
```

All four are the markup of a **flat card list**. This catalogue does not use that markup
at the top level, so all four returned zero, and four zeroes read as corroboration. They
were one measurement repeated, not four independent ones.

Then two failing browser tests appeared to confirm it. They use the same selectors. They
are not independent evidence either — they are the same assumption, written down earlier.

And a production screenshot seemed to clinch it. I had taken it at a viewport where the
left pane showed the heading, the search box and "FILTER BY PROVIDER", and I read the
absence of cards as the absence of a catalogue.

**The correct probe was the one I ran last: ask the container what it contains, rather
than asking the document for a shape I expected.** `container.innerHTML.length` settled in
one measurement what four selector counts had obscured.

## What IS true, and worth keeping

- **The two browser tests have a genuinely stale premise.** They expect a flat card list
  at the top level. The catalogue is sectioned. Rewrite them to drill in first — do not
  loosen the selectors, because the claim under test (a row is patched in place rather
  than the list re-rendered) is meaningful only against a real row.
- **`renderFlatView` returns silently when `#catalogueFlatView` is absent.** That is real
  and worth fixing on its own: a render function that does nothing and reports nothing is
  what let a wrong diagnosis survive as long as it did.
- **Whether drill-down works could not be confirmed.** A scripted `.click()` on the MAPS
  tab changed nothing, and a Playwright click timed out waiting for the element to be
  actionable. That may be an artefact of clicking a styled non-button, or it may be a real
  problem. **This is the open question**, and it is much narrower than "the catalogue is
  empty".

## The lesson

Four measurements that share an assumption are one measurement. When several checks agree
surprisingly strongly, the thing to test is the assumption they share — not the conclusion
they point at.
