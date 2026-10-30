const NATIONAL_CONSTITUENCY_NAMES = new Set([
  'ireland',
  'republic of ireland',
  'northern ireland'
]);

// Memoised: a pure string function called hundreds of thousands of times on a few thousand
// distinct names (the largest single cost of the election manifest build). The cache lives on
// the function so it exists however early the module calls it.
function normalizeName(value) {
  if (typeof value !== 'string') return normalizeNameUncached(value);
  const cache = normalizeName.cache || (normalizeName.cache = new Map());
  let result = cache.get(value);
  if (result === undefined) {
    if (cache.size > 200000) cache.clear();
    result = normalizeNameUncached(value);
    cache.set(value, result);
  }
  return result;
}

function normalizeNameUncached(value) {
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

// Every Republic referendum's title, as Phelim Birch worded them (October 2026): the topic
// as people know it, "II" after "referendum" for a second vote on the same treaty, and the
// month wherever a year held referendums on more than one day.
const REFERENDUM_TOPIC_OVERRIDES = new Map([
  ['2024-03-08-the-family', '2024 Irish family referendum'],
  ['2024-03-08-care', '2024 Irish care referendum'],
  ['2019-05-24-regulation-of-divorce', '2019 Irish divorce referendum'],
  ['2018-10-26-repeal-of-blasphemy-offence', 'October 2018 Irish blasphemy referendum'],
  ['2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment', 'May 2018 Irish abortion referendum'],
  ['2015-05-22-equal-marriage', '2015 Irish equal marriage referendum'],
  ['2015-05-22-age-of-president', '2015 Irish age of president referendum'],
  ['2013-10-04-abolition-of-the-seanad', '2013 Irish Seanad abolition referendum'],
  ['2013-10-04-court-of-appeal', '2013 Irish Court of Appeal referendum'],
  ['2012-11-10-children', 'November 2012 Irish children referendum'],
  ['2012-05-31-fiscal-treaty', 'May 2012 Irish Fiscal Compact referendum'],
  ['2011-10-27-houses-of-the-oireachtas-inquiries', '2011 Irish Oireachtas inquiries referendum'],
  ['2011-10-27-judges-remuneration', '2011 Irish judges remuneration referendum'],
  ['2009-10-02-treaty-of-lisbon-ii', '2009 Irish Lisbon Treaty referendum II'],
  ['2008-06-12-treaty-of-lisbon-i', '2008 Irish Lisbon Treaty referendum I'],
  ['2004-06-11-irish-citizenship', '2004 Irish citizenship referendum'],
  ['2002-10-19-treaty-of-nice-ii', 'October 2002 Irish Nice Treaty referendum II'],
  ['2002-03-06-protection-of-human-life-in-pregnancy', 'March 2002 Irish abortion referendum'],
  ['2001-06-07-treaty-of-nice-i', '2001 Irish Nice Treaty referendum I'],
  ['2001-06-07-international-criminal-court', '2001 Irish International Criminal Court referendum'],
  ['2001-06-07-prohibition-of-death-penalty', '2001 Irish death penalty referendum'],
  ['1999-06-10-recognition-for-local-government', '1999 Irish local government referendum'],
  ['1998-05-22-treaty-of-amsterdam', '1998 Irish Amsterdam Treaty referendum'],
  ['1998-05-22-northern-ireland', '1998 Good Friday Agreement referendum in the Republic of Ireland'],
  ['1997-10-30-cabinet-confidentiality', '1997 Irish cabinet confidentiality referendum'],
  ['1996-11-28-bail', '1996 Irish bail referendum'],
  ['1995-11-24-dissolution-of-marriage', '1995 Irish divorce referendum'],
  ['1992-11-25-travel', 'November 1992 Irish abortion travel referendum'],
  ['1992-11-25-information', 'November 1992 Irish abortion information referendum'],
  ['1992-11-25-right-to-life', 'November 1992 Irish abortion suicide referendum'],
  ['1992-06-18-european-union', 'June 1992 Irish Maastricht Treaty referendum'],
  ['1987-05-26-ratification-of-the-single-european-act', '1987 Irish Single European Act referendum'],
  ['1986-06-26-dissolution-of-marriage', '1986 Irish divorce referendum'],
  ['1984-06-14-extension-of-voting-right-at-dail-elections', '1984 Irish non-citizen voting referendum'],
  ['1983-09-07-right-to-life-of-the-unborn', '1983 Irish abortion referendum'],
  ['1979-07-05-adoption', '1979 Irish adoption referendum'],
  ['1979-07-05-university-representation-in-seanad', '1979 Irish university constituencies referendum'],
  ['1972-12-07-voting-age', 'December 1972 Irish voting age referendum'],
  ['1972-12-07-recognition-of-specified-religions', 'December 1972 Irish recognition of specified religions referendum'],
  ['1972-05-10-accession-to-the-european-communities', 'May 1972 Irish European Communities referendum'],
  ['1968-10-16-formation-of-dail-constituencies', '1968 Irish Dáil constituencies referendum'],
  ['1968-10-16-change-in-voting-system', '1968 Irish first-past-the-post referendum'],
  ['1959-06-17-change-in-voting-system', '1959 Irish first-past-the-post referendum'],
  ['1937-07-01-plebiscite-on-the-draft-constitution', '1937 Irish constitution plebiscite']
]);

// The amendment (or amendment Bill) each referendum was on, for referendums that shared a
// polling day: lists newest first put the higher number first, so a day's referendums
// read in descending amendment order (Care, the 40th, above Family, the 39th).
const SAME_DAY_REFERENDUM_AMENDMENTS = new Map([
  ['1968-10-16-formation-of-dail-constituencies', 3],
  ['1968-10-16-change-in-voting-system', 4],
  ['1972-12-07-voting-age', 4],
  ['1972-12-07-recognition-of-specified-religions', 5],
  ['1979-07-05-adoption', 6],
  ['1979-07-05-university-representation-in-seanad', 7],
  ['1992-11-25-right-to-life', 12],
  ['1992-11-25-travel', 13],
  ['1992-11-25-information', 14],
  ['1998-05-22-treaty-of-amsterdam', 18],
  ['1998-05-22-northern-ireland', 19],
  ['2001-06-07-prohibition-of-death-penalty', 21],
  ['2001-06-07-international-criminal-court', 23],
  ['2001-06-07-treaty-of-nice-i', 24],
  ['2011-10-27-judges-remuneration', 29],
  ['2011-10-27-houses-of-the-oireachtas-inquiries', 30],
  ['2013-10-04-abolition-of-the-seanad', 32],
  ['2013-10-04-court-of-appeal', 33],
  ['2015-05-22-equal-marriage', 34],
  ['2015-05-22-age-of-president', 35],
  ['2024-03-08-the-family', 39],
  ['2024-03-08-care', 40]
]);

export function sameDayReferendumAmendment(keyOrDate) {
  const tail = String(keyOrDate || '').split('__').pop();
  return SAME_DAY_REFERENDUM_AMENDMENTS.get(tail) ?? null;
}

// Newest first; on a shared day, referendums by descending amendment number.
export function compareElectionsNewestFirst(a, b) {
  const day = String(b.date || '').slice(0, 10).localeCompare(String(a.date || '').slice(0, 10));
  if (day) return day;
  const an = sameDayReferendumAmendment(a.key || a.date);
  const bn = sameDayReferendumAmendment(b.key || b.date);
  if (an != null && bn != null && an !== bn) return bn - an;
  return String(b.date || '').localeCompare(String(a.date || ''));
}

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

const NI_REFERENDUM_TITLES = new Map([
  ['1973-03-08-border-poll', '1973 Northern Ireland border poll'],
  ['1975-06-05-eec-membership', '1975 EC membership referendum in Northern Ireland'],
  ['1998-05-22-belfast-agreement', '1998 Good Friday Agreement referendum in Northern Ireland'],
  ['2011-05-05-alternative-vote', '2011 Alternative Vote referendum in Northern Ireland'],
  ['2016-06-23-eu-membership', '2016 EU referendum in Northern Ireland']
]);

function niReferendumTitle(params = {}) {
  const { year } = dateParts(params.date);
  const rawKey = String(params.key || '');
  const dateKey = rawKey.includes('__') ? rawKey.split('__').pop() : String(params.date || '');
  if (NI_REFERENDUM_TITLES.has(dateKey)) return NI_REFERENDUM_TITLES.get(dateKey);
  return `${year} Northern Ireland referendum`.trim();
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

// Pre-1973 Northern Ireland borough and urban district councils (one body per council). Their
// elections can have one or two wards and are still whole-council elections, never by-elections.
const PRE1973_COUNCIL_BODIES = new Set([
  'belfast county borough council',
  'belfast county borough council aldermen',
  'strabane urban district council'
]);

export function isElectionByElectionScope({ body = '', bodyGroup = null, date = '', constituencies = [], specialType = null } = {}) {
  const normalizedBody = normalizeName(body);
  if (PRE1973_COUNCIL_BODIES.has(normalizedBody)) return false;
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
  // The Dail has never held a general election in fewer than 22 constituencies, but it has
  // held seven by-elections on one day (11 March 1925) and three on another (18 November
  // 1924); at two or fewer those read as the "1925 Irish general election".
  if (normalizedBody === 'dail eireann') return names.length < 20;
  // Before partition every Westminster general election in Ireland covered 60 seats or more;
  // afterwards Northern Ireland's have 10 to 18, so the rule applies only before November 1922.
  if (normalizedBody === 'house of commons of the united kingdom' && String(date || '').slice(0, 10) < '1922-11-15') {
    return names.length < 20;
  }
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
  // The Republic's local elections are one body contested across every council on the same
  // day, never a by-election and not the Northern Ireland local-government group, so they
  // are named before either of those checks can claim them.
  if (bodySlug === 'ireland-local') return `${year} Irish local elections`.trim();
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
    // The Oireachtas spells its own "bye-election"; other bodies keep "by-election".
    const by = /^(dail|seanad) eireann$/.test(normalizedBody) ? 'bye' : 'by';
    if (names.length > 1) {
      const partitioned = !(normalizedBody === 'house of commons of the united kingdom' && String(date || '').slice(0, 10) < '1922-11-15');
      return `${year} ${partitioned ? byElectionRegion(body, bodyGroup) : 'Irish'} ${by}-elections`.trim();
    }
    return `${year} ${names[0]} ${by}-election`.trim();
  }

  if (bodyGroup === 'local-government') {
    return `${year} Northern Ireland local elections`.trim();
  }

  if (normalizedBody === 'belfast county borough council') return `${year} Belfast County Borough Council election`.trim();
  if (normalizedBody === 'belfast county borough council aldermen') return `${year} Belfast County Borough Council aldermanic election`.trim();
  if (normalizedBody === 'strabane urban district council') {
    // Strabane's town commissioners became an urban district council under the 1898 Act.
    return String(year) === '1899' ? '1899 Strabane Town Commissioners election' : `${year} Strabane Urban District Council election`.trim();
  }

  if (normalizedBody === 'dail eireann') return `${year} Irish general election`.trim();
  if (normalizedBody === 'european parliament ireland') return `${year} European election in the Republic of Ireland`.trim();
  if (normalizedBody === 'european parliament') return `${year} European election in Northern Ireland`.trim();
  if (normalizedBody === 'northern ireland assembly') return `${year} Northern Ireland Assembly election`.trim();
  if (normalizedBody === 'house of commons of the united kingdom') {
    // Before partition the Westminster elections in Ireland were all-Ireland; the first held in
    // Northern Ireland alone was on 15 November 1922. 1910 had two, told apart by month.
    const day = String(date || '').slice(0, 10);
    if (day && day < '1922-11-15') {
      const month = year === '1910' || year === 1910
        ? (day.slice(5, 7) === '01' ? 'January ' : day.slice(5, 7) === '12' ? 'December ' : '')
        : '';
      return `${month}${year} UK general election in Ireland`.trim();
    }
    return `${year} UK general election in Northern Ireland`.trim();
  }
  if (normalizedBody === 'northern ireland forum for political dialogue') return '1996 Northern Ireland Forum election';
  if (normalizedBody === 'northern ireland constitutional convention') return '1975 Northern Ireland Constitutional Convention election';
  if (normalizedBody === 'parliament of northern ireland') return `${year} Parliament of Northern Ireland election`.trim();
  if (normalizedBody === 'president of ireland') return `${year} Irish presidential election`.trim();
  if (normalizedBody === 'referendum northern ireland') return niReferendumTitle({ date, key, bodySlug });
  if (normalizedBody === 'referendum ireland') return referendumTitle({ body, bodyGroup, date, constituencies, specialType, specialDisplayName, key, bodySlug });

  return `${year} ${String(body || '').trim()}`.trim();
}

export function electionResultEntryLabel(parentTitle, resultName, { regionalList = false, overall = false } = {}) {
  if (overall) return `Overall results - ${parentTitle}`;
  const label = regionalList ? 'Regional List' : String(resultName || '').trim();
  return label ? `${label} - ${parentTitle}` : parentTitle;
}
