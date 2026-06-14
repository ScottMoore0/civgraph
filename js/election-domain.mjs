const DEFAULT_PARTY_COLOURS = new Map([
  ['alliance', '#f6cb2f'],
  ['aontu', '#44532a'],
  ['conservative', '#0087dc'],
  ['dup', '#d46a4c'],
  ['fianna fail', '#66bb66'],
  ['fine gael', '#6699ff'],
  ['green', '#22ac6f'],
  ['green party', '#22ac6f'],
  ['independent', '#b8b8b8'],
  ['independent ireland', '#3bee56'],
  ['irish labour', '#cc0000'],
  ['labour', '#cc0000'],
  ['pbp', '#ff0090'],
  ['sdlp', '#2aa82c'],
  ['sinn fein', '#326760'],
  ['social democrats', '#752f8b'],
  ['solidarity pbp', '#8e2420'],
  ['solidarity-pbp', '#8e2420'],
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
  if (/not elected|unelected|not deemed elected/.test(normalized)) return 'not-elected';
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
    const party = normalizeParty(row.Party_Name || row.Party || row.party || row.party_name);
    const key = row.Candidate_Id || row.person_id || `${name}|${party}`;
    if (!String(key || '').trim() || isNonTransferableRow(row, key, name, party)) continue;
    const existing = byCandidate.get(key) || {
      id: String(key),
      name,
      party,
      firstPrefs: null,
      finalVotes: null,
      elected: false,
      electedAt: null,
      autoReturnedCeannComhairle: String(row.Auto_Returned_Ceann_Comhairle || '') === '1',
      excluded: false,
      excludedAt: null,
      status: '',
      colour: row.Party_Colour || partyColour(party),
      gender: fixText(row.Gender || row.gender || ''),
      dailAbbreviation: fixText(row.Dail_Abbreviation || row.Party_Abbreviation || row.dailAbbreviation || row.partyAbbreviation || ''),
      officialCandidateId: fixText(row.Official_Candidate_Id || row.officialCandidateId || ''),
      officialStatus: fixText(row.Official_Status || row.officialStatus || ''),
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
    if (!existing.gender && (row.Gender || row.gender)) existing.gender = fixText(row.Gender || row.gender || '');
    if (!existing.dailAbbreviation && (row.Dail_Abbreviation || row.Party_Abbreviation || row.dailAbbreviation || row.partyAbbreviation)) {
      existing.dailAbbreviation = fixText(row.Dail_Abbreviation || row.Party_Abbreviation || row.dailAbbreviation || row.partyAbbreviation || '');
    }
    if (!existing.officialCandidateId && (row.Official_Candidate_Id || row.officialCandidateId)) {
      existing.officialCandidateId = fixText(row.Official_Candidate_Id || row.officialCandidateId || '');
    }
    if (!existing.officialStatus && (row.Official_Status || row.officialStatus)) {
      existing.officialStatus = fixText(row.Official_Status || row.officialStatus || '');
    }
    if (statusKind(status) === 'elected' || row.Elected === true || row.counted_as_elected === true) {
      existing.elected = true;
      existing.electedAt ||= countNo;
      if (!existing.status) existing.status = 'Elected';
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

export function normalizeScraperPayloadForMain(payload, fallbackConstituency = '') {
  if (!payload || payload.Constituency || !Array.isArray(payload.candidates)) return payload;
  const meta = payload.meta || {};
  const encodedCounts = payload.candidates
    .map((candidate) => scraperCandidateEventCount(candidate))
    .filter((count) => count !== null);
  const lastCount = Math.max(1, ...encodedCounts);
  const hasSyntheticCountStages = lastCount > 1;
  const countGroup = payload.candidates.flatMap((candidate, index) => {
    const autoReturned = scraperCandidateIsAutoReturned(candidate);
    const firstPref = scraperCandidateFirstPref(candidate);
    const occurredOn = scraperCandidateEventCount(candidate) || 1;
    const elected = scraperCandidateIsElected(candidate);
    const name = fixText(candidate.name || '').trim();
    const space = name.indexOf(' ');
    const firstname = space > 0 ? name.slice(0, space) : name;
    const surname = space > 0 ? name.slice(space + 1) : '';
    const party = scraperCandidateParty(candidate);
    const status = autoReturned
      ? (candidate.status || 'Elected (auto returned)')
      : (candidate.status || (elected ? 'Elected' : ''));
    const rowCountNumbers = hasSyntheticCountStages
      ? Array.from({ length: lastCount }, (_, countIndex) => countIndex + 1)
      : [1];
    return rowCountNumbers.map((countNumber) => ({
      Auto_Returned_Ceann_Comhairle: autoReturned ? '1' : '',
      Candidate_Id: String(index + 1),
      Candidate_First_Pref_Votes: String(firstPref),
      Constituency_Number: String(payload.constituencyNumber || payload.officialDail?.constituencyNumber || meta.Constituency_Number || ''),
      Count_Number: String(countNumber),
      Dail_Abbreviation: candidate.dailAbbreviation || candidate.partyAbbreviation || '',
      Firstname: firstname,
      Gender: candidate.gender || '',
      Official_Candidate_Id: candidate.officialCandidateId || '',
      Official_Status: candidate.officialStatus || '',
      Party_Abbreviation: candidate.partyAbbreviation || candidate.dailAbbreviation || '',
      Surname: surname,
      Occurred_On_Count: String(occurredOn),
      Party_Colour: partyColour(party),
      Party_Name: party,
      Status: countNumber === occurredOn ? status : '',
      Synthetic_Scraper_Row: '1',
      Synthetic_Scraper_Stage_Row: hasSyntheticCountStages ? '1' : '',
      Total_Votes: String(firstPref),
      Transfers: '0',
      candidateName: name,
      id: index
    }));
  });
  const validPoll = parseNumber(meta.Valid_Poll ?? meta.valid_poll ?? meta.validPoll)
    || countGroup
      .filter((row) => Number(row.Count_Number) === 1)
      .reduce((sum, row) => sum + numberOrZero(row.Candidate_First_Pref_Votes), 0);
  const electorate = parseNumber(meta.Total_Electorate ?? meta.electorate ?? meta.electorate_total);
  const turnoutPct = parseNumber(meta.turnout_pct ?? meta.turnoutPct);
  const explicitTotalPoll = parseNumber(meta.Total_Poll ?? meta.total_poll ?? meta.totalPoll);
  const totalPoll = explicitTotalPoll ?? (electorate !== null && turnoutPct !== null
    ? Math.round(electorate * turnoutPct / 100)
    : null);
  const explicitSpoiled = parseNumber(meta.Spoiled ?? meta.spoiled);
  const spoiled = explicitSpoiled ?? (totalPoll !== null && validPoll
    ? Math.max(0, totalPoll - validPoll)
    : null);
  const seatCount = parseNumber(payload.seats)
    || countGroup.filter((row) => statusKind(row.Status) === 'elected').length;
  return {
    Constituency: {
      __syntheticCountGroup: true,
      __syntheticCountStages: hasSyntheticCountStages,
      countInfo: {
        Constituency_Name: payload.constituency || fallbackConstituency || '',
        Constituency_Number: String(payload.constituencyNumber || payload.officialDail?.constituencyNumber || meta.Constituency_Number || ''),
        Number_Of_Seats: seatCount ? String(seatCount) : '',
        Quota: meta.Quota != null || meta.quota != null ? String(meta.Quota ?? meta.quota) : '',
        Spoiled: spoiled != null ? String(spoiled) : '',
        Total_Electorate: electorate != null ? String(electorate) : '',
        Total_Poll: totalPoll != null ? String(totalPoll) : '',
        Valid_Poll: validPoll ? String(validPoll) : ''
      },
      countGroup
    },
    officialDail: payload.officialDail || null,
    constituencyId: payload.constituencyId || payload.officialDail?.constituencyId || null,
    constituencyNumber: payload.constituencyNumber || payload.officialDail?.constituencyNumber || null
  };
}

function isScraperCandidatePayload(payload = {}) {
  return Boolean(payload && !payload.Constituency && Array.isArray(payload.candidates));
}

const CEANN_COMHAIRLE_AFFILIATION_BY_NAME = new Map([
  ['michael hayes', 'Cumann na nGaedheal'],
  ['frank fahy', 'Fianna F\u00e1il'],
  ['cormac breslin', 'Fianna F\u00e1il'],
  ['seamus pattison', 'Irish Labour'],
  ['seamus kirk', 'Fianna F\u00e1il'],
  ['sean barrett', 'Fine Gael'],
  ['sean o fearghail', 'Fianna F\u00e1il'],
  ["rory o'hanlon", 'Fianna F\u00e1il'],
  ['rory ohanlon', 'Fianna F\u00e1il']
]);

function isCeannComhairleParty(value) {
  return normalizeName(value).includes('ceann comhairle');
}

function scraperCandidateIsAutoReturned(candidate = {}) {
  return isCeannComhairleParty(candidate.party);
}

function scraperCandidateAffiliatedParty(candidate = {}) {
  const candidateName = normalizeName(fixText(candidate.name || ''));
  return CEANN_COMHAIRLE_AFFILIATION_BY_NAME.get(candidateName) || 'Ceann Comhairle (Speaker)';
}

function positiveInteger(value) {
  const parsed = parseNumber(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function scraperCandidateElectedOrder(candidate = {}) {
  if (Array.isArray(candidate.counts)) {
    const order = positiveInteger(candidate.counts[3]);
    if (order !== null) return order;
  }
  return null;
}

function scraperCandidateEventCount(candidate = {}) {
  if (scraperCandidateIsAutoReturned(candidate)) return 1;
  if (Array.isArray(candidate.counts)) {
    const encodedCount = positiveInteger(candidate.counts[2]);
    if (encodedCount !== null) return encodedCount;
  }
  return null;
}

function scraperCandidateIsElected(candidate = {}) {
  return statusKind(candidate.status) === 'elected'
    || candidate.counted_as_elected === true
    || scraperCandidateElectedOrder(candidate) !== null
    || scraperCandidateIsAutoReturned(candidate);
}

function scraperCandidateFirstPref(candidate = {}) {
  if (scraperCandidateIsAutoReturned(candidate)) return 0;
  return parseNumber(
    candidate.first_pref != null
      ? candidate.first_pref
      : (Array.isArray(candidate.counts) ? candidate.counts[0] : null)
  ) || 0;
}

function scraperCandidateParty(candidate = {}) {
  if (scraperCandidateIsAutoReturned(candidate)) {
    return normalizeParty(scraperCandidateAffiliatedParty(candidate));
  }
  return normalizeParty(String(candidate.party || '').replace(/\s*Lozenge\s*$/i, '').trim() || 'Independent');
}

export function buildMainLikePartySummaryFromRawResults(rawEntries = []) {
  const partyTotals = new Map();
  let totalValid = 0;
  let totalPoll = 0;
  let totalElectorate = 0;
  let totalSpoiled = 0;
  let totalSeats = 0;

  for (const entry of rawEntries || []) {
    const raw = entry?.raw;
    if (isScraperCandidatePayload(raw)) {
      const meta = raw.meta || {};
      let constituencyValid = parseNumber(meta.Valid_Poll ?? meta.valid_poll ?? meta.validPoll);
      let inferredValid = 0;
      let explicitSeats = parseNumber(raw.seats ?? meta.seats ?? meta.Number_Of_Seats);
      let electedCount = 0;

      for (const candidate of raw.candidates || []) {
        const party = scraperCandidateParty(candidate);
        const votes = scraperCandidateFirstPref(candidate);
        inferredValid += votes;
        if (!partyTotals.has(party)) {
          partyTotals.set(party, {
            party,
            seats: 0,
            stood: 0,
            votes: 0,
            colour: partyColour(party)
          });
        }
        const totals = partyTotals.get(party);
        const elected = scraperCandidateIsElected(candidate);
        const autoReturned = scraperCandidateIsAutoReturned(candidate);
        if (!autoReturned) {
          totals.votes += votes;
          totals.stood += 1;
        }
        if (elected) {
          const seatParty = scraperCandidateParty(candidate);
          if (!partyTotals.has(seatParty)) {
            partyTotals.set(seatParty, {
              party: seatParty,
              seats: 0,
              stood: 0,
              votes: 0,
              colour: partyColour(seatParty)
            });
          }
          partyTotals.get(seatParty).seats += 1;
          electedCount += 1;
        }
      }

      if (constituencyValid === null) constituencyValid = inferredValid;
      const electorate = parseNumber(meta.Total_Electorate ?? meta.electorate ?? meta.electorate_total);
      const turnoutPct = parseNumber(meta.turnout_pct ?? meta.turnoutPct);
      const explicitTotalPoll = parseNumber(meta.Total_Poll ?? meta.total_poll ?? meta.totalPoll);
      const constituencyTotalPoll = explicitTotalPoll ?? (electorate !== null && turnoutPct !== null
        ? Math.round(electorate * turnoutPct / 100)
        : null);
      const explicitSpoiled = parseNumber(meta.Spoiled ?? meta.spoiled);
      const constituencySpoiled = explicitSpoiled ?? (constituencyTotalPoll !== null && constituencyValid !== null
        ? Math.max(0, constituencyTotalPoll - constituencyValid)
        : null);
      totalValid += constituencyValid || 0;
      totalPoll += numberOrZero(constituencyTotalPoll);
      totalElectorate += numberOrZero(electorate);
      totalSpoiled += numberOrZero(constituencySpoiled);
      totalSeats += explicitSeats !== null && explicitSeats > 0 ? explicitSeats : electedCount;
      continue;
    }

    const payload = normalizeScraperPayloadForMain(entry.raw, entry.constituency);
    const cg = payload?.Constituency?.countGroup || [];
    const info = payload?.Constituency?.countInfo || {};
    if (!cg.length) continue;

    const validPoll = safeValidPoll(info, cg);
    totalValid += validPoll;
    totalPoll += numberOrZero(info.Total_Poll);
    totalElectorate += numberOrZero(info.Total_Electorate);
    totalSpoiled += numberOrZero(info.Spoiled);
    totalSeats += numberOrZero(info.Number_Of_Seats);

    const seenCandidates = new Set();
    for (const row of cg) {
      if (!isValidCandidateRow(row)) continue;
      const countNum = parseInt(row.Count_Number, 10) || 1;
      const candidateId = String(row.Candidate_Id || '');
      const party = normalizeParty(row.Party_Name) || 'Independent/Other';
      if (!partyTotals.has(party)) {
        partyTotals.set(party, {
          party,
          seats: 0,
          stood: 0,
          votes: 0,
          colour: row.Party_Colour || partyColour(party)
        });
      }
      if (countNum === 1 && !seenCandidates.has(candidateId)) {
        seenCandidates.add(candidateId);
        const total = numberOrZero(row.Total_Votes);
        const totals = partyTotals.get(party);
        totals.votes += total;
        totals.stood += 1;
      }
    }

    for (const member of extractMainLikeElected(payload)) {
      const party = normalizeParty(member.party) || 'Independent/Other';
      if (!partyTotals.has(party)) {
        partyTotals.set(party, {
          party,
          seats: 0,
          stood: 0,
          votes: 0,
          colour: member.colour || partyColour(party)
        });
      }
      partyTotals.get(party).seats += 1;
    }
  }

  const rows = [...partyTotals.values()]
    .map((row) => ({
      ...row,
      share: totalValid > 0 ? (row.votes / totalValid * 100) : null
    }))
    .sort((a, b) => numberOrZero(b.seats) - numberOrZero(a.seats)
      || numberOrZero(b.votes) - numberOrZero(a.votes)
      || String(a.party || '').localeCompare(String(b.party || '')));

  return {
    rows,
    totals: {
      validPoll: totalValid,
      totalPoll,
      totalElectorate,
      totalSpoiled,
      totalSeats
    }
  };
}

export function extractElected(result = {}) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const seats = parseNumber(result.seatsTotal ?? result.seatsWon);
  const complete = completeElectedCandidateSet(candidates, seats);
  const explicit = complete.filter((candidate) => candidate.elected);
  if (explicit.length) {
    return explicit
      .map((candidate) => ({ ...candidate, colour: candidate.colour || partyColour(candidate.party) }))
      .sort((a, b) => numberOrZero(a.electedAt) - numberOrZero(b.electedAt) || numberOrZero(b.finalVotes) - numberOrZero(a.finalVotes))
      .slice(0, seats && seats > 0 ? seats : explicit.length);
  }
  if (seats && seats > 0) {
    return [...complete]
      .filter((candidate) => !candidate.excluded)
      .sort((a, b) => numberOrZero(b.finalVotes ?? b.firstPrefs) - numberOrZero(a.finalVotes ?? a.firstPrefs))
      .slice(0, seats)
      .map((candidate) => ({ ...candidate, elected: true, status: candidate.status || 'Deemed elected', colour: candidate.colour || partyColour(candidate.party) }));
  }
  return [];
}

function candidateLastCount(candidate = {}) {
  const counts = Array.isArray(candidate.counts) ? candidate.counts : [];
  return Math.max(1, ...counts.map((count) => parseNumber(count?.count) || 0));
}

function completeElectedCandidateSet(candidates = [], seatsTotal = null) {
  const seats = parseNumber(seatsTotal);
  if (!seats || seats <= 0 || !Array.isArray(candidates) || !candidates.length) return candidates;
  const explicit = candidates.filter((candidate) => candidate.elected);
  if (explicit.length >= seats) return candidates;

  const explicitIds = new Set(explicit.map((candidate) => candidate.id || `${candidate.name}|${candidate.party}`));
  const needed = seats - explicit.length;
  const inferred = candidates
    .filter((candidate) => {
      const id = candidate.id || `${candidate.name}|${candidate.party}`;
      if (explicitIds.has(id)) return false;
      if (candidate.excluded || statusKind(candidate.status) === 'excluded') return false;
      if (candidate.autoReturnedCeannComhairle) return false;
      return numberOrZero(candidate.finalVotes ?? candidate.firstPrefs) > 0;
    })
    .sort((a, b) => numberOrZero(b.finalVotes ?? b.firstPrefs) - numberOrZero(a.finalVotes ?? a.firstPrefs)
      || numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs)
      || String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, needed);

  if (!inferred.length) return candidates;
  const inferredIds = new Set(inferred.map((candidate) => candidate.id || `${candidate.name}|${candidate.party}`));
  return candidates.map((candidate) => {
    const id = candidate.id || `${candidate.name}|${candidate.party}`;
    if (!inferredIds.has(id)) return candidate;
    const lastCount = candidateLastCount(candidate);
    const counts = Array.isArray(candidate.counts)
      ? candidate.counts.map((count) => Number(count?.count) === lastCount
        ? { ...count, status: count.status || 'Deemed elected' }
        : count)
      : candidate.counts;
    return {
      ...candidate,
      elected: true,
      electedAt: candidate.electedAt || lastCount,
      excluded: false,
      excludedAt: null,
      status: 'Deemed elected',
      counts
    };
  });
}

function extractMainLikeElected(payload = {}) {
  const cg = payload.Constituency?.countGroup || [];
  if (!cg.length) return [];
  const info = payload.Constituency?.countInfo || {};
  const numSeats = parseNumber(info.Number_Of_Seats) || 5;
  const elected = [];
  const excluded = new Set();
  const seen = new Set();
  const lastCount = Math.max(...cg.map((row) => parseInt(row.Count_Number, 10) || 0), 1);
  const grouped = new Map();

  for (const row of cg) {
    const cid = row.Candidate_Id;
    if (!cid || String(cid).toLowerCase() === 'nontransferable') continue;
    if (!grouped.has(cid)) {
      grouped.set(cid, {
        rows: [],
        name: candidateDisplayName(row),
        party: normalizeParty(row.Party_Name),
        colour: row.Party_Colour || partyColour(row.Party_Name)
      });
    }
    grouped.get(cid).rows.push(row);
  }

  grouped.forEach((entry, cid) => {
    const candidate = { counts: {} };
    for (const row of entry.rows) {
      candidate.counts[parseInt(row.Count_Number, 10) || 1] = {
        total: numberOrZero(row.Total_Votes),
        transfers: numberOrZero(row.Transfers),
        status: row.Status || ''
      };
      if (statusKind(row.Status) === 'excluded') excluded.add(cid);
    }
    const lifecycle = inferMainLikeCandidateLifecycle(candidate, info, lastCount);
    if (lifecycle.electedAt && !seen.has(cid)) {
      seen.add(cid);
      elected.push({
        name: entry.name,
        party: entry.party,
        colour: entry.colour,
        count: lifecycle.electedAt
      });
    }
  });

  if (elected.length < numSeats) {
    const finalRound = cg
      .filter((row) => (parseInt(row.Count_Number, 10) || 0) === lastCount)
      .sort((a, b) => numberOrZero(b.Total_Votes) - numberOrZero(a.Total_Votes));
    for (const row of finalRound) {
      if (!seen.has(row.Candidate_Id)
        && !excluded.has(row.Candidate_Id)
        && row.Candidate_Id !== 'nontransferable') {
        seen.add(row.Candidate_Id);
        elected.push({
          name: candidateDisplayName(row),
          party: normalizeParty(row.Party_Name),
          colour: row.Party_Colour || partyColour(row.Party_Name),
          count: lastCount
        });
      }
    }
  }

  return elected.sort((a, b) => numberOrZero(a.count) - numberOrZero(b.count)).slice(0, numSeats);
}

function inferMainLikeCandidateLifecycle(candidate, info, lastCount) {
  const quota = parseNumber(info?.Quota);
  const counts = Object.keys(candidate.counts || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let electedAt = null;
  let excludedAt = null;
  let terminalCount = null;

  counts.forEach((countNum, index) => {
    const current = candidate.counts[countNum];
    const previous = index > 0 ? candidate.counts[counts[index - 1]] : null;
    const total = current?.total ?? 0;
    const transfer = current?.transfers ?? 0;

    if (!electedAt && Number.isFinite(quota) && total >= (quota - 0.01)) electedAt = countNum;
    if (!excludedAt && previous && previous.total > 0.01 && total <= 0.01 && transfer < -0.01) {
      excludedAt = countNum;
      terminalCount = countNum;
    }
    if (!terminalCount && previous && Number.isFinite(quota) && previous.total > (quota + 0.01)
      && Math.abs(total - quota) <= 0.01 && transfer < -0.01) {
      terminalCount = countNum;
    }
  });

  return { electedAt, excludedAt, terminalCount, lastCount };
}

function safeValidPoll(info = {}, countGroup = []) {
  const explicit = parseNumber(info.Valid_Poll);
  if (explicit !== null) return explicit;
  const seen = new Set();
  let total = 0;
  for (const row of countGroup) {
    const cid = String(row.Candidate_Id || '');
    const countNum = parseInt(row.Count_Number, 10) || 1;
    if (countNum !== 1 || !isValidCandidateRow(row) || seen.has(cid)) continue;
    seen.add(cid);
    total += numberOrZero(row.Total_Votes);
  }
  if (total > 0) return total;
  const fallback = numberOrZero(info.Total_Poll) - numberOrZero(info.Spoiled);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function candidateKey(name, party) {
  const norm = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(name)}|${norm(party)}`;
}

function isValidCandidateRow(row = {}) {
  const cid = String(row.Candidate_Id || '').trim();
  const name = candidateDisplayName(row, '');
  if (!cid || cid.toLowerCase() === 'nontransferable') return false;
  if (!name || name.toLowerCase() === 'party') return false;
  return true;
}

export function buildMainLikeCandidateSummaryFromRawResults(rawEntries = []) {
  const rows = [];
  let totalValid = 0;

  for (const entry of rawEntries || []) {
    const raw = entry?.raw;
    if (isScraperCandidatePayload(raw)) {
      const meta = raw.meta || {};
      const inferredValid = (raw.candidates || []).reduce((sum, candidate) => sum + scraperCandidateFirstPref(candidate), 0);
      const constValid = parseNumber(meta.Valid_Poll ?? meta.valid_poll ?? meta.validPoll) || inferredValid;
      const constituency = fixText(raw.constituency || entry.constituency || '');
      totalValid += constValid;

      for (const [index, candidate] of (raw.candidates || []).entries()) {
        const name = fixText(candidate.name || '').trim();
        const party = scraperCandidateParty(candidate);
        const votes = scraperCandidateFirstPref(candidate);
        const autoReturned = scraperCandidateIsAutoReturned(candidate);
        const elected = scraperCandidateIsElected(candidate);
        const excluded = statusKind(candidate.status) === 'excluded';
        const finalCount = parseNumber(candidate.final_count);
        const resolvedCount = Number.isInteger(finalCount) && finalCount > 0 ? finalCount : null;
        const status = autoReturned ? 'Elected (auto returned)' : (elected ? 'Elected' : (excluded ? 'Excluded' : fixText(candidate.status || '') || 'Not Elected'));
        rows.push({
          id: String(index + 1),
          personId: String(index + 1),
          constituency,
          name,
          party,
          colour: partyColour(party),
          firstPrefs: votes,
          votes,
          constPct: constValid > 0 ? (votes / constValid * 100) : 0,
          firstPrefPct: constValid > 0 ? (votes / constValid * 100) : 0,
          finalVotes: votes,
          elected,
          electedAt: elected ? (resolvedCount || 1) : null,
          excluded,
          excludedAt: excluded ? (resolvedCount || null) : null,
          resolvedCount,
          countDisplay: resolvedCount ? String(resolvedCount) : '',
          status,
          autoReturnedCeannComhairle: autoReturned,
          counts: [{
            total: votes,
            transfers: 0,
            status: fixText(candidate.status || ''),
            firstPrefs: votes,
            count: resolvedCount || 1
          }],
          candidateKey: candidateKey(name, party)
        });
      }
      continue;
    }

    const payload = normalizeScraperPayloadForMain(entry.raw, entry.constituency);
    const cg = payload?.Constituency?.countGroup || [];
    const info = payload?.Constituency?.countInfo || {};
    if (!cg.length) continue;

    const constValid = safeValidPoll(info, cg);
    const seatCount = parseNumber(info.Number_Of_Seats) || 0;
    const constituency = fixText(entry.constituency || info.Constituency_Name || '');
    totalValid += constValid;

    const byCandidate = new Map();
    const countNums = unique(cg.map((row) => parseInt(row.Count_Number, 10) || 1)).sort((a, b) => a - b);
    const lastCount = countNums[countNums.length - 1] || 1;
    const totalCountCount = countNums.length || 1;

    for (const row of cg) {
      if (!isValidCandidateRow(row)) continue;
      const cid = String(row.Candidate_Id || '');
      const countNum = parseInt(row.Count_Number, 10) || 1;
      if (!byCandidate.has(cid)) {
        const name = candidateDisplayName(row);
        const party = normalizeParty(row.Party_Name);
        byCandidate.set(cid, {
          id: cid,
          personId: cid,
          constituency,
          name,
          party,
          colour: row.Party_Colour || partyColour(party),
          firstPrefs: 0,
          votes: 0,
          constPct: 0,
          firstPrefPct: 0,
          finalVotes: 0,
          elected: false,
          electedAt: null,
          excluded: false,
          excludedAt: null,
          resolvedCount: null,
          countDisplay: '',
          status: '',
          counts: {}
        });
      }
      const candidate = byCandidate.get(cid);
      const total = numberOrZero(row.Total_Votes);
      if (countNum === 1) {
        candidate.firstPrefs = total;
        candidate.votes = total;
        candidate.constPct = constValid > 0 ? (total / constValid * 100) : 0;
        candidate.firstPrefPct = candidate.constPct;
      }
      candidate.counts[countNum] = {
        total,
        transfers: numberOrZero(row.Transfers),
        status: row.Status || ''
      };
      if (total > candidate.finalVotes) candidate.finalVotes = total;
    }

    byCandidate.forEach((candidate) => {
      const lifecycle = inferMainLikeCandidateLifecycle(candidate, info, lastCount);
      candidate.electedAt = lifecycle.electedAt;
      candidate.excludedAt = lifecycle.excludedAt;
    });

    const explicitElected = [...byCandidate.values()].filter((candidate) => !!candidate.electedAt).length;
    if (seatCount > 0 && explicitElected < seatCount) {
      const needed = seatCount - explicitElected;
      [...byCandidate.values()]
        .filter((candidate) => !candidate.electedAt && !candidate.excludedAt)
        .sort((a, b) => numberOrZero(b.finalVotes) - numberOrZero(a.finalVotes))
        .slice(0, needed)
        .forEach((candidate) => {
          candidate.electedAt ||= lastCount;
        });
    }

    byCandidate.forEach((candidate) => {
      candidate.resolvedCount = candidate.electedAt
        ? (candidate.electedAt || lastCount)
        : candidate.excludedAt
        ? (candidate.excludedAt || lastCount)
        : lastCount;
      candidate.elected = Boolean(candidate.electedAt);
      candidate.excluded = Boolean(candidate.excludedAt);
      candidate.status = candidate.electedAt ? 'Elected' : (candidate.excludedAt ? 'Excluded' : 'Not Elected');
      candidate.countDisplay = `${candidate.resolvedCount}/${totalCountCount}`;
      candidate.candidateKey = candidateKey(candidate.name, candidate.party);
      rows.push(candidate);
    });
  }

  return {
    rows: rows.sort((a, b) => {
      const pctDelta = numberOrZero(b.constPct) - numberOrZero(a.constPct);
      if (Math.abs(pctDelta) > 1e-9) return pctDelta;
      return numberOrZero(b.votes) - numberOrZero(a.votes)
        || String(a.name || '').localeCompare(String(b.name || ''));
    }),
    totals: {
      validPoll: totalValid
    }
  };
}

export function summarizeResult(raw, fallbackConstituency) {
  const mainPayload = normalizeScraperPayloadForMain(raw, fallbackConstituency);
  const source = mainPayload?.Constituency || raw?.Constituency || raw || {};
  const syntheticCountGroup = Boolean(source.__syntheticCountGroup);
  const info = source.countInfo || raw?.meta || raw?.metaData || {};
  const forumRows = Array.isArray(source.forum?.rows) ? source.forum.rows : null;
  const rows = forumRows || source.countGroup || raw?.candidates || [];
  const constituency = fixText(source.constituency || raw?.constituency || info.Constituency_Name || fallbackConstituency);
  const recallPetition = source.recallPetition || raw?.recallPetition || raw?.petition || null;
  let candidates = forumRows ? summarizeForumRows(forumRows) : summarizeCandidateRows(rows);
  const ranked = [...candidates].sort((a, b) => numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs));
  const seatsTotal = parseNumber(info.Number_Of_Seats ?? raw?.meta?.seats ?? raw?.seats);
  if (!forumRows) candidates = completeElectedCandidateSet(candidates, seatsTotal);
  let elected = extractElected({ candidates, seatsTotal });
  const leading = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const validPoll = parseNumber(info.Valid_Poll ?? raw?.validPoll ?? raw?.meta?.valid_poll ?? raw?.meta?.validPoll);
  const totalPoll = parseNumber(info.Total_Poll ?? raw?.totalPoll ?? raw?.meta?.total_poll ?? raw?.meta?.totalPoll);
  const spoiled = parseNumber(info.Spoiled ?? raw?.spoiled ?? raw?.meta?.spoiled);
  const electorate = parseNumber(info.Total_Electorate ?? raw?.electorate ?? raw?.meta?.electorate);
  const totalVotes = validPoll || candidates.reduce((sum, candidate) => sum + numberOrZero(candidate.firstPrefs), 0);
  const turnoutPct = parseNumber(info.Turnout_Pct ?? raw?.turnoutPct ?? raw?.turnout_pct ?? raw?.meta?.turnout_pct ?? raw?.meta?.turnoutPct)
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
    spoiled: spoiled || null,
    validPoll: validPoll || totalVotes || null,
    totalVotes: totalVotes || null,
    colour: partyColour(winnerParty || leading?.party),
    leadingColour: partyColour(leading?.party),
    candidates,
    elected,
    countInfo: info,
    countGroup: Array.isArray(source.countGroup) ? source.countGroup : [],
    syntheticCountGroup,
    nonTransferable: summarizeNonTransferableRows(rows),
    forum: source.forum || null,
    countNumbers,
    ...(recallPetition ? { recallPetition } : {}),
    hasCountDetail: countNumbers.length > 1 || candidates.some((candidate) => (candidate.counts || []).length > 1),
    animationPayload: mainPayload || raw || null,
    constituencyId: raw?.constituencyId || raw?.officialDail?.constituencyId || null,
    constituencyNumber: raw?.constituencyNumber || raw?.officialDail?.constituencyNumber || info.Constituency_Number || null,
    officialDail: raw?.officialDail || null
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
      if (candidate.autoReturnedCeannComhairle) continue;
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
      if (!candidate.autoReturnedCeannComhairle) {
        partyEntry.firstPrefs += numberOrZero(candidate.firstPrefs);
        partyEntry.finalVotes += numberOrZero(candidate.finalVotes);
        partyEntry.stood += 1;
      }
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
    const previousCandidates = new Map((previous?.candidates || []).map((candidate) => [
      candidateCompareKey(candidate),
      candidate
    ]));
    const candidates = (result.candidates || []).map((candidate) => {
      const previousCandidate = previousCandidates.get(candidateCompareKey(candidate));
      const currentFirstPrefPct = result.validPoll ? numberOrZero(candidate.firstPrefs) / result.validPoll * 100 : null;
      const previousFirstPrefPct = previous?.validPoll && previousCandidate ? numberOrZero(previousCandidate.firstPrefs) / previous.validPoll * 100 : null;
      return {
        ...candidate,
        previous: previousCandidate ? {
          firstPrefs: previousCandidate.firstPrefs,
          firstPrefPct: previousFirstPrefPct,
          finalVotes: previousCandidate.finalVotes,
          elected: previousCandidate.elected,
          status: previousCandidate.status
        } : null,
        deltas: previousCandidate ? {
          firstPrefs: numberOrZero(candidate.firstPrefs) - numberOrZero(previousCandidate.firstPrefs),
          firstPrefPct: currentFirstPrefPct !== null && previousFirstPrefPct !== null ? round(currentFirstPrefPct - previousFirstPrefPct, 2) : null,
          finalVotes: numberOrZero(candidate.finalVotes) - numberOrZero(previousCandidate.finalVotes)
        } : null
      };
    });
    return {
      ...result,
      candidates,
      previous: previous ? {
        leadingParty: previous.leadingParty,
        winnerParty: previous.winnerParty,
        leadingVotes: previous.leadingVotes,
        leadingPct: previous.leadingPct,
        turnoutPct: previous.turnoutPct,
        seatsWon: previous.seatsWon,
        validPoll: previous.validPoll,
        candidates: previous.candidates || []
      } : null,
      deltas: previous ? {
        leadingVotes: numberOrZero(result.leadingVotes) - numberOrZero(previous.leadingVotes),
        leadingPct: result.leadingPct !== null && previous.leadingPct !== null ? round(result.leadingPct - previous.leadingPct, 2) : null,
        turnoutPct: result.turnoutPct !== null && previous.turnoutPct !== null ? round(result.turnoutPct - previous.turnoutPct, 2) : null,
        seatsWon: numberOrZero(result.seatsWon) - numberOrZero(previous.seatsWon),
        validPoll: numberOrZero(result.validPoll) - numberOrZero(previous.validPoll)
      } : null
    };
  });
}

export function seatPositions(total, spacing = 13) {
  if (total <= 0) return [];
  if (total === 1) return [{ x: 0, y: 0 }];
  if (total === 2) return [{ x: 0, y: 0 }, { x: spacing, y: 0 }];
  if (total === 3) return [{ x: 0, y: 0 }, { x: spacing, y: 0 }, { x: spacing * 2, y: 0 }];
  if (total > 12) {
    const spanRadians = Math.PI;
    const getRowsFromNRows = (rowTotal) => {
      const rowThicc = 1 / ((4 * rowTotal) - 2);
      return Array.from({ length: rowTotal }, (_, rowIndex) => {
        const rowArcRadius = 0.5 + (2 * rowIndex * rowThicc);
        return Math.max(1, Math.floor((spanRadians * rowArcRadius) / (2 * rowThicc)));
      });
    };
    let nRows = 1;
    let capacities = getRowsFromNRows(nRows);
    while (capacities.reduce((sum, value) => sum + value, 0) < total) {
      nRows += 1;
      capacities = getRowsFromNRows(nRows);
    }

    const totalCapacity = capacities.reduce((sum, value) => sum + value, 0);
    const fillRatio = total / totalCapacity;
    const rowCounts = capacities.map((capacity) => Math.max(1, Math.round(capacity * fillRatio)));
    let assigned = rowCounts.reduce((sum, value) => sum + value, 0);
    while (assigned > total) {
      const idx = findLastIndex(rowCounts, (count) => count > 1);
      if (idx < 0) break;
      rowCounts[idx] -= 1;
      assigned -= 1;
    }
    while (assigned < total) {
      const target = capacities
        .map((capacity, idx) => ({ idx, deficit: capacity - rowCounts[idx] }))
        .filter((item) => item.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit)[0];
      if (!target) break;
      rowCounts[target.idx] += 1;
      assigned += 1;
    }

    const rowThicc = 1 / ((4 * nRows) - 2);
    const desiredCenterSpacing = spacing * 1.02;
    const scale = desiredCenterSpacing / (2 * rowThicc);
    const positions = [];

    rowCounts.forEach((countOnRow, rowIndex) => {
      const rowArcRadius = 0.5 + (2 * rowIndex * rowThicc);
      if (countOnRow <= 0) return;
      if (countOnRow === 1) {
        positions.push({ x: scale, y: 0 });
        return;
      }
      const angleMargin = Math.asin(rowThicc / rowArcRadius);
      const angleIncrement = (Math.PI - (2 * angleMargin)) / (countOnRow - 1);
      for (let seat = 0; seat < countOnRow; seat += 1) {
        const angle = angleMargin + (seat * angleIncrement);
        positions.push({
          x: ((rowArcRadius * Math.cos(angle)) + 1) * scale,
          y: (-Math.sin(angle) * rowArcRadius) * scale
        });
      }
    });

    const minX = Math.min(...positions.map((point) => point.x));
    const minY = Math.min(...positions.map((point) => point.y));
    positions.forEach((point) => {
      point.x -= minX;
      point.y -= minY;
    });
    positions.sort((a, b) => a.x - b.x || a.y - b.y);
    return positions;
  }

  const topCount = Math.ceil(total / 2);
  const botCount = total - topCount;
  const positions = [];
  const topWidth = (topCount - 1) * spacing;
  const topStartX = -topWidth / 2;
  for (let index = 0; index < topCount; index += 1) {
    positions.push({ x: topStartX + index * spacing, y: 0 });
  }
  const botWidth = (botCount - 1) * spacing;
  const botStartX = -botWidth / 2;
  for (let index = 0; index < botCount; index += 1) {
    positions.push({ x: botStartX + index * spacing, y: spacing });
  }
  const minX = Math.min(...positions.map((point) => point.x));
  const minY = Math.min(...positions.map((point) => point.y));
  positions.forEach((point) => {
    point.x -= minX;
    point.y -= minY;
  });
  return positions;
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index, items)) return index;
  }
  return -1;
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

function isNonTransferableRow(row = {}, key = '', name = '', party = '') {
  return [
    key,
    name,
    party,
    row.Candidate_Id,
    row.candidateName,
    row.Party_Name
  ].some((value) => /non\s*transferable/.test(normalizeName(value)));
}

function summarizeNonTransferableRows(rows = []) {
  const counts = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = candidateDisplayName(row);
    const party = normalizeParty(row.Party_Name || row.party || row.party_name);
    const key = row.Candidate_Id || row.person_id || `${name}|${party}`;
    if (!isNonTransferableRow(row, key, name, party)) continue;
    const count = parseNumber(row.Count_Number ?? row.count);
    if (!count) continue;
    counts.push({
      count,
      total: parseNumber(row.Total_Votes ?? row.total),
      transfers: parseNumber(row.Transfers ?? row.transfer ?? row.transfers),
      status: fixText(row.Status || row.status || '')
    });
  }
  return counts.sort((a, b) => a.count - b.count);
}

function candidateCompareKey(candidate = {}) {
  return normalizeName(candidate.name || candidate.candidateName || candidate.Candidate_Name || candidate.id || '');
}
