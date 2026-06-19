#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const MAPS_PATH = 'data/database/maps.json';
const db = JSON.parse(readFileSync(MAPS_PATH, 'utf8'));

const maps = db.maps || [];
const classes = db.classes || [];

function mapById(id) {
  return maps.find((map) => map.id === id);
}

function classById(id) {
  return classes.find((item) => item.id === id);
}

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

function encodeSpaces(value) {
  return typeof value === 'string' ? value.replaceAll(' ', '%20') : value;
}

function normalizeFiles(item) {
  if (!item || typeof item !== 'object') return;
  if (item.files) {
    for (const [key, value] of Object.entries(item.files)) {
      item.files[key] = encodeSpaces(value);
    }
  }
  if (Array.isArray(item.variants)) {
    for (const variant of item.variants) normalizeFiles(variant);
  }
}

function setStyle(item, style) {
  item.style = { ...(style || { color: '#256D36', weight: 2 }) };
}

const electoralBase = 'https://data.civgraph.net/data/maps/electoral-divisions';
const historicFolder = `${electoralBase}/Electoral%20Divisions%201986-2019`;
const connacht1919 = `${electoralBase}/DEDs_Connacht_1919.fgb`;
const ulster1921 = `${electoralBase}/DEDs_Ulster_1921.fgb`;

function dedVariant(parent, region, label, fgb) {
  return {
    id: `${parent.id}-${region}`,
    label,
    files: { fgb: encodeSpaces(fgb) },
    style: { ...parent.style },
    labelProperty: parent.labelProperty || 'ENGLISH',
    useLOD: Boolean(parent.useLOD)
  };
}

function configureDedGroup(id, variants) {
  const parent = mapById(id);
  if (!parent) throw new Error(`Missing DED/Ward parent map ${id}`);
  parent.isGroup = true;
  delete parent.files;
  parent.variants = variants.map((variant) => dedVariant(parent, ...variant));
  normalizeFiles(parent);
}

const ulsterComponent = mapById('eds-ulster-1921');
if (ulsterComponent?.files) {
  ulsterComponent.files.fgb = ulster1921;
  normalizeFiles(ulsterComponent);
}

for (const item of maps) {
  if (item.id?.startsWith('eds-')) normalizeFiles(item);
}

configureDedGroup('eds-roi-1957', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster 1957', `${historicFolder}/Wards_DEDs_Leinster_1957.fgb`],
  ['munster', 'Munster (= 1955 boundaries)', `${historicFolder}/Wards_DEDs_Munster_1955.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-roi-1965', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster (= 1957 boundaries)', `${historicFolder}/Wards_DEDs_Leinster_1957.fgb`],
  ['munster', 'Munster 1965', `${historicFolder}/Wards_DEDs_Munster_1965.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-roi-1966', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster (= 1957 boundaries)', `${historicFolder}/Wards_DEDs_Leinster_1957.fgb`],
  ['munster', 'Munster 1966', `${historicFolder}/Wards_DEDs_Munster_1966.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-roi-1970', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster (= 1957 boundaries)', `${historicFolder}/Wards_DEDs_Leinster_1957.fgb`],
  ['munster', 'Munster 1970', `${historicFolder}/Wards_DEDs_Munster_1970.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-1971', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster 1971', `${historicFolder}/Wards_DEDs_Leinster_1971.fgb`],
  ['munster', 'Munster 1971', `${historicFolder}/Wards_DEDs_Munster_1971.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-1977', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster 1977', `${historicFolder}/Wards_DEDs_Leinster_1977.fgb`],
  ['munster', 'Munster (= 1971 boundaries)', `${historicFolder}/Wards_DEDs_Munster_1971.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-1980', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster (= 1977 boundaries)', `${historicFolder}/Wards_DEDs_Leinster_1977.fgb`],
  ['munster', 'Munster 1980', `${historicFolder}/Wards_DEDs_Munster_1980.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

configureDedGroup('eds-1983', [
  ['connacht', 'Connacht (= 1919 boundaries)', connacht1919],
  ['leinster', 'Leinster (= 1977 boundaries)', `${historicFolder}/Wards_DEDs_Leinster_1977.fgb`],
  ['munster', 'Munster 1983', `${historicFolder}/Wards_DEDs_Munster_1983.fgb`],
  ['ulster', 'Ulster (ROI: Cavan/Donegal/Monaghan; 1921 boundaries)', ulster1921]
]);

function makeCountyEntry(year, name, extraKeywords = []) {
  return {
    id: `counties-ireland-${year}`,
    name,
    slug: `counties-ireland-${year}`,
    category: 'counties',
    date: String(year),
    provider: ['Phelim Birch'],
    files: {
      fgb: `https://data.civgraph.net/data/maps/baronies-parishes/Counties_Ireland_${year}.fgb`
    },
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
    ],
    useLOD: true
  };
}

upsertById(maps, makeCountyEntry('1915', 'Counties of Ireland 1915'));
upsertById(maps, makeCountyEntry('1922', 'Counties of Ireland 1922 (all-island, Tirconaill)', ['tirconaill', 'offaly', 'laois']));
upsertById(maps, makeCountyEntry('1927', 'Counties of Ireland 1927 (all-island, Donegal)', ['donegal', 'offaly', 'laois']));
upsertById(maps, makeCountyEntry('1955', 'Counties of Ireland 1955'));
upsertById(maps, makeCountyEntry('1957', 'Counties of Ireland 1957'));

const counties = mapById('counties-ireland');
if (!counties) throw new Error('Missing counties-ireland map');
counties.variants = (counties.variants || []).filter((variant) => ['counties-ni-1915', 'roi-counties-2011'].includes(variant.id));

const countiesClass = classById('ni-counties');
if (!countiesClass) throw new Error('Missing ni-counties class');
countiesClass.maps = orderedUnique([
  'counties-ireland',
  'counties-ireland-1957',
  'counties-ireland-1955',
  'counties-ireland-1927',
  'counties-ireland-1922',
  'counties-ireland-1915'
]);

const provinces = mapById('provinces');
if (provinces) provinces.hidden = true;

const provincesClass = classById('ireland-provinces');
if (provincesClass) {
  provincesClass.maps = orderedUnique((provincesClass.maps || []).filter((id) => id !== 'provinces'));
}

const duplicateDed1921 = mapById('eds-roi-1921-06-28');
if (duplicateDed1921) duplicateDed1921.hidden = true;

const edsClass = classById('eds-historic');
if (!edsClass) throw new Error('Missing eds-historic class');
edsClass.maps = orderedUnique([
  'eds-2022',
  'eds-2019',
  'eds-2006',
  'eds-1997',
  'eds-1994',
  'eds-1986',
  'eds-1983',
  'eds-1980',
  'eds-1977',
  'eds-1971',
  'eds-roi-1970',
  'eds-roi-1966',
  'eds-roi-1965',
  'eds-roi-1957',
  ...edsClass.maps.filter((id) => ![
    'eds-2022',
    'eds-2019',
    'eds-2006',
    'eds-1997',
    'eds-1994',
    'eds-1986',
    'eds-1983',
    'eds-1980',
    'eds-1977',
    'eds-1971',
    'eds-roi-1970',
    'eds-roi-1966',
    'eds-roi-1965',
    'eds-roi-1957',
    'eds-roi-1921-06-28'
  ].includes(id))
]);

const localAuthorities2008 = mapById('roi-local-authorities-2008');
if (localAuthorities2008) localAuthorities2008.provider = ['CSO'];

for (const id of ['eds-roi-1921-05-03', 'eds-roi-1921-06-28']) {
  const map = mapById(id);
  if (!map?.variants) continue;
  for (const variant of map.variants) setStyle(variant, map.style);
}

writeFileSync(MAPS_PATH, JSON.stringify(db, null, 2) + '\n', 'utf8');

console.log('Fixed DED/Ward groups, county records, province visibility, and collaborator credit metadata.');
