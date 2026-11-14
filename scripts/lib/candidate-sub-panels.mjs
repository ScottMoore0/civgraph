/**
 * The sub-panel each Seanad panel candidate stood on (data/elections/seanad-sub-panels.json):
 * candidates nominated by members of the Oireachtas, or by registered nominating bodies. Each
 * panel elects a minimum from each sub-panel, which is why a count can exclude a candidate with
 * more votes than one who stays in. The file names, per contest file, the document the sub-panels
 * come from and each candidate's sub-panel by name as the contest file gives it; the manifest
 * build writes it on the candidate's count rows (Sub_Panel), and the summaries carry it as
 * `subPanel`.
 */

/**
 * @typedef {{ source?: string, coverage?: string, note?: string, candidates?: Record<string, string> }} SubPanelContest
 * @typedef {{ contests?: Record<string, SubPanelContest> }} SubPanelDoc
 * @typedef {{ candidateName?: string, name?: string, Firstname?: string, Surname?: string, Sub_Panel?: string }} SubPanelRow
 */

/**
 * The contests of the file, keyed by contest file path (forward slashes), each with its
 * candidates' sub-panels keyed by name as `nameKey` folds it.
 * @param {SubPanelDoc | null | undefined} doc
 * @param {(name: string) => string} nameKey
 * @returns {Map<string, Map<string, string>>}
 */
export function subPanelIndex(doc, nameKey) {
  /** @type {Map<string, Map<string, string>>} */
  const out = new Map();
  for (const [file, contest] of Object.entries(doc?.contests || {})) {
    out.set(file.replace(/\\/g, '/'), new Map(Object.entries(contest.candidates || {}).map(([name, sub]) => [nameKey(name), sub])));
  }
  return out;
}

/**
 * Writes Sub_Panel on the count rows of the candidates the index names for this contest file.
 * Returns the result it was given (changed in place); a contest the index does not name is left
 * as it is.
 * @template {{ Constituency?: { countGroup?: SubPanelRow[] } } | null | undefined} R
 * @param {Map<string, Map<string, string>>} index
 * @param {string | null | undefined} relativeFile the contest file, relative to the repository root
 * @param {R} rawResult
 * @param {(name: string) => string} nameKey
 * @returns {R}
 */
export function applySubPanels(index, relativeFile, rawResult, nameKey) {
  if (!relativeFile || !rawResult) return rawResult;
  const byName = index.get(relativeFile.replace(/\\/g, '/'));
  if (!byName) return rawResult;
  for (const row of rawResult.Constituency?.countGroup || []) {
    const sub = byName.get(nameKey(row.candidateName || row.name || `${row.Firstname || ''} ${row.Surname || ''}`));
    if (sub) row.Sub_Panel = sub;
  }
  return rawResult;
}
