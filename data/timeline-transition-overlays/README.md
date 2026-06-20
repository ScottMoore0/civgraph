# Timeline Transition Runtime Overlays

This directory contains the browser-runtime GeoJSON overlays for the territorial timeline animation.

The larger files in `data/timeline-transitions/` retain the full transition analysis, including transparent `unchanged` parts used for local QA and richer hit-testing experiments. Those files exceed Cloudflare Pages' per-file asset limit and are intentionally excluded from Pages deployment.

Runtime overlays keep only visible transition parts:

- `transfer` pieces render red.
- `split` / `territory-split` pieces render purple.
- `unchanged` / `retained` pieces are omitted so every runtime file remains deployable.

Regenerate after rebuilding the full sidecars with:

```bash
node scripts/build-timeline-transition-runtime-overlays.mjs
```
