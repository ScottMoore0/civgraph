/** Named queries: the documents table, whole JSON documents by name (storage slice ST-6). */

export const DOCUMENTS = Object.freeze({
  /** [name] -> { body } */
  body: 'SELECT body FROM documents WHERE name = ?1',
});
