#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const MAPS_PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(MAPS_PATH, 'utf8'));

function upsertById(items, entry) {
  const index = items.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...entry };
  } else {
    items.push(entry);
  }
}

function orderedUnique(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function makeCountyEntry(year, label, extraKeywords = []) {
  return {
    id: `counties-ireland-${year}`,
    name: label,
    slug: `counties-ireland-${year}`,
    category: 'counties',
    files: {
      fgb: `https://data.civgraph.net/data/maps/baronies-parishes/Counties_Ireland_${year}.fgb`
    },
    date: String(year),
    useLOD: true,
    provider: [
      'Phelim Birch'
    ],
    style: {
      color: '#00A9E6',
      weight: 2
    },
    labelProperty: 'COUNTY',
    keywords: [
      'county',
      'ireland',
      'all-island',
      '32 counties',
      String(year),
      ...extraKeywords,
      'traditional'
    ]
  };
}

function makeLocalAuthorityEntry(year) {
  return {
    id: `local-authorities-${year}`,
    name: `Local Authorities ${year}`,
    slug: `local-authorities-${year}`,
    category: 'local-government',
    date: `${year}-01-01`,
    provider: [
      'Phelim Birch'
    ],
    files: {
      fgb: `https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_${year}.fgb`
    },
    style: {
      color: '#4A90D9',
      weight: 2
    },
    keywords: [
      'local authorities',
      'republic of ireland',
      'ireland',
      'council',
      'county council',
      'city council',
      String(year),
      'historical'
    ],
    labelProperty: 'ENGLISH',
    useLOD: true
  };
}

const maps = db.maps;
const classes = db.classes;

const counties = maps.find((map) => map.id === 'counties-ireland');
if (!counties) throw new Error('Missing counties-ireland map');

for (const entry of [
  makeCountyEntry('1915', 'Counties of Ireland 1915'),
  makeCountyEntry('1922', 'Counties of Ireland 1922 (all-island, Tirconaill)', ['tirconaill', 'offaly', 'laois']),
  makeCountyEntry('1927', 'Counties of Ireland 1927 (all-island, Donegal)', ['donegal', 'offaly', 'laois']),
  makeCountyEntry('1955', 'Counties of Ireland 1955'),
  makeCountyEntry('1957', 'Counties of Ireland 1957')
]) {
  upsertById(maps, entry);
}

counties.variants = (counties.variants || []).filter((variant) => [
  'counties-ni-1915',
  'roi-counties-2011'
].includes(variant.id));

const desiredCountyOrder = [
  'counties-ireland-1957',
  'counties-ireland-1955',
  'counties-ireland-1927',
  'counties-ireland-1922',
  'counties-ireland-1915'
];

const localAuthorityYears = ['1930', '1931', '1941', '1942', '1944', '1950'];
for (const year of localAuthorityYears) {
  upsertById(maps, makeLocalAuthorityEntry(year));
}

const localAuthorityClass = classes.find((item) => item.id === 'roi-local-authorities');
if (!localAuthorityClass) throw new Error('Missing roi-local-authorities class');
localAuthorityClass.maps = orderedUnique([
  'local-authorities-2024',
  'local-authorities-2014',
  'local-authorities-2008',
  'local-authorities-2002',
  'local-authorities-1994',
  'local-authorities-1986',
  'local-authorities-1985',
  'local-authorities-1980',
  'local-authorities-1977',
  'local-authorities-1966',
  'local-authorities-1965',
  'local-authorities-1957',
  'local-authorities-1955',
  'local-authorities-1953',
  'local-authorities-1950',
  'local-authorities-1944',
  'local-authorities-1942',
  'local-authorities-1941',
  'local-authorities-1931',
  'local-authorities-1930'
]);

const localAuthorities2008 = maps.find((map) => map.id === 'local-authorities-2008');
if (localAuthorities2008) localAuthorities2008.provider = ['CSO'];

const countiesClass = classes.find((item) => item.id === 'ni-counties');
if (countiesClass) {
  countiesClass.maps = orderedUnique([
    'counties-ireland',
    ...desiredCountyOrder
  ]);
}

writeFileSync(MAPS_PATH, JSON.stringify(db, null, 2) + '\n', 'utf8');
console.log('Added/updated historical all-Ireland counties as top-level maps and ROI local authorities 1930, 1931, 1941, 1942, 1944, 1950.');
