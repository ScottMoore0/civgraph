/**
 * Placeholder votes on unopposed returns (arith-audit follow-up, owner-approved 11 Nov 2026).
 *
 * An unopposed contest polled nothing, but some imports carry a placeholder vote of 1 per
 * winner (the ElectionsIreland returns of 1918-38, the presidential records, a few local
 * areas), summed into a "valid poll" of 1 or the number of seats. `scrubUnopposedPlaceholderVotes`
 * removes them from a built result, so the contest has no votes, no valid poll and no lead or
 * majority, as the returns imported without placeholders already show it. The electorate stays.
 * A valid poll larger than the placeholders is the record's own and is kept, and a contest in
 * which any candidate has more than one vote is left alone.
 */

/** @param {unknown} value */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} value */
function isPlaceholderVote(value) {
  const n = num(value);
  return n !== null && n <= 1;
}

/**
 * @param {Record<string, any>} result  a built contest result (candidates, elected, validPoll,
 *   countInfo, animationPayload.Constituency); changed in place
 * @returns {boolean} whether anything was scrubbed (false when a candidate has real votes)
 */
export function scrubUnopposedPlaceholderVotes(result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  if (candidates.some((candidate) => (num(candidate?.firstPrefs) ?? 0) > 1 || (num(candidate?.finalVotes) ?? 0) > 1)) return false;
  /** @param {unknown} value */
  const placeholderPoll = (value) => {
    const n = num(value);
    return n !== null && n <= Math.max(candidates.length, 1);
  };
  /** @param {any} candidate */
  const clearVotes = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return candidate;
    const next = { ...candidate, firstPrefs: null, finalVotes: null };
    if (Array.isArray(candidate.counts)) next.counts = candidate.counts.map((/** @type {any} */ count) => ({ ...count, total: null, firstPrefs: null }));
    return next;
  };
  result.candidates = candidates.map(clearVotes);
  if (Array.isArray(result.elected)) result.elected = result.elected.map(clearVotes);
  for (const field of ['validPoll', 'totalVotes', 'totalPoll']) {
    if (placeholderPoll(result[field])) result[field] = null;
  }
  // With no poll there is no lead, share or majority either.
  for (const field of ['leadingVotes', 'leadingPct', 'majority', 'majorityPct']) {
    if (result[field] !== undefined) result[field] = null;
  }
  if (result.countInfo && placeholderPoll(result.countInfo.Valid_Poll)) result.countInfo = { ...result.countInfo, Valid_Poll: '' };
  // The count sheet's rows carry the same placeholders ('' is how a return without them reads).
  const sheet = result.animationPayload?.Constituency;
  if (sheet && typeof sheet === 'object') {
    const countInfo = sheet.countInfo && placeholderPoll(sheet.countInfo.Valid_Poll) ? { ...sheet.countInfo, Valid_Poll: '' } : sheet.countInfo;
    const countGroup = Array.isArray(sheet.countGroup)
      ? sheet.countGroup.map((/** @type {any} */ row) => (isPlaceholderVote(row?.Total_Votes)
        && (isPlaceholderVote(row?.Candidate_First_Pref_Votes) || !String(row?.Candidate_First_Pref_Votes ?? '').trim())
        ? { ...row, Total_Votes: '', Candidate_First_Pref_Votes: '', Transfers: '' }
        : row))
      : sheet.countGroup;
    result.animationPayload = { ...result.animationPayload, Constituency: { ...sheet, countInfo, countGroup } };
  }
  return true;
}
