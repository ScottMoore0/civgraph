// Printed party labels -> the party or independent label the site reads them as.
//
// The rules live in data/elections/party-label-interpretations.json (its description gives
// them in full); the election manifest applies them to every source contest after the
// source-checked fixes, so a fix that names a candidate's party wins. In short:
//   - a rule fills a blank Party_Name when the printed label (Party_As_Printed) matches and the
//     contest is in the rule's scope (bodies, region, [from, until), named candidates);
//   - a rule marked override also replaces the reading already there; a rule with whenParty
//     matches on that reading instead of (or as well as) the printed label;
//   - a ditto mark ("do.") takes the reading of the candidate printed above it;
//   - honours and professions (J.P., M.B.E., V.S.) are not labels: the reading stays blank,
//     which the site shows as "No label".
// The printed label itself is never changed.
import { candidateDisplayName, normalizeName, normalizeParty } from '../../packages/core/src/election-domain.mjs';

function candidateNameKey(row) {
  return normalizeName(row?.candidateName || row?.name || `${row?.Firstname || ''} ${row?.Surname || ''}`);
}

/** An interpreter for one rules document: (scope, rawResult) -> rawResult, rows changed in place. */
export function createPartyLabelInterpreter(config = {}) {
  const dittoMarks = new Set(config.dittoMarks || []);
  const noLabel = new Set(config.noLabel?.printed || []);
  // A region names the bodies a rule may act in ("ni": the Northern Ireland bodies), so a rule
  // can be confined to Northern Ireland without listing every council on it.
  const regions = new Map(Object.entries(config.regions || {})
    .map(([name, region]) => [name, new Set(Array.isArray(region) ? region : region?.bodies || [])]));
  const rules = (config.rules || []).map((rule) => {
    if (rule.region && !regions.has(rule.region)) throw new Error(`party-label rule names an unknown region: ${rule.region}`);
    return {
      ...rule,
      regionBodies: rule.region ? regions.get(rule.region) : null,
      candidateKeys: rule.candidates ? new Set(rule.candidates.map((name) => normalizeName(name))) : null
    };
  });

  function ruleFor(printed, party, scope, nameKey) {
    return rules.find((rule) => {
      if (!rule.printed && !rule.whenParty) return false;
      if (rule.printed && !rule.printed.includes(printed)) return false;
      if (rule.whenParty && !rule.whenParty.includes(party)) return false;
      if (party && !rule.override) return false;
      if (rule.bodies && !rule.bodies.includes(scope.body)) return false;
      if (rule.regionBodies && !rule.regionBodies.has(scope.body)) return false;
      if (rule.from && String(scope.date || '') < rule.from) return false;
      if (rule.until && String(scope.date || '') >= rule.until) return false;
      if (rule.candidateKeys && !rule.candidateKeys.has(nameKey)) return false;
      return true;
    }) || null;
  }

  /** The reading for one printed label and current reading; `previous` is the row above's. */
  function read(printed, current, scope, nameKey, previous) {
    if (printed && noLabel.has(printed)) return current;
    if (printed && !current && dittoMarks.has(printed)) return previous ?? '';
    const rule = ruleFor(printed, current, scope, nameKey);
    return rule ? rule.party : current;
  }

  function apply(scope, rawResult) {
    if (!rawResult || !rules.length) return rawResult;
    for (const rows of [rawResult.Constituency?.countGroup, rawResult.candidates]) {
      if (!Array.isArray(rows)) continue;
      // A candidate has a row per count: read each candidate once, in the order printed.
      const readings = new Map();
      let previous = null;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const field = 'Party_Name' in row || !('party' in row) ? 'Party_Name' : 'party';
        const nameKey = candidateNameKey(row);
        const key = `${row.Candidate_Id || ''}|${nameKey}`;
        if (!readings.has(key)) {
          const printed = String(row.Party_As_Printed ?? row.partyAsPrinted ?? '').trim();
          const current = String(row[field] || '').trim();
          const reading = read(printed, current, scope, nameKey, previous);
          readings.set(key, { from: current, to: reading });
          previous = reading;
        }
        // Only a row that reads as the candidate's first row did is changed: a contest whose rows
        // disagree (a count sidecar's row beside the flat file's) is left exactly as it was.
        const { from, to } = readings.get(key);
        const before = String(row[field] || '').trim();
        const reading = to;
        if (from === to || before !== from) continue;
        // A row with no candidate id is keyed by its name and party (summarizeCandidateRows), and
        // the person registry recognises the candidacy by that key. The key is the row's identity,
        // not its reading: keep the one it had, so a new reading never renumbers the person.
        if (!String(row.Candidate_Id || '').trim() && !row.person_id) {
          row.Candidate_Id = `${candidateDisplayName(row)}|${normalizeParty(before)}`;
        }
        row[field] = reading;
      }
    }
    return rawResult;
  }

  return { apply, read, ruleFor };
}
