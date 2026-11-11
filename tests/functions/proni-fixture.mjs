// A generated PRONI catalogue in the live schema (scripts/records/proni/build-proni-d1.py and
// build-proni-ext-d1.py, with the ext_years_ref index), for the PRONI endpoint and page tests:
// 30 fonds of 29 records each, with few distinct texts so that many records tie on score.
import { DatabaseSync } from 'node:sqlite';

const WORDS = ['belfast', 'church', 'lease', 'map', 'letter', 'minutes', 'school', 'derry', 'ballymena', 'banbridge'];
const LEVELS = ['Fond', 'Series', 'File', 'Item', 'Item', 'Item'];
const ACCESS = ['Open', 'Closed', '', 'Open - On-Site Only'];

/** A catalogue of 900 records in the live schema (build-proni-d1.py, build-proni-ext-d1.py). */
export function catalogue() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE proni (ref TEXT NOT NULL, title TEXT, dates TEXT, slug TEXT, level TEXT, parent TEXT, parent_slug TEXT,
             has_children INTEGER, fond TEXT, description TEXT, access TEXT, digital_record TEXT, start_year INTEGER, end_year INTEGER);
           CREATE UNIQUE INDEX proni_ref ON proni(ref);
           CREATE INDEX proni_parent ON proni(parent, ref);
           CREATE VIRTUAL TABLE proni_fts USING fts5(ref, title, dates, description, content='proni', content_rowid='rowid', prefix='2 3', tokenize='unicode61 remove_diacritics 2');
           CREATE TABLE ext (ref TEXT PRIMARY KEY, ext_start_date TEXT, ext_end_date TEXT, ext_start_year INTEGER, ext_end_year INTEGER,
             ext_circa INTEGER, ext_estimated INTEGER, ext_bound TEXT, ext_undated INTEGER, ext_display TEXT);
           CREATE INDEX ext_years ON ext(ext_start_year, ext_end_year);
           CREATE INDEX ext_years_ref ON ext(ext_start_year, ext_end_year, ref);`);
  const add = db.prepare('INSERT INTO proni VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)');
  const addExt = db.prepare("INSERT INTO ext VALUES (?, '', '', ?, ?, 0, 0, '', ?, ?)");
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let f = 0; f < 30; f += 1) {
    const fond = `${'DTLB'[f % 4]}${100 + f}`;
    add.run(fond, `Papers of ${WORDS[f % WORDS.length]} estate`, '1700-1900', fond, 'Fond', '', '', 1, fond, `The ${WORDS[f % 10]} papers`, '', '');
    for (let i = 1; i <= 29; i += 1) {
      const ref = `${fond}/${i}${i % 9 === 0 ? 'A' : ''}`;
      // Few distinct texts, so many records share a score and the reference breaks the tie.
      const title = `${WORDS[rand(10)]} ${i % 3 ? WORDS[rand(10)] : 'deeds'} ${i % 5 ? '' : 'title deeds'}`.trim();
      const desc = i % 4 ? `${'A long description of the record. '.repeat(rand(12))}${WORDS[rand(10)]}` : '';
      add.run(ref, title, `${1700 + rand(250)}`, ref.replace(/\//g, '~'), LEVELS[rand(6)], fond, fond, 0, fond, desc, ACCESS[rand(4)], i % 7 ? '' : 'View');
      if (i % 6) {
        const start = 1700 + rand(250);
        addExt.run(ref, start, start + rand(40), 0, `${start}`);
      } else addExt.run(ref, null, null, 1, 'Undated');
    }
  }
  db.exec("INSERT INTO proni_fts(proni_fts) VALUES('rebuild')");
  return db;
}

