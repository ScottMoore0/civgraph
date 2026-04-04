# Glossary

This glossary is for later agents who need repo-specific context quickly.

## Atom

The smallest implementation step intended to be executed, verified, and accepted or rejected independently.

## Automated non-browser checks

The first verification layer for this handoff. These are scripts, builds, syntax checks, validators, and benchmarks that do not depend on browser automation.

## Manual checks

The second verification layer, performed by the user in a real browser after the automated checks pass.

## LOD

Level of detail. In this repo, maps can prefer lower-detail derived geometry at low zooms and switch to fuller detail later.

## Chunked loading

Loading map data in viewport-related pieces instead of one full file.

## Chunk concurrency

The number of chunk fetch/load operations allowed in parallel for a chunked map.

## Additive artifact

A generated performance-oriented file added beside the existing source/fallback files, not a replacement for them.

## Bundle artifact

In local elections, a precomputed file that groups multiple constituency payloads to avoid many smaller fetches.

## Aggregate artifact

A precomputed file that stores summary values which would otherwise be rebuilt at runtime.

## Fallback path

The old or simpler code/data path that remains available if the optimized path is missing, invalid, or rejected.

## Pilot

A narrow rollout on one map, one feature, one data family, or one surface before any broader enablement.

## Protected metric

A metric that must not regress beyond its defined threshold without explicit acceptance of the tradeoff.

## Combined verification

The process of checking that multiple individually accepted improvements still behave well together.

