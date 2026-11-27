// A small QUB catalogue in the schema scripts/records/qub/build-qub-db.py writes (QUB_DB), for the
// Independent QUB Catalogue's endpoint tests: 60 records, half within Civgraph scope, with topic tags.
import { DatabaseSync } from 'node:sqlite';

const SUBJECTS = ['Elections--Ireland', 'Ireland--Politics and government', 'Poetry', 'Townlands--Ireland', 'Chemistry', 'Census--Ireland'];
const TAGS = ['C', 'BG', '', 'E', '', 'F'];

/** The catalogue, in memory. */
export function catalogue() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE qub (mms_id TEXT NOT NULL, title TEXT, author TEXT, imprint TEXT, year INTEGER, date_text TEXT, format TEXT,
             language TEXT, shelf TEXT, subjects TEXT, scope INTEGER NOT NULL, tags TEXT, scope_reason TEXT, scope_method TEXT, detail TEXT);
           CREATE TABLE qub_stats (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
           CREATE UNIQUE INDEX qub_mms ON qub(mms_id);
           CREATE INDEX qub_year ON qub(year, mms_id);
           CREATE VIRTUAL TABLE qub_fts USING fts5(title, author, subjects, notes, facets, content='',
             prefix='2 3', tokenize='unicode61 remove_diacritics 2');`);
  const add = db.prepare('INSERT INTO qub (rowid, mms_id, title, author, imprint, year, date_text, format, language, shelf, subjects, scope, tags, scope_reason, scope_method, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const addFts = db.prepare('INSERT INTO qub_fts (rowid, title, author, subjects, notes, facets) VALUES (?,?,?,?,?,?)');
  /** @type {Record<string, number>} */
  const stats = { all: 0, in: 0, out: 0 };
  for (let i = 0; i < 60; i += 1) {
    const k = i % 6;
    const tags = TAGS[k] ?? '';
    const scope = tags ? 1 : 0;
    const mms = `99${String(1000000 + i)}08046`;
    const detail = JSON.stringify({ resp: 'edited by A. Person', extent: '120 p.', series: ['Irish series'], notes: ['A note'],
      others: [{ name: 'Smith, John', role: 'editor' }], oclc: i % 2 ? ['(OCoLC)123'] : [], holdings: [{ library: 'McClay Library', location: 'Main', call: 'JN1400', availability: 'available' }],
      online: [{ label: 'Online copy', url: 'https://example.org/x' }], isbn: [] });
    const title = `${['Belfast elections', 'Home rule debates', 'Collected poems', 'Townlands of Down', 'Organic chemistry', 'Census of Ireland'][k]} ${i}`;
    const facets = `${scope ? 'scopein' : 'scopeout'} ${tags.split('').map((t) => `tag${t.toLowerCase()}`).join(' ')}`.trim();
    add.run(i + 1, mms, title, `Author ${i % 4}`, `Belfast : Press, ${1850 + i}`, 1850 + i, `${1850 + i}.`, 'Book', 'English', `SH ${i}`,
      SUBJECTS[k] ?? '', scope, tags, scope ? 'Irish subject; civic topic' : 'no Irish signal', 'rules', detail);
    addFts.run(i + 1, title, `Author ${i % 4}`, SUBJECTS[k] ?? '', 'Irish series', facets);
    stats.all += 1;
    stats[scope ? 'in' : 'out'] = (stats[scope ? 'in' : 'out'] ?? 0) + 1;
    for (const t of tags) stats[`tag:${t}`] = (stats[`tag:${t}`] ?? 0) + 1;
  }
  const st = db.prepare('INSERT INTO qub_stats VALUES (?, ?)');
  for (const [key, n] of Object.entries(stats)) st.run(key, n);
  return db;
}

/** An id the fixture holds. */
export const FIRST_ID = '99100000008046';
