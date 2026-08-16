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

-- Tables: 6   Indexes: 8
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
