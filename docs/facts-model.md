# The facts model: offices, tenures, party events and affiliation

> **Status: current, 2026-11-06.** Model, schemas, validator and the first load (Elliott & Flackes, 1999) are on branch `facts-model`; the D1 tables below are a proposal for the `restructure` loader and are not built yet.

Civgraph's records were elections, candidacies, parties and people. This adds three kinds of fact the elections cannot carry:

1. **Offices and tenures.** Who held which office, from when to when, how the tenure began and ended.
2. **Party lifecycle and internal contests.** When a party was founded, renamed, split or wound up, and the ballots its own members held (leadership elections, nomination contests).
3. **Affiliation over time.** A person's party, independence or whip as dated intervals.

Every fact carries a citation in the repository's shape (`data/elections/web-checked-sources.json`). A book cites its page. Nothing is copied from a source's text. A date the source does not give is `null`, and every date records its precision (`year`, `month` or `day`). Where a source shows only that a person was in post by a date, and not when they began, a tenure or honour has `start: null` and `startBy` (the person page reads "in post by …"); its id ends `by-<date>`.

## Files (the source of truth, in git)

| File | Holds | Schema |
|---|---|---|
| `data/offices/offices.json` | institutions, and the offices in them | `data/schemas/offices.schema.json` |
| `data/offices/tenures/*.json` | tenures, one file per group of institutions | `data/schemas/tenures.schema.json` |
| `data/elections/parties/party-events.json` | dated party events | `data/schemas/party-events.schema.json` |
| `data/elections/persons/affiliations.json` | affiliation intervals | `data/schemas/affiliations.schema.json` |
| `data/elections/persons/non-candidate-persons.json` | people who never stood (NIO ministers, civil servants, party officers) | `data/schemas/non-candidate-persons.schema.json` |
| `data/elections/persons/honours.json` | peerages, knighthoods, the Privy Council, lieutenancies, public appointments, and seats in appointed or indirectly chosen bodies (the NI Senate, Seanad Éireann, the nominated European Parliament) | `data/schemas/honours.schema.json` |
| `data/elections-source/data/elections/<party>-leadership/…` | internal contests, as ordinary contest files | the elections format |

Citations share `data/schemas/citation.schema.json`. `npm run check:facts` (`scripts/check/rules/facts-model.mjs`) runs the schemas and the rules a schema cannot state:

- every id is unique;
- every person, party, office and contest reference resolves;
- a date's precision is the one it carries, and a start comes before its end;
- registered people stay in their id block, share no official id with a candidate, and are in `person_registry.json`;
- a `-leadership` or `-nomination` body is declared `party-internal`.

The shared loader and rules are in `scripts/lib/facts-model.mjs`. The tests are in `tests/facts/` (`npm run test:facts`).

### Ids

- An **office** id is a permanent slug (`uup-leader`, `secretary-of-state-ni`, `lord-mayor-belfast`). A renamed office keeps its id and gains a `nameHistory` entry.
- A **tenure** id is `<office>:<person>:<start>`, or `<office>:<person>:to-<end>` where only the end is known.
- A **party event** id is `<party>:<type>:<date>`.
- **Party** ids are `data/elections/parties/party_registry.json` ids, not Browse label slugs. Browse maps one to the other through the party's labels (`browsePartySlugResolver`).
- **Person** ids are `person_registry.json` ids. People who never stood are registered in `non-candidate-persons.json`, in a block of their own (900001–999999) that candidate ids never reach. `scripts/ingest/persons/build_person_registry_v2.py` appends them with `keyedBy: "registered"`, after the candidate entities, so adding one renumbers nothing.
  - `apply_person_ids_v2.py`, `merge_person_ids.py` and `audit_person_ids.py` ignore them: no candidacy is ever stamped with a registered id, and no merge is made by name.
  - A registered person later found among the candidates is merged into the candidate record by hand, never registered twice; the validator fails if the two share an official id.

## Internal contests reuse the elections machinery

A leadership or nomination ballot is an ordinary election whose electorate is a party body.

- **Body.** Each party's ballots form a body with a slug of its own: `uup-leadership`, `fianna-fail-leadership`, `fianna-fail-presidential-nomination`. Its entry in `elections_index.json` carries `"bodyType": "party-internal"` and the `partyId`.
- **Contest.** The "constituency" is the electorate (`Ulster Unionist Council`, `Fianna Fáil Parliamentary Party`).
- **Ballots.** Each ballot is its own contest (`… (first ballot)`, `… (second ballot)`): a later ballot is a fresh vote, not a transfer. Each is counted `fptp`, and a ballot that chose nobody has 0 seats.
- **Pipeline.** `scripts/build/build-test2-election-manifest.mjs` gives party-internal bodies no map (results only) and `scripts/lib/election-names.mjs` titles them ("September 1995 Ulster Unionist Party leadership election", never a by-election). Results tables, Browse election pages, provenance and person ids then work as for any election.
- **Identity.** Candidates carry the ids their other candidacies carry: `Candidate_Id` for Northern Ireland records, `ei_candidate_id` for ElectionsIreland ones. The person-id rebuild therefore stamps the existing person; no candidacy elsewhere changed.
- **Link to the office.** A tenure that began with a contest names it (`contest: "uup-leadership__1995-09-08"`).

## Browse

- **Person pages:**
  - **Offices**: tenures, linked to office pages, with how each began and ended, cited;
  - **Affiliation timeline**: each interval, and the candidacies inside it that carried a different label. Both are shown; neither overwrites the other.
  - Registered non-candidates get a person record with no contests.
- **Party pages** (`scripts/build/build-party-profiles.mjs`):
  - **Leaders and officers** from tenures;
  - party events in the **Timeline**;
  - **Internal contests** with their ballots.
- **Office pages:** `/browse/offices/<id>` (`scripts/build/build-office-pages.mjs`, `functions/browse/offices/`) lists the holders.

## Proposed D1 tables (for the `restructure` loader)

These follow the conventions of `DESIGN.md` §2.2: a natural key, `ord` where source order matters, `row_hash`, and residual JSON in `meta`. Citations go in the general `citations` table with new `subject_type` values, so a fact's sources are one indexed lookup like a contest's.

```sql
CREATE TABLE institutions (institution_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL,                      -- government|legislature|council|party|civil-service|public-body|head-of-state
  jurisdiction TEXT NOT NULL, party_id TEXT, body_slug TEXT, ord INTEGER, row_hash TEXT NOT NULL);

CREATE TABLE offices (office_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions, jurisdiction TEXT NOT NULL,
  kind TEXT NOT NULL, party_id TEXT,
  start TEXT, start_precision TEXT, end TEXT, end_precision TEXT,
  note TEXT, ord INTEGER, row_hash TEXT NOT NULL);
CREATE INDEX offices_party ON offices(party_id, office_id);

CREATE TABLE office_names (office_id TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL,
  valid_from TEXT, valid_until TEXT, note TEXT, PRIMARY KEY (office_id, ord));

CREATE TABLE tenures (tenure_id TEXT PRIMARY KEY, person_id TEXT NOT NULL, office_id TEXT NOT NULL REFERENCES offices,
  start TEXT, start_precision TEXT, end TEXT, end_precision TEXT,
  began TEXT,                              -- elected|appointed|co-opted|acting|by-succession
  ended TEXT,                              -- resigned|dismissed|died|term-ended|defeated|office-abolished
  predecessor_id TEXT, successor_id TEXT,
  contest_key TEXT,                        -- elections.key of the internal contest it began with
  note TEXT, matched_by TEXT, source_file TEXT, row_hash TEXT NOT NULL);
CREATE INDEX tenures_person ON tenures(person_id, start, tenure_id);
CREATE INDEX tenures_office ON tenures(office_id, start, tenure_id);

-- DESIGN.md already proposes party_events from party-lineage.json; this widens it so both
-- files load into it (lineage rows keep their text in `text`, facts-model rows have none).
CREATE TABLE party_events (event_id TEXT PRIMARY KEY, party_id TEXT NOT NULL, date TEXT NOT NULL,
  precision TEXT NOT NULL,                 -- year|month|day
  kind TEXT NOT NULL,                      -- founded|dissolved|renamed|merged-into|split-from|split|began-organising-in-ni|...
  text TEXT, basis TEXT, note TEXT, origin TEXT NOT NULL, -- 'party-events' | 'party-lineage'
  ord INTEGER, row_hash TEXT NOT NULL);
CREATE INDEX party_events_party ON party_events(party_id, date, event_id);
CREATE TABLE party_event_parties (event_id TEXT NOT NULL, party_id TEXT NOT NULL, relation TEXT NOT NULL,
  PRIMARY KEY (event_id, party_id, relation));
CREATE TABLE party_event_persons (event_id TEXT NOT NULL, person_id TEXT NOT NULL, role TEXT NOT NULL,
  PRIMARY KEY (event_id, person_id, role));

CREATE TABLE affiliations (affiliation_id TEXT PRIMARY KEY, person_id TEXT NOT NULL,
  party_id TEXT, label TEXT,               -- label only where the group has no registry party
  kind TEXT NOT NULL,                      -- party|independent|group|whip
  start TEXT, start_precision TEXT, start_event TEXT,
  end TEXT, end_precision TEXT, end_event TEXT,
  note TEXT, matched_by TEXT, row_hash TEXT NOT NULL);
CREATE INDEX affiliations_person ON affiliations(person_id, start, affiliation_id);
CREATE INDEX affiliations_party ON affiliations(party_id, start, affiliation_id);
```

**Citations.** Each fact's citations load into `citations` with `subject_type` `'office'`, `'tenure'`, `'party_event'` or `'affiliation'`, `subject_key` the fact's id and `ord` its position. The columns:

- `kind 'book'`, `page`, `title`, `publisher` (`url` NULL);
- `origin 'facts-model'`;
- `document` the extraction fact id (`fact`), for traceability.

**Persons.** Registered non-candidates are ordinary `persons` rows, `provisional 0`, with `meta` `{"keyedBy":"registered"}`. `person_cards` gets them from the same Browse build. `person_aliases` covers any later merge into a candidate record.

**Internal contests need no new tables.** They are `elections` rows with `body_slug` `uup-leadership` etc., and `contests` and `candidacies` rows as usual. Two columns on `elections` make them queryable:

```sql
ALTER TABLE elections ADD COLUMN body_type TEXT;   -- 'party-internal' (NULL for public elections)
ALTER TABLE elections ADD COLUMN party_id TEXT;    -- the party whose ballot it is
CREATE INDEX elections_party_internal ON elections(party_id, date, key) WHERE body_type = 'party-internal';
```

The manifest already carries `bodyType` and `partyId` on these elections. A party page's internal contests are then `SELECT … FROM elections WHERE body_type = 'party-internal' AND party_id = ?`. Its leaders are `SELECT … FROM tenures JOIN offices USING (office_id) WHERE offices.party_id = ? AND offices.kind = 'party-leader'`. An office page is `tenures WHERE office_id = ?`.

**Loader.** Each JSON file maps one-to-one onto its table. `id` becomes the key; nested `nameHistory`, `relatedParties`, `persons` and `citations` become the child tables above. The row hash is the canonical row, as elsewhere. Nothing is derived at load time except `ord`.

## The first load: Elliott & Flackes (1999)

`scripts/ingest/facts/import_elliott_flackes_facts.py` reads the staged extraction of *Northern Ireland: A Political Directory 1968–1999* (`facts.jsonl`, outside the repo). It writes the files above and lists everything it could not load, with the reason, in `unmapped.csv` (`D:\civgraph-intake\facts-model-2026-11-06\`).

- People are matched to existing ids only where the name **and** the dates **and** a party or the office's body agree. A name alone never decides.
- Where two records fit, the one with official identifiers is taken; otherwise the fact is listed as ambiguous.
- A dictionary entry's other offices follow the person matched for one of them.
- A person is registered as a non-candidate only when no record of the name exists in the era, or the office is a Whitehall or Northern Ireland Office post that candidates never held.
- `scripts/ingest/facts/link_noncandidates_wikidata.py` then adds a person's Wikidata item and UK Parliament id. It does so only where exactly one Wikidata human of that name held a fitting position.
- The gaps the first load left (council co-options, offices given without dates or with several in one statement, ambiguous people, honours, unresolved parties) were filled on 7 November 2026 by hand from researched facts, each cited to the book page and a second source (Wikipedia, the Oireachtas and UK Parliament records, the Gazette, ARK, CAIN, newspapers). The importer is a one-off: re-running it would discard those additions and the batch-5 merges.
- `scripts/ingest/facts/ef_offices.py` holds the office catalogue the import resolves the book's office strings against. Honours, memberships and posts in non-party bodies are not offices and are listed as unmapped.
