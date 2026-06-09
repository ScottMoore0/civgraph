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

const REFERENDUM_TOPIC_OVERRIDES = new Map([
  ['2024-03-08-the-family', '2024 Irish family referendum'],
  ['2024-03-08-care', '2024 Irish care referendum'],
  ['2019-05-24-regulation-of-divorce', '2019 Irish divorce referendum'],
  ['2018-10-26-repeal-of-blasphemy-offence', 'October 2018 Irish blasphemy referendum'],
  ['2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment', 'May 2018 Irish abortion referendum'],
  ['1998-05-22-northern-ireland', '1998 Good Friday Agreement referendum in the Republic of Ireland']
]);

const REFERENDUM_TOPIC_LABELS = new Map([
  ['the-family', 'family'],
  ['care', 'care'],
  ['regulation-of-divorce', 'divorce'],
  ['repeal-of-blasphemy-offence', 'blasphemy'],
  ['regulation-of-termination-of-pregnancy-repeal-of-8th-amendment', 'abortion'],
  ['eighth-amendment', 'abortion'],
  ['thirty-sixth-amendment', 'abortion'],
  ['thirty-eighth-amendment', 'divorce'],
  ['thirty-ninth-amendment', 'presidential voting'],
  ['thirty-seventh-amendment', 'women in the home'],
  ['thirty-fourth-amendment', 'marriage equality'],
  ['thirty-second-amendment', 'abolition of the Seanad'],
  ['thirty-third-amendment', 'Court of Appeal'],
  ['thirtieth-amendment', 'Oireachtas inquiries'],
  ['twenty-ninth-amendment', 'judges remuneration'],
  ['twenty-eighth-amendment', 'Lisbon Treaty'],
  ['twenty-seventh-amendment', 'citizenship'],
  ['twenty-sixth-amendment', 'Nice Treaty'],
  ['twenty-fifth-amendment', 'abortion'],
  ['twenty-fourth-amendment', 'Nice Treaty'],
  ['twenty-third-amendment', 'International Criminal Court'],
  ['twenty-first-amendment', 'death penalty'],
  ['twentieth-amendment', 'local government'],
  ['nineteenth-amendment', 'Good Friday Agreement'],
  ['belfast-agreement', 'Good Friday Agreement'],
  ['good-friday-agreement', 'Good Friday Agreement'],
  ['brexit', 'Brexit'],
  ['alternative-vote', 'Alternative Vote']
]);

function slugToWords(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseTopic(value) {
  return slugToWords(value).replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function referendumTopicFromKey({ key = '', bodySlug = '', date = '' } = {}) {
  const datePrefix = String(date || '').slice(0, 10);
  const rawKey = String(key || '');
  const rawBodySlug = String(bodySlug || '');
  const candidates = [
    rawKey.includes('__') ? rawKey.split('__').pop() : rawKey,
    String(date || ''),
    rawBodySlug
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = candidate
      .toLowerCase()
      .replace(/^ireland-referendum__/, '')
      .replace(/^referendum-ireland__/, '')
      .replace(new RegExp(`^${datePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`), '')
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/^referendum-/, '')
      .replace(/^ireland-/, '');
    if (normalized && normalized !== 'referendum' && normalized !== 'ireland-referendum') {
      return normalized;
    }
  }
  return '';
}

function referendumTitle(params = {}) {
  const { year } = dateParts(params.date);
  const datePrefix = String(params.date || '').slice(0, 10);
  const topic = referendumTopicFromKey(params);
  const exactKey = topic ? `${datePrefix}-${topic}` : datePrefix;
  if (REFERENDUM_TOPIC_OVERRIDES.has(exactKey)) return REFERENDUM_TOPIC_OVERRIDES.get(exactKey);
  const normalizedTopic = REFERENDUM_TOPIC_LABELS.get(topic) || titleCaseTopic(topic).toLowerCase();
  if (!normalizedTopic) return `${year} Irish referendum`.trim();
  const prefix = ['brexit', 'alternative vote', 'good friday agreement'].includes(normalizedTopic.toLowerCase())
    ? titleCaseTopic(normalizedTopic)
    : normalizedTopic;
  return `${year} Irish ${prefix} referendum`.trim();
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
  specialDisplayName = null,
  key = '',
  bodySlug = ''
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
      return `${year} ${byElectionRegion(body, bodyGroup)} by-elections`.trim();
    }
    return `${year} ${names[0]} by-election`.trim();
  }

  if (bodyGroup === 'local-government') {
    return `${year} Northern Ireland local elections`.trim();
  }

  if (normalizedBody === 'dail eireann') return `${year} Irish general election`.trim();
  if (normalizedBody === 'european parliament ireland') return `${year} European election in the Republic of Ireland`.trim();
  if (normalizedBody === 'european parliament') return `${year} European election in Northern Ireland`.trim();
  if (normalizedBody === 'northern ireland assembly') return `${year} Northern Ireland Assembly election`.trim();
  if (normalizedBody === 'house of commons of the united kingdom') return `${year} UK general election in Northern Ireland`.trim();
  if (normalizedBody === 'northern ireland forum for political dialogue') return '1996 Northern Ireland Forum election';
  if (normalizedBody === 'northern ireland constitutional convention') return '1975 Northern Ireland Constitutional Convention election';
  if (normalizedBody === 'parliament of northern ireland') return `${year} Parliament of Northern Ireland election`.trim();
  if (normalizedBody === 'president of ireland') return `${year} Irish presidential election`.trim();
  if (normalizedBody === 'referendum ireland') return referendumTitle({ body, bodyGroup, date, constituencies, specialType, specialDisplayName, key, bodySlug });

  return `${year} ${String(body || '').trim()}`.trim();
}

export function electionResultEntryLabel(parentTitle, resultName, { regionalList = false, overall = false } = {}) {
  if (overall) return `Overall results - ${parentTitle}`;
  const label = regionalList ? 'Regional List' : String(resultName || '').trim();
  return label ? `${label} - ${parentTitle}` : parentTitle;
}
