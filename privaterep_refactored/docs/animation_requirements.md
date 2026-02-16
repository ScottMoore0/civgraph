# Replacing the election viewer animation with the NICVA-style replay

## Current implementation snapshot

The election viewer ships a bespoke animation runtime that is rendered inline from
`ni_votes/web/templates.py`. Rows are laid out using flexbox, widths are updated via
CSS transitions, and per-count transfers are inferred by differencing successive
`votes_by_count` totals supplied by `/api/search_elections`. Even after the recent
styling refresh, the system remains fundamentally driven by derived rather than
authoritative transfer data, and it keeps its own control bar, hub staging, and
non-transferable handling that diverge from the legacy presentation.

## What the NICVA animation provides

The archived NICVA codebase (`website/js/stages.js`) precomputes two rich structures —
`countDict` with the full vote totals per candidate and `transferDict` with every
donor→recipient breakdown. The front end positions every bar absolutely (setting `top`,
`left`, and `width` on divs) and uses jQuery to animate row reshuffles, quota markers,
and the vote rectangles that peel away from a donor bar before splitting into
sub-rectangles that travel to their destinations. The control bar also manages stage
highlighting and play/pause/step logic that is tightly coupled with those datasets.

## Gap analysis

| Area | Current viewer | NICVA-style requirement | Notes |
| --- | --- | --- | --- |
| Data payload | Net vote deltas inferred client-side; no persisted grouping for combined sources. | Explicit donor combinations, surplus vs elimination flags, authoritative per-recipient amounts. | We would need to materialise transfer dictionaries server-side, ideally lifting the `Transfers` sheet logic into the API and preserving “combinations” as named sources. |
| Layout | Flexbox rows with CSS transitions and FLIP-style reordering. | Absolute-position grid with manual `top/left` animation to mimic the GIF ordering and collision behaviour. | Scrapping the current layout means rewriting the markup generator and the animation loop to operate on positional math rather than relying on flex order. |
| Animation engine | Vanilla JS helpers that batch DOM writes, emit synthetic chunks, and reuse the viewer’s existing look and feel. | jQuery-driven timeline that orchestrates staging blocks, chunk splitting, and quota/counter UI. | We can port the concepts without jQuery, but we still need a frame scheduler that launches and tracks each rectangle individually instead of the current aggregated approach. |
| Controls & UX | Viewer-specific buttons (load/unload, play/pause, jump). | Stage indicators, quota summaries, and button layout matching the NICVA design. | Most of the controls already exist conceptually, but the styling and state management would need to be rebuilt to follow the reference closely. |

## Possible replacement approach

1. **Backend enrichment** – Extend the data access layer so `/api/search_elections`
   returns a NICVA-like transfer dictionary. The `Transfers` worksheet already encodes
   combination sources and destinations; we would need to promote that logic into
   reusable helpers that collapse rows per count and emit structures that the front end
   can consume directly.
2. **Template rewrite** – Replace the flexbox markup emitted for animations with an
   absolute-position scaffold (candidate labels, bars, quota line, transfer hub). This
   likely means rebuilding the template fragment so it mirrors the DOM hierarchy found
   in the NICVA project and tagging every node with IDs/classes that the new runtime
   expects.
3. **Animation engine port** – Implement a frame loop (vanilla JS or a small helper
   library) that can: (a) reorder candidates by manipulating `top` offsets, (b) carve
   donor surpluses/exclusions into the individual rectangles defined by the server,
   (c) animate those rectangles through a staging hub and onto destinations, and (d)
   sync the stage indicators/quota labels with count progression.
4. **Regression shielding** – Because the viewer renders multiple elections on a single
   page, we would need per-card lifecycle hooks to mount/destroy the new animation
   cleanly, as well as accessibility and responsiveness passes to ensure the absolute
   positioning degrades gracefully on narrow viewports.

## Effort and risk assessment

* **Complexity** – The change effectively replaces the entire animation subsystem:
  every template fragment, stylesheet rule, and JS helper tied to the current replay
  would be removed or rewritten. Expect a multi-week effort with substantial testing
  against varied elections (different seat counts, combined sources, incomplete data).
* **Data validation** – Building authoritative transfer dictionaries requires
  cross-checking the workbook’s `Transfers` data against the rendered results to ensure
  the combined-source naming conventions line up. Any mismatch will surface visually in
  the animation, so additional tooling/tests will be needed.
* **Maintenance** – Once ported, future adjustments (e.g., new election types or
  workbook schema tweaks) must update both the backend exporter and the animation
  engine. Documenting the new data structures and keeping examples in the repository
  will be essential to avoid regressions.

## Why proportional inference is insufficient

The workbook’s `Transfers` sheet records cases where multiple candidates or parties are
treated as a combined source. Those rows rarely map cleanly onto the simple “negative
totals must match positive totals” heuristic because:

* **Rounding and exhausted ballots.** The official results apply fractional
  distributions that are rounded at each step. Exhausted or non-transferable ballots
  absorb the rounding error, so the sum of destination increases often differs from the
  exact decrease in the donor’s running total. A proportional split derived from net
  deltas therefore introduces phantom votes or hides exhausted ballots.
* **Combined sources.** When the returning officer reports a combination (e.g.,
  “Surplus of Aiken & Michael”), the workbook keeps the label as-is even though the
  underlying `AdjustedTransfers` tab distributes the figures notionally between the
  individuals. If we infer purely from cumulative totals, we can no longer surface the
  combined label because the individual deltas will not expose which entries belonged
  to the reported grouping.
* **Staggered redistribution.** Some counts remove a candidate but defer part of the
  transfer until later counts. The running totals reflect only the portion processed so
  far, meaning per-count deltas underrepresent the true donor amount.

Because of these artefacts, a proportional reconstruction from running totals will
produce animations that mislabel the donor, mis-state exhausted ballot volumes, or fail
to match the official combined-source presentation. Shipping the authoritative transfer
dictionary from the backend is therefore a prerequisite for a NICVA-style replay.

## Conclusion

It is technically feasible to scrap the current animation and rebuild it so the viewer
resembles the NICVA replay, but doing so requires a ground-up rewrite of both the data
pipeline and the browser animation layer. The existing system can serve as a scaffold
for control wiring and API integration, yet achieving a near-identical look means
committing to the absolute-positioned layout, adopting explicit transfer dictionaries,
and dedicating time to recreate the multi-rectangle transfer choreography showcased in
the reference implementation.
