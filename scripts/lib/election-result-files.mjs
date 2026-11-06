// Which source file holds a contest's result, for the names the election index gives that the
// file name does not spell out. Used by scripts/build-test2-election-manifest.mjs findResultFile.
import { existsSync } from 'node:fs';
import path from 'node:path';

const SEAT_TYPE_SUFFIX = /\(\s*(aldermen|councillors)\s*\)\s*$/i;

/**
 * A borough that elected its aldermen and its councillors on separate lists (Lurgan 1949-67,
 * Portadown 1947-67) is indexed as "Portadown (councillors)" and "Portadown (aldermen)", and
 * each list is filed under its seat type: councillors.json and aldermen.json. The bracket is
 * the part that names the file, so it is matched before any fuzzy match on the area name, which
 * would drop it and find nothing (or the town's single-list file of another year).
 * Returns the file's path, or null when the name has no seat-type bracket or no such file.
 */
export function seatTypeResultFile(dateDir, constituency) {
  const match = SEAT_TYPE_SUFFIX.exec(String(constituency ?? ''));
  if (!match) return null;
  const file = path.join(dateDir, `${match[1].toLowerCase()}.json`);
  return existsSync(file) ? file : null;
}
