# Civgraph source ledger

> **Status:** generated from `data/database/source-ledger.json` by `node scripts/check/rules/source-ledger.mjs --write` (ledger as of 2026-11-11). Do not edit by hand.

Published with the site, so it lists only sources whose content Civgraph may make public: open licences (OGL, OPL, Creative Commons, CC0, ODbL, Irish PSI open terms), Crown or state copyright that has expired, the public domain, and Civgraph's own or contributed work. Sources held or consulted under any other terms are tracked privately and are not listed here.

48 sources. Mirrored: complete 25, partial 15, none 8. Extracted: partial 24, complete 9, not-started 8, reference-only 7.

## elections

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [Irish election result books and open data (Department of Housing)](https://opendata.housing.gov.ie) | PSI-open | partial (local, official Dáil results archive and local, European, presidential and referendum result books (held locally, not mirrored whole)) | partial (provenanceCitations 2,300) | Verification of the remaining ROI local rounds against the result books; the 1974, 1979 and 1985 local rounds are held back. |
| [Oireachtas Library catalogue: printed election result books](https://opac.oireachtas.ie) | PSI-open | none | reference-only (provenanceCitations 207) | Result books are cited, not mirrored. |
| [Electoral Office for Northern Ireland result sheets (incl. archived 1973-2005 sheets)](https://www.eoni.org.uk) | OGL-3.0 | partial (r2, local, 414 objects, 0.18 GB on R2 (data/sources/eoni-result-sheets/): the 2022 Assembly, 2023 council and 2024 Westminster sheets on eoni.org.uk and 330 earlier sheets and booklets (1973-2021) from Internet Archive captures, with a manifest; a further set recovered from the Internet Archive on 11 Nov 2026 is held locally, awaiting upload) | partial (provenanceCitations 1,715) | 61 figures where the sheets and Civgraph disagree await a decision; Assembly 1998 and 2003, Forum 1996 and European 1979-1999 are rotated scans not yet compared; of the sheets recovered on 11 Nov 2026, 58 of the 2011 council sheets (most of them scans), 19 scanned 2019 council sheets (Derry City and Strabane, Lisburn and Castlereagh, Newry, Mourne and Down) and 7 of the 2007 Assembly slides still need checking by eye, and the by-election results are not yet compared. For Westminster 2010-2019 EONI published results pages, not sheets. |
| [Electoral Commission (UK) results and reports](https://www.electoralcommission.org.uk) | OGL-3.0 | partial (r2, 31 objects, 0.02 GB on R2 (data/sources/uk-electoral-commission/): NI results spreadsheets for Westminster, Assembly, European, local and the 2011 and 2016 referendums, with a manifest) | partial (provenanceCitations 87) | The Commission's web pages answer automated requests with a browser challenge, so files were taken from direct links or archive captures; 27 figures where its spreadsheets and Civgraph disagree await a decision. |
| [House of Commons Library election statistics and constituency results](https://commonslibrary.parliament.uk) | OPL-3.0 | partial (local, general-election results by constituency 2015-2024 (spreadsheets); the 1918-2023 statistics PDF is cited live) | reference-only (provenanceCitations 381) | The UK Election Statistics 1918-2023 briefing is not held locally. |
| [Constituency Commission and Local Electoral Area boundary committee reports](https://www.electoralcommission.ie) | PSI-open | partial (r2, 106 objects, 0.75 GB on R2 (data/sources/ie-boundary-committee-reports/): the LEA boundary committee reports of 2008, 2013 and 2018, the Constituency Commission reports of 2004, 2007, 2012 and 2017, the 2023 constituency review and the European constituency reports of 2003-2023, with their maps and a manifest) | partial (provenanceCitations 102) | The Constituency Commission reports of 1980-1998 and the 1998 LEA committee reports are not online; the earlier Dail and LEA layers have no report linked. |
| [Civgraph NI election results compilation (own work)](https://civgraph.net) | own-work | complete (local, d1) | complete | Continuing source checks against official sheets and gazette notices. |
| [ElectionsNI open election data (ODI Belfast at NICVA)](https://github.com/NICVA/electionsni) | ODbL | partial (local, the project repository pinned at commit 2dba8e5 (2019-06-04), held offline as reference) | reference-only (provenanceCitations 0) | Its 2016 Assembly datasets are not compared with Civgraph's records. |

## parliaments

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [Oireachtas debates, full text](https://www.oireachtas.ie) | PSI-open | complete (r2, 52.31 GB, 50,824 objects on R2 (data/sources/oireachtas-fulltext/)) | partial | Debates are not yet linked to contests, offices or places. |
| [Oireachtas open data API (members, constituencies, parties, votes, legislation)](https://api.oireachtas.ie) | PSI-open | complete (local, about 5 GB) | partial (provenanceCitations 4) | Structured data beyond member ids (votes, questions, legislation) is not integrated; not on R2 or IA. |
| [Northern Ireland Assembly open data (members, Hansard, questions, register of interests)](https://data.niassembly.gov.uk) | OGL-3.0 | complete (local, about 4.5 GB XML) | partial (provenanceCitations 0) | Hansard, plenary and questions are not integrated; harvest is local only. |
| [Parliament of Northern Ireland Hansard, 1921-1945](https://archive.org/details/civgraph-ni-hansard-1921-1945) | crown-copyright-expired | complete (r2, internet-archive, 0.38 GB, 79 objects on R2 (data/books/)) | complete | Volumes after 1945 are not held; per-item provenance for the scans is still to be recorded. |
| [Words in parliament: word and phrase counts (Civgraph-derived)](https://civgraph.net/apps/words/) | own-work | complete (r2, 0.42 GB (15,051 objects under data/parliament/words/)) | complete (objects 15,051, provenanceCitations 0) | Rebuild when new debates are added; the counts cover the debates held at the 3 Nov 2026 build. |

## gazettes

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [The Gazette (Belfast and London editions): election and boundary notices](https://www.thegazette.co.uk) | OGL-3.0 | partial (local, every Belfast Gazette issue 1921-2026 read through its text layer (held locally, cited by issue and page)) | partial (provenanceCitations 860) | The Gazette prints no council election returns, nominations or results, so it cannot fill council gaps: council members appear only when a later notice styles them Councillor or Alderman, which corroborates a membership but names no election. |
| [Belfast Gazette volumes, 1921-c.1969 (HathiTrust scans)](https://catalog.hathitrust.org) | crown-copyright-expired | partial (local, 65 issue PDFs, about 73 MB, with text) | partial (boundaryOrders 190, citedOnMaps 152) | 8 changes not yet drawn have no printed description (Larne 1930, 1948 and 1956, Newtownards 1938, 1950 and 1968, Coleraine 1962, Belfast-Ballydownfine 1962) and need the deposited maps or the Acts; 3 are described only in part. |
| [London Gazette: Irish notices before 1922](https://www.thegazette.co.uk/London) | OGL-3.0 | none | not-started | Not held: pre-1922 Irish election writs, returns, boundary and Poor Law union orders. |
| [Iris Oifigiúil (Irish state gazette, 1922-)](https://www.irisoifigiuil.ie) | copyright-expired | none | not-started | Not held: Dáil and local election notices, boundary and county orders since 1922. |

## census-statistics

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [CSO PxStat statistical cubes](https://data.cso.ie) | CC-BY-4.0 | complete (r2, local, 2.21 GB, 25,060 objects on R2 (data/cso-pxstat/)) | partial (provenanceCitations 0) | Census cubes are not all joined to boundary layers. |
| [CSO historical census and statistical reports, 1841-1991](https://archive.org/details/civgraph-cso-historical-reports) | CC-BY-4.0 | complete (internet-archive, local, 2,172 reports on IA) | partial | Most report tables are not extracted. |
| [NISRA statistics mirror](https://www.nisra.gov.uk) | OGL-3.0 | complete (r2, local, 7.52 GB, 33,593 objects on R2 (data/nisra-files/)) | partial (provenanceCitations 0) | Many tables are mirrored but not modelled. |
| [NISRA data portal tables (cleaned)](https://data.nisra.gov.uk) | OGL-3.0 | complete (r2, 0.05 GB, 1,115 objects on R2 (data/nisra-portal/)) | complete | None known. |
| [NISRA pages recovered from the Wayback Machine](https://web.archive.org) | OGL-3.0 | partial (local, about 14 GB, 24,889 files) | not-started | Local only; not on R2 or IA. |
| [NI Multiple Deprivation Measure](https://www.nisra.gov.uk) | OGL-3.0 | complete (r2, 0.01 GB, 6 objects on R2 (data/deprivation/)) | complete | None known. |
| Northern Ireland census reports, 1926-1981 | crown-copyright-expired | partial (local, county and general reports 1926-1981) | partial | Scans not on IA; tables not extracted to data. 1971 and 1981 reports are newer than the 50-year term and are held under OGL instead. |
| [Northern Ireland census 2001, 2011 and 2021 outputs (incl. flexible table builder)](https://www.nisra.gov.uk/statistics/census) | OGL-3.0 | complete (r2, local, 59.67 GB, 165,219 objects on R2 (data/census/)) | partial | Not all tables are joined to the DZ/SA/OA layers. |

## boundaries-maps

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [Irish Digitised Boundaries (contributed digitisations: EDs, DEDs, wards, constituencies, townlands)](https://civgraph.net) | own-work | complete (local, r2, three deliveries 2026 (about 5 GB)) | partial | Later deliveries (1911/1926 EDs, Leinster ward/DED series 1941-85, NI DEDs 1921) are only partly integrated; the 4 Aug 2026 delivery manifest covers EDs only. |
| [Tailte Éireann and CSO official boundaries (constituencies, LEAs, EDs, counties, small areas)](https://data-osi.opendata.arcgis.com) | CC-BY-4.0 | complete (local, r2) | partial (provenanceCitations 0) | Older ungeneralised series not all published. |
| [OSNI and NISRA boundaries (wards, DEAs, LGDs, constituencies, OA/SA/SOA, DZ/SDZ, townlands)](https://www.opendatani.gov.uk) | OGL-3.0 | complete (local, r2) | partial | Duplicated local copies not reconciled; some historical vintages (1966-1993 LGDs, 1930 DEDs) still being traced. |
| [OSNI historical six-inch maps, Editions 1-2](https://www.opendatani.gov.uk) | OGL-3.0 | none | reference-only | Not confirmed as part of the OpenDataNI mirror. |

## archives

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [PRONI eCatalogue records](https://apps.proni.gov.uk/eCatalogueNav) | OGL-3.0 | complete (local, d1, about 11 GB scrape; D1 proni-catalogue about 1.3 GB) | complete (records 1,538,177, provenanceCitations 0) | Document images cannot be captured (the image endpoint blocks automated access); extracted dates still need overrides review. |

## open-data

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [data.gov.ie mirror (Open Data Portal Ireland)](https://data.gov.ie) | PSI-open | complete (r2, internet-archive, local, 102.45 GB, 23,566 objects on R2 (data/datagovie/)) | partial (provenanceCitations 0) | Pending-IA batch still staged on R2; most datasets not modelled. |
| [OpenDataNI mirror](https://www.opendatani.gov.uk) | OGL-3.0 | partial (local, internet-archive, about 221 GB locally; IA partial) | partial (provenanceCitations 0) | IA upload is partial; gap report open. |

## geodata

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [Tellus airborne geophysics](https://www.bgs.ac.uk/gsni/tellus) | OGL-3.0 | complete (local, about 4.9 GB grids) | complete | Source grids local only. |
| [OpenDataNI lidar point clouds (3D Tiles)](https://www.opendatani.gov.uk) | OGL-3.0 | complete (r2, 32.95 GB, 393,355 objects on R2 (data/pointclouds/)) | partial | North Coast 2022 clouds lack source colour; the A6 survey is raw drone photography needing an orthomosaic. |
| [Tailte Éireann National Land Cover 2018](https://www.tailte.ie) | CC-BY-4.0 | complete (r2, 48.48 GB, 1 objects on R2 (data/sources/tailte-national-land-cover-2018/)) | not-started | Held as one archive; not tiled. |
| [Copernicus GLO-30 digital elevation model](https://dataspace.copernicus.eu) | open-other | partial (local, Ireland tiles) | complete | None known. |
| [OS Code-Point Open (GB postcodes)](https://osdatahub.os.uk) | OGL-3.0 | complete (local) | not-started | Unused so far. |
| [Database of British and Irish Hills (v18.4)](https://www.hills-database.co.uk) | CC-BY-4.0 | complete (internet-archive, the v18.4 download files and survey reports) | complete (provenanceCitations 0) | None known. |

## books-catalogues

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [Open Library works dump (31 Oct 2026)](https://openlibrary.org/developers/dumps) | CC0 | complete (local, about 3.8 GiB compressed) | partial | Not published; used only as a classification aid. |
| [Internet Archive public-domain Irish books (free to download)](https://archive.org) | public-domain | none | not-started | No list yet of freely downloadable Irish-subject books (directories, almanacs, gazetteers, election histories). |

## place-names

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| [OSNI place names gazetteer](https://www.opendatani.gov.uk) | OGL-3.0 | complete (local) | reference-only | Not loaded as data. |

## reference

| Source | Rights | Mirrored | Extracted | Remaining |
|---|---|---|---|---|
| Thom's Irish Almanac and Official Directory (pre-1926 editions) | public-domain | none | not-started | Not held: lists of MPs, poor law unions, town commissioners and officials by year. |
| [Wikipedia (constituency, election and person articles)](https://en.wikipedia.org) | CC-BY-SA | partial (local, about 6,800 cached pages) | partial (provenanceCitations 3,057) | Cited sources are being replaced by primary sources where possible. |
| [Wikidata](https://www.wikidata.org) | CC0 | none | partial (provenanceCitations 0) | Wikidata records few Irish councillors, so most council members have no item to link. |
| [UK and Northern Ireland legislation (legislation.gov.uk; NI public general statutes)](https://www.legislation.gov.uk) | OGL-3.0 | partial (r2, 13 statute PDFs (data/books/legislation/)) | partial (provenanceCitations 222) | Most local boundary orders of 1921-1972 were never printed in the annual volumes and are not on legislation.gov.uk; they are known from the Belfast Gazette. |
| [Irish Statute Book](https://www.irishstatutebook.ie) | PSI-open | none | reference-only (provenanceCitations 0) | Not mirrored. |
| Review Body on Local Government in Northern Ireland (Macrory Report, 1970) | crown-copyright-expired | complete (local, two parts, about 97 MB) | reference-only | Not on IA. |
| Lockwood Report (Higher Education in Northern Ireland, 1965), part | crown-copyright-expired | partial (local, part only, about 116 MB) | not-started | Relevance to Civgraph not yet assessed. |

## Live stores

Measured 2026-11-09 (the three data/sources/ prefixes for EONI, the Electoral Commission and the Irish boundary reports added 2026-11-11).

- **r2**: data/books/ 0.38 GB / 79 objects; data/browse/ 2.17 GB / 5406 objects; data/census/ 59.67 GB / 165219 objects; data/cso-pxstat/ 2.21 GB / 25060 objects; data/datagovie/ 102.45 GB / 23566 objects; data/deprivation/ 0.01 GB / 6 objects; data/documents/ 0.18 GB / 21 objects; data/downloads/ 1.44 GB / 7 objects; data/maps/ 66.1 GB / 1222381 objects; data/nisra-files/ 7.52 GB / 33593 objects; data/nisra-portal/ 0.05 GB / 1115 objects; data/parliament/ 0.42 GB / 15051 objects; data/pointclouds/ 32.95 GB / 393355 objects; data/sources/datagovie-pending-ia/ 1.23 GB / 19790 objects; data/sources/eoni-result-sheets/ 0.18 GB / 414 objects; data/sources/ie-boundary-committee-reports/ 0.75 GB / 106 objects; data/sources/oireachtas-fulltext/ 52.31 GB / 50824 objects; data/sources/tailte-national-land-cover-2018/ 48.48 GB / 1 objects; data/sources/uk-electoral-commission/ 0.02 GB / 31 objects; data/thumbnails/ 0.2 GB / 47521 objects; data/timeline-transitions/ 0.16 GB / 6 objects
- **D1 civgraph-records**: contests 21,010; candidacies 76,994; citations 44,690; graph_entities 307,826; layers 1,339; documents 26
- **D1 proni-catalogue**: records 1,538,177

