import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FAIL_ON_BLOCKING = process.argv.includes('--fail-on-blocking');
const JSON_OUT = path.join(ROOT, 'tasks', 'test2-election-data-audit.json');
const MD_OUT = path.join(ROOT, 'tasks', 'test2-election-data-audit.md');

const readJson = (relativePath) => {
  const absolute = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
};

const readJsonIfExists = (relativePath, fallback = null) => {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return fallback;
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
};

const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

const urlToRelativePath = (url) => {
  if (!url || typeof url !== 'string') return null;
  const clean = url.split('#')[0].split('?')[0].replace(/^\/+/, '');
  return clean || null;
};

const urlExists = (url) => {
  const relativePath = urlToRelativePath(url);
  return Boolean(relativePath && exists(relativePath));
};

const slugify = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'entry';

const normalizeKeyText = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const keyToSourceDetailPaths = (entry) => {
  const candidates = [];
  if (entry?.key) {
    candidates.push(`data/browse/details/sources/election-source-${slugify(String(entry.key).replace(/__/g, '-'))}.json`);
  }
  if (entry?.bodySlug && entry?.date) {
    candidates.push(`data/browse/details/sources/election-source-${entry.bodySlug}-${entry.date}.json`);
  }
  return [...new Set(candidates)];
};

const addIssue = (issues, severity, category, key, message, details = {}) => {
  issues.push({ severity, category, key, message, ...details });
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => String(header || '').replace(/^\uFEFF/, ''));
  return rows
    .filter((values) => values.some((value) => value !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

const normaliseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const VALID_CONTEST_TYPES = new Set(['election', 'referendum', 'recall-petition']);
const VALID_ELECTION_KINDS = new Set(['general', 'by-election']);
const VALID_CONTEST_STATUSES = new Set(['contested', 'uncontested']);
const VALID_VOTING_SYSTEMS = new Set(['fptp', 'block-vote', 'stv-gregory', 'stv-hare', 'party-list-dhondt', 'ordinal']);

const contestTypeFor = (entry, result = null) => result?.contestType || entry?.contestType || (/referendum/i.test(entry?.body || entry?.displayTitle || '') ? 'referendum' : 'election');

const isReferendumLike = (entry, result = null) => contestTypeFor(entry, result) === 'referendum';

const isCandidateListExpected = (entry, result) => {
  const contestType = contestTypeFor(entry, result);
  if (contestType !== 'election') return false;
  const status = result?.contestStatus || entry?.contestStatus || 'contested';
  if (status === 'uncontested') return false;
  if (result?.candidateRowsExpected === false || entry?.candidateRowsExpected === false) return false;
  return true;
};

const hasAnimationData = (result) => {
  if (!result?.animationPayload || typeof result.animationPayload !== 'object') return false;
  return Object.values(result.animationPayload).some((payload) => {
    if (!payload || typeof payload !== 'object') return false;
    return Object.values(payload).some((value) => Array.isArray(value) && value.length > 0);
  });
};

const hasCandidateCountDetail = (result) => {
  if (result?.hasCountDetail || hasAnimationData(result)) return true;
  return (result?.candidates || []).some((candidate) => Array.isArray(candidate.counts) && candidate.counts.length > 1);
};

const shouldExpectTransferData = (entry, result) => {
  if (result?.transferDataExpected === false || entry?.transferDataExpected === false) return false;
  if (result?.transferDataExpected === true || entry?.transferDataExpected === true) {
    const seats = normaliseNumber(result?.seatsTotal);
    return seats === null || seats > 1;
  }
  if (contestTypeFor(entry, result) !== 'election') return false;
  const status = result?.contestStatus || entry?.contestStatus || 'contested';
  if (status === 'uncontested') return false;
  const votingSystem = result?.votingSystem || entry?.votingSystem || '';
  const seats = normaliseNumber(result?.seatsTotal);
  if (seats !== null && seats <= 1) return false;
  return votingSystem === 'stv-hare' || votingSystem === 'stv-gregory';
};

const summariseIssues = (issues) => {
  const bySeverity = {};
  const byCategory = {};
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }
  return { bySeverity, byCategory };
};

const escapeMd = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const renderIssueTable = (issues, limit = 40) => {
  if (!issues.length) return '_None._';
  const rows = issues.slice(0, limit).map((issue) =>
    `|${escapeMd(issue.severity)}|${escapeMd(issue.category)}|${escapeMd(issue.key)}|${escapeMd(issue.message)}|`
  );
  const more = issues.length > limit ? `\n\n_${issues.length - limit} more not shown; see JSON report._` : '';
  return ['|severity|category|key|message|', '|---|---|---|---|', ...rows].join('\n') + more;
};

const manifest = readJson('test/metadata/elections-test2.json');
const browse = readJson('data/browse/elections.json');
const issues = [];

const manifestEntries = manifest.elections || [];
const browseItems = browse.items || [];
const browseParents = browseItems.filter((item) => item.entryKind === 'election');
const browseSubEntries = browseItems.filter((item) => item.entryKind !== 'election');
const browseById = new Map(browseParents.map((item) => [item.key || item.id, item]));
const subEntriesByParent = new Map();
for (const item of browseSubEntries) {
  const key = item.parentElectionKey;
  if (!key) continue;
  if (!subEntriesByParent.has(key)) subEntriesByParent.set(key, []);
  subEntriesByParent.get(key).push(item);
}

const validPollReview = readJsonIfExists('data/elections/corrections/valid-poll-review.json', { records: [] });
const candidateRowReview = readJsonIfExists('data/elections/corrections/candidate-row-review.json', { records: [] });
const partyColourReview = readJsonIfExists('data/elections/party-colour-review-overrides.json', { records: [] });

const reviewRecordKey = (electionKey, constituency) => `${electionKey}::${normalizeKeyText(constituency)}`;
const validPollReviewByResult = new Map((validPollReview.records || []).map((record) => [reviewRecordKey(record.electionKey, record.constituency), record]));
const candidateRowReviewByResult = new Map((candidateRowReview.records || []).map((record) => [reviewRecordKey(record.electionKey, record.constituency), record]));
const partyColourReviewByParty = new Map((partyColourReview.records || []).map((record) => [normalizeKeyText(record.party || record.label), record]));

const sourceFiles = fs.existsSync(path.join(ROOT, 'data/browse/details/sources'))
  ? fs.readdirSync(path.join(ROOT, 'data/browse/details/sources')).filter((name) => /^election-source-.*\.json$/.test(name))
  : [];
const resultFiles = fs.existsSync(path.join(ROOT, 'test/metadata/elections-test2'))
  ? fs.readdirSync(path.join(ROOT, 'test/metadata/elections-test2')).filter((name) => name.endsWith('.json'))
  : [];
const summaryFiles = fs.existsSync(path.join(ROOT, 'test/metadata/elections-test2-summaries'))
  ? fs.readdirSync(path.join(ROOT, 'test/metadata/elections-test2-summaries')).filter((name) => name.endsWith('.json'))
  : [];

if (manifest.totals?.elections !== manifestEntries.length) {
  addIssue(issues, 'blocking', 'manifest-total', 'test/metadata/elections-test2.json', `Manifest totals.elections is ${manifest.totals?.elections}, but ${manifestEntries.length} entries are present.`);
}
if (browse.total !== browseItems.length) {
  addIssue(issues, 'blocking', 'browse-total', 'data/browse/elections.json', `Browse total is ${browse.total}, but ${browseItems.length} items are present.`);
}
if (browseParents.length !== manifestEntries.length) {
  addIssue(issues, 'warning', 'browse-parent-count', 'data/browse/elections.json', `Browse has ${browseParents.length} parent elections, manifest has ${manifestEntries.length}.`);
}

const stats = {
  manifest: {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    entries: manifestEntries.length,
    totals: manifest.totals || {}
  },
  browse: {
    total: browse.total,
    parents: browseParents.length,
    subEntries: browseSubEntries.length,
    overallSubEntries: browseSubEntries.filter((item) => item.entryKind === 'election-overall-result').length,
    constituencySubEntries: browseSubEntries.filter((item) => item.entryKind === 'election-constituency-result').length
  },
  sources: {
    sourceDetailFiles: sourceFiles.length,
    resultBundles: resultFiles.length,
    summaryBundles: summaryFiles.length,
    parentSourceRecordsMissing: 0,
    sourceRecordsWithNoReferences: 0,
    sourceRecordsWithOneReference: 0,
    sourceRecordsWithMultipleReferences: 0,
    subEntriesWithNoReferences: 0,
    subEntriesWithOneReference: 0,
    subEntriesWithMultipleReferences: 0
  },
  resultBundles: {
    loaded: 0,
    missing: 0,
    resultRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    candidateRows: 0,
    electedRows: 0,
    rowsWithCountDetail: 0,
    rowsWithAnimationPayload: 0,
    rowsExpectedTransferData: 0,
    rowsMissingExpectedTransferData: 0,
    candidateRowsWithoutParty: 0
  },
  colours: {
    auditFilePresent: false,
    highConfidenceFilePresent: false,
    reviewFilePresent: Boolean((partyColourReview.records || []).length),
    reviewedMismatches: 0,
    observations: 0,
    matches: 0,
    mismatches: 0,
    highConfidenceMismatches: 0,
    noElectionColour: 0,
    noWikipediaMatch: 0,
    ambiguousWikipediaMatch: 0,
    examples: []
  },
  reviewSidecars: {
    validPollRecords: (validPollReview.records || []).length,
    candidateRowRecords: (candidateRowReview.records || []).length,
    partyColourRecords: (partyColourReview.records || []).length
  }
};

for (const entry of manifestEntries) {
  const key = entry.key;
  for (const field of ['key', 'body', 'date', 'bodySlug', 'displayTitle', 'displaySubtitle']) {
    if (!entry[field]) addIssue(issues, 'warning', 'manifest-required-field', key, `Missing manifest field: ${field}.`);
  }
  if (!VALID_CONTEST_TYPES.has(entry.contestType)) {
    addIssue(issues, 'warning', 'contest-metadata', key, `Missing or invalid contestType: ${entry.contestType || '(missing)'}.`);
  }
  if (entry.contestType === 'election' && !VALID_ELECTION_KINDS.has(entry.kind)) {
    addIssue(issues, 'warning', 'contest-metadata', key, `Election entry has missing or invalid kind: ${entry.kind || '(missing)'}.`);
  }
  if (!VALID_CONTEST_STATUSES.has(entry.contestStatus)) {
    addIssue(issues, 'warning', 'contest-metadata', key, `Missing or invalid contestStatus: ${entry.contestStatus || '(missing)'}.`);
  }
  if (!VALID_VOTING_SYSTEMS.has(entry.votingSystem)) {
    addIssue(issues, 'warning', 'contest-metadata', key, `Missing or invalid votingSystem: ${entry.votingSystem || '(missing)'}.`);
  }
  if (!browseById.has(key)) {
    addIssue(issues, 'warning', 'browse-parent-missing', key, 'Manifest election has no matching Browse parent entry.');
  }
  if (Number.isFinite(entry.matchedCount) && Number.isFinite(entry.unmatchedCount) && Number.isFinite(entry.totalConstituencies)) {
    if (entry.matchedCount + entry.unmatchedCount !== entry.totalConstituencies) {
      addIssue(issues, 'blocking', 'geography-counts', key, `matchedCount + unmatchedCount does not equal totalConstituencies (${entry.matchedCount} + ${entry.unmatchedCount} != ${entry.totalConstituencies}).`);
    }
  }
  const unmatchedSample = Array.isArray(entry.unmatchedConstituencySample) ? entry.unmatchedConstituencySample : entry.unmatchedConstituencies;
  if (Array.isArray(unmatchedSample) && Number.isFinite(entry.unmatchedConstituencySampleLimit) && unmatchedSample.length > entry.unmatchedConstituencySampleLimit) {
    addIssue(issues, 'warning', 'unmatched-list-count', key, `unmatchedConstituencySample length is ${unmatchedSample.length}, above sample limit ${entry.unmatchedConstituencySampleLimit}.`);
  } else if (!Array.isArray(entry.unmatchedConstituencySample) && Array.isArray(entry.unmatchedConstituencies) && Number.isFinite(entry.unmatchedCount) && entry.unmatchedConstituencies.length !== entry.unmatchedCount) {
    addIssue(issues, 'warning', 'unmatched-list-count', key, `unmatchedConstituencies length is ${entry.unmatchedConstituencies.length}, unmatchedCount is ${entry.unmatchedCount}.`);
  }

  const parentSubs = subEntriesByParent.get(key) || [];
  const overallSubs = parentSubs.filter((item) => item.entryKind === 'election-overall-result');
  const constituencySubs = parentSubs.filter((item) => item.entryKind === 'election-constituency-result');
  if (overallSubs.length === 0) addIssue(issues, 'warning', 'browse-overall-missing', key, 'Browse has no overall-result sub-entry for this election.');
  if (Number.isFinite(entry.totalConstituencies) && constituencySubs.length !== entry.totalConstituencies) {
    addIssue(issues, 'warning', 'browse-constituency-count', key, `Browse has ${constituencySubs.length} constituency/DEA sub-entries; manifest expects ${entry.totalConstituencies}.`);
  }
  for (const sub of parentSubs) {
    const refCount = Array.isArray(sub.references) ? sub.references.length : 0;
    if (refCount === 0) stats.sources.subEntriesWithNoReferences += 1;
    else if (refCount === 1) stats.sources.subEntriesWithOneReference += 1;
    else stats.sources.subEntriesWithMultipleReferences += 1;
  }

  const sourceDetailPaths = keyToSourceDetailPaths(entry);
  const sourceDetailPath = sourceDetailPaths.find((candidate) => exists(candidate));
  if (!sourceDetailPath) {
    stats.sources.parentSourceRecordsMissing += 1;
    addIssue(issues, 'warning', 'source-record-missing', key, `No election source detail record found at ${sourceDetailPaths.join(' or ') || '(unknown path)'}.`);
  } else {
    const sourceRecord = readJson(sourceDetailPath);
    const refs = sourceRecord?.item?.references || [];
    if (refs.length === 0) {
      stats.sources.sourceRecordsWithNoReferences += 1;
      addIssue(issues, 'warning', 'source-record-no-references', key, 'Election source detail record has no references.');
    } else if (refs.length === 1) {
      stats.sources.sourceRecordsWithOneReference += 1;
      addIssue(issues, 'warning', 'source-record-single-reference', key, 'Election source detail record has only one reference; multiple corroborating sources are preferred where available.');
    } else {
      stats.sources.sourceRecordsWithMultipleReferences += 1;
    }
  }

  if (entry.loadable && !entry.resultUrl) {
    stats.resultBundles.missing += 1;
    addIssue(issues, 'blocking', 'result-url-missing', key, 'Loadable manifest entry has no resultUrl.');
    continue;
  }
  if (!entry.resultUrl) continue;
  if (!urlExists(entry.resultUrl)) {
    stats.resultBundles.missing += 1;
    addIssue(issues, 'blocking', 'result-file-missing', key, `Result bundle is missing: ${entry.resultUrl}.`);
    continue;
  }
  stats.resultBundles.loaded += 1;
  const bundle = readJson(urlToRelativePath(entry.resultUrl));
  if (!Array.isArray(bundle.results)) {
    addIssue(issues, 'blocking', 'result-bundle-shape', key, 'Result bundle has no results array.');
    continue;
  }
  if (Number.isFinite(entry.totalConstituencies) && bundle.results.length !== entry.totalConstituencies) {
    addIssue(issues, 'warning', 'result-row-count', key, `Result bundle has ${bundle.results.length} result rows; manifest expects ${entry.totalConstituencies}.`);
  }
  let missingPartyRowsForElection = 0;
  const missingPartyExamplesForElection = [];
  for (const result of bundle.results) {
    stats.resultBundles.resultRows += 1;
    if (result.matched) stats.resultBundles.matchedRows += 1;
    else stats.resultBundles.unmatchedRows += 1;
    if (!result.constituency) addIssue(issues, 'warning', 'result-constituency-missing', key, 'A result row is missing constituency/DEA name.');
    if (!VALID_CONTEST_TYPES.has(result.contestType || entry.contestType)) {
      addIssue(issues, 'warning', 'contest-metadata', key, `${result.constituency || '(unnamed result)'} has missing or invalid contestType: ${result.contestType || entry.contestType || '(missing)'}.`);
    }
    if (!VALID_CONTEST_STATUSES.has(result.contestStatus || entry.contestStatus)) {
      addIssue(issues, 'warning', 'contest-metadata', key, `${result.constituency || '(unnamed result)'} has missing or invalid contestStatus: ${result.contestStatus || entry.contestStatus || '(missing)'}.`);
    }
    if (!VALID_VOTING_SYSTEMS.has(result.votingSystem || entry.votingSystem)) {
      addIssue(issues, 'warning', 'contest-metadata', key, `${result.constituency || '(unnamed result)'} has missing or invalid votingSystem: ${result.votingSystem || entry.votingSystem || '(missing)'}.`);
    }
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    stats.resultBundles.candidateRows += candidates.length;
    stats.resultBundles.electedRows += candidates.filter((candidate) => candidate.elected).length;
    if (!candidates.length && isCandidateListExpected(entry, result)) {
      const review = candidateRowReviewByResult.get(reviewRecordKey(key, result.constituency));
      addIssue(
        issues,
        'warning',
        review ? 'candidate-list-review' : 'candidate-list-missing',
        key,
        review
          ? `No candidates found for ${result.constituency || '(unnamed result)'}; review record status is ${review.status || 'recorded'}.`
          : `No candidates found for ${result.constituency || '(unnamed result)'}.`
      );
    }
    let firstPrefsSum = 0;
    let hasNumericFirstPrefs = false;
    for (const candidate of candidates) {
      if (!candidate.name) addIssue(issues, 'warning', 'candidate-name-missing', key, `Candidate row without a name in ${result.constituency || '(unnamed result)'}.`);
      if (!candidate.party) {
        missingPartyRowsForElection += 1;
        stats.resultBundles.candidateRowsWithoutParty += 1;
        if (missingPartyExamplesForElection.length < 5) {
          missingPartyExamplesForElection.push(`${candidate.name || '(unnamed)'} in ${result.constituency || '(unnamed result)'}`);
        }
      }
      const firstPrefs = normaliseNumber(candidate.firstPrefs);
      if (firstPrefs !== null) {
        hasNumericFirstPrefs = true;
        firstPrefsSum += firstPrefs;
        if (firstPrefs < 0) addIssue(issues, 'blocking', 'negative-votes', key, `Candidate ${candidate.name || '(unnamed)'} has negative first preferences in ${result.constituency || '(unnamed result)'}.`);
      }
    }
    const validPoll = normaliseNumber(result.validPoll);
    const votingSystem = result.votingSystem || entry.votingSystem || '';
    const votesPerElector = normaliseNumber(result.votesPerElector) || normaliseNumber(entry.votesPerElector) || 1;
    const review = validPollReviewByResult.get(reviewRecordKey(key, result.constituency));
    if (validPoll !== null && validPoll < 0) {
      addIssue(
        issues,
        'warning',
        review ? 'valid-poll-review' : 'valid-poll-invalid',
        key,
        review
          ? `${result.constituency || '(unnamed result)'} valid poll ${validPoll} is recorded as invalid; review record status is ${review.status || 'recorded'}.`
          : `${result.constituency || '(unnamed result)'} valid poll ${validPoll} is negative.`
      );
    } else if (validPoll !== null && hasNumericFirstPrefs) {
      const allowedVoteCeiling = votingSystem === 'block-vote' ? validPoll * votesPerElector : validPoll;
      if (firstPrefsSum > allowedVoteCeiling + Math.max(10, allowedVoteCeiling * 0.02)) {
        addIssue(
          issues,
          'warning',
          review ? 'valid-poll-review' : 'first-pref-sum',
          key,
          review
            ? `${result.constituency || '(unnamed result)'} first-preference sum ${firstPrefsSum} exceeds valid poll ceiling ${allowedVoteCeiling}; review record status is ${review.status || 'recorded'}.`
            : `${result.constituency || '(unnamed result)'} first-preference sum ${firstPrefsSum} exceeds valid poll ceiling ${allowedVoteCeiling}.`
        );
      }
    }
    const electedCount = candidates.filter((candidate) => candidate.elected).length;
    const seatsWon = normaliseNumber(result.seatsWon);
    if (seatsWon !== null && electedCount > seatsWon && !isReferendumLike(entry, result)) {
      addIssue(issues, 'warning', 'elected-count', key, `${result.constituency || '(unnamed result)'} has ${electedCount} elected candidate rows but seatsWon is ${seatsWon}.`);
    }
    const hasCountDetail = hasCandidateCountDetail(result);
    const hasAnimation = hasAnimationData(result);
    if (hasCountDetail) stats.resultBundles.rowsWithCountDetail += 1;
    if (hasAnimation) stats.resultBundles.rowsWithAnimationPayload += 1;
    if (shouldExpectTransferData(entry, result)) {
      stats.resultBundles.rowsExpectedTransferData += 1;
      if (!hasCountDetail && !hasAnimation) {
        stats.resultBundles.rowsMissingExpectedTransferData += 1;
      }
    }
  }
  if (missingPartyRowsForElection > 0) {
    addIssue(
      issues,
      'warning',
      'candidate-party-missing',
      key,
      `${missingPartyRowsForElection} candidate rows have no party/label. Examples: ${missingPartyExamplesForElection.join('; ')}.`
    );
  }
}

const colourAuditPath = path.join(ROOT, 'tasks', 'ireland_election_party_colour_wikipedia_audit.csv');
if (fs.existsSync(colourAuditPath)) {
  stats.colours.auditFilePresent = true;
  const colourRows = parseCsv(fs.readFileSync(colourAuditPath, 'utf8'));
  stats.colours.observations = colourRows.length;
  for (const row of colourRows) {
    if (row.colour_status === 'match' || row.colour_status === 'matched' || row.colour_status === 'colour_match') stats.colours.matches += 1;
    if (row.colour_status === 'colour_mismatch') stats.colours.mismatches += 1;
    if (row.colour_status === 'no_election_colour') stats.colours.noElectionColour += 1;
    if (row.match_status === 'no_match') stats.colours.noWikipediaMatch += 1;
    if (String(row.match_status || '').startsWith('ambiguous')) stats.colours.ambiguousWikipediaMatch += 1;
  }
  stats.colours.examples = colourRows
    .filter((row) => row.colour_status === 'colour_mismatch' && ['name', 'manual_alias'].includes(row.wikipedia_match_basis))
    .slice(0, 20)
    .map((row) => ({
      party: row.party_or_ticket,
      electionColour: row.election_colour,
      wikipediaName: row.wikipedia_match_name,
      wikipediaColour: row.wikipedia_colour,
      observations: normaliseNumber(row.observations) || 0,
      review: partyColourReviewByParty.get(normalizeKeyText(row.party_or_ticket)) || null
    }));
  for (const example of stats.colours.examples.slice(0, 10)) {
    if (example.review) {
      stats.colours.reviewedMismatches += 1;
      continue;
    }
    addIssue(issues, 'warning', 'party-colour-mismatch', example.party, `Election colour ${example.electionColour} differs from saved Wikipedia colour ${example.wikipediaColour} for ${example.wikipediaName}.`, { observations: example.observations });
  }
}
const highConfidencePath = path.join(ROOT, 'tasks', 'ireland_election_party_colour_wikipedia_high_confidence_mismatches.csv');
if (fs.existsSync(highConfidencePath)) {
  stats.colours.highConfidenceFilePresent = true;
  stats.colours.highConfidenceMismatches = parseCsv(fs.readFileSync(highConfidencePath, 'utf8')).length;
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  failOnBlocking: FAIL_ON_BLOCKING,
  stats,
  issueSummary: summariseIssues(issues),
  issues
};

fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n');

const issueSummary = report.issueSummary;
const blocking = issues.filter((issue) => issue.severity === 'blocking');
const warnings = issues.filter((issue) => issue.severity === 'warning');
const markdown = `# Test2 Election Data Audit

Generated: ${report.generatedAt}

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|${stats.manifest.entries}|
|manifest loadable elections|${stats.manifest.totals.loadable ?? 0}|
|manifest placeholders|${stats.manifest.totals.placeholders ?? 0}|
|Browse parent election entries|${stats.browse.parents}|
|Browse constituency/DEA sub-entries|${stats.browse.constituencySubEntries}|
|Browse overall sub-entries|${stats.browse.overallSubEntries}|
|source detail records|${stats.sources.sourceDetailFiles}|
|result bundles loaded|${stats.resultBundles.loaded}|
|result rows audited|${stats.resultBundles.resultRows}|
|candidate rows audited|${stats.resultBundles.candidateRows}|
|rows with count detail|${stats.resultBundles.rowsWithCountDetail}|
|rows with animation payload|${stats.resultBundles.rowsWithAnimationPayload}|
|rows expected to have transfer/count data|${stats.resultBundles.rowsExpectedTransferData}|
|expected transfer/count rows missing detail|${stats.resultBundles.rowsMissingExpectedTransferData}|
|valid-poll review sidecar records|${stats.reviewSidecars.validPollRecords}|
|candidate-row review sidecar records|${stats.reviewSidecars.candidateRowRecords}|
|party-colour review sidecar records|${stats.reviewSidecars.partyColourRecords}|
|blocking issues|${issueSummary.bySeverity.blocking || 0}|
|warnings|${issueSummary.bySeverity.warning || 0}|

## Blocking Structural Issues

${renderIssueTable(blocking)}

## Warning Issues

${renderIssueTable(warnings, 80)}

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|${stats.sources.parentSourceRecordsMissing}|
|source records with no references|${stats.sources.sourceRecordsWithNoReferences}|
|source records with one reference|${stats.sources.sourceRecordsWithOneReference}|
|source records with multiple references|${stats.sources.sourceRecordsWithMultipleReferences}|
|Browse sub-entries with no references|${stats.sources.subEntriesWithNoReferences}|
|Browse sub-entries with one reference|${stats.sources.subEntriesWithOneReference}|
|Browse sub-entries with multiple references|${stats.sources.subEntriesWithMultipleReferences}|

## Party Colour Audit

|metric|value|
|---|---:|
|saved Wikipedia colour audit present|${stats.colours.auditFilePresent ? 'yes' : 'no'}|
|high-confidence mismatch file present|${stats.colours.highConfidenceFilePresent ? 'yes' : 'no'}|
|review override file present|${stats.colours.reviewFilePresent ? 'yes' : 'no'}|
|sampled mismatches already reviewed|${stats.colours.reviewedMismatches}|
|unique colour observations|${stats.colours.observations}|
|colour matches|${stats.colours.matches}|
|colour mismatches|${stats.colours.mismatches}|
|high-confidence mismatches|${stats.colours.highConfidenceMismatches}|
|entries with no explicit election colour|${stats.colours.noElectionColour}|
|entries with no Wikipedia match|${stats.colours.noWikipediaMatch}|
|ambiguous Wikipedia matches|${stats.colours.ambiguousWikipediaMatch}|

### High-Confidence Colour Examples

${stats.colours.examples.length
  ? ['|party/label|election colour|Wikipedia match|Wikipedia colour|observations|review|', '|---|---|---|---|---:|---|', ...stats.colours.examples.map((row) => `|${escapeMd(row.party)}|${escapeMd(row.electionColour)}|${escapeMd(row.wikipediaName)}|${escapeMd(row.wikipediaColour)}|${row.observations}|${escapeMd(row.review?.status || '')}|`)].join('\n')
  : '_None found from the saved audit._'}

## Next Fix Queue

1. Resolve blocking issues first; these are structural and should fail CI when present.
2. Work through source/reference warnings by adding or normalising parent and sub-entry citations, preferring official/ARK/ElectionsIreland sources with Wikipedia as secondary corroboration.
3. Resolve high-confidence party-colour mismatches by updating the canonical party/label colour map or documenting an intentional Civgraph override.
4. For entries expected to have transfer/count data but missing it, decide whether the source lacks transfer stages or whether the generated bundle failed to carry available count data through to /test2.
5. Promote this audit into the normal /test2 check path so regenerated election data cannot silently change references, colours, or bundle shape.
`;
fs.writeFileSync(MD_OUT, `${markdown.trimEnd()}\n`);

console.log(`Wrote ${path.relative(ROOT, JSON_OUT)}`);
console.log(`Wrote ${path.relative(ROOT, MD_OUT)}`);
console.log(`Blocking issues: ${blocking.length}`);
console.log(`Warnings: ${warnings.length}`);

if (FAIL_ON_BLOCKING && blocking.length > 0) {
  process.exitCode = 1;
}
