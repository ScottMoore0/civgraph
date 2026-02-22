## Grouped Catalogue View Archive

Date archived: 2026-02-22

The grouped catalogue view (`#mapList`) was removed from runtime usage.

Current behavior:
- The catalogue uses flat view only (`#catalogueFlatView`).
- `uiController.renderMapList(...)` now drives flat re-rendering and filter stats.
- `App.updateColumnLayout()` no longer applies grouped-grid classes.

Notes:
- Some legacy grouped rendering code remains in `js/ui-controller.js` as inert fallback
  paths, but it is no longer reachable in normal runtime because `#mapList` is no longer
  present in `index.html`.
