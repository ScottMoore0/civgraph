-- Schema of the civgraph-elections D1 database.
--
-- WHY THIS FILE EXISTS
--
-- Until 2026-08-16 the shape of this database existed nowhere in the
-- repository. docs/cloudflare-inventory.md recorded it as *inferred from the
-- queries in functions/_api/elections/index.js*. It holds 40.3 MB of election
-- data, and if it were lost or corrupted its structure would have had to be
-- reverse-engineered from four SQL queries before anything could be restored.
-- Top-scored item in docs/review/TECH-DEBT-AUDIT.md.
--
-- GENERATED, NOT HAND-WRITTEN. Regenerate with:
--   npm run build:elections-schema
-- and check it against the live database with:
--   npm run check:elections-schema
--
-- Cloudflare-internal objects (_cf_*) and SQLite internals are excluded: they
-- are not ours, and they change without us.

-- Tables: 12   Indexes: 33
CREATE TABLE browse_persons (
  slug       TEXT PRIMARY KEY,
  id         TEXT,
  title      TEXT,
  -- Lower-cased title. SQLite's LIKE folds case for ASCII only, and these carry fadas.
  title_norm TEXT,
  -- The key the CLIENT looks up by. NOT always the slug; see entityKey().
  key_norm   TEXT,
  -- Every field browse.js's substring filter looks at, flattened and lower-cased.
  -- Searching only the title would quietly return fewer results than the client did.
  search_norm TEXT,
  first_year TEXT,
  last_year  TEXT,
  ord        INTEGER NOT NULL,
  record     TEXT NOT NULL
);

CREATE TABLE browse_register_interests (
  slug       TEXT PRIMARY KEY,
  id         TEXT,
  title      TEXT,
  -- Lower-cased title. SQLite's LIKE folds case for ASCII only, and these carry fadas.
  title_norm TEXT,
  -- The key the CLIENT looks up by. NOT always the slug; see entityKey().
  key_norm   TEXT,
  -- Every field browse.js's substring filter looks at, flattened and lower-cased.
  -- Searching only the title would quietly return fewer results than the client did.
  search_norm TEXT,
  member_name TEXT,
  elected_body TEXT,
  category   TEXT,
  date       TEXT,
  constituency TEXT,
  member_type TEXT,
  chamber    TEXT,
  interest_count TEXT,
  source_count TEXT,
  nil_status TEXT,
  ord        INTEGER NOT NULL,
  record     TEXT NOT NULL
);

CREATE TABLE browse_register_interests_facets (facets TEXT NOT NULL);

CREATE TABLE browse_sources (
  slug       TEXT PRIMARY KEY,
  id         TEXT,
  title      TEXT,
  -- Lower-cased title. SQLite's LIKE folds case for ASCII only, and these carry fadas.
  title_norm TEXT,
  -- The key the CLIENT looks up by. NOT always the slug; see entityKey().
  key_norm   TEXT,
  -- Every field browse.js's substring filter looks at, flattened and lower-cased.
  -- Searching only the title would quietly return fewer results than the client did.
  search_norm TEXT,
  provider   TEXT,
  category   TEXT,
  publication_status TEXT,
  date       TEXT,
  ord        INTEGER NOT NULL,
  record     TEXT NOT NULL
);

CREATE TABLE browse_sources_facets (facets TEXT NOT NULL);

CREATE TABLE candidates (
  election_key     TEXT NOT NULL,
  constituency_seq INTEGER NOT NULL,
  candidate_id     TEXT,
  name             TEXT,
  party            TEXT,
  party_id         TEXT,
  person_id        TEXT,
  first_prefs      INTEGER,
  final_votes      REAL,
  elected          INTEGER,
  elected_at       INTEGER,
  excluded         INTEGER,
  excluded_at      INTEGER,
  status           TEXT,
  colour           TEXT,
  gender           TEXT,
  meta             TEXT
);

CREATE TABLE constituencies (
  election_key  TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  name          TEXT,
  winner_party  TEXT,
  winner_name   TEXT,
  leading_party TEXT,
  leading_name  TEXT,
  leading_votes INTEGER,
  leading_pct   REAL,
  turnout_pct   REAL,
  majority      INTEGER,
  majority_pct  REAL,
  seats_won     INTEGER,
  seats_total   INTEGER,
  quota         INTEGER,
  electorate    INTEGER,
  source_file   TEXT,
  meta          TEXT,
  PRIMARY KEY (election_key, seq)
);

CREATE TABLE constituency_animation (
  election_key     TEXT NOT NULL,
  constituency_seq INTEGER NOT NULL,
  payload          TEXT,
  PRIMARY KEY (election_key, constituency_seq)
);

CREATE TABLE constituency_features (
  election_key     TEXT NOT NULL,
  constituency_seq INTEGER NOT NULL,
  layer_id         TEXT,
  feature_id       TEXT,
  feature_name     TEXT,
  match_name       TEXT,
  matched          INTEGER,
  PRIMARY KEY (election_key, constituency_seq)
);

CREATE TABLE counts (
  election_key     TEXT NOT NULL,
  constituency_seq INTEGER NOT NULL,
  candidate_id     TEXT,
  count_number     INTEGER,
  total_votes      REAL,
  transfers        REAL,
  status           TEXT,
  row_id           INTEGER   -- countGroup row ordinal; preserved rather than re-derived
);

CREATE TABLE dataset (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE elections (
  key                     TEXT PRIMARY KEY,
  body                    TEXT,
  body_slug               TEXT,
  body_group              TEXT,
  display_title           TEXT,
  contest_type            TEXT,
  kind                    TEXT,
  voting_system           TEXT,
  contest_status          TEXT,
  date                    TEXT,
  year                    INTEGER,
  source_map_id           TEXT,
  layer_id                TEXT,
  label_property          TEXT,
  candidate_rows_expected INTEGER,
  transfer_data_expected  INTEGER,
  meta                    TEXT
);

CREATE INDEX cand_election_cons  ON candidates(election_key, constituency_seq);

CREATE INDEX cand_party          ON candidates(party);

CREATE INDEX cand_person         ON candidates(person_id);

CREATE INDEX confeat_layer       ON constituency_features(layer_id, feature_id);

CREATE INDEX cons_election       ON constituencies(election_key);

CREATE INDEX counts_key          ON counts(election_key, constituency_seq, candidate_id);

CREATE INDEX elections_body_date ON elections(body_slug, date);

CREATE INDEX elections_year      ON elections(year);

CREATE INDEX idx_browse_persons_first_year ON browse_persons(first_year);

CREATE INDEX idx_browse_persons_id ON browse_persons(id);

CREATE INDEX idx_browse_persons_key_norm ON browse_persons(key_norm);

CREATE INDEX idx_browse_persons_last_year ON browse_persons(last_year);

CREATE INDEX idx_browse_persons_title_norm ON browse_persons(title_norm);

CREATE INDEX idx_browse_register_interests_category ON browse_register_interests(category);

CREATE INDEX idx_browse_register_interests_chamber ON browse_register_interests(chamber);

CREATE INDEX idx_browse_register_interests_constituency ON browse_register_interests(constituency);

CREATE INDEX idx_browse_register_interests_date ON browse_register_interests(date);

CREATE INDEX idx_browse_register_interests_elected_body ON browse_register_interests(elected_body);

CREATE INDEX idx_browse_register_interests_id ON browse_register_interests(id);

CREATE INDEX idx_browse_register_interests_interest_count ON browse_register_interests(interest_count);

CREATE INDEX idx_browse_register_interests_key_norm ON browse_register_interests(key_norm);

CREATE INDEX idx_browse_register_interests_member_name ON browse_register_interests(member_name);

CREATE INDEX idx_browse_register_interests_member_type ON browse_register_interests(member_type);

CREATE INDEX idx_browse_register_interests_nil_status ON browse_register_interests(nil_status);

CREATE INDEX idx_browse_register_interests_source_count ON browse_register_interests(source_count);

CREATE INDEX idx_browse_register_interests_title_norm ON browse_register_interests(title_norm);

CREATE INDEX idx_browse_sources_category ON browse_sources(category);

CREATE INDEX idx_browse_sources_date ON browse_sources(date);

CREATE INDEX idx_browse_sources_id ON browse_sources(id);

CREATE INDEX idx_browse_sources_key_norm ON browse_sources(key_norm);

CREATE INDEX idx_browse_sources_provider ON browse_sources(provider);

CREATE INDEX idx_browse_sources_publication_status ON browse_sources(publication_status);

CREATE INDEX idx_browse_sources_title_norm ON browse_sources(title_norm);
