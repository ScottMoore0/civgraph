# Election Trends chart redesign, election tables, catalogue section bar and Books layout

Everything this change touches, file by file, with the reasoning. Written for review of
the pull request that introduces it.

## Summary

1. The Trends tab of the election pane draws a newsroom-style line chart of party vote share
   over time (Datawrapper-like), replacing the marker-heavy chart.
2. The By Party, By Candidate and By Local Party tables in the election pane are restyled to
   sit with the chart.
3. The timeline play and stop buttons are hidden while an election is open, since they only
   ever animate boundary layers.
4. The About page uses the same wide wrapper as Home and its prose fills it.
5. The maps catalogue gets a pinned section bar (Elections, Maps, Books, Tables) with Lucide
   icons, icons on the headings inside the contents box, Lucide icons in place of the emoji in
   the Books section, and a compact row layout for book cards.

The election data pipeline, the comparable-election filter, the map, URL and hash state,
selectors, overlays, party colours, the shared table styles used elsewhere on the site and the
Browse page are unchanged.

## Files

| File | Change |
|---|---|
| `src/election-trend-chart.mjs` | **New.** Pure `buildTrendChartModel`, `layoutTrendChart` and `renderTrendChartSvg` builders plus `mountTrendChart`, which binds hover, tooltip, party focus, keyboard and resize handling. No DOM dependency in the builders, so they run in Node. |
| `app/src/election-manager.js` | Trends panel markup; `hydrateTrendsPanel` caches points instead of markup and mounts the chart; the old inline SVG renderer, `trendMarkerSvg`, `trendMarkerKind` and `shortTrendLabel` are removed; `loadTrendSummary` falls back to the static bundle when the elections API is unavailable, the same way `loadBundle` already did; share-change cells carry `election-delta--share`; imports the new module and `partyAbbreviation`. |
| `app/src/app.js` | `updateTimelineAnimationButtons` hides the playback group while an election is open. |
| `app/src/test2.css` | Trends chart styles (light and dark); a scoped layer restyling the election pane tables; the hidden playback group rule. |
| `src/ui-controller.js` | The four catalogue section links move out of the contents box into a `nav.catalogue-flat__sections` segmented bar with Lucide icons; the active tab is remembered on the controller across re-renders; the shell height is published as a custom property for the pinned bar; the scroll-to-target offset includes the bar; all catalogue Lucide icons live in one `LUCIDE_ICON_PATHS` map with `lucideIcon()` and `bookCategoryIcon()`; the Elections and Maps headings inside the box carry icons; Books category headings and card badges use Lucide icons by category id instead of the emoji from `data/database/books.json`; book cards put author and date on one `book-card__meta` line and move the transcription notice into the Markdown button's tooltip. |
| `maps/index.html` | A "Tables" heading with the table icon at the top of the Tables pane. Cache tokens refreshed by the build. |
| `assets/css/main.css` | Segmented bar styles, pinned position and dark theme; spacing and rules between the box's sections; heading icon sizing and colours; the catalogue list sized to its content (see "Why the flat view is no longer flex-sized"); Books grid with the heading spanning the row, the cover fallback hidden once a cover exists, and row-layout cards. |
| `assets/pages/css/about.css` | Prose, lists and boxes no longer capped at about 68 characters. |
| `pages/about.html` | Uses `wrap--wide` like Home; the About stylesheet link carries a content-hash `?v=` so browsers pick up changes. |
| `app/build/*`, `sw.js` | Rebuilt bundle and refreshed cache tokens, via the project's own build scripts. |
| `docs/election-trends-chart-and-catalogue-ui.md` | This file. |

## 1. Election Trends chart

### Visual treatment

- Thin 2.25 px party lines in Civgraph's existing party colours, no outlines, no permanent
  markers.
- White surface, faint horizontal grid, a baseline, no other axis chrome.
- Real time axis with upright year labels at a sensible interval; a small tick marks each
  election. Elections on the same day (local and European in the Republic, for example) are
  nudged apart by a minimum column gap so they stay distinguishable.
- Percentages on the y-axis. The top gridline is a round number at or just above the highest
  value, capped at 100.
- Direct labels at the end of each line with the party's latest share. As width shrinks the
  label uses the full name, then the abbreviation, then the value only, then disappears below
  560 px (the key and the tooltip carry the names). Labels are pushed apart so they never
  overlap; a short leader joins a label that had to move away from its line. Two parties whose
  abbreviations collide ("Independent" and "Non party/Independent" are both "Ind") keep their
  full names.
- Real gaps where a party has no comparable result: the solid line stops, a faint dotted bridge
  crosses the missing elections so the fragments still read as one series, and an isolated
  single result is drawn as a dot. No value is drawn for an election the party did not contest.

### Interaction

- Hover or touch shows a dashed crosshair at the nearest election, markers on every line at
  that election, and a tooltip with the date, the body and every charted party's share in
  descending order. On touch the crosshair stays pinned until a tap elsewhere.
- Hover, click or tap on a line, its label or its key entry emphasises that party and fades the
  rest; clicking again, clicking empty chart space, or Escape resets. The key is a row of
  buttons, so this works on touch and by keyboard. Arrow keys move the crosshair when the chart
  is focused.
- The chart re-renders at the container's real width, so text never scales, and follows the
  pane when it is resized, between 200 px and 320 px tall.

### Data

- Same `loadTrendSummary` and `buildTrendSummary` path, same comparable-election filter, same
  by-election exclusion, same scope toggle.
- Series selection: up to eight parties; those standing at the most recent election first,
  ordered by their share there, then any others by their peak. The footnote says how many were
  left out. The previous ranking led with the last-known share, which put 1918 Unionist and
  Nationalist single points ahead of every current party.
- `loadTrendSummary` now falls back to the static election JSON when the `_api` route answers
  with an error, matching `loadBundle`. Without it a static server showed only the active and
  previous elections in the chart.

### Test hooks kept

`#test2ElectionTrendsChart svg`, `.test2-election-trends__svg`,
`.test2-election-trends__legend-item` and `.trend-marker title` all still exist, so the
existing Playwright specs pass unchanged.

## 2. Election pane tables

A layer at the end of `app/src/test2.css`, scoped to `.election-pane__content`, so the shared
table rules in `assets/css/main.css` keep serving Browse and the catalogue detail pages
unchanged:

- White surface, hairline rules between rows, no vertical grid, a firmer rule under the header
  and above the totals row; frozen columns in the same white with the same rules.
- Bold header labels; group headings in small muted caps; no filled header background.
- No zebra striping; a light wash on the hovered row.
- The site font at a slightly smaller size instead of the condensed face.
- Only the share change is coloured green or red; vote and seat changes are muted grey with
  their sign. `formatMainPercentDelta` and `formatMainSelectedPercentDelta` add
  `election-delta--share` for this.
- One link per row (the candidate, the party, or the constituency in By Local Party) in dark
  text with a thin underline; the other linked cells show the link on hover.
- Party colour as a slim rounded tab; Elected as a filled dot instead of a green tick; N/A
  upright and muted.
- Dark-theme tokens for all of the above.

Several of these rules carry `!important`. The shared stylesheet pins frozen columns with
their own fills and shadows through many specific selectors, each with a dark-theme copy;
stating the fill once, with `!important`, for every body cell except the party colour tab was
the alternative to enumerating all of them.

## 3. Timeline playback buttons

`canAnimateTimeline` already returned false whenever an election was open, so the play and
stop buttons sat disabled for the whole election experience. They now hide instead
(`timeline-playback-group--hidden`) and return when the election is closed.

## 4. About page

The Home page's content sits in `.wrap--wide` (1120 px). About used the 860 px `.wrap` and
capped its paragraphs at 68 characters. Both wrappers on About are now `wrap--wide` and the
caps are removed, so the text runs the same width as the "Why Civgraph exists" prose on Home.
The About stylesheet is linked with a content-hash `?v=` because it was previously linked
bare, and browsers kept serving the old copy.

## 5. Maps catalogue

### Section bar

Elections, Maps, Books and Tables were a row of uppercase text links inside the contents box.
They are now a segmented bar above it: four equal pills, the active one filled with the site
gradient, each with a Lucide icon (vote, map, book-open, table). The links keep their
`catalogue-flat__toc-toplink` class and data attributes, so `handleFlatTocClick`, the Tables
tab switch and `_markActiveToplink` are unchanged.

Two things had to change for the bar to work well:

- **The active tab is remembered on the controller.** The flat view is re-rendered whenever a
  section is expanded, which used to wipe `aria-current`. `_markActiveToplink` now records the
  target and the markup reads it back.
- **The bar is pinned under the search shell.** It is `position: sticky` with a `top` equal
  to the shell's measured height, published as `--catalogue-sticky-shell-height` by
  `_syncCatalogueShellHeight` (kept in sync with a `ResizeObserver`, since the title wraps at
  narrow widths). `_catalogueStickyHeight` adds the bar to the scroll-to-target offset so a
  section heading lands below it rather than behind it.

### Why the flat view is no longer flex-sized

`#catalogueListView` is `height: 100%` and `.catalogue-flat-view` was `flex: 1 1 auto;
min-height: 0`, so the view was clipped to the pane height and its content simply overflowed.
That is invisible until something inside is sticky: a sticky child is confined to its parent's
box, so the bar scrolled away after the first screenful. The view (except the book viewer,
which scrolls internally) is now sized to its content.

### Headings and icons

The Elections and Maps headings inside the box carry the same icons, and each section after
the first starts with a rule and a clear gap. The Tables pane gets a heading with the table
icon. Icons take a light blue in dark mode.

### Books

`data/database/books.json` carries an emoji per category. Those are no longer read for
display; `BOOK_CATEGORY_ICONS` maps category id to a Lucide icon (clipboard-list, landmark,
vote, chart-column, scale, library; book-open for anything unlisted) and it is used for the
category headings and the card thumbnail badge.

Layout fixes in the Books grid:

- The category heading occupied the first cell of the two-column grid, so the first card
  jumped to the right column. It now spans the row.
- The thumbnail fallback badge was `display: inline-flex`, which beat the `hidden` attribute,
  so cover and badge drew on top of each other. `[hidden]` now wins.
- Cards stacked cover, title, author, date, buttons and the transcription notice vertically.
  They are now rows: cover at the left, title, author and date on one line, then the buttons.
  The notice moved into the Markdown button's tooltip.
- The grid fits as many 320 px columns as the pane allows.

## Verification

- `npx playwright test tests/browser/app.spec.js tests/browser/election-layout.spec.js -g Trends`: passes.
- The election tests in `app.spec.js` pass; the party and person link test needs the browse
  detail shards (`node scripts/build-browse-indexes.mjs`), which are a gitignored build output.
- Catalogue, Tables and Books tests in `app.spec.js`: pass.
- `npx eslint src/election-trend-chart.mjs app/src/election-manager.js app/src/app.js src/ui-controller.js`: no new warnings.
- `node scripts/validate-app-shell-cache-tokens.mjs`: PASS after each rebuild.
- Shared CSS within its 225 KB budget.
- Checked in a browser at 1920, 1600, 1280, 1000, 700 and 390 px widths, light and dark, with
  touch emulation for the phone width.

## Known, left alone

- Clicking Maps in the section bar lands part-way into that section rather than on its
  heading. This behaves the same before the change.
- The Dáil candidate table is wider than the pane and scrolls sideways with its name columns
  pinned, as before.
