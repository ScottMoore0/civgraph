# Execution plans

Each file here is meant to be handed back as an instruction: *"execute
`PLAN-composable-maps.md`"*. They are written to be executable rather than aspirational —
grounded in measured numbers from this repository, naming the files that already exist,
and stating the decision that has to be made before the work starts.

| Plan | Covers | Blocked by |
|---|---|---|
| [`PLAN-composable-maps.md`](PLAN-composable-maps.md) | custom secondary maps, shareable URLs, composable time series, **the ED population map 1901–2027 as its acceptance test** | entity model (step 3 only) |
| [`PLAN-charts-and-performance-by-party.md`](PLAN-charts-and-performance-by-party.md) | "performance by party" first, chart/infographic creator as its generalisation | nothing for part 1 |
| [`PLAN-stv-standard.md`](PLAN-stv-standard.md) | standardised STV count data across 99 contests and two transfer rules | nothing — **and it gets more expensive the longer it waits** |
| [`PLAN-source-mirrors-and-provenance.md`](PLAN-source-mirrors-and-provenance.md) | original-vs-derived tiers, multiple versions per listing, the eight mirror apps | licensing checks per source |
| [`PLAN-entity-model.md`](PLAN-entity-model.md) | continuity, containment and measures on the **existing** 193,132-entity graph | nothing |

## Three things that recur across all five

**The entity model is underneath everything — and it already exists.** When these plans
were written I believed it was unbuilt. It is not: 193,132 entities across 18 types,
generated on every build, including candidatures, contests, people, parties and 14,615
geographic features. What is missing is three relations — continuity across time,
containment, and measures — plus a graph client in the map app, which currently does not
read the graph at all. See `PLAN-entity-model.md`. Every "blocked by entity model" note in
the other plans means those three relations, not a greenfield build.

**Build the specific thing first, then generalise.** Performance-by-party before the
chart builder. One hand-verified STV contest before the converter. One derivation before
the mirror engine. The ED population map as the test of the composer rather than a
feature of its own. Every plan here is arranged that way deliberately — a general tool
designed before anything concrete uses it gets designed around guesses.

**Decide the ambiguity before writing code.** Each plan names the one question that
changes the implementation: which denominator "performance" means, whether composition
attributes go in tiles or beside them, whether an FPTP result shares the STV schema,
whether a source may be mirrored at all. Those are cheap to answer now and expensive to
change later.
