const DEFAULT_PARTY_COLOURS = new Map([
  ['alliance', '#f6cb2f'],
  ['aontu', '#44532a'],
  ['conservative', '#0087dc'],
  ['dup', '#d46a4c'],
  ['fianna fail', '#66bb66'],
  ['fianna fail', '#66bb66'],
  ['fine gael', '#6699ff'],
  ['green', '#8dc63f'],
  ['independent', '#b8b8b8'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['pbp', '#e91d50'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8a'],
  ['solidarity pbp', '#e91d50'],
  ['solidarity-pbp', '#e91d50'],
  ['tuv', '#0c3a6a'],
  ['uup', '#48a5ee'],
  ['yes', '#2aa82c'],
  ['no', '#d46a4c']
]);

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[-_/.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function fixText(value) {
  return String(value ?? '')
    .replace(/\u00c3\u00a1/g, 'a')
    .replace(/\u00c3\u00a9/g, 'e')
    .replace(/\u00c3\u0089/g, 'E')
    .replace(/\u00e2\u20ac\u2122/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
}

export function numberOrZero(value) {
  const number = parseNumber(value);
  return number === null ? 0 : number;
}

export function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function normalizeParty(value) {
  const text = fixText(value || '').trim();
  if (!text) return '';
  return text
    .replace(/^Sinn Fein$/i, 'Sinn F\u00e9in')
    .replace(/^Fianna Fail$/i, 'Fianna F\u00e1il')
    .replace(/^Labour$/i, 'Irish Labour')
    .replace(/^People Before Profit(?: Alliance)?$/i, 'PBP');
}

export function partyColour(value, fallback = '#6b7280') {
  return DEFAULT_PARTY_COLOURS.get(normalizeName(value)) || fallback;
}

export function statusKind(status) {
  const normalized = normalizeName(status);
  if (!normalized) return '';
  if (/elected|made quota|counted as elected|deemed elected/.test(normalized)) return 'elected';
  if (/excluded|eliminated/.test(normalized)) return 'excluded';
  return normalized;
}

export function candidateDisplayName(row = {}, fallback = '') {
  return fixText(row.candidateName || row.name || [row.Firstname, row.Surname].filter(Boolean).join(' ') || fallback);
}

export function summarizeForumRows(rows = []) {
  return rows.map((row, index) => {
    const party = normalizeParty(row.party);
    return {
      id: row.party_id || row.id || `${party || 'list'}-${index + 1}`,
      name: row.party ? `${fixText(row.party)} list` : `List ${index + 1}`,
      party,
      firstPrefs: parseNumber(row.votes),
      finalVotes: parseNumber(row.votes),
      voteShare: parseNumber(row.vote_share),
      elected: Number(row.allocated_seats || 0) > 0,
      seats: parseNumber(row.allocated_seats),
      status: Number(row.allocated_seats || 0) > 0 ? 'Elected' : '',
      colour: partyColour(party)
    };
  });
}

export function summarizeCandidateRows(rows = []) {
  const byCandidate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = candidateDisplayName(row);
    const party = normalizeParty(row.Party_Name || row.party || row.party_name);
    const key = row.Candidate_Id || row.person_id || `${name}|${party}`;
    if (!String(key || '').trim() || normalizeName(key) === 'nontransferable') continue;
    const existing = byCandidate.get(key) || {
      id: String(key),
      name,
      party,
      firstPrefs: null,
      finalVotes: null,
      elected: false,
      electedAt: null,
      excluded: false,
      excludedAt: null,
      status: '',
      colour: row.Party_Colour || partyColour(party),
      counts: []
    };
    const countNo = parseNumber(row.Count_Number) || 1;
    const firstPref = parseNumber(row.Candidate_First_Pref_Votes ?? row.first_pref ?? row.firstPreferenceVotes ?? row.votes);
    const totalVotes = parseNumber(row.Total_Votes ?? row.final_votes ?? row.finalVote);
    const transfers = parseNumber(row.Transfers ?? row.transfer ?? row.transfers);
    const status = fixText(row.Status || row.status || row.outcome || '');
    if ((countNo === 1 || existing.firstPrefs === null) && firstPref !== null) existing.firstPrefs = firstPref;
    if (totalVotes !== null) existing.finalVotes = Math.max(existing.finalVotes || 0, totalVotes);
    if (!existing.status && status) existing.status = status;
    if (statusKind(status) === 'elected' || row.counted_as_elected === true) {
      existing.elected = true;
      existing.electedAt ||= countNo;
    }
    if (statusKind(status) === 'excluded') {
      existing.excluded = true;
      existing.excludedAt ||= countNo;
    }
    existing.counts.push({
      count: countNo,
      total: totalVotes,
      transfers,
      status,
      firstPrefs: firstPref
    });
    byCandidate.set(key, existing);
  }
  return [...byCandidate.values()].sort((a, b) => numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs));
}

export function extractElected(result = {}) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const explicit = candidates.filter((candidate) => candidate.elected);
  if (explicit.length) {
    return explicit
      .map((candidate) => ({ ...candidate, colour: candidate.colour || partyColour(candidate.party) }))
      .sort((a, b) => numberOrZero(a.electedAt) - numberOrZero(b.electedAt) || numberOrZero(b.finalVotes) - numberOrZero(a.finalVotes));
  }
  const seats = parseNumber(result.seatsTotal ?? result.seatsWon);
  if (seats && seats > 0) {
    return [...candidates]
      .filter((candidate) => !candidate.excluded)
      .sort((a, b) => numberOrZero(b.finalVotes ?? b.firstPrefs) - numberOrZero(a.finalVotes ?? a.firstPrefs))
      .slice(0, seats)
      .map((candidate) => ({ ...candidate, elected: true, status: candidate.status || 'Deemed elected', colour: candidate.colour || partyColour(candidate.party) }));
  }
  return [];
}

export function summarizeResult(raw, fallbackConstituency) {
  const source = raw?.Constituency || raw || {};
  const info = source.countInfo || raw?.meta || raw?.metaData || {};
  const forumRows = Array.isArray(source.forum?.rows) ? source.forum.rows : null;
  const rows = forumRows || source.countGroup || raw?.candidates || [];
  const constituency = fixText(source.constituency || raw?.constituency || info.Constituency_Name || fallbackConstituency);
  const recallPetition = source.recallPetition || raw?.recallPetition || raw?.petition || null;
  const candidates = forumRows ? summarizeForumRows(forumRows) : summarizeCandidateRows(rows);
  const ranked = [...candidates].sort((a, b) => numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs));
  const seatsTotal = parseNumber(info.Number_Of_Seats ?? raw?.meta?.seats ?? raw?.seats);
  let elected = extractElected({ candidates, seatsTotal });
  const leading = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const validPoll = parseNumber(info.Valid_Poll ?? raw?.meta?.valid_poll ?? raw?.meta?.validPoll);
  const totalPoll = parseNumber(info.Total_Poll ?? raw?.meta?.total_poll ?? raw?.meta?.totalPoll);
  const electorate = parseNumber(info.Total_Electorate ?? raw?.meta?.electorate ?? raw?.electorate);
  const totalVotes = validPoll || candidates.reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs), 0);
  const turnoutPct = parseNumber(raw?.turnout_pct ?? raw?.meta?.turnout_pct ?? raw?.meta?.turnoutPct)
    || (electorate && totalPoll ? round((totalPoll / electorate) * 100, 2) : null);
  const majority = leading && runnerUp ? numberOrZero(leading.firstPrefs) - numberOrZero(runnerUp.firstPrefs) : null;
  const majorityPct = majority !== null && totalVotes ? round((majority / totalVotes) * 100, 2) : null;
  const electedByParty = countBy(elected, (candidate) => candidate.party || 'Independent');
  const topElectedParty = topCount(electedByParty);
  const winnerParty = topElectedParty?.key || leading?.party || null;
  const winnerName = elected.length === 1 ? elected[0].name : elected.length ? `${elected.length} elected` : leading?.name || null;
  const leadingPct = leading && totalVotes ? round((numberOrZero(leading.firstPrefs) / totalVotes) * 100, 2) : null;
  const quota = parseNumber(info.Quota ?? raw?.meta?.quota ?? raw?.quota);
  const countNumbers = unique(candidates.flatMap((candidate) => (candidate.counts || []).map((count) => count.count))).sort((a, b) => a - b);

  return {
    constituency,
    winnerParty,
    winnerName,
    leadingParty: leading?.party || null,
    leadingName: leading?.name || null,
    leadingVotes: leading?.firstPrefs ?? null,
    leadingPct,
    turnoutPct,
    majority,
    majorityPct,
    seatsWon: elected.length || topElectedParty?.count || null,
    seatsTotal: seatsTotal || null,
    quota: quota || null,
    electorate: electorate || null,
    totalPoll: totalPoll || null,
    validPoll: validPoll || totalVotes || null,
    totalVotes: totalVotes || null,
    colour: partyColour(winnerParty || leading?.party),
    leadingColour: partyColour(leading?.party),
    candidates,
    elected,
    countInfo: info,
    countGroup: Array.isArray(source.countGroup) ? source.countGroup : [],
    forum: source.forum || null,
    countNumbers,
    ...(recallPetition ? { recallPetition } : {}),
    hasCountDetail: countNumbers.length > 1 || candidates.some((candidate) => (candidate.counts || []).length > 1),
    animationPayload: raw || null
  };
}

export function buildPartySummary(results = []) {
  const rows = new Map();
  let totalVotes = 0;
  for (const result of results) {
    for (const candidate of extractElected(result)) {
      const party = candidate.party || result.winnerParty || result.leadingParty || 'Independent/Other';
      const key = normalizeName(party) || party;
      if (!rows.has(key)) rows.set(key, { party, seats: 0, stood: 0, votes: 0, colour: partyColour(party) });
      rows.get(key).seats += 1;
    }
    for (const candidate of result.candidates || []) {
      const votes = numberOrZero(candidate.firstPrefs ?? candidate.votes);
      const party = candidate.party || 'Independent/Other';
      const key = normalizeName(party) || party;
      if (!rows.has(key)) rows.set(key, { party, seats: 0, stood: 0, votes: 0, colour: partyColour(party) });
      rows.get(key).stood += 1;
      rows.get(key).votes += votes;
      totalVotes += votes;
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, share: totalVotes ? row.votes / totalVotes * 100 : null }))
    .sort((a, b) => b.seats - a.seats || b.votes - a.votes || a.party.localeCompare(b.party));
}

export function buildCandidateSummary(results = []) {
  const rows = [];
  for (const result of results) {
    for (const candidate of result.candidates || []) {
      rows.push({
        ...candidate,
        constituency: result.constituency,
        firstPrefPct: result.validPoll ? numberOrZero(candidate.firstPrefs) / result.validPoll * 100 : null
      });
    }
  }
  return rows.sort((a, b) => Number(Boolean(b.elected)) - Number(Boolean(a.elected)) || numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs));
}

export function buildEntityIndex(results = []) {
  const parties = new Map();
  const candidates = new Map();
  let totalValid = 0;
  for (const result of results) {
    totalValid += numberOrZero(result.validPoll);
    for (const candidate of result.candidates || []) {
      const personId = candidate.id || `${candidate.name}|${candidate.party}`;
      if (!candidates.has(personId)) {
        candidates.set(personId, {
          personId,
          name: candidate.name,
          party: candidate.party,
          colour: candidate.colour || partyColour(candidate.party),
          firstPrefs: 0,
          finalVotes: 0,
          electedCount: 0,
          constituencies: new Set(),
          appearances: []
        });
      }
      const candidateEntry = candidates.get(personId);
      candidateEntry.firstPrefs += numberOrZero(candidate.firstPrefs);
      candidateEntry.finalVotes += numberOrZero(candidate.finalVotes);
      if (candidate.elected) candidateEntry.electedCount += 1;
      candidateEntry.constituencies.add(result.constituency);
      candidateEntry.appearances.push({
        constituency: result.constituency,
        firstPref: numberOrZero(candidate.firstPrefs),
        finalVotes: numberOrZero(candidate.finalVotes),
        status: candidate.elected ? 'Elected' : candidate.status || ''
      });

      const party = candidate.party || 'Independent/Other';
      const partyKey = normalizeName(party);
      if (!parties.has(partyKey)) {
        parties.set(partyKey, {
          name: party,
          colour: candidate.colour || partyColour(party),
          firstPrefs: 0,
          finalVotes: 0,
          stood: 0,
          elected: 0,
          constituencies: new Set(),
          candidates: []
        });
      }
      const partyEntry = parties.get(partyKey);
      partyEntry.firstPrefs += numberOrZero(candidate.firstPrefs);
      partyEntry.finalVotes += numberOrZero(candidate.finalVotes);
      partyEntry.stood += 1;
      if (candidate.elected) partyEntry.elected += 1;
      partyEntry.constituencies.add(result.constituency);
      partyEntry.candidates.push({
        personId,
        name: candidate.name,
        constituency: result.constituency,
        firstPref: numberOrZero(candidate.firstPrefs),
        finalVotes: numberOrZero(candidate.finalVotes),
        status: candidate.elected ? 'Elected' : candidate.status || ''
      });
    }
  }
  const finalize = (entry) => ({
    ...entry,
    constituencies: [...entry.constituencies].sort((a, b) => String(a).localeCompare(String(b))),
    shareOfTotal: totalValid ? entry.firstPrefs / totalValid * 100 : null
  });
  return {
    totalValid,
    parties: [...parties.values()].map(finalize).sort((a, b) => b.elected - a.elected || b.firstPrefs - a.firstPrefs),
    candidates: [...candidates.values()].map(finalize).sort((a, b) => b.electedCount - a.electedCount || b.firstPrefs - a.firstPrefs)
  };
}

export function compareResults(currentResults = [], previousResults = []) {
  const previousByName = new Map(previousResults.map((result) => [normalizeName(result.constituency), result]));
  return currentResults.map((result) => {
    const previous = previousByName.get(normalizeName(result.constituency));
    return {
      ...result,
      previous: previous ? {
        leadingParty: previous.leadingParty,
        winnerParty: previous.winnerParty,
        leadingVotes: previous.leadingVotes,
        validPoll: previous.validPoll,
        seatsWon: previous.seatsWon
      } : null,
      deltas: previous ? {
        leadingVotes: numberOrZero(result.leadingVotes) - numberOrZero(previous.leadingVotes),
        leadingPct: result.leadingPct !== null && previous.leadingPct !== null ? round(result.leadingPct - previous.leadingPct, 2) : null,
        turnoutPct: result.turnoutPct !== null && previous.turnoutPct !== null ? round(result.turnoutPct - previous.turnoutPct, 2) : null
      } : null
    };
  });
}

export function seatPositions(total, spacing = 13) {
  if (total <= 0) return [];
  if (total === 1) return [{ x: 0, y: 0 }];
  const rows = [];
  let remaining = total;
  while (remaining > 0) {
    const take = remaining >= 5 ? (rows.length % 2 === 0 ? 3 : 2) : Math.min(remaining, remaining <= 3 ? remaining : 2);
    rows.push(take);
    remaining -= take;
  }
  const rowHeight = spacing * 0.9;
  const totalHeight = (rows.length - 1) * rowHeight;
  const positions = [];
  rows.forEach((count, rowIndex) => {
    const width = (count - 1) * spacing;
    for (let i = 0; i < count; i += 1) {
      positions.push({
        x: i * spacing - width / 2,
        y: rowIndex * rowHeight - totalHeight / 2
      });
    }
  });
  return positions;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function topCount(counts) {
  let best = null;
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count };
  }
  return best;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}
