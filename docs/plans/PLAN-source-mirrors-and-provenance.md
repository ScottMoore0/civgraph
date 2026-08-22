# Plan — source mirrors, and separating original data from processed data

> **Status: ready to execute in stages. The provenance layer is the load-bearing part;
> the mirror apps are what it makes possible.** Written 2026-08-23, from your outline.
> Covers "multiple versions per map listing" and the mirror-app idea, which turn out to
> be the same problem seen from two ends.

## The insight worth stating plainly

The mirrors and the "multiple versions per listing" item look like two features. They are
one: **a record of what the source actually said, kept separately from what we made of
it.**

Your Northern Ireland wards example is the whole argument. OSNI publishes one feature per
*part* of a ward — a ward with five islands is six features. A Civgraph version with one
feature per ward is more useful for almost every purpose and is **not the same dataset**.
Today those two things would occupy one catalogue entry and the difference would live in
a description, if anywhere.

Three things follow, and they are the real payoff:

- **We never re-download.** The original is held, so a correction, a re-cut or a mistake
  is recoverable from our own copy rather than from a third party who may have changed or
  withdrawn it.
- **Damage is repairable.** If processed data is edited badly, the derivation can be
  re-run from the original. Right now the original is a URL and a hope.
- **Provenance becomes checkable.** "This is derived from OSNI's 2012 wards by dissolving
  on WARD_CODE" is a statement a validator can test, not a sentence in a README.

## The model

Every dataset gets a **tier**:

| Tier | Meaning | Editable |
|---|---|---|
| `original` | exactly as published by the source, byte-for-byte | never |
| `derived` | produced from an original by a recorded transformation | by re-deriving |
| `authored` | created by Civgraph, no upstream original | yes |

A `derived` record names its `derivedFrom` (an original's id) and its `derivation` (a
named, re-runnable transformation). That makes the catalogue a graph rather than a list,
and it is the same graph the entity model needs — which is why these plans converge.

```jsonc
{
  "id": "ni-wards-2012",
  "tier": "derived",
  "derivedFrom": "opendatani:osni-wards-2012",
  "derivation": { "op": "dissolve", "on": "WARD_CODE" },
  "featureCount": 462,
  "variants": [
    { "id": "ni-wards-2012-original", "tier": "original", "label": "OSNI as published",
      "featureCount": 1157, "note": "one feature per ward part, including islands" }
  ]
}
```

`variants` already exists on **50 catalogue records** — this extends a mechanism rather
than inventing one.

## The mirrors, as apps

Per your note: these are apps alongside Independent PRONI Search, not catalogue sections.

Open Data NI · Open Data Portal Ireland · Tailte Éireann · NI Assembly · Oireachtas ·
Oireachtas Library · CSO · NISRA.

They share one shape, which is what makes them tractable: **hold the source's records as
`original`, add search the source does not offer, and make the constituent parts
searchable — individual features within a digitised map, individual tables within a
release.** That last part is the differentiator and the reason a mirror is worth building
rather than a link.

**Do not build eight apps.** Build one mirror engine — ingest, store as `original`,
index, search UI — and configure it per source. PRONI Search is the working prototype;
the second mirror is where its reusable parts get factored out. Deciding that before the
second one is written is the difference between one codebase and eight.

### Licensing, before anything else

- **OGL sources** (most NI and Irish public data) — fine, with attribution.
- **Oireachtas Library OPAC** — you flagged this yourself. Catalogue records may be
  differently licensed from the data. **Resolve before ingesting**, not after; a mirror is
  a republication.
- **CSO / NISRA** — generally permissive, but bulk mirroring is a different act from
  querying, and worth an explicit check.

Record the licence per source in the mirror's config, and have the app display it. If a
source cannot be mirrored, a searchable *index* pointing at the source may still be
possible and is worth having.

## Steps

1. **Add `tier` to the catalogue schema** with a validator: every record has one; every
   `derived` names a `derivedFrom` that exists; no `original` is ever edited in place.
2. **Backfill tiers.** Most existing records are `derived` or `authored`. This is a
   classification pass over 1,031 records — mechanical, and the point where the wards case
   gets recorded properly.
3. **Original store.** R2 prefix `data/originals/<source>/<dataset>/<version>/`, with a
   manifest holding the source URL, retrieval date, licence and **sha256 as received**.
   That hash is the thing that closes the upstream gap `verify-source-cache-parity.mjs`
   documents as unguarded — for everything ingested from here on.
4. **One derivation, made explicit.** Take NI wards 2012, hold the OSNI original, record
   the dissolve, re-derive, and check the result matches what is published today. If it
   does not, that discrepancy is a finding worth having.
5. **Mirror engine**, extracted from PRONI Search: ingest → `original` store → index →
   search UI. Configured per source.
6. **Second mirror — Open Data NI**, because it is OGL, well-structured, and already the
   upstream for a lot of the corpus.

## Definition of done

- Every catalogue record has a tier, and the validator enforces the rules.
- The OSNI wards original and the Civgraph wards derivation are both listed, both
  downloadable, and visibly different in feature count.
- One derivation can be re-run from the original and reproduces the published output.
- A second mirror exists and shares its engine with PRONI Search.
