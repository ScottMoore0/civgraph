# Civgraph 1.0

> **Status: current — the statement of what Civgraph is, what it covers, and what
> distinguishes it.** Recorded 2026-09-18 from the author's text. This document defines
> scope and structure; `CIVGRAPH_PRINCIPLES.md` defines how the project is built and
> what is enforced. Where the two touch, this one says *what*, that one says *how*.

## The three layers

Civgraph is a platform consisting of:

**The source layer** — comprising original sources, such as texts, maps, and tables, be
they digital or scanned.

**The data layer** — comprising the data derived from the sources, which is labelled,
cleaned, and linked to other data points via relations and properties.

**The application layer** — in which the data is taken as an input by applications, such
as the main Civgraph site, its constituent features and its associated apps, and has a
process applied to it which results in a functional output.

Collectively, the three layers are the content of the project.

## Scope

### Geographical

The primary scope of Civgraph is the island of Ireland and its seas and outlying islands.
Content which extends beyond this scope may be incidentally included. Civgraph may
consider letting a credible person or group of people operate an associated Civgraph site
for a different geographical area.

### Thematic

The primary scope of Civgraph is openly-available civic data, which document the
geography, demography, politics, government, economics, society and history of Ireland.
Sources may be obtained from governments, public bodies or agencies, institutions of a
supranational, international or intergovernmental nature, but also from private
organisations, groups and individuals.

Civgraph will be a factual work of reference, comparable to an encyclopaedia, an almanac
or a gazetteer.

## Licensing

The site itself will be released under the MIT License, allowing it to be shared and
reused and changed by anyone so long as they include the MIT License statement alongside
any works or reworks.

The site will use open source technologies which will carry their own respective
licenses, such as the MIT License, the General Public License, and so on.

Sources and the derived data will be released under their original licenses, which will
generally be Creative Commons licenses, the Open Government License, and so on.

## What distinguishes Civgraph

Civgraph will be distinguished from other open source reference projects by all of the
following attributes:

- its nature as subdivided by geographical scope rather than by language per se;
- its inclusion of original sources themselves, including on a verbatim basis, as part of
  the integral content of the site;
- its inclusion of volunteer contributions derived from original sources, such as
  digitised maps, alongside original sources themselves, with all such contributions
  clearly distinguished;
- its inclusion of multiple different mediums and modes of data rather than just one,
  including geospatial maps, texts of reports and publications and legislative records and
  legislation and journals, tabular and numerical data such as demographics and opinion
  polls and statistics and election results, and biographical data on persons which appear
  in these sources and in the public record more broadly;
- its interconnection of all such data via a model involving relations, properties and
  values;
- its aim to build tools which can query the data model, take data as an input to process,
  and produce functional outputs from these, with arbitrary support for any
  practically-possible tool; not as an extension of the project, but an integral part of
  it.

### Against neighbouring projects

Distinctions may be observed between Civgraph and other open source projects and reference
projects. For example:

- The notability standards and format requirements of **Wikisource, Wikimedia Commons and
  Wikidata** may preclude the verbatim inclusion of open civic data in bulk on an
  indiscriminate basis, such as that from Open Data NI and the Open Data Portal Ireland.
- On the other hand, uploading in bulk to the **Internet Archive** alone may lack the
  required structure and rigour to allow data to be straightforwardly navigable, queryable
  and able to be analysed.
- In the case of **OpenStreetMap**, that project is characterised by the geospatial data
  existing as a unified data layer, rather than there being any role for discrete
  geospatial map files like GeoJSON, FGB etc stored as-is.

Moreover, barriers may exist to the layering of tools and applications over the data in
other projects, which would not necessarily be the case in a separate, independent
project.

Notwithstanding this, Civgraph would endeavour as far as possible to integrate and provide
interoperability with other open source reference projects.

## Interface

The user interface and user experience of the Civgraph website, and any future mobile app,
desktop client, or other interface, must maximise accessibility and ease of use.

### Open question: landing page, or one integrated surface

Civgraph's website may adopt a landing page, from which the source layer can be browsed
and viewed and searched, the data layer can be browsed and viewed and searched and queried
and analysed, and the application layer can fulfil its functions, all via the main
Civgraph interface and the associated web apps.

Another option may be for the main Civgraph interface to be a single integrated surface
without a separate landing page. This seems unlikely in view of the fact that a user on
Civgraph may not be looking to do any one thing in particular — unlike Google Maps, where
a user is generally always looking to know where something is or where to go, thus it does
not require a separate landing page.

*This question is open. The author's text breaks off at "In considering how to approach
this," and nothing further has been recorded.*

---

## Where existing work sits against the three layers

Not part of the statement above; recorded here because the layers resolve questions the
codebase keeps re-asking.

| layer | in this repo |
|---|---|
| source | PRONI eCatalogue records, OSNI/Tailte/council originals, the scanned map series, the `sources` store (51,071 rows per `docs/plans/PLAN-entity-model.md`) |
| data | `data/database/maps.json`, the election and person stores, the derived relations in `docs/civgraph-semantic-graph-implementation-plan.md` |
| application | the MapLibre app in `app/`, the election pane, `/proni`, the catalogue pane |

The distinction has a practical consequence for the catalogue taxonomy work in
`scripts/catalogue-taxonomy/`:

- **`subject` and `kind` are data-layer.** They are properties of a map, derivable and
  citable, and belong in the data store rather than in a UI file.
- **Entry grouping is data-layer too**, because "these 54 maps are editions of one thing"
  is a *relation* between maps, not a presentation choice — even though its first use is
  presentational.
- **Shelves and ordering are application-layer.** They are one view over the data layer,
  and a second application could reasonably choose a different one.

This is why the catalogue's current arrangement is awkward: all three live in
`src/ui-controller.js`, so a fact about a map can only be stated by editing the interface.
