const NATIONAL_CONSTITUENCY_NAMES = new Set([
  'ireland',
  'republic of ireland',
  'northern ireland'
]);

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function dateParts(dateValue) {
  const raw = String(dateValue || '').slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return {
      year: raw.slice(0, 4) || '',
      dayMonthYear: raw
    };
  }
  return {
    year: String(date.getFullYear()),
    dayMonthYear: date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).replace(/,/g, '')
  };
}

export function electionYear(dateValue) {
  return dateParts(dateValue).year;
}

export function formatElectionDayMonthYear(dateValue) {
  return dateParts(dateValue).dayMonthYear;
}

export function electionConstituencyNames(constituencies = []) {
  return [...new Set((constituencies || [])
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .filter((name) => !NATIONAL_CONSTITUENCY_NAMES.has(normalizeName(name))))];
}

export function isElectionByElectionScope({ body = '', bodyGroup = null, date = '', constituencies = [], specialType = null } = {}) {
  const normalizedBody = normalizeName(body);
  if (
    specialType === 'recall-petition'
    || (normalizedBody === 'house of commons of the united kingdom' && String(date || '').slice(0, 10) === '2018-08-29')
  ) {
    return false;
  }
  const names = electionConstituencyNames(constituencies);
  if (!names.length) return false;
  if (bodyGroup === 'local-government') return names.length <= 2;
  if (normalizedBody === 'european parliament' || normalizedBody === 'european parliament ireland') return false;
  if (normalizedBody === 'president of ireland' || normalizedBody === 'referendum ireland') return false;
  return names.length <= 2;
}

function byElectionRegion(body, bodyGroup) {
  if (bodyGroup === 'local-government') return 'Northern Ireland';
  const normalizedBody = normalizeName(body);
  if (
    normalizedBody === 'house of commons of the united kingdom'
    || normalizedBody === 'northern ireland assembly'
    || normalizedBody === 'parliament of northern ireland'
    || normalizedBody === 'northern ireland forum for political dialogue'
    || normalizedBody === 'northern ireland constitutional convention'
    || normalizedBody === 'european parliament'
  ) {
    return 'Northern Ireland';
  }
  return 'Irish';
}

export function canonicalElectionTitle({
  body = '',
  bodyGroup = null,
  date = '',
  constituencies = [],
  specialType = null,
  specialDisplayName = null
} = {}) {
  if (specialDisplayName) return specialDisplayName;
  const { year, dayMonthYear } = dateParts(date);
  const normalizedBody = normalizeName(body);
  const inferredSpecialType = specialType
    || (normalizedBody === 'house of commons of the united kingdom' && String(date || '').slice(0, 10) === '2018-08-29' ? 'recall-petition' : null);
  const names = electionConstituencyNames(constituencies);
  const byElection = isElectionByElectionScope({ body, bodyGroup, date, constituencies, specialType: inferredSpecialType });

  if (inferredSpecialType === 'recall-petition') {
    const constituency = names[0] || 'Northern Ireland';
    return `${year} ${constituency} recall petition`.trim();
  }

  if (byElection) {
    if (names.length > 1) {
      return `${dayMonthYear} ${byElectionRegion(body, bodyGroup)} by-elections`.trim();
    }
    return `${year} ${names[0]} by-election`.trim();
  }

  if (bodyGroup === 'local-government') {
    return `${year} Northern Ireland local election`.trim();
  }

  if (normalizedBody === 'dail eireann') return `${year} Irish general election`.trim();
  if (normalizedBody === 'european parliament ireland') return `${year} European Parliament election (ROI)`.trim();
  if (normalizedBody === 'european parliament') return `${year} European Parliament election (NI)`.trim();
  if (normalizedBody === 'northern ireland assembly') return `${year} Northern Ireland Assembly election`.trim();
  if (normalizedBody === 'house of commons of the united kingdom') return `${year} general election in Northern Ireland`.trim();
  if (normalizedBody === 'northern ireland forum for political dialogue') return '1996 Northern Ireland Forum election';
  if (normalizedBody === 'northern ireland constitutional convention') return '1975 Northern Ireland Constitutional convention';
  if (normalizedBody === 'parliament of northern ireland') return `${year} Parliament of Northern Ireland election`.trim();
  if (normalizedBody === 'president of ireland') return `${year} Irish presidential election`.trim();
  if (normalizedBody === 'referendum ireland') return `${year} Irish referendum`.trim();

  return `${year} ${String(body || '').trim()}`.trim();
}

export function electionResultEntryLabel(parentTitle, resultName, { regionalList = false, overall = false } = {}) {
  if (overall) return `Overall results - ${parentTitle}`;
  const label = regionalList ? 'Regional List' : String(resultName || '').trim();
  return label ? `${label} - ${parentTitle}` : parentTitle;
}
