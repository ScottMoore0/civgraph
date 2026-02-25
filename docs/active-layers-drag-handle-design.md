# Active Layers Drag Handle Design

## Goal
Allow users to reorder loaded layers in the **Active Layers** panel by dragging a handle on each row, and apply that order to map rendering.

## Scope
- Applies to loaded layers shown in `#activeLayersList`.
- Supports both vector and raster layers.
- Keeps basemap/labels controls separate from user-managed overlay order.

## UX Contract
- Add a grip icon (`::`) at the left (or right) of each active-layer row.
- Drag starts from the grip only.
- Row shows insertion indicator while dragging.
- Drop updates list order immediately.
- Map render order updates immediately after drop.

## Ordering Model
- Maintain an explicit ordered array of loaded map IDs in app state, e.g. `layerDrawOrder`.
- Top row in Active Layers = highest z-order (drawn on top).
- Bottom row = lowest z-order.
- Persist order in URL/local state if desired (optional phase 2).

## Rendering Strategy (Leaflet)
- Keep deterministic pane tiers:
  - Basemap pane(s): fixed, below overlays.
  - DEM raster pane: low overlay tier.
  - Generic raster overlays pane: above DEM.
  - Vector overlays pane: above rasters.
  - Labels/interaction overlays: highest fixed tier.
- Within each tier, apply row order via per-layer z-index or `bringToFront` sequencing.

## Proposed Implementation Steps
1. Add drag handle UI in Active Layers row renderer (`js/ui-controller.js` / `js/app.js` integration).
2. Implement drag-and-drop list behavior (pointer/mouse events or HTML5 DnD).
3. Add `mapController.setLayerDrawOrder(orderedMapIds)` API.
4. In map controller:
   - compute target z-index per layer by order and type (raster/vector),
   - apply z-index and refresh front order.
5. Trigger reorder apply after:
   - drop action,
   - load/unload events,
   - show/hide toggles (retain relative order).

## Edge Cases
- Hidden layer should retain its position for when re-shown.
- Unloaded layer removed from ordering array.
- Newly loaded layer default insertion:
  - recommended: insert at top.
- Election synthetic layers:
  - either pinned to top tier, or participate as normal rows with guarded z-tier.

## Feasibility
- **High feasibility** on current architecture.
- Existing Active Layers state and map layer registry already exist.
- Main work is deterministic ordering glue and UI drag interactions.

## Verification Checklist
- Reordering two vector layers changes draw order correctly.
- Reordering raster vs vector behaves predictably by tier.
- DEM remains below vectors unless explicitly moved within allowed tier policy.
- Order remains stable after toggling visibility.
- No regression in load/unload, fit-to-layer, or label rendering.
