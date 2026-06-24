import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mapsPath = path.join(root, 'data', 'database', 'maps.json');
const uiPath = path.join(root, 'js', 'ui-controller.js');

const fail = (message) => {
  throw new Error(`[hills-catalogue] ${message}`);
};

const mapsDb = JSON.parse(fs.readFileSync(mapsPath, 'utf8'));
const uiSource = fs.readFileSync(uiPath, 'utf8');

const expectedClasses = [
  {
    id: 'dobih-britain-ireland-hills-and-mountains',
    flatId: 'flat-hills-mountains-britain-ireland',
    requiredMaps: ['dobih-v18-4', 'dobih-v18-4-marilyns', 'dobih-v18-4-significant-islands']
  },
  {
    id: 'dobih-ireland-hills-and-mountains',
    flatId: 'flat-hills-mountains-ireland',
    requiredMaps: ['dobih-v18-4-arderins', 'irish-hill-summit-domains', 'irish-hill-prominence-domains']
  },
  {
    id: 'dobih-england-wales-hills-and-mountains',
    flatId: 'flat-hills-mountains-england-wales',
    requiredMaps: ['dobih-v18-4-nuttalls', 'dobih-v18-4-hewitts']
  },
  {
    id: 'dobih-scotland-hills-and-mountains',
    flatId: 'flat-hills-mountains-scotland',
    requiredMaps: ['dobih-v18-4-munros', 'dobih-v18-4-donalds', 'dobih-v18-4-donald-tops']
  }
];

const classes = new Map((mapsDb.classes || []).map((entry) => [entry.id, entry]));
const maps = new Map((mapsDb.maps || []).map((entry) => [entry.id, entry]));
const c1 = (mapsDb.c1s || []).find((entry) => entry.id === 'hills-and-mountains-c1');

if (!c1) fail('missing hills-and-mountains-c1 hierarchy entry');
if (c1.name !== 'Hills and Mountains') fail(`unexpected C1 name: ${c1.name}`);
if (!Array.isArray(c1.sections) || c1.sections.length !== expectedClasses.length) {
  fail(`expected ${expectedClasses.length} C1 sections, found ${c1.sections?.length || 0}`);
}

const c1ClassIds = new Set(c1.sections.map((section) => section.classId));
for (const expected of expectedClasses) {
  if (!c1ClassIds.has(expected.id)) fail(`C1 is not wired to ${expected.id}`);
  const cls = classes.get(expected.id);
  if (!cls) fail(`missing class ${expected.id}`);
  if (!Array.isArray(cls.maps) || !cls.maps.length) fail(`class ${expected.id} has no child maps`);
  for (const mapId of expected.requiredMaps) {
    if (!cls.maps.includes(mapId)) fail(`class ${expected.id} is missing child map ${mapId}`);
    if (!maps.has(mapId)) fail(`database is missing map ${mapId}`);
  }
  if (!uiSource.includes(`id: '${expected.flatId}'`)) fail(`UI flat card ${expected.flatId} is missing`);
  if (!uiSource.includes(`classIds: ['${expected.id}']`)) fail(`UI flat card does not target ${expected.id}`);
}

if (uiSource.includes(`classIds: ['dobih-hills-and-mountains']`)) {
  fail('UI still targets obsolete dobih-hills-and-mountains class');
}

const mergeStart = uiSource.indexOf(`canonicalName: 'Hills and Mountains'`);
if (mergeStart === -1) fail('UI ToC merge for Hills and Mountains is missing');
const mergeBlock = uiSource.slice(mergeStart, mergeStart + 900);
for (const expected of expectedClasses) {
  if (!mergeBlock.includes(`'${expected.flatId}'`)) {
    fail(`Hills and Mountains ToC merge is missing ${expected.flatId}`);
  }
}
if (!mergeBlock.includes(`inHeading: 'Environment, Water & Geology'`)) {
  fail('Hills and Mountains ToC merge is not scoped to Environment, Water & Geology');
}

const envHeading = uiSource.indexOf(`heading: 'Environment, Water & Geology'`);
if (envHeading === -1) fail('Environment, Water & Geology ToC heading is missing');
const envBlock = uiSource.slice(envHeading, envHeading + 1600);
if (!envBlock.includes(`'Hills and Mountains'`)) {
  fail('Environment, Water & Geology ToC members do not include Hills and Mountains');
}

console.log(`Hills and Mountains catalogue wiring OK: ${expectedClasses.length} cards, ${expectedClasses.reduce((sum, entry) => sum + classes.get(entry.id).maps.length, 0)} child layers.`);
