/**
 * What the site's own code makes of the fixture body (argv[2]), run under overlay.mjs: the election
 * names (manifest titles and by-election rule), the party profiles' chart, the catalogue's shelf, row
 * label and search words, the map app's election type and history group, and the Elections app's
 * home group. Prints one JSON object.
 */
import { loadRegistry } from '../../../packages/registries/src/index.mjs';
import { electionBody, partyChartOf } from '../../../packages/registries/src/election-bodies.mjs';
import { canonicalElectionTitle, isElectionByElectionScope } from '../../../scripts/lib/election-names.mjs';
import { bodyShort, groupOfBody, BODY_GROUPS } from '../../../packages/map/src/catalogue/view-elections.js';
import { electionAliases } from '../../../packages/map/src/catalogue/search.js';
import { electionTypeFromEntityKey } from '../../../packages/map/src/app/helpers.mjs';
import { bodyGroupOf } from '../../../packages/map/src/entity-detail-data.mjs';
import { bodyGroup } from '../../../site/apps/elections/views/home.js';

const id = String(process.argv[2]);
const date = '2031-05-01';
const registry = loadRegistry('election-bodies');
const body = electionBody(registry, id);
const name = body?.name || '';
const electionType = electionTypeFromEntityKey(`${id}__${date}`, '');

console.log(JSON.stringify({
  registered: Boolean(body),
  title: canonicalElectionTitle({ body: name, bodySlug: id, date, constituencies: ['Example North'] }),
  byElection: isElectionByElectionScope({ body: name, bodySlug: id, date, constituencies: ['Example North'] }),
  partyChart: partyChartOf(registry, id),
  shelf: groupOfBody(id),
  shelfBodies: BODY_GROUPS.find((g) => g.id === groupOfBody(id))?.bodies || [],
  rowLabel: bodyShort({ bodySlug: id, body: name }),
  searchWords: electionAliases({ bodySlug: id, date, kind: 'general', scope: 'Northern Ireland', body: name }),
  electionType,
  historyGroup: bodyGroupOf(electionType),
  homeGroup: bodyGroup(id),
}));
