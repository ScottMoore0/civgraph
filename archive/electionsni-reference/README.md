<!--
  WHY THIS IS IN THE CIVGRAPH REPO
  ================================
  Everything below the horizontal rule is UPSTREAM's README, describing the ElectionsNI
  project itself. It does not say what the directory is doing here. This preface does.
-->

# Why Civgraph holds this

This is a **vendored copy of a third-party repository**, kept as provenance for Civgraph's
Northern Ireland election data. It is reference material: nothing in the build reads it, and
it is excluded from the Cloudflare Pages deployment.

| | |
|---|---|
| Upstream | https://github.com/NICVA/electionsni |
| Pinned at | `2dba8e545ece265f283fedf2b8cf6640fbb2cb64` (2019-06-04, *"updates for switch to new host"*) |
| Files | 512, byte-identical to upstream except as noted below |
| Licence | CC-BY-SA 4.0 (repo) and ODbL (the datasets). **Attribution is required.** |

## The one local change

`website/js/map.js` differs from upstream by two lines. The Leaflet basemap was switched
from Mapbox to OpenStreetMap, which also removed a hardcoded Mapbox access token belonging
to a third party. That is the *only* difference in the tree — worth knowing before anyone
diffs against upstream and assumes the copy has drifted.

## The attribution this is evidence for

Civgraph's STV animation derives from ElectionsNI's `stages.css`. The derivation is recorded
in a code comment — `app/election-viewer-package/css/election-viewer.css:9`, *"STV Animation
(from stages.css / electionsni)"* — in **shipped** code, not reference material.

Both licences above require attribution, and as of 2026-08-27 `data/database/sources.json`
carries **no ElectionsNI entry**. So this directory is not only provenance in the abstract;
it is the evidence for a credit that is currently owed and not given. Resolve the
`sources.json` entry before deciding whether the 22 MB still needs to sit on disk.

---

# electionsni
Open Data frameworks, datasets and front-end for elections in Northern Ireland

## about the project
The Elections NI Open Data project is a collaboration of people who wanted to produce datasets and visualisations of the 2016 Northern Ireland Assembly elections, led by ODI Belfast at NICVA and the NI Open Government Network.

## the data
To get the data, view the [Schema](https://github.com/NICVA/electionsni/blob/master/schema.md) and [browse](http://electionsni.org.s3-website-eu-west-1.amazonaws.com/data/) the directories.

These databases are made available under the Open Database Licence (ODbL). Any rights in individual contents of the database are licensed under the Database Contents License. You should attribute authorship to electionsni.org and the Electoral Office for Northern Ireland.

## the site
Find us at [electionsni.org](http://electionsni.org). We are visualising data and communicating it to the public at large.

The site uses a number of javascript libraries:
* [d3](https://d3js.org/)
* [leaflet](http://leafletjs.com/)
* [lodash](https://lodash.com/)

The website data is comprised of JSON files, which are generated directly from the database hosted on the site.

## contributing
We're keen to have others contribute to the project however they can. Open an issue, or contact us to take part, or even if you just have an idea that we should look at.

**We're also looking for observers at count centers to help us crowdsource the results live. Again, get in contact if you want to help.**
